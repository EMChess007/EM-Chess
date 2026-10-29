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

/**
 * The style a rendered element ends up with. react-native-web turns a StyleSheet into atomic classes in an injected stylesheet, and jsdom's `getComputedStyle` does not apply
 * those: this reads the declarations of every class the element carries (and its inline style) from the document's stylesheets, later rules winning.
 */
export function declaredStyle(el: HTMLElement): Record<string, string> {
  const classes = new Set((el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean));
  const out: Record<string, string> = {};
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      const styleRule = rule as CSSStyleRule;
      if (!styleRule.selectorText || !styleRule.style) continue;
      const matches = styleRule.selectorText.split(',').some((selector) => {
        const m = /^\.([A-Za-z0-9_-]+)$/.exec(selector.trim());
        return !!m && classes.has(m[1]);
      });
      if (!matches) continue;
      for (let i = 0; i < styleRule.style.length; i++) {
        const prop = styleRule.style[i];
        out[prop] = styleRule.style.getPropertyValue(prop);
      }
    }
  }
  for (let i = 0; i < el.style.length; i++) out[el.style[i]] = el.style.getPropertyValue(el.style[i]);
  return out;
}

/** The text of a seat card (the strip's `seat-N` view): name, score, clock, who plays it, status. */
export const seatCard = (seat: number): HTMLElement => screen.getByTestId(`seat-${seat}`);
