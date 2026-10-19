import { describe, expect, it } from 'vitest';
import {
  BISHOP,
  CAPTURE_POINTS,
  CHATURAJI_OPTIONS,
  CHATURAJI_RULES,
  FFA_RULES,
  FLAG_PROMOTION,
  GEOMETRIES,
  GIVEAWAY_RULES,
  KING,
  KNIGHT,
  KNOWN_RULES,
  PAWN,
  QUEEN,
  ROOK,
  SQUARE8,
  SQUARE8_START,
  activeSeats,
  currentMoves,
  deserialize,
  describeEvents,
  findLegalMove,
  initialState,
  isInCheck,
  kingsAttackedBy,
  legalMoves,
  listPieces,
  moveLabelOn,
  optionsOf,
  playMove,
  promotionOf,
  pseudoMoves,
  resign,
  rulesFor,
  seatOf,
  serialize,
  stateFromPieces,
  typeOf,
  validateRules,
  variantOfRules,
  type FourPlayerState,
  type GameEvent,
  type PositionOptions,
  type Seat,
} from '../fourPlayer';
import { mulberry32 } from './fourPlayerGoldenKit';

/**
 * CHATURAJI W1 - the rules (CHATURAJI_SPEC.md sections 3-4), pinned by HAND-BUILT positions where each rule is the whole point (the kings are parked
 * in the corners and the squares chosen so that nothing else can interfere), then by property tests over seeded random games.
 *
 * Squares are on the 8 x 8 board; Red moves up the ranks from the bottom, Blue to higher files from the left, Yellow down from the top, Green to
 * lower files from the right; clockwise order Red -> Blue -> Yellow -> Green. A boat is a rook (type ROOK); a pawn promotes on its far edge.
 */
const RED: Seat = 0;
const BLUE: Seat = 1;
const YELLOW: Seat = 2;
const GREEN: Seat = 3;
const first = () => 0;
const sq = (name: string): number => SQUARE8.parseSquare(name);
const KINGS = ['rK@a1', 'bK@a8', 'yK@h8', 'gK@h1']; // the four corners

/** A Chaturaji position from pieces (see stateFromPieces). */
const cp = (pieces: string[], options: PositionOptions = {}): FourPlayerState => stateFromPieces(pieces, { rules: CHATURAJI_RULES, ...options });
const lab = (state: FourPlayerState, move: { from: number; to: number; captured: number; flags: number }) => moveLabelOn(move, SQUARE8);
const labels = (state: FourPlayerState, seat: Seat = state.turn) => legalMoves(state, seat).map((m) => lab(state, m)).sort();
const movesFrom = (state: FourPlayerState, from: string, seat: Seat = state.turn) => legalMoves(state, seat).filter((m) => m.from === sq(from)).map((m) => lab(state, m)).sort();
const play = (state: FourPlayerState, from: string, to: string, promotion: number = ROOK) => {
  const move = findLegalMove(state, state.turn, sq(from), sq(to), promotion);
  if (!move) throw new Error(`not legal: ${from}-${to}`);
  return playMove(state, move, first);
};
const kinds = (events: readonly GameEvent[]) => events.map((e) => e.kind);

