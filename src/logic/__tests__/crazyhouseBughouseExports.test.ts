import { describe, expect, it } from 'vitest';
import { ChessEngine } from '../ChessEngine';
import {
  RESERVE_PIECE_TYPES,
  applyCrazyhouseMove,
  applyCrazyhouseMoveForPartner,
  cloneCrazyhouseState,
  creditCrazyhouseReserve,
  crazyhouseBankedPiece,
  crazyhouseCheckInfo,
  crazyhouseDropCouldAnswerCheck,
  getCrazyhouseMoves,
  initialCrazyhouseState,
  legalDropSquares,
  type CrazyhouseMoveInfo,
  type CrazyhouseState,
  type ReservePieceType,
} from '../crazyhouse';
import { mulberry32 } from './fourPlayerGoldenKit';
import { START_FEN } from '../../types/chess';

/**
 * The Bughouse additions to crazyhouse.ts (BUGHOUSE_SPEC.md W0): `crazyhouseBankedPiece`, `creditCrazyhouseReserve`, `applyCrazyhouseMoveForPartner` and
 * `crazyhouseDropCouldAnswerCheck`. They are pure additions: the existing functions they are built on are pinned by crazyhouse*.test.ts and the Crazyhouse golden, and these
 * tests pin the new ones - by hand-built cases (constants are LITERALS here) and by differential checks against the functions they must agree with.
 */
const T: ReservePieceType[] = ['p', 'n', 'b', 'r', 'q'];

const stateWith = (w: Partial<Record<ReservePieceType, number>>, b: Partial<Record<ReservePieceType, number>>, promoted: string[] = []): CrazyhouseState => {
  const s = initialCrazyhouseState();
  Object.assign(s.reserve.w, w);
  Object.assign(s.reserve.b, b);
  s.promoted = promoted;
  return s;
};
const engineAt = (fen: string) => new ChessEngine(fen, { crazyhouse: true, crazyhouseState: initialCrazyhouseState() });
const couldAnswer = (fen: string, color: 'w' | 'b', king: string) => {
  const engine = engineAt(fen);
  return crazyhouseDropCouldAnswerCheck(king, color, (sq) => engine.getPieceAt(sq));
};

