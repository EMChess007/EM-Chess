import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import {
  CASTLES,
  FLAG_CASTLE,
  FLAG_DOUBLE_STEP,
  FLAG_EN_PASSANT,
  FLAG_PROMOTION,
  PROMOTED_QUEEN,
  applyMoveRaw,
  attackers,
  fileOf,
  findLegalMove,
  initialState,
  isInCheck,
  legalMoves,
  listPieces,
  moveLabel,
  parseSquare,
  playMove,
  rankOf,
  squareName,
  stateFromPieces,
  type FourPlayerState,
  type Seat,
} from '../fourPlayer';

const RED = 0;
const BLUE = 1;
const YELLOW = 2;
const GREEN = 3;

/** Sorted "from-to" strings of the legal moves of `seat` (default: the seat to move), optionally only from one square. */
function movesOf(state: FourPlayerState, seat: Seat = state.turn, from?: string): string[] {
  return legalMoves(state, seat)
    .filter((m) => from === undefined || m.from === parseSquare(from))
    .map((m) => `${squareName(m.from)}-${squareName(m.to)}`)
    .sort();
}
const targets = (state: FourPlayerState, from: string, seat?: Seat) =>
  movesOf(state, seat, from)
    .map((s) => s.split('-')[1])
    .sort();
const KINGS = ['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7'];

describe('the start position', () => {
  it('every seat has exactly 20 legal moves (16 pawn moves + 4 knight moves)', () => {
    const state = initialState();
    for (const seat of [RED, BLUE, YELLOW, GREEN] as Seat[]) {
      const moves = legalMoves({ ...state, turn: seat }, seat);
      expect(moves, `seat ${seat}`).toHaveLength(20);
      expect(moves.filter((m) => m.flags & FLAG_DOUBLE_STEP)).toHaveLength(8);
    }
  });
});

