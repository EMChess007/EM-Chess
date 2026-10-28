// Mutation set for the Bughouse W3b TOUCH ROUTING (the non-visual glue of the dual-board Local mode, which only the rendered tests can see): the raw-touch hook (identifiers, the mouse, the
// grid origin, which callback a touch reaches), the board block's wiring of it, and the screen's per-board routing (which reducer, which seat, which commit). Run (one chunk at a time,
// results outside the repo; each mutant runs the two Bughouse rendered suites, about 40 s):
//   npm run mutate -- scripts/mutation/configs/bughouse-w3b-screen.config.cjs --chunk-size 12 --chunk 1      (then 2, 3)
// Colours, spacing, the `scrollEnabled` of the dual layout and the arrangement-specific bar are the browser pass's job (scripts/browser/bughouse-dual-touch.mjs) and are not mutated here.
//
// EQUIVALENT MUTANTS carry "EQUIVALENT" and the reason in their name; the proof of each is pinned by a test.
const HOOK = 'src/components/useBoardTouches.ts';
const BLOCK = 'src/components/BughouseBoardBlock.tsx';
const SCREEN = 'src/screens/BughouseGameScreen.tsx';
const m = (name, file, find, replace) => [name, file, find, replace];
const h = (name, find, replace) => m(name, HOOK, find, replace);
const b = (name, find, replace) => m(name, BLOCK, find, replace);
const s = (name, find, replace) => m(name, SCREEN, find, replace);

