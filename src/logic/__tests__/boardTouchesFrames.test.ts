import { describe, expect, it } from 'vitest';
import { boardCellToSquare } from '../bughouseView';
import type { BoardId, BughouseColor } from '../bughouse/types';
import { EMPTY_TOUCH_BOOK, fingerCell, gridTapCell, localOfTouch, originSource, stepTouches, type Point, type Tap, type TouchEventIn } from '../boardTouches';

/**
 * BUGHOUSE, the real-phone bug of command #26: on Android every tap in the dual layout landed one rank too low (b2 selected b1, g2 selected g1, a back-rank piece selected nothing).
 *
 * The cause, from React Native 0.86's own sources: a touch's `pageX / pageY` are relative to the app's ROOT VIEW (TouchesHelper.kt), but the grid's origin was read with
 * `getBoundingClientRect()` - which a View ref HAS on a phone with the new architecture (ReactNativeElement) and which answers in WINDOW coordinates: the root view's own position in the window is
 * added, minus the status bar and cutout insets when edge-to-edge is off (RootViewUtil.getViewportOffset) - a NEGATIVE offset for an app drawing under a translucent status bar. Subtracting an origin
 * that is a status bar too small from a root-frame touch moves every tap that far toward the bottom. The web never showed it (page coordinates and the rectangle share a frame there); the rendered
 * test of the "phone path" removed `getBoundingClientRect` altogether, so the phone's real combination (both methods present) was never run.
 *
 * Fixed twice: the grid's touches now carry the grid's OWN frame (locationX / locationY of a touch whose target is an overlay over the grid) and need no origin at all; and where an origin is still
 * read, a phone never trusts `getBoundingClientRect()` (`originSource`). Every number below is a literal.
 */
const SQUARES = Array.from({ length: 64 }, (_, i) => `${'abcdefgh'[i % 8]}${Math.floor(i / 8) + 1}`);

/** The display cell (row 0 = top as drawn) of `square` on `board` with `orientation` at the bottom: the inverse of boardCellToSquare, found by search so it cannot share a bug with it. */
function cellOfSquare(board: BoardId, orientation: BughouseColor, square: string): { row: number; col: number } {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (boardCellToSquare(board, orientation, row, col).square === square) return { row, col };
    }
  }
  throw new Error(`no cell for ${square}`);
}

const tapAt = (local: Point, page: Point): Tap => ({
  target: { kind: 'grid' },
  start: page,
  end: page,
  startLocal: local,
  endLocal: local,
});

