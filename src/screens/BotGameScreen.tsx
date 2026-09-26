import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSaveGameOnEnd } from '../api/useSaveGameOnEnd';
import { appAlert } from '../components/AppAlert';
import CapturedPieces from '../components/CapturedPieces';
import ChessBoard, { type PremoveIntent } from '../components/ChessBoard';
import GameControlBar from '../components/GameControlBar';
import GameOptionsMenu from '../components/GameOptionsMenu';
import GameScreenBody from '../components/GameScreenBody';
import MoveListStrip from '../components/MoveListStrip';
import PostGameSummaryModal from '../components/PostGameSummaryModal';
import ScreenHeader from '../components/ScreenHeader';
import { getEngineRuntime } from '../engine/engineRegistry';
import StockfishBridge, { type StockfishBridgeHandle } from '../engine/StockfishBridge';
import { unlockAchievement } from '../logic/achievementStorage';
import { getBotThinkTimeMs } from '../logic/bots';
import { generateChess960Position } from '../logic/chess960';
import { ChessEngine } from '../logic/ChessEngine';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { getBotStrengthOptions, getEngineIdForElo, getEngineName } from '../logic/engines';
import { buildGamePayload } from '../logic/gamePayload';
import { getGameOutcome } from '../logic/gameResult';
import { describeEndReason } from '../logic/gameOutcomeText';
import { triggerGameEndHaptics, triggerMoveHaptics } from '../logic/haptics';
import { computeCapturedMaterial, materialValue } from '../logic/material';
import { playMoveSound } from '../logic/moveSounds';
import { lookupOpening } from '../logic/openings';
import { toRatingCategory } from '../logic/rating';
import { recordRatedGame } from '../logic/ratingStorage';
import { formatTime } from '../logic/time';
import { parseUciMove, uciMoveToSan } from '../logic/uciMove';
import { useChessClock } from '../logic/useChessClock';
import { START_FEN } from '../types/chess';
import type { ColorChoice, Move, PieceColor } from '../types/chess';
import type { BotPersonality } from '../types/bot';
import type { AnalyzeParams, GameHistoryEntry } from '../types/history';
import type { TimeControl } from '../types/timeControl';

interface BotGameScreenProps {
  bot: BotPersonality;
  timeControl: TimeControl;
  chess960?: boolean;
  colorChoice?: ColorChoice;
  authToken: string | null;
  onExit: () => void;
  onAnalyze: (params: AnalyzeParams) => void;
}

