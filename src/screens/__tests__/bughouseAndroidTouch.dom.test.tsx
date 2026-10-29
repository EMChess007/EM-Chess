import { act, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardId } from '../../logic/bughouse/types';
import { getBughouseDualCellSize } from '../../logic/bughouseLayout';
import type { SeatConfig, SeatController } from '../../logic/fourPlayer/setup';
import { mulberry32 } from '../../logic/__tests__/bughouseTestKit';
import { fireTouch, type FakeTouch } from '../../test/domKit';
import '../../dev/registerTouchDebug'; // what App.tsx does in a development build: the overlay exists only because this is loaded
import BughouseGameScreen from '../BughouseGameScreen';

/**
 * BUGHOUSE, command #26: every tap landed one rank too low on a real Android phone. This renders the dual layout the way a phone delivers it (Platform android; the grid's node HAS a
 * `getBoundingClientRect` - in WINDOW coordinates, with the negative viewport offset of a translucent status bar - and a `measure` in the root frame; a touch carries pageX / pageY in the root
 * frame and locationX / locationY in its TARGET's frame) and checks that every tap selects the square under the finger whatever the status bar is. The browser path is untouched
 * (bughouseDual.dom.test.tsx, the browser pass); the unit proof over every square and every offset is boardTouchesFrames.test.ts.
 */
const H: SeatController = { kind: 'human' };
const B: SeatController = { kind: 'bot', elo: 1200 };
const cfg = (a: string): SeatConfig => [a[0] === 'H' ? H : B, a[1] === 'H' ? H : B, a[2] === 'H' ? H : B, a[3] === 'H' ? H : B];
const TC3 = { initialMs: 180000, incrementMs: 0 };

const platform = Platform as { OS: string };
const realOS = platform.OS;

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  platform.OS = 'android';
});
afterEach(() => {
  platform.OS = realOS;
  vi.restoreAllMocks();
});

const renderGame = (props: Partial<ComponentProps<typeof BughouseGameScreen>> & { seats: SeatConfig }) =>
  render(<BughouseGameScreen timeControl={TC3} onExit={() => {}} rng={mulberry32(11)} clock={() => Date.now()} {...props} />);

/** Where each board's grid sits in the app's ROOT frame (what a touch's pageX / pageY are relative to). */
const ROOT: Record<BoardId, { left: number; top: number }> = { A: { left: 20, top: 110 }, B: { left: 20, top: 540 } };
const cellPx = (): number => getBughouseDualCellSize(window.innerWidth, window.innerHeight).cell;
const bottomColour = (board: BoardId): 'w' | 'b' => (screen.getByTestId(`board-${board}`).querySelector('[data-testid]')?.getAttribute('data-testid') === `${board}-a8` ? 'w' : 'b');
/** The centre of `square` as drawn: in the grid's own frame. */
const localOf = (board: BoardId, square: string): { x: number; y: number } => {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  const white = bottomColour(board) === 'w';
  return { x: ((white ? file : 7 - file) + 0.5) * cellPx(), y: ((white ? 8 - rank : rank - 1) + 0.5) * cellPx() };
};

/**
 * Gives the grid of `board` what a phone gives it: a rectangle in the WINDOW frame (the root view sits `statusBar` dp ABOVE the window's content origin: viewport offset = -statusBar) and a
 * `measure` in the root frame.
 */
function phoneGrid(board: BoardId, statusBar: number): { measured: () => number } {
  const grid = screen.getByTestId(`board-${board}`);
  let measured = 0;
  const size = cellPx() * 8;
  Object.defineProperty(grid, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: ROOT[board].left, top: ROOT[board].top - statusBar, right: ROOT[board].left + size, bottom: ROOT[board].top - statusBar + size, x: ROOT[board].left, y: ROOT[board].top - statusBar, width: size, height: size, toJSON: () => ({}) }),
  });
  Object.defineProperty(grid, 'measure', {
    configurable: true,
    value: (callback: (x: number, y: number, w: number, h: number, pageX: number, pageY: number) => void) => {
      measured++;
      setTimeout(() => callback(0, 0, size, size, ROOT[board].left, ROOT[board].top), 20); // the bridge answers a little later, in the root frame
    },
  });
  return { measured: () => measured };
}