describe('a tap in the grid\'s own frame needs no origin', () => {
  const cells = [28, 32, 40, 48, 52];

  it('every square of both boards, with either colour at the bottom, maps to itself, whatever origin is passed', () => {
    for (const cell of cells) {
      for (const board of ['A', 'B'] as const) {
        for (const orientation of ['w', 'b'] as const) {
          for (const square of SQUARES) {
            const target = cellOfSquare(board, orientation, square);
            const local = { x: (target.col + 0.5) * cell, y: (target.row + 0.5) * cell };
            // the origin handed in is nonsense on purpose: a window offset, a negative status bar, a header, a scroll
            for (const origin of [{ x: 0, y: 0 }, { x: 16, y: -48 }, { x: 9999, y: -77 }, { x: -24, y: 5000 }]) {
              const hit = gridTapCell(tapAt(local, { x: 500 + local.x, y: 900 + local.y }), origin, cell, 8, 8);
              expect(hit).toEqual(target);
              expect(boardCellToSquare(board, orientation, hit!.row, hit!.col).square).toBe(square);
            }
          }
        }
      }
    }
  });

  it('is the same cell wherever the board sits on the page: status bar 0 / 24 / 32 / 48, navigation bar 0 / 24 / 48, header 0 / 56 / 120, stacked or side by side', () => {
    const cell = 40;
    let checked = 0;
    for (const statusBar of [0, 24, 32, 48]) {
      for (const navBar of [0, 24, 48]) {
        // the navigation bar changes the WINDOW's height, never where a board is inside the root view: it must change nothing
        expect(navBar).toBeGreaterThanOrEqual(0);
        for (const header of [0, 56, 120]) {
          for (const at of [{ x: 16, y: statusBar + header + 80 }, { x: 16, y: statusBar + header + 80 + 8 * cell + 70 }, { x: 16 + 8 * cell + 12, y: statusBar + header + 80 }]) {
            for (const square of ['a1', 'b2', 'g2', 'h8', 'e4', 'd5']) {
              const target = cellOfSquare('A', 'w', square);
              const local = { x: (target.col + 0.5) * cell, y: (target.row + 0.5) * cell };
              const page = { x: at.x + local.x, y: at.y + local.y };
              expect(gridTapCell(tapAt(local, page), { x: at.x - 3, y: at.y - statusBar }, cell, 8, 8)).toEqual(target);
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBe(4 * 3 * 3 * 3 * 6);
  });

  it('the cell is the one under the LIFT, not under the start: a tap that crosses a cell edge by a few pixels', () => {
    const tap = (start: Point, end: Point): Tap => ({ target: { kind: 'grid' }, start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, startLocal: start, endLocal: end });
    expect(gridTapCell(tap({ x: 39, y: 100 }, { x: 41, y: 100 }), { x: 0, y: 0 }, 40, 8, 8)).toEqual({ row: 2, col: 1 });
    expect(gridTapCell(tap({ x: 41, y: 100 }, { x: 39, y: 100 }), { x: 0, y: 0 }, 40, 8, 8)).toEqual({ row: 2, col: 0 });
    expect(gridTapCell(tap({ x: 100, y: 79 }, { x: 100, y: 81 }), { x: 0, y: 0 }, 40, 8, 8)).toEqual({ row: 2, col: 2 });
    expect(gridTapCell(tap({ x: 100, y: 81 }, { x: 100, y: 79 }), { x: 0, y: 0 }, 40, 8, 8)).toEqual({ row: 1, col: 2 });
  });

  it('a tap that has the frame on one end only is read in page coordinates (the origin passed in decides)', () => {
    const page = { x: 120, y: 260 }; // root frame: the grid's origin is (20, 100), so this is (100, 160) = row 4, col 2
    const startOnly: Tap = { target: { kind: 'grid' }, start: page, end: page, startLocal: { x: 5, y: 5 } };
    expect(gridTapCell(startOnly, { x: 20, y: 100 }, 40, 8, 8)).toEqual({ row: 4, col: 2 });
    const endOnly: Tap = { target: { kind: 'grid' }, start: page, end: page, endLocal: { x: 5, y: 5 } };
    expect(gridTapCell(endOnly, { x: 20, y: 100 }, 40, 8, 8)).toEqual({ row: 4, col: 2 });
  });

  it('puts the corners and the edges where they belong, and the right and bottom edges outside', () => {
    const at = (x: number, y: number) => gridTapCell(tapAt({ x, y }, { x: 1000, y: 1000 }), { x: 0, y: 0 }, 40, 8, 8);
    expect(at(0, 0)).toEqual({ row: 0, col: 0 });
    expect(at(39.9, 39.9)).toEqual({ row: 0, col: 0 });
    expect(at(40, 40)).toEqual({ row: 1, col: 1 });
    expect(at(319.9, 319.9)).toEqual({ row: 7, col: 7 });
    expect(at(320, 100)).toBeNull();
    expect(at(100, 320)).toBeNull();
    expect(at(-0.1, 100)).toBeNull();
    expect(at(100, -0.1)).toBeNull();
  });

  it('is a tap only when BOTH ends are inside the grid (the dead zone around a board)', () => {
    const start = { x: 100, y: 100 };
    const inside = gridTapCell({ target: { kind: 'grid' }, start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, startLocal: start, endLocal: { x: 105, y: 100 } }, { x: 0, y: 0 }, 40, 8, 8);
    expect(inside).toEqual({ row: 2, col: 2 });
    expect(gridTapCell({ target: { kind: 'grid' }, start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, startLocal: { x: -2, y: 100 }, endLocal: { x: 5, y: 100 } }, { x: 0, y: 0 }, 40, 8, 8)).toBeNull();
    expect(gridTapCell({ target: { kind: 'grid' }, start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, startLocal: { x: 5, y: 100 }, endLocal: { x: 5, y: 330 } }, { x: 0, y: 0 }, 40, 8, 8)).toBeNull();
  });

  it('works on a rectangular grid and a cell size that is not a whole number of pixels', () => {
    expect(gridTapCell(tapAt({ x: 25, y: 61 }, { x: 0, y: 0 }), { x: 0, y: 0 }, 30.5, 4, 6)).toEqual({ row: 2, col: 0 });
    expect(gridTapCell(tapAt({ x: 182.9, y: 121.9 }, { x: 0, y: 0 }), { x: 0, y: 0 }, 30.5, 4, 6)).toEqual({ row: 3, col: 5 });
    expect(gridTapCell(tapAt({ x: 183.1, y: 10 }, { x: 0, y: 0 }), { x: 0, y: 0 }, 30.5, 4, 6)).toBeNull();
  });
});

describe('the page-coordinate path still needs the origin, and its frame is the touch\'s', () => {
  const cell = 40;
  const cellCentre = (square: string) => {
    const c = cellOfSquare('A', 'w', square);
    return { x: (c.col + 0.5) * cell, y: (c.row + 0.5) * cell };
  };

  it('with the origin in the touch\'s own (root) frame every square maps to itself, however the board is placed', () => {
    for (const root of [{ x: 16, y: 120 }, { x: 0, y: 0 }, { x: 300, y: 48 }]) {
      for (const square of SQUARES) {
        const local = cellCentre(square);
        const tap: Tap = { target: { kind: 'grid' }, start: { x: root.x + local.x, y: root.y + local.y }, end: { x: root.x + local.x, y: root.y + local.y } };
        expect(gridTapCell(tap, root, cell, 8, 8)).toEqual(cellOfSquare('A', 'w', square));
      }
    }
  });

  it('REPRODUCES THE BUG: an origin read in the window frame (a status bar too small) moves a tap toward the bottom - b2 lands on b1, a1 lands outside', () => {
    const statusBar = 32; // a translucent status bar on the phone of the report
    const root = { x: 16, y: 120 };
    const wrongOrigin = { x: root.x, y: root.y - statusBar }; // getBoundingClientRect() with a viewport offset of -32
    const at = (square: string) => {
      const local = cellCentre(square);
      const page = { x: root.x + local.x, y: root.y + local.y };
      return gridTapCell({ target: { kind: 'grid' }, start: page, end: page }, wrongOrigin, cell, 8, 8);
    };
    // b2 is at row 6 as drawn (White at the bottom); the tap lands 32 px lower: row 7 = b1
    expect(at('b2')).toEqual({ row: 7, col: 1 });
    expect(boardCellToSquare('A', 'w', 7, 1).square).toBe('b1');
    expect(at('g2')).toEqual({ row: 7, col: 6 });
    expect(at('c3')).toEqual({ row: 6, col: 2 }); // c3 -> c2
    // a back-rank piece: its centre is 20 px above the bottom edge, the bug moves it 32 px down - outside the grid, "selects nothing"
    expect(at('a1')).toBeNull();
    expect(at('h1')).toBeNull();
  });
});

describe('where an origin may come from (originSource)', () => {
  it('on the web the rectangle is in the touch\'s frame and is used when there is one', () => {
    expect(originSource('web', true, true)).toBe('rect');
    expect(originSource('web', true, false)).toBe('rect');
    expect(originSource('web', false, true)).toBe('measure');
    expect(originSource('web', false, false)).toBe('none');
  });

  it('on a phone the rectangle (window coordinates) is NEVER used, even though a View ref has it; measure is the root frame', () => {
    expect(originSource('android', true, true)).toBe('measure');
    expect(originSource('ios', true, true)).toBe('measure');
    expect(originSource('android', true, false)).toBe('none'); // the rectangle alone is the wrong frame: better no origin than a wrong one
    expect(originSource('android', false, true)).toBe('measure');
    expect(originSource('android', false, false)).toBe('none');
  });
});

describe('localOfTouch', () => {
  it('is the locationX / locationY of a touch delivered to the overlay (the overlay is its target by construction)', () => {
    expect(localOfTouch({ locationX: 12.5, locationY: 80 })).toEqual({ x: 12.5, y: 80 });
    expect(localOfTouch({ locationX: 0, locationY: 0 })).toEqual({ x: 0, y: 0 });
    expect(localOfTouch({ locationX: -3, locationY: 400 })).toEqual({ x: -3, y: 400 }); // a finger that slid off the grid still has a position (the dead zone decides)
  });

  it('is undefined when the platform gave no usable position (the page path decides instead)', () => {
    expect(localOfTouch({ locationY: 80 })).toBeUndefined();
    expect(localOfTouch({ locationX: 12 })).toBeUndefined();
    expect(localOfTouch({})).toBeUndefined();
    expect(localOfTouch({ locationX: NaN, locationY: 80 })).toBeUndefined();
    expect(localOfTouch({ locationX: 12, locationY: Infinity })).toBeUndefined();
    expect(localOfTouch({ locationX: '12', locationY: 80 })).toBeUndefined();
    expect(localOfTouch({ locationX: null, locationY: 80 })).toBeUndefined();
  });
});

describe('the book carries the grid frame, all or nothing', () => {
  const GRID = { kind: 'grid' } as const;
  const run = (events: TouchEventIn[]) => {
    let book = EMPTY_TOUCH_BOOK;
    let tap: Tap | null = null;
    for (const event of events) {
      const step = stepTouches(book, event);
      book = step.book;
      tap = step.tap ?? tap;
    }
    return tap;
  };

  it('a tap whose start and lift both reported the grid frame carries both', () => {
    const tap = run([
      { kind: 'start', id: '1', at: { x: 100, y: 200 }, target: GRID, local: { x: 20, y: 30 } },
      { kind: 'end', id: '1', at: { x: 101, y: 201 }, local: { x: 21, y: 31 } },
    ]);
    expect(tap).toEqual({ target: GRID, start: { x: 100, y: 200 }, end: { x: 101, y: 201 }, startLocal: { x: 20, y: 30 }, endLocal: { x: 21, y: 31 } });
  });

  it('a tap with the frame on only one end carries neither (a point in one frame and a point in another is the bug)', () => {
    const startOnly = run([
      { kind: 'start', id: '1', at: { x: 100, y: 200 }, target: GRID, local: { x: 20, y: 30 } },
      { kind: 'end', id: '1', at: { x: 101, y: 201 } },
    ]);
    expect(startOnly).toEqual({ target: GRID, start: { x: 100, y: 200 }, end: { x: 101, y: 201 } });
    expect(startOnly).not.toHaveProperty('startLocal');
    expect(startOnly).not.toHaveProperty('endLocal');
    const endOnly = run([
      { kind: 'start', id: '1', at: { x: 100, y: 200 }, target: GRID },
      { kind: 'end', id: '1', at: { x: 101, y: 201 }, local: { x: 21, y: 31 } },
    ]);
    expect(endOnly).not.toHaveProperty('startLocal');
    expect(endOnly).not.toHaveProperty('endLocal');
  });

  it('the drift limit is still measured in page coordinates (frame-independent: a difference)', () => {
    expect(
      run([
        { kind: 'start', id: '1', at: { x: 0, y: 0 }, target: GRID, local: { x: 20, y: 30 } },
        { kind: 'end', id: '1', at: { x: 11, y: 0 }, local: { x: 20, y: 30 } },
      ]),
    ).toBeNull();
    expect(
      run([
        { kind: 'start', id: '1', at: { x: 0, y: 0 }, target: GRID, local: { x: 20, y: 30 } },
        { kind: 'end', id: '1', at: { x: 10, y: 0 }, local: { x: 20, y: 30 } },
      ]),
    ).not.toBeNull();
  });
});

describe('fingerCell (the dev overlay\'s cell under a finger)', () => {
  it('is the cell of a point in the grid\'s frame, and null outside', () => {
    expect(fingerCell({ x: 0, y: 0 }, 40, 8, 8)).toEqual({ row: 0, col: 0 });
    expect(fingerCell({ x: 319.9, y: 40 }, 40, 8, 8)).toEqual({ row: 1, col: 7 });
    expect(fingerCell({ x: 320, y: 40 }, 40, 8, 8)).toBeNull();
    expect(fingerCell({ x: 40, y: -1 }, 40, 8, 8)).toBeNull();
  });
});
