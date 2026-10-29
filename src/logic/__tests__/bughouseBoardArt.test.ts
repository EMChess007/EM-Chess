import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What the Android device matrix found on the Bughouse game screens once a game has pieces in its pockets and a promoted piece on a board (a state the matrix only meets by chance, because
 * the bots keep playing; it was reproduced with a fixture of full pockets, 4 screens x 720 combinations, all green after these fixes). Pinned as source scans (jsdom has no layout):
 *   - the "~" of a promoted piece and the pocket chips' glyph and count are board art: `maxFontSizeMultiplier={1}` (they used to grow with the system font and spill out of their cell / chip);
 *   - a pocket with many kinds of piece WRAPS inside its bar (`flexWrap: 'wrap'`, `minWidth: 0`) instead of running over the clock beside it;
 *   - a board's block is as wide as its board (`width: cell * 8 + 6`), so two boards side by side cannot push the second one past a landscape phone's edge.
 */
const root = path.resolve(__dirname, '..', '..', '..');
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8');

describe('Bughouse board art and pocket bars', () => {
  const block = read('src/components/BughouseBoardBlock.tsx');
  const board = read('src/components/BughouseBoard.tsx');

  it('the promoted mark does not grow with the system font', () => {
    expect(board).toContain('<Text maxFontSizeMultiplier={1} style={[styles.promotedMark,');
  });

  it('the pocket chip glyph and count do not grow with the system font', () => {
    expect(block).toContain('<Text maxFontSizeMultiplier={1} style={[styles.glyph,');
    expect(block).toContain('<Text maxFontSizeMultiplier={1} style={styles.count}>');
  });

  it('the pocket wraps and may shrink below its content', () => {
    expect(block).toMatch(/pocket: \{ flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap',/);
  });

  it('side by side, a block is as wide as its board plus the 3 dp outline on each side; stacked it is not constrained', () => {
    expect(block).toContain('style={[styles.block, props.sideBySide && { width: cell * 8 + 6 }]}');
    const screen = read('src/screens/BughouseGameScreen.tsx');
    expect(screen).toContain("sideBySide={dual ? dualFit.arrangement === 'sideBySide' : arrangement === 'sideBySide'}");
  });
});