describe("pawns move in their own seat's direction", () => {
  it('Red up, Blue right, Yellow down, Green left — single step and a double step from the starting line', () => {
    const state = stateFromPieces([...KINGS, 'rP@e2', 'bP@b5', 'yP@j13', 'gP@m6']);
    expect(targets(state, 'e2', RED)).toEqual(['e3', 'e4']);
    expect(targets(state, 'b5', BLUE)).toEqual(['c5', 'd5']);
    expect(targets(state, 'j13', YELLOW)).toEqual(['j11', 'j12']);
    expect(targets(state, 'm6', GREEN)).toEqual(['k6', 'l6']);
  });

  it('no double step away from the starting line', () => {
    const state = stateFromPieces([...KINGS, 'rP@e3']);
    expect(targets(state, 'e3', RED)).toEqual(['e4']);
  });

  it('a blocked pawn cannot advance, and a piece two squares ahead stops only the double step', () => {
    expect(targets(stateFromPieces([...KINGS, 'rP@e2', 'yN@e3']), 'e2', RED)).toEqual([]);
    expect(targets(stateFromPieces([...KINGS, 'rP@e2', 'yN@e4']), 'e2', RED)).toEqual(['e3']);
  });

  it('captures are diagonal-forward only, in each seat\'s own direction (never straight, sideways or backwards)', () => {
    const red = stateFromPieces([...KINGS, 'rP@e5', 'yN@d6', 'yN@f6', 'yN@e6', 'yN@d5', 'yN@f5']);
    expect(targets(red, 'e5', RED)).toEqual(['d6', 'f6']);
    const blue = stateFromPieces([...KINGS, 'bP@d9', 'rN@e9', 'rN@e10', 'rN@e8', 'rN@d10', 'rN@d8']);
    expect(targets(blue, 'd9', BLUE)).toEqual(['e10', 'e8']);
    const yellow = stateFromPieces([...KINGS, 'yP@j9', 'rN@j8', 'rN@i8', 'rN@k8', 'rN@i9', 'rN@k9', 'rN@i10']);
    expect(targets(yellow, 'j9', YELLOW)).toEqual(['i8', 'k8']);
    const green = stateFromPieces([...KINGS, 'gP@h6', 'rN@g6', 'rN@g5', 'rN@g7', 'rN@h7', 'rN@h5', 'rN@i7']);
    expect(targets(green, 'h6', GREEN)).toEqual(['g5', 'g7']);
  });

  it('a king can never be captured: a pawn attacking a king gives check but has no capture move', () => {
    const state = stateFromPieces(['rK@h1', 'bK@a8', 'gK@n7', 'rP@e5', 'yK@f6']);
    expect(targets(state, 'e5', RED)).toEqual(['e6']);
    expect(isInCheck(state, YELLOW)).toBe(true);
  });

  it("promotes (always to a queen) on the 8th rank from the seat's own back edge: Red rank 8, Yellow rank 7, Blue file h, Green file g", () => {
    const cases: [string, string, Seat][] = [
      ['rP@e7', 'e8', RED],
      ['yP@j8', 'j7', YELLOW],
      ['bP@g5', 'h5', BLUE],
      ['gP@h6', 'g6', GREEN],
    ];
    for (const [piece, to, seat] of cases) {
      const state = stateFromPieces([...KINGS, piece]);
      const from = parseSquare(piece.split('@')[1]);
      const move = findLegalMove(state, seat, from, parseSquare(to))!;
      expect(move, piece).not.toBeNull();
      expect(move.flags & FLAG_PROMOTION, piece).toBeTruthy();
      const after = applyMoveRaw(state, move);
      expect(after.cells[parseSquare(to)], piece).toBe(seat * 8 + PROMOTED_QUEEN);
      expect(after.cells[from]).toBe(0);
    }
    const early = stateFromPieces([...KINGS, 'rP@e6']);
    expect(findLegalMove(early, RED, parseSquare('e6'), parseSquare('e7'))!.flags & FLAG_PROMOTION).toBe(0);
  });

  it('a promoted queen moves as a queen, and is worth only 1 point when captured (a real queen 9)', () => {
    const state = stateFromPieces([...KINGS, 'rZ@e8', 'yR@e12']);
    expect(targets(state, 'e8', RED).length).toBeGreaterThan(20);
    const promoted = stateFromPieces([...KINGS, 'rZ@e8', 'yR@e12'], { turn: YELLOW });
    expect(applyMoveRaw(promoted, findLegalMove(promoted, YELLOW, parseSquare('e12'), parseSquare('e8'))!).score[YELLOW]).toBe(1);
    const real = stateFromPieces([...KINGS, 'rQ@e8', 'yR@e12'], { turn: YELLOW });
    expect(applyMoveRaw(real, findLegalMove(real, YELLOW, parseSquare('e12'), parseSquare('e8'))!).score[YELLOW]).toBe(9);
  });
});