describe('crazyhouseBankedPiece', () => {
  it('a plain capture banks the captured type', () => {
    for (const type of T) expect(crazyhouseBankedPiece(initialCrazyhouseState(), { from: 'e4', to: 'd5', captured: type })).toBe(type);
  });

  it('a captured PROMOTED piece banks a pawn, whatever it had become', () => {
    for (const type of ['n', 'b', 'r', 'q']) expect(crazyhouseBankedPiece(stateWith({}, {}, ['d5']), { from: 'e4', to: 'd5', captured: type })).toBe('p');
  });

  it('a promoted mark on another square changes nothing - including the square the capturer comes from', () => {
    expect(crazyhouseBankedPiece(stateWith({}, {}, ['d6', 'a1']), { from: 'e4', to: 'd5', captured: 'q' })).toBe('q');
    expect(crazyhouseBankedPiece(stateWith({}, {}, ['e4']), { from: 'e4', to: 'd5', captured: 'q' })).toBe('q'); // the capturer itself is a promoted piece: the captured one is not
  });

  it('a move that captures nothing banks nothing; a king and an unknown type are not banked', () => {
    expect(crazyhouseBankedPiece(initialCrazyhouseState(), { from: 'e2', to: 'e4' })).toBeNull();
    expect(crazyhouseBankedPiece(stateWith({}, {}, ['e4']), { from: 'e2', to: 'e4' })).toBeNull();
    expect(crazyhouseBankedPiece(initialCrazyhouseState(), { from: 'e4', to: 'd5', captured: 'k' })).toBeNull();
    expect(crazyhouseBankedPiece(initialCrazyhouseState(), { from: 'e4', to: 'd5', captured: 'x' })).toBeNull();
  });

  it('an en passant capture banks a pawn - whatever promoted marks exist, which is why the choice of the captured square is irrelevant here (the proof that keeps one mutant equivalent)', () => {
    expect(crazyhouseBankedPiece(initialCrazyhouseState(), { from: 'e5', to: 'd6', captured: 'p', enPassant: true })).toBe('p');
    for (const marks of [['d6'], ['d5'], ['d5', 'd6'], ['e5']]) expect(crazyhouseBankedPiece(stateWith({}, {}, marks), { from: 'e5', to: 'd6', captured: 'p', enPassant: true }), marks.join()).toBe('p');
  });

  it('agrees with applyCrazyhouseMove on 600 random states and captures: the reserve delta of the mover IS the banked piece', () => {
    const rng = mulberry32(77);
    const squares = ['a1', 'b3', 'c4', 'd5', 'e6', 'f7', 'g8', 'h2'];
    for (let i = 0; i < 600; i++) {
      const promoted = squares.filter(() => rng() < 0.4);
      const state = stateWith({ p: Math.floor(rng() * 3), q: Math.floor(rng() * 3) }, { n: Math.floor(rng() * 3) }, promoted);
      const to = squares[Math.floor(rng() * squares.length)];
      const captured = [undefined, 'p', 'n', 'b', 'r', 'q', 'k'][Math.floor(rng() * 7)];
      const enPassant = captured === 'p' && rng() < 0.3;
      const move: CrazyhouseMoveInfo = { from: enPassant ? `${String.fromCharCode(to.charCodeAt(0) + 1)}${Number(to[1]) - 1}` : 'e1', to, captured, enPassant };
      if (enPassant && !/^[a-h][1-8]$/.test(move.from)) continue;
      const mover = rng() < 0.5 ? 'w' : 'b';
      const banked = crazyhouseBankedPiece(state, move);
      const after = applyCrazyhouseMove(state, mover, move);
      for (const t of T) expect(after.reserve[mover][t] - state.reserve[mover][t], `${JSON.stringify(move)} ${t}`).toBe(banked === t ? 1 : 0);
    }
  });
});

describe('creditCrazyhouseReserve', () => {
  it('adds one piece to the named colour and type only, and returns a new object', () => {
    const state = stateWith({ p: 1 }, { n: 2 }, ['c3']);
    const next = creditCrazyhouseReserve(state, 'b', 'q');
    expect(next.reserve.b).toEqual({ p: 0, n: 2, b: 0, r: 0, q: 1 });
    expect(next.reserve.w).toEqual({ p: 1, n: 0, b: 0, r: 0, q: 0 });
    expect(next.promoted).toEqual(['c3']);
    expect(next).not.toBe(state);
    expect(state.reserve.b.q).toBe(0);
    expect(creditCrazyhouseReserve(state, 'w', 'p').reserve.w.p).toBe(2);
  });

  it('copies the promoted marks (changing the result never changes the input)', () => {
    const state = stateWith({}, {}, ['c3']);
    const next = creditCrazyhouseReserve(state, 'w', 'n');
    next.promoted.push('h8');
    next.reserve.w.n = 99;
    expect(state.promoted).toEqual(['c3']);
    expect(state.reserve.w.n).toBe(0);
  });

  it('a piece type the reserve has no slot for changes nothing', () => {
    const state = stateWith({ p: 1 }, {});
    for (const junk of ['k', 'x', '']) expect(creditCrazyhouseReserve(state, 'w', junk as ReservePieceType)).toEqual(state);
  });
});

