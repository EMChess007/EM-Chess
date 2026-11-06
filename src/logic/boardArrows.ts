/**
 * FINGER-DRAWN ARROWS, the rules that are the same on every board of the app (command #32). The user's rules, in one place:
 *   - THE GESTURE (one, everywhere): HOLD a finger still on a square for LONG_PRESS_MS, then DRAG it to another square and lift = an arrow from the first to the second. Lifting on the square the
 *     drag began on = a highlight of that square (toggled). A quick tap is the move input and never draws anything; a drag that starts moving before the hold is over is nothing at all
 *     (a scroll or a slide), and a hold that never moves is the ordinary tap (`decideRelease`, logic/boardGestures.ts: the distance decides, never the timer).
 *   - ANY TURN: arrows are drawn on the player's own turn and on the opponent's; whose turn it is changes nothing here.
 *   - SEVERAL ARROWS can be on a board at once (drawing the same one again adds it again, as on the 2-player and 4-seat boards today; a highlight toggles).
 *   - THEY STAY until a MOVE is played on THAT board, then all of them are cleared (logic/annotationLifecycle.ts: the board's own position epoch, never the turn).
 *   - DRAWING NEVER MOVES: the gesture reaches the move input only as the ordinary tap it is not (a drag longer than a tap's drift is never a tap).
 *
 * This file is the PURE part used by the Bughouse boards (squares as text, per board) and by the raw-touch layer (components/useBoardTouches.ts: several fingers, tracked by identifier). The
 * 2-player board keeps display cells and the 4-seat boards absolute square numbers (logic/fourPlayer/annotations.ts); all three speak `decideRelease`.
 */
import { decideRelease, MOVE_THRESHOLD_PX, type Cell, type ReleaseDecision } from './boardGestures';

export interface SquareArrow {
  readonly from: string;
  readonly to: string;
}

/** One board's finger-drawn marks, as ABSOLUTE squares ("e4"): a board that is turned over (pass and play) keeps pointing at the same squares. */
export interface SquareMarks {
  readonly arrows: readonly SquareArrow[];
  readonly highlights: readonly string[];
}

export const NO_MARKS: SquareMarks = { arrows: [], highlights: [] };

/** Adds an arrow; a degenerate one (same square, or a missing end) changes nothing. Drawing the same arrow twice adds it twice, like the other boards. */
export function addSquareArrow(marks: SquareMarks, from: string | null, to: string | null): SquareMarks {
  if (from === null || to === null || from === to) return marks;
  return { ...marks, arrows: [...marks.arrows, { from, to }] };
}

/** Toggles a highlighted square. */
export function toggleSquareHighlight(marks: SquareMarks, square: string | null): SquareMarks {
  if (square === null) return marks;
  return { ...marks, highlights: marks.highlights.includes(square) ? marks.highlights.filter((s) => s !== square) : [...marks.highlights, square] };
}

export const hasMarks = (marks: SquareMarks): boolean => marks.arrows.length > 0 || marks.highlights.length > 0;

// --- Several fingers: the arming of each touch, by identifier ---------------------------------------------------------------------------------------------

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** One finger that began on a board's grid. `armed`: it was held still for LONG_PRESS_MS. `drifted`: it moved past the tap drift BEFORE that, so it can never arm. */
export interface ArrowTouch {
  readonly start: Point;
  readonly startCell: Cell;
  readonly armed: boolean;
  readonly drifted: boolean;
}

/** One board's fingers, by identifier. */
export type ArrowBook = Readonly<Record<string, ArrowTouch>>;

export const EMPTY_ARROW_BOOK: ArrowBook = {};

/** Points are in the grid's own frame (px), so a start and an end are always comparable. */
export type ArrowEvent =
  | { kind: 'start'; id: string; at: Point; cell: Cell }
  | { kind: 'arm'; id: string }
  | { kind: 'move'; id: string; at: Point }
  | { kind: 'end'; id: string; at: Point; cell: Cell }
  | { kind: 'cancel'; id: string };

export interface ArrowStep {
  book: ArrowBook;
  /** An arrow or a highlight this event completed (a tap and an aborted drag are NOT reported here: the tap layer owns the first and the second is nothing). */
  outcome: Extract<ReleaseDecision, { kind: 'arrow' | 'highlight' }> | null;
}

const without = (book: ArrowBook, id: string): ArrowBook => {
  const rest: Record<string, ArrowTouch> = { ...book };
  delete rest[id];
  return rest;
};

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * One touch event of one board. An identifier this book never saw begin changes nothing; a finger that drifted before the hold was over never arms (`arm` after it is ignored); a cancelled
 * finger is forgotten without an effect. The meaning of a lift is `decideRelease`'s, so it is the very rule the other boards use.
 */
export function stepArrowTouches(book: ArrowBook, event: ArrowEvent): ArrowStep {
  if (event.kind === 'start') return { book: { ...book, [event.id]: { start: event.at, startCell: event.cell, armed: false, drifted: false } }, outcome: null };
  const tracked = book[event.id];
  if (tracked === undefined) return { book, outcome: null };
  if (event.kind === 'cancel') return { book: without(book, event.id), outcome: null };
  if (event.kind === 'arm') return tracked.drifted || tracked.armed ? { book, outcome: null } : { book: { ...book, [event.id]: { ...tracked, armed: true } }, outcome: null };
  if (event.kind === 'move') {
    if (tracked.armed || tracked.drifted || distance(tracked.start, event.at) <= MOVE_THRESHOLD_PX) return { book, outcome: null };
    return { book: { ...book, [event.id]: { ...tracked, drifted: true } }, outcome: null };
  }
  const decision = decideRelease({ armed: tracked.armed, distance: distance(tracked.start, event.at), startCell: tracked.startCell, endCell: event.cell });
  return { book: without(book, event.id), outcome: decision.kind === 'arrow' || decision.kind === 'highlight' ? decision : null };
}
