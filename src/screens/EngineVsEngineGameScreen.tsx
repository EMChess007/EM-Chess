import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { getBotThinkTimeMs } from '../logic/bots';
import { generateChess960Position } from '../logic/chess960';
import { ChessEngine } from '../logic/ChessEngine';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { getBotStrengthOptions, getEngineIdForElo } from '../logic/engines';
import { describeEndReason } from '../logic/gameOutcomeText';
import { getGameOutcome } from '../logic/gameResult';
import { getKingOfTheHillWinner } from '../logic/kingOfTheHill';
import { computeCapturedMaterial, materialValue } from '../logic/material';
import { playMoveSound } from '../logic/moveSounds';
import { lookupOpening } from '../logic/openings';
import { THREE_CHECK_TARGET, getThreeCheckCounts, getThreeCheckWinner } from '../logic/threeCheck';
import { formatTime } from '../logic/time';
import { parseUciMove } from '../logic/uciMove';
import { useChessClock } from '../logic/useChessClock';
import { START_FEN } from '../types/chess';
import type { ColorChoice, Move, PieceColor } from '../types/chess';
import type { BotPersonality } from '../types/bot';
import type { AnalyzeParams, GameHistoryEntry } from '../types/history';
import type { TimeControl } from '../types/timeControl';

// A stable, module-level reference — this screen never lets ChessBoard actually apply a move
// (it's purely a display of the two engines' own play), but a fresh `() => {}` literal passed
// inline every render would still break ChessBoard's React.memo just like a changing handler
// would.
const noopMove = () => {};

interface EngineVsEngineGameScreenProps {
  engine1: BotPersonality;
  engine2: BotPersonality;
  timeControl: TimeControl;
  chess960?: boolean;
  kingOfTheHill?: boolean;
  threeCheck?: boolean;
  colorChoice1?: ColorChoice;
  colorChoice2?: ColorChoice;
  onExit: () => void;
  onAnalyze: (params: AnalyzeParams) => void;
}

// Resolves the two (possibly 'random') color choices into an actual, guaranteed-opposite pair —
// EngineVsEngineSetupScreen's UI already prevents both being the same explicit color, so the only
// three real cases are: both random (coin flip), one explicit (the other gets whatever's left),
// or both explicit (already opposite, so either branch below reaches the same answer).
function resolveColors(color1: ColorChoice, color2: ColorChoice): { c1: PieceColor; c2: PieceColor } {
  if (color1 !== 'random') {
    const c1 = color1;
    return { c1, c2: c1 === 'w' ? 'b' : 'w' };
  }
  if (color2 !== 'random') {
    const c2 = color2;
    return { c1: c2 === 'w' ? 'b' : 'w', c2 };
  }
  const c1: PieceColor = Math.random() < 0.5 ? 'w' : 'b';
  return { c1, c2: c1 === 'w' ? 'b' : 'w' };
}