describe('the preset, the board and the start position', () => {
  it('CHATURAJI_RULES is the third known preset: 4 Player Chess machinery on the square8 board with Capture the King', () => {
    expect(KNOWN_RULES).toContain(CHATURAJI_RULES);
    expect(rulesFor('chaturaji')).toBe(CHATURAJI_RULES);
    expect(variantOfRules(CHATURAJI_RULES)).toBe('chaturaji');
    expect(variantOfRules(FFA_RULES)).toBe('ffa');
    expect(variantOfRules(GIVEAWAY_RULES)).toBe('giveaway');
    expect(CHATURAJI_RULES.mode).toBe('ffa');
    expect(CHATURAJI_RULES).toMatchObject({ promotionCoord: 7, checkmatePoints: 0, stalematedPoints: 0, stalemateOthersPoints: 0, maxPlies: 1000 });
    expect(optionsOf(CHATURAJI_RULES)).toBe(CHATURAJI_OPTIONS);
    expect(CHATURAJI_OPTIONS).toEqual({
      board: 'square8',
      pawnDoubleStep: false,
      castling: false,
      promotionTypes: [ROOK],
      captureTheKing: true,
      kingPoints: 3,
      forkPoints: { double: 1, triple: 5 },
      deadPositionEnds: false,
      lastStandingKingBonus: 3,
    });
    expect(GEOMETRIES.square8).toBe(SQUARE8);
  });

  it('the board is 8 x 8 with all 64 squares playable', () => {
    expect(SQUARE8.size).toBe(8);
    expect(SQUARE8.cells).toBe(64);
    expect(SQUARE8.playableSquares).toHaveLength(64);
    expect(sq('a1')).toBe(0);
    expect(sq('h8')).toBe(63);
    expect(SQUARE8.parseSquare('i1')).toBe(-1);
    expect(SQUARE8.parseSquare('a9')).toBe(-1);
  });

  it('the start position is the rotationally symmetric one of the live game: 32 pieces, four armies in four corners', () => {
    const state = initialState(CHATURAJI_RULES);
    expect(state.cells).toHaveLength(64);
    expect(listPieces(state)).toHaveLength(32);
    expect(listPieces(state).sort()).toEqual([...SQUARE8_START].sort());
    expect(state.turn).toBe(RED);
    expect(state.status).toEqual(['active', 'active', 'active', 'active']);
    expect(state.score).toEqual([0, 0, 0, 0]);
    expect(state.castling).toBe(0);
    expect(state.ep).toBeNull();
    expect(state.kings).toEqual([sq('d1'), sq('a5'), sq('e8'), sq('h4')]);
    const piecesOf = (seat: Seat) => listPieces(state).filter((p) => 'rbyg'[seat] === p[0]).sort();
    expect(piecesOf(RED)).toEqual(['rB@c1', 'rK@d1', 'rN@b1', 'rP@a2', 'rP@b2', 'rP@c2', 'rP@d2', 'rR@a1']);
    expect(piecesOf(BLUE)).toEqual(['bB@a6', 'bK@a5', 'bN@a7', 'bP@b5', 'bP@b6', 'bP@b7', 'bP@b8', 'bR@a8']);
    expect(piecesOf(YELLOW)).toEqual(['yB@f8', 'yK@e8', 'yN@g8', 'yP@e7', 'yP@f7', 'yP@g7', 'yP@h7', 'yR@h8']);
    expect(piecesOf(GREEN)).toEqual(['gB@h3', 'gK@h4', 'gN@h2', 'gP@g1', 'gP@g2', 'gP@g3', 'gP@g4', 'gR@h1']);
  });

  it('every army is the previous one turned a quarter turn clockwise (a1 -> a8 -> h8 -> h1)', () => {
    const turn = ([file, rank]: [number, number]): [number, number] => [rank, 7 - file];
    for (let seat = 0; seat < 3; seat++) {
      const here = SQUARE8_START.filter((p) => p[0] === 'rbyg'[seat]);
      const next = SQUARE8_START.filter((p) => p[0] === 'rbyg'[seat + 1]);
      const turned = here.map((p) => {
        const [f, r] = turn([SQUARE8.fileOf(sq(p.slice(3))), SQUARE8.rankOf(sq(p.slice(3)))]);
        return `${'rbyg'[seat + 1]}${p[1]}@${SQUARE8.squareName(SQUARE8.index(f, r))}`;
      });
      expect(turned.sort()).toEqual(next.sort());
    }
  });

  it('every seat has exactly 8 legal opening moves (4 pawn steps, 2 knight jumps, 2 king steps); Red\'s are listed in full (worked example 1)', () => {
    const state = initialState(CHATURAJI_RULES);
    for (const seat of [0, 1, 2, 3] as Seat[]) expect(legalMoves(state, seat)).toHaveLength(8);
    expect(labels(state, RED)).toEqual(['a2-a3', 'b1-a3', 'b1-c3', 'b2-b3', 'c2-c3', 'd1-e1', 'd1-e2', 'd2-d3']);
    expect(labels(state, BLUE)).toEqual(['a5-b4', 'a5-a4', 'a7-c6', 'a7-c8', 'b5-c5', 'b6-c6', 'b7-c7', 'b8-c8'].sort());
    expect(labels(state, YELLOW)).toEqual(['e7-e6', 'e8-d7', 'e8-d8', 'f7-f6', 'g7-g6', 'g8-f6', 'g8-h6', 'h7-h6'].sort());
    expect(labels(state, GREEN)).toEqual(['g1-f1', 'g2-f2', 'g3-f3', 'g4-f4', 'h2-f1', 'h2-f3', 'h4-h5', 'h4-g5'].sort());
  });

  it('the snapshot text has 8 rows of 8 two-character cells, round-trips exactly, and is pinned', () => {
    const state = initialState(CHATURAJI_RULES);
    const text = serialize(state);
    expect(text).toBe('bRbP....yKyByNyR/bNbP....yPyPyPyP/bBbP............/bKbP............/............gPgK/............gPgB/rPrPrPrP....gPgN/rRrNrBrK....gPgR 0 aaaa 0,0,0,0 0 - 0 -');
    expect(deserialize(text, CHATURAJI_RULES)).toEqual(state);
  });
});

describe('pawns: one step, a diagonal capture, no double step and no en passant', () => {
  it('each seat steps one square in its own forward direction and nowhere else (Red up, Blue right, Yellow down, Green left)', () => {
    const state = cp([...KINGS, 'rP@c3', 'bP@c5', 'yP@e6', 'gP@f4']);
    expect(movesFrom(state, 'c3', RED)).toEqual(['c3-c4']);
    expect(movesFrom(state, 'c5', BLUE)).toEqual(['c5-d5']);
    expect(movesFrom(state, 'e6', YELLOW)).toEqual(['e6-e5']);
    expect(movesFrom(state, 'f4', GREEN)).toEqual(['f4-e4']);
  });

  it('there is NO double step, from any starting line, for any seat - and so nothing to take en passant', () => {
    const state = initialState(CHATURAJI_RULES);
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      const pawnMoves = legalMoves(state, seat).filter((m) => typeOf(state.cells[m.from]) === PAWN);
      expect(pawnMoves).toHaveLength(4);
      for (const m of pawnMoves) expect(Math.abs(SQUARE8.fileOf(m.to) - SQUARE8.fileOf(m.from)) + Math.abs(SQUARE8.rankOf(m.to) - SQUARE8.rankOf(m.from))).toBe(1);
    }
    let after = play(state, 'd2', 'd3').state;
    expect(after.ep).toBeNull();
    after = play(after, 'b5', 'c5').state;
    expect(after.ep).toBeNull();
  });

  it('a pawn captures one square diagonally forward and never straight ahead; it is blocked by anything in front of it', () => {
    const state = cp([...KINGS, 'rP@c3', 'bN@b4', 'yN@d4', 'gN@c4']);
    expect(movesFrom(state, 'c3', RED)).toEqual(['c3xb4', 'c3xd4']); // the knight on c4 blocks the push and cannot be taken straight ahead
    const sideways = cp([...KINGS, 'rP@c3', 'bN@b3', 'yN@d3']);
    expect(movesFrom(sideways, 'c3', RED)).toEqual(['c3-c4']); // pieces beside it are not targets
  });

  it('a pawn can capture a king, and a dead piece, like any other target', () => {
    const state = cp([...KINGS.filter((k) => k !== 'bK@a8'), 'rP@c3', 'bK@d4', 'yP@b4'], { status: ['active', 'active', 'frozen', 'active'] });
    expect(movesFrom(state, 'c3', RED)).toEqual(['c3-c4', 'c3xb4', 'c3xd4']);
  });
});

