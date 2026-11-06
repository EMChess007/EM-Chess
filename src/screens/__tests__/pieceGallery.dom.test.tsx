import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addCustomBoardThemeOption, removeCustomBoardThemeOption } from '../../logic/boardThemes';
import { AVAILABLE_PIECE_THEMES, addCustomPieceThemeOption, removeCustomPieceThemeOption } from '../../logic/pieceThemes';
import DiagnosticLogsScreen from '../DiagnosticLogsScreen';
import PieceGalleryScreen from '../PieceGalleryScreen';

vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('@sentry/react-native', () => ({ addBreadcrumb: vi.fn() }));
vi.mock('expo-constants',() => ({ default: { expoConfig: { extra: { buildInfo: { commit: 'abc1234', builtAt: '2026-10-30T14:45:12.000Z' } } } } }));

/**
 * THE PIECE GALLERY, RENDERED (command #27d): the real screen under the real registry. Every piece theme - the four built-in ones and a custom one - gets all twelve pieces on a light AND on a
 * dark square (marked with the colour and kind it draws, compared with the grid's own row), the same twelve as pocket chips, and the build identifier sits in the header. The ids, the
 * counts, the label text and the order are literals.
 */
const KINDS = ['k', 'q', 'r', 'b', 'n', 'p'];
const THEME_IDS = ['default', 'cburnett', 'merida', 'checkers'];

afterEach(() => {
  removeCustomPieceThemeOption('custom-gallery');
});

