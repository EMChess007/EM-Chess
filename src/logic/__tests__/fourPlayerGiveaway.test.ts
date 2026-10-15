import { describe, expect, it } from 'vitest';
import {
  FFA_RULES,
  FLAG_CASTLE,
  FLAG_EN_PASSANT,
  GIVEAWAY_RULES,
  HARD_MAX_PLIES,
  KING,
  KNIGHT,
  QUEEN,
  ROOK,
  BISHOP,
  activeSeats,
  currentMoves,
  deserialize,
  findLegalMove,
  initialState,
  legalMoves,
  listPieces,
  moveLabel,
  parseSquare,
  piecesLeft,
  playMove,
  promotionOf,
  resign,
  rulesFor,
  serialize,
  stateFromPieces,
  type Applied,
  type FourPlayerState,
  type GameEvent,
  type Move,
  type PositionOptions,
  type Seat,
} from '../fourPlayer';
import { mulberry32 } from './fourPlayerGoldenKit';

/**
 * 4 Player Giveaway (4-seat Antichess) - the rules engine (FOUR_PLAYER_GIVEAWAY_SPEC.md sections 4, 5 and 10).
 *
 * Every rule is pinned by a HAND-BUILT position where the rule is the whole point (the squares are chosen so that nothing else can interfere:
 * each seat keeps a parked king far from the action), then a property test plays seeded random games and checks, at EVERY ply, that the game is
 * over if and only if one of the rules says so. The regression guarantee for 4 Player Chess lives in fourPlayerFfaGolden.test.ts.
 *
 * Geometry used below: Red moves up the ranks from the bottom, Blue to higher files from the left, Yellow down the ranks from the top, Green
 * to lower files from the right; clockwise order Red -> Blue -> Yellow -> Green. A pawn promotes on its own 8th line (Red rank 8, Blue file h).
 */

const RED: Seat = 0;
const BLUE: Seat = 1;
const YELLOW: Seat = 2;
const GREEN: Seat = 3;
const first = () => 0;
const KINGS = ['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7']; // parked far from every scenario below

/** A Giveaway position from pieces (see stateFromPieces); castling rights start empty like a real Giveaway game. */
const gp = (pieces: string[], options: PositionOptions = {}): FourPlayerState => stateFromPieces(pieces, { rules: GIVEAWAY_RULES, ...options });
const sq = parseSquare;
const targets = (state: FourPlayerState, from: string, seat: Seat = state.turn): string[] =>
  legalMoves(state, seat)
    .filter((m) => m.from === sq(from))
    .map(moveLabel)
    .sort();
const labels = (moves: Move[]): string[] => moves.map(moveLabel).sort();

/** The current seat plays from -> to (which must be legal). */
function play(state: FourPlayerState, from: string, to: string, promotion?: number): Applied {
  const move = findLegalMove(state, state.turn, sq(from), sq(to), promotion);
  if (!move) throw new Error(`illegal in this position: ${from}-${to} for seat ${state.turn} (legal: ${labels(legalMoves(state, state.turn)).join(' ')})`);
  return playMove(state, move, first);
}
const kinds = (events: GameEvent[]) => events.map((e) => e.kind);

describe('GIVEAWAY_RULES and the start position', () => {
  it('is its own rules object; FFA_RULES is untouched', () => {
    expect(GIVEAWAY_RULES).toEqual({ mode: 'giveaway', promotionCoord: 7, maxPlies: 1000 });
    expect(FFA_RULES).toEqual({ mode: 'ffa', promotionCoord: 7, checkmatePoints: 20, stalematedPoints: 20, stalemateOthersPoints: 10, maxPlies: 1000 });
    expect(rulesFor('giveaway')).toBe(GIVEAWAY_RULES);
    expect(rulesFor('ffa')).toBe(FFA_RULES);
  });

  it('the snapshot text FORMAT is unchanged: the same board and fields, castling rights empty, all scores zero', () => {
    const chess = serialize(initialState(FFA_RULES)).split(' ');
    const giveaway = serialize(initialState(GIVEAWAY_RULES)).split(' ');
    expect(giveaway).toHaveLength(8);
    expect(giveaway[0]).toBe(chess[0]); // the same 14 rows
    expect(giveaway.slice(1)).toEqual(['0', 'aaaa', '0,0,0,0', '0', '-', '0', '-']);
    expect(chess[4]).not.toBe('0'); // ...whereas Chess starts with all eight castling rights
  });

  it('a hand-built Giveaway position starts with NO castling rights, even with king and rooks on their start squares (Chess infers them)', () => {
    const pieces = ['rK@h1', 'rR@d1', 'rR@k1', 'bK@a8', 'yK@g14', 'gK@n7'];
    expect(gp(pieces).castling).toBe(0);
    expect(stateFromPieces(pieces).castling).not.toBe(0);
  });

  it('the start position has every seat with 16 pieces and Red to move, with ordinary moves only (no captures exist yet)', () => {
    const start = initialState(GIVEAWAY_RULES);
    expect(piecesLeft(start.cells)).toEqual([16, 16, 16, 16]);
    expect(start.turn).toBe(RED);
    const moves = currentMoves(start);
    expect(moves).toHaveLength(20); // 8 pawns x (single + double) + 2 knights x 2 = 20, exactly as in 4 Player Chess
    expect(moves.every((m) => m.captured === 0)).toBe(true);
    expect(legalMoves(initialState(FFA_RULES), RED)).toHaveLength(20);
  });
});

