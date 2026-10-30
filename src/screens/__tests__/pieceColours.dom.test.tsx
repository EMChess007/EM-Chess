import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Piece from '../../components/Piece';
import { PIECE_PATHS } from '../../components/pieceArt';
import { getBughouseDualCellSize } from '../../logic/bughouseLayout';
import { mulberry32 } from '../../logic/__tests__/bughouseTestKit';
import { openBoard } from '../../logic/bughouse';
import type { SeatConfig, SeatController } from '../../logic/fourPlayer/setup';
import FourPlayerGameScreen from '../FourPlayerGameScreen';
import BughouseGameScreen from '../BughouseGameScreen';

/**
 * EVERY PIECE IN ITS OWN COLOUR (command #27b). On a real phone the black king was drawn white: the pieces were font glyphs and the phone's fallback font decided how a "black" glyph
 * looked. They are vectors now, with the fill and outline written below as LITERALS; these tests read what the screens RENDER - the marker of each drawn piece and the fill of its paths -
 * for all twelve kinds, in Bughouse, the 2-player piece itself, and the 4-seat board. The pixels of the same pieces on both square colours are the device matrix's check
 * (android-matrix-pieces.mjs, androidMatrixPieces.test.ts).
 */
const WHITE = { fill: '#fafafa', stroke: '#1b1b1b' };
const BLACK = { fill: '#1d1d1d', stroke: '#f1f1f1' };
const TYPES = ['k', 'q', 'r', 'b', 'n', 'p'] as const;

const paths = (root: HTMLElement) => Array.from(root.querySelectorAll('[data-svg="Path"]')) as HTMLElement[];

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('what a piece says about itself', () => {
  const WORDS = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' } as const;
  const PATH_COUNTS = { p: 2, n: 1, b: 2, r: 1, q: 4, k: 1 } as const;

  it.each(['w', 'b'] as const)('every %s piece is labelled with its colour and kind for a screen reader, and draws ALL of its paths', (color) => {
    for (const type of TYPES) {
      const { container, unmount } = render(<Piece piece={{ color, type } as never} size={40} />);
      const marked = container.querySelector(`[data-piece="${color}${type}"]`) as HTMLElement;
      expect(marked.getAttribute('aria-label'), `${color}${type}`).toBe(`${color === 'w' ? 'white' : 'black'} ${WORDS[type]}`);
      expect(paths(marked), `${color}${type} paths`).toHaveLength(PATH_COUNTS[type]);
      unmount();
    }
  });

  it('a piece is drawn at 90 % of its cell, and 36 dp without one', () => {
    const sized = render(<Piece piece={{ color: 'w', type: 'k' } as never} size={40} />);
    expect(sized.container.querySelector('[data-svg="Svg"]')?.getAttribute('data-width')).toBe('36');
    sized.unmount();
    const bare = render(<Piece piece={{ color: 'w', type: 'k' } as never} />);
    expect(bare.container.querySelector('[data-svg="Svg"]')?.getAttribute('data-width')).toBe('36');
    bare.unmount();
    const small = render(<Piece piece={{ color: 'b', type: 'p' } as never} size={29} />);
    expect(small.container.querySelector('[data-svg="Svg"]')?.getAttribute('data-width')).toBe('26');
  });
});

describe('the piece itself: all twelve kinds', () => {
  it.each(['w', 'b'] as const)('every %s piece is marked with its kind and drawn with its colour\'s fill and outline', (color) => {
    const ink = color === 'w' ? WHITE : BLACK;
    for (const type of TYPES) {
      const { container, unmount } = render(<Piece piece={{ color, type } as never} size={40} />);
      const marked = container.querySelector(`[data-piece="${color}${type}"]`) as HTMLElement | null;
      expect(marked, `${color}${type}`).not.toBeNull();
      const drawn = paths(marked as HTMLElement);
      expect(drawn.length, `${color}${type}`).toBeGreaterThan(0);
      for (const path of drawn) {
        expect(path.getAttribute('data-fill'), `${color}${type} fill`).toBe(ink.fill);
        expect(path.getAttribute('data-stroke'), `${color}${type} outline`).toBe(ink.stroke);
      }
      unmount();
    }
  });

  it('the black king is NOT the white king: different fill, different outline (the phone bug)', () => {
    const white = render(<Piece piece={{ color: 'w', type: 'k' } as never} size={40} />);
    const whiteFill = paths(white.container)[0].getAttribute('data-fill');
    white.unmount();
    const black = render(<Piece piece={{ color: 'b', type: 'k' } as never} size={40} />);
    const blackFill = paths(black.container)[0].getAttribute('data-fill');
    expect(blackFill).toBe('#1d1d1d');
    expect(whiteFill).toBe('#fafafa');
    expect(blackFill).not.toBe(whiteFill);
  });

  it('a themed piece (an image set) is still an image: the vector is only the built-in theme', () => {
    const { container } = render(<Piece piece={{ color: 'b', type: 'k' } as never} images={{ bk: 'data:image/png;base64,AAAA' }} size={40} />);
    expect(container.querySelector('[data-piece]')).toBeNull();
    expect(container.querySelector('img')).not.toBeNull();
  });
});

const H: SeatController = { kind: 'human' };
const HUMANS: SeatConfig = [H, H, H, H];