describe('promotion: a boat on the far edge, nothing else', () => {
  it('a Red pawn reaching rank 8 becomes a boat: exactly one promotion move per square, and the piece is a promoted rook', () => {
    const state = cp([...KINGS.filter((k) => k !== 'bK@a8' && k !== 'yK@h8'), 'bK@a5', 'yK@h5', 'rP@c7']);
    const moves = legalMoves(state, RED).filter((m) => m.from === sq('c7'));
    expect(moves.map((m) => lab(state, m))).toEqual(['c7-c8=R']);
    expect(moves.every((m) => m.flags & FLAG_PROMOTION)).toBe(true);
    expect(promotionOf(moves[0])).toBe(ROOK);
    expect(listPieces(play(state, 'c7', 'c8').state)).toContain('rT@c8'); // T = a promoted rook
    expect(findLegalMove(state, RED, sq('c7'), sq('c8'), QUEEN)).toBeNull(); // no queen, bishop or knight choice
    expect(findLegalMove(state, RED, sq('c7'), sq('c8'), KNIGHT)).toBeNull();
  });

  it('promoting BY CAPTURE is also a boat, and it scores the capture', () => {
    const state = cp([...KINGS, 'rP@c7', 'bN@b8', 'yP@d8']);
    expect(movesFrom(state, 'c7', RED)).toEqual(['c7-c8=R', 'c7xb8=R', 'c7xd8=R']);
    const taken = play(state, 'c7', 'b8');
    expect(taken.state.score[RED]).toBe(3); // the knight
    expect(listPieces(taken.state)).toContain('rT@b8');
  });

  it('every seat promotes on ITS far edge: Blue on file h, Yellow on rank 1, Green on file a', () => {
    const blue = cp([...KINGS, 'bP@g5'], { turn: BLUE });
    expect(movesFrom(blue, 'g5', BLUE)).toEqual(['g5-h5=R']);
    const yellow = cp([...KINGS, 'yP@c2'], { turn: YELLOW });
    expect(movesFrom(yellow, 'c2', YELLOW)).toEqual(['c2-c1=R']);
    const green = cp([...KINGS, 'gP@b6'], { turn: GREEN });
    expect(movesFrom(green, 'b6', GREEN)).toEqual(['b6-a6=R']);
  });

  it('a pawn one step short of the edge only moves; a promoted boat then moves like a rook and is worth 5 when captured', () => {
    const state = cp([...KINGS, 'rT@d4', 'bR@d8']); // Red's promoted boat on d4; Blue's rook on d8
    expect(movesFrom(state, 'd4', RED)).toContain('d4xd8'); // moves along the file like a rook
    expect(CAPTURE_POINTS[typeOf(state.cells[sq('d4')])]).toBe(5);
    const blueToMove = cp([...KINGS, 'rT@d4', 'bR@d8'], { turn: BLUE });
    expect(play(blueToMove, 'd8', 'd4').state.score[BLUE]).toBe(5); // a promoted boat is worth 5, same as an original one
  });
});

describe('the pieces move as in chess (the boat as a rook)', () => {
  it('boat, bishop, knight and king move sets, blocked by pieces of any army, with no castling', () => {
    const state = cp([...KINGS, 'rR@d4', 'rB@e5', 'rN@b2', 'rP@d6', 'bP@d2', 'yP@g5']);
    // boat on d4: up to d5 (d6 is its own pawn), down to d3 and the capture on d2 (a Blue pawn), the whole rank
    expect(movesFrom(state, 'd4', RED)).toEqual(['d4-a4', 'd4-b4', 'd4-c4', 'd4-d3', 'd4-d5', 'd4-e4', 'd4-f4', 'd4-g4', 'd4-h4', 'd4xd2']);
    // bishop on e5: the diagonals (d6 and d4 are its own pieces), and it can take Yellow's king on h8 along e5-f6-g7-h8
    expect(movesFrom(state, 'e5', RED)).toEqual(['e5-f4', 'e5-f6', 'e5-g3', 'e5-g7', 'e5-h2', 'e5xh8']);
    expect(movesFrom(state, 'b2', RED)).toEqual(['b2-a4', 'b2-c4', 'b2-d1', 'b2-d3']);
    expect(movesFrom(initialState(CHATURAJI_RULES), 'a1', RED)).toEqual([]); // the boat at the start is boxed in
    const castleLike = cp(['rK@d1', 'rR@a1', 'bK@a8', 'yK@h8', 'gK@h1']); // king and boat on their start squares with a clear path: nothing like castling exists
    expect(legalMoves(castleLike, RED).some((m) => m.flags & 8)).toBe(false);
    expect(castleLike.castling).toBe(0);
  });
});

