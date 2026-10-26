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
