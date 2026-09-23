import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSaveGameOnEnd } from '../api/useSaveGameOnEnd';
import CapturedPieces from '../components/CapturedPieces';
import ChessBoard from '../components/ChessBoard';
import ScreenHeader from '../components/ScreenHeader';
import { getEngineRuntime } from '../engine/engineRegistry';
import StockfishBridge, { type StockfishBridgeHandle } from '../engine/StockfishBridge';
import { getBotThinkTimeMs } from '../logic/bots';
import { generateChess960Position } from '../logic/chess960';
import { ChessEngine } from '../logic/ChessEngine';
import { getEngineIdForElo, getEngineName } from '../logic/engines';
import { buildGamePayload } from '../logic/gamePayload';
import { computeCapturedMaterial, materialValue } from '../logic/material';
import { lookupOpening } from '../logic/openings';
import { formatTime } from '../logic/time';
import { parseUciMove } from '../logic/uciMove';
import { useChessClock } from '../logic/useChessClock';
import { START_FEN } from '../types/chess';
import type { Move, PieceColor } from '../types/chess';
import type { BotPersonality } from '../types/bot';
import type { AnalyzeParams, GameHistoryEntry } from '../types/history';
import type { TimeControl } from '../types/timeControl';

interface BotGameScreenProps {
  bot: BotPersonality;
  timeControl: TimeControl;
  chess960?: boolean;
  authToken: string | null;
  onExit: () => void;
  onAnalyze: (params: AnalyzeParams) => void;
}

const USER_COLOR: PieceColor = 'w';
const BOT_COLOR: PieceColor = 'b';

