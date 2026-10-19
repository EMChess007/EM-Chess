/**
 * 4 Player Chess vs 4 Player Giveaway - everything a SCREEN says or draws differently per variant, kept pure for the same reason as
 * `fourPlayerOnlineUi.ts` (the project has no renderer in its tests): titles, intro text, the status-line suffix, what the seat card counts,
 * how the result table is ranked and the one-line reason it ended. FOUR_PLAYER_GIVEAWAY_SPEC.md section 8.
 *
 * The variant of a LOCAL game is a prop; of an ONLINE game it is `view.variant` (from `four_match_found` / the rejoin and spectate answers).
 * Anything that already holds a `FourPlayerState` can read it from `state.rules.mode` - the rules travel with the position, which is why
 * `seatMetric` and `statusSuffix` need no extra argument. This file is client-only (not in the server mirror).
 */

import { SEAT_NAMES, describeResultReason, isInCheck, legalMoves, piecesLeft, variantOfRules, type FourPlayerState, type FourVariant, type Seat } from './fourPlayer';
import type { FourReason } from './fourPlayerWire';

export const variantTitle = (variant: FourVariant): string => (variant === 'giveaway' ? '4 Player Giveaway' : variant === 'chaturaji' ? 'Chaturaji' : '4 Player Chess');

/** The subtitle of the local setup / game headers. */
export const variantModeLabel = (variant: FourVariant): string => (variant === 'giveaway' ? 'Antichess' : 'Free-for-All');

/** The rule in one line, shown on the setup and queue screens. */
export const GIVEAWAY_RULE_HINT = 'Captures are mandatory — lose all your pieces to win.';

/** The intro paragraph of the local setup screen. */
export function variantIntro(variant: FourVariant): string {
  if (variant === 'chaturaji') return 'Four armies on an 8 × 8 board. Capture pieces and kings to score points — a king must actually be captured, a check need not be answered. The highest score wins once three players are out.';
  return variant === 'giveaway'
    ? 'Four players, one board. Captures are mandatory and kings are ordinary pieces — lose all your pieces, or be left with no legal move, and you win.'
    : 'Four players, one board. Checkmate players to eliminate them and score points — the highest score wins once three are out.';
}

/** The variant a position is played under (its rules travel with it). */
export const variantOfState = (state: Pick<FourPlayerState, 'rules'>): FourVariant => variantOfRules(state.rules);

/** What the seat card and the result table count: points in 4 Player Chess, PIECES LEFT in Giveaway (which has no points). */
export function seatMetric(state: Pick<FourPlayerState, 'rules' | 'score' | 'cells'>, seat: Seat): number {
  return state.rules.mode === 'giveaway' ? piecesLeft(state.cells)[seat] : state.score[seat];
}

/** The same figure in words, for the screen-reader label of a seat card. */
export function seatMetricText(state: Pick<FourPlayerState, 'rules' | 'score' | 'cells'>, seat: Seat): string {
  const n = seatMetric(state, seat);
  return state.rules.mode === 'giveaway' ? `${n} ${n === 1 ? 'piece' : 'pieces'} left` : `score ${n}`;
}

/** The squares to mark as "king in check": the kings of the active seats under attack. Never any in Giveaway (kings are ordinary pieces there). */
export function checkedKingSquares(state: FourPlayerState): number[] {
  if (state.rules.mode === 'giveaway') return [];
  const squares: number[] = [];
  for (const seat of [0, 1, 2, 3] as Seat[]) if (state.status[seat] === 'active' && isInCheck(state, seat)) squares.push(state.kings[seat]);
  return squares;
}

/**
 * The text of the Resign confirmation. `online` = the seated player's own seat (and they can keep watching); local = a hot-seat seat. 4 Player Chess keeps its two original
 * sentences exactly; Giveaway says what really happens to the pieces: they become WALLS that nobody can capture (in 4 Player Chess they stay as dead blockers that CAN be
 * captured). Found by the W5 browser pass: the online screen showed the Chess wording in a Giveaway game.
 */
export function describeResignWarning(variant: FourVariant, online: boolean): string {
  if (variant === 'giveaway') {
    return `${online ? 'Your seat' : 'This seat'} is eliminated and cannot win; its pieces stay on the board as walls that nobody can capture.${online ? ' You can keep watching until the game ends.' : ''}`;
  }
  return online
    ? 'Your seat is eliminated and its pieces stay on the board as dead blockers. You can keep watching until the game ends.'
    : 'This seat is eliminated; its pieces stay on the board as dead blockers.';
}

/** The tail of the "X to move" line: "in check!" in 4 Player Chess; in Giveaway "must capture" when the seat has a capture (so every legal move is one). */
export function statusSuffix(state: FourPlayerState, seat: Seat): string {
  if (state.rules.mode === 'giveaway') return legalMoves(state, seat).some((move) => move.captured !== 0) ? ' — must capture' : '';
  // Capture the King: an attacked king is a threat, not a check that must be answered.
  if (variantOfRules(state.rules) === 'chaturaji') return isInCheck(state, seat) ? ' — king attacked!' : '';
  return isInCheck(state, seat) ? ' — in check!' : '';
}

/**
 * The result table's order. 4 Player Chess: highest score first (ties by seat). Giveaway: the WINNER(S) first, then the others by FEWEST pieces
 * (ties by seat) - there is no second place by rule, this is just the table the spec asks for.
 */
export function rankSeats(variant: FourVariant, values: readonly number[], winners: readonly Seat[]): Seat[] {
  // EQUIVALENT-MUTANT NOTE (W3 set, "ties are not broken by seat"): the final `a - b` only spells out what a STABLE sort (guaranteed since ES2019) already does with equal keys
  // from [0, 1, 2, 3]; it is kept so the order never depends on the engine's sort.
  const seats = [0, 1, 2, 3] as Seat[];
  if (variant === 'giveaway') {
    return seats.slice().sort((a, b) => Number(winners.includes(b)) - Number(winners.includes(a)) || (values[a] ?? 0) - (values[b] ?? 0) || a - b);
  }
  return seats.slice().sort((a, b) => (values[b] ?? 0) - (values[a] ?? 0) || a - b);
}

/** The one-line reason a game ended. 4 Player Chess keeps its original wording; Giveaway names the seat that won. */
export function describeResultNote(result: { reason: FourReason; winners: readonly Seat[] }, variant: FourVariant): string {
  if (result.reason === 'abandoned') return 'Every human player left, so the game was ended with no result.';
  if (variant !== 'giveaway') return describeResultReason(result.reason);
  const winner = result.winners.length === 1 ? SEAT_NAMES[result.winners[0]] : result.winners.map((seat) => SEAT_NAMES[seat]).join(' & ');
  switch (result.reason) {
    case 'outOfPieces':
      return `${winner} lost its last piece and wins.`;
    case 'stuck':
      return `${winner} had no legal move and wins.`;
    case 'lastStanding':
      return `Everyone else resigned or ran out of time — ${winner} wins.`;
    case 'cap':
      return 'Move limit reached — fewest pieces wins.';
    default:
      return describeResultReason(result.reason);
  }
}
