import { useEffect, useRef, useState } from 'react';
import { annotationsSurvive, type PositionEpoch } from './annotationLifecycle';

/**
 * TRANSIENT NOTICES (command #34): a one-off message about something that just happened ("Premove was no longer legal — cancelled.", a
 * refused move, a declined draw offer, "the piece is no longer in your pocket") is true for a moment and then stale. The phone showed the
 * 2-player "premove cancelled" line for DOZENS of moves, because the 2-player screens cleared it only on the next premove or Cancel.
 *
 * THE RULE, for every board that shows such a line: it goes away on the NEXT MOVE by either side (the position epoch changed - the same
 * epoch the annotations use, logic/annotationLifecycle.ts: the FEN for the classic boards, the ply for the 4-seat games) OR after
 * NOTICE_TTL_MS, whichever comes first. A notice that is shown again (a different text, or cleared and set again) restarts the timer.
 *
 * Not for STATE that stays true (an engine error, "this game is no longer available", a queued premove while it is queued): those are not
 * one-off messages and keep their own lifetime.
 */

/** "A few seconds": long enough to read a sentence, short enough that it is gone before the next ply of a fast game. */
export const NOTICE_TTL_MS = 5000;

/** Whether a notice value means "something is shown": null / undefined / false / '' mean nothing. */
export function hasNotice(notice: unknown): boolean {
  return notice !== null && notice !== undefined && notice !== false && notice !== '';
}

/**
 * For a message that lives OUTSIDE the screen (a reducer's `actionError`, a wrapper's `resignError`): returns it while it should be shown
 * and null once the position changed or NOTICE_TTL_MS passed. The same text is shown again when its owner clears it (null) and sets it again.
 */
export function useExpiringNotice(notice: string | null, epoch: PositionEpoch, ttlMs: number = NOTICE_TTL_MS): string | null {
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    if (notice === null && dismissed !== null) setDismissed(null);
  }, [notice, dismissed]);
  const shown = notice !== null && notice !== dismissed ? notice : null;
  useTransientNotice(shown, epoch, () => setDismissed(notice), ttlMs);
  return shown;
}

/**
 * Calls `clear` when `notice` is shown and (a) the position `epoch` then changes, or (b) NOTICE_TTL_MS passes. `clear` is read fresh, so
 * it may close over the screen's setters. The epoch is recorded when the notice APPEARS, so a notice that is set in the render right after
 * a move (a premove that failed to resolve against the move that gave the turn) survives that move and goes at the next one.
 */
export function useTransientNotice(notice: unknown, epoch: PositionEpoch, clear: () => void, ttlMs: number = NOTICE_TTL_MS): void {
  const latestClear = useRef(clear);
  latestClear.current = clear;
  const shown = hasNotice(notice);
  const epochWhenShown = useRef(epoch);

  // The timer: armed whenever a notice appears or changes, dropped when it goes.
  useEffect(() => {
    if (!shown) return undefined;
    epochWhenShown.current = epoch;
    const timer = setTimeout(() => latestClear.current(), ttlMs);
    return () => clearTimeout(timer);
    // `epoch` is deliberately not a dependency: a move must not re-arm the timer (the epoch effect below clears instead).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, notice, ttlMs]);

  // The move: the notice was about the position it appeared on.
  useEffect(() => {
    if (shown && !annotationsSurvive(epochWhenShown.current, epoch)) latestClear.current();
  }, [epoch, shown]);
}
