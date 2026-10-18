import type { ChessEngine } from './ChessEngine';
import { getGiveawayMoves } from './giveaway';
import { legalMoves, squareName, type FourPlayerState, type Seat } from './fourPlayer';

// Giveaway (Antichess), 2-player and 4 Player: a capture is MANDATORY. When one exists the side to move may play only captures, so
// most of its pieces "do nothing" when tapped - which, with no explanation, looked like a frozen game. These are the pure helpers behind
// the three hints every Giveaway screen now shows (see MandatoryCaptureBanner, Square's capturer ring, FourPlayerBoard's cell ring):
// which squares hold a piece that can capture, whether a capture is forced, and the two wordings. No rule is decided here: the sets
// come straight from getGiveawayMoves / the 4 Player legalMoves, the same lists the rules and the bots use.

/** The persistent status ("Your turn — Capture is mandatory"). */
export const CAPTURE_MANDATORY_TEXT = 'Capture is mandatory';
/** Shown for a few seconds after the player taps one of their pieces that cannot move because a capture is mandatory. */
export const CAPTURE_BLOCKED_TEXT = 'A capture is mandatory — highlighted pieces can capture';
/** The ring around a piece that can capture: an amber ring inside a thin dark outline. The outline is what keeps it visible on every board theme
 * (amber alone is only ~1.4-2.4:1 against the Classic / Wood / Green / Ocean / Marble squares; the dark outline is >= 4:1 on all of them). */
export const CAPTURER_RING_COLOR = '#ff9800';
export const CAPTURER_OUTLINE_COLOR = 'rgba(0,0,0,0.7)';
/** How long the tap message replaces the status. */
export const CAPTURE_NUDGE_MS = 3200;

/** 2-player Giveaway: the squares of the side-to-move's pieces that can capture - empty when no capture is available (nothing is forced). */
export function getGiveawayCapturingSquares(engine: ChessEngine): string[] {
  const legal = getGiveawayMoves(engine);
  if (!legal.some((m) => m.captured)) return [];
  return [...new Set(legal.map((m) => m.from))];
}

/** 4 Player Giveaway: the squares (as engine indexes) of `seat`'s pieces that can capture - empty when no capture is available or in 4 Player Chess. */
export function fourPlayerCapturingSquares(state: FourPlayerState, seat: Seat): number[] {
  if (state.rules.mode !== 'giveaway') return [];
  const legal = legalMoves(state, seat);
  if (!legal.some((m) => m.captured !== 0)) return [];
  return [...new Set(legal.map((m) => m.from))];
}

/** The same set by square name ("e4"), for logs and tests. */
export function fourPlayerCapturingSquareNames(state: FourPlayerState, seat: Seat): string[] {
  return fourPlayerCapturingSquares(state, seat).map(squareName);
}
