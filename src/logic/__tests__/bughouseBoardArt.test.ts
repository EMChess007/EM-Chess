import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What the Android device matrix found on the Bughouse game screens once a game has pieces in its pockets and a promoted piece on a board (a state the matrix only meets by chance, because
 * the bots keep playing; it was reproduced with a fixture of full pockets, 4 screens x 720 combinations, all green after these fixes). Pinned as source scans (jsdom has no layout):
 *   - the "~" of a promoted piece and the pocket chips' glyph and count are board art: `maxFontSizeMultiplier={1}` (they used to grow with the system font and spill out of their cell / chip);
 *   - (command #27b: the pocket no longer wraps - see the second test below)
 *   - a board's block is as wide as its board (`width: cell * 8 + 6`), so two boards side by side cannot push the second one past a landscape phone's edge.
 */
const root = path.resolve(__dirname, '..', '..', '..');
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8');

describe('the stacked boards are sized from what was measured', () => {
  const screen = read('src/screens/BughouseGameScreen.tsx');
  it('the screen asks fitStackedCell with the cell the measurement was taken at, the width limit and a floor that is never above the table cell', () => {
    expect(screen).toContain('fitStackedCell(dualCell, scrollViewportHeight, measured.content, Math.floor((width - 16) / 8), Math.min(dualFit.cell, BUGHOUSE_DUAL_MIN_CELL))');
    expect(screen).toContain('measured.cell !== dualCell'); // a stale measurement is never used
    expect(screen).toContain('setMeasured({ cell: renderedCell.current, content: h })');
  });
  it('the result card does not shrink the boards, and a new window starts again from the table', () => {
    expect(screen).toMatch(/if \(!stacked \|\| over \|\| measured === null/);
    expect(screen).toMatch(/setCellAdjust\(0\);\n\s+setMeasured\(null\);\n\s+\}, \[width, height, stacked\]\);/);
  });
});

describe('Bughouse board art and pocket bars', () => {
  const block = read('src/components/BughouseBoardBlock.tsx');
  const board = read('src/components/BughouseBoard.tsx');

  it('the promoted mark does not grow with the system font', () => {
    expect(board).toContain('<Text maxFontSizeMultiplier={1} style={[styles.promotedMark,');
  });

  it('the pocket chip count, the team shape and the clock do not grow with the system font (the piece is a vector: it has no text at all)', () => {
    expect(block).toContain('<Text maxFontSizeMultiplier={1} style={styles.count}>');
    expect(block).toMatch(/<Text maxFontSizeMultiplier=\{1\} style=\{styles\.shape\}>/);
    expect(block).toContain('<Text maxFontSizeMultiplier={1} style={[styles.clock,');
    expect(block).not.toMatch(/styles\.glyph/);
  });

  it('the pocket NEVER wraps (command #27b: the wrapping row stacked its chips over the board on a real phone): one row, a reserved width, no shrink, a definite height, inside a strip that clips', () => {
    expect(block).toMatch(/pocket: \{ flexGrow: 1, flexShrink: 0, minWidth: 0, flexDirection: 'row', flexWrap: 'nowrap',/);
    expect(block).not.toMatch(/flexWrap: 'wrap'/);
    expect(block).toMatch(/height: pocketChipHeight\(compact\) \+ 2,/);
    expect(block).toMatch(/bar: \{[^}]*overflow: 'hidden' \}/);
  });

  it('side by side, a block is as wide as its board plus the 3 dp outline on each side; stacked it is not constrained', () => {
    expect(block).toContain('style={[styles.block, props.sideBySide && { width: cell * 8 + 6 }]}');
    const screen = read('src/screens/BughouseGameScreen.tsx');
    expect(screen).toContain("sideBySide={dual ? dualFit.arrangement === 'sideBySide' : arrangement === 'sideBySide'}");
  });
});
