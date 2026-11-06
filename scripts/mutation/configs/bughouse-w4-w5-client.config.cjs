// Mutation set for the Bughouse W4 / W5 CLIENT logic (command #35b, W9): the online view (`bughouseOnline.ts`: which snapshot wins, the clock estimate, the action in flight, the refusal
// sentences) and the premove input (`bughousePremoveInput.ts`: when a premove may exist, what a tap queues, the step at each snapshot). Run (one chunk at a time, results outside the repo):
//   npm run mutate -- scripts/mutation/configs/bughouse-w4-w5-client.config.cjs
//   npm run mutate -- scripts/mutation/configs/bughouse-w4-w5-client.config.cjs --chunk 2
// The tests that must kill them are the four pure suites below (seconds). A mutant that is equivalent carries "EQUIVALENT" and its reason in the name, and a test pins the proof.
const fs = require('node:fs');
const O = 'src/logic/bughouseOnline.ts';
const P = 'src/logic/bughousePremoveInput.ts';
const o = (name, find, replace) => [name, O, find, replace];
const p = (name, find, replace) => [name, P, find, replace];

const mutants = [
  // --- the online view: which snapshot wins ---------------------------------------------------------------------------------------------------
  o('state: a snapshot of another room is applied', 'payload.roomId !== view.roomId || !Number.isSafeInteger(payload.seq)', '!Number.isSafeInteger(payload.seq)'),
  o('state: a fractional seq is accepted', 'payload.roomId !== view.roomId || !Number.isSafeInteger(payload.seq)', 'payload.roomId !== view.roomId || typeof payload.seq !== \'number\''),
  o('state: the same seq is applied again', 'if (payload.seq <= view.match.seq)', 'if (payload.seq < view.match.seq)'),
  o('state: a gap is applied', "  if (payload.seq !== view.match.seq + 1) return { view, outcome: 'gap', resync: true };\n", ''),
  o('state: a gap does not ask for a resync', "outcome: 'gap', resync: true", "outcome: 'gap', resync: false"),
  o('state: an unreadable snapshot does not ask for a resync', "typeof payload.serverNowMs !== 'number') return { view, outcome: 'invalid', resync: true };", "typeof payload.serverNowMs !== 'number') return { view, outcome: 'invalid', resync: false };"),
  o('state: the text may say another seq than the payload', 'match === null || match.seq !== payload.seq || typeof payload.serverNowMs', 'match === null || typeof payload.serverNowMs'),
  o('state: a payload without serverNowMs is applied', "match.seq !== payload.seq || typeof payload.serverNowMs !== 'number'", 'match.seq !== payload.seq'),
  o('state: an applied snapshot keeps the last refusal', 'serverNowMs: payload.serverNowMs, receivedAt: localNow, actionError: null }', 'serverNowMs: payload.serverNowMs, receivedAt: localNow }'),
  o('state: the arrival instant is not renewed', 'serverNowMs: payload.serverNowMs, receivedAt: localNow, actionError: null }', 'serverNowMs: payload.serverNowMs, receivedAt: view.receivedAt, actionError: null }'),
  o('state: events are ignored', 'const events = Array.isArray(payload.events) ? payload.events : [];', 'const events: never[] = [];'),

  // --- the first views --------------------------------------------------------------------------------------------------------------------------
  o('found: a seat that is not 0..3 is accepted', '!isSeat(payload.seat) || ', ''),
  o('found: three seats are a room', 'seats.length === 4', 'seats.length >= 3'),
  o('found: a seat without a name is a seat', "typeof (s as { name?: unknown }).name === 'string'", 'true'),
  o('found: the time control label is dropped', "timeControlLabel: String(payload.timeControlLabel ?? ''),", "timeControlLabel: '',"),
  o('spectate: a spectator is not marked', '    mySeat: 0,\n    spectator: true,\n', '    mySeat: 0,\n'),
  o('spectate: a room without a roomId is a room', "typeof state.roomId !== 'string' || ", ''),

  // --- the clock estimate -----------------------------------------------------------------------------------------------------------------------
  o('clock: the estimate may go behind the match', 'return Math.max(view.match.nowMs, Math.floor(view.serverNowMs + Math.max(0, localNow - view.receivedAt)));', 'return Math.floor(view.serverNowMs + Math.max(0, localNow - view.receivedAt));'),
  o('clock: a local clock that went backwards counts', 'Math.max(0, localNow - view.receivedAt)', '(localNow - view.receivedAt)'),
  o('clock: the local time since arrival is ignored', 'view.serverNowMs + Math.max(0, localNow - view.receivedAt)', 'view.serverNowMs'),

  // --- seats, game over, result -------------------------------------------------------------------------------------------------------------
  o('seats: another room changes my seat list', 'payload.roomId !== view.roomId || !validSeats(payload.seats)) return view;', '!validSeats(payload.seats)) return view;'),
  o('seats: the grace countdown is not restarted', 'return { ...view, seats: payload.seats, seatsAt: localNow };', 'return { ...view, seats: payload.seats };'),
  o('over: an older final snapshot replaces ours', 'const newer = final !== null && final.seq >= view.match.seq;', 'const newer = final !== null;'),
  o('over: an equal final snapshot is ignored', 'final.seq >= view.match.seq', 'final.seq > view.match.seq'),
  o('over: the game over leaves an action in flight', '    gameOver: payload,\n    pending: null,\n', '    gameOver: payload,\n'),
  o('over: a payload without a result object is a game over', "|| typeof payload.result !== 'object' || payload.result === null", ''),
  o('result: the game-over payload wins over the match', 'return view.match.result ?? view.gameOver?.result ?? null;', 'return view.gameOver?.result ?? view.match.result ?? null;'),

  // --- the rejoin, the resync -----------------------------------------------------------------------------------------------------------------
  o('rejoin: an older room replaces ours', 'if (match.seq < view.match.seq) return', 'if (match.seq < -1) return'),
  o('rejoin: the same commit loses the last move', 'const sameCommit = match.seq === view.match.seq;', 'const sameCommit = false;'),
  o('rejoin: a newer commit keeps the old last move', 'const sameCommit = match.seq === view.match.seq;', 'const sameCommit = true;'),
  o('rejoin: the action in flight survives it', '      receivedAt: localNow,\n      pending: null,\n      resyncing: false,\n    },\n    outcome: \'adopted\'', '      receivedAt: localNow,\n      resyncing: false,\n    },\n    outcome: \'adopted\''),
  o('resync: a second one is sent while one is in flight', 'if (view.resyncing || isOver(view)) return { view, send: false };', 'if (isOver(view)) return { view, send: false };'),
  o('resync: a finished game asks for the room', 'if (view.resyncing || isOver(view)) return { view, send: false };', 'if (view.resyncing) return { view, send: false };'),
  o('resync: ending it does not clear the flag', 'return view.resyncing ? { ...view, resyncing: false } : view;', 'return view;'),

  // --- our own actions ----------------------------------------------------------------------------------------------------------------------------
  o('action: sent after the game is over', 'if (isOver(view) || view.pending !== null || view.resyncing) return', 'if (view.pending !== null || view.resyncing) return'),
  o('action: a second one is sent while one is in flight', 'if (isOver(view) || view.pending !== null || view.resyncing) return', 'if (isOver(view) || view.resyncing) return'),
  o('action: sent during a resync', 'if (isOver(view) || view.pending !== null || view.resyncing) return', 'if (isOver(view) || view.pending !== null) return'),
  o('action: a refused shape is not explained', 'return { view: { ...view, actionError: checked.error }, id: null, payload: null };', 'return { view, id: null, payload: null };'),
  o('action: the next id is not advanced', 'nextId: id + 1,', 'nextId: id,'),
  o('action: sending does not clear the last refusal', 'pending: { id }, nextId: id + 1, actionError: null }', 'pending: { id }, nextId: id + 1 }'),
  o('payload: the promotion is dropped', '...(action.promotion ? { promotion: action.promotion } : {}), baseSeq', 'baseSeq'),
  o('payload: a move names no base seq', '{}), baseSeq: view.match.seq }', '{}), baseSeq: 0 }'),
  o('payload: a drop names no base seq', 'square: action.square, baseSeq: view.match.seq }', 'square: action.square, baseSeq: 0 }'),
  o("ack: another action's answer ends the wait", 'return view.pending?.id === id ? { ...view, pending: null } : view;', 'return { ...view, pending: null };'),
  o("refusal: another action's refusal ends the wait", 'return view.pending?.id === id ? { ...view, pending: null, actionError: text } : view;', 'return { ...view, pending: null, actionError: text };'),
  o('refusal: an inherited name is a reason', "typeof reason === 'string' && Object.prototype.hasOwnProperty.call(REFUSAL_TEXT, reason)", "typeof reason === 'string'"),
  o('refusal: an unknown reason has no sentence', ": 'The server refused that.';", ": '';"),
  o('refusal: the late move sentence', "time: 'That move came too late.',", "time: 'That move was late.',"),
  o('refusal: the partner-is-a-bot sentence', "partnerIsBot: 'Your partner is a bot.',", "partnerIsBot: 'Your partner is a bot!',"),

  // --- W5: when a premove may exist ------------------------------------------------------------------------------------------------------------
  p('premove: allowed with two humans', 'return humanCount === 1 && match.result === null;', 'return humanCount <= 2 && match.result === null;'),
  p('premove: allowed with no human', 'return humanCount === 1 && match.result === null;', 'return humanCount <= 1 && match.result === null;'),
  p('premove: allowed after the end', 'return humanCount === 1 && match.result === null;', 'return humanCount === 1;'),
  p('waiting: waiting on my own turn', 'match.verdicts[place.board].turn !== place.color;', 'match.verdicts[place.board].turn === place.color;'),
  p('waiting: waiting after the end', 'return match.result === null && match.verdicts[place.board].turn !== place.color;', 'return match.verdicts[place.board].turn !== place.color;'),
  p('half: kept when its board changed', 'half.fen === match.boards[half.board].fen ? half : null', 'true ? half : null'),
  p('half: kept after the end', 'half !== null && match.result === null && half.fen', 'half !== null && half.fen'),

  // --- W5: what a tap queues -------------------------------------------------------------------------------------------------------------------
  p('tap: an opponent piece is mine', 'piece.color === place.color;', 'piece.color !== place.color;'),
  p('tap: a drop on an occupied square is queued', 'if (piece) return { half: null, queued: null }; // a drop needs an empty square', ''),
  p('tap: a pawn is dropped on the last ranks', "if (held.piece === 'p' && firstOrLastRank(square)) return { half: held, queued: null };", ''),
  p('tap: the first rank is fine for a pawn drop', "square[1] === '1' || square[1] === '8'", "square[1] === '8'"),
  p('tap: the last rank is fine for a pawn drop', "square[1] === '1' || square[1] === '8'", "square[1] === '1'"),
  p('tap: the same square does not put the piece down', '    if (held.square === square) return { half: null, queued: null };\n', ''),
  p('tap: another piece of mine is not picked instead', 'if (mine) return { half: { kind: \'select\', board: place.board, square, fen }, queued: null };', 'if (false) return { half: { kind: \'select\', board: place.board, square, fen }, queued: null };'),
  p('tap: a pawn that reaches the last rank does not promote', "mover && mover.type === 'p' && square[1] === lastRank(place.color) ? 'q' : undefined", 'undefined'),
  p('tap: every piece promotes on the last rank', "mover && mover.type === 'p' && square[1] === lastRank(place.color)", "mover && square[1] === lastRank(place.color)"),
  p('tap: the last rank of white is the first', "color === 'w' ? '8' : '1'", "color === 'w' ? '1' : '8'"),
  p('tap: a first tap on an empty square selects it', 'half: mine ? { kind: \'select\', board: place.board, square, fen } : null, queued: null };\n}', 'half: { kind: \'select\', board: place.board, square, fen }, queued: null };\n}'),
  p('pick: a chip I do not have is picked', 'if (!(match.pockets[seat][piece] > 0))', 'if (!(match.pockets[seat][piece] >= 0))'),
  p('pick: the same chip does not put it down', "held !== null && held.kind === 'pick' && held.piece === piece", "held !== null && held.kind === 'pick'"),

  // --- W5: what happens at a snapshot ----------------------------------------------------------------------------------------------------------
  p('step: not my turn drops the premove', "if (resolved.reason === 'notYourTurn') return { kind: 'wait' };\n", ''),
  p('step: a finished game explains itself', "if (resolved.reason === 'gameOver') return { kind: 'drop', notice: null };", "if (resolved.reason === 'gameOver') return { kind: 'drop', notice: PREMOVE_NOTICE.noLongerLegal };"),
  p('step: no premove plays something', "if (premove === null) return { kind: 'wait' };\n  const resolved", "if (premove === null) return { kind: 'drop', notice: null };\n  const resolved"),
  p('notice: the illegal sentence', "noLongerLegal: 'The premove is no longer legal.',", "noLongerLegal: 'The premove is not legal.',"),
  p('notice: the occupied sentence', "squareOccupied: 'The square is occupied.',", "squareOccupied: 'The square is taken.',"),
  p('notice: the pocket sentence', "notInPocket: 'The piece is no longer in your pocket.',", "notInPocket: 'The piece is not in your pocket.',"),
  p('notice: the check sentence', "checkNotAnswered: 'Your king is in check: this drop does not answer it.',", "checkNotAnswered: 'Your king is in check.',"),
  p('marks: the promotion piece is not the ghost', "(premove.promotion ?? mover?.type ?? 'p')", "(mover?.type ?? 'p')"),
  p('marks: a drop marks a from square', "return { from: null, to: premove.square,", "return { from: premove.square, to: premove.square,"),
];

const T = 'src/logic/__tests__/';
const FAST = ['bughouseOnline', 'bughouseOnlineSession', 'bughouseSpectator', 'bughousePremove', 'bughousePremoveInput'].map((n) => `${T}${n}.test.ts`).join(' ');
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
