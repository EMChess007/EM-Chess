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
  /** Where the touch began in the GRID's own frame (from the touch's `locationX / locationY`, see `TouchEventIn`), when the platform gave it. */
  readonly startLocal?: Point;
  /** The touch moved further than TAP_MAX_DRIFT_PX at some point: whatever it does after, it is not a tap. */
  readonly drifted: boolean;
}

/** One board's touches in flight, by identifier. */
export type TouchBook = Readonly<Record<string, TrackedTouch>>;

export const EMPTY_TOUCH_BOOK: TouchBook = {};

/**
 * `at` is the touch's PAGE point (what the platform calls pageX / pageY: relative to the app's root view). `local`, when given, is the same point in the board GRID's own frame
 * (locationX / locationY of a touch whose target is the grid's overlay view): it needs no origin, so no window, status-bar, navigation-bar, header or scroll offset can enter it.
 */
export type TouchEventIn =
  | { kind: 'start'; id: string; at: Point; target: TouchTarget; local?: Point }
  | { kind: 'move'; id: string; at: Point; local?: Point }
  | { kind: 'end'; id: string; at: Point; local?: Point }
  | { kind: 'cancel'; id: string };

export interface Tap {
  target: TouchTarget;
  start: Point;
  end: Point;
  /** Both ends in the grid's own frame - present only when BOTH the start and the lift reported them (never one of each: a point in one frame and a point in another is the bug). */
  startLocal?: Point;
  endLocal?: Point;
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
  if (event.kind === 'start') {
    const tracked: TrackedTouch = { target: event.target, start: event.at, drifted: false, ...(event.local ? { startLocal: event.local } : {}) };
    return { book: { ...book, [event.id]: tracked }, tap: null };
  }
  const tracked = book[event.id];
  if (tracked === undefined) return { book, tap: null };
  if (event.kind === 'cancel') return { book: without(book, event.id), tap: null };
  if (event.kind === 'move') {
    if (tracked.drifted || distance(tracked.start, event.at) <= TAP_MAX_DRIFT_PX) return { book, tap: null };
    return { book: { ...book, [event.id]: { ...tracked, drifted: true } }, tap: null };
  }
  const rest = without(book, event.id);
  if (tracked.drifted || distance(tracked.start, event.at) > TAP_MAX_DRIFT_PX) return { book: rest, tap: null };
  const locals = tracked.startLocal && event.local ? { startLocal: tracked.startLocal, endLocal: event.local } : {};
  return { book: rest, tap: { target: tracked.target, start: tracked.start, end: event.at, ...locals } };
}

/**
 * The grid-frame position of a touch delivered to the grid's overlay view (its target by construction: the overlay is on top of every cell and carries these handlers alone): its
 * `locationX / locationY`, or undefined when the platform gave none (a non-finite or missing number: the page path decides instead).
 */
export function localOfTouch(touch: { locationX?: unknown; locationY?: unknown }): Point | undefined {
  const { locationX, locationY } = touch;
  if (typeof locationX !== 'number' || typeof locationY !== 'number' || !Number.isFinite(locationX) || !Number.isFinite(locationY)) return undefined;
  return { x: locationX, y: locationY };
}

// --- Which frame the grid's position comes from -------------------------------------------------------------------------------------------------

export type OriginSource = 'rect' | 'measure' | 'none';

/**
 * Where a page-coordinate origin of the grid may be read from, given the platform and what the grid's node offers. The touch's `pageX / pageY` are relative to the app's ROOT VIEW on a phone
 * (react-native's TouchesHelper) and to the document on web. The two readings a node can give:
 *   - `getBoundingClientRect()`: on the web the rectangle in the same frame as the touch. On a phone with React Native's new architecture a View ref ALSO has this method (ReactNativeElement), but there
 *     it is in WINDOW coordinates - the root view's own position in the window is added, minus the status bar and cutout insets when edge-to-edge is off (`RootViewUtil.getViewportOffset`), which is
 *     NEGATIVE for an app that draws under a translucent status bar. Subtracting it from a root-frame touch lands every tap that many dp too low: the Bughouse bug (b2 selected b1).
 *   - `measure()`: pageX / pageY of the layout in the ROOT frame (no viewport offset): the same frame as the touch.
 * So the rectangle is trusted on the web only; a phone uses `measure`, and when it has neither there is no origin (the local frame, `gridTapCell`, needs none).
 */
export function originSource(os: string, hasRect: boolean, hasMeasure: boolean): OriginSource {
  if (os === 'web') return hasRect ? 'rect' : hasMeasure ? 'measure' : 'none';
  return hasMeasure ? 'measure' : 'none';
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
  // The grid's own frame when the touch reported it (a phone): no origin, so nothing outside the grid can shift the answer. Otherwise the page points minus the measured origin.
  if (tap.startLocal && tap.endLocal) {
    const zero: Point = { x: 0, y: 0 };
    if (!insideGrid(tap.startLocal, zero, width, height) || !insideGrid(tap.endLocal, zero, width, height)) return null;
    return pixelToCell(tap.endLocal.x, tap.endLocal.y, cell, rows, cols);
  }
  if (!insideGrid(tap.start, origin, width, height) || !insideGrid(tap.end, origin, width, height)) return null;
  return pixelToCell(tap.end.x - origin.x, tap.end.y - origin.y, cell, rows, cols);
}

/**
 * The cell a finger is on RIGHT NOW (the dev touch-debug overlay): in the grid's own frame, or null when it is outside the grid. The same decision as a tap's, for one point.
 */
export function fingerCell(local: Point, cell: number, rows: number, cols: number): Cell | null {
  if (!insideGrid(local, { x: 0, y: 0 }, cell * cols, cell * rows)) return null;
  return pixelToCell(local.x, local.y, cell, rows, cols);
}
