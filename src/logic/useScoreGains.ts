import { useEffect, useRef, useState } from 'react';
import type { FourPlayerState } from './fourPlayer';
import { scoreGains, type ScoreGain } from './chaturajiUi';

/** How long a "+N" stays at its seat. */
export const SCORE_GAIN_HOLD_MS = 1800;

/** A jump of more plies than this between two snapshots is a catch-up after a lost message (a resync), not a move: its points are not announced as one gain. */
const MAX_PLY_STEP = 8;

/**
 * The "+N" to show at each seat that scored with the last move (Chaturaji). Every gain is the difference between the score arrays of two consecutive positions the engine
 * (a local game) or the server (online) produced - nothing is recomputed from the move. It stays for `holdMs`, is replaced by the next gain, and is cleared at once by an
 * Undo (the ply goes down) and by a position far from the last one (a resync). The first position seen is only remembered: a rejoin or a restored game announces nothing.
 * Pass `enabled = false` for the other games and the hook does nothing.
 */
export function useScoreGains(state: Pick<FourPlayerState, 'score' | 'ply'> | null, enabled: boolean, holdMs: number = SCORE_GAIN_HOLD_MS): ScoreGain[] {
  const previous = useRef<{ score: readonly number[]; ply: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shown, setShown] = useState<ScoreGain[]>([]);

  const score = state?.score;
  const ply = state?.ply;
  useEffect(() => {
    if (score === undefined || ply === undefined) {
      previous.current = null; // no position yet (an online game still loading): the first one that arrives is only remembered
      return;
    }
    const before = previous.current;
    previous.current = { score, ply };
    if (!enabled || !before) return;
    if (ply < before.ply || ply - before.ply > MAX_PLY_STEP) {
      // Cleared at once. A hold timer still pending is left alone ON PURPOSE: when it fires it empties an already empty list, the next gain cancels it before that, and
      // unmounting cancels it too - cancelling it here as well would be an equivalent mutant (a test cannot tell the two apart), so there is no line to mutate.
      setShown([]);
      return;
    }
    const gains = scoreGains(before.score, score);
    if (gains.length === 0) return;
    if (timer.current) clearTimeout(timer.current);
    setShown(gains);
    timer.current = setTimeout(() => {
      timer.current = null;
      setShown([]);
    }, holdMs);
  }, [score, ply, enabled, holdMs]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return shown;
}