describe('pieces on the cross-shaped board', () => {
  it('sliders stop at the cut corners', () => {
    const state = stateFromPieces([...KINGS, 'rR@d4', 'rB@d5']);
    expect(targets(state, 'd4', RED)).toEqual(['a4', 'b4', 'c4', 'd1', 'd2', 'd3', 'e4', 'f4', 'g4', 'h4', 'i4', 'j4', 'k4', 'l4', 'm4', 'n4'].sort());
    // The bishop on d5 going down-left reaches c4 and stops: b3 is a cut corner.
    expect(targets(state, 'd5', RED)).toContain('c4');
    expect(targets(state, 'd5', RED)).not.toContain('b3');
  });

  it('knights cannot land in a cut corner', () => {
    const state = stateFromPieces([...KINGS, 'rN@d4']);
    expect(targets(state, 'd4', RED)).toEqual(['b5', 'c6', 'e2', 'e6', 'f3', 'f5']);
  });

  it('kings step to any adjacent playable square, never into check from ANY seat', () => {
    const state = stateFromPieces(['rK@h7', 'yK@h12', 'bR@a6', 'gK@n7', 'bK@a8']);
    expect(targets(state, 'h7', RED)).toEqual(['g7', 'g8', 'h8', 'i7', 'i8']); // rank 6 is covered by Blue's rook
  });

  it('own pieces block; enemy pieces are captured; dead pieces block lines but can be captured', () => {
    const state = stateFromPieces([...KINGS, 'rR@e5', 'rN@e8', 'yP@h5', 'bP@b5'], { status: ['active', 'dead-king', 'active', 'active'] });
    const t = targets(state, 'e5', RED);
    expect(t).toContain('e7');
    expect(t).not.toContain('e8'); // own knight
    expect(t).toContain('h5'); // the live yellow pawn
    expect(t).not.toContain('i5');
    expect(t).toContain('b5'); // Blue is dead: its pawn is a capturable blocker
    expect(t).not.toContain('a5');
  });

  it("captures score the victim's value, but a dead seat's pieces are worth 0", () => {
    const live = stateFromPieces([...KINGS, 'rR@e5', 'yN@h5']);
    expect(applyMoveRaw(live, findLegalMove(live, RED, parseSquare('e5'), parseSquare('h5'))!).score[RED]).toBe(3);
    const dead = stateFromPieces([...KINGS, 'rR@e5', 'yN@h5'], { status: ['active', 'active', 'dead-king', 'active'] });
    expect(applyMoveRaw(dead, findLegalMove(dead, RED, parseSquare('e5'), parseSquare('h5'))!).score[RED]).toBe(0);
    for (const [letter, points] of [['P', 1], ['N', 3], ['B', 5], ['R', 5], ['Q', 9], ['Z', 1]] as const) {
      const s = stateFromPieces([...KINGS, 'rR@e5', `y${letter}@h5`]);
      expect(applyMoveRaw(s, findLegalMove(s, RED, parseSquare('e5'), parseSquare('h5'))!).score[RED], letter).toBe(points);
    }
  });

  it('a rook cannot take a king (attacking it is check, nothing more)', () => {
    const state = stateFromPieces(['rK@h1', 'yK@h14', 'rR@h7', 'bK@a8', 'gK@n7']);
    expect(targets(state, 'h7', RED)).not.toContain('h14');
    expect(isInCheck(state, YELLOW)).toBe(true);
  });
});

