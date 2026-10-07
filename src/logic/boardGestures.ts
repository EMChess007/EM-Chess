/**
 * The pure decisions behind the shared board touch handling (components/useBoardGestures.ts). Kept free of React Native so they can be
 * unit-tested: the PanResponder itself cannot be driven by synthetic events in a test or in the browser pane (they never produce a real
 * drag distance), which is exactly why the decision about what a finished touch MEANS lives here.
 *
 * Grid cells are DISPLAY cells (row 0 = top of the screen, col 0 = left), whatever board they belong to.
 */

// How long a hold must last before it's treated as "start drawing an arrow/highlight" instead of
// a normal tap-to-select/tap-to-move — long enough that an ordinary quick tap never triggers it.
export const LONG_PRESS_MS = 400;
// How far (in raw screen pixels) a touch may drift before the long-press timer even has a chance
// to fire and still count as "held in place" — beyond this it's read as an intentional drag
// starting immediately, not a long-press.
export const MOVE_THRESHOLD_PX = 10;

export interface Cell {
  row: number;
  col: number;
}

/** The display cell under a pixel position inside the board (clamped to the grid, so a finger slipping off the edge still lands on a cell). */
export function pixelToCell(localX: number, localY: number, squareSize: number, rows: number, cols: number): Cell {
  return {
    row: Math.min(rows - 1, Math.max(0, Math.floor(localY / squareSize))),
    col: Math.min(cols - 1, Math.max(0, Math.floor(localX / squareSize))),
  };
}

export type ReleaseDecision =
  /** An ordinary tap: select / move on `cell`. */
  | { kind: 'tap'; cell: Cell }
  /** A long-press-drag released on another cell. */
  | { kind: 'arrow'; from: Cell; to: Cell }
  /** A long-press-drag released on the cell it started on. */
  | { kind: 'highlight'; cell: Cell }
  /** An aborted drag or scroll: do nothing at all. */
  | { kind: 'ignore' };

/**
 * What a finished touch means. Whether it was STATIONARY (the finger never moved past MOVE_THRESHOLD_PX) decides everything — NOT
 * whether the long-press timer happened to fire. An earlier version branched on `armed` first, so an entirely ordinary tap that simply
 * took >= LONG_PRESS_MS to release (easy mid-move-selection, or just hesitating over which piece to pick) was silently reinterpreted
 * as an annotation gesture and never reached the tap handler. A real annotation drag always involves genuine movement; a stationary
 * release never does, however long it was held.
 */
export function decideRelease(args: { armed: boolean; distance: number; startCell: Cell; endCell: Cell }): ReleaseDecision {
  const { armed, distance, startCell, endCell } = args;
  if (distance <= MOVE_THRESHOLD_PX) return { kind: 'tap', cell: endCell };
  if (!armed) return { kind: 'ignore' };
  if (endCell.row === startCell.row && endCell.col === startCell.col) return { kind: 'highlight', cell: startCell };
  return { kind: 'arrow', from: startCell, to: endCell };
}
