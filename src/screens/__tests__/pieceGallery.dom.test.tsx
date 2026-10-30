import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    const cells = Array.from(section.querySelectorAll('[data-gallery-square]')) as HTMLElement[];
    expect(cells).toHaveLength(24);
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

  it('shows the three probes on each square colour and the two colour-scheme buttons', () => {
    render(<PieceGalleryScreen onBack={() => undefined} />);
    const probes = screen.getByTestId('gallery-probes');
    expect(probes.querySelectorAll('[data-gallery-square]')).toHaveLength(2);
    expect(probes.querySelectorAll('[data-svg="Rect"]')).toHaveLength(2);
    expect(probes.querySelectorAll('img')).toHaveLength(2);
    expect(screen.getByTestId('gallery-lock-light')).toBeTruthy();
    expect(screen.getByTestId('gallery-follow-system')).toBeTruthy();
    expect(screen.getByTestId('gallery-device').textContent).toContain('system scheme');
  });
});
