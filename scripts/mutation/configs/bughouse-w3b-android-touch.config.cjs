// Mutation set for the Bughouse touch mapping fix of command #26 (every tap one rank too low on a real Android phone): the grid's own frame in logic/boardTouches.ts, the hook that
// picks the frame (components/useBoardTouches.ts), the overlay wiring (components/BughouseBoard.tsx) and the dev overlay's label (components/TouchDebugOverlay.tsx).
//
//   npm run mutate -- scripts/mutation/configs/bughouse-w3b-android-touch.config.cjs        (chunks of at most 20 mutants)
//
// The suites: the pure frames / book tests, the rendered Android-like test (a window-frame rectangle AND a root-frame measure on the grid's node, Platform android), the dev-overlay scan and
// the board-argument scan. A name that says EQUIVALENT is proved by a test that pins the proof.
const B = 'src/logic/boardTouches.ts';
const H = 'src/components/useBoardTouches.ts';
const V = 'src/components/BughouseBoard.tsx';
const O = 'src/components/TouchDebugOverlay.tsx';
const m = (name, file, find, replace) => [name, file, find, replace];

module.exports = {
  copy: ['src', 'assets', 'scripts/browser', 'App.tsx', 'package.json', 'tsconfig.json', 'vitest.config.mts'],
  junction: ['node_modules'],
  cmd: 'npx vitest run src/logic/__tests__/boardTouches.test.ts src/logic/__tests__/boardTouchesFrames.test.ts src/screens/__tests__/bughouseAndroidTouch.dom.test.tsx src/logic/__tests__/bughouseTouchDebug.test.ts src/logic/__tests__/bughouseDualBoardArgument.test.ts --reporter=dot --bail=1',
  mutantTimeoutMs: 4 * 60 * 1000,
  mutants: [
    // --- the book carries the grid frame, all or nothing ---
    m('book: a start never keeps its grid frame', B, '...(event.local ? { startLocal: event.local } : {})', '...({})'),
    m('book: a tap carries a frame when either end has one', B, 'tracked.startLocal && event.local ?', 'tracked.startLocal || event.local ?'),
    m('book: a tap never carries the frame', B, '{ startLocal: tracked.startLocal, endLocal: event.local }', '{}'),
    m('book: the lift\'s frame is the start\'s', B, 'endLocal: event.local }', 'endLocal: tracked.startLocal }'),
    // --- the cell in the grid's own frame ---
    m('grid: the local frame is used when either end has it', B, 'if (tap.startLocal && tap.endLocal) {', 'if (tap.startLocal || tap.endLocal) {'),
    m('grid: the local frame is never used', B, 'if (tap.startLocal && tap.endLocal) {', 'if (false as boolean) {'),
    m('grid: the cell is under the start, not the lift', B, 'return pixelToCell(tap.endLocal.x, tap.endLocal.y, cell, rows, cols);', 'return pixelToCell(tap.startLocal.x, tap.startLocal.y, cell, rows, cols);'),
    m('grid: the local start may lie outside', B, 'if (!insideGrid(tap.startLocal, zero, width, height) || !insideGrid(tap.endLocal, zero, width, height)) return null;', 'if (!insideGrid(tap.endLocal, zero, width, height)) return null;'),
    m('grid: the local lift may lie outside', B, 'if (!insideGrid(tap.startLocal, zero, width, height) || !insideGrid(tap.endLocal, zero, width, height)) return null;', 'if (!insideGrid(tap.startLocal, zero, width, height)) return null;'),
    m('grid: the local frame has an origin (the page one)', B, 'const zero: Point = { x: 0, y: 0 };', 'const zero: Point = origin;'),
    // --- where an origin may be read ---
    m('origin: the web uses measure first', B, "if (os === 'web') return hasRect ? 'rect' : hasMeasure ? 'measure' : 'none';", "if (os === 'web') return hasMeasure ? 'measure' : hasRect ? 'rect' : 'none';"),
    m('origin: a phone trusts the rectangle', B, "return hasMeasure ? 'measure' : 'none';\n}", "return hasRect ? 'rect' : hasMeasure ? 'measure' : 'none';\n}"),
    m('origin: every platform is the web', B, "if (os === 'web') return hasRect", "if (os !== 'ios') return hasRect"),
    // --- a touch's position in the target's frame ---
    m('local: NaN is a position', B, '|| !Number.isFinite(locationX) || !Number.isFinite(locationY)', ''),
    m('local: only the x is checked as a number (EQUIVALENT: Number.isFinite(undefined) is false, so a missing y is rejected by the finite check anyway)', B, "typeof locationX !== 'number' || typeof locationY !== 'number'", "typeof locationX !== 'number'"),
    m('finger: a finger off the grid has a cell', B, "if (!insideGrid(local, { x: 0, y: 0 }, cell * cols, cell * rows)) return null;\n  return pixelToCell(local.x, local.y, cell, rows, cols);", 'return pixelToCell(local.x, local.y, cell, rows, cols);'),
    // --- the hook ---
    m('hook: the overlay never reports the grid frame', H, "frame === 'grid' ? localOfTouch(touches[i]) : undefined", 'undefined'),
    m('hook: the page path reads the rectangle on a phone', H, 'originSource(Platform.OS,', "originSource('web',"),
    m('hook: a tap never waits for a pending measurement', H, 'if (pendingRef.current) void pendingRef.current.then(resolve);\n    else resolve();', 'resolve();'),
    m('hook: a lift with the grid frame still measures', H, "if (onGrid && event.kind === 'end' && event.local === undefined) refreshOrigin();", "if (onGrid && event.kind === 'end') refreshOrigin();"),
    m('hook: the overlay has the page frame', H, "surfaceProps: propsFor(GRID, 'grid')", 'surfaceProps: propsFor(GRID)'),
    m('hook: the debug list keeps a lifted finger', H, "if (event.kind === 'end' || event.kind === 'cancel') {\n      delete fingersRef.current[event.id];", "if (event.kind === 'cancel') {\n      delete fingersRef.current[event.id];"),
    // --- the board ---
    m('board: the overlay exists on the web too', V, "const surface = touches !== undefined && Platform.OS !== 'web';", 'const surface = touches !== undefined;'),
    m('board: the overlay has no touch props', V, '{...touches.surfaceProps}', ''),
    m('board: the grid listens next to the overlay', V, '(surface ? {} : touches.gridProps)', 'touches.gridProps'),
    // --- the dev overlay ---
    m('debug: a finger off the grid says nothing', O, "return cellOfFinger ? boardCellToSquare(board, orientation, cellOfFinger.row, cellOfFinger.col).square : 'outside';", "return cellOfFinger ? boardCellToSquare(board, orientation, cellOfFinger.row, cellOfFinger.col).square : '';"),
    m('debug: the frame ignores the column', O, 'left: finger.cell.col * cell, top: finger.cell.row * cell,', 'left: 0, top: finger.cell.row * cell,'),
  ],
};