describe('Capture the King: a check is never answered, only a king capture eliminates', () => {
  it('there is no king safety: a king may step into an attack, a "pinned" piece may move, and a king in check may do anything', () => {
    const state = cp(['rK@d1', 'rN@d2', 'bR@d8', 'bK@a8', 'yK@h8', 'gK@h1']); // Blue's rook attacks Red's king through the knight
    expect(isInCheck(state, RED)).toBe(false); // the knight blocks - and it may move away anyway
    expect(movesFrom(state, 'd2', RED)).toContain('d2-b3'); // a "pinned" knight moves (4 Player Chess would forbid it)
    const attacked = cp(['rK@d1', 'bR@d8', 'bK@a8', 'yK@h8', 'gK@h1', 'rP@a2']);
    expect(isInCheck(attacked, RED)).toBe(true);
    expect(movesFrom(attacked, 'a2', RED)).toEqual(['a2-a3']); // ignoring the check
    expect(movesFrom(attacked, 'd1', RED)).toContain('d1-d2'); // the king may also stay on the attacked file
    expect(legalMoves(attacked, RED)).toHaveLength(pseudoMoves(attacked, RED).length); // legal = pseudo-legal
  });

  it('capturing a king: +3 once, the victim is eliminated at once (kingCaptured), its army turns inactive and stays on the board (worked example 3)', () => {
    const state = cp(['rK@a1', 'rR@d4', 'bK@d8', 'bN@b6', 'bP@c5', 'yK@h8', 'gK@h1']);
    expect(movesFrom(state, 'd4', RED)).toContain('d4xd8');
    const out = play(state, 'd4', 'd8');
    expect(out.state.score).toEqual([3, 0, 0, 0]); // the king, once
    expect(out.state.status).toEqual(['active', 'frozen', 'active', 'active']);
    expect(out.state.kings[BLUE]).toBe(-1);
    expect(listPieces(out.state)).toEqual(expect.arrayContaining(['bN@b6', 'bP@c5'])); // the rest of the army stays, inactive
    expect(out.events).toEqual([
      { kind: 'move', seat: RED, move: expect.objectContaining({ from: sq('d4'), to: sq('d8') }) },
      { kind: 'eliminated', seat: BLUE, reason: 'kingCaptured', credit: RED, points: [0, 0, 0, 0] },
    ]);
    expect(out.state.turn).toBe(YELLOW); // Blue is skipped
    expect(out.state.result).toBeNull();
    expect(describeEvents(out.events)).toEqual(["Blue's king was captured by Red"]);
  });

  it('ignoring a check is legal, and costs the king: Red (in check) plays a pawn move, and Blue takes its king', () => {
    const state = cp(['rK@d1', 'rP@a2', 'bR@d6', 'bK@a8', 'yK@h8', 'gK@h1']);
    expect(isInCheck(state, RED)).toBe(true);
    const ignored = play(state, 'a2', 'a3'); // a move that does nothing about the check
    expect(kinds(ignored.events)).toEqual(['move']);
    const taken = play(ignored.state, 'd6', 'd1'); // Blue's turn: the king is simply captured
    expect(taken.state.score[BLUE]).toBe(3);
    expect(taken.state.status[RED]).toBe('frozen');
    expect(taken.events[1]).toMatchObject({ kind: 'eliminated', seat: RED, reason: 'kingCaptured', credit: BLUE });
  });

  it('inactive pieces are capturable for 0 points, block lines, and never attack', () => {
    const state = cp([...KINGS, 'rR@d4', 'bP@d6', 'bN@f4'], { status: ['active', 'frozen', 'active', 'active'] });
    const taken = play(state, 'd4', 'd6');
    expect(taken.state.score[RED]).toBe(0); // a dead pawn
    const blocked = cp([...KINGS, 'rR@d4', 'bP@d6', 'yR@d8'], { status: ['active', 'frozen', 'active', 'active'], turn: YELLOW });
    expect(movesFrom(blocked, 'd8', YELLOW)).toContain('d8xd6'); // the dead pawn is the first piece on the file: the yellow boat reaches it...
    expect(movesFrom(blocked, 'd8', YELLOW)).not.toContain('d8xd4'); // ...and not past it
    expect(isInCheck(cp(['rK@d1', 'bR@d8', 'bK@a8', 'yK@h8', 'gK@h1'], { status: ['active', 'frozen', 'active', 'active'] }), RED)).toBe(false); // a dead rook attacks nobody
  });

  it('the points of a capture are the piece values (pawn 1, knight 3, bishop 5, boat 5) and scoring is the mover\'s', () => {
    const prices: [string, number][] = [['bP', 1], ['bN', 3], ['bB', 5], ['bR', 5]];
    for (const [piece, value] of prices) {
      const state = cp([...KINGS, 'rR@d4', `${piece}@d6`]);
      expect(play(state, 'd4', 'd6').state.score).toEqual([value, 0, 0, 0]);
    }
  });
});

