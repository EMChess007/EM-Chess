// Mutation set for the Bughouse additions to src/logic/crazyhouse.ts (BUGHOUSE_SPEC.md W0): bank-to-partner and "can a drop ever help".
//   npm run mutate -- scripts/mutation/configs/bughouse-w0-crazyhouse-exports.config.cjs
// The server copy (backend/src/game/crazyhouse.ts) is a verbatim mirror guarded by backend/scripts/test-crazyhouse.mjs: any change to it fails that guard at once, so mutating it
// would only prove the guard works; the mirror is therefore not mutated here.
const C = 'src/logic/crazyhouse.ts';
module.exports = {
  copy: ['src', 'package.json', 'tsconfig.json', 'vitest.config.mts'],
  junction: ['node_modules'],
  cmd: 'npx vitest run src/logic/__tests__/crazyhouseBughouseExports --reporter=dot',
  mutantTimeoutMs: 5 * 60 * 1000,
  mutants: [
    // crazyhouseBankedPiece
    ['banked: a move that captures nothing still banks (the early return is gone)', C, 'if (!move.captured) return null;\n  const capturedSquare', 'const capturedSquare'],
    ['banked: a capture banks nothing', C, 'if (!move.captured) return null;', 'if (move.captured) return null;'],
    ['banked: the promoted mark is looked up on the capturer\'s square', C, 'state.promoted.includes(capturedSquare) ?', 'state.promoted.includes(move.from) ?'],
    ['banked: a promoted piece banks a queen', C, "state.promoted.includes(capturedSquare) ? 'p' : move.captured) as ReservePieceType;\n  return RESERVE", "state.promoted.includes(capturedSquare) ? 'q' : move.captured) as ReservePieceType;\n  return RESERVE"],
    ['banked: a promoted mark is never honoured', C, "state.promoted.includes(capturedSquare) ? 'p' : move.captured) as ReservePieceType;\n  return RESERVE", "false ? 'p' : move.captured) as ReservePieceType;\n  return RESERVE"],
    ['banked: every mark counts, wherever it is', C, "state.promoted.includes(capturedSquare) ? 'p' : move.captured) as ReservePieceType;\n  return RESERVE", "state.promoted.length > 0 ? 'p' : move.captured) as ReservePieceType;\n  return RESERVE"],
    ['banked: a king is banked', C, 'return RESERVE_PIECE_TYPES.includes(type) ? type : null;\n}\n\n/** `state` plus', 'return type;\n}\n\n/** `state` plus'],
    ['banked: everything unknown is a pawn', C, 'return RESERVE_PIECE_TYPES.includes(type) ? type : null;\n}\n\n/** `state` plus', "return RESERVE_PIECE_TYPES.includes(type) ? type : 'p';\n}\n\n/** `state` plus"],
    ['banked (EQUIVALENT: an en passant victim is a pawn, so the square decides nothing - pinned by "an en passant capture banks a pawn - whatever promoted marks exist"): the landing square is looked up', C, "const capturedSquare = move.enPassant ? `${move.to[0]}${move.from[1]}` : move.to;\n  const type = (state.promoted.includes(capturedSquare) ? 'p' : move.captured) as ReservePieceType;\n  return RESERVE", "const capturedSquare = move.to;\n  const type = (state.promoted.includes(capturedSquare) ? 'p' : move.captured) as ReservePieceType;\n  return RESERVE"],
    // creditCrazyhouseReserve
    ['credit: the input is changed in place', C, 'export function creditCrazyhouseReserve(state: CrazyhouseState, color: PieceColor, piece: ReservePieceType): CrazyhouseState {\n  const next = cloneCrazyhouseState(state);', 'export function creditCrazyhouseReserve(state: CrazyhouseState, color: PieceColor, piece: ReservePieceType): CrazyhouseState {\n  const next = state;'],
    ['credit: a piece is taken, not added', C, 'next.reserve[color][piece]++;', 'next.reserve[color][piece]--;'],
    ['credit: the other colour is credited', C, "if (RESERVE_PIECE_TYPES.includes(piece)) next.reserve[color][piece]++;", "if (RESERVE_PIECE_TYPES.includes(piece)) next.reserve[color === 'w' ? 'b' : 'w'][piece]++;"],
    ['credit: two pieces are added', C, 'next.reserve[color][piece]++;', 'next.reserve[color][piece] += 2;'],
    ['credit: a junk type opens a slot', C, 'if (RESERVE_PIECE_TYPES.includes(piece)) next.reserve[color][piece]++;', 'next.reserve[color][piece] = (next.reserve[color][piece] ?? 0) + 1;'],
    // applyCrazyhouseMoveForPartner
    ['partner: the mover banks its own capture (the restore is gone)', C, '  next.reserve[mover] = { ...state.reserve[mover] };\n  return { state: next, banked };', '  return { state: next, banked };'],
    ['partner: the restored reserve is the input\'s own object (aliasing)', C, 'next.reserve[mover] = { ...state.reserve[mover] };', 'next.reserve[mover] = state.reserve[mover];'],
    ['partner: the OPPONENT\'s reserve is reset instead of the mover\'s', C, "next.reserve[mover] = { ...state.reserve[mover] };", "next.reserve[mover === 'w' ? 'b' : 'w'] = { ...state.reserve[mover === 'w' ? 'b' : 'w'] };"],
    ['partner: the opponent is the mover', C, 'const next = applyCrazyhouseMove(state, mover, move);\n  next.reserve[mover]', "const next = applyCrazyhouseMove(state, mover === 'w' ? 'b' : 'w', move);\n  next.reserve[mover]"],
    ['partner: nothing is reported as banked', C, '  return { state: next, banked };', '  return { state: next, banked: null };'],
    ['partner: a pawn is always reported', C, '  return { state: next, banked };', "  return { state: next, banked: banked ? 'p' : null };"],
    ['partner: the banked piece is computed after the marks moved (the capturer\'s own mark)', C, 'const banked = crazyhouseBankedPiece(state, move);\n  const next', 'const banked = crazyhouseBankedPiece(applyCrazyhouseMove(state, mover, move), move);\n  const next'],
    // crazyhouseDropCouldAnswerCheck
    ['answer: not in check counts as answerable', C, 'crazyhouseCheckInfo(kingSquare, color, pieceAt).blockSquares.length > 0;', 'crazyhouseCheckInfo(kingSquare, color, pieceAt).blockSquares.length >= 0;'],
    ['answer: needs two squares', C, 'crazyhouseCheckInfo(kingSquare, color, pieceAt).blockSquares.length > 0;', 'crazyhouseCheckInfo(kingSquare, color, pieceAt).blockSquares.length > 1;'],
    ['answer: any single check counts (an adjacent slider, a knight)', C, 'return crazyhouseCheckInfo(kingSquare, color, pieceAt).blockSquares.length > 0;', 'return crazyhouseCheckInfo(kingSquare, color, pieceAt).checkers === 1;'],
    ['answer: any check counts (a double check)', C, 'return crazyhouseCheckInfo(kingSquare, color, pieceAt).blockSquares.length > 0;', 'return crazyhouseCheckInfo(kingSquare, color, pieceAt).checkers > 0;'],
    ['answer: the other colour\'s king is examined', C, 'return crazyhouseCheckInfo(kingSquare, color, pieceAt).blockSquares.length > 0;', "return crazyhouseCheckInfo(kingSquare, color === 'w' ? 'b' : 'w', pieceAt).blockSquares.length > 0;"],
    ['answer: never', C, 'return crazyhouseCheckInfo(kingSquare, color, pieceAt).blockSquares.length > 0;', 'return false;'],
  ],
};
