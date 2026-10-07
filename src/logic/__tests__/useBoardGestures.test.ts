import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for the shared touch hook, run against the REAL PanResponder (react-native-web's, which is react-native's) and a tiny
 * hook runtime that keeps state between renders and re-renders after every state change, as React does.
 *
 * The bug these pin: the hook used to create a NEW PanResponder on every render. A PanResponder keeps its gesture state (dx, dy, moveX…)
 * inside the instance, and the board re-renders constantly mid-gesture — every live-arrow move, and every 200 ms clock tick in 4 Player
 * Chess — so the touch-END was handled by a fresh instance that had never seen a move (dx = dy = 0). The drag then looked like a
 * stationary tap and the finished arrow was never committed: it vanished the moment the finger lifted.
 */

const runtime = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, dirty: false }));

vi.mock('react', () => ({
  useRef: (initial: unknown) => {
    const i = runtime.cursor++;
    if (!(i in runtime.slots)) runtime.slots[i] = { current: initial };
    return runtime.slots[i];
  },
  useState: (initial: unknown) => {
    const i = runtime.cursor++;
    if (!(i in runtime.slots)) runtime.slots[i] = { value: typeof initial === 'function' ? (initial as () => unknown)() : initial };
    const slot = runtime.slots[i] as { value: unknown };
    return [
      slot.value,
      (next: unknown) => {
        const value = typeof next === 'function' ? (next as (prev: unknown) => unknown)(slot.value) : next;
        if (!Object.is(value, slot.value)) {
          slot.value = value;
          runtime.dirty = true;
        }
      },
    ];
  },
}));

vi.mock('react-native', async () => {
  // @ts-expect-error -- react-native-web ships no type declarations for this internal module; it is the real PanResponder react-native uses.
  const mod = await import('react-native-web/dist/vendor/react-native/PanResponder');
  return { PanResponder: mod.default };
});

import { useBoardGestures, type BoardGestureOptions } from '../../components/useBoardGestures';

const CELL = 26;

interface Handlers {
  onStartShouldSetResponderCapture: (e: unknown) => boolean;
  onResponderGrant: (e: unknown) => void;
  onResponderMove: (e: unknown) => void;
  onResponderRelease: (e: unknown) => void;
}

