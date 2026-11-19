import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkEditorGrid, editorSquares } from '../../../scripts/android/lib/editorGrid.mjs';
import { editorSquareLabel, boardFromFen, STARTING_EDITOR_FEN } from '../boardEditor';

/**
 * COMMAND #55, the judgement of the Android check "Board Editor: the 64 squares are 8 columns x 8 rows and none overlaps the toolbar" (scripts/android/e2e.mjs boardEditorGrid), on
 * synthetic accessibility trees: the correct 360 dp phone layout passes, the old 7-column wrap (and its cousins) is reported. The emulator run is CI-only.
 */
type Bounds = { x1: number; y1: number; x2: number; y2: number; w: number; h: number; cx: number; cy: number };
type Node = { desc: string; text: string; id: string; cls: string; bounds: Bounds };
const box = (x1: number, y1: number, w: number, h: number): Bounds => ({ x1, y1, x2: x1 + w, y2: y1 + h, w, h, cx: x1 + w / 2, cy: y1 + h / 2 });
const node = (desc: string, text: string, bounds: Bounds): Node => ({ desc, text, id: '', cls: 'android.view.ViewGroup', bounds });

/** A 360 dp phone at density 2.625: squares of `size` px starting at (x0, y0); `place(col, row)` may move a square (to model a wrap). */
function editorTree({ size = 105, x0 = 60, y0 = 400, place }: { size?: number; x0?: number; y0?: number; place?: (col: number, row: number) => [number, number] } = {}): Node[] {
  const nodes: Node[] = [];
  boardFromFen(STARTING_EDITOR_FEN).forEach((row, r) =>
    row.forEach((sq, c) => {
      const [col, rr] = place ? place(c, r) : [c, r];
      nodes.push(node(editorSquareLabel(sq), '', box(x0 + col * size, y0 + rr * size, size, size)));
    })
  );
  const bottom = y0 + 8 * size;
  nodes.push(node('', 'Starting Position', box(40, bottom + 30, 400, 120)));
  nodes.push(node('', 'Clear Board', box(500, bottom + 30, 400, 120)));
  return nodes;
}

describe('checkEditorGrid', () => {
  it('passes the correct layout: 8 columns x 8 rows, the buttons below the board', () => {
    expect(checkEditorGrid(editorTree())).toEqual([]);
    expect(editorSquares(editorTree())).toHaveLength(64);
  });

  it('reports the 7-column wrap of the bug (the 64 squares flowing on 7 per row)', () => {
    const wrapped = editorTree({ place: (c, r) => [(r * 8 + c) % 7, Math.floor((r * 8 + c) / 7)] });
    const issues = checkEditorGrid(wrapped);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(' | ')).toMatch(/not one column|not one row/);
  });

  it('reports a board that overlaps the toolbar buttons', () => {
    const tree = editorTree();
    for (const n of tree) if (n.text === 'Starting Position') n.bounds = box(40, 400 + 8 * 105 - 60, 400, 120);
    expect(checkEditorGrid(tree).join(' | ')).toContain('overlaps the "Starting Position" button');
  });

  it('reports a missing square, and squares of different sizes', () => {
    const missing = editorTree().filter((n) => !n.desc.startsWith('h1,'));
    expect(checkEditorGrid(missing)[0]).toContain('63 editor squares');
    expect(checkEditorGrid(missing)[0]).toContain('h1');
    const tree = editorTree();
    tree[10].bounds = box(tree[10].bounds.x1, tree[10].bounds.y1, 80, 80);
    expect(checkEditorGrid(tree).join(' | ')).toContain('not all the same size');
  });

  it('reports overlapping squares and an empty screen', () => {
    const tree = editorTree();
    tree[1].bounds = box(tree[0].bounds.x1 + 20, tree[0].bounds.y1, 105, 105);
    expect(checkEditorGrid(tree).join(' | ')).toContain('a8 and b8 overlap');
    expect(checkEditorGrid([])[0]).toContain('0 editor squares');
  });

  it('the Android run calls the check in the 2-player touch slice (both phones, the 360 dp one included)', () => {
    const e2e = readFileSync(join(__dirname, '../../../scripts/android/e2e.mjs'), 'utf8');
    expect(e2e).toContain('await boardEditorGrid(dev);');
    expect(e2e).toContain('checkEditorGrid(nodes)');
  });

  it('a pixel of rounding between two squares of a column is tolerated', () => {
    const tree = editorTree();
    tree[8].bounds = box(tree[8].bounds.x1 + 1, tree[8].bounds.y1, 105, 105);
    expect(checkEditorGrid(tree)).toEqual([]);
  });
});