describe('check generalised to four seats', () => {
  it('a player may be in check from two seats at once; only a move that answers BOTH is legal', () => {
    // Red's king on h7 is attacked by Blue's rook along rank 7 (from a7) and by Yellow's rook down the h file (from h14).
    const base = ['rK@h7', 'bR@a7', 'yR@h14', 'bK@a9', 'yK@k14', 'gK@n9'];
    const state = stateFromPieces(base);
    expect(isInCheck(state, RED)).toBe(true);
    expect(attackers(state.cells, state.status, parseSquare('h7'), RED)).toBe((1 << BLUE) | (1 << YELLOW));
    expect(targets(state, 'h7', RED)).toEqual(['g6', 'g8', 'i6', 'i8']);
    // A bishop that could block ONE line (the file, on h10) does not answer the other: no bishop move is legal.
    expect(targets(stateFromPieces([...base, 'rB@f8']), 'f8', RED)).toEqual([]);
    // Against the single check it can.
    expect(targets(stateFromPieces(['rK@h7', 'yR@h14', 'rB@f8', 'bK@a9', 'yK@k14', 'gK@n9']), 'f8', RED)).toEqual(['h10']);
  });

  it('a pinned piece cannot leave the line, whichever seat pins it', () => {
    expect(targets(stateFromPieces(['rK@h2', 'rN@h5', 'yR@h13', 'bK@a9', 'yK@k14', 'gK@n9']), 'h5', RED)).toEqual([]);
    expect(targets(stateFromPieces(['rK@e4', 'rB@f4', 'gR@n4', 'bK@a9', 'yK@k14', 'gK@n8']), 'f4', RED)).toEqual([]);
  });

  it('dead pieces never give check, but still block a live attacker behind them', () => {
    const pieces = ['rK@h1', 'yR@h10', 'bK@a9', 'yK@k14', 'gK@n9'];
    expect(isInCheck(stateFromPieces(pieces), RED)).toBe(true);
    expect(isInCheck(stateFromPieces(pieces, { status: ['active', 'active', 'dead-king', 'active'] }), RED)).toBe(false);
    const shielded = stateFromPieces(['rK@h1', 'bR@h10', 'yR@h13', 'bK@a9', 'yK@k14', 'gK@n9'], { status: ['active', 'dead-king', 'active', 'active'] });
    expect(isInCheck(shielded, RED)).toBe(false);
  });

  it('a dead pawn, knight, bishop, rook or queen never gives check either (only live pieces do)', () => {
    const attackersOfH1: [string, string][] = [['yP@i2', 'pawn'], ['yN@g3', 'knight'], ['yB@d5', 'bishop'], ['yR@h9', 'rook'], ['yQ@h9', 'queen'], ['yQ@d5', 'queen on a diagonal']];
    for (const [piece, name] of attackersOfH1) {
      const rest = ['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7', piece];
      expect(isInCheck(stateFromPieces(rest), RED), `live ${name}`).toBe(true);
      expect(isInCheck(stateFromPieces(rest, { status: ['active', 'active', 'dead-king', 'active'] }), RED), `dead ${name}`).toBe(false);
    }
  });

  it('a dead king never captures, even a loose enemy piece it could safely take', () => {
    const state = stateFromPieces(['rK@h1', 'bK@d8', 'yK@g14', 'gK@n7', 'yN@d9'], { turn: BLUE, status: ['active', 'dead-king', 'active', 'active'] });
    expect(targets(state, 'd8', BLUE)).toEqual(['c8', 'c9', 'd7', 'e8', 'e9']); // d9 holds the knight; c7 and e7 are covered by it
  });

  it('a dead king may only walk to EMPTY squares, never into a live seat\'s attack', () => {
    const open = stateFromPieces(['rK@h1', 'rP@h2', 'yK@g14', 'gK@n7', 'bK@a8', 'yR@g1', 'bP@b8'], { turn: BLUE, status: ['active', 'dead-king', 'active', 'active'] });
    expect(targets(open, 'a8', BLUE)).toEqual(['a7', 'a9', 'b7', 'b9']); // b8 holds its own dead pawn
    // A live pawn on a9 can't be captured, and attacks b8; a live rook on rank 9 covers b9.
    const hemmed = stateFromPieces(['rK@h1', 'yK@g14', 'gK@n7', 'bK@a8', 'gR@n9', 'yP@a9'], { turn: BLUE, status: ['active', 'dead-king', 'active', 'active'] });
    expect(targets(hemmed, 'a8', BLUE)).toEqual(['a7', 'b7']);
  });
});

