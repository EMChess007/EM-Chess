// Mutation set for the Bughouse W3b LOGIC (the non-visual parts of the dual-board Local mode): the touch book (identifiers, drift, cancel), the dead-zone math of a grid, the per-board
// selection reducer, the layout additions (the board plan, the premove switch, the rotate overlay, the gate) and the colour at the bottom of each board. Run (one chunk at a time, results
// outside the repo):
//   npm run mutate -- scripts/mutation/configs/bughouse-w3b-logic.config.cjs --chunk 1      (then 2, 3, 4 - the runner prints the number of chunks)
// The tests that must kill them are the pure suites below (about 3 seconds). The hook (useBoardTouches) and the screen's routing are mutated by bughouse-w3b-screen.config.cjs.
//
// EQUIVALENT MUTANTS carry "EQUIVALENT" and the reason in their name; the proof of each is pinned by a test (the plain-model property test of boardTouches.test.ts for the touch book).
const TOUCH = 'src/logic/boardTouches.ts';
const SEL = 'src/logic/bughouseSelection.ts';
const LAY = 'src/logic/bughouseLayout.ts';
const VIEW = 'src/logic/bughouseView.ts';
const m = (name, file, find, replace) => [name, file, find, replace];
const t = (name, find, replace) => m(name, TOUCH, find, replace);
const s = (name, find, replace) => m(name, SEL, find, replace);
const l = (name, find, replace) => m(name, LAY, find, replace);
const v = (name, find, replace) => m(name, VIEW, find, replace);

