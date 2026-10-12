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
 * This mode's POSITION EPOCH for the app-wide annotation invariant (logic/annotationLifecycle.ts): arrows and highlights are cleared when a
 * move is played and at no other time. `ply` is incremented in exactly one place — `applyMoveRaw`, which both a real move and an
 * eliminated king's random walk go through — so it changes for every move, and does NOT change on any turn advance that plays no move: a
 * seat skipped (frozen), eliminated at its turn (checkmate / stalemate found by `advance`), resigning, or running out of time. Undo lowers
 * it, which is right: the position the arrows described is gone. It must never be replaced by anything turn-based (whose turn it is, who
 * just moved), which would clear on those no-move paths.
 */
export function positionEpoch(state: Pick<FourPlayerState, 'ply'>): number {
  return state.ply;
}

/** Toggles a highlighted square; a cut-corner cell (null) changes nothing. */
export function toggleHighlight(highlights: readonly number[], square: number | null): readonly number[] {
  if (square === null) return highlights;
  return highlights.includes(square) ? highlights.filter((s) => s !== square) : [...highlights, square];
}
