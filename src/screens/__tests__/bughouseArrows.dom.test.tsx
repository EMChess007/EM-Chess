import { act, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBughouseDualCellSize } from '../../logic/bughouseLayout';
import type { BoardId } from '../../logic/bughouse/types';
import type { SeatConfig, SeatController } from '../../logic/fourPlayer/setup';
import { mulberry32 } from '../../logic/__tests__/bughouseTestKit';
import { fireMouse, fireTouch, placeElement, tapBoardSquare, type FakeTouch } from '../../test/domKit';
import BughouseGameScreen from '../BughouseGameScreen';

/**
 * BUGHOUSE, FINGER-DRAWN ARROWS (command #32), rendered for real. The rules (logic/boardArrows.ts): HOLD a finger 400 ms on a square, DRAG it to another, LIFT = an arrow; on ANY turn; SEVERAL at
 * once; they stay until a MOVE is played on THAT board; drawing never moves, selects, drops or premoves, and a quick tap never draws. Two layouts take input differently and are both covered: the
 * dual layout (humans on both boards: raw touches with identifiers) and the standard one (one human: the PanResponder hook, replaced in these tests by the seam of domSetup.ts, whose options
 * are called as the hook would call them). An arrow is drawn as a `Polygon` (its head) and a marked square as a `Rect` (data-svg, domSetup.ts).
 */
const H: SeatController = { kind: 'human' };
const B: SeatController = { kind: 'bot', elo: 1200 };
const cfg = (a: string): SeatConfig => [a[0] === 'H' ? H : B, a[1] === 'H' ? H : B, a[2] === 'H' ? H : B, a[3] === 'H' ? H : B];
const TC3 = { initialMs: 180000, incrementMs: 0 };

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
});
afterEach(() => {
  vi.restoreAllMocks();
});
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const renderGame = (seats: SeatConfig, props: Partial<ComponentProps<typeof BughouseGameScreen>> = {}) =>
  render(<BughouseGameScreen timeControl={TC3} onExit={() => {}} rng={mulberry32(11)} clock={() => Date.now()} seats={seats} {...props} />);

const AT: Record<BoardId, { left: number; top: number }> = { A: { left: 40, top: 100 }, B: { left: 40, top: 520 } };
const cellPx = (): number => getBughouseDualCellSize(window.innerWidth, window.innerHeight).cell;
const grid = (board: BoardId): HTMLElement => {
  const element = screen.getByTestId(`board-${board}`);
  placeElement(element, AT[board].left, AT[board].top, cellPx() * 8);
  return element;
};
const bottom = (board: BoardId): 'w' | 'b' => (screen.getByTestId(`board-${board}`).querySelector('[data-testid]')?.getAttribute('data-testid') === `${board}-a8` ? 'w' : 'b');
const spot = (board: BoardId, square: string): { x: number; y: number } => {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  const white = bottom(board) === 'w';
  const col = white ? file : 7 - file;
  const row = white ? 8 - rank : rank - 1;
  return { x: AT[board].left + (col + 0.5) * cellPx(), y: AT[board].top + (row + 0.5) * cellPx() };
};
const finger = (id: number, board: BoardId, square: string): FakeTouch => ({ id, ...spot(board, square) });
const arrows = (board: BoardId): number => screen.getByTestId(`board-${board}`).querySelectorAll('[data-svg="Polygon"]').length;
const marked = (board: BoardId): number => screen.getByTestId(`board-${board}`).querySelectorAll('[data-svg="Rect"]').length;
const offered = (board: BoardId): string[] =>
  Array.from(screen.getByTestId(`board-${board}`).querySelectorAll('[data-testid]'))
    .filter((el) => /can (move|drop) here/.test(el.getAttribute('aria-label') ?? ''))
    .map((el) => (el.getAttribute('data-testid') ?? '').slice(2))
    .sort();