describe('applyCrazyhouseMoveForPartner', () => {
  it('a capture is NOT banked by the mover: both reserves stay as they were and the piece is reported', () => {
    const state = stateWith({ n: 1 }, { b: 1 });
    const result = applyCrazyhouseMoveForPartner(state, 'w', { from: 'e4', to: 'd5', captured: 'q' });
    expect(result.banked).toBe('q');
    expect(result.state.reserve).toEqual(state.reserve);
  });

  it('a promoted piece captured is reported as a pawn, and its mark leaves the board state', () => {
    const state = stateWith({}, {}, ['d5', 'a8']);
    const result = applyCrazyhouseMoveForPartner(state, 'b', { from: 'e4', to: 'd5', captured: 'q' });
    expect(result.banked).toBe('p');
    expect(result.state.promoted).toEqual(['a8']);
  });

  it('promotion, a promoted piece moving and castling carry the marks exactly as applyCrazyhouseMove does', () => {
    const moves: [CrazyhouseState, CrazyhouseMoveInfo][] = [
      [stateWith({}, {}), { from: 'a7', to: 'a8', promotion: 'q' }],
      [stateWith({}, {}, ['a8']), { from: 'a8', to: 'h8' }],
      [stateWith({}, {}, ['h1']), { from: 'e1', to: 'g1', castleRook: { from: 'h1', to: 'f1' } }],
      [stateWith({}, {}, ['b4']), { from: 'c3', to: 'b4', captured: 'b' }],
      [stateWith({}, {}), { from: 'e5', to: 'd6', captured: 'p', enPassant: true }],
    ];
    for (const [state, move] of moves) {
      for (const mover of ['w', 'b'] as const) {
        const partner = applyCrazyhouseMoveForPartner(state, mover, move);
        const own = applyCrazyhouseMove(state, mover, move);
        expect(partner.state.promoted, JSON.stringify(move)).toEqual(own.promoted);
        expect(partner.state.reserve[mover === 'w' ? 'b' : 'w']).toEqual(own.reserve[mover === 'w' ? 'b' : 'w']);
        expect(partner.state.reserve[mover]).toEqual(state.reserve[mover]);
      }
    }
  });

  it('never changes its input, and the result shares nothing with it', () => {
    const state = stateWith({ p: 2 }, { q: 1 }, ['d5']);
    const snapshot = JSON.parse(JSON.stringify(state)) as CrazyhouseState;
    const result = applyCrazyhouseMoveForPartner(state, 'w', { from: 'e4', to: 'd5', captured: 'r' });
    expect(state).toEqual(snapshot);
    result.state.reserve.w.p = 9;
    result.state.promoted.push('h1');
    expect(state).toEqual(snapshot);
  });

  it('agrees with applyCrazyhouseMove over whole seeded games: same marks, same opponent reserve, the mover keeps its reserve, banked = the mover\'s delta', () => {
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const rng = mulberry32(seed);
      const engine = new ChessEngine(START_FEN, { crazyhouse: true, crazyhouseState: initialCrazyhouseState() });
      let reserveBank = 0;
      for (let ply = 0; ply < 120 && !engine.isGameOver(); ply++) {
        const mover = engine.getTurn();
        const drops = engine.getLegalDrops();
        if (drops.length > 0 && rng() < 0.3) {
          const d = drops[Math.floor(rng() * drops.length)];
          engine.drop(d.piece, d.square);
          continue;
        }
        const moves = getCrazyhouseMoves(engine);
        if (moves.length === 0) break;
        // prefer captures so that banking is exercised
        const captures = moves.filter((m) => m.captured);
        const pool = captures.length > 0 && rng() < 0.6 ? captures : moves;
        const m = pool[Math.floor(rng() * pool.length)];
        const before = engine.getCrazyhouseState();
        const piece = engine.getPieceAt(m.from);
        const info: CrazyhouseMoveInfo = {
          from: m.from,
          to: m.to,
          promotion: m.promotion,
          captured: m.captured,
          enPassant: piece?.type === 'p' && m.from[0] !== m.to[0] && !engine.getPieceAt(m.to),
          castleRook: piece?.type === 'k' && Math.abs(m.from.charCodeAt(0) - m.to.charCodeAt(0)) === 2 ? (m.to[0] === 'g' ? { from: `h${m.from[1]}`, to: `f${m.from[1]}` } : { from: `a${m.from[1]}`, to: `d${m.from[1]}` }) : undefined,
        };
        const own = applyCrazyhouseMove(before, mover, info);
        const partner = applyCrazyhouseMoveForPartner(before, mover, info);
        expect(partner.state.promoted).toEqual(own.promoted);
        expect(partner.state.reserve[mover]).toEqual(before.reserve[mover]);
        const other = mover === 'w' ? 'b' : 'w';
        expect(partner.state.reserve[other]).toEqual(own.reserve[other]);
        for (const t of T) expect(own.reserve[mover][t] - before.reserve[mover][t]).toBe(partner.banked === t ? 1 : 0);
        if (partner.banked) reserveBank++;
        engine.move(m.from, m.to, m.promotion);
        // the engine's own bookkeeping is the authority for the marks
        expect(engine.getCrazyhouseState().promoted).toEqual(own.promoted);
      }
      expect(reserveBank, `seed ${seed} banked something`).toBeGreaterThan(0);
    }
  });
});

