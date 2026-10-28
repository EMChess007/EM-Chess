import { describe, expect, it } from 'vitest';
import { mulberry32 } from './bughouseTestKit';
import { EMPTY_TOUCH_BOOK, gridTapCell, insideGrid, stepTouches, type Tap, type TouchBook, type TouchEventIn, type TouchTarget } from '../boardTouches';

/**
 * BUGHOUSE W3b - the pure part of the per-board raw-touch layer (HP12): touches tracked by identifier, a tap = a touch that ends where it began, the dead zone around a grid. Every number that
 * a mutation of boardTouches.ts could change is written here as a LITERAL (10 px of drift, the 28 px minimum cell, the 8 x 8 grid).
 */
const GRID = { kind: 'grid' } as const;
const CHIP = { kind: 'chip', piece: 'n' } as const;
const start = (id: string, x: number, y: number, target: TouchTarget = GRID): TouchEventIn => ({ kind: 'start', id, at: { x, y }, target });
const move = (id: string, x: number, y: number): TouchEventIn => ({ kind: 'move', id, at: { x, y } });
const end = (id: string, x: number, y: number): TouchEventIn => ({ kind: 'end', id, at: { x, y } });
const cancel = (id: string): TouchEventIn => ({ kind: 'cancel', id });

/** Feeds events to one book; returns the final book and every tap in order. */
function run(events: TouchEventIn[], book: TouchBook = EMPTY_TOUCH_BOOK): { book: TouchBook; taps: Tap[] } {
  const taps: Tap[] = [];
  let current = book;
  for (const event of events) {
    const step = stepTouches(current, event);
    current = step.book;
    if (step.tap) taps.push(step.tap);
  }
  return { book: current, taps };
}

describe('a tap is a touch that ends where it began', () => {
  it('start then end on the same point is one tap, carrying where it started and where it ended; the touch is forgotten', () => {
    const { book, taps } = run([start('1', 100, 200), end('1', 100, 200)]);
    expect(taps).toEqual([{ target: GRID, start: { x: 100, y: 200 }, end: { x: 100, y: 200 } }]);
    expect(book).toEqual({});
  });

  it('a lift 10 px away is still a tap, 11 px away is not (the drift limit is 10 px, measured as a distance, not per axis)', () => {
    expect(run([start('1', 0, 0), end('1', 10, 0)]).taps).toHaveLength(1);
    expect(run([start('1', 0, 0), end('1', 11, 0)]).taps).toHaveLength(0);
    expect(run([start('1', 0, 0), end('1', 0, 10)]).taps).toHaveLength(1);
    expect(run([start('1', 0, 0), end('1', 0, 11)]).taps).toHaveLength(0);
    expect(run([start('1', 0, 0), end('1', 6, 8)]).taps).toHaveLength(1); // 10.0
    expect(run([start('1', 0, 0), end('1', 8, 8)]).taps).toHaveLength(0); // 11.3: each axis alone is under 10
    expect(run([start('1', 50, 50), end('1', 40, 50)]).taps).toHaveLength(1); // to the left / up as well
    expect(run([start('1', 50, 50), end('1', 39, 50)]).taps).toHaveLength(0);
  });

  it('a touch that wandered more than 10 px at any moment is not a tap, even when it comes back to where it began', () => {
    expect(run([start('1', 0, 0), move('1', 11, 0), end('1', 0, 0)]).taps).toHaveLength(0);
    expect(run([start('1', 0, 0), move('1', 10, 0), end('1', 0, 0)]).taps).toHaveLength(1); // 10 is not "more than 10"
    expect(run([start('1', 0, 0), move('1', 0, 11), move('1', 0, 0), end('1', 0, 0)]).taps).toHaveLength(0); // and the later move back does not undo it
  });

  it('a lift that is no tap still forgets the touch (a book never grows by the touches that were not taps)', () => {
    expect(run([start('1', 0, 0), move('1', 11, 0), end('1', 0, 0)]).book).toEqual({});
    expect(run([start('1', 0, 0), end('1', 30, 0)]).book).toEqual({});
    expect(run([start('1', 0, 0), start('2', 5, 5), end('1', 30, 0)]).book).toEqual({ '2': { target: GRID, start: { x: 5, y: 5 }, drifted: false } });
  });

  it('agrees with a plain model on 2000 seeded random event streams over three fingers (the proof that re-examining a touch that has already drifted changes nothing)', () => {
    const rng = mulberry32(31);
    for (let round = 0; round < 2000; round++) {
      // the model keeps, per identifier, every point of the touch; it is a tap iff the touch began, never went further than 10 px from its start, and lifts within 10 px
      const live = new Map<string, { start: { x: number; y: number }; far: boolean }>();
      const modelTaps: [number, number][] = [];
      let book: TouchBook = EMPTY_TOUCH_BOOK;
      const actualTaps: [number, number][] = [];
      for (let i = 0; i < 12; i++) {
        const id = 'abc'[Math.floor(rng() * 3)];
        const x = Math.round(rng() * 40) - 20;
        const y = Math.round(rng() * 40) - 20;
        const roll = rng();
        const event: TouchEventIn = roll < 0.3 ? start(id, x, y) : roll < 0.6 ? move(id, x, y) : roll < 0.9 ? end(id, x, y) : cancel(id);
        const known = live.get(id);
        if (event.kind === 'start') live.set(id, { start: { x, y }, far: false });
        else if (known) {
          if (event.kind === 'move') known.far = known.far || Math.hypot(x - known.start.x, y - known.start.y) > 10;
          else {
            live.delete(id);
            if (event.kind === 'end' && !known.far && Math.hypot(x - known.start.x, y - known.start.y) <= 10) modelTaps.push([known.start.x, x]);
          }
        }
        const step = stepTouches(book, event);
        book = step.book;
        if (step.tap) actualTaps.push([step.tap.start.x, step.tap.end.x]);
      }
      expect(actualTaps, `round ${round}`).toEqual(modelTaps);
      expect(Object.keys(book).sort(), `round ${round}`).toEqual([...live.keys()].sort());
    }
  });

  it('a cancelled touch is forgotten without an effect, and a lift that follows finds nothing', () => {
    const { book, taps } = run([start('1', 5, 5), cancel('1'), end('1', 5, 5)]);
    expect(taps).toEqual([]);
    expect(book).toEqual({});
  });

  it('an event for a touch this book never saw begin changes nothing and taps nothing (a touch that began on the OTHER board is never in this board\'s book)', () => {
    for (const event of [move('9', 1, 1), end('9', 1, 1), cancel('9')]) {
      const before: TouchBook = { '1': { target: GRID, start: { x: 0, y: 0 }, drifted: false } };
      const step = stepTouches(before, event);
      expect(step.tap).toBeNull();
      expect(step.book).toEqual(before);
    }
  });

  it('the target the touch began on is the target of its tap (a chip stays a chip)', () => {
    expect(run([start('1', 0, 0, CHIP), end('1', 0, 0)]).taps[0].target).toEqual({ kind: 'chip', piece: 'n' });
    expect(run([start('1', 0, 0, GRID), end('1', 0, 0)]).taps[0].target).toEqual({ kind: 'grid' });
  });
});