describe('check forks: +1 for two kings, +5 for three, by the piece that moved', () => {
  it('a knight landing on e4 attacks the kings on d6 and f6: +1 to its owner, one fork event', () => {
    const state = cp(['rK@a1', 'rN@c5', 'bK@d6', 'yK@f6', 'gK@h1']);
    const out = play(state, 'c5', 'e4');
    expect(out.state.score[RED]).toBe(1);
    expect(out.events.find((e) => e.kind === 'fork')).toEqual({ kind: 'fork', seat: RED, kings: 2, points: 1 });
    expect(describeEvents(out.events)).toEqual(['Red attacks 2 kings at once (+1)']);
  });

  it('three kings: +5', () => {
    const state = cp(['rK@a1', 'rN@c5', 'bK@d6', 'yK@f6', 'gK@g3']);
    const out = play(state, 'c5', 'e4');
    expect(out.state.score[RED]).toBe(5);
    expect(out.events.find((e) => e.kind === 'fork')).toMatchObject({ kings: 3, points: 5 });
  });

  it('one attacked king is no fork, and a fork scores nothing for a piece that does not attack both kings', () => {
    const one = cp(['rK@a1', 'rN@c5', 'bK@d6', 'yK@h8', 'gK@h1']);
    expect(play(one, 'c5', 'e4').state.score[RED]).toBe(0);
    expect(kingsAttackedBy(play(one, 'c5', 'e4').state, sq('e4'))).toBe(1);
  });

  it('a pawn forks two kings on its forward diagonals; a boat forks along a rank; a bishop along two diagonals', () => {
    const pawn = cp(['rK@a1', 'rP@e3', 'bK@d5', 'yK@f5', 'gK@h1']);
    expect(play(pawn, 'e3', 'e4').state.score[RED]).toBe(1);
    const boat = cp(['rK@a1', 'rR@d2', 'bK@a4', 'yK@h4', 'gK@h1']);
    expect(play(boat, 'd2', 'd4').state.score[RED]).toBe(1);
    const bishop = cp(['rK@a1', 'rB@b2', 'bK@a5', 'yK@e5', 'gK@h1']);
    expect(play(bishop, 'b2', 'c3').state.score[RED]).toBe(1);
  });

  it('a blocker between the piece and a king means no attack, and no points (a ray is stopped by the first piece, whoever owns it)', () => {
    const boat = cp(['rK@a1', 'rR@d2', 'bK@a4', 'yK@h4', 'gK@h1', 'gP@f4']);
    expect(play(boat, 'd2', 'd4').state.score[RED]).toBe(0);
    const dead = cp(['rK@a1', 'rR@d2', 'bK@a4', 'yK@h4', 'gK@h1', 'bP@b4']);
    expect(play(dead, 'd2', 'd4').state.score[RED]).toBe(0);
  });

  it('a discovered attack is not a fork: only the piece that moved counts (the boat behind the knight sees two kings once it moves away; the knight sees one)', () => {
    const state = cp(['rK@a1', 'rR@d4', 'rN@e4', 'bK@a4', 'yK@g4', 'gK@h1']);
    const out = play(state, 'e4', 'c5'); // the knight leaves the rank: the boat now attacks Blue's king on a4 and Yellow's on g4, and the knight attacks a4
    expect(kingsAttackedBy(out.state, sq('d4'))).toBe(2); // the boat DOES attack two kings now...
    expect(out.state.score[RED]).toBe(0); // ...but it is not the piece that moved, so there is no fork
    expect(out.events.some((e) => e.kind === 'fork')).toBe(false);
  });

  it('kings that do not count: a resigned seat\'s walking king and an eliminated seat\'s king (and never the mover\'s own)', () => {
    const state = cp(['rK@a1', 'rN@c5', 'bK@d6', 'yK@f6', 'gK@h1'], { status: ['active', 'dead-king', 'active', 'active'] }); // Blue resigned: its king walks
    expect(play(state, 'c5', 'e4').state.score[RED]).toBe(0); // only Yellow's king is a live enemy king
    const dead = cp(['rK@a1', 'rN@c5', 'bK@d6', 'yK@f6', 'gK@h1'], { status: ['active', 'frozen', 'active', 'active'] });
    expect(play(dead, 'c5', 'e4').state.score[RED]).toBe(0);
    const own = cp(['rK@b2', 'rN@c5', 'bK@h8', 'yK@a8', 'gK@h1']); // d3 attacks b2: Red's own king
    expect(kingsAttackedBy(play(own, 'c5', 'd3').state, sq('d3'))).toBe(0);
  });

  it('forks are scored before a king capture can end the game, so the final scores include them', () => {
    // Red's knight takes Blue's king from c5? Blue's king on d7 and attacks... build: Red knight e5xd7 captures Blue king and attacks Yellow king f6 and Green king b6.
    const state = cp(['rK@a1', 'rN@e5', 'bK@d7', 'yK@f6', 'gK@b6'], { status: ['active', 'active', 'active', 'active'] });
    const out = play(state, 'e5', 'd7');
    // the knight on d7 attacks b6, b8, c5, e5, f6, f8: Green's b6 and Yellow's f6 -> a fork of two (+1), plus the king capture (+3)
    expect(out.state.score[RED]).toBe(4);
    expect(kinds(out.events)).toEqual(['move', 'fork', 'eliminated']);
  });
});

describe('no legal move: eliminated, with no points', () => {
  /** Blue walled in by its own pieces: a king on a8 and pawns filling ranks 7 and 8, so that nothing it owns can move or capture. */
  const walledBlue = (): string[] => {
    const pieces = ['bK@a8', ...'abcdefgh'.split('').map((f) => `bP@${f}7`), ...'bcdefgh'.split('').map((f) => `bP@${f}8`)];
    return [...pieces, 'rK@a1', 'yK@e4', 'gK@h1'];
  };

  it('Blue has no move at all, and the turn reaching it eliminates it with zero points for everyone (worked example 8 prelude)', () => {
    const state = cp(walledBlue(), { turn: RED });
    expect(legalMoves(state, BLUE)).toEqual([]);
    const out = play(state, 'a1', 'b1');
    expect(kinds(out.events)).toEqual(['move', 'eliminated']);
    expect(out.events[1]).toEqual({ kind: 'eliminated', seat: BLUE, reason: 'stalemate', credit: null, points: [0, 0, 0, 0] });
    expect(out.state.score).toEqual([0, 0, 0, 0]);
    expect(out.state.status[BLUE]).toBe('dead-king'); // the army is inactive; the (boxed in) king stays where it is
    expect(out.state.turn).toBe(YELLOW);
    expect(describeEvents(out.events)).toEqual(['Blue had no legal move and is out']);
  });

  it('a seat that merely has a move is not eliminated, even if every move is bad: nothing is "checkmate" here', () => {
    const state = cp(['bK@a8', 'rR@a1', 'rR@b1', 'yK@h8', 'gK@h1', 'rK@h5'], { turn: RED });
    const out = play(state, 'h5', 'h4');
    expect(out.events.some((e) => e.kind === 'eliminated')).toBe(false);
  });
});