/** Mounts the hook and returns a driver that feeds it responder events, always calling the handlers of the LATEST render. */
function mount(base: Partial<BoardGestureOptions> = {}) {
  runtime.slots = [];
  const calls = { taps: [] as unknown[], arrows: [] as unknown[], highlights: [] as unknown[] };
  let options: BoardGestureOptions = {
    squareSize: CELL,
    rows: 14,
    cols: 14,
    enableAnnotations: true,
    onTap: (cell) => calls.taps.push(cell),
    onArrow: (from, to) => calls.arrows.push({ from, to }),
    onHighlight: (cell) => calls.highlights.push(cell),
    ...base,
  };
  let latest = render();
  function render() {
    runtime.cursor = 0;
    runtime.dirty = false;
    return useBoardGestures(options);
  }
  /** React re-renders after any state change (and after a clock tick); do it until the tree is stable. */
  const settle = () => {
    let guard = 0;
    while (runtime.dirty && guard++ < 10) latest = render();
  };
  const rerender = (next?: Partial<BoardGestureOptions>) => {
    if (next) options = { ...options, ...next };
    latest = render();
    settle();
  };
  const handlers = () => latest.panHandlers as unknown as Handlers;
  const centre = (row: number, col: number) => ({ x: col * options.squareSize + options.squareSize / 2, y: row * options.squareSize + options.squareSize / 2 });

  let t = 1000;
  let prev = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  const event = (p: { x: number; y: number }, active = true) => {
    t += 16;
    const touch = { touchActive: active, startPageX: start.x, startPageY: start.y, startTimeStamp: 1000, currentPageX: p.x, currentPageY: p.y, currentTimeStamp: t, previousPageX: prev.x, previousPageY: prev.y, previousTimeStamp: t - 16 };
    prev = p;
    return {
      nativeEvent: { pageX: p.x, pageY: p.y, touches: [{}] },
      touchHistory: { numberActiveTouches: active ? 1 : 0, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: t, touchBank: [touch] },
    };
  };

  return {
    calls,
    rerender,
    get latest() {
      return latest;
    },
    /** Finger goes down on a cell (its centre, at the current square size). */
    down(row: number, col: number) {
      const p = centre(row, col);
      start = p;
      prev = p;
      const e = event(p);
      handlers().onStartShouldSetResponderCapture(e);
      handlers().onResponderGrant(e);
      settle();
    },
    /** Finger moves to a cell centre; the board re-renders after each event (live arrow, clock ticks). */
    move(row: number, col: number, extraRenders = 0) {
      handlers().onResponderMove(event(centre(row, col)));
      settle();
      for (let i = 0; i < extraRenders; i++) rerender();
    },
    /** The same, at an exact pixel. */
    downAt(x: number, y: number) {
      start = { x, y };
      prev = { x, y };
      const e = event({ x, y });
      handlers().onStartShouldSetResponderCapture(e);
      handlers().onResponderGrant(e);
      settle();
    },
    moveAt(x: number, y: number, extraRenders = 0) {
      handlers().onResponderMove(event({ x, y }));
      settle();
      for (let i = 0; i < extraRenders; i++) rerender();
    },
    async upAt(x: number, y: number) {
      handlers().onResponderRelease(event({ x, y }, false));
      settle();
      await Promise.resolve();
      await Promise.resolve();
      settle();
    },
    async up(row: number, col: number) {
      handlers().onResponderRelease(event(centre(row, col), false));
      settle();
      await Promise.resolve();
      await Promise.resolve();
      settle();
    },
    hold(ms: number) {
      vi.advanceTimersByTime(ms);
      settle();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a long-press drag commits its arrow when the finger lifts, however often the board re-renders meanwhile', () => {
  it('(the reported bug) re-rendering between every event — a 200 ms clock tick, the live arrow itself — does not lose the drag', async () => {
    const g = mount();
    g.down(6, 3); // d8, as drawn for Red
    g.hold(450); // the long press arms
    for (const col of [4, 5, 6, 7]) g.move(6, col, 2); // two extra re-renders (clock ticks) after every move
    g.rerender();
    await g.up(6, 7);
    expect(g.calls.arrows).toEqual([{ from: { row: 6, col: 3 }, to: { row: 6, col: 7 } }]); // a REAL arrow with two distinct cells
    expect(g.calls.taps).toEqual([]); // not misread as a tap
    expect(g.calls.highlights).toEqual([]);
  });

  it('the PanResponder is created once: the same handlers object survives every re-render', () => {
    const g = mount();
    const first = g.latest.panHandlers;
    g.rerender();
    g.rerender();
    expect(g.latest.panHandlers).toBe(first);
  });

  it('works the same on the 8 x 8 board', async () => {
    const g = mount({ rows: 8, cols: 8, squareSize: 44 });
    g.down(1, 4);
    g.hold(450);
    g.move(2, 4, 3);
    g.move(3, 4, 3);
    await g.up(3, 4);
    expect(g.calls.arrows).toEqual([{ from: { row: 1, col: 4 }, to: { row: 3, col: 4 } }]);
  });

  it('shows the live preview while dragging and removes it on release', async () => {
    const g = mount();
    expect(g.latest.liveArrow).toBeNull();
    g.down(6, 3);
    g.hold(450);
    g.move(6, 5);
    expect(g.latest.liveArrow).not.toBeNull();
    expect(g.latest.liveArrow?.from).toEqual({ row: 6, col: 3 });
    await g.up(6, 5);
    expect(g.latest.liveArrow).toBeNull();
  });

  it('a long press that moves more than the tap threshold but ends in its own cell toggles a highlight', async () => {
    const g = mount();
    const start = { x: 6 * 0 + 3 * CELL + 3, y: 6 * CELL + 3 }; // near the top-left of cell (6, 3)
    g.downAt(start.x, start.y);
    g.hold(450);
    g.moveAt(start.x + 6, start.y + 6, 2);
    g.moveAt(start.x + 14, start.y + 14, 2); // 14 px each way (about 20 px of travel) is past the 10 px threshold and still inside the 26 px cell
    await g.upAt(start.x + 14, start.y + 14);
    expect(g.calls.highlights).toEqual([{ row: 6, col: 3 }]);
    expect(g.calls.arrows).toEqual([]);
    expect(g.calls.taps).toEqual([]);
  });

  it('(documented behaviour) a long press that wanders away and comes back to where it started is a tap: the distance is NET displacement', async () => {
    const g = mount();
    g.down(6, 3);
    g.hold(450);
    g.move(6, 5, 1);
    g.move(6, 3, 1);
    await g.up(6, 3);
    expect(g.calls.taps).toEqual([{ row: 6, col: 3 }]);
    expect(g.calls.highlights).toEqual([]);
  });
});

describe('the moment the long press arms, and when the system takes the touch away', () => {
  it('the preview appears the instant the long press arms, before the finger has moved at all', () => {
    const g = mount();
    g.down(6, 3);
    expect(g.latest.liveArrow).toBeNull(); // a quick touch shows nothing
    g.hold(450);
    expect(g.latest.liveArrow?.from).toEqual({ row: 6, col: 3 });
  });

  it('if the touch is terminated (a scroll view took it) the preview is dropped and nothing is committed', async () => {
    const g = mount();
    g.down(6, 3);
    g.hold(450);
    g.move(6, 6, 1);
    expect(g.latest.liveArrow).not.toBeNull();
    (g.latest.panHandlers as unknown as { onResponderTerminate: (e: unknown) => void }).onResponderTerminate({});
    g.rerender();
    expect(g.latest.liveArrow).toBeNull();
    await g.up(6, 6); // a stray release afterwards must do nothing
    expect(g.calls.arrows).toEqual([]);
    expect(g.calls.taps).toEqual([]);
  });
});

describe('who owns the touch while it is happening', () => {
  it('an armed long-press arrow refuses to be taken over (e.g. by a scroll view); an ordinary touch can be', () => {
    const g = mount();
    const handlers = () => g.latest.panHandlers as unknown as { onResponderTerminationRequest: (e: unknown) => boolean };
    g.down(6, 3);
    expect(handlers().onResponderTerminationRequest({})).toBe(true); // not armed yet: a scroll swipe may take it
    g.hold(450);
    expect(handlers().onResponderTerminationRequest({})).toBe(false); // armed: the arrow is not interrupted mid-draw
  });
});

describe('taps and aborted drags are still read correctly', () => {
  it('a quick tap is a tap on its cell', async () => {
    const g = mount();
    g.down(10, 4);
    await g.up(10, 4);
    expect(g.calls.taps).toEqual([{ row: 10, col: 4 }]);
  });

  it('a slow tap (held past the long-press time without moving) is still a tap, never an annotation', async () => {
    const g = mount();
    g.down(10, 4);
    g.hold(1500);
    g.rerender();
    await g.up(10, 4);
    expect(g.calls.taps).toEqual([{ row: 10, col: 4 }]);
    expect(g.calls.arrows).toEqual([]);
    expect(g.calls.highlights).toEqual([]);
  });

  it('a fast drag that never armed (a scroll or swipe) does nothing', async () => {
    const g = mount();
    g.down(6, 3);
    g.move(6, 5, 1); // moves before the long press can fire
    g.move(6, 7, 1);
    g.hold(450);
    await g.up(6, 7);
    expect(g.calls.arrows).toEqual([]);
    expect(g.calls.taps).toEqual([]);
    expect(g.calls.highlights).toEqual([]);
  });

  it('with annotations off, a drag draws nothing', async () => {
    const g = mount({ enableAnnotations: false });
    g.down(6, 3);
    g.hold(450);
    g.move(6, 7, 1);
    await g.up(6, 7);
    expect(g.calls.arrows).toEqual([]);
    expect(g.latest.liveArrow).toBeNull();
  });
});

describe('the single, long-lived PanResponder still sees the CURRENT options', () => {
  it('a release uses the handlers and cell size of the latest render, not the first one', async () => {
    const first: unknown[] = [];
    const second: unknown[] = [];
    const g = mount({ onTap: (cell) => first.push(cell) });
    g.rerender({ onTap: (cell) => second.push(cell) }); // the board got new handlers (a new position, a new selection)
    g.down(5, 5);
    await g.up(5, 5);
    expect(first).toEqual([]);
    expect(second).toEqual([{ row: 5, col: 5 }]);
  });

  it('a change of square size between renders is picked up (rotation, window resize)', async () => {
    const g = mount();
    g.rerender({ squareSize: 20 });
    g.downAt(91, 91); // 91 / 20 = 4.55 -> row 4, col 4 with the CURRENT 20 px squares (it would be 3, 3 with the first render's 26 px)
    await g.upAt(91, 91);
    expect(g.calls.taps).toEqual([{ row: 4, col: 4 }]);
  });
});
