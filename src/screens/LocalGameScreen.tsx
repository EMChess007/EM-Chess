import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSaveGameOnEnd } from '../api/useSaveGameOnEnd';
import { appAlert } from '../components/AppAlert';
import CapturedPieces from '../components/CapturedPieces';
import ChessBoard from '../components/ChessBoard';
import GameControlBar from '../components/GameControlBar';
import GameOptionsMenu from '../components/GameOptionsMenu';
import GameScreenBody from '../components/GameScreenBody';
import MoveListStrip from '../components/MoveListStrip';
import PostGameSummaryModal from '../components/PostGameSummaryModal';
import ScreenHeader from '../components/ScreenHeader';
import { getEngineRuntime } from '../engine/engineRegistry';
import StockfishBridge, { type StockfishBridgeHandle } from '../engine/StockfishBridge';
import { generateChess960Position } from '../logic/chess960';
import { ChessEngine } from '../logic/ChessEngine';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { DEFAULT_ENGINE_ID } from '../logic/engines';
import { buildGamePayload } from '../logic/gamePayload';
import { getGameOutcome } from '../logic/gameResult';
import { describeEndReason } from '../logic/gameOutcomeText';
import {
  getFogOfWarWinner,
  getVisibleSquares,
  logFogOfWarGameStart,
  logFogOfWarPly,
  useIncrementalFogRedaction,
} from '../logic/fogOfWar';
import { triggerGameEndHaptics, triggerMoveHaptics } from '../logic/haptics';
import { getKingOfTheHillWinner } from '../logic/kingOfTheHill';
import { computeCapturedMaterial, materialValue } from '../logic/material';
import { playMoveSound } from '../logic/moveSounds';
import { lookupOpening } from '../logic/openings';
import { THREE_CHECK_TARGET, getThreeCheckCounts, getThreeCheckWinner } from '../logic/threeCheck';
import { formatTime } from '../logic/time';
import { uciMoveToSan } from '../logic/uciMove';
import { useChessClock } from '../logic/useChessClock';
import { START_FEN } from '../types/chess';
import type { Move, PieceColor } from '../types/chess';
import type { AnalyzeParams, GameHistoryEntry } from '../types/history';
import type { TimeControl } from '../types/timeControl';

interface LocalGameScreenProps {
  timeControl: TimeControl;
  chess960?: boolean;
  kingOfTheHill?: boolean;
  threeCheck?: boolean;
  setupChess?: boolean;
  fogOfWar?: boolean;
  /** The merged starting position from the Setup Chess builder flow — used instead of
   * self-generating one when present (setupChess games always pass this). */
  initialFen?: string;
  authToken: string | null;
  onExit: () => void;
  onAnalyze: (params: AnalyzeParams) => void;
}