describe('resign and timeout: the army turns inactive and the king keeps walking, capturable for 3', () => {
  it('a resigned seat becomes dead-king (its king walks), its pieces are inactive, nobody scores', () => {
    const state = cp([...KINGS, 'gP@g3', 'gN@h2']);
    const out = resign(state, GREEN, first, 'resign');
    expect(out.state.status).toEqual(['active', 'active', 'active', 'dead-king']);
    expect(out.events.map((e) => e.kind)).toEqual(['eliminated']);
    expect(out.events[0]).toMatchObject({ seat: GREEN, reason: 'resign', credit: null, points: [0, 0, 0, 0] });
    expect(out.state.score).toEqual([0, 0, 0, 0]);
    expect(pseudoMoves(out.state, GREEN).every((m) => out.state.cells[m.from] === out.state.cells[sq('h1')])).toBe(true); // only the king can move
  });

  it('the walking king steps onto an EMPTY neighbouring square when its turn comes round (the engine plays it, the rng picks the step)', () => {
    const state = cp(['rK@a1', 'bK@a8', 'yK@h8', 'gK@d4', 'rP@d5'], { status: ['active', 'active', 'active', 'dead-king'], turn: YELLOW });
    const out = play(state, 'h8', 'h7'); // Yellow moves; Green is next and its king walks
    expect(kinds(out.events)).toEqual(['move', 'deadKingMove']);
    const walked = out.events[1] as { kind: 'deadKingMove'; move: { from: number; to: number; captured: number } };
    expect(walked.move.from).toBe(sq('d4'));
    expect(SQUARE8.kingTargets[sq('d4')]).toContain(walked.move.to);
    expect(walked.move.captured).toBe(0); // it never captures while walking, so d5 (a Red pawn) is not a destination
    expect(walked.move.to).not.toBe(sq('d5'));
    expect(out.state.turn).toBe(RED);
  });

  it('capturing the walking king scores 3 and stops it (the seat is frozen, no elimination event: it already was)', () => {
    const state = cp(['rK@a1', 'rR@d1', 'bK@a8', 'yK@h8', 'gK@d4'], { status: ['active', 'active', 'active', 'dead-king'], turn: RED });
    const out = play(state, 'd1', 'd4');
    expect(out.state.score[RED]).toBe(3);
    expect(out.state.status[GREEN]).toBe('frozen');
    expect(out.state.kings[GREEN]).toBe(-1);
    expect(kinds(out.events)).toEqual(['move', 'frozen']);
  });

  it('the dead army around a walking king scores 0 when captured', () => {
    const state = cp(['rK@a1', 'rR@g1', 'bK@a8', 'yK@h8', 'gK@d4', 'gP@g3'], { status: ['active', 'active', 'active', 'dead-king'], turn: RED });
    expect(play(state, 'g1', 'g3').state.score[RED]).toBe(0);
  });
});