describe('the capture rule: captures are mandatory', () => {
  it('1 victim: the only legal move is the capture, and a quiet move is refused', () => {
    const state = gp(['rR@d5', 'bP@d9', ...KINGS], { turn: RED });
    expect(labels(legalMoves(state, RED))).toEqual(['d5xd9']);
    expect(findLegalMove(state, RED, sq('h1'), sq('h2'))).toBeNull(); // a quiet king step
    expect(findLegalMove(state, RED, sq('d5'), sq('d4'))).toBeNull(); // a quiet rook step
    expect(legalMoves(state, RED)[0].captured >> 4).toBe(BLUE); // the captured piece is Blue's
  });

  it('2 victims (Yellow and Green): the mover may choose either capture, and nothing else (worked example 1)', () => {
    const state = gp(['bN@e8', 'yP@g9', 'gR@f6', ...KINGS], { turn: BLUE });
    expect(labels(legalMoves(state, BLUE))).toEqual(['e8xf6', 'e8xg9']);
  });

  it('3 victims (Red, Yellow and Green): there is no priority between seats - all three captures are legal', () => {
    const state = gp(['bQ@g8', 'gP@m8', 'yP@g12', 'rP@g3', ...KINGS], { turn: BLUE });
    expect(labels(legalMoves(state, BLUE))).toEqual(['g8xg12', 'g8xg3', 'g8xm8']);
    const victims = legalMoves(state, BLUE).map((m) => m.captured >> 4);
    expect(victims.sort()).toEqual([RED, YELLOW, GREEN]);
  });

  it('the rule is GLOBAL, not per piece: a capture by a far-away rook forbids the tapped pawn\'s quiet move too', () => {
    const state = gp(['bP@e9', 'bR@d4', 'yP@d10', ...KINGS], { turn: BLUE });
    expect(labels(legalMoves(state, BLUE))).toEqual(['d4xd10']);
    expect(targets(state, 'e9')).toEqual([]); // the pawn has no legal move while the rook has a capture
    expect(findLegalMove(state, BLUE, sq('e9'), sq('f9'))).toBeNull();
  });

  it('with no capture available every pseudo-legal move is legal (and the count is the plain piece-move count)', () => {
    const state = gp(['rN@e5', ...KINGS], { turn: RED });
    expect(targets(state, 'e5')).toHaveLength(8);
    expect(targets(state, 'h1')).toEqual(['h1-g1', 'h1-g2', 'h1-h2', 'h1-i1', 'h1-i2']);
  });

  it('a piece can capture a piece of a seat that is NOT next to move (any other active seat is a target)', () => {
    const state = gp(['rR@d5', 'yP@d9', ...KINGS], { turn: RED }); // Yellow sits across the board
    expect(labels(legalMoves(state, RED))).toEqual(['d5xd9']);
  });

  it('en passant is a capture and therefore the ONLY legal move when it is the only capture', () => {
    const start = gp(['yP@i13', 'gP@j11', ...KINGS], { turn: YELLOW });
    const afterStep = play(start, 'i13', 'i11'); // Yellow double-steps past Green's pawn
    expect(afterStep.state.ep).toMatchObject({ passed: sq('i12'), pawn: sq('i11'), by: YELLOW });
    const moves = legalMoves(afterStep.state, GREEN);
    expect(labels(moves)).toEqual(['j11xi12 e.p.']);
    expect(moves[0].flags & FLAG_EN_PASSANT).toBeTruthy();
    expect(moves[0].captured >> 4).toBe(YELLOW);
    expect(findLegalMove(afterStep.state, GREEN, sq('n7'), sq('n8'))).toBeNull(); // forced
    const taken = playMove(afterStep.state, moves[0], first).state;
    expect(listPieces(taken)).toContain('gP@i12');
    expect(listPieces(taken)).not.toContain('yP@i11');
  });

  it('en passant against an ELIMINATED seat\'s pawn is not offered (a wall cannot be captured, not even en passant)', () => {
    const start = gp(['yP@i13', 'gP@j11', ...KINGS], { turn: YELLOW });
    const afterStep = play(start, 'i13', 'i11').state;
    const afterResign = resign(afterStep, YELLOW, first).state;
    expect(afterResign.ep).not.toBeNull(); // the opportunity is still recorded...
    expect(labels(legalMoves(afterResign, GREEN)).filter((l) => l.includes('e.p.'))).toEqual([]); // ...but is not a legal capture
    expect(findLegalMove(afterResign, GREEN, sq('j11'), sq('i12'))).toBeNull();
  });
});