describe('castling', () => {
  const setups: [string, Seat, string, string, string, [string, string], [string, string]][] = [
    ['r', RED, 'h1', 'd1', 'k1', ['f1', 'g1'], ['j1', 'i1']],
    ['b', BLUE, 'a8', 'a4', 'a11', ['a6', 'a7'], ['a10', 'a9']],
    ['y', YELLOW, 'g14', 'd14', 'k14', ['e14', 'f14'], ['i14', 'h14']],
    ['g', GREEN, 'n7', 'n4', 'n11', ['n5', 'n6'], ['n9', 'n8']],
  ];
  const others = (letter: string) => ['rK@h4', 'bK@d8', 'yK@g10', 'gK@k5'].filter((p) => p[0] !== letter);

  for (const [letter, seat, king, rookA, rookB, sideA, sideB] of setups) {
    it(`${['Red', 'Blue', 'Yellow', 'Green'][seat]} castles both ways: king two squares towards the rook, rook onto the square the king crossed`, () => {
      const state = stateFromPieces([`${letter}K@${king}`, `${letter}R@${rookA}`, `${letter}R@${rookB}`, ...others(letter)], { turn: seat });
      expect(state.castling & (3 << (seat * 2))).toBe(3 << (seat * 2));
      const castleTargets = legalMoves(state, seat)
        .filter((m) => m.flags & FLAG_CASTLE)
        .map((m) => squareName(m.to))
        .sort();
      expect(castleTargets).toEqual([sideA[0], sideB[0]].sort());
      for (const [kingTo, rookTo] of [sideA, sideB]) {
        const after = applyMoveRaw(state, findLegalMove(state, seat, parseSquare(king), parseSquare(kingTo))!);
        expect(listPieces(after)).toContain(`${letter}K@${kingTo}`);
        expect(listPieces(after)).toContain(`${letter}R@${rookTo}`);
        expect(after.castling & (3 << (seat * 2))).toBe(0);
        expect(after.kings[seat]).toBe(parseSquare(kingTo));
      }
    });
  }

  it('the CASTLES table: sides, squares between and the king path follow from the layout', () => {
    expect(CASTLES[RED][0].between.map(squareName)).toEqual(['g1', 'f1', 'e1']);
    expect(CASTLES[RED][1].between.map(squareName)).toEqual(['i1', 'j1']);
    expect(CASTLES[YELLOW][0].between.map(squareName)).toEqual(['f14', 'e14']);
    expect(CASTLES[BLUE][1].between.map(squareName)).toEqual(['a9', 'a10']);
    expect(CASTLES[RED][0].kingPath.map(squareName)).toEqual(['h1', 'g1', 'f1']);
  });

  const red = (extra: string[] = [], opts = {}) => stateFromPieces(['rK@h1', 'rR@d1', 'rR@k1', 'bK@a8', 'yK@g14', 'gK@n7', ...extra], opts);
  const castles = (state: FourPlayerState) =>
    legalMoves(state, RED)
      .filter((m) => m.flags & FLAG_CASTLE)
      .map((m) => squareName(m.to))
      .sort();

  it('needs every square between king and rook empty', () => {
    expect(castles(red())).toEqual(['f1', 'j1']);
    expect(castles(red(['rB@j1']))).toEqual(['f1']);
    expect(castles(red(['rN@e1']))).toEqual(['j1']);
    expect(castles(red(['yN@g1']))).toEqual(['j1']);
  });

  it('is refused out of check, through an attacked square, or onto one — attacks from ANY other seat count', () => {
    expect(castles(red(['yR@h8']))).toEqual([]); // in check on the h file
    expect(castles(red(['yR@i10']))).toEqual(['f1']); // i1 (crossed) attacked: kingside refused
    expect(castles(red(['yR@j8']))).toEqual(['f1']); // j1 (landing) attacked
    expect(castles(red(['gR@f9']))).toEqual(['j1']); // f1 (landing) attacked by GREEN: queenside refused
    expect(castles(red(['yR@e10']))).toEqual(['f1', 'j1']); // e1 is crossed by the ROOK only, not the king: castling is still allowed
    expect(castles(red(['gR@n4']))).toEqual(['f1', 'j1']); // an irrelevant attacker changes nothing
  });

  it('is lost for good once the king moves, that rook moves, or that rook is captured', () => {
    const afterKing = playMove(red(), findLegalMove(red(), RED, parseSquare('h1'), parseSquare('h2'))!).state;
    expect(afterKing.castling & 3).toBe(0);
    const afterRook = applyMoveRaw(red(), findLegalMove(red(), RED, parseSquare('k1'), parseSquare('k2'))!);
    expect(afterRook.castling & 3).toBe(1); // the d1 side survives
    const captured = stateFromPieces(['rK@h1', 'rR@d1', 'rR@k1', 'yR@k10', 'bK@a8', 'yK@g14', 'gK@n7'], { turn: YELLOW });
    const takes = applyMoveRaw(captured, findLegalMove(captured, YELLOW, parseSquare('k10'), parseSquare('k1'))!);
    expect(takes.castling & 3).toBe(1);
  });

  it('an eliminated seat can no longer castle', () => {
    expect(castles(red([], { status: ['dead-king', 'active', 'active', 'active'] }))).toEqual([]);
  });
});