describe('the end of the game', () => {
  it('three seats eliminated end the game; the HIGHEST SCORE wins - not necessarily the survivor', () => {
    const state = cp(['rK@a1', 'rR@d4', 'gK@d8'], { status: ['active', 'frozen', 'frozen', 'active'], score: [0, 0, 20, 0] });
    const out = play(state, 'd4', 'd8'); // Red takes Green's king: only Red is left
    expect(out.state.score[RED]).toBe(3);
    expect(out.state.result).toEqual({ winners: [YELLOW], reason: 'elimination' });
    expect(kinds(out.events)).toEqual(['move', 'eliminated', 'gameOver']);
    expect(activeSeats(out.state)).toEqual([RED]);
    expect(currentMoves(out.state)).toEqual([]);
  });

  it('a tie for the most points is a shared win', () => {
    const state = cp(['rK@a1', 'rR@d4', 'gK@d8'], { status: ['active', 'frozen', 'frozen', 'active'], score: [0, 0, 3, 0] });
    const out = play(state, 'd4', 'd8');
    expect(out.state.result).toEqual({ winners: [RED, YELLOW], reason: 'elimination' });
  });

  it('the last seat gets +3 for every other king still on the board (a resigned seat\'s walking king), and nothing for captured ones', () => {
    // Blue and Yellow resigned (their kings walk on a8 / h8), Green's king is taken by Red: Red scores 3 (king) + 2 x 3 (the two walking kings)
    const state = cp(['rK@a1', 'rR@d4', 'gK@d8', 'bK@a8', 'yK@h8'], { status: ['active', 'dead-king', 'dead-king', 'active'] });
    const out = play(state, 'd4', 'd8');
    expect(out.state.score[RED]).toBe(3 + 6);
    expect(out.state.result).toEqual({ winners: [RED], reason: 'elimination' });
    // with only captured kings left behind there is no bonus
    const captured = cp(['rK@a1', 'rR@d4', 'gK@d8'], { status: ['active', 'frozen', 'frozen', 'active'] });
    expect(play(captured, 'd4', 'd8').state.score[RED]).toBe(3);
  });

  it('a seat eliminated by resignation off-turn can end the game too: the survivor is paid for the king that walks on', () => {
    const state = cp(['rK@a1', 'bK@a8', 'gK@h1'], { status: ['active', 'dead-king', 'frozen', 'active'] }); // Yellow's king was captured earlier
    const out = resign(state, GREEN, first, 'timeout');
    expect(out.state.result).toEqual({ winners: [RED], reason: 'elimination' });
    expect(out.state.score[RED]).toBe(6); // Blue's and Green's kings are still on the board (both walking): 2 x 3
  });

  it('the last-standing bonus belongs to an END BY ELIMINATION only: the ply cap with a single active seat left pays nothing', () => {
    // Three seats resigned (their kings walk), one active seat, and the cap lands on its move: the game is decided on the scores as they stand.
    const state = cp(['rK@a1', 'rP@c3', 'bK@a8', 'yK@h8', 'gK@h1'], { status: ['active', 'dead-king', 'dead-king', 'dead-king'], ply: 4, rules: { ...CHATURAJI_RULES, maxPlies: 5 }, score: [2, 7, 1, 7] });
    const out = play(state, 'c3', 'c4');
    expect(out.state.result).toEqual({ winners: [BLUE, GREEN], reason: 'cap' });
    expect(out.state.score).toEqual([2, 7, 1, 7]); // no +9 for Red's three surviving enemy kings
  });

  it('the ply cap ends the game and the highest score wins; and no "bare kings" ending exists (kings can capture kings)', () => {
    const capped = cp([...KINGS, 'rP@c3'], { ply: 4, rules: { ...CHATURAJI_RULES, maxPlies: 5 }, score: [2, 7, 1, 7] });
    const out = play(capped, 'c3', 'c4');
    expect(out.state.result).toEqual({ winners: [BLUE, GREEN], reason: 'cap' });
    let state = cp([...KINGS], { turn: RED });
    for (let i = 0; i < 30; i++) {
      const moves = legalMoves(state, state.turn);
      state = playMove(state, moves[0], first).state;
      if (state.result) break;
    }
    expect(state.result?.reason ?? 'none').not.toBe('deadPosition');
  });

  it('a resigned seat is never asked to move: the engine walks its king itself and the turn lands on the next seat', () => {
    const resigned = resign(cp(KINGS, { turn: RED }), YELLOW, first, 'timeout').state;
    const afterRed = playMove(resigned, legalMoves(resigned, RED)[0], first);
    expect(afterRed.state.turn).toBe(BLUE);
    const afterBlue = playMove(afterRed.state, legalMoves(afterRed.state, BLUE)[0], first);
    expect(kinds(afterBlue.events)).toEqual(['move', 'deadKingMove']); // Yellow's king stepped
    expect(afterBlue.state.turn).toBe(GREEN);
  });
});

describe('snapshots, validation and the wire', () => {
  it('every ending round-trips through serialize / deserialize with the result intact', () => {
    const state = cp(['rK@a1', 'rR@d4', 'gK@d8', 'bK@a8', 'yK@h8'], { status: ['active', 'dead-king', 'dead-king', 'active'] });
    const ended = play(state, 'd4', 'd8').state;
    expect(deserialize(serialize(ended), CHATURAJI_RULES)).toEqual(ended);
    expect(serialize(ended)).toContain('elimination');
  });

  it('the validator accepts the three presets and nothing else; a tuned Chaturaji is refused', () => {
    expect(validateRules(JSON.parse(JSON.stringify(CHATURAJI_RULES)))).toEqual({ ok: true, rules: CHATURAJI_RULES });
    expect(validateRules({ ...CHATURAJI_RULES, maxPlies: 999 }).ok).toBe(false);
    expect(validateRules({ ...CHATURAJI_RULES, options: { ...CHATURAJI_OPTIONS, kingPoints: 4 } }).ok).toBe(false);
    expect(validateRules({ ...CHATURAJI_RULES, options: { ...CHATURAJI_OPTIONS, captureTheKing: false } }).ok).toBe(false);
    expect(validateRules({ ...FFA_RULES, options: CHATURAJI_OPTIONS }).ok).toBe(false);
    expect(KNOWN_RULES).toHaveLength(3);
  });

  it('4 Player Chess and Giveaway do not know the new options: FFA never captures a king, Giveaway keeps its own end', () => {
    const ffa = stateFromPieces(['rK@h1', 'rR@d4', 'bK@d8', 'yK@g14', 'gK@n7'], { turn: 0 });
    expect(legalMoves(ffa, RED).some((m) => m.captured !== 0 && typeOf(m.captured) === KING)).toBe(false);
    expect(optionsOf(FFA_RULES).captureTheKing).toBe(false);
    expect(optionsOf(GIVEAWAY_RULES).forkPoints).toBeNull();
  });
});

// --- Property tests over seeded random games ---------------------------------------------------------------------------------------------

interface GameLog {
  steps: number;
  plies: number;
  end: string;
  kingCaptures: number;
  forks: number;
  promotions: number;
  stalemates: number;
  walkingKingCaptures: number;
  resigns: number;
}