describe('kings are ordinary pieces', () => {
  it('a king can be captured; the game goes on if its owner still has other pieces', () => {
    const state = gp(['rR@d5', 'bK@d9', 'bP@b9', 'rK@h1', 'yK@g14', 'gK@n7'], { turn: RED });
    expect(labels(legalMoves(state, RED))).toEqual(['d5xd9']);
    const after = play(state, 'd5', 'd9').state;
    expect(after.result).toBeNull();
    expect(after.kings[BLUE]).toBe(-1); // bookkeeping: the same thing a serialize round trip would recompute
    expect(after.turn).toBe(BLUE);
    expect(listPieces(after)).not.toContain('bK@d9');
    expect(deserialize(serialize(after), GIVEAWAY_RULES).kings).toEqual(after.kings);
  });

  it('a king that is a seat\'s LAST piece: capturing it wins the game for that seat (outOfPieces)', () => {
    const state = gp(['rR@d5', 'bK@d9', 'rK@h1', 'yK@g14', 'gK@n7'], { turn: RED });
    const out = play(state, 'd5', 'd9');
    expect(out.state.result).toEqual({ winners: [BLUE], reason: 'outOfPieces' });
  });

  it('a king may capture a king, and two kings may stand side by side without anything happening', () => {
    const adjacent = gp(['rK@h1', 'bK@h2', 'bP@a9', 'yK@g14', 'gK@n7'], { turn: RED });
    expect(labels(legalMoves(adjacent, RED))).toEqual(['h1xh2']); // mandatory, and kings capture like any piece
    const yellowToMove = gp(['rK@h1', 'bK@h2', 'bP@a9', 'yK@g14', 'gK@n7'], { turn: YELLOW });
    expect(legalMoves(yellowToMove, YELLOW).length).toBeGreaterThan(0); // adjacent enemy kings changed nothing for a third seat
    expect(play(yellowToMove, 'g14', 'g13').state.result).toBeNull();
  });

  it('there is no check: a king may step onto an attacked square and `kings` is never consulted for safety', () => {
    const state = gp(['rK@h1', 'bR@d2', 'yK@g14', 'gK@n7', 'bK@a8'], { turn: RED }); // Blue's rook attacks all of rank 2
    expect(targets(state, 'h1')).toContain('h1-h2'); // would be "into check" in 4 Player Chess
    expect(legalMoves(state, RED).some((m) => m.captured !== 0)).toBe(false);
  });

  it('there is NO castling in Giveaway, even with every right set and a clear path; 4 Player Chess still castles in the same position', () => {
    const pieces = ['rK@h1', 'rR@d1', 'rR@k1', 'bK@a8', 'yK@g14', 'gK@n7'];
    const giveaway = gp(pieces, { turn: RED, castling: 0xff });
    expect(legalMoves(giveaway, RED).some((m) => m.flags & FLAG_CASTLE)).toBe(false);
    expect(targets(giveaway, 'h1')).toEqual(['h1-g1', 'h1-g2', 'h1-h2', 'h1-i1', 'h1-i2']); // one step only, no two-square king move
    const chess = stateFromPieces(pieces, { turn: RED });
    expect(legalMoves(chess, RED).some((m) => m.flags & FLAG_CASTLE)).toBe(true);
  });

  it('kings are not capturable in 4 Player Chess (the same position under FFA rules offers no king capture)', () => {
    const chess = stateFromPieces(['rR@d5', 'bK@d9', 'bP@b9', 'rK@h1', 'yK@g14', 'gK@n7'], { turn: RED });
    expect(legalMoves(chess, RED).every((m) => m.captured === 0)).toBe(true);
  });
});

describe('promotion', () => {
  it('a pawn reaching its promotion line may become a queen, rook, bishop or knight - four moves, nothing else', () => {
    const state = gp(['rP@e7', ...KINGS], { turn: RED });
    const moves = legalMoves(state, RED).filter((m) => m.from === sq('e7'));
    expect(moves).toHaveLength(4);
    expect(moves.map(promotionOf).sort()).toEqual([KNIGHT, BISHOP, ROOK, QUEEN].sort());
    const letters = moves.map((m) => listPieces(playMove(state, m, first).state).find((p) => p.endsWith('@e8')));
    expect(letters.sort()).toEqual(['rD@e8', 'rH@e8', 'rT@e8', 'rZ@e8']); // bishop, knight, rook, queen
  });

  it('there is no king promotion: asking for a king (type 6) finds no move, and the default is the queen', () => {
    const state = gp(['rP@e7', ...KINGS], { turn: RED });
    expect(findLegalMove(state, RED, sq('e7'), sq('e8'), KING)).toBeNull();
    expect(promotionOf(findLegalMove(state, RED, sq('e7'), sq('e8'))!)).toBe(QUEEN);
  });

  it('promoting BY CAPTURING is forced over the quiet push: only the four capture-promotions are legal', () => {
    const state = gp(['rP@e7', 'bR@f8', ...KINGS], { turn: RED });
    const moves = legalMoves(state, RED);
    expect(moves).toHaveLength(4);
    expect(moves.every((m) => m.captured !== 0 && promotionOf(m) !== 0)).toBe(true);
    expect(labels(moves)).toEqual(['e7xf8=B', 'e7xf8=N', 'e7xf8=Q', 'e7xf8=R']);
  });

  it('the capture that takes a seat\'s last piece AND promotes ends the game on the spot, with the promoted piece on the board', () => {
    const state = gp(['rP@e7', 'bR@f8', 'rK@h1', 'yK@g14', 'gK@n7'], { turn: RED });
    const out = play(state, 'e7', 'f8', KNIGHT);
    expect(out.state.result).toEqual({ winners: [BLUE], reason: 'outOfPieces' });
    expect(listPieces(out.state)).toContain('rH@f8'); // Red's promoted knight now stands where Blue's last rook was
  });

  it('a pawn of another seat promotes on ITS own line (Blue on file h, Green on file g, Yellow on rank 7)', () => {
    const blue = gp(['bP@g8', ...KINGS], { turn: BLUE });
    expect(targets(blue, 'g8')).toHaveLength(4);
    const yellow = gp(['yP@e8', ...KINGS], { turn: YELLOW });
    expect(targets(yellow, 'e8')).toHaveLength(4); // forward is down: e7 is Yellow's 8th line
  });
});

