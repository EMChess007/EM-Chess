import { useCallback, useEffect, useRef, useState } from 'react';
import { noticeAfterTurnChange, stepPremove, type PremoveCancelReason } from './premove';

interface UsePremoveOptions<I, M> {
  isMyTurn: boolean;
  canStillPlay: boolean;
  gameOver: boolean;
  /** The engine's verdict on an intent in the current position (the legal move it denotes, or null). Always read fresh. */
  resolve: (intent: I) => M | null;
  /** Plays a resolved move exactly as if the player had just made it. Always read fresh (it closes over the current position). */
  play: (move: M) => void;
}

/**
 * The single premove slot for one local player (see premove.ts for the rules). Returns the queued intent, `queue` (replaces any queued
 * premove), `cancel`, and — when a premove was dropped because it was no longer legal / the player was eliminated — `cancelReason` so
 * the screen can tell the player. The notice for an illegal premove stays up while it is the player's turn to move and goes away once
 * they have moved (the 2-player screens keep it until the next premove or cancel; with three other seats moving, that would leave a
 * stale message on screen for rounds).
 */
export function usePremove<I, M>({ isMyTurn, canStillPlay, gameOver, resolve, play }: UsePremoveOptions<I, M>) {
  const [premove, setPremove] = useState<I | null>(null);
  const [cancelReason, setCancelReason] = useState<PremoveCancelReason | null>(null);

  // resolve/play close over the current position; the effect below must act on the render it fires in, not a stale one.
  const latest = useRef({ resolve, play });
  latest.current = { resolve, play };

  const queue = useCallback((intent: I) => {
    setPremove(intent);
    setCancelReason(null);
  }, []);
  const cancel = useCallback(() => {
    setPremove(null);
    setCancelReason(null);
  }, []);

  useEffect(() => {
    const step = stepPremove({ intent: premove, isMyTurn, canStillPlay, gameOver, resolve: latest.current.resolve });
    if (step.kind === 'play') {
      setPremove(null);
      latest.current.play(step.move);
    } else if (step.kind === 'cancel') {
      setPremove(null);
      if (step.reason) setCancelReason(step.reason);
    }
  }, [premove, isMyTurn, canStillPlay, gameOver]);

  // An "illegal" notice is about the turn that just started; once the player has moved on it is stale.
  useEffect(() => {
    setCancelReason((reason) => noticeAfterTurnChange(reason, isMyTurn));
  }, [isMyTurn]);

  return { premove, queue, cancel, cancelReason };
}