export default function LocalGameScreen({
  timeControl,
  chess960 = false,
  kingOfTheHill = false,
  threeCheck = false,
  setupChess = false,
  fogOfWar = false,
  initialFen: initialFenProp,
  authToken,
  onExit,
  onAnalyze,
}: LocalGameScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [initialFen, setInitialFen] = useState(() => initialFenProp ?? (chess960 ? generateChess960Position() : START_FEN));
  const [fen, setFen] = useState(initialFen);
  const [lastMove, setLastMove] = useState<Move | null>(null);
  const [history, setHistory] = useState<GameHistoryEntry[]>([]);
  const [resetCount, setResetCount] = useState(0);
  const [openingName, setOpeningName] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [resignedBy, setResignedBy] = useState<PieceColor | null>(null);
  const [drawAgreed, setDrawAgreed] = useState(false);
  const [hintText, setHintText] = useState<string | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [hintActive, setHintActive] = useState(false);
  const [hintRequestKey, setHintRequestKey] = useState(0);
  const [viewIndex, setViewIndex] = useState<number | null>(null); // null = live position
  const [fogOfWarWinner, setFogOfWarWinner] = useState<PieceColor | null>(null);
  // True right after a move, before the next player has confirmed they're looking at the device
  // — hides the board/controls behind a "pass the device" interstitial (see the render below) so
  // the mover never keeps seeing their own just-played position once it's no longer their turn.
  // Starts false: White is assumed to already be holding the device at the start of the game.
  const [awaitingPass, setAwaitingPass] = useState(false);

  // A scratch engine used only for on-demand hints — unlike BotGameScreen, a local 2-player game
  // has no engine wired in already, so this mounts its own (the strongest available one, same as
  // Analysis) lazily on the first hint request rather than paying WASM-load cost upfront for
  // players who never use it.
  const hintRuntime = useMemo(() => getEngineRuntime(DEFAULT_ENGINE_ID), []);
  const hintBridgeRef = useRef<StockfishBridgeHandle>(null);
  const handleHintBridgeRef = useCallback(
    (handle: StockfishBridgeHandle | null) => {
      hintBridgeRef.current = handle;
      hintRuntime.engine.attachBridge(handle);
    },
    [hintRuntime]
  );
  const handleHintBridgeLine = useCallback((line: string) => hintRuntime.engine.handleLine(line), [hintRuntime]);

  useEffect(() => {
    if (!hintActive || hintRequestKey === 0) return;
    let cancelled = false;
    (async () => {
      try {
        await hintRuntime.engine.initEngine();
        hintRuntime.engine.setPosition(fen);
        const uci = await hintRuntime.engine.getBestMove({ movetimeMs: 800 });
        if (cancelled) return;
        setHintText(uciMoveToSan(uci, fen, { chess960, initialFen }));
      } catch {
        if (!cancelled) setHintText(null);
      } finally {
        if (!cancelled) setHintLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintRequestKey]);

  // Opening names don't apply to Chess960 or Setup Chess (a shuffled or custom-built starting
  // position makes the whole concept meaningless), and only ever *upgrade* to a deeper/more
  // specific name — the book doesn't have an entry for every single ply, so a miss here just
  // means "no new checkpoint yet", not "left the book"; once a played move truly can't lead to
  // any further named position, no later position will match either, so this naturally stops
  // updating on its own.
  useEffect(() => {
    if (chess960 || setupChess || fogOfWar) return;
    const match = lookupOpening(fen);
    if (match) setOpeningName(match.name);
  }, [fen, chess960, setupChess, fogOfWar]);

  // skipValidation: once a Fog of War game ends via king capture, `fen` genuinely has no king
  // for the losing side — see ChessEngine's own doc comment on the option (this is the exact
  // crash category already found/fixed in cloneWithTurn, caught again here by a systematic grep).
  const engine = useMemo(
    () => new ChessEngine(fen, { chess960, initialFen, skipValidation: fogOfWar }),
    [fen, chess960, initialFen, fogOfWar]
  );
  const turn = engine.getTurn();
  const chessStatus = engine.getStatus();
  // Chess.js has no idea this rule exists — checked independently, only when actually playing
  // this variant (see kingOfTheHill.ts).
  const kingOfTheHillWinner = kingOfTheHill ? getKingOfTheHillWinner(engine) : null;
  // Derived from `history` (see threeCheck.ts) rather than separately tracked state, so it's
  // automatically correct after Undo too.
  const historyMoves = useMemo(() => history.map((h) => h.move), [history]);
  const threeCheckWinner = threeCheck ? getThreeCheckWinner(historyMoves) : null;
  const checkCounts = threeCheck ? getThreeCheckCounts(historyMoves) : null;

  // Fog of War has no checkmate/stalemate/draw concept at all — king capture (fogOfWarWinner,
  // set from handleMove below) is the only way such a game ends, so chess.js's own isGameOver()
  // is ignored entirely here: moves go through movePseudoLegal (see ChessBoard), which can
  // perfectly well reach a position that LOOKS like checkmate/stalemate to chess.js without
  // anyone's king ever having been captured, and that must NOT stop the game.
  const engineGameOver = fogOfWar ? false : engine.isGameOver();
  const clock = useChessClock(timeControl, turn, engineGameOver);
  const gameOver =
    engineGameOver ||
    clock.timeoutWinner !== null ||
    resignedBy !== null ||
    drawAgreed ||
    kingOfTheHillWinner !== null ||
    threeCheckWinner !== null ||
    fogOfWarWinner !== null;

  // Fog of War only — the squares visible to whoever currently holds the device (the side to
  // move; see awaitingPass above for why that's always who's actually looking). Memoized on
  // [engine, turn] — without this, both this and fogRedactedHistory below were recomputing (the
  // history one replaying the ENTIRE game from scratch via chess.js move generation) on EVERY
  // render, not just after a move — the chess clock alone re-renders this screen every second,
  // so the cost was being repaid dozens of times per actual move, worse ever move the game went
  // on; this is what was causing both the reported lag and the fog appearing to fall behind.
  const visibleSquares = useMemo(() => (fogOfWar ? getVisibleSquares(engine, turn) : undefined), [fogOfWar, engine, turn]);
  // Incremental, not a full replay-from-scratch per render — see useIncrementalFogRedaction's own
  // doc comment (and this session's profiling: a full replay cost ~230ms by move 40, run
  // synchronously inside the very render handleMove triggers). Tracks both colors so the device
  // alternating hands every ply (see awaitingPass above) doesn't throw the cache away each time.
  const fogRedactedByColor = useIncrementalFogRedaction(fogOfWar, initialFen, history, engine);
  const fogRedactedHistory = fogOfWar ? fogRedactedByColor[turn] : null;
  const lastMoveRevealed = !fogOfWar || (fogRedactedHistory?.[fogRedactedHistory.length - 1]?.revealed ?? true);

  // Fog of War only — see BotGameScreen's identical pair of effects/logFogOfWarGameStart's and
  // logFogOfWarPly's own doc comments (diagnosticLog.ts, reachable via More > Diagnostics): never
  // shown in gameplay UI. Logs BOTH seats' perspectives every ply (not just "the current turn"),
  // since Local is hotseat — either side might be the one who later spots something that looks
  // wrong, long after it was actually their turn to look.
  useEffect(() => {
    if (!fogOfWar) return;
    logFogOfWarGameStart('LocalGame', initialFen, chess960);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fogOfWar, resetCount]);

  useEffect(() => {
    if (!fogOfWar || history.length === 0) return;
    const entry = history[history.length - 1];
    const mover: PieceColor = (history.length - 1) % 2 === 0 ? 'w' : 'b';
    logFogOfWarPly({
      ply: history.length,
      mover,
      san: entry.move.san,
      to: entry.move.to,
      perspectives: (['w', 'b'] as const).map((color) => ({
        label: `visibleTo(${color})`,
        revealed: fogRedactedByColor[color][fogRedactedByColor[color].length - 1]?.revealed ?? false,
        visible: getVisibleSquares(engine, color),
      })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fogOfWar, history.length]);

  // See BotGameScreen's identical effect — fires once per game, resetting when gameOver next
  // goes back to false (the next "New Game").
  const gameEndHapticFired = useRef(false);
  useEffect(() => {
    if (gameOver && !gameEndHapticFired.current) {
      gameEndHapticFired.current = true;
      triggerGameEndHaptics();
    } else if (!gameOver) {
      gameEndHapticFired.current = false;
    }
  }, [gameOver]);

  const savePayload = useMemo(
    () =>
      buildGamePayload({
        chessStatus,
        turn,
        timeoutWinner: clock.timeoutWinner,
        resignedBy,
        drawnByAgreement: drawAgreed,
        kingOfTheHillWinner,
        threeCheckWinner,
        fogOfWarWinner,
        history,
        initialFen,
        chess960,
        timeControl,
        opponentType: 'human',
        opponentElo: null,
      }),
    [
      chessStatus,
      turn,
      clock.timeoutWinner,
      resignedBy,
      drawAgreed,
      kingOfTheHillWinner,
      threeCheckWinner,
      fogOfWarWinner,
      history,
      initialFen,
      chess960,
      timeControl,
    ]
  );
  useSaveGameOnEnd(authToken, resetCount, savePayload);

  const { whiteCaptured, blackCaptured } = useMemo(
    () => computeCapturedMaterial(history.map((h, i) => ({ captured: h.move.captured, moverColor: i % 2 === 0 ? 'w' : 'b' }))),
    [history]
  );
  const materialDiff = materialValue(whiteCaptured) - materialValue(blackCaptured);

  const turnLabel = turn === 'w' ? 'White' : 'Black';
  const winnerLabel = turn === 'w' ? 'Black' : 'White';

  let statusText = `${turnLabel} to move`;
  // Fog of War never announces check/checkmate/stalemate/draw at all (rule: no such concept) —
  // chessStatus is still computed above (ChessBoard needs it for other things), just never
  // surfaced here in this mode.
  if (!fogOfWar && chessStatus === 'check') statusText = `${turnLabel} to move — Check!`;
  if (!fogOfWar && chessStatus === 'checkmate') statusText = `Checkmate! Winner: ${winnerLabel}`;
  if (!fogOfWar && chessStatus === 'stalemate') statusText = 'Draw (Stalemate)';
  if (!fogOfWar && chessStatus === 'draw') statusText = 'Draw';
  if (clock.timeoutWinner) statusText = `Win on time: ${clock.timeoutWinner === 'w' ? 'White' : 'Black'}`;
  if (resignedBy) statusText = `${resignedBy === 'w' ? 'White' : 'Black'} resigned — ${resignedBy === 'w' ? 'Black' : 'White'} wins`;
  if (drawAgreed) statusText = 'Draw by agreement';
  if (kingOfTheHillWinner) statusText = `${kingOfTheHillWinner === 'w' ? 'White' : 'Black'} wins by King of the Hill!`;
  if (threeCheckWinner) statusText = `${threeCheckWinner === 'w' ? 'White' : 'Black'} wins by Three-Check!`;
  if (fogOfWarWinner) statusText = `${fogOfWarWinner === 'w' ? 'White' : 'Black'} wins by capturing the king!`;

  // No personal point of view here (two players share one device) — matches the plain
  // White/Black wording `statusText` above already uses.
  const outcome = getGameOutcome(
    chessStatus,
    turn,
    clock.timeoutWinner,
    resignedBy,
    drawAgreed,
    kingOfTheHillWinner,
    threeCheckWinner,
    fogOfWarWinner
  );
  const summaryTitle = !outcome.over ? '' : outcome.result === '1/2-1/2' ? 'Draw' : outcome.result === '1-0' ? 'White Won' : 'Black Won';
  const summarySubtitle = outcome.over ? describeEndReason(outcome.reason) : '';

  // Memoized — passed straight through to ChessBoard (now React.memo'd), so a reference that
  // changes every render (as a plain inline function would) would force the whole board to
  // re-render on every clock tick regardless of whether the position actually changed.
  const handleMove = useCallback(
    (move: Move, newFen: string) => {
      if (viewIndex !== null) return;
      clock.applyIncrement(turn);
      playMoveSound(move);
      triggerMoveHaptics(move);
      setHistory((h) => [...h, { move, fenBefore: fen, fenAfter: newFen }]);
      setLastMove(move);
      setFen(newFen);
      setHintText(null);
      if (fogOfWar) {
        const winner = getFogOfWarWinner(move, turn);
        if (winner) setFogOfWarWinner(winner);
        else setAwaitingPass(true);
      }
    },
    [viewIndex, clock.applyIncrement, turn, fen, fogOfWar]
  );

  const handleReset = () => {
    const nextInitialFen = initialFenProp ?? (chess960 ? generateChess960Position() : START_FEN);
    setInitialFen(nextInitialFen);
    setFen(nextInitialFen);
    setLastMove(null);
    setHistory([]);
    setResetCount((c) => c + 1);
    setOpeningName(null);
    setResignedBy(null);
    setDrawAgreed(false);
    setHintText(null);
    setShowOptions(false);
    setViewIndex(null);
    setFogOfWarWinner(null);
    setAwaitingPass(false);
    clock.reset();
  };

  const handleResign = () => {
    if (gameOver || awaitingPass) return;
    setShowOptions(false);
    appAlert(`${turnLabel} resigns?`, 'This ends the game as a loss.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Resign', style: 'destructive', onPress: () => setResignedBy(turn) },
    ]);
  };

  // A hotseat "draw by agreement" doesn't need any handshake — both players are looking at the
  // same screen, so a single confirmation (asked from whoever taps the button) stands in for
  // both sides agreeing, the same way OnlineGameScreen's draw offer needs the other side's
  // explicit accept but there's no "other side" to ask here.
  const handleDrawOffer = () => {
    if (gameOver || awaitingPass) return;
    setShowOptions(false);
    appAlert('Draw by agreement?', 'Both players agree to end the game as a draw.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Agree to Draw', onPress: () => setDrawAgreed(true) },
    ]);
  };

  const handleUndo = () => {
    if (gameOver || history.length === 0 || isReviewing || awaitingPass) return;
    const previous = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setFen(previous.fenBefore);
    setLastMove(history.length >= 2 ? history[history.length - 2].move : null);
    setOpeningName(null);
    setHintText(null);
  };

  // Hints read the true, full position via the local hint engine — handing the player a hint
  // computed from information Fog of War says they shouldn't have yet would be a straightforward
  // way around the entire variant, so this is disabled outright rather than merely hidden.
  const handleHintPress = () => {
    if (gameOver || hintLoading || isReviewing || fogOfWar) return;
    setHintText(null);
    setHintLoading(true);
    setHintActive(true);
    setHintRequestKey((k) => k + 1);
  };

  // Back/forward-style review purely for local display — tapping a move in the strip never
  // touches `fen`/`history` (the live game), it only changes which position is shown. Tapping
  // the most recent move (or any move once it's the newest) snaps back to live, mirroring
  // OnlineGameScreen's identical Forward-to-live behavior.
  const positions = useMemo(() => [initialFen, ...history.map((h) => h.fenAfter)], [initialFen, history]);
  const isReviewing = viewIndex !== null;
  const displayFen = isReviewing ? positions[viewIndex as number] : fen;
  const selectedMoveIndex = isReviewing ? (viewIndex as number) - 1 : history.length - 1;
  const displayLastMove = selectedMoveIndex >= 0 ? history[selectedMoveIndex].move : null;

  // Disabled entirely in Fog of War — scrubbing back would show `positions`' real, unredacted
  // fenAfter snapshots, which would hand either player the exact true position at any past point
  // in the game, defeating the whole variant.
  const handleSelectMove = (index: number) => {
    if (fogOfWar) return;
    const next = index + 1;
    setViewIndex(next >= positions.length - 1 ? null : next);
  };

  // Fog of War move-list/footer text — redacted per the CURRENT device-holder's own visibility
  // (see fogRedactedHistory above); "?" stands in for a move they never actually witnessed.
  const fogMoveListMoves = fogRedactedHistory?.map((entry) => ({ san: entry.revealed ? entry.san : '?' })) ?? [];
  const lastMoveSanDisplay = lastMoveRevealed ? lastMove?.san : '???';

  // Flipping the board also swaps which player's clock/captured-pieces row sits on top vs
  // bottom, so each row always stays next to "its own" side of the board.
  const topColor: PieceColor = flipped ? 'w' : 'b';
  const bottomColor: PieceColor = flipped ? 'b' : 'w';
  const playerInfo = (color: PieceColor) => ({
    captured: color === 'w' ? whiteCaptured : blackCaptured,
    iconColor: (color === 'w' ? 'b' : 'w') as PieceColor,
    advantage: color === 'w' ? (materialDiff > 0 ? materialDiff : 0) : materialDiff < 0 ? -materialDiff : 0,
  });
  const top = playerInfo(topColor);
  const bottom = playerInfo(bottomColor);

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Chess — Local Game"
        subtitle={
          chess960
            ? 'Chess960'
            : kingOfTheHill
              ? 'King of the Hill'
              : threeCheck
                ? 'Three-Check'
                : setupChess
                  ? 'Setup Chess'
                  : fogOfWar
                    ? 'Fog of War'
                    : undefined
        }
        onBack={onExit}
        backLabel="‹ Menu"
      />
      <MoveListStrip
        moves={fogOfWar ? fogMoveListMoves : history.map((h) => ({ san: h.move.san }))}
        selectedIndex={selectedMoveIndex}
        autoScroll={!isReviewing}
        onSelectMove={handleSelectMove}
      />
      <GameScreenBody
        bottomBar={
          <>
            <View style={styles.controlsWrap}>
              <GameControlBar
                items={[
                  { key: 'options', label: 'Options', onPress: () => setShowOptions((v) => !v), active: showOptions },
                  { key: 'resign', label: 'Resign', onPress: handleResign, disabled: gameOver || awaitingPass },
                  { key: 'draw', label: 'Draw', onPress: handleDrawOffer, disabled: gameOver || awaitingPass },
                  { key: 'hint', label: 'Hint', onPress: handleHintPress, disabled: gameOver || hintLoading || isReviewing || fogOfWar },
                  {
                    key: 'undo',
                    label: 'Undo',
                    onPress: handleUndo,
                    disabled: gameOver || history.length === 0 || isReviewing || awaitingPass,
                  },
                ]}
              />
              <GameOptionsMenu
                visible={showOptions}
                items={[{ label: 'Flip Board', onPress: () => setFlipped((v) => !v) }]}
              />
            </View>

            <View style={styles.footer}>
              {lastMove && !awaitingPass && <Text style={styles.lastMove}>Last move: {lastMoveSanDisplay}</Text>}
              <View style={styles.footerButtons}>
                <Pressable style={styles.resetButton} onPress={handleReset}>
                  <Text style={styles.resetButtonText}>New Game</Text>
                </Pressable>
              </View>
            </View>
          </>
        }
      >
        <Text style={styles.timeControlLabel}>{timeControl.label}</Text>

        {fogOfWar && awaitingPass && !gameOver ? (
          <View style={styles.passContainer}>
            <Text style={styles.passTitle}>{turnLabel}'s turn</Text>
            <Text style={styles.passMessage}>Pass the device to {turnLabel}, then continue.</Text>
            <Pressable style={styles.continueButton} onPress={() => setAwaitingPass(false)}>
              <Text style={styles.continueButtonText}>{turnLabel} is ready — Continue</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {!gameOver && <Text style={styles.status}>{statusText}</Text>}
            {isReviewing && <Text style={styles.reviewingText}>Reviewing move history (not live)</Text>}

            {hintActive && (
              <StockfishBridge ref={handleHintBridgeRef} onLine={handleHintBridgeLine} html={hintRuntime.buildHtml()} />
            )}

            <View style={styles.playerRow}>
              <Text style={[styles.clock, turn === topColor && !gameOver && styles.clockActive]}>
                {topColor === 'w' ? 'White' : 'Black'}
                {clock.hasClock ? `: ${formatTime(topColor === 'w' ? clock.whiteSeconds : clock.blackSeconds)}` : ''}
                {checkCounts ? ` · Checks: ${checkCounts[topColor]}/${THREE_CHECK_TARGET}` : ''}
              </Text>
              <CapturedPieces pieces={top.captured} color={top.iconColor} advantage={top.advantage} />
            </View>

            {!chess960 && !setupChess && !fogOfWar && openingName && <Text style={styles.openingName}>{openingName}</Text>}

            <ChessBoard
              key={resetCount}
              fen={displayFen}
              onMove={handleMove}
              disabled={gameOver || isReviewing}
              chess960={chess960}
              initialFen={initialFen}
              orientation={flipped ? 'b' : 'w'}
              lastMove={displayLastMove}
              enableAnnotations
              kingOfTheHill={kingOfTheHill}
              fogOfWar={fogOfWar}
              visibleSquares={visibleSquares}
            />

            <View style={styles.playerRow}>
              <Text style={[styles.clock, turn === bottomColor && !gameOver && styles.clockActive]}>
                {bottomColor === 'w' ? 'White' : 'Black'}
                {clock.hasClock ? `: ${formatTime(bottomColor === 'w' ? clock.whiteSeconds : clock.blackSeconds)}` : ''}
                {checkCounts ? ` · Checks: ${checkCounts[bottomColor]}/${THREE_CHECK_TARGET}` : ''}
              </Text>
              <CapturedPieces pieces={bottom.captured} color={bottom.iconColor} advantage={bottom.advantage} />
            </View>

            {hintLoading && <Text style={styles.hintText}>Thinking of a hint...</Text>}
            {!hintLoading && hintText && <Text style={styles.hintText}>Hint: {hintText}</Text>}
          </>
        )}
      </GameScreenBody>

      <PostGameSummaryModal
        visible={gameOver}
        title={summaryTitle}
        subtitle={summarySubtitle}
        initialFen={initialFen}
        chess960={chess960}
        fogOfWar={fogOfWar}
        history={history}
        players={[
          { label: 'White', color: 'w' },
          { label: 'Black', color: 'b' },
        ]}
        onGameReview={() => onAnalyze({ initialFen, chess960, fogOfWar, history })}
        onRematch={handleReset}
        onNewGame={onExit}
      />
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    passContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      paddingVertical: 60,
      gap: 14,
    },
    passTitle: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.text,
    },
    passMessage: {
      fontSize: 16,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    continueButton: {
      marginTop: 10,
      paddingVertical: 14,
      paddingHorizontal: 24,
      backgroundColor: colors.buttonBackground,
      borderRadius: 10,
    },
    continueButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
    },
    timeControlLabel: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    status: {
      fontSize: 16,
      color: colors.text,
    },
    openingName: {
      fontSize: 12,
      fontStyle: 'italic',
      color: colors.textSecondary,
      textAlign: 'center',
      maxWidth: 320,
    },
    reviewingText: {
      fontSize: 12,
      fontStyle: 'italic',
      color: colors.gold,
    },
    playerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    hintText: {
      fontSize: 13,
      fontStyle: 'italic',
      color: colors.accent,
    },
    controlsWrap: {
      alignItems: 'center',
      gap: 8,
    },
    clock: {
      fontSize: 20,
      fontVariant: ['tabular-nums'],
      color: colors.text,
      paddingVertical: 4,
      paddingHorizontal: 14,
      borderRadius: 6,
    },
    clockActive: {
      fontWeight: '700',
      color: '#fff',
      backgroundColor: colors.buttonBackground,
    },
    footer: {
      marginTop: 16,
      alignItems: 'center',
      gap: 8,
    },
    lastMove: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    footerButtons: {
      flexDirection: 'row',
      gap: 10,
    },
    resetButton: {
      paddingVertical: 10,
      paddingHorizontal: 24,
      backgroundColor: colors.buttonBackground,
      borderRadius: 8,
    },
    resetButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
  });
}