describe('eliminated seats leave WALLS (decision D2)', () => {
  const status: PositionOptions['status'] = ['active', 'frozen', 'active', 'active']; // Blue has resigned

  it('a wall is never capturable and never forcing: the same position is a forced capture with Blue active and free moves with Blue eliminated', () => {
    const live = gp(['rR@e1', 'bN@e5', ...KINGS.filter((k) => !k.startsWith('bK'))], { turn: RED });
    expect(labels(legalMoves(live, RED))).toEqual(['e1xe5']);
    const walled = gp(['rR@e1', 'bN@e5', ...KINGS.filter((k) => !k.startsWith('bK'))], { turn: RED, status });
    const moves = legalMoves(walled, RED);
    expect(moves.every((m) => m.captured === 0)).toBe(true);
    expect(moves.length).toBeGreaterThan(1);
  });

  it('a wall blocks a ROOK ray permanently: the rook reaches the squares before it and nothing on or beyond it', () => {
    const state = gp(['rR@e1', 'bN@e5', 'yK@g14', 'gK@n7'], { turn: RED, status });
    const fileMoves = targets(state, 'e1').filter((l) => l.startsWith('e1-e'));
    expect(fileMoves).toEqual(['e1-e2', 'e1-e3', 'e1-e4']);
  });

  it('a wall blocks a BISHOP ray', () => {
    const state = gp(['rB@e1', 'bP@h4', 'yK@g14', 'gK@n7'], { turn: RED, status });
    expect(targets(state, 'e1')).toContain('e1-g3');
    expect(targets(state, 'e1')).not.toContain('e1-h4');
    expect(targets(state, 'e1')).not.toContain('e1-i5');
  });

  it('a wall blocks a QUEEN along both a rank and a diagonal', () => {
    const state = gp(['rQ@e5', 'bP@g5', 'bP@g7', 'yK@g14', 'gK@n7'], { turn: RED, status });
    const t = targets(state, 'e5');
    expect(t).toContain('e5-f5');
    expect(t).not.toContain('e5-g5');
    expect(t).not.toContain('e5-h5');
    expect(t).toContain('e5-f6');
    expect(t).not.toContain('e5-g7');
    expect(t).not.toContain('e5-h8');
  });

  it('a knight cannot land on a wall, a king cannot step onto one', () => {
    const knight = gp(['rN@e5', 'bP@f7', 'yK@g14', 'gK@n7'], { turn: RED, status });
    expect(targets(knight, 'e5')).toHaveLength(7);
    expect(targets(knight, 'e5')).not.toContain('e5-f7');
    const king = gp(['rK@e5', 'bP@f5', 'yK@g14', 'gK@n7'], { turn: RED, status });
    expect(targets(king, 'e5')).toHaveLength(7);
    expect(targets(king, 'e5')).not.toContain('e5-f5');
  });

  it('a pawn is blocked by a wall in front of it and cannot capture a wall diagonally (worked example 4)', () => {
    const state = gp(['rP@e5', 'bP@e6', 'bP@d6', 'bP@f6', 'yK@g14', 'gK@n7'], { turn: RED, status });
    expect(targets(state, 'e5')).toEqual([]);
    expect(legalMoves(state, RED)).toEqual([]); // and so Red, with nothing else, has no move at all
  });

  it('walls are permanent: they are still where they were many plies later', () => {
    let state = gp(['rK@e1', 'bN@e5', 'bB@f9', 'yK@g14', 'gK@n7'], { turn: RED, status });
    for (let i = 0; i < 24 && !state.result; i++) state = playMove(state, legalMoves(state, state.turn)[0], first).state;
    expect(state.status[BLUE]).toBe('frozen');
    expect(listPieces(state)).toEqual(expect.arrayContaining(['bN@e5', 'bB@f9']));
    expect(state.turn === BLUE).toBe(false);
  });
});

