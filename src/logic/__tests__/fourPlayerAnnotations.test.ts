import { describe, expect, it } from 'vitest';
import {
  KING_START_SQUARE,
  PLAYABLE_SQUARES,
  SIZE,
  VALID,
  addArrow,
  fileOf,
  fromDisplay,
  gridToSquare,
  index,
  parseSquare,
  rankOf,
  squareName,
  squareToGrid,
  stepForward,
  toDisplay,
  toggleHighlight,
  type Seat,
} from '../fourPlayer';

const SEATS: Seat[] = [0, 1, 2, 3];
const sq = parseSquare;

describe('screen cells <-> board squares, for every seat at the bottom', () => {
  it('is an exact bijection on the 160 squares for each view, and the four cut corners are not squares', () => {
    for (const view of SEATS) {
      for (const square of PLAYABLE_SQUARES) {
        const cell = squareToGrid(square, view);
        expect(cell.row).toBeGreaterThanOrEqual(0);
        expect(cell.row).toBeLessThan(SIZE);
        expect(cell.col).toBeGreaterThanOrEqual(0);
        expect(cell.col).toBeLessThan(SIZE);
        expect(gridToSquare(cell, view), `view ${view} ${squareName(square)}`).toBe(square);
      }
      let corners = 0;
      for (let row = 0; row < SIZE; row++) for (let col = 0; col < SIZE; col++) if (gridToSquare({ row, col }, view) === null) corners++;
      expect(corners, `view ${view}`).toBe(36); // 4 corners x 3 x 3
    }
  });

  it('agrees with where the board component actually draws each square (row 0 is the TOP of the screen)', () => {
    // FourPlayerBoard draws row r (from the top) as dy = SIZE - 1 - r, and column c as dx = c, taking the square from fromDisplay.
    for (const view of SEATS) {
      for (let row = 0; row < SIZE; row++) {
        for (let col = 0; col < SIZE; col++) {
          const [file, rank] = fromDisplay(col, SIZE - 1 - row, view);
          const square = index(file, rank);
          if (VALID[square]) expect(squareToGrid(square, view)).toEqual({ row, col });
          else expect(gridToSquare({ row, col }, view)).toBeNull();
        }
      }
    }
  });

  it('puts the viewing seat\'s own back rank / king at the bottom of the screen, whichever seat it is', () => {
    for (const view of SEATS) {
      expect(squareToGrid(KING_START_SQUARE[view], view).row, `seat ${view}`).toBe(SIZE - 1);
    }
  });
});

describe('arrows drawn from each seat\'s own perspective point at the right absolute squares', () => {
  it('an arrow from the player\'s own king one step forward is the same absolute arrow in every view (and not a mirrored one)', () => {
    for (const seat of SEATS) {
      const king = KING_START_SQUARE[seat];
      const ahead = stepForward(seat, king);
      // The player (seat at the bottom) drags from the cell under their king to the cell directly above it on screen.
      const from = squareToGrid(king, seat);
      const to = { row: from.row - 1, col: from.col };
      const drawn = addArrow([], gridToSquare(from, seat), gridToSquare(to, seat));
      expect(drawn, `seat ${seat}`).toEqual([{ from: king, to: ahead }]);
    }
  });

  it('the same absolute arrow (a1-style +file step) is drawn pointing right / up / left / down for views 0 / 1 / 2 / 3', () => {
    const from = sq('g7');
    const to = sq('h7'); // one file to the right in absolute terms
    const direction = (view: Seat) => {
      const a = squareToGrid(from, view);
      const b = squareToGrid(to, view);
      return [b.row - a.row, b.col - a.col];
    };
    expect(direction(0)).toEqual([0, 1]); // Red at the bottom: files run left to right
    expect(direction(1)).toEqual([-1, 0]); // Blue at the bottom: the board is turned a quarter: +file points UP the screen
    expect(direction(2)).toEqual([0, -1]); // Yellow at the bottom: reversed
    expect(direction(3)).toEqual([1, 0]); // Green at the bottom: +file points DOWN the screen
  });

  it('an arrow drawn in one view is re-drawn after a Rotate over the very same two pieces (it is stored as squares, not cells)', () => {
    const from = sq('d4');
    const to = sq('h8');
    for (const drawnIn of SEATS) {
      const drawn = addArrow([], gridToSquare(squareToGrid(from, drawnIn), drawnIn), gridToSquare(squareToGrid(to, drawnIn), drawnIn));
      expect(drawn).toEqual([{ from, to }]);
      for (const nowViewing of SEATS) {
        const [arrow] = drawn;
        const a = squareToGrid(arrow.from, nowViewing);
        const b = squareToGrid(arrow.to, nowViewing);
        // Each end sits exactly on the cell where that square's piece is drawn in the new view.
        const [fdx, fdy] = toDisplay(fileOf(from), rankOf(from), nowViewing);
        const [tdx, tdy] = toDisplay(fileOf(to), rankOf(to), nowViewing);
        expect(a).toEqual({ row: SIZE - 1 - fdy, col: fdx });
        expect(b).toEqual({ row: SIZE - 1 - tdy, col: tdx });
      }
    }
  });

  it('a rotation is a rigid turn: the arrow keeps its length and turns by exactly a quarter per seat', () => {
    const from = sq('e5');
    const to = sq('k9');
    const vec = (view: Seat) => {
      const a = squareToGrid(from, view);
      const b = squareToGrid(to, view);
      return { dr: b.row - a.row, dc: b.col - a.col };
    };
    const base = vec(0);
    const len = Math.hypot(base.dr, base.dc);
    let { dr, dc } = base;
    for (const view of [1, 2, 3] as Seat[]) {
      // Turning the picture a quarter clockwise maps (dr, dc) -> (-dc... ) — whichever way, the vectors must follow one fixed rotation.
      const next = { dr: -dc, dc: dr };
      const got = vec(view);
      expect(Math.hypot(got.dr, got.dc)).toBeCloseTo(len, 10);
      expect(got, `view ${view}`).toEqual(next);
      dr = got.dr;
      dc = got.dc;
    }
  });

  it('gestures that start or end in a cut corner draw nothing, and a zero-length arrow is ignored', () => {
    expect(addArrow([], null, sq('e5'))).toEqual([]);
    expect(addArrow([], sq('e5'), null)).toEqual([]);
    expect(addArrow([], sq('e5'), sq('e5'))).toEqual([]);
    for (const view of SEATS) {
      expect(gridToSquare({ row: 0, col: 0 }, view)).toBeNull();
      expect(gridToSquare({ row: SIZE - 1, col: SIZE - 1 }, view)).toBeNull();
    }
  });

  it('arrows accumulate like the 2-player board (drawing the same one twice adds it again); highlights toggle', () => {
    const once = addArrow([], sq('e2'), sq('e4'));
    expect(addArrow(once, sq('e2'), sq('e4'))).toHaveLength(2);
    const on = toggleHighlight([], sq('f5'));
    expect(on).toEqual([sq('f5')]);
    expect(toggleHighlight(on, sq('f5'))).toEqual([]);
    expect(toggleHighlight(on, null)).toBe(on);
  });
});