/** A finger on `square`, delivered to the overlay (its target) with pageX / pageY in the root frame and locationX / locationY in the overlay's frame. */
const fingerOnOverlay = (board: BoardId, square: string, id = 1): FakeTouch => {
  const local = localOf(board, square);
  return { id, x: ROOT[board].left + local.x, y: ROOT[board].top + local.y, locationX: local.x, locationY: local.y };
};
const overlay = (board: BoardId): HTMLElement => screen.getByTestId(`board-${board}-surface`);
const tapOverlay = (board: BoardId, square: string) => {
  const f = fingerOnOverlay(board, square);
  fireTouch('touchstart', overlay(board), [f]);
  fireTouch('touchend', overlay(board), [f]);
};
const offered = (board: BoardId): string[] =>
  Array.from(screen.getByTestId(`board-${board}`).querySelectorAll('[data-testid]'))
    .filter((el) => /can (move|drop) here/.test(el.getAttribute('aria-label') ?? ''))
    .map((el) => (el.getAttribute('data-testid') ?? '').slice(2))
    .sort();

describe('the grid has a touch surface on a phone and not on the web', () => {
  it('a transparent overlay covers the grid of each board on Android, and is the last thing in it', () => {
    renderGame({ seats: cfg('HBHB') });
    for (const board of ['A', 'B'] as const) {
      const surface = overlay(board);
      expect(screen.getByTestId(`board-${board}`).lastElementChild).toBe(surface);
    }
  });

  it('there is none in the browser (the cells stay the hit targets there)', () => {
    platform.OS = 'web';
    renderGame({ seats: cfg('HBHB') });
    expect(screen.queryByTestId('board-A-surface')).toBeNull();
    expect(screen.queryByTestId('board-B-surface')).toBeNull();
  });

  it('the other layouts (one human, pass-and-play) have none: they keep the PanResponder', () => {
    renderGame({ seats: cfg('HBBB') });
    expect(screen.queryByTestId('board-A-surface')).toBeNull();
  });
});

describe('every tap selects the square under the finger, whatever the status bar (the report: b2 selected b1)', () => {
  it.each([0, 24, 32, 48])('status bar %d: pawns and knights of board A, each tap on its own square', (statusBar) => {
    renderGame({ seats: cfg('HBHB') });
    const grid = phoneGrid('A', statusBar);
    for (const [square, targets] of [
      ['b2', ['b3', 'b4']],
      ['g2', ['g3', 'g4']],
      ['c2', ['c3', 'c4']],
      ['e2', ['e3', 'e4']],
      ['b1', ['a3', 'c3']],
      ['g1', ['f3', 'h3']],
    ] as const) {
      tapOverlay('A', square);
      expect(offered('A')).toEqual([...targets].sort());
    }
    expect(grid.measured()).toBe(0); // the overlay's own frame needs no measurement at all
  });

  it('a back-rank piece is reachable (the report: it selected nothing): the rook on a1 is selected, and a pawn tap after it selects the pawn', () => {
    renderGame({ seats: cfg('HBHB') });
    phoneGrid('A', 32);
    tapOverlay('A', 'a1');
    expect(screen.getByTestId('A-a1').getAttribute('aria-label')).toContain('White rook'); // the rook is there; it has no move yet, so nothing is offered, but the tap was ON a1 ...
    tapOverlay('A', 'a2');
    expect(offered('A')).toEqual(['a3', 'a4']); // ... and the next tap, on a2, is read as a2
  });

  it('board B too, and with Black at the bottom', () => {
    renderGame({ seats: cfg('HBHH') });
    phoneGrid('A', 32);
    phoneGrid('B', 32);
    const white = bottomColour('B') === 'w';
    // whoever is at the bottom of B: tap that side's e-pawn (rank 2 for White, rank 7 for Black) when that side is the one to move
    tapOverlay('B', 'e2');
    expect(offered('B')).toEqual(white ? ['e3', 'e4'] : []);
  });

  it('a different status bar for each board changes nothing', () => {
    renderGame({ seats: cfg('HBHB') });
    phoneGrid('A', 24);
    phoneGrid('B', 48);
    tapOverlay('A', 'e2');
    tapOverlay('B', 'd2');
    expect(offered('A')).toEqual(['e3', 'e4']);
    expect(offered('B')).toEqual(['d3', 'd4']);
  });
});