describe('turn order, elimination and the end of the game', () => {
  it('a seat whose LAST piece is captured wins immediately, even though Blue and Yellow have not moved since (worked example 2)', () => {
    const state = gp(['rR@e5', 'gP@m5', 'rK@h1', 'bK@a8', 'yK@g14'], { turn: RED });
    expect(labels(legalMoves(state, RED))).toEqual(['e5xm5']);
    const out = play(state, 'e5', 'm5');
    expect(out.state.result).toEqual({ winners: [GREEN], reason: 'outOfPieces' });
    expect(kinds(out.events)).toEqual(['move', 'gameOver']);
    expect(out.state.turn).toBe(RED); // the turn never moved on
    expect(currentMoves(out.state)).toEqual([]);
  });

  it('...and that win beats the ply cap when the capture lands on the cap ply', () => {
    const state = gp(['rR@e5', 'gP@m5', 'rK@h1', 'bK@a8', 'yK@g14'], { turn: RED, ply: 9, rules: { ...GIVEAWAY_RULES, maxPlies: 10 } });
    const out = play(state, 'e5', 'm5');
    expect(out.state.result).toEqual({ winners: [GREEN], reason: 'outOfPieces' });
    expect(out.events).toHaveLength(2); // the move and exactly ONE gameOver (a cap announced first and then overwritten would be a second)
    expect(kinds(out.events)).toEqual(['move', 'gameOver']);
  });

  it('a seat that is STUCK on its own turn wins (worked example 3): Yellow\'s lone pawn is blocked, so when the turn reaches it, it wins', () => {
    const start = gp(['rK@h1', 'bK@a8', 'bP@e11', 'yP@e12', 'gK@n7'], { turn: RED });
    expect(legalMoves(start, YELLOW)).toEqual([]); // blocked right now...
    const afterRed = play(start, 'h1', 'h2');
    expect(afterRed.state.turn).toBe(BLUE);
    expect(afterRed.state.result).toBeNull(); // ...but nothing is decided until Yellow's turn arrives
    const afterBlue = play(afterRed.state, 'a8', 'a9');
    expect(afterBlue.state.result).toEqual({ winners: [YELLOW], reason: 'stuck' });
    expect(kinds(afterBlue.events)).toEqual(['move', 'gameOver']);
    expect(afterBlue.state.turn).toBe(YELLOW);
  });

  it('a seat blocked OFF-turn that is freed before its turn does not win: it simply moves (and here must capture)', () => {
    const start = gp(['rK@h1', 'bK@a8', 'bP@e11', 'yP@e12', 'gK@n7'], { turn: RED });
    const afterRed = play(start, 'h1', 'h2');
    const afterBlue = play(afterRed.state, 'e11', 'f11'); // the blocker steps away - and lands where Yellow's pawn can capture it
    expect(afterBlue.state.result).toBeNull();
    expect(afterBlue.state.turn).toBe(YELLOW);
    expect(labels(legalMoves(afterBlue.state, YELLOW))).toEqual(['e12xf11']);
  });

  it('an eliminated seat is skipped in the rotation (1, 2 and 3 eliminated), is never stuck, and never wins', () => {
    const base = gp([...KINGS], { turn: RED });
    const oneOut = resign(base, BLUE, first).state;
    expect(play(oneOut, 'h1', 'h2').state.turn).toBe(YELLOW); // Blue skipped
    const twoOut = resign(oneOut, YELLOW, first).state;
    expect(twoOut.result).toBeNull();
    expect(play(twoOut, 'h1', 'h2').state.turn).toBe(GREEN); // Blue and Yellow skipped
    const threeOut = resign(twoOut, GREEN, first);
    expect(threeOut.state.result).toEqual({ winners: [RED], reason: 'lastStanding' });
    expect(kinds(threeOut.events)).toEqual(['eliminated', 'gameOver']);
  });

  it('a frozen seat with no pieces at all (only possible in a hand-built position) does not "win" by being hollow: only ACTIVE seats can run out of pieces', () => {
    const base = gp(['rK@h1', 'yK@g14', 'gK@n7'], { turn: RED, status: ['active', 'frozen', 'active', 'active'] });
    const out = play(base, 'h1', 'h2');
    expect(out.state.result).toBeNull();
    expect(out.state.turn).toBe(YELLOW);
  });

  it('a resign, off-turn, changes nothing but the seat: it is still the mover\'s turn, and a frozen seat has no moves', () => {
    const base = gp([...KINGS], { turn: BLUE });
    const out = resign(base, YELLOW, first);
    expect(out.state.turn).toBe(BLUE);
    expect(out.state.status).toEqual(['active', 'active', 'frozen', 'active']);
    expect(out.state.result).toBeNull();
    expect(out.events).toEqual([{ kind: 'eliminated', seat: YELLOW, reason: 'resign', credit: null, points: [0, 0, 0, 0] }]);
    expect(legalMoves(out.state, YELLOW)).toEqual([]);
    expect(out.state.score).toEqual([0, 0, 0, 0]);
  });

  it('flag fall of the mover (worked example 5): the seat is eliminated with reason `timeout`, its pieces stay as walls and the turn passes', () => {
    const base = gp([...KINGS, 'gP@m7'], { turn: GREEN });
    const out = resign(base, GREEN, first, 'timeout');
    expect(out.events[0]).toEqual({ kind: 'eliminated', seat: GREEN, reason: 'timeout', credit: null, points: [0, 0, 0, 0] });
    expect(out.state.status[GREEN]).toBe('frozen');
    expect(out.state.turn).toBe(RED);
    expect(out.state.result).toBeNull();
    expect(listPieces(out.state)).toEqual(expect.arrayContaining(['gK@n7', 'gP@m7']));
  });

  it('flag fall that leaves one active seat ends the game as `lastStanding` for the survivor', () => {
    const base = gp([...KINGS], { turn: GREEN, status: ['active', 'frozen', 'frozen', 'active'] });
    const out = resign(base, GREEN, first, 'timeout');
    expect(out.state.result).toEqual({ winners: [RED], reason: 'lastStanding' });
    expect(kinds(out.events)).toEqual(['eliminated', 'gameOver']);
  });

  it('resigning leaves a seat that is already to move STUCK when the walls were its only way to capture and its quiet moves are blocked', () => {
    // Blue's lone pawn is blocked by Red's pawn, and its ONLY legal move is the (forced) capture of Yellow's knight.
    const start = gp(['bP@e5', 'rP@f5', 'yN@f6', 'rK@h1', 'yK@g14', 'gK@n7'], { turn: BLUE });
    expect(labels(legalMoves(start, BLUE))).toEqual(['e5xf6']);
    const out = resign(start, YELLOW, first); // Yellow resigns: the knight becomes a wall that cannot be captured
    expect(legalMoves(out.state, BLUE)).toEqual([]);
    expect(out.state.result).toEqual({ winners: [BLUE], reason: 'stuck' });
    expect(kinds(out.events)).toEqual(['eliminated', 'gameOver']);
  });

  it('last standing: the third resignation wins for the one seat left (and a seat that resigned can never win)', () => {
    let state = gp([...KINGS], { turn: RED });
    state = resign(state, YELLOW, first).state;
    state = resign(state, BLUE, first).state;
    const out = resign(state, RED, first);
    expect(out.state.result).toEqual({ winners: [GREEN], reason: 'lastStanding' });
    expect(resign(out.state, GREEN, first).events).toEqual([]); // nothing happens after the game is over
  });

  it('the ply cap: the seat(s) with the FEWEST pieces win, ties are shared, an eliminated seat cannot win', () => {
    const rules = { ...GIVEAWAY_RULES, maxPlies: 6 };
    // Red 2, Blue 2, Yellow 3, Green 3 -> Red and Blue share.
    const tie = gp(['rK@h1', 'rP@e3', 'bK@a8', 'bP@b9', 'yK@g14', 'yP@e12', 'yP@f12', 'gK@n7', 'gP@m6', 'gP@m5'], { ply: 5, rules });
    const tied = play(tie, 'h1', 'h2');
    expect(tied.state.result).toEqual({ winners: [RED, BLUE], reason: 'cap' });
    expect(tied.events[tied.events.length - 1]).toMatchObject({ kind: 'gameOver' });
    // Blue (1 piece) is eliminated: it would be the fewest but cannot win -> Red (2) does.
    const walled = gp(['rK@h1', 'rP@e3', 'bK@a8', 'yK@g14', 'yP@e12', 'yP@f12', 'gK@n7', 'gP@m6', 'gP@m5'], { ply: 5, rules, status: ['active', 'frozen', 'active', 'active'] });
    expect(play(walled, 'h1', 'h2').state.result).toEqual({ winners: [RED], reason: 'cap' });
  });

  it('the cap fires exactly at maxPlies, and maxPlies can never be lifted past the hard ceiling', () => {
    const pieces = ['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7', 'rN@e3', 'bN@c6', 'yN@j12', 'gN@l9'];
    let state = gp(pieces, { rules: { ...GIVEAWAY_RULES, maxPlies: 40 } });
    for (let i = 0; i < 200 && !state.result; i++) state = playMove(state, legalMoves(state, state.turn)[0], first).state;
    expect(state.result?.reason).toBe('cap');
    expect(state.ply).toBe(40);
    for (const maxPlies of [Infinity, 1e9]) {
      const capped = gp(pieces, { ply: HARD_MAX_PLIES - 1, rules: { ...GIVEAWAY_RULES, maxPlies } });
      const out = playMove(capped, legalMoves(capped, capped.turn)[0], first);
      expect(out.state.result?.reason, String(maxPlies)).toBe('cap');
      expect(out.state.ply).toBe(HARD_MAX_PLIES);
    }
  });

  it('there is no dead-position ending in Giveaway: four bare kings keep playing (kings can capture kings) until something else ends it', () => {
    const state = gp([...KINGS], { turn: RED });
    expect(play(state, 'h1', 'h2').state.result).toBeNull();
  });
});

