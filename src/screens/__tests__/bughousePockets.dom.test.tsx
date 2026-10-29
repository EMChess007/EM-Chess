import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureMatch } from '../../logic/bughouseFixture';
import { legalDropsOn, pocketOfSeat } from '../../logic/bughouse';
import type { SeatConfig, SeatController } from '../../logic/fourPlayer/setup';
import { mulberry32 } from '../../logic/__tests__/bughouseTestKit';
import { getBughouseDualCellSize } from '../../logic/bughouseLayout';
import { declaredStyle, fireTouch, placeElement, tapBoardSquare } from '../../test/domKit';
import BughouseGameScreen from '../BughouseGameScreen';

/**
 * THE POCKETS, RENDERED (command #27b). On a real phone the chips of a pocket with two kinds of piece stacked under one another and the second one covered the top rank of the board. The
 * pocket is now ONE row that never wraps inside a strip that clips, its chips have computed widths, an empty pocket shows nothing, and a drop from a full pocket still works. The pixels
 * and rectangles of the same pockets at every window size are the device matrix's `bughouse-full-pockets-*` screens (android-matrix-checks.mjs, the `pocket` check); jsdom has no layout,
 * so here are the things a rendered test CAN see: what is drawn, in which colour, with which style, and that the game still plays.
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

const renderGame = (seats: SeatConfig, startFrom?: ReturnType<typeof fixtureMatch>) =>
  render(<BughouseGameScreen seats={seats} timeControl={TC3} onExit={() => {}} rng={mulberry32(11)} clock={() => Date.now()} startFrom={startFrom} />);

const PIECES = ['p', 'n', 'b', 'r', 'q'] as const;
const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' } as const;
/** seat -> [board, colour word]: seat 0 = A white, 1 = A black, 2 = B white, 3 = B black. */
const PLACES = [
  ['A', 'white'],
  ['A', 'black'],
  ['B', 'white'],
  ['B', 'black'],
] as const;
const COUNTS = [
  { p: 16, n: 16, b: 16, r: 16, q: 16 },
  { p: 16, n: 9, b: 12, r: 10, q: 1 },
  { p: 14, n: 16, b: 1, r: 13, q: 16 },
  { p: 8, n: 15, b: 16, r: 1, q: 12 },
] as const;

describe('full pockets', () => {
  const match = fixtureMatch('fullPockets', TC3);

  it('all four pockets show all five chips with their counts (the engine\'s pockets, and the literals)', () => {
    renderGame(cfg('HHHH'), match); // four humans: both boards are full size, with all four strips
    PLACES.forEach(([board, word], seat) => {
      for (const piece of PIECES) {
        const chip = screen.getByTestId(`pocket-${board}-${word}-${piece}`);
        expect(chip.textContent, `${board} ${word} ${piece}`).toBe(String(COUNTS[seat][piece]));
        expect(chip.textContent).toBe(String(pocketOfSeat(match, seat as 0 | 1 | 2 | 3)[piece]));
        expect(chip.getAttribute('aria-label')).toContain(`${COUNTS[seat][piece]} ${NAMES[piece]}`);
      }
    });
  });

  it('a chip is the piece in its OWN colour: white pockets hold white pieces, black pockets black ones', () => {
    renderGame(cfg('HHHH'), match);
    PLACES.forEach(([board, word]) => {
      const fill = word === 'white' ? '#fafafa' : '#1d1d1d';
      for (const piece of PIECES) {
        const paths = Array.from(screen.getByTestId(`pocket-${board}-${word}-${piece}`).querySelectorAll('[data-svg="Path"]'));
        expect(paths.length, `${board} ${word} ${piece}`).toBeGreaterThan(0);
        for (const path of paths) expect(path.getAttribute('data-fill')).toBe(fill);
      }
    });
  });

  it('the pocket is ONE row that never wraps, in a strip that clips what it holds, and the chips are 24 dp wide until the row is measured (the smallest, which always fits)', () => {
    renderGame(cfg('HHHH'), match);
    for (const [board, word] of PLACES) {
      const pocket = declaredStyle(screen.getByTestId(`pocket-${board}-${word}`));
      expect(pocket['flex-wrap'], `${board} ${word} pocket`).toBe('nowrap');
      expect(pocket['flex-direction']).toBe('row');
      const bar = declaredStyle(screen.getByTestId(`bar-${board}-${word}`));
      expect(bar['overflow-x'] ?? bar['overflow'], `${board} ${word} strip, sideways`).toBe('hidden');
      expect(bar['overflow-y'] ?? bar['overflow'], `${board} ${word} strip, vertically`).toBe('hidden');
      for (const piece of PIECES) {
        const chip = declaredStyle(screen.getByTestId(`pocket-${board}-${word}-${piece}`));
        expect(chip['width'], `${board} ${word} ${piece}`).toBe('24px');
        expect(chip['flex-shrink']).toBe('0');
      }
    }
  });

  it('the strip names its seat for a screen reader even when the name is left out of the picture', () => {
    renderGame(cfg('HHHH'), match);
    for (const [board, word] of PLACES) expect(screen.getByTestId(`bar-${board}-${word}`).getAttribute('aria-label') ?? '').toContain(`board ${board} ${word}`);
  });

  it('DROPS STILL WORK: tap the queen chip of a full pocket, then a legal square; the queen is dropped and the count goes from 16 to 15', () => {
    renderGame(cfg('HHBB'), match);
    const squares = legalDropsOn(match, 'A').filter((drop) => drop.piece === 'q').map((drop) => drop.square);
    expect(squares).toContain('e4');
    fireEvent.click(screen.getByTestId('pocket-A-white-q'));
    expect(screen.getByTestId('pocket-A-white-q').getAttribute('aria-label')).toContain('picked up');
    tapBoardSquare('A', 'e4', 'w');
    expect(screen.getByTestId('A-e4').getAttribute('aria-label')).toContain('White queen');
    expect(screen.getByTestId('pocket-A-white-q').textContent).toBe('15');
    expect(screen.getByTestId('pocket-A-white-p').textContent).toBe('16'); // the others untouched
  });

  it('the chip of the side NOT to move does nothing (its opponent\'s pocket must not lift a piece of the side to move)', () => {
    renderGame(cfg('HHBB'), match);
    fireEvent.click(screen.getByTestId('pocket-A-black-q'));
    expect(screen.getByTestId('pocket-A-white-q').getAttribute('aria-label')).not.toContain('picked up');
    expect(screen.getByTestId('pocket-A-black-q').getAttribute('aria-label')).not.toContain('picked up');
  });
});