const fenOf = (board: BoardId): string => {
  const cells = Array.from(screen.getByTestId(`board-${board}`).querySelectorAll('[data-testid]')).filter((el) => /^[AB]-[a-h][1-8]$/.test(el.getAttribute('data-testid') ?? ''));
  return cells.map((el) => (el.getAttribute('aria-label') ?? '').replace(/, can (move|drop) here/, '')).join('|');
};

/** The gesture: down, HOLD `holdMs`, drag to `to`, lift. */
function drawArrow(board: BoardId, from: string, to: string, { id = 1, holdMs = 450 }: { id?: number; holdMs?: number } = {}) {
  const start = finger(id, board, from);
  const end = finger(id, board, to);
  fireTouch('touchstart', grid(board), [start]);
  advance(holdMs);
  fireTouch('touchmove', grid(board), [{ id, x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }]);
  fireTouch('touchmove', grid(board), [end]);
  fireTouch('touchend', grid(board), [end]);
}
const tap = (board: BoardId, square: string, id = 1) => {
  const f = finger(id, board, square);
  fireTouch('touchstart', grid(board), [f]);
  fireTouch('touchend', grid(board), [f]);
};

describe('the dual layout (humans on both boards): raw touches', () => {
  it('a held finger dragged to another square draws an arrow; nothing moves, nothing is selected', () => {
    renderGame(cfg('HHHH'));
    const before = fenOf('A');
    drawArrow('A', 'e2', 'e4');
    expect(arrows('A')).toBe(1);
    expect(arrows('B')).toBe(0);
    expect(fenOf('A')).toBe(before);
    expect(offered('A')).toEqual([]);
  });

  it('ANY turn: White is to move and the arrow starts from a Black piece, on both boards', () => {
    renderGame(cfg('HHHH'));
    drawArrow('A', 'e7', 'e5');
    drawArrow('B', 'g8', 'f6');
    expect(arrows('A')).toBe(1);
    expect(arrows('B')).toBe(1);
  });

  it('several arrows stay on the board at once, over time, and the same arrow drawn twice is drawn twice (as on the other boards)', () => {
    renderGame(cfg('HHHH'));
    drawArrow('A', 'e2', 'e4', { id: 1 });
    drawArrow('A', 'g1', 'f3', { id: 2 });
    drawArrow('A', 'd7', 'd5', { id: 3 });
    advance(60_000); // (clocks run, nobody moves: nothing clears them)
    expect(arrows('A')).toBe(3);
    drawArrow('A', 'e2', 'e4', { id: 4 });
    expect(arrows('A')).toBe(4);
  });

  it('a finger that was held and dragged away and back to its own square marks that square', () => {
    renderGame(cfg('HHHH'));
    const start = finger(1, 'A', 'c2');
    const away = finger(1, 'A', 'c5');
    fireTouch('touchstart', grid('A'), [start]);
    advance(450);
    fireTouch('touchmove', grid('A'), [away]);
    // lifted on its own cell after travelling: the finger's end point is inside the starting cell but further than a tap's drift from where it began
    const edge = { id: 1, x: start.x + cellPx() * 0.45, y: start.y };
    fireTouch('touchmove', grid('A'), [edge]);
    fireTouch('touchend', grid('A'), [edge]);
    expect(arrows('A')).toBe(0);
    expect(marked('A')).toBe(1);
  });

  it('a quick tap draws nothing and still selects (the move input is untouched)', () => {
    renderGame(cfg('HHHH'));
    tap('A', 'e2');
    advance(1000); // (the hold timer was stopped at the lift: nothing arms afterwards)
    expect(arrows('A')).toBe(0);
    expect(marked('A')).toBe(0);
    expect(offered('A')).toEqual(['e3', 'e4']);
  });

  it('a drag that starts moving before the hold is over is a slide: no arrow, no move', () => {
    renderGame(cfg('HHHH'));
    const before = fenOf('A');
    const start = finger(1, 'A', 'e2');
    const end = finger(1, 'A', 'e4');
    fireTouch('touchstart', grid('A'), [start]);
    advance(100);
    fireTouch('touchmove', grid('A'), [end]);
    advance(600);
    fireTouch('touchend', grid('A'), [end]);
    expect(arrows('A')).toBe(0);
    expect(fenOf('A')).toBe(before);
    expect(offered('A')).toEqual([]);
  });

  it('an arrow does not stop the moves: draw, then play a move on the board - the move is played and the arrows of THAT board are cleared, the other board keeps its own', () => {
    renderGame(cfg('HHHH'));
    drawArrow('A', 'e7', 'e5');
    drawArrow('B', 'e7', 'e5');
    drawArrow('B', 'd7', 'd5', { id: 2 });
    expect(arrows('A')).toBe(1);
    expect(arrows('B')).toBe(2);
    tap('B', 'e2');
    tap('B', 'e4');
    expect(arrows('B')).toBe(0); // a move was played on B
    expect(arrows('A')).toBe(1); // ... and A is untouched
    tap('A', 'd2');
    tap('A', 'd4');
    expect(arrows('A')).toBe(0);
  });

  it('two fingers at the same moment, one per board, draw one arrow each', () => {
    renderGame(cfg('HHHH'));
    const a = [finger(1, 'A', 'a2'), finger(1, 'A', 'a4')];
    const b = [finger(2, 'B', 'h2'), finger(2, 'B', 'h4')];
    fireTouch('touchstart', grid('A'), [a[0]]);
    fireTouch('touchstart', grid('B'), [b[0]]);
    advance(450);
    fireTouch('touchmove', grid('A'), [a[1]]);
    fireTouch('touchmove', grid('B'), [b[1]]);
    fireTouch('touchend', grid('B'), [b[1]]);
    fireTouch('touchend', grid('A'), [a[1]]);
    expect(arrows('A')).toBe(1);
    expect(arrows('B')).toBe(1);
  });

  it('a cancelled finger draws nothing', () => {
    renderGame(cfg('HHHH'));
    const start = finger(1, 'A', 'e2');
    fireTouch('touchstart', grid('A'), [start]);
    advance(450);
    fireTouch('touchcancel', grid('A'), [start]);
    advance(450);
    expect(arrows('A')).toBe(0);
  });

  it('a mouse does the same: press, hold, drag with the button down, release', () => {
    renderGame(cfg('HHHH'));
    const start = spot('A', 'e2');
    const end = spot('A', 'e4');
    fireMouse('pointerdown', grid('A'), start);
    advance(450);
    fireMouse('pointermove', grid('A'), end);
    fireMouse('pointerup', grid('A'), end);
    expect(arrows('A')).toBe(1);
    expect(offered('A')).toEqual([]);
  });
});