describe('several fingers at once, told apart by identifier', () => {
  it('two touches in flight are two entries; each ends in its own tap, in the order they lift, whatever the order they landed', () => {
    const { taps, book } = run([start('a', 10, 10), start('b', 300, 300), end('b', 300, 300), end('a', 10, 10)]);
    expect(taps.map((t) => t.start)).toEqual([{ x: 300, y: 300 }, { x: 10, y: 10 }]);
    expect(book).toEqual({});
  });

  it('a move of one finger does not disturb the other', () => {
    const { taps } = run([start('a', 0, 0), start('b', 100, 100), move('a', 50, 50), end('b', 100, 100), end('a', 0, 0)]);
    expect(taps.map((t) => t.start)).toEqual([{ x: 100, y: 100 }]); // b tapped; a wandered
  });

  it('a start with an identifier already in the book replaces it (the system lost the first one)', () => {
    const { taps } = run([start('1', 0, 0), start('1', 200, 200), end('1', 200, 200)]);
    expect(taps.map((t) => t.start)).toEqual([{ x: 200, y: 200 }]);
  });

  it('twenty fingers one after the other (the same identifier reused) are twenty taps', () => {
    const events: TouchEventIn[] = [];
    for (let i = 0; i < 20; i++) events.push(start('0', i, i), end('0', i, i));
    expect(run(events).taps).toHaveLength(20);
  });

  it('the book is not changed in place: the book a step was given is the same afterwards', () => {
    const before: TouchBook = Object.freeze({ '1': Object.freeze({ target: GRID, start: { x: 0, y: 0 }, drifted: false }) });
    stepTouches(before, end('1', 0, 0));
    stepTouches(before, move('1', 50, 50));
    stepTouches(before, cancel('1'));
    stepTouches(before, start('2', 1, 1));
    expect(Object.keys(before)).toEqual(['1']);
    expect(before['1'].drifted).toBe(false);
  });
});