describe('Diagnostics', () => {
  it('shows the build identifier and a Piece gallery button that opens the gallery', () => {
    const open = vi.fn();
    render(<DiagnosticLogsScreen onBack={() => undefined} onOpenPieceGallery={open} />);
    expect(screen.getByTestId('build-id').textContent).toBe('build abc1234 · 2026-10-30 14:45 UTC');
    fireEvent.click(screen.getByTestId('open-piece-gallery'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Run text-fit check')).toBeTruthy();
  });
});

describe('the gallery', () => {
  it('carries the build identifier in its fixed header, above the scrolling part', () => {
    const { container } = render(<PieceGalleryScreen onBack={() => undefined} />);
    expect(container.textContent).toContain('build abc1234 · 2026-10-30 14:45 UTC');
    expect(screen.getByText('Piece gallery')).toBeTruthy();
  });

  it('has one section per theme, in the registry\'s order, custom ones included', () => {
    addCustomPieceThemeOption({ id: 'custom-gallery', name: 'Mine', images: { ...AVAILABLE_PIECE_THEMES[2].images }, isCustom: true });
    render(<PieceGalleryScreen onBack={() => undefined} />);
    const sections = Array.from(document.querySelectorAll('[data-testid^="gallery-theme-"]')).map((node) => node.getAttribute('data-testid'));
    expect(sections).toEqual([...THEME_IDS, 'custom-gallery'].map((id) => `gallery-theme-${id}`));
  });

  it.each(THEME_IDS)('under %s: 24 cells (12 pieces x light and dark), each marked with the colour and kind of its own row and column', (id) => {
    render(<PieceGalleryScreen onBack={() => undefined} />);
    const section = document.querySelector(`[data-testid="gallery-theme-${id}"]`) as HTMLElement;
    // the large grid only: the game-size blocks (5 board themes x 24 cells) are tested below
    const cells = (Array.from(section.querySelectorAll('[data-gallery-square]')) as HTMLElement[]).filter((c) => !(c.getAttribute('data-testid') ?? '').startsWith('gallery-game-'));
    expect(cells).toHaveLength(24);
    expect(section.querySelectorAll('[data-gallery-square]')).toHaveLength(24 + 5 * 24);
    for (const color of ['w', 'b']) {
      for (const square of ['light', 'dark']) {
        for (const kind of KINDS) {
          const cell = section.querySelector(`[data-testid="gallery-${id}-${color}${kind}-${square}"]`) as HTMLElement;
          expect(cell, `${color}${kind} ${square}`).not.toBeNull();
          expect(cell.getAttribute('data-gallery-square')).toBe(square);
          const marked = cell.querySelectorAll('[data-piece]');
          expect(marked, `${color}${kind} ${square}`).toHaveLength(1);
          expect(marked[0].getAttribute('data-piece')).toBe(`${color}${kind}`);
          expect(cell.getAttribute('aria-label')).toBe(`${AVAILABLE_PIECE_THEMES.find((t) => t.id === id)?.name}: ${color === 'w' ? 'white' : 'black'} ${{ k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' }[kind]} on a ${square} square`);
        }
      }
    }
  });

  it.each(THEME_IDS)('under %s: the same twelve as pocket chips, six white and six black', (id) => {
    render(<PieceGalleryScreen onBack={() => undefined} />);
    const section = document.querySelector(`[data-testid="gallery-theme-${id}"]`) as HTMLElement;
    for (const color of ['w', 'b']) {
      const row = section.querySelector(`[data-testid="gallery-chips-${id}-${color}"]`) as HTMLElement;
      expect(row.querySelectorAll('[aria-label$="pocket chip"]')).toHaveLength(6);
    }
  });

  it('an image theme draws its OWN file in every cell, and the black king is not the white king\'s file', () => {
    render(<PieceGalleryScreen onBack={() => undefined} />);
    const merida = AVAILABLE_PIECE_THEMES.find((theme) => theme.id === 'merida')?.images as Record<string, string>;
    const srcIn = (id: string) => (document.querySelector(`[data-testid="${id}"] img`) as HTMLImageElement).getAttribute('src');
    expect(srcIn('gallery-merida-bk-dark')).toBe(merida.bk);
    expect(srcIn('gallery-merida-bk-light')).toBe(merida.bk);
    expect(srcIn('gallery-merida-wk-dark')).toBe(merida.wk);
    expect(merida.bk).not.toBe(merida.wk);
    expect(srcIn('gallery-merida-bq-dark')).toBe(merida.bq);
    expect(srcIn('gallery-merida-bq-dark')).not.toBe(srcIn('gallery-merida-wq-dark'));
  });

  it('has no probes and no colour-scheme buttons any more (the phone proved Android recolours nothing, command #28), and still says the system scheme', () => {
    render(<PieceGalleryScreen onBack={() => undefined} />);
    expect(screen.queryByTestId('gallery-probes')).toBeNull();
    expect(screen.queryByTestId('gallery-lock-light')).toBeNull();
    expect(screen.queryByTestId('gallery-follow-system')).toBeNull();
    expect(screen.queryByText('Lock app to light')).toBeNull();
    expect(screen.queryByText('Follow system')).toBeNull();
    expect(screen.getByTestId('gallery-device').textContent).toContain('system scheme');
  });

  it.each(THEME_IDS)('under %s: GAME SIZE, 32 dp cells, on every one of the five board themes: 24 cells each (12 pieces x light and dark), marked with the right colour and kind', (id) => {
    render(<PieceGalleryScreen onBack={() => undefined} />);
    const boards = ['default', 'wood', 'green', 'ocean', 'marble'];
    const squares: Record<string, [string, string]> = { default: ['#f0d9b5', '#b58863'], wood: ['#e8ca9a', '#a5682a'], green: ['#eeeed2', '#769656'], ocean: ['#dee3e6', '#4b7399'], marble: ['#e8e8e8', '#8a8a8a'] };
    const hexToRgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
    for (const board of boards) {
      const block = document.querySelector(`[data-testid="gallery-game-${id}-${board}"]`) as HTMLElement;
      expect(block, board).not.toBeNull();
      expect(block.querySelectorAll('[data-gallery-square]'), board).toHaveLength(24);
      for (const color of ['w', 'b']) {
        for (const [index, square] of ['light', 'dark'].entries()) {
          for (const kind of KINDS) {
            const cell = block.querySelector(`[data-testid="gallery-game-${id}-${board}-${color}${kind}-${square}"]`) as HTMLElement;
            expect(cell, `${board} ${color}${kind} ${square}`).not.toBeNull();
            // a cell is 32 dp wide and tall and painted in its board theme's square colour (a literal)
            expect(cell.style.width).toBe('32px');
            expect(cell.style.height).toBe('32px');
            expect(cell.style.backgroundColor).toBe(hexToRgb(squares[board][index]));
            const marked = cell.querySelectorAll('[data-piece]');
            expect(marked).toHaveLength(1);
            expect(marked[0].getAttribute('data-piece')).toBe(`${color}${kind}`);
          }
        }
      }
    }
  });

  it('a custom board theme gets its own game-size block', () => {
    addCustomBoardThemeOption({ id: 'custom-board', name: 'Mine', lightColor: '#ffffff', darkColor: '#000000', isCustom: true } as never);
    try {
      render(<PieceGalleryScreen onBack={() => undefined} />);
      expect(document.querySelector('[data-testid="gallery-game-default-custom-board"]')).not.toBeNull();
    } finally {
      removeCustomBoardThemeOption('custom-board');
    }
  });

  it('the pocket chips sit on the shared mid-tone chip colour', () => {
    render(<PieceGalleryScreen onBack={() => undefined} />);
    const chip = document.querySelector('[aria-label="Classic: black k pocket chip"]') as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.style.backgroundColor).toBe('rgb(181, 136, 99)');
  });
});