describe('en passant', () => {
  const step = (state: FourPlayerState, from: string, to: string) => applyMoveRaw(state, findLegalMove(state, state.turn, parseSquare(from), parseSquare(to))!);
  const epMoves = (state: FourPlayerState, seat: Seat) =>
    legalMoves(state, seat)
      .filter((m) => m.flags & FLAG_EN_PASSANT)
      .map((m) => `${squareName(m.from)}-${squareName(m.to)}`);

  it('a double step records the skipped square; an enemy pawn of ANOTHER seat (another direction) may capture onto it', () => {
    // Red steps e2-e4 over e3. Blue's pawn on d4 moves right and captures diagonally forward: d4xe3.
    const start = stateFromPieces([...KINGS, 'rP@e2', 'bP@d4']);
    const stepped = step(start, 'e2', 'e4');
    expect(stepped.ep).toEqual({ passed: parseSquare('e3'), pawn: parseSquare('e4'), by: RED });
    const blue = { ...stepped, turn: BLUE as Seat };
    expect(epMoves(blue, BLUE)).toEqual(['d4-e3']);
    // The capture removes the stepped pawn (which is NOT on the landing square) and scores a pawn.
    const taken = applyMoveRaw(blue, findLegalMove(blue, BLUE, parseSquare('d4'), parseSquare('e3'))!);
    expect(taken.cells[parseSquare('e4')]).toBe(0);
    expect(taken.cells[parseSquare('e3')]).toBe(BLUE * 8 + 1);
    expect(taken.cells[parseSquare('d4')]).toBe(0);
    expect(taken.score[BLUE]).toBe(1);
    expect(taken.ep).toBeNull();
  });

  it('works the other way round too: Blue steps b5-d5 over c5 and a Red pawn (moving up) takes it en passant from d4... or b4', () => {
    const start = stateFromPieces([...KINGS, 'bP@b5', 'rP@d4', 'rP@b4'], { turn: BLUE });
    const stepped = step(start, 'b5', 'd5');
    expect(stepped.ep).toEqual({ passed: parseSquare('c5'), pawn: parseSquare('d5'), by: BLUE });
    expect(epMoves({ ...stepped, turn: RED }, RED).sort()).toEqual(['b4-c5', 'd4-c5']);
    const red = { ...stepped, turn: RED as Seat };
    const taken = applyMoveRaw(red, findLegalMove(red, RED, parseSquare('d4'), parseSquare('c5'))!);
    expect(taken.cells[parseSquare('d5')]).toBe(0);
    expect(taken.cells[parseSquare('c5')]).toBe(RED * 8 + 1);
  });

  it("is only available on the very next applied move, never to the stepping seat's own pawns, and never after a single step", () => {
    const start = stateFromPieces([...KINGS, 'rP@e2', 'bP@d4', 'rP@f2']);
    const stepped = step(start, 'e2', 'e4');
    expect(epMoves({ ...stepped, turn: RED }, RED)).toEqual([]); // Red's own pawn on f2 may not
    // Yellow moves first (any move): by Blue's turn the opportunity is gone.
    const yellow = { ...stepped, turn: YELLOW as Seat };
    const later = applyMoveRaw(yellow, findLegalMove(yellow, YELLOW, parseSquare('g14'), parseSquare('g13'))!);
    expect(later.ep).toBeNull();
    expect(epMoves({ ...later, turn: BLUE }, BLUE)).toEqual([]);
    expect(step(start, 'e2', 'e3').ep).toBeNull();
  });

  it("cannot be played if it exposes the capturer's own king", () => {
    // Blue's king on b4 and a Green rook on k4 share rank 4 with Blue's pawn d4 and (after the step) Red's pawn e4. Taking en passant moves d4
    // off the rank AND removes e4: the rook would see the king.
    const start = stateFromPieces(['rK@h1', 'bK@b4', 'bP@d4', 'gR@k4', 'rP@e2', 'yK@g14', 'gK@n9']);
    const stepped = step(start, 'e2', 'e4');
    expect(isInCheck(stepped, BLUE)).toBe(false);
    expect(epMoves({ ...stepped, turn: BLUE }, BLUE)).toEqual([]);
  });
});

