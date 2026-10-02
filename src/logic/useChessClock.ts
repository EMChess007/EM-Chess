import { useCallback, useEffect, useState } from 'react';
import type { PieceColor } from '../types/chess';
import type { TimeControl } from '../types/timeControl';

export function hasLiveClock(category: TimeControl['category']): boolean {
  return category === 'bullet' || category === 'blitz' || category === 'rapid';
}

export interface ChessClock {
  whiteSeconds: number;
  blackSeconds: number;
  timeoutWinner: PieceColor | null;
  hasClock: boolean;
  applyIncrement: (color: PieceColor) => void;
  /** Precisely subtracts `ms` from `color`'s clock — for callers (like a bot) that know exactly
   * how long a "turn" actually took in real time, instead of relying on the once-a-second tick
   * (which can under-count anything faster than 1s, e.g. a quick bullet-speed bot move). */
  consumeTime: (color: PieceColor, ms: number) => void;
  reset: () => void;
}

export interface UseChessClockOptions {
  /** Whether the once-a-second wall-clock tick should run for the side to move. Defaults to
   * true. Set to false while a caller is driving that side's clock itself via `consumeTime`
   * (e.g. a bot move), so the two mechanisms don't both deduct time for the same turn. */
  autoTick?: boolean;
}

/**
 * Drives a two-player chess clock for a given time control: ticks down the side to move,
 * detects flag-fall, and applies increments after a move. Shared by LocalGameScreen and
 * BotGameScreen so both stay in sync on clock behavior.
 */
export function useChessClock(
  timeControl: TimeControl,
  turn: PieceColor,
  isGameOverElsewhere: boolean,
  options: UseChessClockOptions = {}
): ChessClock {
  const { autoTick = true } = options;
  const hasClock = hasLiveClock(timeControl.category);
  const [whiteSeconds, setWhiteSeconds] = useState(timeControl.initialSeconds);
  const [blackSeconds, setBlackSeconds] = useState(timeControl.initialSeconds);
  const [timeoutWinner, setTimeoutWinner] = useState<PieceColor | null>(null);

  const isOver = isGameOverElsewhere || timeoutWinner !== null;

  useEffect(() => {
    if (!hasClock || isOver || !autoTick) return;
    const interval = setInterval(() => {
      if (turn === 'w') {
        setWhiteSeconds((s) => Math.max(0, s - 1));
      } else {
        setBlackSeconds((s) => Math.max(0, s - 1));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [turn, hasClock, isOver, autoTick]);

  useEffect(() => {
    if (!hasClock || timeoutWinner) return;
    if (whiteSeconds <= 0) setTimeoutWinner('b');
    else if (blackSeconds <= 0) setTimeoutWinner('w');
  }, [whiteSeconds, blackSeconds, hasClock, timeoutWinner]);

  // All three wrapped in useCallback — callers (e.g. LocalGameScreen/BotGameScreen's handleMove)
  // memoize their own handlers off these, and a fresh function reference every render (which a
  // plain arrow function here would produce even though hasClock/timeControl never actually
  // change mid-game) would defeat that: it'd force those handlers — and in turn a memoized
  // ChessBoard depending on them — to re-identify as "changed" on every clock tick.
  const applyIncrement = useCallback(
    (color: PieceColor) => {
      if (!hasClock) return;
      if (color === 'w') setWhiteSeconds((s) => s + timeControl.incrementSeconds);
      else setBlackSeconds((s) => s + timeControl.incrementSeconds);
    },
    [hasClock, timeControl.incrementSeconds]
  );

  const consumeTime = useCallback(
    (color: PieceColor, ms: number) => {
      if (!hasClock) return;
      const deltaSeconds = ms / 1000;
      if (color === 'w') setWhiteSeconds((s) => Math.max(0, s - deltaSeconds));
      else setBlackSeconds((s) => Math.max(0, s - deltaSeconds));
    },
    [hasClock]
  );

  const reset = useCallback(() => {
    setWhiteSeconds(timeControl.initialSeconds);
    setBlackSeconds(timeControl.initialSeconds);
    setTimeoutWinner(null);
  }, [timeControl.initialSeconds]);

  return { whiteSeconds, blackSeconds, timeoutWinner, hasClock, applyIncrement, consumeTime, reset };
}