describe('deterministic scripted games (exact events and result)', () => {
  it('SCRIPT outOfPieces - the forced capture hands Green the win: a mandatory capture is the whole mechanism', () => {
    let state = gp(['rK@h1', 'bK@a9', 'yR@g8', 'gP@m8'], { turn: RED });
    state = play(state, 'h1', 'h2').state;
    state = play(state, 'a9', 'a10').state;
    expect(state.turn).toBe(YELLOW);
    expect(labels(legalMoves(state, YELLOW))).toEqual(['g8xm8']); // Yellow has other moves in principle (the rook roams) - none is allowed
    const last = play(state, 'g8', 'm8');
    expect(last.events).toEqual([
      { kind: 'move', seat: YELLOW, move: expect.objectContaining({ from: sq('g8'), to: sq('m8') }) },
      { kind: 'gameOver', result: { winners: [GREEN], reason: 'outOfPieces' } },
    ]);
    expect(last.state.result).toEqual({ winners: [GREEN], reason: 'outOfPieces' });
    expect(piecesLeft(last.state.cells)).toEqual([1, 1, 1, 0]);
  });

  it('SCRIPT stuck - Red walls Blue in with its own move and Blue wins on its next turn', () => {
    // Blue's only piece is a pawn on f5, blocked by Red's pawn directly ahead on g5 with nothing to capture diagonally: Red makes a quiet king
    // move and the turn reaches a Blue that has no legal move.
    const blocked = gp(['rP@g5', 'bP@f5', 'rK@h1', 'yK@g14', 'gK@n7'], { turn: RED });
    expect(legalMoves(blocked, BLUE)).toEqual([]);
    const out = play(blocked, 'h1', 'h2');
    expect(out.state.result).toEqual({ winners: [BLUE], reason: 'stuck' });
    expect(kinds(out.events)).toEqual(['move', 'gameOver']);
  });

  it('SCRIPT lastStanding - a flag fall, a resignation and a second flag fall leave one seat', () => {
    let state = gp([...KINGS], { turn: RED });
    state = play(state, 'h1', 'h2').state; // Red moves; Blue to move
    state = resign(state, BLUE, first, 'timeout').state; // Blue flags -> Yellow to move
    expect(state.turn).toBe(YELLOW);
    state = play(state, 'g14', 'g13').state; // Green to move
    state = resign(state, RED, first).state; // Red resigns off-turn
    expect(state.result).toBeNull();
    const out = resign(state, GREEN, first, 'timeout'); // Green flags: only Yellow is left
    expect(out.state.result).toEqual({ winners: [YELLOW], reason: 'lastStanding' });
    expect(out.events.map((e) => e.kind)).toEqual(['eliminated', 'gameOver']);
    expect(out.state.status).toEqual(['frozen', 'frozen', 'active', 'frozen']);
  });
});

