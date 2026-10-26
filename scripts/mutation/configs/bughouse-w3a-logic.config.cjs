// Mutation set for the Bughouse W3a LOGIC (the non-visual parts of the Local screens): the layout derivation, the size gate and cell sizes, the seat rows and presets, the turn lock, the
// drop-square listing, the status mapping, the king badges, the game-over summary, the clock text and the Local game state. Run (one chunk at a time, results outside the repo):
//   npm run mutate -- scripts/mutation/configs/bughouse-w3a-logic.config.cjs
//   npm run mutate -- scripts/mutation/configs/bughouse-w3a-logic.config.cjs --chunk 2
// The tests that must kill them are the four pure suites below (a few seconds). The rendered tests (bughouseLocal.dom.test.tsx) are not part of the loop; the colours and spacing of the
// components are the browser pass's job and are not mutated.
//
// EQUIVALENT MUTANTS carry "EQUIVALENT" and the reason in their name (none expected up front; the proof of each is pinned by a test).
const L = 'src/logic/bughouseLayout.ts';
const V = 'src/logic/bughouseView.ts';
const G = 'src/logic/bughouseLocal.ts';
const m = (name, file, find, replace) => [name, file, find, replace];
const l = (name, find, replace) => m(name, L, find, replace);
const v = (name, find, replace) => m(name, V, find, replace);
const g = (name, find, replace) => m(name, G, find, replace);

