import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import ChessBoard from '../components/ChessBoard';
import GameScreenBody from '../components/GameScreenBody';
import ScreenHeader from '../components/ScreenHeader';
import { unlockAchievement } from '../logic/achievementStorage';
import { ChessEngine } from '../logic/ChessEngine';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { triggerMoveHaptics } from '../logic/haptics';
import { getBestScore, saveScoreIfBest, type PuzzleRushDuration } from '../logic/puzzleRushStorage';
import { PUZZLE_THEME_OPTIONS } from '../logic/puzzleThemes';
import { getRandomPuzzle } from '../logic/puzzles';
import { formatTime } from '../logic/time';
import { parseUciMove } from '../logic/uciMove';
import type { Move, PieceColor } from '../types/chess';
import type { PuzzleData } from '../types/puzzle';

interface PuzzleRushScreenProps {
  onExit: () => void;
  /** When set (from PuzzleTrainingScreen), restricts every puzzle this run serves to one tagged
   * with at least one of these themes, and skips best-score tracking — a themed run isn't
   * comparable to an unrestricted one, so mixing them into the same best-score bucket would be
   * misleading (see puzzleRushStorage.ts, which only keys by duration). */
  themeFilter?: string[];
}

type Phase = 'setup' | 'playing' | 'ended';

const REPLY_DELAY_MS = 400;
const MAX_MISTAKES = 3;
const DURATIONS: PuzzleRushDuration[] = [3, 5];

/** Sets up a puzzle for solving: auto-plays its "setup" move (moves[0], the opponent's move that
 * creates the position the solver actually sees) and returns everything the screen needs to start
 * displaying it. Mirrors DailyPuzzleScreen's identical setup step. */
function setupPuzzle(puzzle: PuzzleData) {
  const engine = new ChessEngine(puzzle.fen);
  const setup = parseUciMove(puzzle.moves[0]);
  if (setup) engine.move(setup.from, setup.to, setup.promotion);
  const solverColor: PieceColor = new ChessEngine(puzzle.fen).getTurn() === 'w' ? 'b' : 'w';
  return { fen: engine.getFen(), solverColor };
}

