import { act, render, screen } from '@testing-library/react';
import { Chess } from 'chess.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChessBoard from '../../components/ChessBoard';
import Piece from '../../components/Piece';
import { getBughouseDualCellSize } from '../../logic/bughouseLayout';
import { mulberry32 } from '../../logic/__tests__/bughouseTestKit';
import { openBoard } from '../../logic/bughouse';
import type { SeatConfig, SeatController } from '../../logic/fourPlayer/setup';
import { AVAILABLE_PIECE_THEMES } from '../../logic/pieceThemes';
import { setActivePieceTheme } from '../../logic/themeSettings';
import BughouseGameScreen from '../BughouseGameScreen';

/**
 * EVERY PIECE THEME, RENDERED (command #27c): the real Piece, the real 2-player board and the real Bughouse screen, under each of the four themes the app ships, compared with what the ENGINE
 * says stands on the board. A phone showed the black rook, queen and king in the white pieces' colours; the earlier rendered test (pieceColours.dom.test.tsx) only ever drew the built-in
 * vector set, so no image theme was ever looked at. The theme ids, the kinds and the ink are LITERALS (a mutant of the registry or of Piece cannot move the expectation with it).
 * The pixels of the same boards are the device matrix's check (android-matrix-pieces.mjs, `--screens game-2p-theme-*,bughouse-all-pieces-dual-theme-*`).
 */
const THEME_IDS = ['default', 'cburnett', 'merida', 'checkers'];
const IMAGE_THEME_IDS = ['cburnett', 'merida', 'checkers'];
const KINDS = ['k', 'q', 'r', 'b', 'n', 'p'] as const;
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const WORDS = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' } as const;

const imagesOf = (id: string): Record<string, string> => {
  const images = AVAILABLE_PIECE_THEMES.find((theme) => theme.id === id)?.images;
  if (!images) throw new Error(`${id} has no images`);
  return images as Record<string, string>; // a bundled file's URL under vitest (an asset id on a phone)
};
const srcOf = (marked: Element) => marked.querySelector('img')?.getAttribute('src') ?? null;
const markers = (root: Element) => Array.from(root.querySelectorAll('[data-piece]')) as HTMLElement[];

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
});
afterEach(async () => {
  await act(async () => {
    await setActivePieceTheme('default');
  });
  vi.restoreAllMocks();
});

describe.each(IMAGE_THEME_IDS)('Piece under %s', (id) => {
  it('every one of the twelve is marked with its colour and kind, labelled for a screen reader, and draws ITS OWN image', () => {
    const images = imagesOf(id);
    for (const color of ['w', 'b'] as const) {
      for (const type of KINDS) {
        const { container, unmount } = render(<Piece piece={{ color, type } as never} images={images} size={40} />);
        const marked = container.querySelector(`[data-piece="${color}${type}"]`) as HTMLElement | null;
        expect(marked, `${color}${type}`).not.toBeNull();
        expect(marked?.getAttribute('aria-label'), `${color}${type}`).toBe(`${color === 'w' ? 'white' : 'black'} ${WORDS[type]}`);
        expect(srcOf(marked as HTMLElement), `${color}${type}`).toBe(images[`${color}${type}`]);
        expect(container.querySelectorAll('[data-piece]'), `${color}${type}`).toHaveLength(1);
        unmount();
      }
    }
  });

  it('the black rook, queen and king draw the BLACK images and not the white ones (the phone bug)', () => {
    const images = imagesOf(id);
    for (const type of ['r', 'q', 'k'] as const) {
      const white = render(<Piece piece={{ color: 'w', type } as never} images={images} size={40} />);
      const whiteSrc = srcOf(white.container.querySelector('[data-piece]') as HTMLElement);
      white.unmount();
      const black = render(<Piece piece={{ color: 'b', type } as never} images={images} size={40} />);
      const blackSrc = srcOf(black.container.querySelector('[data-piece]') as HTMLElement);
      black.unmount();
      expect(blackSrc, `b${type}`).toBe(images[`b${type}`]);
      expect(whiteSrc, `w${type}`).toBe(images[`w${type}`]);
      expect(blackSrc, `b${type} is not w${type}`).not.toBe(whiteSrc);
    }
  });

  it('the image fills the same 85 % box it always did (the marker wrapper is the box, the image fills it)', () => {
    const { container } = render(<Piece piece={{ color: 'b', type: 'k' } as never} images={imagesOf(id)} size={40} />);
    const wrapper = container.querySelector('[data-piece]') as HTMLElement;
    expect(wrapper.getAttribute('role')).toBe('img');
    const box = window.getComputedStyle(wrapper);
    expect([box.width, box.height]).toEqual(['85%', '85%']);
    const image = window.getComputedStyle(wrapper.firstElementChild as Element);
    expect([image.width, image.height]).toEqual(['100%', '100%']);
  });
});