export default function BotGameScreen({
  bot,
  timeControl,
  chess960 = false,
  colorChoice = 'random',
  authToken,
  onExit,
  onAnalyze,
}: BotGameScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  // Resolved once per screen mount (a fixed value for this game's whole lifetime, including any
  // "New Game" resets) — 'random' is a one-time coin flip made when the player enters the game,
  // not re-rolled on every render.
  const [userColor] = useState<PieceColor>(() =>
    colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colorChoice
  );
  const botColor: PieceColor = userColor === 'w' ? 'b' : 'w';
  // Which engine plays this bot is decided automatically from its ELO (see getEngineIdForElo)
  // — not something the player picks — so weaker bots feel authentically weak (a genuinely
  // simpler classical engine) rather than a strong engine artificially dialed down. The one
  // exception is a synthetic "custom engine" bot card (see BotSelectScreen), which sets
  // `engineId` explicitly to override this.
  const engineId = useMemo(() => bot.engineId ?? getEngineIdForElo(bot.elo), [bot.engineId, bot.elo]);
  const [initialFen, setInitialFen] = useState(() => (chess960 ? generateChess960Position() : START_FEN));
  const [fen, setFen] = useState(initialFen);
  const [lastMove, setLastMove] = useState<Move | null>(null);
  const [history, setHistory] = useState<GameHistoryEntry[]>([]);
  const [botThinking, setBotThinking] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [resetCount, setResetCount] = useState(0);
  const [openingName, setOpeningName] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [resignedBy, setResignedBy] = useState<PieceColor | null>(null);
  const [hintText, setHintText] = useState<string | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [hintRequestKey, setHintRequestKey] = useState(0);
  const [viewIndex, setViewIndex] = useState<number | null>(null); // null = live position

  // See LocalGameScreen's identical effect for why a miss here doesn't clear the name — it only
  // ever upgrades to a deeper/more specific match as the game continues.
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

  // Auto-tick runs for whichever side's turn it is — including the bot's — so its clock counts
  // down live, second by second, in real wall-clock time while it "thinks" (the engine really
  // does take approximately thinkTimeMs to respond), exactly like the human side already did.
  const clock = useChessClock(timeControl, turn, engine.isGameOver());
  const gameOver = engine.isGameOver() || clock.timeoutWinner !== null || resignedBy !== null;

  // Fires once per game (not once per re-render while gameOver stays true) — resets itself the
  // moment `gameOver` next goes back to false, i.e. on the next "New Game"/rematch.
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
        history,
        initialFen,
        chess960,
        timeControl,
        opponentType: 'bot',
        opponentElo: bot.elo,
      }),
    [chessStatus, turn, clock.timeoutWinner, resignedBy, history, initialFen, chess960, timeControl, bot.elo]
  );
  useSaveGameOnEnd(authToken, resetCount, savePayload);

  // Resolves to the engine instance + bridge HTML for whichever UciChessEngine was picked in
  // BotSelectScreen — stable across this screen's lifetime since `engineId` is a prop set once
  // at game start, not something the player can change mid-game.
  const engineRuntime = useMemo(() => getEngineRuntime(engineId), [engineId]);

  const bridgeRef = useRef<StockfishBridgeHandle>(null);
  // Memoized so React doesn't treat this as a "new" ref callback on every re-render — a
  // changing ref identity forces a detach+reattach cycle each render, which was resetting the
  // engine's internal ready-state mid-flight (it re-renders often: clock ticks, bot-thinking
  // state, etc).
  const handleBridgeRef = useCallback(
    (handle: StockfishBridgeHandle | null) => {
      bridgeRef.current = handle;
      engineRuntime.engine.attachBridge(handle);
    },
    [engineRuntime]
  );
  const handleEngineLine = useCallback((line: string) => engineRuntime.engine.handleLine(line), [engineRuntime]);

  // Hint reuses the SAME engine instance/bridge already mounted for the bot's own moves — no
  // second scratch engine needed here (unlike LocalGameScreen, which has none wired in at all).
  // This is safe because Hint only ever runs on the user's turn while the bot-move effect below
  // only ever runs on the bot's turn, so the two never talk to the engine at the same time.
  useEffect(() => {
    if (hintRequestKey === 0) return;
    let cancelled = false;
    (async () => {
      try {
        await engineRuntime.engine.initEngine();
        engineRuntime.engine.setPosition(fen);
        const uci = await engineRuntime.engine.getBestMove({ ...getBotStrengthOptions(bot.elo), movetimeMs: 800 });
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

  // Whenever it becomes the bot's turn, ask the engine for a move and play it automatically.
  useEffect(() => {
    if (turn !== botColor || gameOver) return;

    let cancelled = false;
    setBotThinking(true);
    setEngineError(null);
    setHintText(null);

    (async () => {
      try {
        await engineRuntime.engine.initEngine();
        engineRuntime.engine.setPosition(fen);

        // Same think-time logic for every bot personality/ELO and for both classical and
        // Chess960 — this is the only place BotGameScreen asks the engine for a move.
        const thinkTimeMs = getBotThinkTimeMs({
          timeControl,
          remainingSeconds: botColor === 'w' ? clock.whiteSeconds : clock.blackSeconds,
          legalMoveCount: engine.getLegalMoveCount(),
        });

        const uciMove = await engineRuntime.engine.getBestMove({
          ...getBotStrengthOptions(bot.elo),
          movetimeMs: thinkTimeMs,
        });
        if (cancelled) return;

        const parsed = parseUciMove(uciMove);
        if (!parsed) throw new Error(`Unrecognized move from engine: "${uciMove}"`);

        const moveEngine = new ChessEngine(fen, { chess960, initialFen });
        const move = moveEngine.move(parsed.from, parsed.to, parsed.promotion);
        if (!move) throw new Error(`Invalid move from engine: "${uciMove}"`);
        if (cancelled) return;

        // The bot's clock was already ticking down live via auto-tick while it "thought" (see
        // the useChessClock call above) — only the post-move increment still needs applying here.
        clock.applyIncrement(botColor);
        playMoveSound(move);
        triggerMoveHaptics(move);
        setHistory((h) => [...h, { move, fenBefore: fen, fenAfter: moveEngine.getFen() }]);
        setLastMove(move);
        setFen(moveEngine.getFen());
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          console.log('[BotGame] engine error:', message);
          setEngineError(message);
        }
      } finally {
        if (!cancelled) setBotThinking(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();

    return () => {
      cancelled = true;
    };
    // bot/timeControl/engineRuntime are stable for the lifetime of this screen; fen+gameOver are the real triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, gameOver]);

  const { whiteCaptured, blackCaptured } = useMemo(
    () => computeCapturedMaterial(history.map((h, i) => ({ captured: h.move.captured, moverColor: i % 2 === 0 ? 'w' : 'b' }))),
    [history]
  );
  const materialDiff = materialValue(whiteCaptured) - materialValue(blackCaptured);

  // Tracks (without re-rendering) whether the user was ever down 3+ points of material at any
  // point this game, for the 'comeback_win' achievement — checked once the game actually ends,
  // in the rating-update effect below.
  const wasMaterialDownRef = useRef(false);
  useEffect(() => {
    const myAdvantage = userColor === 'w' ? materialDiff : -materialDiff;
    if (myAdvantage <= -3) wasMaterialDownRef.current = true;
  }, [materialDiff, userColor]);

  const turnLabel = turn === userColor ? 'You' : bot.name;
  const winnerLabel = turn === userColor ? bot.name : 'You';

  let statusText = `Turn: ${turnLabel}`;
  if (chessStatus === 'check') statusText = `Turn: ${turnLabel} — Check!`;
  if (chessStatus === 'checkmate') statusText = `Checkmate! Winner: ${winnerLabel}`;
  if (chessStatus === 'stalemate') statusText = 'Draw (Stalemate)';
  if (chessStatus === 'draw') statusText = 'Draw';
  if (clock.timeoutWinner) {
    statusText = `Win on time: ${clock.timeoutWinner === userColor ? 'You' : bot.name}`;
  }
  if (resignedBy) statusText = `You resigned — ${bot.name} wins`;

  const outcome = getGameOutcome(chessStatus, turn, clock.timeoutWinner, resignedBy);
  const winnerColor: PieceColor | null =
    outcome.over && outcome.result !== '1/2-1/2' ? (outcome.result === '1-0' ? 'w' : 'b') : null;
  const summaryTitle = !outcome.over ? '' : outcome.result === '1/2-1/2' ? 'Draw' : winnerColor === userColor ? 'You Won' : 'Bot Won';
  const summarySubtitle = outcome.over ? describeEndReason(outcome.reason) : '';

  // Updates this device's internal per-category rating exactly once per finished game — bullet/
  // blitz/rapid only (daily/unlimited aren't rated, see RATING_CATEGORIES) — using the bot's real,
  // fixed ELO as a genuinely calibrated opponent strength.
  const ratingRecordedRef = useRef(false);
  useEffect(() => {
    if (!outcome.over) {
      ratingRecordedRef.current = false;
      return;
    }
    if (ratingRecordedRef.current) return;
    ratingRecordedRef.current = true;
    const result = outcome.result === '1/2-1/2' ? 0.5 : winnerColor === userColor ? 1 : 0;
    const ratingCategory = toRatingCategory(timeControl.category);
    if (ratingCategory) recordRatedGame(ratingCategory, bot.elo, result);

    if (result === 1) {
      if (bot.elo >= 2000) unlockAchievement('giant_slayer');
      if (wasMaterialDownRef.current) unlockAchievement('comeback_win');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome.over]);

  const handleMove = (move: Move, newFen: string) => {
    if (viewIndex !== null) return;
    clock.applyIncrement(userColor);
    playMoveSound(move);
    triggerMoveHaptics(move);
    setHistory((h) => [...h, { move, fenBefore: fen, fenAfter: newFen }]);
    setLastMove(move);
    setFen(newFen);
    setHintText(null);
  };

  // Premove: queued while the bot is "thinking" (see ChessBoard's premoveColor/onPremove), played
  // automatically via handleMove the instant it's actually the user's turn again — same pattern
  // as OnlineGameScreen's premove, just resolved against the bot's move landing instead of a
  // socket event.
  const [premove, setPremove] = useState<PremoveIntent | null>(null);
  const [premoveInvalid, setPremoveInvalid] = useState(false);

  const handleQueuePremove = (intent: PremoveIntent) => {
    setPremove(intent);
    setPremoveInvalid(false);
  };

  const handleCancelPremove = () => {
    setPremove(null);
    setPremoveInvalid(false);
  };

  useEffect(() => {
    if (!premove || turn !== userColor || gameOver) return;
    setPremove(null);
    const premoveEngine = new ChessEngine(fen, { chess960, initialFen });
    const move = premoveEngine.move(premove.from, premove.to, premove.promotion);
    if (move) {
      handleMove(move, premoveEngine.getFen());
    } else {
      setPremoveInvalid(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, premove]);

  const handleReset = () => {
    const nextInitialFen = chess960 ? generateChess960Position() : START_FEN;
    setInitialFen(nextInitialFen);
    setFen(nextInitialFen);
    setLastMove(null);
    setHistory([]);
    setEngineError(null);
    setResetCount((c) => c + 1);
    setOpeningName(null);
    setResignedBy(null);
    setHintText(null);
    setShowOptions(false);
    setViewIndex(null);
    setPremove(null);
    setPremoveInvalid(false);
    wasMaterialDownRef.current = false;
    clock.reset();
  };

  const handleResign = () => {
    if (gameOver) return;
    setShowOptions(false);
    appAlert('Resign?', 'This ends the game as a loss.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Resign', style: 'destructive', onPress: () => setResignedBy(userColor) },
    ]);
  };

  // Pops both the user's last move AND the bot's reply to it, so it's the user's turn again —
  // only enabled on the user's turn (i.e. once the bot has already replied), which means
  // `history` always has an even length here and this slice is always safe.
  const handleUndo = () => {
    if (gameOver || botThinking || turn !== userColor || history.length < 2 || isReviewing) return;
    const target = history[history.length - 2];
    setHistory((h) => h.slice(0, -2));
    setFen(target.fenBefore);
    setLastMove(history.length >= 3 ? history[history.length - 3].move : null);
    setOpeningName(null);
    setHintText(null);
  };

  const handleHintPress = () => {
    if (gameOver || hintLoading || botThinking || turn !== userColor || isReviewing) return;
    setHintText(null);
    setHintLoading(true);
    setHintRequestKey((k) => k + 1);
  };

  // Same local-only review mechanism as LocalGameScreen/OnlineGameScreen — tapping a move in the
  // strip never touches `fen`/`history` (the live game the bot keeps playing against), it only
  // changes which position is displayed.
  const positions = useMemo(() => [initialFen, ...history.map((h) => h.fenAfter)], [initialFen, history]);
  const isReviewing = viewIndex !== null;
  const displayFen = isReviewing ? positions[viewIndex as number] : fen;
  const selectedMoveIndex = isReviewing ? (viewIndex as number) - 1 : history.length - 1;
  const displayLastMove = selectedMoveIndex >= 0 ? history[selectedMoveIndex].move : null;

  const handleSelectMove = (index: number) => {
    const next = index + 1;
    setViewIndex(next >= positions.length - 1 ? null : next);
  };

  // Flipping the board also swaps which row (You / the bot) sits on top vs bottom, so each row
  // always stays next to "its own" side of the board.
  const topColor: PieceColor = flipped ? userColor : botColor;
  const bottomColor: PieceColor = flipped ? botColor : userColor;
  const playerInfo = (color: PieceColor) => ({
    label: color === userColor ? 'You' : bot.name,
    seconds: color === 'w' ? clock.whiteSeconds : clock.blackSeconds,
    captured: color === 'w' ? whiteCaptured : blackCaptured,
    iconColor: (color === 'w' ? 'b' : 'w') as PieceColor,
    advantage: color === 'w' ? (materialDiff > 0 ? materialDiff : 0) : materialDiff < 0 ? -materialDiff : 0,
  });
  const top = playerInfo(topColor);
  const bottom = playerInfo(bottomColor);

  return (
    <View style={styles.container}>
      <StockfishBridge ref={handleBridgeRef} onLine={handleEngineLine} html={engineRuntime.buildHtml()} />
      <ScreenHeader title={`Chess — vs Bot${chess960 ? ' (Chess960)' : ''}`} onBack={onExit} backLabel="‹ Menu" />
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
                  { key: 'resign', label: 'Resign', onPress: handleResign, disabled: gameOver },
                  {
                    key: 'hint',
                    label: 'Hint',
                    onPress: handleHintPress,
                    disabled: gameOver || hintLoading || botThinking || turn !== userColor || isReviewing,
                  },
                  {
                    key: 'undo',
                    label: 'Undo',
                    onPress: handleUndo,
                    disabled: gameOver || botThinking || turn !== userColor || history.length < 2 || isReviewing,
                  },
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
          {getEngineName(engineId)} · {bot.name} (ELO {bot.elo}) · {timeControl.label}
        </Text>
        {!gameOver && <Text style={styles.status}>{statusText}</Text>}
        {isReviewing && <Text style={styles.reviewingText}>Reviewing move history (not live)</Text>}
        {botThinking && (
          <View style={styles.thinkingRow}>
            <ActivityIndicator size="small" color={colors.text} />
            <Text style={styles.thinkingText}>The bot is thinking...</Text>
          </View>
        )}
        {engineError && <Text style={styles.errorText}>Engine error: {engineError}</Text>}
        {premoveInvalid && <Text style={styles.errorText}>Premove was no longer legal — cancelled.</Text>}
        {premove && turn === botColor && (
          <View style={styles.premoveRow}>
            <Text style={styles.premoveText}>
              Premove queued: {premove.from}-{premove.to}
            </Text>
            <Pressable style={styles.premoveCancelButton} onPress={handleCancelPremove}>
              <Text style={styles.premoveCancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.playerRow}>
          <Text style={[styles.clock, turn === topColor && !gameOver && styles.clockActive]}>
            {top.label}{clock.hasClock ? `: ${formatTime(top.seconds)}` : ''}
          </Text>
          <CapturedPieces pieces={top.captured} color={top.iconColor} advantage={top.advantage} />
        </View>

        {!chess960 && openingName && <Text style={styles.openingName}>{openingName}</Text>}

        <ChessBoard
          key={resetCount}
          fen={displayFen}
          onMove={handleMove}
          disabled={gameOver || isReviewing}
          chess960={chess960}
          initialFen={initialFen}
          orientation={flipped ? botColor : userColor}
          lastMove={displayLastMove}
          enableAnnotations
          premoveColor={userColor}
          onPremove={handleQueuePremove}
        />

        <View style={styles.playerRow}>
          <Text style={[styles.clock, turn === bottomColor && !gameOver && styles.clockActive]}>
            {bottom.label}{clock.hasClock ? `: ${formatTime(bottom.seconds)}` : ''}
          </Text>
          <CapturedPieces pieces={bottom.captured} color={bottom.iconColor} advantage={bottom.advantage} />
        </View>

        {hintLoading && <Text style={styles.hintText}>Thinking of a hint...</Text>}
        {!hintLoading && hintText && <Text style={styles.hintText}>Hint: {hintText}</Text>}
      </GameScreenBody>

      <PostGameSummaryModal
        visible={gameOver}
        title={summaryTitle}
        subtitle={summarySubtitle}
        initialFen={initialFen}
        chess960={chess960}
        history={history}
        players={[{ label: 'You', color: userColor }]}
        onGameReview={() => onAnalyze({ initialFen, chess960, history })}
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
    premoveRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    premoveText: {
      fontSize: 13,
      fontStyle: 'italic',
      color: colors.gold,
    },
    premoveCancelButton: {
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 6,
      backgroundColor: colors.buttonBackground,
    },
    premoveCancelButtonText: {
      fontSize: 12,
      fontWeight: '600',
      color: '#fff',
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
