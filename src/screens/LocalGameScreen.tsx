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
import ScreenHeader from '../components/ScreenHeader';
import { getEngineRuntime } from '../engine/engineRegistry';
import StockfishBridge, { type StockfishBridgeHandle } from '../engine/StockfishBridge';
import { generateChess960Position } from '../logic/chess960';
import { ChessEngine } from '../logic/ChessEngine';
import { DEFAULT_ENGINE_ID } from '../logic/engines';
import { buildGamePayload } from '../logic/gamePayload';
import { computeCapturedMaterial, materialValue } from '../logic/material';
import { playMoveSound } from '../logic/moveSounds';
import { lookupOpening } from '../logic/openings';
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
  authToken: string | null;
  onExit: () => void;
  onAnalyze: (params: AnalyzeParams) => void;
}

export default function LocalGameScreen({ timeControl, chess960 = false, authToken, onExit, onAnalyze }: LocalGameScreenProps) {
  const [initialFen, setInitialFen] = useState(() => (chess960 ? generateChess960Position() : START_FEN));
  const [fen, setFen] = useState(initialFen);
  const [lastMove, setLastMove] = useState<Move | null>(null);
  const [history, setHistory] = useState<GameHistoryEntry[]>([]);
  const [resetCount, setResetCount] = useState(0);
  const [openingName, setOpeningName] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [resignedBy, setResignedBy] = useState<PieceColor | null>(null);
  const [hintText, setHintText] = useState<string | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [hintActive, setHintActive] = useState(false);
  const [hintRequestKey, setHintRequestKey] = useState(0);
  const [viewIndex, setViewIndex] = useState<number | null>(null); // null = live position

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

  // Opening names don't apply to Chess960 (the shuffled starting position makes the whole
  // concept meaningless), and only ever *upgrade* to a deeper/more specific name — the book
  // doesn't have an entry for every single ply, so a miss here just means "no new checkpoint
  // yet", not "left the book"; once a played move truly can't lead to any further named
  // position, no later position will match either, so this naturally stops updating on its own.
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

  const clock = useChessClock(timeControl, turn, engine.isGameOver());
  const gameOver = engine.isGameOver() || clock.timeoutWinner !== null || resignedBy !== null;

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
        opponentType: 'human',
        opponentElo: null,
      }),
    [chessStatus, turn, clock.timeoutWinner, resignedBy, history, initialFen, chess960, timeControl]
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
  if (chessStatus === 'check') statusText = `${turnLabel} to move — Check!`;
  if (chessStatus === 'checkmate') statusText = `Checkmate! Winner: ${winnerLabel}`;
  if (chessStatus === 'stalemate') statusText = 'Draw (Stalemate)';
  if (chessStatus === 'draw') statusText = 'Draw';
  if (clock.timeoutWinner) statusText = `Win on time: ${clock.timeoutWinner === 'w' ? 'White' : 'Black'}`;
  if (resignedBy) statusText = `${resignedBy === 'w' ? 'White' : 'Black'} resigned — ${resignedBy === 'w' ? 'Black' : 'White'} wins`;

  const handleMove = (move: Move, newFen: string) => {
    if (viewIndex !== null) return;
    clock.applyIncrement(turn);
    playMoveSound(move);
    setHistory((h) => [...h, { move, fenBefore: fen, fenAfter: newFen }]);
    setLastMove(move);
    setFen(newFen);
    setHintText(null);
  };

  const handleReset = () => {
    const nextInitialFen = chess960 ? generateChess960Position() : START_FEN;
    setInitialFen(nextInitialFen);
    setFen(nextInitialFen);
    setLastMove(null);
    setHistory([]);
    setResetCount((c) => c + 1);
    setOpeningName(null);
    setResignedBy(null);
    setHintText(null);
    setShowOptions(false);
    setViewIndex(null);
    clock.reset();
  };

  const handleResign = () => {
    if (gameOver) return;
    setShowOptions(false);
    appAlert(`${turnLabel} resigns?`, 'This ends the game as a loss.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Resign', style: 'destructive', onPress: () => setResignedBy(turn) },
    ]);
  };

  const handleUndo = () => {
    if (gameOver || history.length === 0 || isReviewing) return;
    const previous = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setFen(previous.fenBefore);
    setLastMove(history.length >= 2 ? history[history.length - 2].move : null);
    setOpeningName(null);
    setHintText(null);
  };

  const handleHintPress = () => {
    if (gameOver || hintLoading || isReviewing) return;
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

  const handleSelectMove = (index: number) => {
    const next = index + 1;
    setViewIndex(next >= positions.length - 1 ? null : next);
  };

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
      <ScreenHeader title={`Chess${chess960 ? ' — Chess960' : ' — Local Game'}`} onBack={onExit} backLabel="‹ Menu" />
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
                  { key: 'hint', label: 'Hint', onPress: handleHintPress, disabled: gameOver || hintLoading || isReviewing },
                  { key: 'undo', label: 'Undo', onPress: handleUndo, disabled: gameOver || history.length === 0 || isReviewing },
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
          </>
        }
      >
        <Text style={styles.timeControlLabel}>{timeControl.label}</Text>
        <Text style={[styles.status, (chessStatus === 'checkmate' || clock.timeoutWinner || resignedBy) && styles.statusOver]}>
          {statusText}
        </Text>
        {isReviewing && <Text style={styles.reviewingText}>Reviewing move history (not live)</Text>}

        {hintActive && (
          <StockfishBridge ref={handleHintBridgeRef} onLine={handleHintBridgeLine} html={hintRuntime.buildHtml()} />
        )}

        <View style={styles.playerRow}>
          <Text style={[styles.clock, turn === topColor && !gameOver && styles.clockActive]}>
            {topColor === 'w' ? 'White' : 'Black'}
            {clock.hasClock ? `: ${formatTime(topColor === 'w' ? clock.whiteSeconds : clock.blackSeconds)}` : ''}
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
          orientation={flipped ? 'b' : 'w'}
        />

        <View style={styles.playerRow}>
          <Text style={[styles.clock, turn === bottomColor && !gameOver && styles.clockActive]}>
            {bottomColor === 'w' ? 'White' : 'Black'}
            {clock.hasClock ? `: ${formatTime(bottomColor === 'w' ? clock.whiteSeconds : clock.blackSeconds)}` : ''}
          </Text>
          <CapturedPieces pieces={bottom.captured} color={bottom.iconColor} advantage={bottom.advantage} />
        </View>

        {hintLoading && <Text style={styles.hintText}>Thinking of a hint...</Text>}
        {!hintLoading && hintText && <Text style={styles.hintText}>Hint: {hintText}</Text>}
      </GameScreenBody>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  timeControlLabel: {
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
  reviewingText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#8d6e00',
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hintText: {
    fontSize: 13,
    fontStyle: 'italic',
    color: '#2e6f4f',
  },
  controlsWrap: {
    alignItems: 'center',
    gap: 8,
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
  resetButton: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    backgroundColor: '#3a2618',
    borderRadius: 8,
  },
  analyzeButton: {
    backgroundColor: '#2e6f4f',
  },
  resetButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