/** Plays one seeded random game, checking the invariants after EVERY action. Returns what happened (so the test can say it reached the rare things). */
function playChecked(seed: number, maxSteps = 1500): GameLog {
  const rng = mulberry32(seed);
  let state = initialState(CHATURAJI_RULES);
  const shadow = [0, 0, 0, 0]; // an independent tally of the points, from the events and the moves alone
  const log: GameLog = { steps: 0, plies: 0, end: 'none', kingCaptures: 0, forks: 0, promotions: 0, stalemates: 0, walkingKingCaptures: 0, resigns: 0 };
  const everFrozen = new Set<number>();
  for (let step = 0; step < maxSteps && !state.result; step++) {
    log.steps++;
    const before = state;
    let events: GameEvent[];
    const roll = rng();
    if (roll < 0.01) {
      const active = activeSeats(state);
      const who = active[Math.floor(rng() * active.length)];
      const out = resign(state, who, mulberry32(seed * 31 + step), roll < 0.005 ? 'resign' : 'timeout');
      state = out.state;
      events = out.events;
      log.resigns++;
    } else {
      const moves = currentMoves(state);
      expect(moves.length, `seed ${seed} step ${step}: the seat to move has moves`).toBeGreaterThan(0);
      // a bit of bias towards captures so that kings actually fall
      const captures = moves.filter((m) => m.captured !== 0);
      const pick = captures.length > 0 && rng() < 0.5 ? captures[Math.floor(rng() * captures.length)] : moves[Math.floor(rng() * moves.length)];
      expect(findLegalMove(state, state.turn, pick.from, pick.to, ROOK), `seed ${seed} step ${step}: the chosen move is legal`).not.toBeNull();
      // shadow points of the capture, worked out from the position BEFORE the move
      if (pick.captured) {
        const victim = seatOf(pick.captured);
        if (typeOf(pick.captured) === KING) {
          shadow[state.turn] += 3;
          log.kingCaptures++;
          if (state.status[victim] === 'dead-king') log.walkingKingCaptures++;
        } else if (state.status[victim] === 'active') shadow[state.turn] += CAPTURE_POINTS[typeOf(pick.captured)];
      }
      if (pick.flags & FLAG_PROMOTION) log.promotions++;
      const out = playMove(state, pick, mulberry32(seed * 17 + step));
      state = out.state;
      events = out.events;
    }
    for (const event of events) {
      if (event.kind === 'fork') {
        shadow[event.seat] += event.points;
        log.forks++;
        expect([2, 3]).toContain(event.kings);
        expect(event.points).toBe(event.kings === 2 ? 1 : 5);
      }
      if (event.kind === 'eliminated') {
        event.points.forEach((p, i) => (shadow[i] += p));
        if (event.reason === 'stalemate') log.stalemates++;
      }
    }
    log.plies = state.ply;
    // --- invariants after every action
    if (!state.result) expect(state.score, `seed ${seed} step ${step}: scores match an independent tally`).toEqual(shadow);
    expect(state.cells).toHaveLength(64);
    expect(state.castling).toBe(0);
    expect(state.ep).toBeNull();
    for (let seat = 0; seat < 4; seat++) {
      const k = state.kings[seat];
      if (k >= 0) expect(state.cells[k]).toBe(seat * 16 + KING);
      else expect(listPieces(state).some((p) => p.startsWith(`${'rbyg'[seat]}K@`))).toBe(false); // a seat with no king on record has none on the board
      if (state.status[seat] === 'frozen') everFrozen.add(seat);
      else expect(everFrozen.has(seat), `seed ${seed}: a frozen seat never thaws`).toBe(false);
    }
    // no pawn is ever left on its far edge (it promotes) and no seat has more than one king
    for (let sqr = 0; sqr < 64; sqr++) {
      const code = state.cells[sqr];
      if (code > 0 && typeOf(code) === PAWN) expect(SQUARE8.forwardCoord(seatOf(code), sqr), `seed ${seed}: an unpromoted pawn on the far edge`).toBeLessThan(7);
    }
    expect(deserialize(serialize(state), CHATURAJI_RULES)).toEqual(state);
    expect(state.ply).toBeGreaterThanOrEqual(before.ply);
  }
  expect(state.result, `seed ${seed}: the game terminates`).not.toBeNull();
  log.end = state.result!.reason;
  // the final scores: the independent tally plus the last-standing bonus (3 per other king still on the board when one seat is left)
  const last = activeSeats(state);
  if (state.result!.reason === 'elimination' && last.length === 1) {
    shadow[last[0]] += 3 * ([0, 1, 2, 3] as Seat[]).filter((s) => s !== last[0] && state.kings[s] >= 0).length;
  }
  expect(state.score, `seed ${seed}: final scores`).toEqual(shadow);
  const best = Math.max(...shadow);
  expect(state.result!.winners, `seed ${seed}: the winners are the seats with the most points`).toEqual(([0, 1, 2, 3] as Seat[]).filter((s) => shadow[s] === best));
  expect(['elimination', 'cap']).toContain(state.result!.reason);
  return log;
}

describe('property: seeded random games', () => {
  it('60 games: every move is legal, scores always match an independent tally, state invariants hold after every action, and every game terminates', { timeout: 240_000 }, () => {
    const logs: GameLog[] = [];
    for (let seed = 1; seed <= 60; seed++) logs.push(playChecked(seed));
    const total = (key: keyof GameLog) => logs.reduce((n, l) => n + Number(l[key]), 0);
    // eslint-disable-next-line no-console
    console.info('Chaturaji random games:', { games: logs.length, plies: total('plies'), kingCaptures: total('kingCaptures'), forks: total('forks'), promotions: total('promotions'), stalemates: total('stalemates'), walkingKingCaptures: total('walkingKingCaptures'), resigns: total('resigns'), endings: logs.reduce<Record<string, number>>((m, l) => ({ ...m, [l.end]: (m[l.end] ?? 0) + 1 }), {}) });
    // the test is not vacuous: the random games reach the interesting rules
    expect(total('kingCaptures')).toBeGreaterThan(40);
    expect(total('promotions')).toBeGreaterThan(0);
    expect(total('forks')).toBeGreaterThan(0);
    expect(logs.some((l) => l.end === 'elimination')).toBe(true);
  });
});
