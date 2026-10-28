import { act, screen } from '@testing-library/react';
import { SQUARE8, squareToGrid, type Geometry, type Seat } from '../logic/fourPlayer';

/**
 * Helpers for the screen tests (the `dom` project; see vitest.config.mts and domSetup.ts). Not a test file.
 */

interface CapturedGestures {
  squareSize: number;
  rows: number;
  cols: number;
  onTap: (cell: { row: number; col: number }) => void;
  onArrow: (from: { row: number; col: number }, to: { row: number; col: number }) => void;
  onHighlight: (cell: { row: number; col: number }) => void;
}

const gestures = (): CapturedGestures => {
  const options = (globalThis as unknown as { __boardGestures?: CapturedGestures }).__boardGestures;
  if (!options) throw new Error('no board has been rendered');
  return options;
};

/** Taps the square `name` on a board seen from `view` (a finger on that square's cell). */
export function tapSquare(name: string, view: Seat = 0, geo: Geometry = SQUARE8): void {
  const square = geo.parseSquare(name);
  if (square < 0) throw new Error(`not a square: ${name}`);
  const cell = squareToGrid(square, view, geo);
  act(() => gestures().onTap(cell));
}

/** `from` then `to`: a tap-to-move. */
export function tapMove(from: string, to: string, view: Seat = 0, geo: Geometry = SQUARE8): void {
  tapSquare(from, view, geo);
  tapSquare(to, view, geo);
}

/** The cell of a square by its accessibility label ("d4, Red pawn, can move here" / "d4"). */
export const cellOf = (name: string): HTMLElement => screen.getByLabelText(new RegExp(`^${name}(,|$)`));
export const maybeCellOf = (name: string): HTMLElement | null => screen.queryByLabelText(new RegExp(`^${name}(,|$)`));

/** The squares currently offered as moves (the legal-move dots), by name. */
export function offeredSquares(): string[] {
  return screen
    .queryAllByLabelText(/can move here/)
    .map((el) => /^([a-h][1-8])/.exec(el.getAttribute('aria-label') ?? '')?.[1] ?? '')
    .sort();
}

/** The text of a seat card (the strip's `seat-N` view): name, score, clock, who plays it, status. */
export const seatCard = (seat: number): HTMLElement => screen.getByTestId(`seat-${seat}`);

// --- Bughouse: several boards on one screen --------------------------------------------------------------------------------------------------

/** Taps `square` on Bughouse board `board`, drawn with `orientation` at the bottom (a finger on that square's cell). The board must be named: the screen has two. */
export function tapBoardSquare(board: 'A' | 'B', square: string, orientation: 'w' | 'b'): void {
  const registry = (globalThis as unknown as { __boardGesturesByKey?: Record<string, CapturedGestures> }).__boardGesturesByKey;
  const options = registry?.[board];
  if (!options) throw new Error(`no board ${board} has been rendered`);
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  const cell = orientation === 'w' ? { row: 8 - rank, col: file } : { row: rank - 1, col: 7 - file };
  act(() => options.onTap(cell));
}

// --- Bughouse, humans on both boards: raw touches with identifiers (W3b) -------------------------------------------------------------------------

export interface FakeTouch {
  /** The touch identifier (what separates one finger from the other). */
  id: number;
  /** Page coordinates. */
  x: number;
  y: number;
}

/**
 * Delivers a DOM touch event to `element` carrying `touches` in `changedTouches`. jsdom has no `Touch`, so the list is attached to the event itself; react-native-web hands the DOM event
 * to the view's `onTouchStart` / `Move` / `End` / `Cancel`, which read `changedTouches[i].identifier / pageX / pageY` exactly as they do on a phone.
 */
export function fireTouch(type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel', element: Element, touches: FakeTouch[]): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const list = touches.map((t) => ({ identifier: t.id, pageX: t.x, pageY: t.y, clientX: t.x, clientY: t.y, screenX: t.x, screenY: t.y, target: element }));
  Object.defineProperty(event, 'changedTouches', { value: list });
  Object.defineProperty(event, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : list });
  act(() => {
    element.dispatchEvent(event);
  });
}

/** A mouse press or release (a pointer event of type "mouse") at page coordinates. */
export function fireMouse(type: 'pointerdown' | 'pointerup' | 'pointercancel', element: Element, point: { x: number; y: number }, button = 0): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({ pointerType: 'mouse', pageX: point.x, pageY: point.y, clientX: point.x, clientY: point.y, button, pointerId: 1 })) Object.defineProperty(event, key, { value });
  act(() => {
    element.dispatchEvent(event);
  });
}

/** jsdom has no layout: this gives `element` the on-screen rectangle a browser would (its top-left corner at (left, top), `size` px square). */
export function placeElement(element: Element, left: number, top: number, size: number): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left, top, right: left + size, bottom: top + size, x: left, y: top, width: size, height: size, toJSON: () => ({}) }),
  });
}

/**
 * Resizes the jsdom window the screens read their size from. react-native-web's Dimensions reads `document.documentElement.clientWidth / clientHeight` (jsdom reports 0 for both, so
 * every dom test that does not call this runs in a 0 x 0 window) and follows the `resize` event.
 */
export function setWindowSize(width: number, height: number): void {
  act(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width });
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height });
    window.dispatchEvent(new Event('resize'));
  });
}