const mutants = [
  // --- the hook ------------------------------------------------------------------------------------------------------------------------------
  h('hook: the mouse is touch 1', "const MOUSE_ID = 'mouse';", "const MOUSE_ID = '1';"),
  h('hook: every pointer is a mouse', "event.nativeEvent.pointerType === 'mouse';", 'true;'),
  h('hook: a pen is a mouse', "event.nativeEvent.pointerType === 'mouse';", "event.nativeEvent.pointerType !== 'touch';"),
  h('hook: any mouse button taps', 'if (isMouse(event) && event.nativeEvent.button === 0) feed', 'if (isMouse(event)) feed'),
  h('hook: only a non-primary button taps', 'event.nativeEvent.button === 0) feed', 'event.nativeEvent.button !== 0) feed'),
  h('hook: a mouse release of a finger counts', "if (isMouse(event)) feed({ kind: 'end', id: MOUSE_ID, at: pointAt(event) }, onGrid);", "feed({ kind: 'end', id: MOUSE_ID, at: pointAt(event) }, onGrid);"),
  h('hook: a mouse that is cancelled still taps', "        if (isMouse(event)) feed({ kind: 'cancel', id: MOUSE_ID }, onGrid);\n", ''),
  h('hook: only the first finger of an event is counted', 'for (let i = 0; i < touches.length; i++) feed', 'for (let i = 0; i < 1; i++) feed'),
  h('hook: the grid is not re-read when a touch starts or ends', "if (onGrid && (event.kind === 'start' || event.kind === 'end')) refreshOrigin();", ''),
  h('hook: the grid is not re-read when a touch ends', "if (onGrid && (event.kind === 'start' || event.kind === 'end')) refreshOrigin();", "if (onGrid && event.kind === 'start') refreshOrigin();"),
  h('hook: the grid is not read when a touch starts', "if (onGrid && (event.kind === 'start' || event.kind === 'end')) refreshOrigin();", "if (onGrid && event.kind === 'end') refreshOrigin();"),
  h('hook: the grid is re-read for chips too (EQUIVALENT: a chip tap never uses the grid origin, and reading it again is harmless; pinned by the chip tests passing either way)', "if (onGrid && (event.kind === 'start' || event.kind === 'end')) refreshOrigin();", "if (event.kind === 'start' || event.kind === 'end') refreshOrigin();"),
  h('hook: the scroll offset is not added', 'originRef.current = { x: rect.left + scrollX, y: rect.top + scrollY };', 'originRef.current = { x: rect.left, y: rect.top };'),
  h('hook: only the horizontal scroll is added', 'y: rect.top + scrollY };', 'y: rect.top };'),
  h('hook: the measured origin has its axes swapped', 'originRef.current = { x: pageX, y: pageY };', 'originRef.current = { x: pageY, y: pageX };'),
  h('hook: a tap does not wait for a pending measurement', '    if (pendingRef.current) void pendingRef.current.then(resolve);\n    else resolve();', '    resolve();'),
  h('hook: a chip tap is reported for board A', 'optionsRef.current.onTapChip(optionsRef.current.board, tap.target.piece as ReservePieceType);', "optionsRef.current.onTapChip('A', tap.target.piece as ReservePieceType);"),
  h('hook: a promotion tap is reported for board A', 'optionsRef.current.onTapPromotion(optionsRef.current.board, tap.target.choice as PromotionPiece | \'cancel\');', "optionsRef.current.onTapPromotion('A', tap.target.choice as PromotionPiece | 'cancel');"),
  h('hook: a grid tap is reported for board A', 'if (hit !== null) onTapCell(board, hit);', "if (hit !== null) onTapCell('A', hit);"),
  h('hook: the grid is 8 x 7', 'gridTapCell(tap, originRef.current, cell, 8, 8)', 'gridTapCell(tap, originRef.current, cell, 8, 7)'),
  h('hook: the grid is 7 x 8', 'gridTapCell(tap, originRef.current, cell, 8, 8)', 'gridTapCell(tap, originRef.current, cell, 7, 8)'),
  h('hook: a tap on the grid is looked up with a stale cell size', 'const { board, cell, onTapCell } = optionsRef.current;', 'const { board, onTapCell } = optionsRef.current;\n      const cell = 28;'),

  // --- the block ----------------------------------------------------------------------------------------------------------------------------
  b('block: a promotion choice is lost', 'onTapPromotion: (promotingBoard, choice) => props.onPromotionChoice?.(promotingBoard, choice),', 'onTapPromotion: () => {},'),
  b('block: a chip tap is lost', 'onTapChip: props.onPickPocket,', 'onTapChip: () => {},'),
  b('block: a cell is read from the wrong side of the board', 'boardCellToSquare(tappedBoard, orientation, displayCell.row, displayCell.col)', "boardCellToSquare(tappedBoard, orientation === 'w' ? 'b' : 'w', displayCell.row, displayCell.col)"),
  b('block: a cell is read as white-at-the-bottom', 'boardCellToSquare(tappedBoard, orientation, displayCell.row, displayCell.col)', "boardCellToSquare(tappedBoard, 'w', displayCell.row, displayCell.col)"),
  b('block: a cell is read with rows and columns swapped', 'displayCell.row, displayCell.col)', 'displayCell.col, displayCell.row)'),
  b('block: every board takes raw touches', 'touches={props.rawTouch ? touches : undefined}', 'touches={touches}'),
  b('block: the top bar has no raw chips', '<SeatBar {...props} seat={top} touches={props.rawTouch ? touches : null} />', '<SeatBar {...props} seat={top} touches={null} />'),
  b('block: the bottom bar has no raw chips', '<SeatBar {...props} seat={bottom} touches={props.rawTouch ? touches : null} />', '<SeatBar {...props} seat={bottom} touches={null} />'),
  b('block: the promotion bar shows the pieces of nobody', 'const choices = props.rawTouch ? props.promotionChoices ?? [] : [];', 'const choices: readonly PromotionPiece[] = [];'),
  b('block: the shared board has no banner', '<View testID={props.shared ? `turn-banner-${board}` : undefined}>', '<View>'),
  b('block: every board has a banner', '<View testID={props.shared ? `turn-banner-${board}` : undefined}>', '<View testID={`turn-banner-${board}`}>'),

  // --- the screen ----------------------------------------------------------------------------------------------------------------------------
  s('screen: board A and board B share one selection', "const selectionOf = (board: BoardId) => (board === 'A' ? selectionA : selectionB);", 'const selectionOf = (board: BoardId) => (board === board ? selectionA : selectionB);'),
  s('screen: the selections are swapped', "const selectionOf = (board: BoardId) => (board === 'A' ? selectionA : selectionB);", "const selectionOf = (board: BoardId) => (board === 'A' ? selectionB : selectionA);"),
  s('screen: a tap is routed to board A', 'const done = selectionOf(board).apply(input, positionOf(current, board));', "const done = selectionOf('A').apply(input, positionOf(current, board));"),
  s('screen: a tap is judged on the position of board A', 'const done = selectionOf(board).apply(input, positionOf(current, board));', "const done = selectionOf(board).apply(input, positionOf(current, 'A'));"),
  s('screen: a tap acts for the seat of board A', 'const actor = touchSeat(seats, current, board);\n    if (actor === null) return;\n    const done', "const actor = touchSeat(seats, current, 'A');\n    if (actor === null) return;\n    const done"),
  s('screen: a locked board does not refuse a tap (EQUIVALENT: the reducer drops everything for a board nobody may act on and commits nothing, so the early return only saves a state update; pinned by the turn-lock tests)', "    const actor = touchSeat(seats, current, board);\n    if (actor === null) return;\n    const done = selectionOf(board).apply(input, positionOf(current, board));\n    if (done === null) return;", "    const actor = touchSeat(seats, current, board);\n    const done = selectionOf(board).apply(input, positionOf(current, board));\n    if (done === null || actor === null) return;"),
  s('screen: a move loses its promotion piece', 'to: done.to, promotion: done.promotion } });', 'to: done.to } });'),
  s('screen: a move is played on board A', "action: { kind: 'move', board: done.board, from: done.from", "action: { kind: 'move', board: 'A', from: done.from"),
  s('screen: a drop is played on board A', "action: { kind: 'drop', board: done.board, piece: done.piece", "action: { kind: 'drop', board: 'A', piece: done.piece"),
  s('screen: a drop names another piece', "kind: 'drop', board: done.board, piece: done.piece, square: done.square", "kind: 'drop', board: done.board, piece: 'p', square: done.square"),
  s('screen: the picked piece is not shown', 'selected: live.selected ? live.selected.square : null,', 'selected: null,'),
  s('screen: the moves of the picked piece are not shown', 'moveTargets: live.selected ? Array.from(new Set(position.movesFrom(live.selected.square).map((m) => m.to))) : [],', 'moveTargets: [],'),
  s('screen: the drop squares are not shown', 'dropTargets: live.picked ? position.dropSquares(live.picked.piece) : [],', 'dropTargets: [],'),
  s('screen: the picked chip is not marked', 'picked: live.picked ? live.picked.piece : null,', 'picked: null,'),
  s('screen: a waiting promotion is not shown', 'promotionChoices: live.promotion ? live.promotion.choices : undefined,', 'promotionChoices: undefined,'),
  s('screen: the selection shown is not made live (a stale one is drawn)', 'const live = liveSelection(selectionOf(board).selection, position);', 'const live = selectionOf(board).selection;'),
  s('screen: the dual boards are oriented like the other layouts', 'orientation={dual ? dualBoardOrientation(seats, board, match, autoFlip) : boardOrientation(layout, board, match, autoFlip)}', 'orientation={boardOrientation(layout, board, match, autoFlip)}'),
  s('screen: the boards do not take raw touches', '        rawTouch={dual}\n', '        rawTouch={false}\n'),
  s('screen: no board is shared', 'shared={dual && match.result === null && dualBoardPlan(seats, board).shared}', 'shared={false}'),
  s('screen: a finished match keeps its banner', 'shared={dual && match.result === null && dualBoardPlan(seats, board).shared}', 'shared={dual && dualBoardPlan(seats, board).shared}'),
  s('screen: the overlay covers a finished match too', 'const rotateOverlay = !over && needsRotateOverlay(seats, width, height);', 'const rotateOverlay = needsRotateOverlay(seats, width, height);'),
  s('screen: the overlay is never shown', 'const rotateOverlay = !over && needsRotateOverlay(seats, width, height);', 'const rotateOverlay = false;'),
  s('screen: the overlay is shown for every setup', 'const rotateOverlay = !over && needsRotateOverlay(seats, width, height);', 'const rotateOverlay = !over && !dualFit.fits;'),
  s('screen: the turn control is never offered with a shared board', 'const hasSharedBoard = dual && BOARD_IDS.some((board) => dualBoardPlan(seats, board).shared);', 'const hasSharedBoard = false;'),
  s('screen: the turn control is always offered', 'const hasSharedBoard = dual && BOARD_IDS.some((board) => dualBoardPlan(seats, board).shared);', 'const hasSharedBoard = dual;'),
  s('screen: both teams always have a Resign button', 'humans.some((seat) => seatPlace(seat).team === team)', 'true'),
  s('screen: a team resigns with the first human, whoever it is', 'const seat = humans.find((s) => seatPlace(s).team === team);', 'const seat = humans[0];'),
  s('screen: a team that has no human can resign', '    if (seat !== undefined && match.result === null) commit({ seat, action: { kind: \'resign\' } });\n  };\n  const controls', '    if (match.result === null) commit({ seat: seat ?? 0, action: { kind: \'resign\' } });\n  };\n  const controls'),
];

const T = 'src/screens/__tests__/';
const SUITES = ['bughouseDual', 'bughouseLocal'].map((n) => `${T}${n}.dom.test.tsx`).join(' ');

module.exports = {
  copy: ['src', 'package.json', 'tsconfig.json', 'vitest.config.mts'],
  junction: ['node_modules'],
  cmd: `npx vitest run --project dom ${SUITES} --reporter=dot --bail=1`,
  mutantTimeoutMs: 8 * 60 * 1000,
  mutants,
};