describe('the Bughouse boards: the colour of every drawn piece is the colour of the piece the ENGINE says stands there', () => {
  it('at the start: 32 pieces on each board, each marked and filled as the engine\'s position says, the black king included', () => {
    render(<BughouseGameScreen seats={HUMANS} timeControl={{ initialMs: 180000, incrementMs: 0 }} onExit={() => {}} rng={mulberry32(5)} clock={() => Date.now()} />);
    for (const board of ['A', 'B'] as const) {
      const fen = screen.getByTestId(`board-${board}`);
      expect(fen.querySelectorAll('[data-piece]')).toHaveLength(32);
      const grid = openBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')?.board() ?? [];
      grid.forEach((row, r) =>
        row.forEach((piece, f) => {
          const square = `${'abcdefgh'[f]}${8 - r}`;
          const cell = screen.getByTestId(`${board}-${square}`);
          const marked = cell.querySelector('[data-piece]') as HTMLElement | null;
          if (!piece) {
            expect(marked, `${board}-${square} is empty`).toBeNull();
            return;
          }
          expect(marked?.getAttribute('data-piece'), `${board}-${square}`).toBe(piece.color + piece.type);
          const ink = piece.color === 'w' ? WHITE : BLACK;
          for (const path of paths(marked as HTMLElement)) expect(path.getAttribute('data-fill'), `${board}-${square}`).toBe(ink.fill);
        }),
      );
      expect(paths(screen.getByTestId(`${board}-e8`))[0].getAttribute('data-fill'), 'the black king').toBe('#1d1d1d');
      expect(paths(screen.getByTestId(`${board}-e1`))[0].getAttribute('data-fill'), 'the white king').toBe('#fafafa');
    }
  });
  // (the pocket chips - each in its player's colour - are in bughousePockets.dom.test.tsx, with the full pockets)

  it('a piece on a Bughouse board is drawn at 90 % of ITS CELL (the cell of the layout, not a default)', () => {
    render(<BughouseGameScreen seats={HUMANS} timeControl={{ initialMs: 180000, incrementMs: 0 }} onExit={() => {}} rng={mulberry32(5)} clock={() => Date.now()} />);
    const cell = getBughouseDualCellSize(window.innerWidth, window.innerHeight).cell;
    expect(cell).toBeGreaterThan(30);
    expect(screen.getByTestId('A-e8').querySelector('[data-svg="Svg"]')?.getAttribute('data-width')).toBe(String(Math.floor(cell * 0.9)));
  });

  it('the SQUARES are coloured as on every chess board (found while looking at the pieces): a1 and h8 dark, a8 and h1 light - they were the other way round', () => {
    render(<BughouseGameScreen seats={HUMANS} timeControl={{ initialMs: 180000, incrementMs: 0 }} onExit={() => {}} rng={mulberry32(5)} clock={() => Date.now()} />);
    const colour = (id: string) => (screen.getByTestId(id).getAttribute('style') ?? '').match(/background-color: ([^;]+)/)?.[1];
    // the Classic theme: light #f0d9b5, dark #b58863 (src/logic/boardThemes.ts)
    const LIGHT = 'rgb(240, 217, 181)';
    const DARK = 'rgb(181, 136, 99)';
    for (const board of ['A', 'B']) {
      expect(colour(`${board}-a1`), `${board} a1`).toBe(DARK);
      expect(colour(`${board}-h8`), `${board} h8`).toBe(DARK);
      expect(colour(`${board}-a8`), `${board} a8`).toBe(LIGHT);
      expect(colour(`${board}-h1`), `${board} h1`).toBe(LIGHT);
      expect(colour(`${board}-e4`), `${board} e4`).toBe(LIGHT);
      expect(colour(`${board}-d4`), `${board} d4`).toBe(DARK);
    }
  });
});

describe('the 4-seat board: every piece is in its SEAT\'s colour', () => {
  const SEAT_FILL = ['#d32f2f', '#1976d2', '#f9a825', '#2e7d32'];

  it('4 Player Chess at the start: every drawn piece carries its seat and is filled with that seat\'s colour', () => {
    const { container } = render(<FourPlayerGameScreen variant="ffa" seats={HUMANS} timeControl={{ id: 'none', label: 'No time limit', initialSeconds: 0, incrementSeconds: 0, category: 'unlimited' }} onExit={() => {}} />);
    const marked = Array.from(container.querySelectorAll('[data-seat-piece]')) as HTMLElement[];
    expect(marked.length).toBe(64); // 4 seats x 16 pieces
    const perSeat = [0, 0, 0, 0];
    for (const element of marked) {
      const seat = Number((element.getAttribute('data-seat-piece') ?? '').split(':')[0]);
      perSeat[seat]++;
      for (const path of paths(element)) expect(path.getAttribute('data-fill')).toBe(SEAT_FILL[seat]);
    }
    expect(perSeat).toEqual([16, 16, 16, 16]);
    // every seat has its own army: 8 pawns, 2 knights, 2 bishops, 2 rooks, a queen and a king - each drawn as that silhouette
    const byKind = new Map<string, number>();
    for (const element of marked) {
      const kind = (element.getAttribute('data-seat-piece') ?? '').split(':')[1];
      byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
      expect(paths(element).map((path) => path.getAttribute('data-d')), kind).toEqual([...PIECE_PATHS[kind as 'p']]);
    }
    expect(Object.fromEntries(byKind)).toEqual({ p: 32, n: 8, b: 8, r: 8, q: 4, k: 4 });
  });
});
