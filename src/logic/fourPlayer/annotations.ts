/**
 * 4 Player Chess — board annotations (arrows and highlighted squares) and where they are drawn.
 *
 * THE ONE DIFFERENCE FROM THE 2-PLAYER BOARD: annotations are stored as ABSOLUTE squares, not as the grid cells they were drawn on.
 * The 2-player board keeps display cells (row/col as drawn) and can get away with it because it wipes them on every position change
 * and its orientation never changes mid-game. This board has a Rotate button (and a different bottom seat per player), and the same
 * arrow must keep pointing at the same real squares after a rotation — so an arrow drawn on a screen turned for seat A is mapped to
 * squares with `gridToSquare(…, A)` once, and every later render maps it back with `squareToGrid(…, currentViewSeat)`.
 *
 * Display convention (matches the board component): `row` 0 is the TOP of the screen, `col` 0 the LEFT; `toDisplay`/`fromDisplay` use
 * dy upward, so row = SIZE - 1 - dy. The four 3 x 3 corners are not squares: a gesture that starts or ends in one draws nothing.
 */

import { SIZE, VALID, fromDisplay, index, toDisplay, fileOf, rankOf, type Seat } from './board';
import { canPremove } from './premove';
import type { FourPlayerState } from './state';

export interface GridCell {
  row: number;
  col: number;
}

export interface SquareArrow {
  from: number;
  to: number;
}

/** The screen cell where `square` is drawn when `viewSeat` is at the bottom. */
export function squareToGrid(square: number, viewSeat: Seat): GridCell {
  const [dx, dy] = toDisplay(fileOf(square), rankOf(square), viewSeat);
  return { row: SIZE - 1 - dy, col: dx };
}

/** The square under a screen cell when `viewSeat` is at the bottom, or null for one of the four cut corners. */
export function gridToSquare(cell: GridCell, viewSeat: Seat): number | null {
  const [file, rank] = fromDisplay(cell.col, SIZE - 1 - cell.row, viewSeat);
  const square = index(file, rank);
  return VALID[square] ? square : null;
}

/** Appends an arrow (like the 2-player board, drawing the same arrow twice simply adds it again). Returns the same list for a degenerate arrow. */
export function addArrow(arrows: readonly SquareArrow[], from: number | null, to: number | null): readonly SquareArrow[] {
  if (from === null || to === null || from === to) return arrows;
  return [...arrows, { from, to }];
}

/**
 * Whether arrows and highlights should SURVIVE the position change that just happened. The 2-player board wipes them on every move; here
 * three seats move between the player's turns, so a plan drawn while waiting would vanish after the very next bot move. They are kept
 * while the player is WAITING (still in the game, not their turn, game not over) and the change was another seat's move. They are wiped
 * when the player's own turn starts, when the player has just moved themselves, when they are out, when the game ends, and always when
 * there is no single waiting player (hotseat: nobody is "waiting", so it behaves like the 2-player board).
 * `previousMover` is the seat that was to move in the position that was just replaced.
 */
export function keepAnnotationsAfterMove(waitingSeat: Seat | undefined, previousMover: Seat, next: Pick<FourPlayerState, 'status' | 'result' | 'turn'>): boolean {
  return waitingSeat !== undefined && previousMover !== waitingSeat && canPremove(next, waitingSeat);
}

/** Toggles a highlighted square; a cut-corner cell (null) changes nothing. */
export function toggleHighlight(highlights: readonly number[], square: number | null): readonly number[] {
  if (square === null) return highlights;
  return highlights.includes(square) ? highlights.filter((s) => s !== square) : [...highlights, square];
}
