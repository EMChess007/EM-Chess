import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSaveGameOnEnd } from '../api/useSaveGameOnEnd';
import ChessBoard from '../components/ChessBoard';
import ScreenHeader from '../components/ScreenHeader';
import { generateChess960Position } from '../logic/chess960';
import { ChessEngine } from '../logic/ChessEngine';
import { buildGamePayload } from '../logic/gamePayload';
import { lookupOpening } from '../logic/openings';
import { formatTime } from '../logic/time';
import { useChessClock } from '../logic/useChessClock';
import { START_FEN } from '../types/chess';
import type { Move } from '../types/chess';
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
        opponentType: 'human',
        opponentElo: null,
      }),
    [chessStatus, turn, clock.timeoutWinner, history, initialFen, chess960, timeControl]
  );
  useSaveGameOnEnd(authToken, resetCount, savePayload);

  const turnLabel = turn === 'w' ? 'White' : 'Black';
  const winnerLabel = turn === 'w' ? 'Black' : 'White';

  let statusText = `${turnLabel} to move`;
  if (chessStatus === 'check') statusText = `${turnLabel} to move — Check!`;
  if (chessStatus === 'checkmate') statusText = `Checkmate! Winner: ${winnerLabel}`;
  if (chessStatus === 'stalemate') statusText = 'Draw (Stalemate)';
  if (chessStatus === 'draw') statusText = 'Draw';
  if (clock.timeoutWinner) statusText = `Win on time: ${clock.timeoutWinner === 'w' ? 'White' : 'Black'}`;

  const handleMove = (move: Move, newFen: string) => {
    clock.applyIncrement(turn);
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
    setResetCount((c) => c + 1);
    setOpeningName(null);
    clock.reset();
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title={`Chess${chess960 ? ' — Chess960' : ' — Local Game'}`} onBack={onExit} backLabel="‹ Menu" />
      <View style={styles.body}>
      <Text style={styles.timeControlLabel}>{timeControl.label}</Text>
      <Text style={[styles.status, (chessStatus === 'checkmate' || clock.timeoutWinner) && styles.statusOver]}>
        {statusText}
      </Text>

      {clock.hasClock && (
        <Text style={[styles.clock, turn === 'b' && !gameOver && styles.clockActive]}>
          Black: {formatTime(clock.blackSeconds)}
        </Text>
      )}

      {!chess960 && openingName && <Text style={styles.openingName}>{openingName}</Text>}

      <ChessBoard
        key={resetCount}
        fen={fen}
        onMove={handleMove}
        disabled={gameOver}
        chess960={chess960}
        initialFen={initialFen}
      />

      {clock.hasClock && (
        <Text style={[styles.clock, turn === 'w' && !gameOver && styles.clockActive]}>
          White: {formatTime(clock.whiteSeconds)}
        </Text>
      )}

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