describe('crazyhouseDropCouldAnswerCheck', () => {
  it('one sliding check with empty squares between: a drop could answer it (rook, bishop, queen; one square is enough)', () => {
    expect(couldAnswer('4k3/8/8/8/8/8/8/r3K3 w - - 0 1', 'w', 'e1')).toBe(true); // rook a1: b1 c1 d1 between
    expect(couldAnswer('4k3/8/8/8/8/8/8/2r1K3 w - - 0 1', 'w', 'e1')).toBe(true); // rook c1: only d1 between
    expect(couldAnswer('4k3/8/8/b7/8/8/8/4K3 w - - 0 1', 'w', 'e1')).toBe(true); // bishop a5: b4 c3 d2 between
    expect(couldAnswer('4k3/8/8/8/8/2b5/8/4K3 w - - 0 1', 'w', 'e1')).toBe(true); // bishop c3: only d2 between
    expect(couldAnswer('7k/8/8/4q3/8/8/8/4K3 w - - 0 1', 'w', 'e1')).toBe(true); // queen e5: e2 e3 e4 between
  });

  it('a slider with nothing between, and a slider that does not attack the king, are false', () => {
    expect(couldAnswer('4k3/8/8/8/8/8/3b4/4K3 w - - 0 1', 'w', 'e1')).toBe(false); // bishop d2, adjacent
    expect(couldAnswer('4k3/8/8/8/8/8/8/b3K3 w - - 0 1', 'w', 'e1')).toBe(false); // a bishop on the king's rank does not attack it
    expect(couldAnswer('4k3/8/8/8/8/8/8/r1N1K3 w - - 0 1', 'w', 'e1')).toBe(false); // the rook is blocked by White's own knight: no check
  });

  it('a knight check, a pawn check, an adjacent slider and a double check can never be answered by a drop', () => {
    expect(couldAnswer('4k3/8/8/8/8/3n4/8/4K3 w - - 0 1', 'w', 'e1')).toBe(false); // knight d3
    expect(couldAnswer('4k3/8/8/8/8/8/3p4/4K3 w - - 0 1', 'w', 'e1')).toBe(false); // pawn d2
    expect(couldAnswer('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1', 'w', 'e1')).toBe(false); // rook e2, adjacent
    expect(couldAnswer('k3r3/8/8/8/8/3n4/8/4K3 w - - 0 1', 'w', 'e1')).toBe(false); // rook e8 and knight d3: double check
    expect(couldAnswer('k3r3/8/8/8/8/8/8/r3K3 w - - 0 1', 'w', 'e1')).toBe(false); // two rooks (e8 and a1) both slide: double check, each blockable alone
  });

  it('not being in check is false, for either colour', () => {
    expect(couldAnswer(START_FEN, 'w', 'e1')).toBe(false);
    expect(couldAnswer(START_FEN, 'b', 'e8')).toBe(false);
    expect(couldAnswer('4k3/8/8/8/8/8/8/r3K3 w - - 0 1', 'b', 'e8')).toBe(false); // the rook checks White; Black's king is not in check
  });

  it('the black king: a rook check down the file', () => {
    expect(couldAnswer('4k3/8/8/8/8/8/8/4RK2 b - - 0 1', 'b', 'e8')).toBe(true); // rook e1 checks e8, e2..e7 between
    expect(couldAnswer('4k3/4R3/8/8/8/8/8/5K2 b - - 0 1', 'b', 'e8')).toBe(false); // rook e7 adjacent
  });

  it('agrees with legalDropSquares on 3000 seeded positions: in check, a drop could answer it exactly when a reserve holding every piece but a pawn has a legal drop', () => {
    const everything = stateWith({ n: 1, b: 1, r: 1, q: 1 }, { n: 1, b: 1, r: 1, q: 1 });
    let checks = 0;
    let answerable = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const rng = mulberry32(seed * 31);
      const engine = new ChessEngine(START_FEN, { crazyhouse: true, crazyhouseState: initialCrazyhouseState() });
      for (let ply = 0; ply < 90 && !engine.isGameOver(); ply++) {
        const moves = getCrazyhouseMoves(engine);
        if (moves.length === 0) break;
        const captures = moves.filter((m) => m.captured);
        const pool = captures.length > 0 && rng() < 0.4 ? captures : moves;
        const m = pool[Math.floor(rng() * pool.length)];
        engine.move(m.from, m.to, m.promotion);
        for (const color of ['w', 'b'] as const) {
          let king: string | null = null;
          for (const row of engine.getBoard()) for (const cell of row) if (cell.piece?.type === 'k' && cell.piece.color === color) king = cell.square;
          if (!king) continue;
          const pieceAt = (sq: string) => engine.getPieceAt(sq);
          const info = crazyhouseCheckInfo(king, color, pieceAt);
          const result = crazyhouseDropCouldAnswerCheck(king, color, pieceAt);
          if (info.checkers === 0) {
            expect(result).toBe(false);
            continue;
          }
          checks++;
          const legal = legalDropSquares(everything, color, 'q', pieceAt).length > 0;
          expect(result, `${engine.getFen()} ${color}`).toBe(legal);
          if (result) answerable++;
        }
      }
    }
    expect(checks).toBeGreaterThan(100); // the walk really reaches checks
    expect(answerable).toBeGreaterThan(20); // and some of them can be blocked
  });

  it('every reserve type can use the answer (a rook check with squares between: a knight, bishop, rook and queen can all block somewhere)', () => {
    const engine = engineAt('4k3/8/8/8/8/8/8/r3K3 w - - 0 1');
    const pieceAt = (sq: string) => engine.getPieceAt(sq);
    for (const t of ['n', 'b', 'r', 'q'] as ReservePieceType[]) {
      const state = stateWith({ [t]: 1 }, {});
      expect(legalDropSquares(state, 'w', t, pieceAt).sort()).toEqual(['b1', 'c1', 'd1']);
    }
    expect(legalDropSquares(stateWith({ p: 1 }, {}), 'w', 'p', pieceAt)).toEqual([]); // a pawn can never block on rank 1 - the "could ever" question is about any piece
    expect(crazyhouseDropCouldAnswerCheck('e1', 'w', pieceAt)).toBe(true);
  });

  it('does not change a state or the cloning helper it sits next to (a sanity check that the additions are pure)', () => {
    const state = stateWith({ p: 1 }, { q: 1 }, ['a8']);
    const copy = cloneCrazyhouseState(state);
    crazyhouseBankedPiece(state, { from: 'a1', to: 'a8', captured: 'q' });
    applyCrazyhouseMoveForPartner(state, 'w', { from: 'a1', to: 'a8', captured: 'q' });
    creditCrazyhouseReserve(state, 'w', 'p');
    expect(state).toEqual(copy);
    expect(RESERVE_PIECE_TYPES).toEqual(['p', 'n', 'b', 'r', 'q']);
  });
});