describe('drops from a full pocket on the two-finger screen (humans on both boards)', () => {
  it('lift a chip with a finger, drop with a finger on the grid: the queen lands, the count goes down, the other board is untouched', () => {
    const match = fixtureMatch('fullPockets', TC3);
    renderGame(cfg('HBHB'), match);
    const cell = getBughouseDualCellSize(window.innerWidth, window.innerHeight).cell;
    const board = screen.getByTestId('board-A');
    placeElement(board, 40, 100, cell * 8);
    const first = board.querySelector('[data-testid]')?.getAttribute('data-testid');
    const white = first === 'A-a8'; // the colour at the bottom of A as drawn
    const file = 'e'.charCodeAt(0) - 97;
    const col = white ? file : 7 - file;
    const row = white ? 8 - 4 : 4 - 1;
    const point = { id: 1, x: 40 + (col + 0.5) * cell, y: 100 + (row + 0.5) * cell };
    const chip = screen.getByTestId('pocket-A-white-q');
    fireTouch('touchstart', chip, [{ id: 2, x: 30, y: 30 }]);
    fireTouch('touchend', chip, [{ id: 2, x: 30, y: 30 }]);
    expect(chip.getAttribute('aria-label')).toContain('picked up');
    fireTouch('touchstart', board, [point]);
    fireTouch('touchend', board, [point]);
    expect(screen.getByTestId('A-e4').getAttribute('aria-label')).toContain('White queen');
    expect(screen.getByTestId('pocket-A-white-q').textContent).toBe('15');
    expect(screen.getByTestId('pocket-B-white-q').textContent).toBe('16');
  });
});

describe('an empty pocket', () => {
  it('shows NOTHING: no dash, no text, no chip (the phone showed "Board A · Black –")', () => {
    renderGame(cfg('HHHH'));
    for (const [board, word] of PLACES) {
      const pocket = screen.getByTestId(`pocket-${board}-${word}`);
      expect(pocket.textContent, `${board} ${word}`).toBe('');
      expect(pocket.children).toHaveLength(0);
      expect(screen.getByTestId(`bar-${board}-${word}`).textContent).not.toMatch(/[-–]/);
    }
  });

  it('the allPieces fixture has none either: not a chip anywhere', () => {
    renderGame(cfg('HHHH'), fixtureMatch('allPieces', TC3));
    expect(screen.queryAllByTestId(/^pocket-[AB]-(white|black)-[pnbrq]$/)).toHaveLength(0);
  });
});
