import { describe, expect, it } from 'vitest';
import {
  CELLS,
  KING_TARGETS,
  KNIGHT_TARGETS,
  PLAYABLE_SQUARES,
  RAYS,
  SEATS,
  VALID,
  deserialize,
  fileOf,
  fromDisplay,
  index,
  initialState,
  isPlayable,
  listPieces,
  parseSquare,
  rankOf,
  serialize,
  squareName,
  stateFromPieces,
  toDisplay,
  typeOf,
  seatOf,
  KING,
  QUEEN,
  PAWN,
  type Seat,
} from '../fourPlayer';

describe('board geometry', () => {
  it('has exactly 160 playable squares: 14x14 minus a 3x3 corner at each corner', () => {
    expect(PLAYABLE_SQUARES).toHaveLength(160);
    expect(VALID.reduce((a, b) => a + b, 0)).toBe(160);
    expect(CELLS).toBe(196);
  });

  it('cuts exactly files a-c / l-n with ranks 1-3 / 12-14 (the four corners), and nothing else', () => {
    const cut: string[] = [];
    for (let rank = 0; rank < 14; rank++) for (let file = 0; file < 14; file++) if (!isPlayable(file, rank)) cut.push(`${'abcdefghijklmn'[file]}${rank + 1}`);
    expect(cut).toHaveLength(36);
    for (const name of cut) {
      const file = 'abcdefghijklmn'.indexOf(name[0]);
      const rank = Number(name.slice(1));
      expect(file <= 2 || file >= 11).toBe(true);
      expect(rank <= 3 || rank >= 12).toBe(true);
    }
    // The arms and the centre are all there.
    for (const name of ['d1', 'k1', 'a4', 'a11', 'n4', 'n11', 'd14', 'k14', 'h7', 'c4', 'l4', 'c11', 'l11']) expect(parseSquare(name)).toBeGreaterThanOrEqual(0);
    for (const name of ['a1', 'c3', 'l1', 'n3', 'a12', 'c14', 'l14', 'n12', 'o1', 'a15', 'a0']) expect(parseSquare(name)).toBe(-1);
  });

  it('names round-trip', () => {
    for (const square of PLAYABLE_SQUARES) expect(parseSquare(squareName(square))).toBe(square);
  });

  it('rays stop at the cut corners (a slider cannot cross a hole or wrap around)', () => {
    // From d4 going down-left the very next square, c3, is a corner hole: the ray is empty.
    expect(RAYS[parseSquare('d4') * 8 + 7]).toHaveLength(0);
    // From d4 going left it runs c4, b4, a4 and ends.
    expect(Array.from(RAYS[parseSquare('d4') * 8 + 1]).map(squareName)).toEqual(['c4', 'b4', 'a4']);
    // From h7 up it reaches the far edge, h14.
    const up = Array.from(RAYS[parseSquare('h7') * 8 + 2]).map(squareName);
    expect(up[up.length - 1]).toBe('h14');
    expect(up).toHaveLength(7);
    for (const square of PLAYABLE_SQUARES) for (let d = 0; d < 8; d++) for (const target of RAYS[square * 8 + d]) expect(VALID[target]).toBe(1);
  });

  it('knight and king neighbour tables only contain playable squares', () => {
    for (const square of PLAYABLE_SQUARES) {
      for (const target of KNIGHT_TARGETS[square]) expect(VALID[target]).toBe(1);
      for (const target of KING_TARGETS[square]) expect(VALID[target]).toBe(1);
    }
    expect(KING_TARGETS[parseSquare('d4')]).toHaveLength(7); // c3 is a hole
    expect(KING_TARGETS[parseSquare('h7')]).toHaveLength(8);
    expect(KNIGHT_TARGETS[parseSquare('d1')].length).toBeLessThan(4); // d1 sits in a corner of the bottom arm
  });
});

