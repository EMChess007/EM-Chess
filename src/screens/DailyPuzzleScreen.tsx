import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import ChessBoard from '../components/ChessBoard';
import ScreenHeader from '../components/ScreenHeader';
import { ChessEngine } from '../logic/ChessEngine';
import { getDailyPuzzle, getDailyPuzzleDateKey } from '../logic/puzzles';
import { isTodayPuzzleSolved, markTodayPuzzleSolved } from '../logic/puzzleStorage';
import { parseUciMove } from '../logic/uciMove';
import type { Move, PieceColor } from '../types/chess';

interface DailyPuzzleScreenProps {
  authToken: string | null;
}

type PuzzleStatus = 'playing' | 'solved' | 'revealed';

const REPLY_DELAY_MS = 500;

export default function DailyPuzzleScreen({ authToken }: DailyPuzzleScreenProps) {
  const puzzle = useMemo(() => getDailyPuzzle(), []);

  const solverColor = useMemo<PieceColor>(() => new ChessEngine(puzzle.fen).getTurn() === 'w' ? 'b' : 'w', [puzzle]);

  const initialFen = useMemo(() => {
    const engine = new ChessEngine(puzzle.fen);
    const setup = parseUciMove(puzzle.moves[0]);
    if (setup) engine.move(setup.from, setup.to, setup.promotion);
    return engine.getFen();
  }, [puzzle]);

  const [fen, setFen] = useState(initialFen);
  const [moveIndex, setMoveIndex] = useState(1);
  const [status, setStatus] = useState<PuzzleStatus>('playing');
  const [lastMoveSan, setLastMoveSan] = useState<string | null>(null);
  const [wrongCount, setWrongCount] = useState(0);
  const [showWrongFlash, setShowWrongFlash] = useState(false);
  const [flashKey, setFlashKey] = useState(0);
  const [attemptKey, setAttemptKey] = useState(0);
  const [botReplying, setBotReplying] = useState(false);
  const [alreadySolvedToday, setAlreadySolvedToday] = useState(false);
  const [checkingStorage, setCheckingStorage] = useState(true);

  useEffect(() => {
    let cancelled = false;
    isTodayPuzzleSolved().then((solved) => {
      if (!cancelled) {
        setAlreadySolvedToday(solved);
        setCheckingStorage(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authToken) return;
    // Soft upgrade only: local storage always drives the initial "already solved" state above
    // (fast, always available), and this can only flip it from false to true — e.g. the same
    // account already solved today's puzzle on another device. A slow/failed request here must
    // never block or change anything else about the screen.
    let cancelled = false;
    api
      .getPuzzleProgress(authToken, getDailyPuzzleDateKey())
      .then((progress) => {
        if (!cancelled && progress.solved) setAlreadySolvedToday(true);
      })
      .catch((err) => {
        console.warn('[DailyPuzzle] Failed to check progress from server:', err instanceof Error ? err.message : err);
      });
    return () => {
      cancelled = true;
    };
  }, [authToken]);

  useEffect(() => {
    if (flashKey === 0) return;
    setShowWrongFlash(true);
    const timeout = setTimeout(() => setShowWrongFlash(false), 600);
    return () => clearTimeout(timeout);
  }, [flashKey]);

  const markSolved = () => {
    markTodayPuzzleSolved();
    setAlreadySolvedToday(true);
    if (authToken) {
      api.markPuzzleSolved(authToken, getDailyPuzzleDateKey()).catch((err) => {
        console.warn('[DailyPuzzle] Failed to sync progress with server:', err instanceof Error ? err.message : err);
      });
    }
  };

  const handleMove = (move: Move, newFen: string) => {
    if (status !== 'playing' || botReplying) return;

    const playedUci = `${move.from}${move.to}${move.promotion ?? ''}`;
    const expectedUci = puzzle.moves[moveIndex];

    if (playedUci !== expectedUci) {
      setWrongCount((c) => c + 1);
      setFlashKey((k) => k + 1);
      // ChessBoard already mutated its own internal engine when the (rejected) move was made;
      // forcing a remount from the unchanged `fen` prop is how the rest of this app already
      // discards an in-progress board interaction cleanly (see LocalGameScreen/BotGameScreen).
      setAttemptKey((k) => k + 1);
      return;
    }

    setWrongCount(0);
    setFen(newFen);
    setLastMoveSan(move.san);
    const nextIndex = moveIndex + 1;

    if (nextIndex >= puzzle.moves.length) {
      setMoveIndex(nextIndex);
      setStatus('solved');
      markSolved();
      return;
    }

    setBotReplying(true);
    setTimeout(() => {
      const replyUci = puzzle.moves[nextIndex];
      const parsed = parseUciMove(replyUci);
      const replyEngine = new ChessEngine(newFen);
      const replyMove = parsed ? replyEngine.move(parsed.from, parsed.to, parsed.promotion) : null;

      const afterReplyIndex = nextIndex + 1;
      if (replyMove) {
        setFen(replyEngine.getFen());
        setLastMoveSan(replyMove.san);
      }
      setMoveIndex(afterReplyIndex);
      setBotReplying(false);
      if (afterReplyIndex >= puzzle.moves.length) {
        setStatus('solved');
        markSolved();
      }
    }, REPLY_DELAY_MS);
  };

  const handleReveal = () => {
    if (status !== 'playing' || botReplying) return;
    const engine = new ChessEngine(fen);
    let idx = moveIndex;
    let sanOfLast: string | null = null;
    while (idx < puzzle.moves.length) {
      const parsed = parseUciMove(puzzle.moves[idx]);
      if (!parsed) break;
      const move = engine.move(parsed.from, parsed.to, parsed.promotion);
      if (!move) break;
      sanOfLast = move.san;
      idx++;
    }
    setFen(engine.getFen());
    setMoveIndex(idx);
    if (sanOfLast) setLastMoveSan(sanOfLast);
    setStatus('revealed');
  };

  const handleRetryToday = () => {
    setFen(initialFen);
    setMoveIndex(1);
    setStatus('playing');
    setLastMoveSan(null);
    setWrongCount(0);
    setAttemptKey((k) => k + 1);
  };

  const solverLabel = solverColor === 'w' ? 'White' : 'Black';

  let statusText = `You're playing ${solverLabel}. Find the best move!`;
  if (botReplying) statusText = 'Opponent is replying...';
  if (status === 'solved') statusText = '✓ Solved! Well done!';
  if (status === 'revealed') statusText = 'You saw the solution.';

  return (
    <View style={styles.container}>
      <ScreenHeader title="Daily Puzzle" />
      <View style={styles.body}>

      <Text style={styles.subtitle}>Puzzle rating: {puzzle.rating}</Text>

      {!checkingStorage && alreadySolvedToday && status === 'playing' && (
        <View style={styles.alreadyBanner}>
          <Text style={styles.alreadyBannerText}>You've already solved today's puzzle — you can try again.</Text>
        </View>
      )}

      <Text
        style={[
          styles.status,
          status === 'solved' && styles.statusSolved,
          status === 'revealed' && styles.statusRevealed,
        ]}
      >
        {statusText}
      </Text>
      {wrongCount > 0 && status === 'playing' && (
        <Text style={styles.wrongText}>Wrong move — try again ({wrongCount}).</Text>
      )}

      <View style={[styles.boardWrapper, showWrongFlash && styles.boardWrapperWrong]}>
        <ChessBoard
          key={attemptKey}
          fen={fen}
          onMove={handleMove}
          disabled={status !== 'playing' || botReplying}
          orientation={solverColor}
        />
      </View>

      <View style={styles.footer}>
        {lastMoveSan && <Text style={styles.lastMove}>Last move: {lastMoveSan}</Text>}
        <View style={styles.footerButtons}>
          {status === 'playing' && (
            <Pressable style={[styles.button, styles.revealButton]} onPress={handleReveal}>
              <Text style={styles.buttonText}>Show solution</Text>
            </Pressable>
          )}
          {status !== 'playing' && (
            <Pressable style={styles.button} onPress={handleRetryToday}>
              <Text style={styles.buttonText}>Try again</Text>
            </Pressable>
          )}
        </View>
      </View>

      {checkingStorage && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#999" />
        </View>
      )}
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
    gap: 8,
    paddingHorizontal: 16,
  },
  subtitle: {
    fontSize: 13,
    color: '#777',
  },
  alreadyBanner: {
    backgroundColor: '#f0d9b5',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    maxWidth: 340,
  },
  alreadyBannerText: {
    fontSize: 12,
    color: '#3a2618',
    textAlign: 'center',
  },
  status: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  statusSolved: {
    color: '#1a7a1a',
  },
  statusRevealed: {
    color: '#8d6e63',
  },
  wrongText: {
    fontSize: 13,
    color: '#b00020',
  },
  boardWrapper: {
    padding: 4,
    borderRadius: 6,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  boardWrapperWrong: {
    borderColor: '#e53935',
  },
  footer: {
    marginTop: 4,
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
  button: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    backgroundColor: '#3a2618',
    borderRadius: 8,
  },
  revealButton: {
    backgroundColor: '#8d6e63',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingRow: {
    marginTop: 4,
  },
});