export default function EngineVsEngineGameScreen({
  engine1,
  engine2,
  timeControl,
  chess960 = false,
  kingOfTheHill = false,
  threeCheck = false,
  colorChoice1 = 'random',
  colorChoice2 = 'random',
  onExit,
  onAnalyze,
}: EngineVsEngineGameScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  // Resolved once per screen mount, same as BotGameScreen's userColor — fixed for this game's
  // whole lifetime, including any "New Game" resets.
  const [{ c1, c2 }] = useState(() => resolveColors(colorChoice1, colorChoice2));

  const engineId1 = useMemo(() => engine1.engineId ?? getEngineIdForElo(engine1.elo), [engine1.engineId, engine1.elo]);
  const engineId2 = useMemo(() => engine2.engineId ?? getEngineIdForElo(engine2.elo), [engine2.engineId, engine2.elo]);
  // If both engines resolve to the same underlying build (e.g. two different ELOs that both map
  // to the classical engine), reuse one runtime/bridge instead of mounting two WebViews pointed
  // at the same engine — moves are always sequential (never concurrent) regardless, same as how
  // BotGameScreen safely reuses one engine instance for both its own moves and hints.
  const sameEngine = engineId1 === engineId2;
  const runtime1 = useMemo(() => getEngineRuntime(engineId1), [engineId1]);
  const runtime2 = useMemo(() => (sameEngine ? runtime1 : getEngineRuntime(engineId2)), [sameEngine, runtime1, engineId2]);

  const [initialFen, setInitialFen] = useState(() => (chess960 ? generateChess960Position() : START_FEN));
  const [fen, setFen] = useState(initialFen);
  const [lastMove, setLastMove] = useState<Move | null>(null);
  const [history, setHistory] = useState<GameHistoryEntry[]>([]);
  const [thinking, setThinking] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [resetCount, setResetCount] = useState(0);
  const [openingName, setOpeningName] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [viewIndex, setViewIndex] = useState<number | null>(null); // null = live position

  useEffect(() => {
    if (chess960) return;
    const match = lookupOpening(fen);
    if (match) setOpeningName(match.name);
  }, [fen, chess960]);

  const engine = useMemo(
    () => new ChessEngine(fen, { chess960, initialFen }),
    [fen, chess960, initialFen]
  );
  const turn = engine.getTurn();
  const chessStatus = engine.getStatus();
  // Chess.js has no idea this rule exists — checked independently, only when actually playing
  // this variant (see kingOfTheHill.ts).
  const kingOfTheHillWinner = kingOfTheHill ? getKingOfTheHillWinner(engine) : null;
  // Derived from `history` (see threeCheck.ts) rather than separately tracked state.
  const historyMoves = useMemo(() => history.map((h) => h.move), [history]);
  const threeCheckWinner = threeCheck ? getThreeCheckWinner(historyMoves) : null;
  const checkCounts = threeCheck ? getThreeCheckCounts(historyMoves) : null;

  // Auto-tick runs for whichever engine's turn it is, so its clock counts down live, second by
  // second, in real wall-clock time while it "thinks" (each engine really does take
  // approximately thinkTimeMs to respond) — same mechanism as a human's clock.
  const clock = useChessClock(timeControl, turn, engine.isGameOver());
  const gameOver =
    engine.isGameOver() || clock.timeoutWinner !== null || stopped || kingOfTheHillWinner !== null || threeCheckWinner !== null;

  const bridgeRef1 = useRef<StockfishBridgeHandle>(null);
  const handleBridgeRef1 = useCallback(
    (handle: StockfishBridgeHandle | null) => {
      bridgeRef1.current = handle;
      runtime1.engine.attachBridge(handle);
    },
    [runtime1]
  );
  const handleEngineLine1 = useCallback((line: string) => runtime1.engine.handleLine(line), [runtime1]);

  const bridgeRef2 = useRef<StockfishBridgeHandle>(null);
  const handleBridgeRef2 = useCallback(
    (handle: StockfishBridgeHandle | null) => {
      bridgeRef2.current = handle;
      runtime2.engine.attachBridge(handle);
    },
    [runtime2]
  );
  const handleEngineLine2 = useCallback((line: string) => runtime2.engine.handleLine(line), [runtime2]);

  // Drives BOTH sides — unlike BotGameScreen's identical effect, there's no "only when it's the
  // bot's turn" guard, since every turn here is engine-driven.
  useEffect(() => {
    if (gameOver) return;

    const isEngine1Turn = turn === c1;
    const activeBot = isEngine1Turn ? engine1 : engine2;
    const activeRuntime = isEngine1Turn ? runtime1 : runtime2;

    let cancelled = false;
    setThinking(true);
    setEngineError(null);

    (async () => {
      try {
        await activeRuntime.engine.initEngine();
        activeRuntime.engine.setPosition(fen);

        const thinkTimeMs = getBotThinkTimeMs({
          timeControl,
          remainingSeconds: turn === 'w' ? clock.whiteSeconds : clock.blackSeconds,
          legalMoveCount: engine.getLegalMoveCount(),
        });

        const uciMove = await activeRuntime.engine.getBestMove({
          ...getBotStrengthOptions(activeBot.elo),
          movetimeMs: thinkTimeMs,
        });
        if (cancelled) return;

        const parsed = parseUciMove(uciMove);
        if (!parsed) throw new Error(`Unrecognized move from engine: "${uciMove}"`);

        const moveEngine = new ChessEngine(fen, { chess960, initialFen });
        const move = moveEngine.move(parsed.from, parsed.to, parsed.promotion);
        if (!move) throw new Error(`Invalid move from engine: "${uciMove}"`);
        if (cancelled) return;

        // The mover's clock was already ticking down live via auto-tick while it "thought" (see
        // the useChessClock call above) — only the post-move increment still needs applying here.
        clock.applyIncrement(turn);
        playMoveSound(move);
        setHistory((h) => [...h, { move, fenBefore: fen, fenAfter: moveEngine.getFen() }]);
        setLastMove(move);
        setFen(moveEngine.getFen());
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          console.log('[EngineVsEngineGame] engine error:', message);
          setEngineError(message);
        }
      } finally {
        if (!cancelled) setThinking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // engine1/engine2/runtime1/runtime2/c1/timeControl are stable for this screen's lifetime;
    // fen+gameOver are the real triggers — same pattern as BotGameScreen's identical effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, gameOver]);

  const { whiteCaptured, blackCaptured } = useMemo(
    () => computeCapturedMaterial(history.map((h, i) => ({ captured: h.move.captured, moverColor: i % 2 === 0 ? 'w' : 'b' }))),
    [history]
  );
  const materialDiff = materialValue(whiteCaptured) - materialValue(blackCaptured);

  const turnLabel = turn === c1 ? engine1.name : engine2.name;
  const winnerLabel = turn === c1 ? engine2.name : engine1.name;

  let statusText = `Turn: ${turnLabel}`;
  if (chessStatus === 'check') statusText = `Turn: ${turnLabel} — Check!`;
  if (chessStatus === 'checkmate') statusText = `Checkmate! Winner: ${winnerLabel}`;
  if (chessStatus === 'stalemate') statusText = 'Draw (Stalemate)';
  if (chessStatus === 'draw') statusText = 'Draw';
  if (clock.timeoutWinner) {
    statusText = `Win on time: ${clock.timeoutWinner === c1 ? engine1.name : engine2.name}`;
  }
  if (stopped) statusText = 'Game stopped.';
  if (kingOfTheHillWinner) {
    statusText = `${kingOfTheHillWinner === c1 ? engine1.name : engine2.name} wins by King of the Hill!`;
  }
  if (threeCheckWinner) {
    statusText = `${threeCheckWinner === c1 ? engine1.name : engine2.name} wins by Three-Check!`;
  }

  const outcome = getGameOutcome(chessStatus, turn, clock.timeoutWinner, null, false, kingOfTheHillWinner, threeCheckWinner);
  const outcomeWinnerColor: PieceColor | null =
    outcome.over && outcome.result !== '1/2-1/2' ? (outcome.result === '1-0' ? 'w' : 'b') : null;
  const summaryTitle = stopped
    ? 'Game Stopped'
    : !outcome.over
      ? ''
      : outcome.result === '1/2-1/2'
        ? 'Draw'
        : `${outcomeWinnerColor === c1 ? engine1.name : engine2.name} Won`;
  const summarySubtitle = stopped ? '' : outcome.over ? describeEndReason(outcome.reason) : '';

  const handleReset = () => {
    const nextInitialFen = chess960 ? generateChess960Position() : START_FEN;
    setInitialFen(nextInitialFen);
    setFen(nextInitialFen);
    setLastMove(null);
    setHistory([]);
    setEngineError(null);
    setResetCount((c) => c + 1);
    setOpeningName(null);
    setStopped(false);
    setShowOptions(false);
    setViewIndex(null);
    clock.reset();
  };

  const handleStop = () => {
    if (gameOver) return;
    setShowOptions(false);
    setStopped(true);
  };

  const positions = useMemo(() => [initialFen, ...history.map((h) => h.fenAfter)], [initialFen, history]);
  const isReviewing = viewIndex !== null;
  const displayFen = isReviewing ? positions[viewIndex as number] : fen;
  const selectedMoveIndex = isReviewing ? (viewIndex as number) - 1 : history.length - 1;
  const displayLastMove = selectedMoveIndex >= 0 ? history[selectedMoveIndex].move : null;

  const handleSelectMove = (index: number) => {
    const next = index + 1;
    setViewIndex(next >= positions.length - 1 ? null : next);
  };

  // No "human side" to anchor orientation to — White sits at the bottom by default, same neutral
  // convention as LocalGameScreen, with Flip Board available exactly the same way.
  const topColor: PieceColor = flipped ? 'w' : 'b';
  const bottomColor: PieceColor = flipped ? 'b' : 'w';
  const playerInfo = (color: PieceColor) => ({
    label: color === c1 ? engine1.name : engine2.name,
    seconds: color === 'w' ? clock.whiteSeconds : clock.blackSeconds,
    captured: color === 'w' ? whiteCaptured : blackCaptured,
    iconColor: (color === 'w' ? 'b' : 'w') as PieceColor,
    advantage: color === 'w' ? (materialDiff > 0 ? materialDiff : 0) : materialDiff < 0 ? -materialDiff : 0,
    checks: checkCounts ? checkCounts[color] : null,
  });
  const top = playerInfo(topColor);
  const bottom = playerInfo(bottomColor);

  return (
    <View style={styles.container}>
      <StockfishBridge ref={handleBridgeRef1} onLine={handleEngineLine1} html={runtime1.buildHtml()} />
      {!sameEngine && <StockfishBridge ref={handleBridgeRef2} onLine={handleEngineLine2} html={runtime2.buildHtml()} />}
      <ScreenHeader
        title="Chess — Engine vs Engine"
        subtitle={chess960 ? 'Chess960' : kingOfTheHill ? 'King of the Hill' : threeCheck ? 'Three-Check' : undefined}
        onBack={onExit}
        backLabel="‹ Menu"
      />
      <MoveListStrip
        moves={history.map((h) => ({ san: h.move.san }))}
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
                  { key: 'stop', label: 'Stop', onPress: handleStop, disabled: gameOver },
                ]}
              />
              <GameOptionsMenu
                visible={showOptions}
                items={[{ label: 'Flip Board', onPress: () => setFlipped((v) => !v) }]}
              />
            </View>

            <View style={styles.footer}>
              {lastMove && <Text style={styles.lastMove}>Last move: {lastMove.san}</Text>}
              <View style={styles.footerButtons}>
                <Pressable style={styles.resetButton} onPress={handleReset}>
                  <Text style={styles.resetButtonText}>New Game</Text>
                </Pressable>
              </View>
            </View>
          </>
        }
      >
        <Text style={styles.subtitle}>
          {engine1.name} (ELO {engine1.elo}, {c1 === 'w' ? 'White' : 'Black'}) vs {engine2.name} (ELO {engine2.elo},{' '}
          {c2 === 'w' ? 'White' : 'Black'}) · {timeControl.label}
        </Text>
        <Text style={[styles.status, (chessStatus === 'checkmate' || clock.timeoutWinner || stopped) && styles.statusOver]}>
          {statusText}
        </Text>
        {isReviewing && <Text style={styles.reviewingText}>Reviewing move history (not live)</Text>}
        {thinking && (
          <View style={styles.thinkingRow}>
            <ActivityIndicator size="small" color={colors.text} />
            <Text style={styles.thinkingText}>{turnLabel} is thinking...</Text>
          </View>
        )}
        {engineError && <Text style={styles.errorText}>Engine error: {engineError}</Text>}

        <View style={styles.playerRow}>
          <Text style={[styles.clock, turn === topColor && !gameOver && styles.clockActive]}>
            {top.label}{clock.hasClock ? `: ${formatTime(top.seconds)}` : ''}
            {top.checks !== null ? ` · Checks: ${top.checks}/${THREE_CHECK_TARGET}` : ''}
          </Text>
          <CapturedPieces pieces={top.captured} color={top.iconColor} advantage={top.advantage} />
        </View>

        {!chess960 && openingName && <Text style={styles.openingName}>{openingName}</Text>}

        <ChessBoard
          key={resetCount}
          fen={displayFen}
          onMove={noopMove}
          disabled
          chess960={chess960}
          initialFen={initialFen}
          orientation={flipped ? 'b' : 'w'}
          lastMove={displayLastMove}
          kingOfTheHill={kingOfTheHill}
        />

        <View style={styles.playerRow}>
          <Text style={[styles.clock, turn === bottomColor && !gameOver && styles.clockActive]}>
            {bottom.label}{clock.hasClock ? `: ${formatTime(bottom.seconds)}` : ''}
            {bottom.checks !== null ? ` · Checks: ${bottom.checks}/${THREE_CHECK_TARGET}` : ''}
          </Text>
          <CapturedPieces pieces={bottom.captured} color={bottom.iconColor} advantage={bottom.advantage} />
        </View>
      </GameScreenBody>

      <PostGameSummaryModal
        visible={gameOver}
        title={summaryTitle}
        subtitle={summarySubtitle}
        initialFen={initialFen}
        chess960={chess960}
        history={history}
        players={[
          { label: engine1.name, color: c1 },
          { label: engine2.name, color: c2 },
        ]}
        onGameReview={() => onAnalyze({ initialFen, chess960, fogOfWar: false, history })}
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
    subtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
      maxWidth: 340,
    },
    status: {
      fontSize: 16,
      color: colors.text,
    },
    statusOver: {
      fontWeight: '700',
      color: colors.danger,
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
    thinkingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    thinkingText: {
      fontSize: 14,
      color: colors.text,
      fontStyle: 'italic',
    },
    errorText: {
      fontSize: 13,
      color: colors.danger,
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