describe('the standard layout (one human): the board hook', () => {
  const options = (board: BoardId) => (globalThis as unknown as { __boardGesturesByKey: Record<string, { enableAnnotations: boolean; onArrow: (a: { row: number; col: number }, b: { row: number; col: number }) => void; onHighlight: (c: { row: number; col: number }) => void }> }).__boardGesturesByKey[board];

  it('the board takes the gesture even when it is not the human’s turn (interactive or not), and the thumbnail takes none', () => {
    renderGame(cfg('HBBB'));
    expect(options('A').enableAnnotations).toBe(true);
    expect(screen.queryByTestId('thumb-B')).toBeTruthy();
  });

  it('an arrow and a marked square are drawn on the board, as squares, and a move on the board clears them', () => {
    renderGame(cfg('HBBB'));
    // White at the bottom: display row 6 = rank 2, row 4 = rank 4; col = file
    act(() => options('A').onArrow({ row: 6, col: 4 }, { row: 4, col: 4 }));
    act(() => options('A').onArrow({ row: 7, col: 6 }, { row: 5, col: 5 }));
    act(() => options('A').onHighlight({ row: 0, col: 0 }));
    expect(arrows('A')).toBe(2);
    expect(marked('A')).toBe(1);
    act(() => options('A').onHighlight({ row: 0, col: 0 }));
    expect(marked('A')).toBe(0);
    tapBoardSquare('A', 'd2', 'w');
    tapBoardSquare('A', 'd4', 'w');
    expect(arrows('A')).toBe(0);
  });
});
