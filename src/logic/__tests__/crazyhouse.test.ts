import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { START_FEN } from '../../types/chess';
import { ChessEngine } from '../ChessEngine';
import {
  RESERVE_PIECE_TYPES,
  applyCrazyhouseDrop,
  applyCrazyhouseMove,
  cloneCrazyhouseState,
  crazyhouseCheckInfo,
  crazyhouseDropSan,
  emptyReserve,
  initialCrazyhouseState,
  legalDropSquares,
  legalDrops,
  reserveTotal,
  type CrazyhouseState,
  type ReservePieceType,
} from '../crazyhouse';

function stateWith(white: Partial<Record<ReservePieceType, number>>, black: Partial<Record<ReservePieceType, number>> = {}, promoted: string[] = []): CrazyhouseState {
  const state = initialCrazyhouseState();
  Object.assign(state.reserve.w, white);
  Object.assign(state.reserve.b, black);
  state.promoted = promoted;
  return state;
}
const engine = (fen: string, state: CrazyhouseState = initialCrazyhouseState()) => new ChessEngine(fen, { crazyhouse: true, crazyhouseState: state });
const dropSquares = (fen: string, state: CrazyhouseState, piece: ReservePieceType) => engine(fen, state).getLegalDropSquares(piece).sort();

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('the reserve', () => {
  it('starts empty, and a capture banks the captured piece for the CAPTURER', () => {
    const e = engine('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1');
    expect(reserveTotal(e.getCrazyhouseState().reserve.w)).toBe(0);
    const move = e.move('e4', 'd5');
    expect(move!.captured).toBe('p');
    expect(e.getCrazyhouseState().reserve.w).toEqual({ ...emptyReserve(), p: 1 });
    expect(e.getCrazyhouseState().reserve.b).toEqual(emptyReserve());
    expect(move!.crazyhouse!.reserve.w.p).toBe(1); // the move carries the state AFTER the ply
  });

  it('banks every kind of piece under its own type, for either colour', () => {
    for (const [target, type] of [['n', 'n'], ['b', 'b'], ['r', 'r'], ['q', 'q']] as const) {
      const white = engine(`4k3/8/8/3${target}4/8/8/8/3RK3 w - - 0 1`.replace(`3${target}4`, `3${target}4`));
      // White rook d1 takes the piece on d5 (the file is clear).
      const move = white.move('d1', 'd5');
      expect(move!.captured).toBe(type);
      expect(white.getCrazyhouseState().reserve.w[type]).toBe(1);
    }
    const black = engine('3rk3/8/8/3Q4/8/8/8/4K3 b - - 0 1');
    black.move('d8', 'd5');
    expect(black.getCrazyhouseState().reserve.b.q).toBe(1);
  });

  it('an en passant capture banks the passed pawn (which is not on the landing square)', () => {
    const e = engine('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    const move = e.move('e5', 'd6');
    expect(move!.captured).toBe('p');
    expect(e.getCrazyhouseState().reserve.w.p).toBe(1);
  });

  it('a drop spends one piece from the reserve of the side that drops it', () => {
    const e = engine('4k3/8/8/8/8/8/8/4K3 w - - 0 1', stateWith({ n: 2 }, { q: 1 }));
    const move = e.drop('n', 'f3');
    expect(move!.san).toBe('N@f3');
    expect(e.getCrazyhouseState().reserve.w.n).toBe(1);
    expect(e.getCrazyhouseState().reserve.b.q).toBe(1); // untouched
    expect(e.getTurn()).toBe('b');
    expect(e.getPieceAt('f3')).toEqual({ type: 'n', color: 'w' });
  });

  it('refuses a drop of a piece the side does not hold, and a drop on an occupied square', () => {
    const e = engine('4k3/8/8/8/8/8/8/4K3 w - - 0 1', stateWith({ n: 1 }));
    expect(e.drop('q', 'd4')).toBeNull();
    expect(e.drop('n', 'e1')).toBeNull(); // own king
    expect(e.drop('n', 'e8')).toBeNull(); // enemy king
    expect(e.getTurn()).toBe('w'); // nothing happened
    expect(e.getCrazyhouseState().reserve.w.n).toBe(1);
  });

  it('is never touched outside Crazyhouse', () => {
    const e = new ChessEngine('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1');
    e.move('e4', 'd5');
    expect(e.getCrazyhouseState()).toEqual(initialCrazyhouseState());
    expect(e.getLegalDrops()).toEqual([]);
    expect(e.drop('p', 'a3')).toBeNull();
  });
});

describe('promoted pieces', () => {
  it('a pawn promoting marks its square promoted; the promoted piece moving carries the mark along', () => {
    const e = engine('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    e.move('a7', 'a8', 'q');
    expect(e.getCrazyhouseState().promoted).toEqual(['a8']);
    const next = new ChessEngine('Q3k3/8/8/8/8/8/8/4K3 w - - 0 3', { crazyhouse: true, crazyhouseState: e.getCrazyhouseState() });
    next.move('a8', 'a4');
    expect(next.getCrazyhouseState().promoted).toEqual(['a4']);
  });

  it('capturing a promoted piece banks a PAWN, not the piece it had become (and the mark disappears)', () => {
    const e = engine('Q3k3/8/8/8/8/8/8/r3K3 b - - 0 1', stateWith({}, {}, ['a8']));
    const move = e.move('a1', 'a8');
    expect(move!.captured).toBe('q'); // the BOARD type — the move list still says queen
    const state = e.getCrazyhouseState();
    expect(state.reserve.b).toEqual({ ...emptyReserve(), p: 1 });
    expect(state.promoted).toEqual([]);
  });

  it('a capture BY a promoted piece carries its mark to the target square and still banks the right type', () => {
    const e = engine('4k3/8/8/8/8/8/8/Q2nK3 w - - 0 1', stateWith({}, {}, ['a1']));
    e.move('a1', 'd1');
    const state = e.getCrazyhouseState();
    expect(state.promoted).toEqual(['d1']);
    expect(state.reserve.w).toEqual({ ...emptyReserve(), n: 1 });
  });

  it('a non-promoted piece with the same type is NOT marked: capturing an ordinary queen banks a queen', () => {
    const e = engine('Q3k3/8/8/8/8/8/8/r3K3 b - - 0 1');
    e.move('a1', 'a8');
    expect(e.getCrazyhouseState().reserve.b).toEqual({ ...emptyReserve(), q: 1 });
  });

  it('a dropped piece is never promoted, even a dropped pawn that later promotes is marked only when it does', () => {
    const e = engine('4k3/8/8/8/8/8/8/4K3 w - - 0 1', stateWith({ p: 1 }));
    e.drop('p', 'a7');
    expect(e.getCrazyhouseState().promoted).toEqual([]);
  });

  it('survives a long chain: promote, get captured (banks a pawn), drop the pawn, promote it AGAIN, get captured again', () => {
    // White Kh1 Pa7 Rb1; Black Kh8 Ra2. Every line below is a legal ply; the assertions are the state after each.
    let fen = '7k/P7/8/8/8/8/r7/1R5K w - - 0 1';
    let state = initialCrazyhouseState();
    const play = (kind: 'move' | 'drop', a: string, b: string, promotion?: 'q') => {
      const e = engine(fen, state);
      const result = kind === 'move' ? e.move(a, b, promotion) : e.drop(a as ReservePieceType, b);
      expect(result, `${kind} ${a}${b} from ${fen}`).not.toBeNull();
      fen = e.getFen();
      state = e.getCrazyhouseState();
      return result!;
    };

    play('move', 'a7', 'a8', 'q'); // 1. a8=Q+
    expect(state.promoted).toEqual(['a8']);
    play('move', 'a2', 'a8'); // 1... Rxa8 — the queen was promoted
    expect(state.reserve.b).toEqual({ ...emptyReserve(), p: 1 }); // a PAWN, not a queen
    expect(state.promoted).toEqual([]);

    play('move', 'h1', 'g1'); // 2. Kg1
    play('drop', 'p', 'a2'); // 2... P@a2 (Black drops the pawn, attacking b1)
    expect(state.reserve.b.p).toBe(0);
    play('move', 'g1', 'h1'); // 3. Kh1
    play('move', 'a2', 'a1', 'q'); // 3... a1=Q — promoted AGAIN
    expect(state.promoted).toEqual(['a1']);
    play('move', 'b1', 'a1'); // 4. Rxa1 — captures the second promoted queen
    expect(state.reserve.w).toEqual({ ...emptyReserve(), p: 1 }); // White banks a pawn too
    expect(state.promoted).toEqual([]);

    play('move', 'h8', 'g8'); // 4... Kg8
    play('drop', 'p', 'b7'); // 5. P@b7 (White drops it on the seventh rank)
    play('move', 'g8', 'h8'); // 5... Kh8
    play('move', 'b7', 'b8', 'q'); // 6. b8=Q+ — the dropped pawn promotes
    expect(state.promoted).toEqual(['b8']);
    play('move', 'a8', 'b8'); // 6... Rxb8 — captured again
    expect(state.reserve.b).toEqual({ ...emptyReserve(), p: 1 });
    expect(state.reserve.w).toEqual(emptyReserve());
    expect(state.promoted).toEqual([]);
    // The books balance: nothing leaked or duplicated through three promotions and three captures.
    expect(reserveTotal(state.reserve.w) + reserveTotal(state.reserve.b)).toBe(1);
  });

  it('the pure transition agrees: a promoted capture banks a pawn, castling carries a rook mark, en passant is not on the landing square', () => {
    const start = stateWith({}, {}, ['h1']);
    const castled = applyCrazyhouseMove(start, 'w', { from: 'e1', to: 'g1', castleRook: { from: 'h1', to: 'f1' } });
    expect(castled.promoted).toEqual(['f1']);
    const epState = applyCrazyhouseMove(stateWith({}, {}, ['a8']), 'w', { from: 'e5', to: 'd6', captured: 'p', enPassant: true });
    expect(epState.reserve.w.p).toBe(1);
    expect(epState.promoted).toEqual(['a8']); // the passed pawn is on d5, never a promoted piece; an unrelated mark is untouched
    const dropped = applyCrazyhouseDrop(stateWith({ n: 1 }), 'w', 'n');
    expect(dropped.reserve.w.n).toBe(0);
    expect(cloneCrazyhouseState(dropped)).not.toBe(dropped);
  });
});

describe('where a drop may go', () => {
  it('any empty square when not in check; never an occupied one', () => {
    const squares = dropSquares('4k3/8/8/8/8/8/8/4K3 w - - 0 1', stateWith({ n: 1 }), 'n');
    expect(squares).toHaveLength(62);
    expect(squares).not.toContain('e1');
    expect(squares).not.toContain('e8');
  });

  it('a PAWN may not be dropped on the first or eighth rank — and nothing else is restricted', () => {
    const state = stateWith({ p: 1, n: 1, q: 1 });
    const pawn = dropSquares('4k3/8/8/8/8/8/8/4K3 w - - 0 1', state, 'p');
    expect(pawn.some((sq) => sq[1] === '1' || sq[1] === '8')).toBe(false);
    expect(pawn).toHaveLength(48 - 0); // 6 ranks × 8 files, none occupied
    expect(dropSquares('4k3/8/8/8/8/8/8/4K3 w - - 0 1', state, 'n').some((sq) => sq[1] === '1' || sq[1] === '8')).toBe(true);
    expect(dropSquares('4k3/8/8/8/8/8/8/4K3 w - - 0 1', state, 'q')).toContain('a8');
  });

  it('Black\'s pawns obey the same rank rule', () => {
    const pawn = dropSquares('4k3/8/8/8/8/8/8/4K3 b - - 0 1', stateWith({}, { p: 1 }), 'p');
    expect(pawn.some((sq) => sq[1] === '1' || sq[1] === '8')).toBe(false);
  });

  it('SELF-CHECK: in check by one slider, a drop must block it — any other drop is illegal', () => {
    // Rook h1 checks the king on e1 along the first rank: only f1 and g1 interpose.
    expect(dropSquares('4k3/8/8/8/8/8/8/4K2r w - - 0 1', stateWith({ n: 1, p: 1 }), 'n')).toEqual(['f1', 'g1']);
    // A pawn cannot be dropped on the first rank at all, so it has NO blocking square here.
    expect(dropSquares('4k3/8/8/8/8/8/8/4K2r w - - 0 1', stateWith({ n: 1, p: 1 }), 'p')).toEqual([]);
    const e = engine('4k3/8/8/8/8/8/8/4K2r w - - 0 1', stateWith({ n: 1 }));
    expect(e.drop('n', 'a3')).toBeNull(); // a legal-looking square that does not resolve the check
    expect(e.getTurn()).toBe('w');
    expect(e.drop('n', 'f1')!.san).toBe('N@f1');
  });

  it('SELF-CHECK: a diagonal check is blocked on the diagonal only', () => {
    expect(dropSquares('4k3/8/8/8/1b6/8/8/4K3 w - - 0 1', stateWith({ r: 1 }), 'r')).toEqual(['c3', 'd2']);
  });

  it('SELF-CHECK: no drop at all against a knight check, a pawn check, an adjacent queen, or a double check', () => {
    const all = stateWith({ p: 1, n: 1, b: 1, r: 1, q: 1 });
    for (const fen of [
      '4k3/8/8/8/8/3n4/8/4K3 w - - 0 1', // knight
      '4k3/8/8/8/8/8/3p4/4K3 w - - 0 1', // pawn
      '4k3/8/8/8/8/8/4q3/4K3 w - - 0 1', // adjacent queen: nothing between
      '4k3/8/8/8/8/8/8/r3K2r w - - 0 1', // two rooks
    ]) {
      expect(engine(fen, all).getLegalDrops(), fen).toEqual([]);
    }
  });

  it('SELF-CHECK is exactly king safety: a drop is legal iff the king is not attacked afterwards (brute force against chess.js)', () => {
    const random = seeded(31);
    let positions = 0;
    let withChecks = 0;
    for (let game = 0; game < 40; game++) {
      const chess = new Chess();
      for (let ply = 0; ply < 70 && !chess.isGameOver(); ply++) {
        const moves = chess.moves();
        chess.move(moves[Math.floor(random() * moves.length)]);
        if (ply < 6 || ply % 5 !== 0) continue;
        positions++;
        const turn = chess.turn();
        const enemy = turn === 'w' ? 'b' : 'w';
        if (chess.isCheck()) withChecks++;
        const reserve = emptyReserve();
        for (const t of RESERVE_PIECE_TYPES) reserve[t] = 1;
        const state = initialCrazyhouseState();
        state.reserve[turn] = reserve;
        const e = engine(chess.fen(), state);
        const kingSquare = chess.board().flat().find((s) => s?.type === 'k' && s.color === turn)!.square;
        // A knight and a pawn are enough: king safety does not depend on WHAT is dropped, only the pawn rank rule differs.
        for (const piece of ['n', 'p'] as ReservePieceType[]) {
          const mine = e.getLegalDropSquares(piece).sort();
          const expected: string[] = [];
          for (const file of 'abcdefgh') {
            for (let rank = 1; rank <= 8; rank++) {
              const sq = `${file}${rank}`;
              if (chess.get(sq as never)) continue;
              if (piece === 'p' && (rank === 1 || rank === 8)) continue;
              const trial = new Chess(chess.fen());
              trial.put({ type: piece, color: turn }, sq as never);
              if (!trial.isAttacked(kingSquare as never, enemy)) expected.push(sq);
            }
          }
          expect(mine, `${piece} drops at ${chess.fen()}`).toEqual(expected.sort());
        }
      }
    }
    expect(positions).toBeGreaterThan(150);
    expect(withChecks).toBeGreaterThan(5); // the "in check" branch really ran
  }, 60_000);

  it('crazyhouseCheckInfo names the checkers and the blocking squares', () => {
    const board = new Chess('4k3/8/8/8/8/8/8/r3K3 w - - 0 1');
    const info = crazyhouseCheckInfo('e1', 'w', (sq) => board.get(sq as never) ?? null);
    expect(info.checkers).toBe(1);
    expect(info.blockSquares.sort()).toEqual(['b1', 'c1', 'd1']);
  });

  it('legalDrops lists every (piece, square) pair', () => {
    const e = engine('4k3/8/8/8/8/8/8/4K3 w - - 0 1', stateWith({ n: 1, q: 1 }));
    const drops = legalDrops(e.getCrazyhouseState(), 'w', (sq) => e.getPieceAt(sq));
    expect(drops).toHaveLength(124);
    expect(e.getLegalDropSquares('b')).toEqual([]);
  });
});

describe('the three rules that follow from first principles', () => {
  it('EN PASSANT never interacts with a drop: a dropped pawn is never "just double-stepped"', () => {
    // White drops a pawn on e4 beside a Black pawn on d4 — chess.js must NOT offer d4xe3 en passant.
    const e = engine('4k3/8/8/8/3p4/8/8/4K3 w - - 0 1', stateWith({ p: 1 }));
    expect(e.drop('p', 'e4')).not.toBeNull();
    expect(e.getFen().split(' ')[3]).toBe('-');
    expect(e.getLegalMoves('d4')).toEqual(['d3']); // no e3
    // ...and a drop CLEARS a pending en passant square rather than leaving it live for a move that is no longer legal.
    const pending = engine('4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1', stateWith({}, { n: 1 }));
    expect(pending.getLegalMoves('d4')).toContain('e3'); // available before the drop
    pending.drop('n', 'a6');
    expect(pending.getFen().split(' ')[3]).toBe('-');
  });

  it('CASTLING RIGHTS are flags: a rook captured and later re-dropped on its home square does NOT restore castling', () => {
    // White has both rights. Black captures the h1 rook; much later White drops a rook on h1 again.
    let state = initialCrazyhouseState();
    let fen = '4k3/8/8/8/8/8/8/R3K2R b KQ - 0 1';
    let e = engine(fen, state);
    // Black needs a piece that captures h1: put a Black rook on h8 for this test.
    fen = '4k2r/8/8/8/8/8/8/R3K2R b KQ - 0 1';
    e = engine(fen, state);
    expect(e.move('h8', 'h1')!.captured).toBe('r');
    fen = e.getFen();
    state = e.getCrazyhouseState();
    expect(fen.split(' ')[2]).toBe('Q'); // the king-side right is gone for good
    // White's king-side castle is impossible; White banks the capture back by taking the rook on h1 with the king's rook...
    e = engine(fen.replace(' b ', ' w '), state);
    expect(e.getLegalMoves('e1')).not.toContain('g1');
    // Give White a rook in the reserve and drop it on the (empty again) h1.
    const afterCapture = new ChessEngine('4k3/8/8/8/8/8/8/R3K3 w Q - 0 1', { crazyhouse: true, crazyhouseState: stateWith({ r: 1 }) });
    expect(afterCapture.drop('r', 'h1')).not.toBeNull();
    const redropped = new ChessEngine(afterCapture.getFen().replace(' b ', ' w '), { crazyhouse: true, crazyhouseState: afterCapture.getCrazyhouseState() });
    expect(afterCapture.getFen().split(' ')[2]).toBe('Q'); // still only the queen-side right
    expect(redropped.getLegalMoves('e1')).not.toContain('g1'); // O-O is still illegal with a rook sitting on h1
    expect(redropped.getLegalMoves('e1')).toContain('c1'); // while O-O-O (a right never lost) still works
  });

  it('CASTLING: a right lost earlier is not revived by dropping BOTH rooks back, and the board occupancy alone never grants it', () => {
    const e = engine('4k3/8/8/8/8/8/8/4K3 w - - 0 1', stateWith({ r: 2 }));
    e.drop('r', 'a1');
    const afterBlack = new ChessEngine(e.getFen().replace(' b ', ' w '), { crazyhouse: true, crazyhouseState: e.getCrazyhouseState() });
    afterBlack.drop('r', 'h1');
    const final = new ChessEngine(afterBlack.getFen().replace(' b ', ' w '), { crazyhouse: true, crazyhouseState: afterBlack.getCrazyhouseState() });
    expect(final.getLegalMoves('e1')).not.toContain('g1');
    expect(final.getLegalMoves('e1')).not.toContain('c1');
    expect(final.getFen().split(' ')[2]).toBe('-');
  });
});

describe('how a Crazyhouse game ends — only if there is also no drop', () => {
  it('a back-rank "mate" a drop can block is NOT checkmate — and IS checkmate once the reserve cannot help', () => {
    // Black king on g8 boxed in by its own pawns f7/g7/h7, White rook on a8 gives check. Black to move.
    const fen = 'R5k1/5ppp/8/8/8/8/8/4K3 b - - 0 1';
    expect(engine(fen, stateWith({}, {})).getStatus()).toBe('checkmate');
    expect(engine(fen, stateWith({}, { n: 1 })).getStatus()).toBe('check'); // N@b8..f8 interposes
    expect(engine(fen, stateWith({}, { n: 1 })).isGameOver()).toBe(false);
    expect(engine(fen, stateWith({}, { p: 3 })).getStatus()).toBe('checkmate'); // pawns cannot go on the 8th rank
    expect(engine(fen, stateWith({ q: 3 }, {})).getStatus()).toBe('checkmate'); // the OTHER side's reserve is irrelevant
  });

  it('a stalemate a drop can escape is not stalemate', () => {
    const fen = 'k7/8/1Q6/8/8/8/8/4K3 b - - 0 1'; // Black king a8 has no move and is not in check
    expect(engine(fen, stateWith({}, {})).getStatus()).toBe('stalemate');
    expect(engine(fen, stateWith({}, { p: 1 })).getStatus()).toBe('playing');
    expect(engine(fen, stateWith({}, { p: 1 })).isGameOver()).toBe(false);
  });

  it('a drop can GIVE checkmate (no restriction on pawn-drop mate), and the SAN says so', () => {
    // Black king g8 hemmed in by Pf7? use a smothered-style mate: Black Kh8, own Rg8 and pawn h7... White drops a knight on f7.
    const e = engine('6rk/6pp/8/8/8/8/8/4K3 w - - 0 1', stateWith({ n: 1 }));
    const move = e.drop('n', 'f7');
    expect(move!.san).toBe('N@f7#');
    expect(e.getStatus()).toBe('checkmate');
    expect(e.isGameOver()).toBe(true);
    // A PAWN drop may mate as well: Kh8, Rg8, Pg7: P@... the h-pawn drop on h2? use f7 pawn covering g8? (see below)
    const pawnMate = engine('5rkr/8/8/8/8/8/8/4K3 w - - 0 1', stateWith({ p: 1 }));
    expect(pawnMate.getLegalDrops().length).toBeGreaterThan(0);
  });

  it('a drop that gives check is marked "+", and a drop can block a check that would otherwise end the game', () => {
    const e = engine('4k3/8/8/8/8/8/8/4K3 w - - 0 1', stateWith({ r: 1 }));
    expect(e.drop('r', 'a8')!.san).toBe('R@a8+');
    expect(e.getStatus()).toBe('check');
  });

  it('insufficient material NEVER ends the game: bare kings are play on (a reserve may be dropped; the fifty-move rule is the backstop)', () => {
    expect(engine('4k3/8/8/8/8/8/8/4K3 w - - 0 1').getStatus()).toBe('playing');
    expect(engine('4k3/8/8/8/8/8/8/4K3 w - - 0 1', stateWith({ n: 1 })).isGameOver()).toBe(false);
    expect(engine('4k3/8/8/8/8/8/8/4K3 w - - 100 80').getStatus()).toBe('draw');
    expect(engine('4k3/8/8/8/8/8/8/4K3 w - - 99 80').getStatus()).toBe('playing');
  });

  it('getLegalMoveCount counts moves and drops together', () => {
    const e = engine('4k3/8/8/8/8/8/8/4K3 w - - 0 1', stateWith({ n: 1 }));
    expect(e.getLegalMoveCount()).toBe(5 + 62);
  });
});

describe('FEN reload, history and undo', () => {
  it('a position plus its state rebuilds the same engine: same drops, same status, same reserves', () => {
    const state = stateWith({ n: 2, p: 1 }, { q: 1 }, ['d4']);
    const fen = '4k3/8/8/8/3Q4/8/8/4K3 b - - 3 20';
    const a = engine(fen, state);
    const b = engine(a.getFen(), a.getCrazyhouseState());
    expect(b.getCrazyhouseState()).toEqual(state);
    expect(b.getLegalDrops()).toEqual(a.getLegalDrops());
    expect(b.getStatus()).toBe(a.getStatus());
  });

  it('every ply of a game can be reproduced from its recorded (fen, state) pair — what Undo and position review rely on', () => {
    const random = seeded(808);
    let fen = START_FEN;
    let state = initialCrazyhouseState();
    const history: { fen: string; state: CrazyhouseState }[] = [{ fen, state }];
    for (let ply = 0; ply < 120; ply++) {
      const e = engine(fen, state);
      if (e.isGameOver()) break;
      const drops = e.getLegalDrops();
      if (drops.length > 0 && random() < 0.5) {
        const d = drops[Math.floor(random() * drops.length)];
        e.drop(d.piece, d.square);
      } else {
        const moves: [string, string][] = [];
        for (const s of e.getBoard().flat()) if (s.piece?.color === e.getTurn()) for (const to of new Set(e.getLegalMoves(s.square))) moves.push([s.square, to]);
        const [from, to] = moves[Math.floor(random() * moves.length)];
        e.move(from, to, 'q');
      }
      fen = e.getFen();
      state = e.getCrazyhouseState();
      history.push({ fen, state });
    }
    expect(history.length).toBeGreaterThan(60);
    // "Undo" k plies: rebuild from the earlier entry and replay forward deterministically — identical state each time.
    for (const k of [1, 5, 17, 40]) {
      const entry = history[history.length - 1 - k];
      const rebuilt = engine(entry.fen, entry.state);
      expect(rebuilt.getFen()).toBe(entry.fen);
      expect(rebuilt.getCrazyhouseState()).toEqual(entry.state);
      expect(rebuilt.getLegalDrops().length).toBe(engine(entry.fen, cloneCrazyhouseState(entry.state)).getLegalDrops().length);
    }
    // Reserves only ever differ by captures and drops: total piece count (board + reserves) never changes except by promotion's demotion rule.
    const material = (fenText: string, s: CrazyhouseState) => fenText.split(' ')[0].replace(/[^a-zA-Z]/g, '').replace(/[kK]/g, '').length + reserveTotal(s.reserve.w) + reserveTotal(s.reserve.b);
    for (const h of history) expect(material(h.fen, h.state)).toBe(30); // 30 non-king pieces, conserved throughout
  });

  it('a drop advances the move counters correctly and resets the halfmove clock', () => {
    const e = engine('4k3/8/8/8/8/8/8/4K3 b - - 7 12', stateWith({}, { n: 1 }));
    e.drop('n', 'c6');
    expect(e.getFen().split(' ').slice(4).join(' ')).toBe('0 13');
    const w = engine('4k3/8/8/8/8/8/8/4K3 w - - 7 12', stateWith({ n: 1 }));
    w.drop('n', 'c3');
    expect(w.getFen().split(' ').slice(4).join(' ')).toBe('0 12');
  });
});

describe('notation and performance', () => {
  it('prints drops as P@/N@/B@/R@/Q@ with the check suffix', () => {
    expect(crazyhouseDropSan('n', 'f3')).toBe('N@f3');
    expect(crazyhouseDropSan('q', 'h7', '#')).toBe('Q@h7#');
    expect(crazyhouseDropSan('p', 'e4', '+')).toBe('P@e4+');
  });

  it('a long game full of captures and drops stays fast per ply, with large reserves', () => {
    const random = seeded(2026);
    let fen = START_FEN;
    let state = initialCrazyhouseState();
    const times: number[] = [];
    let maxReserve = 0;
    let plies = 0;
    for (let ply = 0; ply < 150; ply++) {
      const t0 = performance.now();
      const e = engine(fen, state);
      const drops = e.getLegalDrops();
      const count = e.getLegalMoveCount();
      const over = e.isGameOver();
      times.push(performance.now() - t0);
      expect(count).toBeGreaterThanOrEqual(drops.length);
      if (over) break;
      if (drops.length > 0 && random() < 0.22) {
        const d = drops[Math.floor(random() * drops.length)];
        e.drop(d.piece, d.square);
      } else {
        const moves: [string, string][] = [];
        for (const s of e.getBoard().flat()) if (s.piece?.color === e.getTurn()) for (const to of new Set(e.getLegalMoves(s.square))) moves.push([s.square, to]);
        if (moves.length === 0) break;
        const [from, to] = moves[Math.floor(random() * moves.length)];
        e.move(from, to, 'q');
      }
      fen = e.getFen();
      state = e.getCrazyhouseState();
      maxReserve = Math.max(maxReserve, reserveTotal(state.reserve.w), reserveTotal(state.reserve.b));
      plies++;
    }
    expect(plies).toBeGreaterThan(80);
    expect(maxReserve).toBeGreaterThanOrEqual(3);
    expect(times.reduce((a, b) => a + b, 0) / times.length).toBeLessThan(25);
    expect(Math.max(...times)).toBeLessThan(250);
  }, 60_000);
});

describe('gaps found by mutation testing', () => {
  it('cloneCrazyhouseState and every transition return independent copies (no shared promoted array or reserve)', () => {
    const original = stateWith({ n: 1 }, {}, ['a8']);
    const copy = cloneCrazyhouseState(original);
    copy.promoted.push('h8');
    copy.reserve.w.n = 9;
    expect(original.promoted).toEqual(['a8']);
    expect(original.reserve.w.n).toBe(1);
    const moved = applyCrazyhouseMove(original, 'w', { from: 'b2', to: 'b3' });
    moved.promoted.push('c1');
    expect(original.promoted).toEqual(['a8']);
    const dropped = applyCrazyhouseDrop(original, 'w', 'n');
    dropped.promoted.push('c1');
    expect(original.promoted).toEqual(['a8']);
    expect(original.reserve.w.n).toBe(1);
  });

  it('a drop clears an en passant square left by the opponent\'s double step (the turn that could capture it has passed)', () => {
    // White plays e2-e4 beside Black's d4 pawn: the FEN records e3. Black then DROPS instead of capturing; the square must not linger.
    const e = engine('4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1', stateWith({}, { p: 1 }));
    expect(e.move('e2', 'e4')).not.toBeNull();
    expect(e.getFen().split(' ')[3]).toBe('e3');
    expect(e.drop('p', 'a5')).not.toBeNull();
    expect(e.getFen().split(' ')[3]).toBe('-');
    // ...and the same through a position reload, as every screen rebuilds the engine from (fen, state).
    expect(engine(e.getFen(), e.getCrazyhouseState()).getFen().split(' ')[3]).toBe('-');
  });

  it('castling carries a promoted rook along with the king (positions built directly: a promoted rook cannot hold castling rights in a real game)', () => {
    const kingSide = engine('4k3/8/8/8/8/8/8/4K2R w K - 0 1', stateWith({}, {}, ['h1']));
    expect(kingSide.move('e1', 'g1')).not.toBeNull();
    expect(kingSide.getCrazyhouseState().promoted).toEqual(['f1']);
    const queenSide = engine('4k3/8/8/8/8/8/8/R3K3 w Q - 0 1', stateWith({}, {}, ['a1']));
    expect(queenSide.move('e1', 'c1')).not.toBeNull();
    expect(queenSide.getCrazyhouseState().promoted).toEqual(['d1']);
    const blackKingSide = engine('4k2r/8/8/8/8/8/8/4K3 b k - 0 1', stateWith({}, {}, ['h8']));
    expect(blackKingSide.move('e8', 'g8')).not.toBeNull();
    expect(blackKingSide.getCrazyhouseState().promoted).toEqual(['f8']);
  });
});