describe('Piece under the built-in theme', () => {
  it('every one of the twelve is marked and drawn as a vector in its literal fill (white #fafafa, black #1d1d1d), and has no image', () => {
    for (const color of ['w', 'b'] as const) {
      for (const type of KINDS) {
        const { container, unmount } = render(<Piece piece={{ color, type } as never} size={40} />);
        const marked = container.querySelector(`[data-piece="${color}${type}"]`) as HTMLElement;
        expect(marked.querySelector('img'), `${color}${type}`).toBeNull();
        for (const path of Array.from(marked.querySelectorAll('[data-svg="Path"]'))) expect(path.getAttribute('data-fill'), `${color}${type}`).toBe(color === 'w' ? '#fafafa' : '#1d1d1d');
        unmount();
      }
    }
  });

  it('a theme without the key (an incomplete custom set) falls back to the vector piece rather than drawing nothing', () => {
    const { container } = render(<Piece piece={{ color: 'b', type: 'k' } as never} images={{ wk: 'data:image/png;base64,AAAA' }} size={40} />);
    expect(container.querySelector('[data-piece="bk"] [data-svg="Path"]')?.getAttribute('data-fill')).toBe('#1d1d1d');
  });
});

describe.each(THEME_IDS)('the 2-player board under %s', (id) => {
  it('draws the 32 pieces the engine says are there, in the engine\'s order, each in its own colour', async () => {
    await act(async () => {
      await setActivePieceTheme(id);
    });
    const { container } = render(<ChessBoard fen={START} onMove={() => {}} />);
    const expected = new Chess(START)
      .board()
      .flat()
      .filter((piece) => piece !== null)
      .map((piece) => `${piece?.color}${piece?.type}`);
    const drawn = markers(container);
    expect(drawn.map((el) => el.getAttribute('data-piece'))).toEqual(expected);
    expect(drawn).toHaveLength(32);
    if (id === 'default') {
      for (const el of drawn) {
        const fill = el.querySelector('[data-svg="Path"]')?.getAttribute('data-fill');
        expect(fill, el.getAttribute('data-piece') ?? '').toBe(el.getAttribute('data-piece')?.[0] === 'w' ? '#fafafa' : '#1d1d1d');
      }
    } else {
      const images = imagesOf(id);
      for (const el of drawn) expect(srcOf(el), el.getAttribute('data-piece') ?? '').toBe(images[el.getAttribute('data-piece') ?? '']);
    }
  });
});

const H: SeatController = { kind: 'human' };
const HUMANS: SeatConfig = [H, H, H, H];

describe.each(THEME_IDS)('the Bughouse dual screen under %s', (id) => {
  it('every cell of both boards shows the piece the engine\'s position says, in that piece\'s colour: the black rook, queen and king included', async () => {
    await act(async () => {
      await setActivePieceTheme(id);
    });
    render(<BughouseGameScreen seats={HUMANS} timeControl={{ initialMs: 180000, incrementMs: 0 }} onExit={() => {}} rng={mulberry32(5)} clock={() => Date.now()} />);
    expect(getBughouseDualCellSize(window.innerWidth, window.innerHeight).cell).toBeGreaterThan(30);
    const images = id === 'default' ? null : imagesOf(id);
    for (const board of ['A', 'B'] as const) {
      expect(markers(screen.getByTestId(`board-${board}`))).toHaveLength(32);
      const grid = openBoard(START)?.board() ?? [];
      grid.forEach((row, r) =>
        row.forEach((piece, f) => {
          const square = `${'abcdefgh'[f]}${8 - r}`;
          const marked = screen.getByTestId(`${board}-${square}`).querySelector('[data-piece]') as HTMLElement | null;
          if (!piece) {
            expect(marked, `${board}-${square} is empty`).toBeNull();
            return;
          }
          const key = `${piece.color}${piece.type}`;
          expect(marked?.getAttribute('data-piece'), `${board}-${square}`).toBe(key);
          if (images) expect(srcOf(marked as HTMLElement), `${board}-${square} ${key}`).toBe(images[key]);
          else expect(marked?.querySelector('[data-svg="Path"]')?.getAttribute('data-fill'), `${board}-${square} ${key}`).toBe(piece.color === 'w' ? '#fafafa' : '#1d1d1d');
        }),
      );
      for (const square of ['a8', 'h8', 'd8', 'e8']) {
        const marked = screen.getByTestId(`${board}-${square}`).querySelector('[data-piece]') as HTMLElement;
        const expectedKey = { a8: 'br', h8: 'br', d8: 'bq', e8: 'bk' }[square];
        expect(marked.getAttribute('data-piece'), `${board}-${square}`).toBe(expectedKey);
        if (images) expect(srcOf(marked), `${board}-${square}`).toBe(images[expectedKey as string]);
      }
    }
  });
});
