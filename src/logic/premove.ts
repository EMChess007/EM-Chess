/**
 * Premove — the engine-agnostic part, shared by every board that offers it (today the 4 Player board; the 2-player screens keep their own
 * inline copy of the same rules, see below).
 *
 * THE RULES (identical to the 2-player BotGameScreen / OnlineGameScreen, which this was lifted from):
 *   - ONE premove at a time. Queueing a new one REPLACES the old one (there is no chain/queue); a Cancel button drops it.
 *   - It is only an intent (from / to / promotion piece). Nothing is previewed or validated when it is queued: whether it is still
 *     legal can only be known once it is actually that player's turn.
 *   - The moment the turn comes back the intent is validated by the real engine. If it is legal it is played exactly as if the player
 *     had just made that move; if not it is CANCELLED and the player is told ("Premove was no longer legal — cancelled."). It is never
 *     forced through and never fails silently.
 *
 * WHAT 4 PLAYERS ADDS: three seats move before the turn comes back (not one), so a premove is much likelier to be stale — the target
 * path blocked by another seat's piece, your piece captured, newly pinned, your king in check — and you can also be ELIMINATED (or the
 * game can end) while waiting, in which case your turn never comes. `stepPremove` is the one place those cases are decided.
 *
 * Pure on purpose (no React, no engine): `stepPremove` is unit-tested directly, `usePremove` is only the state + effect around it.
 */

/** Why a queued premove was dropped without being played. (A premove dropped because the game ended is cancelled silently.) */
export type PremoveCancelReason = 'illegal' | 'eliminated';

export const PREMOVE_ILLEGAL_MESSAGE = 'Premove was no longer legal — cancelled.';
export const PREMOVE_ELIMINATED_MESSAGE = 'Premove cancelled — you are out of the game.';

export function describePremoveCancel(reason: PremoveCancelReason): string {
  return reason === 'illegal' ? PREMOVE_ILLEGAL_MESSAGE : PREMOVE_ELIMINATED_MESSAGE;
}

/**
 * What the "your premove was cancelled" notice should show after the turn changed. An ILLEGAL-premove notice is about the turn that just
 * started, so it goes away once the player has moved on (the 2-player screens keep it until the next premove or cancel; with three other
 * seats moving that would leave a stale message on screen for rounds). An ELIMINATED notice stays: the player is out for good.
 */
export function noticeAfterTurnChange(reason: PremoveCancelReason | null, isMyTurn: boolean): PremoveCancelReason | null {
  return !isMyTurn && reason === 'illegal' ? null : reason;
}

export type PremoveStep<M> =
  /** Nothing is queued. */
  | { kind: 'idle' }
  /** Queued, and the turn has not come back yet. */
  | { kind: 'wait' }
  /** It is the player's turn and the premove is legal: play this move. */
  | { kind: 'play'; move: M }
  /** Drop the premove. `reason` is what to tell the player, or null for a silent drop (the game is over). */
  | { kind: 'cancel'; reason: PremoveCancelReason | null };

export interface PremoveContext<I, M> {
  /** The queued intent, if any. */
  intent: I | null;
  /** Whether the turn is currently the premoving player's. */
  isMyTurn: boolean;
  /** Whether the player can still ever move again (false once eliminated). */
  canStillPlay: boolean;
  gameOver: boolean;
  /** The real engine's verdict on the intent in the CURRENT position: the legal move it denotes, or null if it is not legal now. */
  resolve: (intent: I) => M | null;
}

/** What to do with the queued premove right now. Order matters: game over, then eliminated, then "not yet", then the legality check. */
export function stepPremove<I, M>({ intent, isMyTurn, canStillPlay, gameOver, resolve }: PremoveContext<I, M>): PremoveStep<M> {
  if (intent === null) return { kind: 'idle' };
  if (gameOver) return { kind: 'cancel', reason: null };
  if (!canStillPlay) return { kind: 'cancel', reason: 'eliminated' };
  if (!isMyTurn) return { kind: 'wait' };
  const move = resolve(intent);
  return move ? { kind: 'play', move } : { kind: 'cancel', reason: 'illegal' };
}
