import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { boardFromFen, STARTING_EDITOR_FEN } from '../../logic/boardEditor';
import { setWindowSize } from '../../test/domKit';
import BoardSetupScreen from '../BoardSetupScreen';
import SetupChessBuilderScreen from '../SetupChessBuilderScreen';

/**
 * COMMAND #55: the Board Editor board wrapped to 7 columns on a 360 dp phone (AppPressable's 44 dp floor grew each 41 dp square). Rendered: exactly 8 rows of 8 squares in
 * the order a board is read (rank 8 first, file a first), the start position's pieces on the right squares (compared with the engine's own `boardFromFen`), every square a
 * `compact` control (no 44 dp floor) of exactly the square size, and the rows exactly 8 squares wide at 320 / 360 / 393 / 411 / 600 dp. jsdom has no layout engine: that the
 * 64 squares really are on 8 columns on a phone is pinned by the Android e2e (scripts/android/e2e.mjs, boardEditorGrid).
 */
vi.mock('expo-clipboard', () => ({ setStringAsync: async () => {}, getStringAsync: async () => '' }));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: async () => ({ canceled: true, assets: null }) }));
vi.mock('expo-font', () => ({ useFonts: () => [true, null], loadAsync: async () => {}, isLoaded: () => true }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));

const FILES = 'abcdefgh';
const px = (value: string): number => Number.parseFloat(value);
const PIECE_WORDS: Record<string, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

function renderEditor() {
  return render(<BoardSetupScreen onBack={() => {}} onAnalyze={() => {}} />);
}

describe('BoardSetupScreen board grid', () => {
  it('renders exactly 8 rows of 8 squares, rank 8 first, with the start position on the right squares', () => {
    renderEditor();
    const engine = boardFromFen(STARTING_EDITOR_FEN);
    expect(screen.getAllByTestId(/^editor-board-row-/)).toHaveLength(8);
    expect(screen.getAllByTestId(/^editor-square-/)).toHaveLength(64);
    for (let r = 0; r < 8; r++) {
      const row = screen.getByTestId(`editor-board-row-${r}`);
      const cells = Array.from(row.children) as HTMLElement[];
      expect(cells.map((c) => c.getAttribute('data-testid')), `row ${r}`).toEqual(Array.from(FILES, (f) => `editor-square-${f}${8 - r}`));
      cells.forEach((cell, c) => {
        const piece = engine[r][c].piece;
        const expected = `${FILES[c]}${8 - r}, ${piece ? `${piece.color === 'w' ? 'white' : 'black'} ${PIECE_WORDS[piece.type]}` : 'empty'}`;
        expect(cell.getAttribute('aria-label'), `${FILES[c]}${8 - r}`).toBe(expected);
      });
    }
    // literal spot checks (not derived from the engine): the kings and a pawn of the start position
    expect(screen.getByTestId('editor-square-e1').getAttribute('aria-label')).toBe('e1, white king');
    expect(screen.getByTestId('editor-square-e8').getAttribute('aria-label')).toBe('e8, black king');
    expect(screen.getByTestId('editor-square-d2').getAttribute('aria-label')).toBe('d2, white pawn');
    expect(screen.getByTestId('editor-square-e4').getAttribute('aria-label')).toBe('e4, empty');
  });

  it('every square is a compact control (no 44 dp floor): the matrix-exempt mark is on all 64', () => {
    renderEditor();
    for (const cell of screen.getAllByTestId(/^editor-square-/)) expect(cell.getAttribute('data-matrix-exempt'), cell.getAttribute('data-testid') ?? '').toBe('1');
    // the controls beside the board keep the floor
    expect(screen.getByText('Starting Position').closest('[tabindex]')?.getAttribute('data-matrix-exempt') ?? null).toBeNull();
  });

  it.each([320, 360, 393, 411, 600])('at %i dp each row is 8 squares wide and each square is exactly the square size', (width) => {
    setWindowSize(width, 800);
    renderEditor();
    const rowWidth = px(screen.getByTestId('editor-board-row-0').style.width);
    const squareWidth = px(screen.getByTestId('editor-square-a8').style.width);
    expect(rowWidth).toBe(8 * squareWidth);
    expect(px(screen.getByTestId('editor-square-h1').style.height)).toBe(squareWidth);
    // 8 squares + the 2 dp border on each side fit inside the screen's 16 dp side padding
    expect(rowWidth + 4).toBeLessThanOrEqual(width - 32);
    for (let r = 0; r < 8; r++) expect(px(screen.getByTestId(`editor-board-row-${r}`).style.width)).toBe(rowWidth);
  });

  it('360 dp: the squares are 40 dp, below the 44 dp floor, in a 320 dp row', () => {
    setWindowSize(360, 800);
    renderEditor();
    expect(screen.getByTestId('editor-square-a1').style.width).toBe('40px');
    expect(screen.getByTestId('editor-board-row-3').style.width).toBe('320px');
  });

  it('a tap on a square still edits that square (the eraser takes the white king off e1)', () => {
    renderEditor();
    expect(screen.getByTestId('editor-square-e1').getAttribute('aria-label')).toBe('e1, white king');
    fireEvent.click(screen.getByText('Eraser'));
    fireEvent.click(screen.getByTestId('editor-square-e1'));
    expect(screen.getByTestId('editor-square-e1').getAttribute('aria-label')).toBe('e1, empty');
    expect(screen.getByTestId('editor-square-d1').getAttribute('aria-label')).toBe('d1, white queen');
  });
});

describe('SetupChessBuilderScreen board grid', () => {
  it('renders 8 rows of 8, with the 16 own-rank squares touchable and compact', () => {
    setWindowSize(360, 800);
    render(<SetupChessBuilderScreen color="w" title="Build" onFinalize={() => {}} onBack={() => {}} />);
    expect(screen.getAllByTestId(/^editor-board-row-/)).toHaveLength(8);
    for (let r = 0; r < 8; r++) expect(screen.getByTestId(`editor-board-row-${r}`).children).toHaveLength(8);
    const touchable = screen.getAllByTestId(/^editor-square-/);
    expect(touchable).toHaveLength(16);
    for (const cell of touchable) expect(cell.getAttribute('data-matrix-exempt')).toBe('1');
    expect(screen.getByTestId('editor-board-row-0').style.width).toBe('320px');
  });
});