const mutants = [
  // --- the touch book -------------------------------------------------------------------------------------------------------------------------
  t('touch: the drift limit is 9 px', 'export const TAP_MAX_DRIFT_PX = 10;', 'export const TAP_MAX_DRIFT_PX = 9;'),
  t('touch: the drift limit is 11 px', 'export const TAP_MAX_DRIFT_PX = 10;', 'export const TAP_MAX_DRIFT_PX = 11;'),
  t('touch: no drift is allowed', 'export const TAP_MAX_DRIFT_PX = 10;', 'export const TAP_MAX_DRIFT_PX = 0;'),
  t('touch: any drift is allowed', 'export const TAP_MAX_DRIFT_PX = 10;', 'export const TAP_MAX_DRIFT_PX = 100000;'),
  t('touch: distance is the sum of the axes', 'Math.hypot(a.x - b.x, a.y - b.y)', 'Math.abs(a.x - b.x) + Math.abs(a.y - b.y)'),
  t('touch: distance is the larger axis', 'Math.hypot(a.x - b.x, a.y - b.y)', 'Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))'),
  t('touch: distance ignores y', 'Math.hypot(a.x - b.x, a.y - b.y)', 'Math.abs(a.x - b.x)'),
  t('touch: distance ignores x', 'Math.hypot(a.x - b.x, a.y - b.y)', 'Math.abs(a.y - b.y)'),
  t('touch: a lift leaves the touch in the book', '  delete rest[id];\n', ''),
  t('touch: a start is already drifted', 'start: event.at, drifted: false } }', 'start: event.at, drifted: true } }'),
  t('touch: a start forgets its target', 'target: event.target, start: event.at,', "target: { kind: 'grid' }, start: event.at,"),
  t('touch: a start records no position', 'start: event.at, drifted: false } }', "start: { x: 0, y: 0 }, drifted: false } }"),
  t('touch: a start does not record the touch', "{ book: { ...book, [event.id]: { target: event.target, start: event.at, drifted: false } }, tap: null }", '{ book, tap: null }'),
  t('touch: an unknown identifier is not ignored', '  if (tracked === undefined) return { book, tap: null };\n', ''),
  t('touch: a cancel keeps the touch', "if (event.kind === 'cancel') return { book: without(book, event.id), tap: null };", "if (event.kind === 'cancel') return { book, tap: null };"),
  t('touch: a cancel is no cancel at all', "  if (event.kind === 'cancel') return { book: without(book, event.id), tap: null };\n", ''),
  t('touch: a move of exactly the limit already drifts', 'distance(tracked.start, event.at) <= TAP_MAX_DRIFT_PX) return { book, tap: null };', 'distance(tracked.start, event.at) < TAP_MAX_DRIFT_PX) return { book, tap: null };'),
  t('touch: a move never marks a drift', 'return { book: { ...book, [event.id]: { ...tracked, drifted: true } }, tap: null };', 'return { book, tap: null };'),
  t('touch: a move marks another touch', '{ book: { ...book, [event.id]: { ...tracked, drifted: true } }, tap: null }', "{ book: { ...book, ['0']: { ...tracked, drifted: true } }, tap: null }"),
  t('touch (EQUIVALENT: a drifted touch that moves again is marked drifted again; pinned by the plain-model property test): a drifted touch is re-examined on a move', 'if (tracked.drifted || distance(tracked.start, event.at) <= TAP_MAX_DRIFT_PX) return { book, tap: null };', 'if (distance(tracked.start, event.at) <= TAP_MAX_DRIFT_PX) return { book, tap: null };'),
  t('touch: a lift that wandered is a tap', 'if (tracked.drifted || distance(tracked.start, event.at) > TAP_MAX_DRIFT_PX) return { book: rest, tap: null };', 'if (distance(tracked.start, event.at) > TAP_MAX_DRIFT_PX) return { book: rest, tap: null };'),
  t('touch: a lift of exactly the limit is no tap', 'distance(tracked.start, event.at) > TAP_MAX_DRIFT_PX) return { book: rest, tap: null };', 'distance(tracked.start, event.at) >= TAP_MAX_DRIFT_PX) return { book: rest, tap: null };'),
  t('touch: a far lift is a tap', 'distance(tracked.start, event.at) > TAP_MAX_DRIFT_PX) return { book: rest, tap: null };', 'distance(tracked.start, event.at) < 0) return { book: rest, tap: null };'),
  t('touch: a lift that is no tap leaves the touch in the book', 'TAP_MAX_DRIFT_PX) return { book: rest, tap: null };', 'TAP_MAX_DRIFT_PX) return { book, tap: null };'),
  t('touch: the tap starts where it ended', 'tap: { target: tracked.target, start: tracked.start, end: event.at } }', 'tap: { target: tracked.target, start: event.at, end: event.at } }'),
  t('touch: the tap ends where it started', 'tap: { target: tracked.target, start: tracked.start, end: event.at } }', 'tap: { target: tracked.target, start: tracked.start, end: tracked.start } }'),
  t('touch: the tap forgets its target', 'tap: { target: tracked.target, start: tracked.start, end: event.at } }', "tap: { target: { kind: 'grid' }, start: tracked.start, end: event.at } }"),

  // --- the dead zone and the cell --------------------------------------------------------------------------------------------------------------
  t('grid: the left edge is outside', 'return x >= 0 && y >= 0 && x < width && y < height;', 'return x > 0 && y >= 0 && x < width && y < height;'),
  t('grid: the top edge is outside', 'return x >= 0 && y >= 0 && x < width && y < height;', 'return x >= 0 && y > 0 && x < width && y < height;'),
  t('grid: the right edge is inside', 'return x >= 0 && y >= 0 && x < width && y < height;', 'return x >= 0 && y >= 0 && x <= width && y < height;'),
  t('grid: the bottom edge is inside', 'return x >= 0 && y >= 0 && x < width && y < height;', 'return x >= 0 && y >= 0 && x < width && y <= height;'),
  t('grid: width and height are swapped', 'return x >= 0 && y >= 0 && x < width && y < height;', 'return x >= 0 && y >= 0 && x < height && y < width;'),
  t('grid: the left margin is not checked', 'return x >= 0 && y >= 0 && x < width && y < height;', 'return y >= 0 && x < width && y < height;'),
  t('grid: the top margin is not checked', 'return x >= 0 && y >= 0 && x < width && y < height;', 'return x >= 0 && x < width && y < height;'),
  t('grid: the right margin is not checked', 'return x >= 0 && y >= 0 && x < width && y < height;', 'return x >= 0 && y >= 0 && y < height;'),
  t('grid: the bottom margin is not checked', 'return x >= 0 && y >= 0 && x < width && y < height;', 'return x >= 0 && y >= 0 && x < width;'),
  t('grid: x is measured from the wrong side', 'const x = point.x - origin.x;', 'const x = point.x + origin.x;'),
  t('grid: y is measured from the wrong side', 'const y = point.y - origin.y;', 'const y = point.y + origin.y;'),
  t('grid: the width is rows of cells', 'const width = cell * cols;', 'const width = cell * rows;'),
  t('grid: the height is columns of cells', 'const height = cell * rows;', 'const height = cell * cols;'),
  t('grid: a tap that began outside still counts', 'if (!insideGrid(tap.start, origin, width, height) || !insideGrid(tap.end, origin, width, height)) return null;', 'if (!insideGrid(tap.end, origin, width, height)) return null;'),
  t('grid: a tap that ended outside still counts', 'if (!insideGrid(tap.start, origin, width, height) || !insideGrid(tap.end, origin, width, height)) return null;', 'if (!insideGrid(tap.start, origin, width, height)) return null;'),
  t('grid: either end inside is enough', 'if (!insideGrid(tap.start, origin, width, height) || !insideGrid(tap.end, origin, width, height)) return null;', 'if (!insideGrid(tap.start, origin, width, height) && !insideGrid(tap.end, origin, width, height)) return null;'),
  t('grid: the cell is the one of the start', 'pixelToCell(tap.end.x - origin.x, tap.end.y - origin.y, cell, rows, cols)', 'pixelToCell(tap.start.x - origin.x, tap.start.y - origin.y, cell, rows, cols)'),
  t('grid: the cell ignores the origin', 'pixelToCell(tap.end.x - origin.x, tap.end.y - origin.y, cell, rows, cols)', 'pixelToCell(tap.end.x, tap.end.y, cell, rows, cols)'),
  t('grid: rows and columns are swapped in the cell', 'pixelToCell(tap.end.x - origin.x, tap.end.y - origin.y, cell, rows, cols)', 'pixelToCell(tap.end.x - origin.x, tap.end.y - origin.y, cell, cols, rows)'),

  // --- the per-board selection reducer -------------------------------------------------------------------------------------------------------
  s('selection: a half-made action survives when no human may act', '  if (!position.active) return NO_SELECTION;\n', ''),
  s('selection: a half-made action is kept only when no human may act', 'if (!position.active) return NO_SELECTION;', 'if (position.active) return NO_SELECTION;'),
  s('selection: a selection of another position is kept', 'state.selected !== null && state.selected.fen === position.fen ? state.selected : null', 'state.selected'),
  s('selection: a selection of THIS position is dropped', 'state.selected !== null && state.selected.fen === position.fen ? state.selected : null', 'state.selected !== null && state.selected.fen !== position.fen ? state.selected : null'),
  s('selection: a picked pocket piece of another position is kept', 'state.picked !== null && state.picked.fen === position.fen ? state.picked : null', 'state.picked'),
  s('selection: a picked pocket piece of THIS position is dropped', 'state.picked !== null && state.picked.fen === position.fen ? state.picked : null', 'state.picked !== null && state.picked.fen !== position.fen ? state.picked : null'),
  s('selection: a promotion of another position is kept', 'state.promotion !== null && state.promotion.fen === position.fen ? state.promotion : null', 'state.promotion'),
  s('selection: a promotion of THIS position is dropped', 'state.promotion !== null && state.promotion.fen === position.fen ? state.promotion : null', 'state.promotion !== null && state.promotion.fen !== position.fen ? state.promotion : null'),
  s('selection: an unchanged selection is a new object', '  if (selected === state.selected && picked === state.picked && promotion === state.promotion) return state;\n', ''),
  s('selection: the unchanged check needs only the selection', 'if (selected === state.selected && picked === state.picked && promotion === state.promotion) return state;', 'if (selected === state.selected) return state;'),
  s('selection: an input on a board nobody may act on is accepted', "  if (!position.active) return { state, commit: null };\n", ''),
  s('selection: a cancel keeps the promotion', "if (input.kind === 'cancelPromotion') return { state: { ...state, promotion: null }, commit: null };", "if (input.kind === 'cancelPromotion') return { state, commit: null };"),
  s('selection: a cancel clears everything', "if (input.kind === 'cancelPromotion') return { state: { ...state, promotion: null }, commit: null };", "if (input.kind === 'cancelPromotion') return { state: NO_SELECTION, commit: null };"),
  s('selection: a choice with nothing waiting is not ignored', '    if (pending === null) return { state, commit: null };\n', ''),
  s('selection: the chosen piece is always a queen', 'to: pending.to, promotion: input.piece } };', "to: pending.to, promotion: 'q' } };"),
  s('selection: a choice keeps the selection', 'return { state: NO_SELECTION, commit: { board, kind: \'move\', from: pending.from', 'return { state, commit: { board, kind: \'move\', from: pending.from'),
  s('selection: a choice plays from the target', 'from: pending.from, to: pending.to,', 'from: pending.to, to: pending.from,'),
  s('selection: a choice commits for board A', "commit: { board, kind: 'move', from: pending.from", "commit: { board: 'A', kind: 'move', from: pending.from"),
  s('selection: an empty chip can be lifted', 'if (position.dropSquares(input.piece).length === 0) return { state, commit: null };', 'if (false) return { state, commit: null };'),
  s('selection: only an empty chip can be lifted', 'if (position.dropSquares(input.piece).length === 0) return', 'if (position.dropSquares(input.piece).length !== 0) return'),
  s('selection: a second tap on the chip does not put it back', 'state.picked.piece === input.piece;', 'state.picked.piece !== input.piece;'),
  s('selection: a chip is always put back', "picked: same ? null : { piece: input.piece, fen: position.fen }", 'picked: null'),
  s('selection: a chip is never put back', "picked: same ? null : { piece: input.piece, fen: position.fen }", 'picked: { piece: input.piece, fen: position.fen }'),
  s('selection: a lifted chip keeps the picked-up piece', 'return { state: { selected: null, picked: same', 'return { state: { selected: state.selected, picked: same'),
  s('selection: a lifted chip keeps the promotion waiting', "fen: position.fen }, promotion: null }, commit: null };\n  }\n\n  // a tap on a square", "fen: position.fen }, promotion: state.promotion }, commit: null };\n  }\n\n  // a tap on a square"),
  s('selection: a lifted chip is remembered under no position', "picked: same ? null : { piece: input.piece, fen: position.fen }", "picked: same ? null : { piece: input.piece, fen: '' }"),
  s('selection: a tap keeps a promotion waiting', 'let current: BoardSelection = { ...state, promotion: null };', 'let current: BoardSelection = state;'),
  s('selection: a drop on a square the position does not offer', 'position.dropSquares(current.picked.piece).includes(square)', '!position.dropSquares(current.picked.piece).includes(square)'),
  s('selection: a drop on any square', 'if (position.dropSquares(current.picked.piece).includes(square)) return', 'if (true) return'),
  s('selection: a drop keeps the selection', "return { state: NO_SELECTION, commit: { board, kind: 'drop'", "return { state: current, commit: { board, kind: 'drop'"),
  s('selection: a drop commits for board A', "commit: { board, kind: 'drop'", "commit: { board: 'A', kind: 'drop'"),
  s('selection: a drop names the wrong piece', "kind: 'drop', piece: current.picked.piece, square }", "kind: 'drop', piece: 'p', square }"),
  s('selection: a tap off the squares keeps the piece picked up', '    current = { ...current, picked: null };\n', ''),
  s('selection: a move to a square the piece cannot reach', 'filter((m) => m.to === square);', 'filter((m) => m.to !== square);'),
  s('selection: a move needs no matching square', '    if (matching.length > 0) {', '    if (matching.length >= 0) {'),
  s('selection: a move onto the far rank needs every piece offered', 'matching.some((m) => m.promotion)) {', 'matching.every((m) => m.promotion)) {'),
  s('selection: a promotion never asks', 'matching.some((m) => m.promotion)) {', 'false) {'),
  s('selection: the pieces of a promotion are listed worst first', "const PROMOTION_ORDER: readonly PromotionPiece[] = ['q', 'r', 'b', 'n'];", "const PROMOTION_ORDER: readonly PromotionPiece[] = ['n', 'b', 'r', 'q'];"),
  s('selection: a promotion offers pieces nobody can choose', 'PROMOTION_ORDER.filter((p) => matching.some((m) => m.promotion === p))', 'PROMOTION_ORDER'),
  s('selection: a promotion waits under no position', "promotion: { from: current.selected.square, to: square, choices, fen: position.fen } }", "promotion: { from: current.selected.square, to: square, choices, fen: '' } }"),
  s('selection: a promotion forgets the piece', "promotion: { from: current.selected.square, to: square, choices, fen: position.fen } }", "promotion: { from: square, to: square, choices, fen: position.fen } }"),
  s('selection: a move keeps the selection', "return { state: NO_SELECTION, commit: { board, kind: 'move', from: current.selected.square, to: square } };", "return { state: current, commit: { board, kind: 'move', from: current.selected.square, to: square } };"),
  s('selection: a move commits for board A', "commit: { board, kind: 'move', from: current.selected.square", "commit: { board: 'A', kind: 'move', from: current.selected.square"),
  s('selection: a move starts from the target', "from: current.selected.square, to: square } };", "from: square, to: square } };"),
  s('selection: any square can be picked up', 'const own = position.movesFrom(square).length > 0;', 'const own = position.movesFrom(square).length >= 0;'),
  s('selection: only an immovable square can be picked up', 'const own = position.movesFrom(square).length > 0;', 'const own = position.movesFrom(square).length === 0;'),
  s('selection: a tap on an own piece selects nothing', 'selected: own ? { square, fen: position.fen } : null }', 'selected: own ? null : null }'),
  s('selection: a tap on an empty square keeps the old selection', 'selected: own ? { square, fen: position.fen } : null }', 'selected: own ? { square, fen: position.fen } : current.selected }'),
  s('selection: a selection is remembered under no position', 'selected: own ? { square, fen: position.fen } : null }', "selected: own ? { square, fen: '' } : null }"),

  // --- the layout additions ----------------------------------------------------------------------------------------------------------------------
  l('gate: a dual setup that fits does not start', "  if (!getBughouseDualCellSize(width, height).fits) return { startable: false, reason: 'tooSmall', message: BUGHOUSE_SIZE_GATE_MESSAGE };\n  return { startable: true };\n}", "  if (!getBughouseDualCellSize(width, height).fits) return { startable: false, reason: 'tooSmall', message: BUGHOUSE_SIZE_GATE_MESSAGE };\n  return { startable: false, reason: 'tooSmall', message: BUGHOUSE_SIZE_GATE_MESSAGE };\n}"),
  l('gate: a dual setup that does not fit starts', "if (!getBughouseDualCellSize(width, height).fits) return { startable: false, reason: 'tooSmall', message: BUGHOUSE_SIZE_GATE_MESSAGE };", "if (getBughouseDualCellSize(width, height).fits) return { startable: false, reason: 'tooSmall', message: BUGHOUSE_SIZE_GATE_MESSAGE };"),
  l('overlay: shown for every layout', "return deriveBughouseLayout(config).kind === 'dual' && !getBughouseDualCellSize(width, height).fits;", 'return !getBughouseDualCellSize(width, height).fits;'),
  l('overlay: shown when the boards fit', "return deriveBughouseLayout(config).kind === 'dual' && !getBughouseDualCellSize(width, height).fits;", "return deriveBughouseLayout(config).kind === 'dual' && getBughouseDualCellSize(width, height).fits;"),
  l('overlay: never shown for a dual layout', "return deriveBughouseLayout(config).kind === 'dual' && !getBughouseDualCellSize(width, height).fits;", "return deriveBughouseLayout(config).kind !== 'dual' && !getBughouseDualCellSize(width, height).fits;"),
  l('overlay: shown for a dual layout whatever the window', "return deriveBughouseLayout(config).kind === 'dual' && !getBughouseDualCellSize(width, height).fits;", "return deriveBughouseLayout(config).kind === 'dual' || !getBughouseDualCellSize(width, height).fits;"),
  l('premoves: allowed for one or more humans', 'return humanBughouseSeats(config).length === 1;', 'return humanBughouseSeats(config).length >= 1;'),
  l('premoves: allowed for none or one human', 'return humanBughouseSeats(config).length === 1;', 'return humanBughouseSeats(config).length <= 1;'),
  l('premoves: allowed for two humans', 'return humanBughouseSeats(config).length === 1;', 'return humanBughouseSeats(config).length === 2;'),
  l('plan: the humans are the bots', "config[seatAt(board, color)].kind === 'human');\n  return { board, humanColors", "config[seatAt(board, color)].kind === 'bot');\n  return { board, humanColors"),
  l('plan: the seats are those of board A', "config[seatAt(board, color)].kind === 'human');\n  return { board, humanColors", "config[seatAt('A', color)].kind === 'human');\n  return { board, humanColors"),
  l('plan: Black is listed first', "(['w', 'b'] as const).filter", "(['b', 'w'] as const).filter"),
  l('plan: one human is a shared board', 'shared: humanColors.length === 2 }', 'shared: humanColors.length >= 1 }'),
  l('plan: two humans are not a shared board', 'shared: humanColors.length === 2 }', 'shared: humanColors.length === 1 }'),
  l('plan: the board is always A', 'return { board, humanColors, shared', "return { board: 'A', humanColors, shared"),
  l('constants: the gutter is 8 px', 'export const BUGHOUSE_DUAL_GUTTER = 12;', 'export const BUGHOUSE_DUAL_GUTTER = 8;'),
  l('constants: the gutter is 16 px', 'export const BUGHOUSE_DUAL_GUTTER = 12;', 'export const BUGHOUSE_DUAL_GUTTER = 16;'),
  l('constants: the overlay title', "'Rotate the device to keep playing'", "'Rotate the device to continue'"),
  l('constants: the overlay detail', "'The clocks keep running.'", "'The clocks are paused.'"),

  // --- the colour at the bottom of each board ---------------------------------------------------------------------------------------------------
  v('orientation: a shared board never turns', "if (plan.shared) return autoFlip ? match.verdicts[board].turn : 'w';", "if (plan.shared) return 'w';"),
  v('orientation: a shared board turns even with auto-turn off', "if (plan.shared) return autoFlip ? match.verdicts[board].turn : 'w';", 'if (plan.shared) return match.verdicts[board].turn;'),
  v('orientation: auto-turn works the wrong way round', "if (plan.shared) return autoFlip ? match.verdicts[board].turn : 'w';", "if (plan.shared) return autoFlip ? 'w' : match.verdicts[board].turn;"),
  v('orientation: a shared board with auto-turn off keeps Black at the bottom', "if (plan.shared) return autoFlip ? match.verdicts[board].turn : 'w';", "if (plan.shared) return autoFlip ? match.verdicts[board].turn : 'b';"),
  v('orientation: a shared board follows the turn of board A', "if (plan.shared) return autoFlip ? match.verdicts[board].turn : 'w';", "if (plan.shared) return autoFlip ? match.verdicts.A.turn : 'w';"),
  v('orientation: a board with one human is shown from the other side', 'return plan.humanColors[0];', "return plan.humanColors[0] === 'w' ? 'b' : 'w';"),
  v('orientation: a board with one human is always shown White at the bottom', 'return plan.humanColors[0];', "return 'w';"),
  v('orientation: the plan is that of board A', 'const plan = dualBoardPlan(config, board);\n  if (plan.shared)', "const plan = dualBoardPlan(config, 'A');\n  if (plan.shared)"),
];

const T = 'src/logic/__tests__/';
const FAST = ['boardTouches', 'bughouseSelection', 'bughouseDualLayout', 'bughouseLayout', 'bughouseView', 'bughouseDualBoardArgument'].map((n) => `${T}${n}.test.ts`).join(' ');

module.exports = {
  copy: ['src', 'package.json', 'tsconfig.json', 'vitest.config.mts'],
  junction: ['node_modules'],
  cmd: `npx vitest run --project logic ${FAST} --reporter=dot --bail=1`,
  mutantTimeoutMs: 4 * 60 * 1000,
  mutants,
};