export default function PuzzleRushScreen({ onExit, themeFilter }: PuzzleRushScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);

  const [phase, setPhase] = useState<Phase>('setup');
  const [duration, setDuration] = useState<PuzzleRushDuration>(3);
  const [bestScores, setBestScores] = useState<Record<PuzzleRushDuration, number>>({ 3: 0, 5: 0 });

  useEffect(() => {
    Promise.all(DURATIONS.map((d) => getBestScore(d))).then(([b3, b5]) => setBestScores({ 3: b3, 5: b5 }));
  }, []);

  const [secondsLeft, setSecondsLeft] = useState(0);
  const [score, setScore] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [newBest, setNewBest] = useState(false);

  const [puzzle, setPuzzle] = useState<PuzzleData | null>(null);
  const [fen, setFen] = useState('');
  const [solverColor, setSolverColor] = useState<PieceColor>('w');
  const [moveIndex, setMoveIndex] = useState(1);
  const [lastMove, setLastMove] = useState<Move | null>(null);
  const [botReplying, setBotReplying] = useState(false);
  const [wrongFlashKey, setWrongFlashKey] = useState(0);
  const [showWrongFlash, setShowWrongFlash] = useState(false);
  const [attemptKey, setAttemptKey] = useState(0);

  const seenIdsRef = useRef<Set<string>>(new Set());
  const runActiveRef = useRef(false);
  const scoreRef = useRef(0);
  const mistakesRef = useRef(0);

  useEffect(() => {
    if (wrongFlashKey === 0) return;
    setShowWrongFlash(true);
    const timeout = setTimeout(() => setShowWrongFlash(false), 500);
    return () => clearTimeout(timeout);
  }, [wrongFlashKey]);

  const loadPuzzle = (excludeIds: Set<string>) => {
    const next = getRandomPuzzle(excludeIds, Math.random, themeFilter);
    excludeIds.add(next.id);
    const { fen: nextFen, solverColor: nextSolverColor } = setupPuzzle(next);
    setPuzzle(next);
    setFen(nextFen);
    setSolverColor(nextSolverColor);
    setMoveIndex(1);
    setLastMove(null);
    setBotReplying(false);
    setAttemptKey((k) => k + 1);
  };

  const endRun = () => {
    if (!runActiveRef.current) return;
    runActiveRef.current = false;
    const finished = scoreRef.current;
    setFinalScore(finished);
    setPhase('ended');
    if (finished >= 10) unlockAchievement('puzzle_rush_10');
    if (themeFilter && themeFilter.length > 0) return;
    saveScoreIfBest(duration, finished).then((best) => {
      setBestScores((b) => ({ ...b, [duration]: best }));
      setNewBest(finished > 0 && finished >= best);
    });
  };

  const startRun = (selectedDuration: PuzzleRushDuration) => {
    setDuration(selectedDuration);
    setSecondsLeft(selectedDuration * 60);
    setScore(0);
    setMistakes(0);
    scoreRef.current = 0;
    mistakesRef.current = 0;
    seenIdsRef.current = new Set();
    runActiveRef.current = true;
    loadPuzzle(seenIdsRef.current);
    setPhase('playing');
  };

  // Countdown — same one-tick-per-second convention as useChessClock elsewhere in this app.
  useEffect(() => {
    if (phase !== 'playing') return;
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(interval);
          endRun();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const handleMove = (move: Move, newFen: string) => {
    if (phase !== 'playing' || botReplying || !puzzle) return;

    const playedUci = `${move.from}${move.to}${move.promotion ?? ''}`;
    const expectedUci = puzzle.moves[moveIndex];

    if (playedUci !== expectedUci) {
      mistakesRef.current += 1;
      setMistakes(mistakesRef.current);
      setWrongFlashKey((k) => k + 1);
      setAttemptKey((k) => k + 1); // discard the board's own tentative move, same as DailyPuzzleScreen
      if (mistakesRef.current >= MAX_MISTAKES) endRun();
      return;
    }

    triggerMoveHaptics(move);
    setFen(newFen);
    setLastMove(move);
    const nextIndex = moveIndex + 1;

    if (nextIndex >= puzzle.moves.length) {
      scoreRef.current += 1;
      setScore(scoreRef.current);
      if (scoreRef.current >= 10 && mistakesRef.current === 0) unlockAchievement('puzzle_streak_10');
      loadPuzzle(seenIdsRef.current);
      return;
    }

    setBotReplying(true);
    setTimeout(() => {
      if (!runActiveRef.current) return;
      const replyUci = puzzle.moves[nextIndex];
      const parsed = parseUciMove(replyUci);
      const replyEngine = new ChessEngine(newFen);
      const replyMove = parsed ? replyEngine.move(parsed.from, parsed.to, parsed.promotion) : null;
      const afterReplyIndex = nextIndex + 1;

      if (replyMove) {
        setFen(replyEngine.getFen());
        setLastMove(replyMove);
      }

      if (afterReplyIndex >= puzzle.moves.length) {
        scoreRef.current += 1;
        setScore(scoreRef.current);
        if (scoreRef.current >= 10 && mistakesRef.current === 0) unlockAchievement('puzzle_streak_10');
        loadPuzzle(seenIdsRef.current);
      } else {
        setMoveIndex(afterReplyIndex);
        setBotReplying(false);
      }
    }, REPLY_DELAY_MS);
  };

  const bestForCurrentDuration = bestScores[duration];
  const isThemed = !!themeFilter && themeFilter.length > 0;
  const themedLabel = isThemed
    ? themeFilter!.map((id) => PUZZLE_THEME_OPTIONS.find((o) => o.id === id)?.label ?? id).join(', ')
    : null;

  return (
    <View style={styles.container}>
      <ScreenHeader title={isThemed ? 'Puzzle Training' : 'Puzzle Rush'} onBack={onExit} backLabel="‹ Back" />

      {phase === 'setup' && (
        <View style={styles.centerColumn}>
          <Text style={styles.setupTitle}>
            {isThemed ? `Training: ${themedLabel}` : 'Solve as many puzzles as you can.'}
          </Text>
          <Text style={styles.setupSubtitle}>The run ends after {MAX_MISTAKES} mistakes or when time runs out.</Text>
          <View style={styles.durationRow}>
            {DURATIONS.map((d) => (
              <Pressable key={d} style={styles.durationButton} onPress={() => startRun(d)}>
                <Text style={styles.durationButtonText}>{d} minutes</Text>
                {!isThemed && <Text style={styles.durationBestText}>Best: {bestScores[d]}</Text>}
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {phase === 'playing' && puzzle && (
        <GameScreenBody
          bottomBar={
            <View style={styles.footer}>
              {lastMove && <Text style={styles.lastMove}>Last move: {lastMove.san}</Text>}
            </View>
          }
        >
          <View style={styles.statsRow}>
            <Text style={styles.statText}>Time: {formatTime(secondsLeft)}</Text>
            <Text style={styles.statText}>Score: {score}</Text>
            <Text style={styles.statText}>
              Mistakes: {mistakes}/{MAX_MISTAKES}
            </Text>
          </View>

          {botReplying && <Text style={styles.status}>Opponent is replying...</Text>}

          <View style={[styles.boardWrapper, showWrongFlash && styles.boardWrapperWrong]}>
            <ChessBoard
              key={attemptKey}
              fen={fen}
              onMove={handleMove}
              disabled={botReplying}
              orientation={solverColor}
              lastMove={lastMove}
            />
          </View>
        </GameScreenBody>
      )}

      {phase === 'ended' && (
        <View style={styles.centerColumn}>
          <Text style={styles.setupTitle}>Time's up!</Text>
          <Text style={styles.finalScore}>{finalScore}</Text>
          <Text style={styles.setupSubtitle}>puzzles solved</Text>
          {!isThemed && newBest && <Text style={styles.newBestText}>New best!</Text>}
          {!isThemed && (
            <Text style={styles.setupSubtitle}>Best for {duration} minutes: {bestForCurrentDuration}</Text>
          )}
          <View style={styles.durationRow}>
            <Pressable style={styles.durationButton} onPress={() => startRun(duration)}>
              <Text style={styles.durationButtonText}>Play Again</Text>
            </Pressable>
            <Pressable style={styles.durationButton} onPress={() => setPhase('setup')}>
              <Text style={styles.durationButtonText}>Change Time</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    centerColumn: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      gap: 10,
    },
    setupTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
    },
    setupSubtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    durationRow: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 12,
    },
    durationButton: {
      paddingVertical: 14,
      paddingHorizontal: 20,
      backgroundColor: colors.buttonBackground,
      borderRadius: 10,
      alignItems: 'center',
      gap: 4,
    },
    durationButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
    },
    durationBestText: {
      color: '#fff',
      fontSize: 12,
      opacity: 0.85,
    },
    finalScore: {
      fontSize: 48,
      fontWeight: '800',
      color: colors.accent,
      marginTop: 8,
    },
    newBestText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.gold,
    },
    statsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: '100%',
      maxWidth: 340,
      alignSelf: 'center',
      paddingHorizontal: 4,
    },
    statText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
    status: {
      fontSize: 14,
      fontStyle: 'italic',
      color: colors.textSecondary,
      textAlign: 'center',
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
      color: colors.textSecondary,
    },
  });
}