describe('snapshots and the wire text', () => {
  it('every Giveaway ending round-trips through serialize/deserialize with the result intact (the variant\'s rules travel beside the text)', () => {
    const states = [
      gp(['rR@e5', 'gP@m5', 'rK@h1', 'bK@a8', 'yK@g14'], { turn: RED }),
      gp(['rP@g5', 'bP@f5', 'rK@h1', 'yK@g14', 'gK@n7'], { turn: RED }),
      gp([...KINGS], { turn: RED, status: ['active', 'frozen', 'frozen', 'active'] }),
    ];
    const finished = [play(states[0], 'e5', 'm5').state, play(states[1], 'h1', 'h2').state, resign(states[2], GREEN, first).state];
    expect(finished.map((s) => s.result?.reason)).toEqual(['outOfPieces', 'stuck', 'lastStanding']);
    for (const state of finished) {
      const back = deserialize(serialize(state), GIVEAWAY_RULES);
      expect(back.result).toEqual(state.result);
      expect(serialize(back)).toBe(serialize(state));
      expect(Array.from(back.cells)).toEqual(Array.from(state.cells));
      expect(back.kings).toEqual(state.kings);
      expect(back.status).toEqual(state.status);
    }
    const cap = play(gp(['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7'], { ply: 4, rules: { ...GIVEAWAY_RULES, maxPlies: 5 } }), 'h1', 'h2').state;
    expect(deserialize(serialize(cap), GIVEAWAY_RULES).result).toEqual(cap.result);
    expect(serialize(cap)).toMatch(/ 0,1,2,3:cap$/); // four bare kings: everyone ties on one piece
  });
});

// --- The property test: over seeded random games, the game is over if and only if a rule says so --------------------------------------

/** Plays one random Giveaway game (random legal moves and promotions, now and then a resignation or flag fall), calling `check` after EVERY change. */
function playRandomGame(seed: number, check: (before: FourPlayerState, after: FourPlayerState, events: GameEvent[]) => void, maxPlies = 400): FourPlayerState {
  const rng = mulberry32(seed);
  let state = initialState({ ...GIVEAWAY_RULES, maxPlies });
  for (let guard = 0; guard < 4000 && !state.result; guard++) {
    const roll = rng();
    let applied: Applied;
    if (roll < 0.01) {
      const active = activeSeats(state);
      applied = resign(state, active[Math.floor(rng() * active.length)], first, roll < 0.005 ? 'resign' : 'timeout');
    } else {
      const moves = legalMoves(state, state.turn);
      const pick = moves[Math.floor(rng() * moves.length)];
      applied = playMove(state, findLegalMove(state, state.turn, pick.from, pick.to, [QUEEN, ROOK, BISHOP, KNIGHT][Math.floor(rng() * 4)]) ?? pick, first);
    }
    check(state, applied.state, applied.events);
    state = applied.state;
  }
  return state;
}