export default function BotGameScreen({
  bot,
  timeControl,
  chess960 = false,
  authToken,
  onExit,
  onAnalyze,
}: BotGameScreenProps) {
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

  // The bot's own clock is driven precisely by consumeTime() below (an exact, sub-second amount
  // matching however long it actually "thought"), not by the once-a-second auto-tick — a fast
  // bullet-speed bot move can take well under 1s, which the auto-tick alone would under-count.
  const clock = useChessClock(timeControl, turn, engine.isGameOver(), { autoTick: turn === USER_COLOR });
  const gameOver = engine.isGameOver() || clock.timeoutWinner !== null;

  const savePayload = useMemo(
    () =>
      buildGamePayload({
        chessStatus,
        turn,
        timeoutWinner: clock.timeoutWinner,
        history,
        initialFen,
        chess960,
        timeControl,
        opponentType: 'bot',
        opponentElo: bot.elo,
      }),
    [chessStatus, turn, clock.timeoutWinner, history, initialFen, chess960, timeControl, bot.elo]
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

  // Whenever it becomes the bot's turn, ask the engine for a move and play it automatically.
  useEffect(() => {
    if (turn !== BOT_COLOR || gameOver) return;

    let cancelled = false;
    setBotThinking(true);
    setEngineError(null);

    (async () => {
      try {
        await engineRuntime.engine.initEngine();
        engineRuntime.engine.setPosition(fen);

        // Same think-time logic for every bot personality/ELO and for both classical and
        // Chess960 — this is the only place BotGameScreen asks the engine for a move.
        const thinkTimeMs = getBotThinkTimeMs({
          timeControl,
          remainingSeconds: clock.blackSeconds,
          legalMoveCount: engine.getLegalMoveCount(),
        });

        const uciMove = await engineRuntime.engine.getBestMove({
          elo: bot.elo,
          movetimeMs: thinkTimeMs,
        });
        if (cancelled) return;

        const parsed = parseUciMove(uciMove);
        if (!parsed) throw new Error(`Unrecognized move from engine: "${uciMove}"`);

        const moveEngine = new ChessEngine(fen, { chess960, initialFen });
        const move = moveEngine.move(parsed.from, parsed.to, parsed.promotion);
        if (!move) throw new Error(`Invalid move from engine: "${uciMove}"`);
        if (cancelled) return;

        // Actually charge the bot's clock for the time it "thought" — not just a UI effect.
        clock.consumeTime(BOT_COLOR, thinkTimeMs);
        clock.applyIncrement(BOT_COLOR);
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

  const turnLabel = turn === USER_COLOR ? 'You' : bot.name;
  const winnerLabel = turn === USER_COLOR ? bot.name : 'You';

  let statusText = `Turn: ${turnLabel}`;
  if (chessStatus === 'check') statusText = `Turn: ${turnLabel} — Check!`;
  if (chessStatus === 'checkmate') statusText = `Checkmate! Winner: ${winnerLabel}`;
  if (chessStatus === 'stalemate') statusText = 'Draw (Stalemate)';
  if (chessStatus === 'draw') statusText = 'Draw';
  if (clock.timeoutWinner) {
    statusText = `Win on time: ${clock.timeoutWinner === USER_COLOR ? 'You' : bot.name}`;
  }

  const handleMove = (move: Move, newFen: string) => {
    clock.applyIncrement(USER_COLOR);
    setHistory((h) => [...h, { move, fenBefore: fen, fenAfter: newFen }]);
    setLastMove(move);
    setFen(newFen);
  };

  const handleReset = () => {
    const nextInitialFen = chess960 ? generateChess960Position() : START_FEN;
    setInitialFen(nextInitialFen);
    setFen(nextInitialFen);
    setLastMove(null);
    setHistory([]);
    setEngineError(null);
    setResetCount((c) => c + 1);
    setOpeningName(null);
    clock.reset();
  };

  return (
    <View style={styles.container}>
      <StockfishBridge ref={handleBridgeRef} onLine={handleEngineLine} html={engineRuntime.buildHtml()} />
      <ScreenHeader title={`Chess — vs Bot${chess960 ? ' (Chess960)' : ''}`} onBack={onExit} backLabel="‹ Menu" />
      <View style={styles.body}>
      <Text style={styles.subtitle}>
        {getEngineName(engineId)} · {bot.name} (ELO {bot.elo}) · {timeControl.label}
      </Text>
      <Text style={[styles.status, (chessStatus === 'checkmate' || clock.timeoutWinner) && styles.statusOver]}>
        {statusText}
      </Text>
      {botThinking && (
        <View style={styles.thinkingRow}>
          <ActivityIndicator size="small" color="#3a2618" />
          <Text style={styles.thinkingText}>The bot is thinking...</Text>
        </View>
      )}
      {engineError && <Text style={styles.errorText}>Engine error: {engineError}</Text>}

      <View style={styles.playerRow}>
        <Text style={[styles.clock, turn === BOT_COLOR && !gameOver && styles.clockActive]}>
          {bot.name}{clock.hasClock ? `: ${formatTime(clock.blackSeconds)}` : ''}
        </Text>
        <CapturedPieces pieces={blackCaptured} color="w" advantage={materialDiff < 0 ? -materialDiff : 0} />
      </View>

      {!chess960 && openingName && <Text style={styles.openingName}>{openingName}</Text>}

      <ChessBoard
        key={resetCount}
        fen={fen}
        onMove={handleMove}
        disabled={gameOver || turn !== USER_COLOR || botThinking}
        chess960={chess960}
        initialFen={initialFen}
      />

      <View style={styles.playerRow}>
        <Text style={[styles.clock, turn === USER_COLOR && !gameOver && styles.clockActive]}>
          You{clock.hasClock ? `: ${formatTime(clock.whiteSeconds)}` : ''}
        </Text>
        <CapturedPieces pieces={whiteCaptured} color="b" advantage={materialDiff > 0 ? materialDiff : 0} />
      </View>

      <View style={styles.footer}>
        {lastMove && <Text style={styles.lastMove}>Last move: {lastMove.san}</Text>}
        <View style={styles.footerButtons}>
          <Pressable style={styles.resetButton} onPress={handleReset}>
            <Text style={styles.resetButtonText}>New Game</Text>
          </Pressable>
          {gameOver && history.length > 0 && (
            <Pressable
              style={[styles.resetButton, styles.analyzeButton]}
              onPress={() => onAnalyze({ initialFen, chess960, history })}
            >
              <Text style={styles.resetButtonText}>Analyze Game</Text>
            </Pressable>
          )}
        </View>
      </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  subtitle: {
    fontSize: 13,
    color: '#777',
  },
  status: {
    fontSize: 16,
    color: '#333',
  },
  statusOver: {
    fontWeight: '700',
    color: '#b00020',
  },
  openingName: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#8a7a63',
    textAlign: 'center',
    maxWidth: 320,
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
    color: '#3a2618',
    fontStyle: 'italic',
  },
  errorText: {
    fontSize: 13,
    color: '#b00020',
  },
  clock: {
    fontSize: 20,
    fontVariant: ['tabular-nums'],
    color: '#333',
    paddingVertical: 4,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  clockActive: {
    fontWeight: '700',
    color: '#fff',
    backgroundColor: '#3a2618',
  },
  footer: {
    marginTop: 16,
    alignItems: 'center',
    gap: 8,
  },
  lastMove: {
    fontSize: 14,
    color: '#555',
  },
  footerButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  analyzeButton: {
    backgroundColor: '#2e6f4f',
  },
  resetButton: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    backgroundColor: '#3a2618',
    borderRadius: 8,
  },
  resetButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