describe('a touch the platform reported without the overlay frame never uses the window-frame rectangle', () => {
  it('measure() (the root frame) is used instead, and the tap lands on its own square', async () => {
    renderGame({ seats: cfg('HBHB') });
    const grid = phoneGrid('A', 32);
    const local = localOf('A', 'b2');
    const f: FakeTouch = { id: 1, x: ROOT.A.left + local.x, y: ROOT.A.top + local.y }; // pageX / pageY only: no locationX / locationY
    fireTouch('touchstart', overlay('A'), [f]);
    fireTouch('touchend', overlay('A'), [f]);
    await act(async () => {
      vi.advanceTimersByTime(20);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(grid.measured()).toBeGreaterThanOrEqual(1);
    expect(offered('A')).toEqual(['b3', 'b4']); // with the rectangle (a status bar of 32 too small) this was b1
  });

  it('a lift that carries only one of the two frames is read in page coordinates, never as a mix', async () => {
    renderGame({ seats: cfg('HBHB') });
    phoneGrid('A', 32);
    const local = localOf('A', 'g2');
    const page = { x: ROOT.A.left + local.x, y: ROOT.A.top + local.y };
    fireTouch('touchstart', overlay('A'), [{ id: 1, ...page, locationX: local.x, locationY: local.y }]);
    fireTouch('touchend', overlay('A'), [{ id: 1, ...page }]); // the lift without locationX / locationY
    await act(async () => {
      vi.advanceTimersByTime(20);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(offered('A')).toEqual(['g3', 'g4']);
  });
});

describe('the dev touch-debug overlay', () => {
  const g = globalThis as { __DEV__?: boolean };
  afterEach(() => {
    delete g.__DEV__;
  });

  it('draws the square the app computes under each finger, on its board', () => {
    g.__DEV__ = true;
    renderGame({ seats: cfg('HBHB') });
    expect(screen.queryByTestId('touch-debug-A')).toBeNull(); // off until switched on
    act(() => screen.getByTestId('bughouse-touch-debug').click());
    expect(screen.getByTestId('bughouse-touch-debug').getAttribute('aria-label')).toBe('Touch debug is on');
    phoneGrid('A', 32);
    const f = fingerOnOverlay('A', 'g2');
    fireTouch('touchstart', overlay('A'), [f]);
    expect(screen.getByTestId('touch-debug-A-square').textContent).toBe('g2'); // the finger is on g2, and the overlay says so (not g1)
    const g1 = fingerOnOverlay('A', 'c3', 2);
    fireTouch('touchmove', overlay('A'), [{ ...g1, id: 1 }]);
    expect(screen.getByTestId('touch-debug-A-square').textContent).toBe('c3');
    fireTouch('touchend', overlay('A'), [{ ...g1, id: 1 }]);
    expect(screen.queryByTestId('touch-debug-A-square')).toBeNull(); // the finger is up: nothing drawn
  });

  it('switches off again, and the other board has its own', () => {
    g.__DEV__ = true;
    renderGame({ seats: cfg('HBHB') });
    act(() => screen.getByTestId('bughouse-touch-debug').click());
    phoneGrid('A', 0);
    phoneGrid('B', 0);
    fireTouch('touchstart', overlay('B'), [fingerOnOverlay('B', 'd2', 5)]);
    expect(screen.getByTestId('touch-debug-B-square').textContent).toBe('d2');
    expect(screen.queryByTestId('touch-debug-A-square')).toBeNull();
    act(() => screen.getByTestId('bughouse-touch-debug').click());
    expect(screen.queryByTestId('touch-debug-B')).toBeNull();
  });

  it('is not in a release build: no switch on the screen, no overlay', () => {
    g.__DEV__ = false;
    renderGame({ seats: cfg('HBHB') });
    expect(screen.queryByTestId('bughouse-touch-debug')).toBeNull();
    expect(screen.queryByTestId('touch-debug-A')).toBeNull();
  });
});
