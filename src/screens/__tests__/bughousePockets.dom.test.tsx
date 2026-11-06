import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PIECE_PATHS } from '../../components/pieceArt';
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

/**
 * The strip and the pocket row are MEASURED on a phone (onLayout). jsdom has no layout, but react-native-web keeps each view's layout handler on its DOM node, so a test can hand it the
 * width a phone would have measured - the same call the browser's ResizeObserver makes.
 */
const layoutHandler = (element: HTMLElement) => (element as unknown as { __reactLayoutHandler?: (event: unknown) => void }).__reactLayoutHandler;
const measured = (element: HTMLElement, width: number) =>
  act(() => {
    layoutHandler(element)?.({ nativeEvent: { layout: { x: 0, y: 0, width, height: 36 } } });
  });
const NAME = 'Board A · White';

describe('the strip is measured: the name gives up its place before the pocket does, and the chips take the room they are given', () => {
  const match = fixtureMatch('fullPockets', TC3);

  it('both the strip and the pocket row listen for their layout', () => {
    renderGame(cfg('HHHH'), match);
    for (const [board, word] of PLACES) {
      expect(layoutHandler(screen.getByTestId(`bar-${board}-${word}`)), `${board} ${word} strip`).toBeTypeOf('function');
      expect(layoutHandler(screen.getByTestId(`pocket-${board}-${word}`)), `${board} ${word} pocket`).toBeTypeOf('function');
    }
  });

  it('the name is shown from a strip of 280 dp (92 fixed + 132 for five chips + 56 for the name) and left out below it, then comes back', () => {
    renderGame(cfg('HHHH'), match);
    const bar = screen.getByTestId('bar-A-white');
    expect(bar.textContent).toContain(NAME); // not measured yet: shown
    measured(bar, 279);
    expect(bar.textContent).not.toContain(NAME);
    measured(bar, 280);
    expect(bar.textContent).toContain(NAME);
    measured(bar, 224); // the narrowest strip of the layouts (a stacked board at the 28 dp cell)
    expect(bar.textContent).not.toContain(NAME);
    expect(screen.getByTestId('pocket-A-white-q')).toBeTruthy(); // the pocket is still all there
    // the other strips are unaffected
    expect(screen.getByTestId('bar-B-black').textContent).toContain('Board B · Black');
  });

  it('the pocket reserves the room of a FULL pocket (132 dp, 112 in a narrow strip), so the name gives way first', () => {
    renderGame(cfg('HHHH'), match);
    const bar = screen.getByTestId('bar-A-white');
    const pocket = screen.getByTestId('pocket-A-white');
    expect(declaredStyle(pocket)['flex-basis']).toBe('132px');
    expect(declaredStyle(pocket)['flex-shrink']).toBe('0');
    measured(bar, 223);
    expect(declaredStyle(pocket)['flex-basis']).toBe('112px');
    measured(bar, 224);
    expect(declaredStyle(pocket)['flex-basis']).toBe('132px');
  });

  it('a NARROW strip (below 224 dp) drops the colour dot and the team shape, takes a 40 dp clock and 20 dp chips; at 224 dp they are back (46 dp, 24 dp)', () => {
    renderGame(cfg('HHHH'), match);
    const bar = screen.getByTestId('bar-A-white');
    const pocket = screen.getByTestId('pocket-A-white');
    const clock = () => declaredStyle(screen.getByTestId('clock-A-white'))['min-width'];
    const chip = () => declaredStyle(screen.getByTestId('pocket-A-white-q'))['width'];
    expect(bar.textContent).toContain('◆'); // not measured yet: the full strip
    expect(clock()).toBe('46px');
    measured(bar, 223);
    measured(pocket, 112);
    expect(bar.textContent).not.toContain('◆');
    expect(bar.textContent).not.toContain('●');
    expect(clock()).toBe('40px');
    expect(chip()).toBe('20px');
    measured(bar, 224);
    measured(pocket, 132);
    expect(bar.textContent).toContain('◆');
    expect(clock()).toBe('46px');
    expect(chip()).toBe('24px');
  });

  it('the colour dot goes with the shape: drawn from 224 dp, gone below it', () => {
    renderGame(cfg('HHHH'), match);
    const bar = screen.getByTestId('bar-A-white');
    expect(screen.queryByTestId('dot-A-white')).not.toBeNull();
    measured(bar, 223);
    expect(screen.queryByTestId('dot-A-white')).toBeNull();
    expect(screen.queryByTestId('dot-A-black')).not.toBeNull(); // the other strips are unaffected
    measured(bar, 224);
    expect(screen.queryByTestId('dot-A-white')).not.toBeNull();
  });

  it('the piece in a chip is as big as its chip allows: 18 dp (compact bars) in a 24+ dp chip, 16 dp in a 20 dp chip', () => {
    renderGame(cfg('HHHH'), match);
    const bar = screen.getByTestId('bar-A-white');
    const size = () => screen.getByTestId('pocket-A-white-q').querySelector('[data-svg="Svg"]')?.getAttribute('data-width');
    expect(size()).toBe('18');
    measured(bar, 223);
    measured(screen.getByTestId('pocket-A-white'), 112);
    expect(size()).toBe('16');
  });

  it('every chip is its own piece: the silhouette of a pawn, knight, bishop, rook and queen, in order', () => {
    renderGame(cfg('HHHH'), match);
    for (const piece of PIECES) {
      const drawn = Array.from(screen.getByTestId(`pocket-A-white-${piece}`).querySelectorAll('[data-svg="Path"]')).map((path) => path.getAttribute('data-d'));
      expect(drawn, piece).toEqual([...PIECE_PATHS[piece]]);
    }
  });

  it('the two-board layouts are COMPACT: a 24 dp chip in a 26 dp row in a strip at least 30 dp tall', () => {
    renderGame(cfg('HHHH'), match);
    expect(declaredStyle(screen.getByTestId('pocket-A-white-q'))['height']).toBe('24px');
    expect(declaredStyle(screen.getByTestId('pocket-A-white'))['height']).toBe('26px');
    expect(declaredStyle(screen.getByTestId('bar-A-white'))['min-height']).toBe('30px');
  });

  it('the one-human layout is not: a 26 dp chip in a 28 dp row in a strip at least 36 dp tall', () => {
    renderGame(cfg('HBBB'), match);
    expect(declaredStyle(screen.getByTestId('pocket-A-white-q'))['height']).toBe('26px');
    expect(declaredStyle(screen.getByTestId('pocket-A-white'))['height']).toBe('28px');
    expect(declaredStyle(screen.getByTestId('bar-A-white'))['min-height']).toBe('36px');
  });

  it('the chips are as wide as the measured row allows: 24 dp at 132 dp, 37 at 200, 40 from 232 dp', () => {
    renderGame(cfg('HHHH'), match);
    const pocket = screen.getByTestId('pocket-A-white');
    const widths = () => PIECES.map((piece) => declaredStyle(screen.getByTestId(`pocket-A-white-${piece}`))['width']);
    measured(pocket, 132);
    expect(widths()).toEqual(['24px', '24px', '24px', '24px', '24px']);
    measured(pocket, 200);
    expect(widths()).toEqual(['37px', '37px', '37px', '37px', '37px']);
    measured(pocket, 300);
    expect(widths()).toEqual(['40px', '40px', '40px', '40px', '40px']);
    measured(pocket, 100); // less than a full pocket needs: still the floor, never a wrap
    expect(widths()).toEqual(['24px', '24px', '24px', '24px', '24px']);
    // the pocket next to it keeps its own width
    expect(declaredStyle(screen.getByTestId('pocket-B-white-q'))['width']).toBe('24px');
  });

  it('a pocket of two chips in a 100 dp row has 40 dp chips (it does not stretch them)', () => {
    const two = fixtureMatch('fullPockets', TC3);
    const sparse = { ...two, pockets: two.pockets.map((reserve, seat) => (seat === 0 ? { p: 0, n: 3, b: 0, r: 0, q: 2 } : reserve)) } as typeof two;
    renderGame(cfg('HHHH'), sparse);
    measured(screen.getByTestId('pocket-A-white'), 100);
    expect(declaredStyle(screen.getByTestId('pocket-A-white-n'))['width']).toBe('40px');
    expect(declaredStyle(screen.getByTestId('pocket-A-white-q'))['width']).toBe('40px');
    expect(screen.queryByTestId('pocket-A-white-p')).toBeNull();
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