/** The rules, restated independently of the engine: is `state` over, and how? */
function expectedOutcome(state: FourPlayerState): { over: false } | { over: true; reason: string; winners: Seat[] } {
  const counts = piecesLeft(state.cells);
  const active = activeSeats(state);
  const hollow = active.find((seat) => counts[seat] === 0);
  if (hollow !== undefined) return { over: true, reason: 'outOfPieces', winners: [hollow] };
  if (state.ply >= Math.min(state.rules.maxPlies, HARD_MAX_PLIES)) {
    const fewest = Math.min(...active.map((s) => counts[s]));
    return { over: true, reason: 'cap', winners: active.filter((s) => counts[s] === fewest) };
  }
  if (active.length <= 1) return { over: true, reason: 'lastStanding', winners: active };
  if (state.status[state.turn] === 'active' && legalMoves(state, state.turn).length === 0) return { over: true, reason: 'stuck', winners: [state.turn] };
  return { over: false };
}

describe('property: over seeded random games the engine agrees with the rules stated independently', () => {
  const reasons = new Map<string, number>();
  const SEEDS = Array.from({ length: 160 }, (_, i) => 7000 + i * 13);

  it('after every move or resignation: over iff a rule says so, with the right reason and winners; nothing else drifts', () => {
    let steps = 0;
    for (const seed of SEEDS) {
      const final = playRandomGame(seed, (before, after, events) => {
        steps++;
        const want = expectedOutcome(after);
        if (!want.over) {
          expect(after.result, `seed ${seed} ply ${after.ply}`).toBeNull();
          expect(after.status[after.turn]).toBe('active');
          expect(legalMoves(after, after.turn).length).toBeGreaterThan(0);
          expect(activeSeats(after).length).toBeGreaterThanOrEqual(2);
        } else {
          expect(after.result, `seed ${seed} ply ${after.ply}`).toEqual({ winners: want.winners, reason: want.reason });
          expect(events.filter((e) => e.kind === 'gameOver')).toHaveLength(1);
          expect(events[events.length - 1].kind).toBe('gameOver');
          reasons.set(want.reason, (reasons.get(want.reason) ?? 0) + 1);
        }
        // nothing but the rules moves: no points, no castling rights, only active seats ever move
        expect(after.score).toEqual([0, 0, 0, 0]);
        expect(after.castling).toBe(0);
        for (const seat of [0, 1, 2, 3] as Seat[]) expect(['active', 'frozen']).toContain(after.status[seat]);
        // forced capture, restated: the mover's legal moves are the captures iff any capture exists
        if (!after.result) {
          const legal = legalMoves(after, after.turn);
          expect(legal.every((m) => m.captured !== 0) || legal.every((m) => m.captured === 0), `seed ${seed}: mixed capture / quiet list`).toBe(true);
        }
        // a move never creates pieces; walls never move
        const was = piecesLeft(before.cells);
        const now = piecesLeft(after.cells);
        for (const seat of [0, 1, 2, 3] as Seat[]) expect(now[seat]).toBeLessThanOrEqual(was[seat]);
        for (const seat of [0, 1, 2, 3] as Seat[]) if (before.status[seat] === 'frozen') expect(now[seat]).toBe(was[seat]);
        // the snapshot text is a faithful round trip (kings bookkeeping included)
        const back = deserialize(serialize(after), GIVEAWAY_RULES);
        expect(serialize(back)).toBe(serialize(after));
        expect(back.kings).toEqual(after.kings);
      });
      expect(final.result, `seed ${seed} must finish (cap 400)`).not.toBeNull();
    }
    expect(steps).toBeGreaterThan(5000);
    // eslint-disable-next-line no-console
    console.info('Giveaway property test: games', SEEDS.length, 'steps', steps);
  }, 240_000);

  it('...and the random games actually reach the rare endings (so the test above is not vacuous): outOfPieces, stuck and lastStanding (the cap is covered by the hand-built tests: 400-ply random games always end first)', () => {
    // `reasons` was filled by the previous test (same file, run in order); if this file is run with -t on one test, fill it here.
    if (reasons.size === 0) for (const seed of SEEDS) playRandomGame(seed, (_b, after) => after.result && reasons.set(after.result.reason, (reasons.get(after.result.reason) ?? 0) + 1));
    for (const reason of ['outOfPieces', 'stuck', 'lastStanding']) expect(reasons.get(reason) ?? 0, reason).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.info('Giveaway random-game endings:', Object.fromEntries(reasons));
  }, 240_000);
});