describe('the dead zone: only a touch that starts AND ends inside the grid is a tap on it', () => {
  const origin = { x: 100, y: 200 };
  const tapOf = (s: [number, number], e: [number, number]): Tap => ({ target: GRID, start: { x: s[0], y: s[1] }, end: { x: e[0], y: e[1] } });

  it('insideGrid: the left and top edges belong to the grid, the right and bottom edges do not', () => {
    expect(insideGrid({ x: 100, y: 200 }, origin, 224, 224)).toBe(true);
    expect(insideGrid({ x: 99.9, y: 200 }, origin, 224, 224)).toBe(false);
    expect(insideGrid({ x: 100, y: 199.9 }, origin, 224, 224)).toBe(false);
    expect(insideGrid({ x: 323.9, y: 423.9 }, origin, 224, 224)).toBe(true);
    expect(insideGrid({ x: 324, y: 300 }, origin, 224, 224)).toBe(false);
    expect(insideGrid({ x: 200, y: 424 }, origin, 224, 224)).toBe(false);
    expect(insideGrid({ x: 150, y: 250 }, origin, 224, 100)).toBe(true); // width and height are separate
    expect(insideGrid({ x: 150, y: 301 }, origin, 224, 100)).toBe(false);
    expect(insideGrid({ x: 321, y: 250 }, origin, 100, 224)).toBe(false);
  });

  it('the cell is the one under the lift, in display coordinates (row 0 at the top, column 0 at the left), for a 28 px cell', () => {
    expect(gridTapCell(tapOf([100, 200], [100, 200]), origin, 28, 8, 8)).toEqual({ row: 0, col: 0 });
    expect(gridTapCell(tapOf([127, 227], [127, 227]), origin, 28, 8, 8)).toEqual({ row: 0, col: 0 });
    expect(gridTapCell(tapOf([128, 228], [128, 228]), origin, 28, 8, 8)).toEqual({ row: 1, col: 1 });
    expect(gridTapCell(tapOf([100 + 28 * 5 + 3, 200 + 28 * 2 + 3], [100 + 28 * 5 + 3, 200 + 28 * 2 + 3]), origin, 28, 8, 8)).toEqual({ row: 2, col: 5 });
    expect(gridTapCell(tapOf([323, 423], [323, 423]), origin, 28, 8, 8)).toEqual({ row: 7, col: 7 });
  });

  it('the cell is the one under where the finger LIFTED when the tap crossed a cell edge on the way (a tap may drift up to 10 px)', () => {
    expect(gridTapCell(tapOf([127, 227], [128, 228]), origin, 28, 8, 8)).toEqual({ row: 1, col: 1 }); // began in cell (0, 0), lifted in (1, 1)
    expect(gridTapCell(tapOf([128, 228], [127, 227]), origin, 28, 8, 8)).toEqual({ row: 0, col: 0 });
    expect(gridTapCell(tapOf([150, 210], [150, 232]), origin, 28, 8, 8)).toEqual({ row: 1, col: 1 }); // 22 px down: still a tap's reach, another row
  });

  it('a tap that began outside the grid is nothing, and so is one that ended outside it (the margin and the gutter are dead)', () => {
    expect(gridTapCell(tapOf([95, 250], [101, 250]), origin, 28, 8, 8)).toBeNull(); // began 5 px left of the grid
    expect(gridTapCell(tapOf([101, 250], [95, 250]), origin, 28, 8, 8)).toBeNull(); // ended there
    expect(gridTapCell(tapOf([200, 195], [200, 201]), origin, 28, 8, 8)).toBeNull(); // began above
    expect(gridTapCell(tapOf([200, 201], [200, 195]), origin, 28, 8, 8)).toBeNull();
    expect(gridTapCell(tapOf([320, 300], [326, 300]), origin, 28, 8, 8)).toBeNull(); // ended past the right edge (224 px wide: x < 324)
    expect(gridTapCell(tapOf([200, 420], [200, 426]), origin, 28, 8, 8)).toBeNull(); // ended below
    expect(gridTapCell(tapOf([200, 300], [330, 300]), origin, 28, 8, 8)).toBeNull(); // a swipe across to the next board
  });

  it('the grid is rows x cols squares of `cell` px: a rectangular grid is not a square one', () => {
    expect(gridTapCell(tapOf([160, 200], [160, 200]), origin, 20, 2, 4)).toEqual({ row: 0, col: 3 });
    expect(gridTapCell(tapOf([185, 200], [185, 200]), origin, 20, 2, 4)).toBeNull(); // 4 cols of 20 px: x < 180
    expect(gridTapCell(tapOf([100, 235], [100, 235]), origin, 20, 2, 4)).toEqual({ row: 1, col: 0 }); // 2 rows of 20 px: y < 240
    expect(gridTapCell(tapOf([100, 245], [100, 245]), origin, 20, 2, 4)).toBeNull();
  });
});
