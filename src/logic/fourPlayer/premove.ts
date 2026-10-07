/**
 * 4 Player Chess — the engine side of premoves (see ../premove.ts for the rules and the shared step/hook).
 *
 * A premove is `from`/`to` (absolute board squares, so it means the same thing whichever way the board is turned on screen) and, for a
 * pawn reaching its last line, the piece to promote to (chosen when the premove is queued, as in the 2-player picker). Nothing about it
 * is checked when it is queued; `resolvePremove` asks the real move generator once the turn is back.
 *
 * Everything here reads the RULES from the state (`state.rules.promotionCoord`), so a future 4-player variant with a different
 * promotion line, scoring or elimination rule needs no change: legality always comes from `findLegalMove`.
 */

import { forwardCoord, squareName, type Seat } from './board';
import { findLegalMove, type Move } from './moves';
import { BISHOP, KNIGHT, PAWN, QUEEN, ROOK, seatOf, typeOf, type FourPlayerState } from './state';

export interface FourPlayerPremove {
  from: number;
  to: number;
  /** QUEEN, ROOK, BISHOP or KNIGHT when the premove is a promotion; omitted otherwise (defaults to a queen if it turns out to be one). */
  promotion?: number;
}

/** Whether `seat` may queue a premove right now: still in the game, game not over, and not its turn (on its turn it simply moves). */
export function canPremove(state: Pick<FourPlayerState, 'status' | 'result' | 'turn'>, seat: Seat): boolean {
  return !state.result && state.status[seat] === 'active' && state.turn !== seat;
}

/** Whether moving `seat`'s piece on `from` to `to` would be a promotion, i.e. the premove needs a piece choice. */
export function isPromotionPremove(state: Pick<FourPlayerState, 'cells' | 'rules'>, seat: Seat, from: number, to: number): boolean {
  const code = state.cells[from];
  if (code <= 0 || seatOf(code) !== seat || typeOf(code) !== PAWN) return false;
  const line = state.rules.promotionCoord;
  return forwardCoord(seat, from) === line - 1 && forwardCoord(seat, to) >= line;
}

/** The legal move a premove denotes in the CURRENT position, or null if it is no longer legal (blocked, captured, pinned, in check…). */
export function resolvePremove(state: FourPlayerState, seat: Seat, premove: FourPlayerPremove): Move | null {
  return findLegalMove(state, seat, premove.from, premove.to, premove.promotion ?? QUEEN);
}

const PROMOTION_LETTER: Record<number, string> = { [QUEEN]: 'Q', [ROOK]: 'R', [BISHOP]: 'B', [KNIGHT]: 'N' };

/** "e2-e4" / "e7-e8=N" — for the "Premove queued" line. */
export function describePremove(premove: FourPlayerPremove): string {
  return `${squareName(premove.from)}-${squareName(premove.to)}${premove.promotion ? `=${PROMOTION_LETTER[premove.promotion] ?? ''}` : ''}`;
}