const mutants = [
  // --- the layout that follows from where the humans sit -------------------------------------------------------------------------------------
  l('layout: no human is a layout of its own no more', "  if (humans.length === 0) return { kind: 'none' };\n", ''),
  l('layout: two humans are the standard layout', 'if (humans.length === 1) return', 'if (humans.length === 2) return'),
  l('layout: the standard layout names the first seat, not the human', "{ kind: 'standard', seat: humans[0] }", "{ kind: 'standard', seat: 0 }"),
  l('layout: humans on both boards are pass-and-play', 'if (boards.size === 1) return', 'if (boards.size >= 1) return'),
  l('layout: pass-and-play needs two boards', 'if (boards.size === 1) return', 'if (boards.size === 2) return'),
  l('layout: pass-and-play is always on board A', "{ kind: 'passAndPlay', board: seatPlace(humans[0]).board }", "{ kind: 'passAndPlay', board: 'A' }"),
  l('layout: the humans are the bots', "config[seat].kind === 'human'", "config[seat].kind === 'bot'"),

  // --- seat rows, presets, time controls -----------------------------------------------------------------------------------------------------
  l('rows: team 1 is a circle', "shape: place.team === 1 ? '◆' : '●'", "shape: place.team === 1 ? '●' : '◆'"),
  l('rows: the colour words are swapped', "const color = place.color === 'w' ? 'White' : 'Black';", "const color = place.color === 'w' ? 'Black' : 'White';"),
  l('rows: the text order', '`Board ${place.board} · ${color} · Team ${place.team}`', '`Board ${place.board} · Team ${place.team} · ${color}`'),
  l('rows: the shape helper is swapped', "export const bughouseTeamShape = (team: BughouseTeam): '◆' | '●' => (team === 1 ? '◆' : '●');", "export const bughouseTeamShape = (team: BughouseTeam): '◆' | '●' => (team === 1 ? '●' : '◆');"),
  l('presets: teammates are on the same board', "{ id: 'teammates', label: '2 teammates', humans: [0, 3] }", "{ id: 'teammates', label: '2 teammates', humans: [0, 2] }"),
  l('presets: opponents are teammates', "{ id: 'opponents', label: '2 opponents', humans: [0, 1] }", "{ id: 'opponents', label: '2 opponents', humans: [0, 3] }"),
  l('presets: the solo human is seat 1', "{ id: 'solo', label: 'You + 3 bots', humans: [0] }", "{ id: 'solo', label: 'You + 3 bots', humans: [1] }"),
  l('presets: four players are three', "humans: [0, 1, 2, 3] }", 'humans: [0, 1, 2] }'),
  l('presets: a preset ignores the bot ELO', "{ kind: 'bot', elo }", "{ kind: 'bot', elo: 1200 }"),
  l('presets: an unknown preset is accepted', "  if (!preset) throw new RangeError(`unknown preset ${id}`);\n", ''),
  l('presets: a config is its preset whatever the length', 'p.humans.length === humans.length && ', ''),
  l('presets: the first preset matches everything', 'p.humans.every((s, i) => s === humans[i])', 'true'),
  l('time: milliseconds are tenths', 'initialMs: preset.initialSeconds * 1000', 'initialMs: preset.initialSeconds * 100'),
  l('time: the increment is in seconds', 'incrementMs: preset.incrementSeconds * 1000', 'incrementMs: preset.incrementSeconds'),
  l('time: 3 | 2 is 3 | 1', "'blitz-3-2'", "'blitz-3-1'"),
  l('time: 5 | 5 instead of 5 | 2', "'blitz-5-2'", "'blitz-5-5'"),

  // --- the dual-board cell sizes and the gate ------------------------------------------------------------------------------------------------
  l('stacked: the height chrome is 280', 'Math.floor((height - 288) / 16)', 'Math.floor((height - 280) / 16)'),
  l('stacked: two boards need 17 rows of cells', 'Math.floor((height - 288) / 16)', 'Math.floor((height - 288) / 17)'),
  l('stacked: the width margin is 8', '/ 16), Math.floor((width - 16) / 8))', '/ 16), Math.floor((width - 8) / 8))'),
  l('stacked: nine files', '/ 16), Math.floor((width - 16) / 8))', '/ 16), Math.floor((width - 16) / 9))'),
  l('stacked: the larger of the two limits', 'Math.min(Math.floor((height - 288) / 16), Math.floor((width - 16) / 8))', 'Math.max(Math.floor((height - 288) / 16), Math.floor((width - 16) / 8))'),
  l('side by side: the height chrome is 120', 'Math.floor((height - 128) / 8)', 'Math.floor((height - 120) / 8)'),
  l('side by side: nine rows', 'Math.floor((height - 128) / 8)', 'Math.floor((height - 128) / 9)'),
  l('side by side: the width margin is 16', 'Math.floor((width - 24) / 16)', 'Math.floor((width - 16) / 16)'),
  l('side by side: 17 columns', 'Math.floor((width - 24) / 16)', 'Math.floor((width - 24) / 17)'),
  l('side by side: the larger of the two limits', 'Math.min(Math.floor((height - 128) / 8), Math.floor((width - 24) / 16))', 'Math.max(Math.floor((height - 128) / 8), Math.floor((width - 24) / 16))'),
  l('fit: side by side wins a tie only when strictly larger is gone', 'if (sideBySide > stacked) arrangement', 'if (sideBySide >= stacked) arrangement'),
  l('fit: stacked is chosen on a tie too', 'else if (stacked > sideBySide) arrangement', 'else if (stacked >= sideBySide) arrangement'),
  l('fit: the stacked branch is never taken', "else if (stacked > sideBySide) arrangement = 'stacked';", "else if (false) arrangement = 'stacked';"),
  l('fit: a tie at 700 px goes to stacked', 'width >= BUGHOUSE_SIDE_BY_SIDE_MIN_WIDTH ? \'sideBySide\'', 'width > BUGHOUSE_SIDE_BY_SIDE_MIN_WIDTH ? \'sideBySide\''),
  l('fit: a tie always goes to stacked', "width >= BUGHOUSE_SIDE_BY_SIDE_MIN_WIDTH ? 'sideBySide' : 'stacked'", "'stacked'"),
  l('fit: a tie always goes to side by side', "width >= BUGHOUSE_SIDE_BY_SIDE_MIN_WIDTH ? 'sideBySide' : 'stacked'", "'sideBySide'"),
  l('fit: the tie width is 701', 'export const BUGHOUSE_SIDE_BY_SIDE_MIN_WIDTH = 700;', 'export const BUGHOUSE_SIDE_BY_SIDE_MIN_WIDTH = 701;'),
  l('fit: the tie width is 699', 'export const BUGHOUSE_SIDE_BY_SIDE_MIN_WIDTH = 700;', 'export const BUGHOUSE_SIDE_BY_SIDE_MIN_WIDTH = 699;'),
  l('fit: the winning cell is the stacked one', "const cell = arrangement === 'stacked' ? stacked : sideBySide;", 'const cell = stacked;'),
  l('fit: the minimum cell is 27', 'export const BUGHOUSE_DUAL_MIN_CELL = 28;', 'export const BUGHOUSE_DUAL_MIN_CELL = 27;'),
  l('fit: the minimum cell is 29', 'export const BUGHOUSE_DUAL_MIN_CELL = 28;', 'export const BUGHOUSE_DUAL_MIN_CELL = 29;'),
  l('fit: exactly the minimum does not fit', 'fits: cell >= BUGHOUSE_DUAL_MIN_CELL', 'fits: cell > BUGHOUSE_DUAL_MIN_CELL'),
  l('gate: no human can start', "  if (layout.kind === 'none') return { startable: false, reason: 'noHuman', message: BUGHOUSE_NO_HUMAN_MESSAGE };\n", ''),
  l('gate: only the dual layout starts', "if (layout.kind !== 'dual') return { startable: true };", "if (layout.kind === 'dual') return { startable: true };"),
  l('gate: a setup that does not fit is let through', '!getBughouseDualCellSize(width, height).fits', 'getBughouseDualCellSize(width, height).fits'),
  l('gate: every dual setup is "too small"', '!getBughouseDualCellSize(width, height).fits', 'true'),
  l('gate: the message of the gate', "'This seat setup needs a larger screen. Turn the device to landscape, or put every human on one board.'", "'This seat setup needs a larger screen.'"),
  l('gate: the reason is the same for both', "reason: 'tooSmall', message: BUGHOUSE_SIZE_GATE_MESSAGE", "reason: 'comingNext', message: BUGHOUSE_SIZE_GATE_MESSAGE"),

  // --- the standard layouts ------------------------------------------------------------------------------------------------------------------
  l('main: the chrome is 351', 'export const BUGHOUSE_MAIN_CHROME = 352;', 'export const BUGHOUSE_MAIN_CHROME = 351;'),
  l('main: the chrome is 353', 'export const BUGHOUSE_MAIN_CHROME = 352;', 'export const BUGHOUSE_MAIN_CHROME = 353;'),
  l('main: the smallest cell is 27', 'export const BUGHOUSE_MAIN_MIN_CELL = 28;', 'export const BUGHOUSE_MAIN_MIN_CELL = 27;'),
  l('main: the largest cell is 53', 'export const BUGHOUSE_MAIN_MAX_CELL = 52;', 'export const BUGHOUSE_MAIN_MAX_CELL = 53;'),
  l('main: the width margin is 8', 'const byWidth = Math.floor((width - 16) / 8);', 'const byWidth = Math.floor((width - 8) / 8);'),
  l('main: the height is ignored', 'Math.min(BUGHOUSE_MAIN_MAX_CELL, byWidth, byHeight)', 'Math.min(BUGHOUSE_MAIN_MAX_CELL, byWidth)'),
  l('main: the width is ignored', 'Math.min(BUGHOUSE_MAIN_MAX_CELL, byWidth, byHeight)', 'Math.min(BUGHOUSE_MAIN_MAX_CELL, byHeight)'),
  l('main: no ceiling', 'Math.max(BUGHOUSE_MAIN_MIN_CELL, Math.min(BUGHOUSE_MAIN_MAX_CELL, byWidth, byHeight))', 'Math.max(BUGHOUSE_MAIN_MIN_CELL, Math.min(byWidth, byHeight))'),
  l('main: no floor', 'Math.max(BUGHOUSE_MAIN_MIN_CELL, Math.min(BUGHOUSE_MAIN_MAX_CELL, byWidth, byHeight))', 'Math.min(BUGHOUSE_MAIN_MAX_CELL, byWidth, byHeight)'),
  l('arrangement: landscape alone does not count', 'width >= BUGHOUSE_SIDE_BY_SIDE_MIN_WIDTH || width > height', 'width >= BUGHOUSE_SIDE_BY_SIDE_MIN_WIDTH'),
  l('arrangement: wide AND landscape', 'width >= BUGHOUSE_SIDE_BY_SIDE_MIN_WIDTH || width > height', 'width >= BUGHOUSE_SIDE_BY_SIDE_MIN_WIDTH && width > height'),
  l('arrangement: a square window is landscape', 'width >= BUGHOUSE_SIDE_BY_SIDE_MIN_WIDTH || width > height', 'width >= BUGHOUSE_SIDE_BY_SIDE_MIN_WIDTH || width >= height'),
  l('arrangement: 701 px is a tablet', 'width >= BUGHOUSE_SIDE_BY_SIDE_MIN_WIDTH || width > height', 'width > BUGHOUSE_SIDE_BY_SIDE_MIN_WIDTH || width > height'),
  l('arrangement: the thumbnail is the landscape one', "? 'sideBySide' : 'thumbnail'", "? 'thumbnail' : 'sideBySide'"),
  l('side: the smallest side cell is 19', 'BUGHOUSE_MAIN_MIN_CELL - 8', 'BUGHOUSE_MAIN_MIN_CELL - 7'),
  l('side: the largest side cell is 61', 'BUGHOUSE_MAIN_MAX_CELL + 10', 'BUGHOUSE_MAIN_MAX_CELL + 9'),
  l('side: the side cell is the stacked one', 'Math.min(BUGHOUSE_MAIN_MAX_CELL + 10, sideBySideDualCell(width, height))', 'Math.min(BUGHOUSE_MAIN_MAX_CELL + 10, stackedDualCell(width, height))'),

  // --- orientation, the cell map --------------------------------------------------------------------------------------------------------------
  v('orientation: the partner\'s board shows the human\'s colour', 'return board === mine.board ? mine.color : otherColor(mine.color);', 'return mine.color;'),
  v('orientation: the own board shows the partner\'s colour', 'return board === mine.board ? mine.color : otherColor(mine.color);', 'return board === mine.board ? otherColor(mine.color) : mine.color;'),
  v('orientation: pass-and-play never turns', "    if (!autoFlip) return 'w';\n", ''),
  v('orientation: pass-and-play always keeps White', 'if (!autoFlip) return', 'if (true) return'),
  v('orientation: the shared board shows the wrong side', 'return board === layout.board ? shownTurn : otherColor(shownTurn);', 'return board === layout.board ? otherColor(shownTurn) : shownTurn;'),
  v('orientation: the other board is not turned against the shared one', 'return board === layout.board ? shownTurn : otherColor(shownTurn);', 'return shownTurn;'),
  v('orientation: pass-and-play reads board A\'s turn', 'const shownTurn = match.verdicts[layout.board].turn;', "const shownTurn = match.verdicts['A'].turn;"),
  v('orientation: the standard layout is a pass-and-play one', "if (layout.kind === 'standard') {\n    const mine", "if (layout.kind === 'passAndPlay') {\n    const mine"),
  v('main board: the standard layout is on board A', "if (layout.kind === 'standard') return seatPlace(layout.seat).board;", "if (layout.kind === 'standard') return 'A';"),
  v('main board: pass-and-play is on board A', "if (layout.kind === 'passAndPlay') return layout.board;", "if (layout.kind === 'passAndPlay') return 'A';"),
  v('cells: the file is not mirrored for Black', "const file = orientation === 'w' ? col : 7 - col;\n  const rank = orientation === 'w' ? 8 - row : row + 1;\n  return { board, square", "const file = col;\n  const rank = orientation === 'w' ? 8 - row : row + 1;\n  return { board, square"),
  v('cells: the rank is not mirrored for Black', "const rank = orientation === 'w' ? 8 - row : row + 1;", 'const rank = 8 - row;'),
  v('cells: the rank is off by one', "const rank = orientation === 'w' ? 8 - row : row + 1;", "const rank = orientation === 'w' ? 7 - row : row + 1;"),
  v('cells: the inverse does not mirror the file', "col: orientation === 'w' ? file : 7 - file }", 'col: file }'),
  v('cells: the inverse does not mirror the rank', "row: orientation === 'w' ? 8 - rank : rank - 1,", 'row: 8 - rank,'),
  v('cells: the inverse reads the file from the wrong end', "const file = square.charCodeAt(0) - 97;\n  const rank = Number(square[1]);\n  return { board, row", "const file = square.charCodeAt(0) - 96;\n  const rank = Number(square[1]);\n  return { board, row"),
  v('seats: the top seat is the bottom one', 'return [seatAt(board, otherColor(orientation)), seatAt(board, orientation)];', 'return [seatAt(board, orientation), seatAt(board, otherColor(orientation))];'),

  // --- who may touch, drops, pockets -----------------------------------------------------------------------------------------------------------
  v('touch: a finished match can be touched', "  if (match.result !== null) return null;\n  const seat = seatAt(board, match.verdicts[board].turn);", '  const seat = seatAt(board, match.verdicts[board].turn);'),
  v('touch: a bot seat can be touched', "return config[seat].kind === 'human' ? seat : null;", "return config[seat].kind === 'bot' ? seat : null;"),
  v('touch: every seat can be touched', "return config[seat].kind === 'human' ? seat : null;", 'return seat;'),
  v('touch: the side NOT to move is the actor', 'const seat = seatAt(board, match.verdicts[board].turn);\n  return config', "const seat = seatAt(board, match.verdicts[board].turn === 'w' ? 'b' : 'w');\n  return config"),
  v('touch: the actor is read from the other board', 'const seat = seatAt(board, match.verdicts[board].turn);\n  return config', "const seat = seatAt(board, match.verdicts[board === 'A' ? 'B' : 'A'].turn);\n  return config"),
  v('drops: every piece\'s squares are offered', '.filter((option) => option.piece === piece)', '.filter(() => true)'),
  v('drops: the other pieces\' squares', '.filter((option) => option.piece === piece)', '.filter((option) => option.piece !== piece)'),
  v('drops: the squares of the first drop only', '.map((option) => option.square);', '.map((option) => option.square).slice(0, 1);'),
  v('drops: the squares of the other board', 'return legalDropsOn(match, board)\n    .filter', "return legalDropsOn(match, board === 'A' ? 'B' : 'A')\n    .filter"),
  v('chips: queen last', '    .slice()\n    .reverse()\n    .map((piece) => ({ piece, count', '    .slice()\n    .map((piece) => ({ piece, count'),
  v('chips: empty slots are chips', 'RESERVE_PIECE_TYPES.filter((piece) => pocket[piece] > 0)', 'RESERVE_PIECE_TYPES.filter((piece) => pocket[piece] >= 0)'),
  v('chips: anyone can use a pocket', 'actor === seat ? new Set', 'actor !== null ? new Set'),
  v('chips: nobody can use a pocket', 'actor === seat ? new Set', 'false ? new Set'),
  v('chips: the count is the number of kinds', '({ piece, count: pocket[piece], usable', '({ piece, count: 1, usable'),
  v('chips: usable is always true', 'usable: droppable.has(piece) }', 'usable: true }'),
  v('chips: the droppable set is the other board\'s', 'const board = seatPlace(seat).board;\n  const droppable', "const board = seatPlace(seat).board === 'A' ? 'B' : 'A';\n  const droppable"),

  // --- the status line ---------------------------------------------------------------------------------------------------------------------------
  v('status: a finished match is not reported', "  if (match.result !== null) {\n    return { kind: 'over'", "  if (false) {\n    return { kind: 'over'"),
  v('status: every finished board is a checkmate', "verdict.status === 'checkmate' ? 'Checkmate' : 'Game over'", "'Checkmate'"),
  v('status: no finished board is a checkmate', "verdict.status === 'checkmate' ? 'Checkmate' : 'Game over'", "'Game over'"),
  v('status: stuck is not looked at', "if (verdict.status === 'stuck') {", 'if (false) {'),
  v('status: the stuck-in-check line is the plain one', "verdict.stuck === 'check';", "verdict.stuck === 'noAction';"),
  v('status: a stuck side speaks to the bystander', 'if (you) return { kind: \'stuck\'', 'if (!you) return { kind: \'stuck\''),
  v('status: the bystander\'s stuck line says "your"', '? `${colour} is in check - waiting for a piece from their partner to block it`', '? `${colour} is in check - waiting for a piece from your partner to block it`'),
  v('status: check is not reported', "if (verdict.status === 'check') return", 'if (false) return'),
  v('status: the check line speaks to the wrong person', "you ? 'Check - your king is attacked' : `${colour} is in check`", "you ? `${colour} is in check` : 'Check - your king is attacked'"),
  v('status: the side to move is the wrong colour', "const colour = verdict.turn === 'w' ? 'White' : 'Black';", "const colour = verdict.turn === 'w' ? 'Black' : 'White';"),
  v('status: the stuck text', "export const STUCK_TEXT = 'Waiting for a piece from your partner';", "export const STUCK_TEXT = 'Checkmate';"),
  v('king: a king without check is highlighted', "  if (!verdict.inCheck) return null;\n", ''),
  v('king: the other side\'s king is highlighted', 'cell.type === \'k\' && cell.color === verdict.turn) return cell.square;', 'cell.type === \'k\' && cell.color !== verdict.turn) return cell.square;'),
  v('king: any king', "cell.type === 'k' && cell.color === verdict.turn) return cell.square;", "cell.type === 'k') return cell.square;"),

  // --- badges ------------------------------------------------------------------------------------------------------------------------------------
  v('badge: the opponent\'s team is badged for one human', 'if (seatPlace(layout.seat).team !== team) return null;', 'if (seatPlace(layout.seat).team === team) return null;'),
  v('badge: nobody is badged for one human', 'if (seatPlace(layout.seat).team !== team) return null;', 'return null;'),
  v('badge: one human sees "Team N"', "label: 'your team' };", "label: `Team ${team}` };"),
  v('badge: several humans see "your team"', "label: `Team ${team}` };\n}", "label: 'your team' };\n}"),
  v('badge: the king of the other colour', "const team = seatPlace(seatAt(board, color)).team;", "const team = seatPlace(seatAt(board, color === 'w' ? 'b' : 'w')).team;"),
  v('badge: the king of the other board', "const team = seatPlace(seatAt(board, color)).team;", "const team = seatPlace(seatAt(board === 'A' ? 'B' : 'A', color)).team;"),
  v('badge: no badge for several humans', "  return { team, shape: bughouseTeamShape(team), label: `Team ${team}` };", '  return null;'),

  // --- the clock text -----------------------------------------------------------------------------------------------------------------------------
  v('clock: tenths at ten seconds', 'return clamped < 10000 ?', 'return clamped <= 10000 ?'),
  v('clock: tenths under a minute', 'return clamped < 10000 ?', 'return clamped < 60000 ?'),
  v('clock: tenths never', 'return clamped < 10000 ? `${base}.${Math.floor((clamped % 1000) / 100)}` : base;', 'return base;'),
  v('clock: seconds are not padded', ".padStart(2, '0')", ".padStart(1, '0')"),
  v('clock: 100 seconds in a minute', 'const seconds = totalSeconds % 60;', 'const seconds = totalSeconds % 100;'),
  v('clock: the minutes are the seconds / 100', 'const minutes = Math.floor(totalSeconds / 60);', 'const minutes = Math.floor(totalSeconds / 100);'),
  v('clock: a negative value shows', 'const clamped = Math.max(0, Math.floor(ms));', 'const clamped = Math.floor(ms);'),
  v('clock: the tenth is the hundredth', 'Math.floor((clamped % 1000) / 100)', 'Math.floor((clamped % 1000) / 10)'),

  // --- the game-over summary ----------------------------------------------------------------------------------------------------------------------
  v('over: no summary before the end', '  if (result === null) return null;\n', ''),
  v('over: a voided match has a winner', "if ('voided' in result) return", "if (false) return"),
  v('over: the voided headline', "headline: 'No result'", "headline: 'Draw'"),
  v('over: the headline names the loser', 'headline: `Team ${result.winnerTeam} wins`', 'headline: `Team ${result.winnerTeam === 1 ? 2 : 1} wins`'),
  v('over: the deciding board is board A', 'decidingBoard: result.board,', "decidingBoard: 'A',"),
  v('over: the loser is the winner', 'loserSeat: result.loserSeat,', 'loserSeat: null,'),
  v('over: the reason text of a flag', "flag: 'Flag fell'", "flag: 'Time'"),
  v('over: the reason text of a resignation', "resign: 'Resigned'", "resign: 'Resigns'"),
  v('over: the detail names the reason first', 'detail: `Board ${result.board} - ${reason.toLowerCase()}`', 'detail: `${reason} - Board ${result.board}`'),
  v('over: the detail keeps the capital', 'reason.toLowerCase()}`,', 'reason}`,'),
  v('viewer: several humans have a result', 'humans.length !== 1) return null', 'humans.length < 1) return null'),
  v('viewer: a voided match has a winner', 'summary === null || summary.voided ||', 'summary === null ||'),
  v('viewer: the loser won', 'return seatPlace(humans[0]).team === summary.winnerTeam;', 'return seatPlace(humans[0]).team !== summary.winnerTeam;'),

  // --- the Local game state ------------------------------------------------------------------------------------------------------------------------
  g('local: a move is not remembered', "if (event.kind === 'move') lastMove = { ...lastMove, [event.board]: { from: event.from, to: event.to } };", "if (event.kind === 'move') void 0;"),
  g('local: a move is remembered on the other board', '[event.board]: { from: event.from, to: event.to } }', "['A']: { from: event.from, to: event.to } }"),
  g('local: a drop is not remembered', "else if (event.kind === 'drop') lastMove = { ...lastMove, [event.board]: { from: event.square, to: event.square } };", "else if (event.kind === 'drop') void 0;"),
  g('local: a drop\'s square is its origin only', '{ from: event.square, to: event.square }', "{ from: '', to: event.square }"),
  g('local: a bank is not remembered', "else if (event.kind === 'bank') bank = { seat: event.seat, piece: event.piece, seq: event.seq };", "else if (event.kind === 'bank') void 0;"),
  g('local: a bank flash names the capturer', 'bank = { seat: event.seat, piece: event.piece, seq: event.seq }', 'bank = { seat: 0, piece: event.piece, seq: event.seq }'),
  g('local: the instant is not raised to the match\'s', 'const at = Math.max(nowMs, state.match.nowMs);', 'const at = nowMs;'),
  g('local: the instant is lowered to the match\'s', 'const at = Math.max(nowMs, state.match.nowMs);', 'const at = Math.min(nowMs, state.match.nowMs);'),
  g('local: a flag does not change the state', "if (outcome.kind === 'applied' || outcome.kind === 'flag') return", "if (outcome.kind === 'applied') return"),
  g('local: a refusal changes the state', 'return { state, outcome };', 'return { state: { ...state }, outcome };'),
  g('local: the next deadline is the latest', 'Math.min(...running.map((c) => c.deadline))', 'Math.max(...running.map((c) => c.deadline))'),
  g('local: a finished match still has a deadline', 'running.length === 0 ? null :', 'false ? null :'),
  g('local: bullet runs to 2 | 1 exclusive', 'return initialMs <= 120000 ? 200 : 450;', 'return initialMs < 120000 ? 200 : 450;'),
  g('local: bullet thinks 450', 'return initialMs <= 120000 ? 200 : 450;', 'return initialMs <= 120000 ? 450 : 450;'),
  g('local: blitz thinks 200', 'return initialMs <= 120000 ? 200 : 450;', 'return initialMs <= 120000 ? 200 : 200;'),
  g('local: a stuck bot is due', "    if (verdict.status === 'stuck') continue;\n", ''),
  g('local: a finished match has due bots', "  if (match.result !== null) return [];\n", ''),
  g('local: a human is a due bot', "if (config[seat].kind === 'bot') due.push(seat);", "if (config[seat].kind === 'human') due.push(seat);"),
  g('local: the due seat is the side NOT to move', 'const seat = seatAt(board, verdict.turn);\n    if (config', "const seat = seatAt(board, verdict.turn === 'w' ? 'b' : 'w');\n    if (config"),
  g('local: a human seat gets a bot action', "if (controller.kind !== 'bot') return null;", ''),
  g('local: the bot plays at ELO 1200 whatever it is', 'chooseBughouseAction(match, seat, controller.elo, rng)', 'chooseBughouseAction(match, seat, 1200, rng)'),
  g('local: the match starts at 0', 'createMatch({ timeControl, roomNumber, startMs })', 'createMatch({ timeControl, roomNumber, startMs: 0 })'),
  g('local: the room number is lost', 'createMatch({ timeControl, roomNumber, startMs })', 'createMatch({ timeControl, roomNumber: 0, startMs })'),
];

const fs = require('fs');
const T = 'src/logic/__tests__/';
const FAST = ['bughouseLayout', 'bughouseView', 'bughouseLocal', 'bughouseUiBoardArgument'].map((n) => `${T}${n}.test.ts`).join(' ');
let selected = mutants;
if (process.env.MUT_ONLY) {
  const names = new Set(fs.readFileSync(process.env.MUT_ONLY, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean));
  selected = mutants.filter((x) => names.has(x[0]));
}

module.exports = {
  copy: ['src', 'package.json', 'tsconfig.json', 'vitest.config.mts'],
  junction: ['node_modules'],
  cmd: `npx vitest run ${FAST} --reporter=dot --bail=1`,
  mutantTimeoutMs: 4 * 60 * 1000,
  mutants: selected,
};
