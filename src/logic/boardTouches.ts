/**
 * Bughouse W3b (BUGHOUSE_SPEC.md HP12): the PURE part of the per-board raw-touch input layer. React Native's responder system (and react-native-web's) grants ONE responder at a time, so a second
 * finger on the other board is ignored or steals the first board's gesture; the dual-board Local layout therefore does not use the responder system on its boards. Each board listens to plain
 * touch events instead (components/useBoardTouches.ts), and this file decides what those events MEAN:
 *   - every touch is tracked by its `identifier`; a touch belongs to the board (and the target on it) where it BEGAN and to nobody else - a book of touches is one board's, and no event of
 *     another board is ever fed to it;
 *   - a tap is a touch that ends within TAP_MAX_DRIFT_PX of where it began and never wandered further in between (a drag, a scroll or a hand sliding across is nothing);
 *   - a tap on the GRID counts only if it starts AND ends inside that board's own grid: the margin around a board and the gutter between the two boards are a dead zone;
 *   - a cancelled touch (the system took it, a scroll started) is forgotten without an effect.
 * Points are PAGE coordinates (what a touch reports); the grid test and the cell come from the board's own origin and cell size. No React, no engine, no clock.
 */
import { pixelToCell, type Cell } from './boardGestures';

/** How far (px) a touch may move between its start and its end, and still be a tap. Not larger than a finger's natural wobble, not smaller than a cell on the smallest board (28 px). */
export const TAP_MAX_DRIFT_PX = 10;

export interface Point {
  x: number;
  y: number;
}

/** What a touch began on, as the screen names it: the grid of the board, one pocket chip (the piece letter), or one button of the board's promotion bar (a piece letter, or "cancel"). */
export type TouchTarget = { kind: 'grid' } | { kind: 'chip'; piece: string } | { kind: 'promotion'; choice: string };

export interface TrackedTouch {
  readonly target: TouchTarget;
  readonly start: Point;
  /** The touch moved further than TAP_MAX_DRIFT_PX at some point: whatever it does after, it is not a tap. */
  readonly drifted: boolean;
}

/** One board's touches in flight, by identifier. */
export type TouchBook = Readonly<Record<string, TrackedTouch>>;

export const EMPTY_TOUCH_BOOK: TouchBook = {};

export type TouchEventIn =
  | { kind: 'start'; id: string; at: Point; target: TouchTarget }
  | { kind: 'move'; id: string; at: Point }
  | { kind: 'end'; id: string; at: Point }
  | { kind: 'cancel'; id: string };

export interface Tap {
  target: TouchTarget;
  start: Point;
  end: Point;
}

export interface TouchStep {
  book: TouchBook;
  /** The tap this event completed, if any. */
  tap: Tap | null;
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

const without = (book: TouchBook, id: string): TouchBook => {
  const rest: Record<string, TrackedTouch> = { ...book };
  delete rest[id];
  return rest;
};

/**
 * One touch event of one board. An event for an identifier this book never saw begin (a touch that started on another board, or before the board mounted) changes nothing and taps nothing.
 */
export function stepTouches(book: TouchBook, event: TouchEventIn): TouchStep {
  if (event.kind === 'start') return { book: { ...book, [event.id]: { target: event.target, start: event.at, drifted: false } }, tap: null };
  const tracked = book[event.id];
  if (tracked === undefined) return { book, tap: null };
  if (event.kind === 'cancel') return { book: without(book, event.id), tap: null };
  if (event.kind === 'move') {
    if (tracked.drifted || distance(tracked.start, event.at) <= TAP_MAX_DRIFT_PX) return { book, tap: null };
    return { book: { ...book, [event.id]: { ...tracked, drifted: true } }, tap: null };
  }
  const rest = without(book, event.id);
  if (tracked.drifted || distance(tracked.start, event.at) > TAP_MAX_DRIFT_PX) return { book: rest, tap: null };
  return { book: rest, tap: { target: tracked.target, start: tracked.start, end: event.at } };
}

// --- The grid: the dead zone and the cell -----------------------------------------------------------------------------------------------------

/** Whether the page point lies inside the grid of `width` x `height` px whose top-left corner is `origin` (the left and top edges belong to it, the right and bottom edges do not). */
export function insideGrid(point: Point, origin: Point, width: number, height: number): boolean {
  const x = point.x - origin.x;
  const y = point.y - origin.y;
  return x >= 0 && y >= 0 && x < width && y < height;
}

/**
 * The display cell a tap on a board's grid hit, or null when it is nowhere: BOTH ends must lie inside this board's own grid (a tap that began in the margin or the gutter, or that ended
 * outside, is the dead zone and counts for nothing). `cell` is the side of one square in px; the grid is `rows` x `cols` squares.
 */
export function gridTapCell(tap: Tap, origin: Point, cell: number, rows: number, cols: number): Cell | null {
  const width = cell * cols;
  const height = cell * rows;
  if (!insideGrid(tap.start, origin, width, height) || !insideGrid(tap.end, origin, width, height)) return null;
  return pixelToCell(tap.end.x - origin.x, tap.end.y - origin.y, cell, rows, cols);
}
