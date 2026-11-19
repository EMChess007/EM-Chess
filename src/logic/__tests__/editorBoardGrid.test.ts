import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { editorSquareStyle, getEditorSquareSize } from '../../components/boardSize';
import { editorSquareLabel } from '../boardEditor';

/**
 * COMMAND #55: the Board Editor board wrapped to 7 columns on a 360 dp phone. Its 64 squares were `Pressable`s in a `flexWrap` row; AppPressable's 44 dp floor grew the
 * phone's 41 dp squares to 44, 8 x 44 no longer fitted and the row wrapped. These tests pin (a) the editor's square size fits the width the screen gives it at every phone
 * width, (b) every Pressable rendered per board square is `compact` and the grid is explicit rows, never a wrapping row. The rendered side is in
 * screens/__tests__/boardEditorGrid.dom.test.tsx and the on-phone side in scripts/android/e2e.mjs (boardEditorGrid).
 */
const SRC = join(__dirname, '..', '..');
const BORDER = 2;
const SIDE_PADDING = 16;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__') sourceFiles(path, out);
    } else if (/\.tsx$/.test(name)) out.push(path);
  }
  return out;
}

describe('editor board size (a)', () => {
  // Literals on purpose (a mutation of the constants must be caught): the border is 2 dp, the screen's side padding 16 dp.
  const cases: [number, number][] = [
    [320, 35],
    [360, 40],
    [393, 44],
    [411, 46],
    [600, 50],
  ];
  it.each(cases)('at %i dp wide a square is %i dp and the 8 squares + border fit the content width', (width, square) => {
    expect(getEditorSquareSize(width)).toBe(square);
    expect(8 * square + 2 * BORDER).toBeLessThanOrEqual(width - 2 * SIDE_PADDING);
  });

  it('never wider than 400 dp of board, never below 24 dp a square', () => {
    expect(getEditorSquareSize(1400)).toBe(50);
    expect(getEditorSquareSize(100)).toBe(24);
  });

  it('fits at every width from 320 to 1000 (8 squares + border <= the content width) once the squares are above the 24 dp floor', () => {
    for (let width = 320; width <= 1000; width++) {
      expect(8 * getEditorSquareSize(width) + 2 * BORDER, `width ${width}`).toBeLessThanOrEqual(width - 2 * SIDE_PADDING);
    }
  });

  it('is exactly what the 44 dp floor would have broken: the old 360 dp square was below the floor', () => {
    expect(Math.floor((360 - 32) / 8)).toBe(41);
    // AppPressable's floor (MIN_TOUCH_TARGET) is 44: 8 x 44 = 352 > the 328 dp a 360 dp phone gives the board
    expect(41).toBeLessThan(44);
    expect(8 * 44).toBeGreaterThan(360 - 2 * SIDE_PADDING);
  });

  it('a square touch target is exactly the square and never shrinks inside its row', () => {
    expect(editorSquareStyle(40)).toEqual({ width: 40, height: 40, flexShrink: 0 });
  });

  it('labels a square for the screen reader (and the Android e2e)', () => {
    expect(editorSquareLabel({ square: 'e1', piece: { type: 'k', color: 'w' } })).toBe('e1, white king');
    expect(editorSquareLabel({ square: 'd8', piece: { type: 'q', color: 'b' } })).toBe('d8, black queen');
    expect(editorSquareLabel({ square: 'e4', piece: null })).toBe('e4, empty');
  });
});

describe('every Pressable per board square is compact (b)', () => {
  const files = sourceFiles(SRC);
  const perSquarePressables: { file: string; tag: string }[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/<Pressable\b/g)) {
      // the opening tag: up to the first `>` that is not the end of an arrow function (`=>`)
      const rest = text.slice(m.index, m.index + 800);
      const head = rest.slice(0, rest.search(/(?<!=)>/) + 1);
      // a per-square control names the square it draws (`squareData` / the editor testID), unlike a palette or toolbar button
      if (/squareData|editor-square-/.test(head)) perSquarePressables.push({ file: file.slice(SRC.length + 1), tag: head });
    }
  }

  it('finds the per-square Pressables of both editor screens', () => {
    const where = new Set(perSquarePressables.map((p) => p.file));
    expect([...where].sort()).toEqual(['screens/BoardSetupScreen.tsx', 'screens/SetupChessBuilderScreen.tsx']);
  });

  it.each(perSquarePressables.map((p) => [p.file, p.tag] as const))('%s: the square Pressable passes `compact`', (_file, tag) => {
    expect(tag).toMatch(/\bcompact\b/);
  });

  it('both editor screens draw their board through EditorBoardGrid (8 explicit rows) and not through their own wrapping row', () => {
    for (const name of ['BoardSetupScreen', 'SetupChessBuilderScreen']) {
      const text = readFileSync(join(SRC, 'screens', `${name}.tsx`), 'utf8');
      expect(text, name).toContain('<EditorBoardGrid');
      expect(text, name).not.toMatch(/boardBorder|styles\.board\b/);
    }
  });

  it('EditorBoardGrid renders row Views that never wrap and never shrink their squares', () => {
    const code = readFileSync(join(SRC, 'components', 'EditorBoardGrid.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).toContain("flexWrap: 'nowrap'");
    expect(code).not.toContain("'wrap'");
    expect(code).toContain('rows.map((row, rowIndex)');
  });
});
