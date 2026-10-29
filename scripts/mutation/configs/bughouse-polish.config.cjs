// Mutation set for the Bughouse polish after master's text-fit change was merged (branch paired/bughouse): the measured stacked cell (fitStackedCell and how the screen uses it), the
// no-break "Team 1" / "Board A" (keepTogether) and the pocket bar / board art rules (source scans).
//
//   node scripts/mutation/run.cjs scripts/mutation/configs/bughouse-polish.config.cjs        (chunks of at most 20 mutants; `--chunk N` runs one)
const L = 'src/logic/bughouseLayout.ts';
const G = 'src/screens/BughouseGameScreen.tsx';
const B = 'src/components/BughouseBoardBlock.tsx';
const K = 'src/components/BughouseBoard.tsx';

module.exports = {
  root: process.env.MUTATION_ROOT || undefined,
  copy: ['src', 'assets', 'scripts/browser', 'App.tsx', 'package.json', 'tsconfig.json', 'vitest.config.mts'],
  junction: ['node_modules'],
  cmd: 'npx vitest run src/logic/__tests__/bughouseFitStacked.test.ts src/logic/__tests__/bughouseKeepTogether.test.ts src/logic/__tests__/bughouseBoardArt.test.ts src/logic/__tests__/bughouseLayout.test.ts src/screens/__tests__/bughouseLocal.dom.test.tsx src/screens/__tests__/bughouseCompact.dom.test.tsx',
  mutantTimeoutMs: 4 * 60 * 1000,
  mutants: [
    // --- fitStackedCell ---
    ['fit: 8 board rows, not 16', L, 'export const STACKED_BOARD_ROWS = 16;', 'export const STACKED_BOARD_ROWS = 8;'],
    ['fit: free space is rounded up', L, 'Math.floor((viewportHeight - contentHeight) / STACKED_BOARD_ROWS)', 'Math.ceil((viewportHeight - contentHeight) / STACKED_BOARD_ROWS)'],
    ['fit: free space shrinks the boards', L, 'current + Math.floor(', 'current - Math.floor('],
    ['fit: overflow is ignored', L, 'Math.floor((viewportHeight - contentHeight) / STACKED_BOARD_ROWS)', 'Math.max(0, Math.floor((viewportHeight - contentHeight) / STACKED_BOARD_ROWS))'],
    ['fit: the width limit is ignored', L, 'Math.min(wanted, maxByWidth)', 'wanted'],
    ['fit: the floor ignores the width limit', L, 'Math.max(Math.min(floor, maxByWidth),', 'Math.max(floor,'],
    ['fit: the floor is a ceiling', L, 'return Math.max(Math.min(floor, maxByWidth), Math.min(wanted, maxByWidth));', 'return Math.min(Math.min(floor, maxByWidth), Math.min(wanted, maxByWidth));'],
    // --- the screen's use of it ---
    ['screen: the floor is the minimum even for a window the table calls too small', G, 'Math.min(dualFit.cell, BUGHOUSE_DUAL_MIN_CELL))', 'BUGHOUSE_DUAL_MIN_CELL)'],
    ['screen: a stale measurement is used', G, 'measured.cell !== dualCell', 'false'],
    ['screen: the result card shrinks the boards', G, 'if (!stacked || over || measured === null', 'if (!stacked || measured === null'],
    ['screen: a new window keeps the old adjustment', G, '  }, [width, height, stacked]);', '  }, [stacked]);'],
    ['screen: the measurement is taken at another cell', G, 'setMeasured({ cell: renderedCell.current, content: h });', 'setMeasured({ cell: dualFit.cell, content: h });'],
    ['screen: the pass-and-play and standard layouts are fitted too', G, 'const stacked = dual && dualFit.arrangement', 'const stacked = dualFit.arrangement'],
    ['screen: side by side is not told to the blocks', G, "sideBySide={dual ? dualFit.arrangement === 'sideBySide' : arrangement === 'sideBySide'}", 'sideBySide={false}'],
    // --- keepTogether ---
    ['keep: Board is not kept', L, '/\\b(Team|Board) (?=[A-Z0-9]\\b)/g', '/\\b(Team) (?=[A-Z0-9]\\b)/g'],
    ['keep: Team is not kept', L, '/\\b(Team|Board) (?=[A-Z0-9]\\b)/g', '/\\b(Board) (?=[A-Z0-9]\\b)/g'],
    ['keep: a team letter is not kept', L, '(?=[A-Z0-9]\\b)', '(?=[0-9]\\b)'],
    ['keep: the space stays a space', L, "'$1\\u00a0'", "'$1 '"],
    ['keep: every word is glued', L, '/\\b(Team|Board) (?=[A-Z0-9]\\b)/g', '/\\b(Team|Board) /g'],
    ['keep: only the first is glued', L, '/\\b(Team|Board) (?=[A-Z0-9]\\b)/g', '/\\b(Team|Board) (?=[A-Z0-9]\\b)/'],
    // --- the bars and the board art ---
    ['bars: the pocket does not wrap', B, "flexWrap: 'wrap', alignItems: 'center', gap: 3, minHeight: 28", "flexWrap: 'nowrap', alignItems: 'center', gap: 3, minHeight: 28"],
    ['bars: the pocket cannot shrink', B, 'pocket: { flex: 1, minWidth: 0,', 'pocket: { flex: 1,'],
    ['bars: the chip glyph grows with the font', B, '<Text maxFontSizeMultiplier={1} style={[styles.glyph,', '<Text style={[styles.glyph,'],
    ['bars: the chip count grows with the font', B, '<Text maxFontSizeMultiplier={1} style={styles.count}>', '<Text style={styles.count}>'],
    ['bars: the promoted mark grows with the font', K, '<Text maxFontSizeMultiplier={1} style={[styles.promotedMark,', '<Text style={[styles.promotedMark,'],
    ['bars: blocks are never constrained', B, 'props.sideBySide && { width: cell * 8 + 6 }', 'false'],
  ],
};