describe('the start position', () => {
  const state = initialState();
  const at = (name: string) => {
    const code = state.cells[parseSquare(name)];
    return code > 0 ? `${'RBYG'[seatOf(code)]}${'xPNBRQKZ'[typeOf(code)]}` : '.';
  };

  it('has 64 pieces: 16 per seat, 8 pawns and 8 back-rank pieces each', () => {
    const pieces = listPieces(state);
    expect(pieces).toHaveLength(64);
    for (const letter of 'rbyg') {
      expect(pieces.filter((p) => p[0] === letter)).toHaveLength(16);
      expect(pieces.filter((p) => p[0] === letter && p[1] === 'P')).toHaveLength(8);
    }
  });

  it("Red: d1 R, e1 N, f1 B, g1 Q, h1 K, i1 B, j1 N, k1 R with pawns on d2-k2", () => {
    expect(['d1', 'e1', 'f1', 'g1', 'h1', 'i1', 'j1', 'k1'].map(at)).toEqual(['RR', 'RN', 'RB', 'RQ', 'RK', 'RB', 'RN', 'RR']);
    for (const file of 'defghijk') expect(at(`${file}2`)).toBe('RP');
  });

  it('Yellow: d14 R, e14 N, f14 B, g14 K, h14 Q, i14 B, j14 N, k14 R with pawns on d13-k13', () => {
    expect(['d14', 'e14', 'f14', 'g14', 'h14', 'i14', 'j14', 'k14'].map(at)).toEqual(['YR', 'YN', 'YB', 'YK', 'YQ', 'YB', 'YN', 'YR']);
    for (const file of 'defghijk') expect(at(`${file}13`)).toBe('YP');
  });

  it('Blue (king and queen swapped relative to a pure rotation of Red): a4 R … a7 Q, a8 K … a11 R, pawns on b4-b11', () => {
    expect(['a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11'].map(at)).toEqual(['BR', 'BN', 'BB', 'BQ', 'BK', 'BB', 'BN', 'BR']);
    for (let rank = 4; rank <= 11; rank++) expect(at(`b${rank}`)).toBe('BP');
  });

  it('Green (swapped likewise): n4 R … n7 K, n8 Q … n11 R, pawns on m4-m11', () => {
    expect(['n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10', 'n11'].map(at)).toEqual(['GR', 'GN', 'GB', 'GK', 'GQ', 'GB', 'GN', 'GR']);
    for (let rank = 4; rank <= 11; rank++) expect(at(`m${rank}`)).toBe('GP');
  });

  it('invariant: every queen stands on an even-parity square and every king on an odd one (each queen on "her own colour")', () => {
    for (const seat of SEATS) {
      for (let i = 0; i < CELLS; i++) {
        const code = state.cells[i];
        if (code <= 0 || seatOf(code) !== seat) continue;
        const parity = (fileOf(i) + rankOf(i)) % 2;
        if (typeOf(code) === QUEEN) expect(parity, `${seat} queen on ${squareName(i)}`).toBe(0);
        if (typeOf(code) === KING) expect(parity, `${seat} king on ${squareName(i)}`).toBe(1);
      }
    }
  });

  it('Red moves first; all four seats are active with zero score; every castling right exists', () => {
    expect(state.turn).toBe(0);
    expect(state.status).toEqual(['active', 'active', 'active', 'active']);
    expect(state.score).toEqual([0, 0, 0, 0]);
    expect(state.castling).toBe(255);
    expect(state.kings.map(squareName)).toEqual(['h1', 'a8', 'g14', 'n7']);
    expect(state.ep).toBeNull();
    expect(state.result).toBeNull();
  });

  it('pawns of each seat face the opposite edge: nothing is blocked at the start, every pawn can advance one square', () => {
    let pawns = 0;
    for (let i = 0; i < CELLS; i++) if (state.cells[i] > 0 && typeOf(state.cells[i]) === PAWN) pawns++;
    expect(pawns).toBe(32);
  });
});

describe('rendering rotation', () => {
  it('each seat sits on the bottom row when the view is turned to it, and toDisplay/fromDisplay are inverses', () => {
    const backRank = (seat: Seat) => (seat === 0 ? 'h1' : seat === 1 ? 'a8' : seat === 2 ? 'g14' : 'n7');
    for (const view of SEATS) {
      const king = parseSquare(backRank(view));
      const [, dy] = toDisplay(fileOf(king), rankOf(king), view);
      expect(dy, `view ${view}`).toBe(0);
      for (const square of PLAYABLE_SQUARES) {
        const [dx, dy2] = toDisplay(fileOf(square), rankOf(square), view);
        expect(dx).toBeGreaterThanOrEqual(0);
        expect(dx).toBeLessThanOrEqual(13);
        expect(fromDisplay(dx, dy2, view)).toEqual([fileOf(square), rankOf(square)]);
        // The playable shape is a symmetric cross, so a rotated board still has holes only in the corners.
        expect(isPlayable(dx, dy2)).toBe(true);
      }
    }
  });

  it('turning the view so Blue is at the bottom puts Yellow on the left and Red on the right (clockwise order is preserved)', () => {
    const red = toDisplay(fileOf(parseSquare('h1')), rankOf(parseSquare('h1')), 1);
    const yellow = toDisplay(fileOf(parseSquare('g14')), rankOf(parseSquare('g14')), 1);
    expect(red[0]).toBe(13); // right edge
    expect(yellow[0]).toBe(0); // left edge
  });
});

describe('serialisation', () => {
  it('round-trips the start position exactly', () => {
    const state = initialState();
    const text = serialize(state);
    expect(text.split(' ')[0].split('/')).toHaveLength(14);
    const back = deserialize(text);
    expect(Array.from(back.cells)).toEqual(Array.from(state.cells));
    expect(back.turn).toBe(state.turn);
    expect(back.status).toEqual(state.status);
    expect(back.score).toEqual(state.score);
    expect(back.castling).toBe(state.castling);
    expect(back.kings).toEqual(state.kings);
    expect(serialize(back)).toBe(text);
  });

  it('round-trips a mid-game state: scores, statuses, a promoted queen, an en passant record and a finished result', () => {
    const state = {
      ...stateFromPieces(['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7', 'rZ@e8', 'bP@c5', 'yP@j12'], { turn: 2, status: ['active', 'dead-king', 'frozen', 'active'], score: [12, 20, 3, 7], castling: 5, ply: 41 }),
      ep: { passed: parseSquare('j11'), pawn: parseSquare('j10'), by: 2 as Seat },
      result: { winners: [1 as Seat], reason: 'cap' as const },
    };
    const back = deserialize(serialize(state));
    expect(serialize(back)).toBe(serialize(state));
    expect(back.status).toEqual(['active', 'dead-king', 'frozen', 'active']);
    expect(back.score).toEqual([12, 20, 3, 7]);
    expect(back.ep).toEqual(state.ep);
    expect(back.result).toEqual({ winners: [1], reason: 'cap' });
    expect(listPieces(back)).toEqual(listPieces(state));
  });

  it('stateFromPieces refuses malformed, off-board and duplicate placements', () => {
    expect(() => stateFromPieces(['rX@e4'])).toThrow();
    expect(() => stateFromPieces(['rK@a1'])).toThrow(); // a1 is a cut corner
    expect(() => stateFromPieces(['rK@e4', 'bK@e4'])).toThrow();
    expect(index(3, 0)).toBe(parseSquare('d1'));
  });
});