describe('labels', () => {
  it('describe quiet moves, captures and promotions', () => {
    const state = stateFromPieces([...KINGS, 'rP@e7', 'yN@f8']);
    const labels = legalMoves(state, RED)
      .filter((m) => m.from === parseSquare('e7'))
      .map(moveLabel)
      .sort();
    expect(labels).toEqual(['e7-e8=Q', 'e7xf8=Q']);
  });
});

// --- Differential test against chess.js --------------------------------------------------------------------------------

describe('movement and check detection agree with chess.js on an 8x8 window', () => {
  // Window: files d-k, ranks 4-11 of the 4-player board = chess.js a-h, 1-8. Two live seats, Red (= white, moves up) and Yellow
  // (= black, moves down); no pawns (their double-step and promotion lines differ from chess.js BY DESIGN) and no castling.
  // The 4-player engine's moves that leave the window (it has more board) are filtered out; every in-window move must match.
  function seeded(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const FILES = 'abcdefgh';
  const toWindow = (name: string) => `${FILES[name.charCodeAt(0) - 'd'.charCodeAt(0)]}${Number(name.slice(1)) - 3}`;
  const inWindow = (square: number) => fileOf(square) >= 3 && fileOf(square) <= 10 && rankOf(square) >= 3 && rankOf(square) <= 10;

  it('agrees on the legal moves and on "in check" over 1000 random positions', () => {
    const random = seeded(4242);
    let compared = 0;
    let checks = 0;
    let withMoves = 0;
    for (let n = 0; n < 1000; n++) {
      const squares: string[] = [];
      for (let f = 0; f < 8; f++) for (let r = 0; r < 8; r++) squares.push(`${'defghijk'[f]}${r + 4}`);
      const take = () => squares.splice(Math.floor(random() * squares.length), 1)[0];
      const pieces: string[] = [`rK@${take()}`, `yK@${take()}`];
      const extra = 2 + Math.floor(random() * 8);
      for (let i = 0; i < extra; i++) pieces.push(`${random() < 0.5 ? 'r' : 'y'}${'NBRQ'[Math.floor(random() * 4)]}@${take()}`);
      const turn: Seat = random() < 0.5 ? RED : YELLOW;
      const other: Seat = turn === RED ? YELLOW : RED;
      const state = stateFromPieces(pieces, { turn, castling: 0, status: ['active', 'frozen', 'active', 'frozen'] });
      if (isInCheck(state, other)) continue; // an illegal position (the side NOT to move is in check): chess.js would refuse it too

      const board: string[][] = Array.from({ length: 8 }, () => Array(8).fill(''));
      for (const spec of pieces) {
        const name = toWindow(spec.split('@')[1]);
        board[8 - Number(name[1])][FILES.indexOf(name[0])] = spec[0] === 'r' ? spec[1] : spec[1].toLowerCase();
      }
      const rows = board.map((row) => {
        let out = '';
        let empty = 0;
        for (const cell of row) {
          if (cell === '') empty++;
          else {
            if (empty) out += empty;
            empty = 0;
            out += cell;
          }
        }
        return out + (empty ? empty : '');
      });
      const chess = new Chess(`${rows.join('/')} ${turn === RED ? 'w' : 'b'} - - 0 1`);
      const expected = chess
        .moves({ verbose: true })
        .map((m) => `${m.from}-${m.to}`)
        .sort();
      const actual = legalMoves(state, turn)
        .filter((m) => inWindow(m.to))
        .map((m) => `${toWindow(squareName(m.from))}-${toWindow(squareName(m.to))}`)
        .sort();
      expect(actual, pieces.join(' ')).toEqual(expected);
      expect(isInCheck(state, turn), pieces.join(' ')).toBe(chess.inCheck());
      compared++;
      if (chess.inCheck()) checks++;
      if (expected.length > 0) withMoves++;
    }
    expect(compared).toBeGreaterThan(400);
    expect(checks).toBeGreaterThan(20); // the sample really contains check positions
    expect(withMoves).toBeGreaterThan(350);
  });
});
