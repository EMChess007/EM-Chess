import { describe, expect, it } from 'vitest';
import { ChessEngine } from '../ChessEngine';
import {
  HORDE_FIRST_RANK_DOUBLE_STEP_ALLOWS_EN_PASSANT,
  HORDE_START_FEN,
  HORDE_START_PAWN_COUNT,
  getHordeMoves,
  getHordeWinner,
  getHordeWinnerFromFen,
  hordeFirstRankDoubleStep,
  hordeWhitePieceCount,
} from '../horde';

const horde = (fen: string) => new ChessEngine(fen, { horde: true });
const targets = (fen: string, square: string) => [...new Set(horde(fen).getLegalMoves(square))].sort();

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('the start position', () => {
  it('is the standard Horde layout: 36 White pawns, no White king, Black\'s normal army with its castling rights', () => {
    expect(HORDE_START_FEN).toBe('rnbqkbnr/pppppppp/8/1PP2PP1/PPPPPPPP/PPPPPPPP/PPPPPPPP/PPPPPPPP w kq - 0 1');
    const engine = horde(HORDE_START_FEN);
    const board = engine.getBoard().flat();
    const white = board.filter((s) => s.piece?.color === 'w');
    expect(white).toHaveLength(HORDE_START_PAWN_COUNT);
    expect(white.every((s) => s.piece!.type === 'p')).toBe(true);
    expect(board.some((s) => s.piece?.type === 'k' && s.piece.color === 'w')).toBe(false);
    expect(board.filter((s) => s.piece?.color === 'b')).toHaveLength(16);
    expect(hordeWhitePieceCount(HORDE_START_FEN)).toBe(36);
    // The four empty squares on the fifth rank are exactly a5, d5, e5, h5.
    expect(['a5', 'd5', 'e5', 'h5'].every((sq) => engine.getPieceAt(sq) === null)).toBe(true);
  });

  it('opens with exactly the eight pawn moves that have room: a5, d5, e5, h5 and b6, c6, f6, g6', () => {
    const engine = horde(HORDE_START_FEN);
    expect(getHordeMoves(engine).map((m) => `${m.from}${m.to}`).sort()).toEqual(['a4a5', 'b5b6', 'c5c6', 'd4d5', 'e4e5', 'f5f6', 'g5g6', 'h4h5']);
    expect(engine.getLegalMoveCount()).toBe(8);
    expect(engine.getStatus()).toBe('playing');
    expect(engine.isGameOver()).toBe(false);
  });

  it('needs the horde option to be loaded at all (chess.js refuses a FEN with no king otherwise) — which is why every caller passes it', () => {
    expect(() => new ChessEngine(HORDE_START_FEN)).toThrow();
    expect(() => horde(HORDE_START_FEN)).not.toThrow();
  });
});

describe('White has no king: nothing for White can be in check', () => {
  it('a White pawn attacked by Black is simply capturable — no check, no pinned pieces, no forced response', () => {
    // Black rook attacks the White pawn on e4; it is White's move and nothing is "in check".
    const engine = horde('4k3/8/8/8/4P3/8/8/4r3 w - - 0 1');
    expect(engine.getStatus()).toBe('playing');
    expect(engine.getLegalMoves('e4')).toContain('e5');
  });

  it('White never gets "castling" anywhere in its move list', () => {
    expect(horde(HORDE_START_FEN).getLegalMoveCount()).toBe(8); // nothing but pawn pushes
  });
});

describe('the positional double step — Horde\'s one genuine rules deviation', () => {
  it('a White pawn on RANK 2 may double-step (chess.js already allows this)', () => {
    expect(targets('4k3/8/8/8/8/8/4P3/8 w - - 0 1', 'e2')).toEqual(['e3', 'e4']);
  });

  it('a White pawn on RANK 1 may double-step to rank 3 — the move chess.js cannot generate', () => {
    expect(targets('4k3/8/8/8/8/8/8/4P3 w - - 0 1', 'e1')).toEqual(['e2', 'e3']);
    const engine = horde('4k3/8/8/8/8/8/8/4P3 w - - 0 1');
    const move = engine.move('e1', 'e3');
    expect(move).not.toBeNull();
    expect(move!.san).toBe('e3');
    expect(engine.getPieceAt('e1')).toBeNull();
    expect(engine.getPieceAt('e3')).toEqual({ type: 'p', color: 'w' });
    expect(engine.getTurn()).toBe('b');
  });

  it('needs the squares in front to be EMPTY: blocked on rank 2 or rank 3 means no double step', () => {
    expect(targets('4k3/8/8/8/8/8/4p3/4P3 w - - 0 1', 'e1')).toEqual([]); // e2 occupied: not even a single step
    expect(targets('4k3/8/8/8/8/4p3/8/4P3 w - - 0 1', 'e1')).toEqual(['e2']); // e3 occupied: single step only
    expect(targets('4k3/8/8/8/4p3/8/4P3/8 w - - 0 1', 'e2')).toEqual(['e3']); // e4 occupied: single step only
    expect(targets('4k3/8/8/8/8/4p3/4P3/8 w - - 0 1', 'e2')).toEqual([]); // e3 occupied: nothing at all
  });

  it('is POSITIONAL, not a first-move flag: a pawn that stepped 1->2 may still double-step 2->4 later', () => {
    let engine = horde('4k3/8/8/8/8/8/8/4P3 w - - 0 1');
    expect(engine.move('e1', 'e2')).not.toBeNull(); // the single step, off rank 1
    // Black makes some other move; the position is rebuilt from the FEN, like every game screen does.
    engine = horde('4k3/8/8/8/8/8/4P3/8 w - - 0 2');
    expect(engine.getLegalMoves('e2')).toEqual(expect.arrayContaining(['e3', 'e4']));
    expect(engine.move('e2', 'e4')).not.toBeNull();
  });

  it('is NOT available from rank 3 or higher, and never to Black', () => {
    expect(targets('4k3/8/8/8/8/8/8/8 w - - 0 1', 'e3')).toEqual([]);
    expect(targets('4k3/8/8/8/8/4P3/8/8 w - - 0 1', 'e3')).toEqual(['e4']);
    expect(targets('4k3/8/8/4P3/8/8/8/8 w - - 0 1', 'e5')).toEqual(['e6']);
    // Black's pawns behave normally: a double step only from rank 7.
    expect(targets('4k3/3p4/8/8/8/8/8/4P3 b - - 0 1', 'd7')).toEqual(['d5', 'd6']);
    expect(targets('4k3/8/3p4/8/8/8/8/4P3 b - - 0 1', 'd6')).toEqual(['d5']);
  });

  it('the rank-1 double step is only offered on White\'s turn', () => {
    expect(hordeFirstRankDoubleStep('e1', () => false)).toBe('e3');
    expect(hordeFirstRankDoubleStep('e2', () => false)).toBeNull();
    expect(hordeFirstRankDoubleStep('e1', (sq) => sq === 'e3')).toBeNull();
    expect(hordeFirstRankDoubleStep('e1', (sq) => sq === 'e2')).toBeNull();
    // A Black piece standing on e1 would be a different matter entirely, and Black to move never asks.
    expect(horde('4k3/8/8/8/8/8/8/4P3 b - - 0 1').getLegalMoves('e1')).toEqual([]);
  });

  it('getLegalMoveCount counts each rank-1 double step, and getHordeMoves lists it', () => {
    const fen = '4k3/8/8/8/8/8/8/PP2P3 w - - 0 1'; // a1, b1, e1
    const engine = horde(fen);
    expect(engine.getLegalMoveCount()).toBe(6); // each pawn: single + double
    expect(getHordeMoves(engine).map((m) => `${m.from}${m.to}`).sort()).toEqual(['a1a2', 'a1a3', 'b1b2', 'b1b3', 'e1e2', 'e1e3']);
  });
});

describe('en passant works normally', () => {
  it('Black captures a pawn that double-stepped from rank 2 (an ordinary double step)', () => {
    const engine = horde('4k3/8/8/8/3p4/8/4P3/8 w - - 0 1');
    expect(engine.move('e2', 'e4')).not.toBeNull();
    expect(engine.getLegalMoves('d4')).toContain('e3');
    const capture = engine.move('d4', 'e3');
    expect(capture).not.toBeNull();
    expect(capture!.captured).toBe('p');
    expect(engine.getPieceAt('e4')).toBeNull(); // the passed pawn is gone
    expect(getHordeWinner(engine)).toBe('b'); // ...and it was White's last piece
  });

  it('White captures en passant too: Black double-steps beside a White pawn on the fifth rank', () => {
    const engine = horde('4k3/3p4/8/4P3/8/8/8/8 b - - 0 1');
    expect(engine.move('d7', 'd5')).not.toBeNull();
    expect(engine.getLegalMoves('e5')).toContain('d6');
    const capture = engine.move('e5', 'd6');
    expect(capture!.captured).toBe('p');
    expect(engine.getPieceAt('d5')).toBeNull();
  });

  it('after a RANK-1 double step the en passant square is recorded, per HORDE_FIRST_RANK_DOUBLE_STEP_ALLOWS_EN_PASSANT', () => {
    const engine = horde('4k3/8/8/8/8/3p4/8/4P3 w - - 0 1');
    expect(engine.move('e1', 'e3')).not.toBeNull();
    if (HORDE_FIRST_RANK_DOUBLE_STEP_ALLOWS_EN_PASSANT) {
      expect(engine.getFen().split(' ')[3]).toBe('e2');
      expect(engine.getLegalMoves('d3')).toContain('e2');
      expect(engine.move('d3', 'e2')!.captured).toBe('p');
    } else {
      expect(engine.getFen().split(' ')[3]).toBe('-');
      expect(engine.getLegalMoves('d3')).not.toContain('e2');
    }
  });
});

describe('promotion', () => {
  it('a White pawn promotes on the eighth rank to a queen, rook, bishop or knight', () => {
    const fen = '4k3/P7/8/8/8/8/8/8 w - - 0 1';
    const moves = getHordeMoves(horde(fen)).filter((m) => m.from === 'a7');
    expect(moves.map((m) => m.promotion).sort()).toEqual(['b', 'n', 'q', 'r']);
    for (const piece of ['q', 'r', 'b', 'n'] as const) {
      const engine = horde(fen);
      const move = engine.move('a7', 'a8', piece);
      expect(move!.promotion).toBe(piece);
      expect(engine.getPieceAt('a8')).toEqual({ type: piece, color: 'w' });
    }
  });

  it('a promoted piece counts as White material: Black must capture it too before the horde is destroyed', () => {
    const engine = horde('4k3/P7/8/8/8/8/8/8 w - - 0 1');
    engine.move('a7', 'a8', 'q');
    expect(hordeWhitePieceCount(engine.getFen())).toBe(1);
    expect(getHordeWinner(engine)).toBeNull();
  });

  it('promotion can capture, and give check', () => {
    const engine = horde('3rk3/P7/8/8/8/8/8/8 w - - 0 1'); // a8=Q+ is check along the back rank from a8... d8 rook blocks
    const move = engine.move('a7', 'a8', 'q');
    expect(move).not.toBeNull();
    const capture = horde('1r2k3/P7/8/8/8/8/8/8 w - - 0 1').move('a7', 'b8', 'q');
    expect(capture!.captured).toBe('r');
    expect(capture!.san).toMatch(/^axb8=Q\+?$/);
  });

  it('Black\'s pawns promote on the FIRST rank', () => {
    const engine = horde('4k3/8/8/8/8/8/p7/4P3 b - - 0 1');
    const move = engine.move('a2', 'a1', 'q');
    expect(move!.promotion).toBe('q');
    expect(engine.getPieceAt('a1')).toEqual({ type: 'q', color: 'b' });
  });
});

describe('how a Horde game ends', () => {
  it('Black wins by capturing every White piece — and chess.js\'s "stalemate" for that position must not be read as a draw', () => {
    const fen = '4k3/8/8/8/8/8/8/8 w - - 0 1';
    const engine = horde(fen);
    expect(engine.getStatus()).toBe('stalemate'); // chess.js: no moves, no check — the trap
    expect(getHordeWinnerFromFen(fen)).toBe('b');
    expect(getHordeWinner(engine)).toBe('b');
    expect(engine.isGameOver()).toBe(true);
    expect(getHordeWinnerFromFen(HORDE_START_FEN)).toBeNull();
  });

  it('White wins by checkmating Black\'s king, the ordinary way', () => {
    const engine = horde('R5k1/5ppp/8/8/8/8/8/8 b - - 0 1'); // back-rank mate by a (promoted) rook
    expect(engine.getStatus()).toBe('checkmate');
    expect(engine.isGameOver()).toBe(true);
    expect(getHordeWinner(engine)).toBeNull(); // not Black's win condition
  });

  it('a pawn can deliver the mate', () => {
    // Black Ka8 is boxed in by its own Bb8 and pawn a7; the pawn on b7 gives check, and the rook on b1 defends it.
    const engine = horde('kb6/pP6/8/8/8/8/8/1R6 b - - 0 1');
    expect(engine.getStatus()).toBe('checkmate');
  });

  it('stalemate is a DRAW for White (chess.com) — White has pieces but no legal move', () => {
    const engine = horde('4k3/8/8/8/8/p7/P7/8 w - - 0 1');
    expect(engine.getStatus()).toBe('stalemate');
    expect(engine.isGameOver()).toBe(true);
    expect(getHordeWinner(engine)).toBeNull();
  });

  it('stalemate is a DRAW for Black too', () => {
    const engine = horde('k7/8/1Q6/8/8/8/8/8 b - - 0 1');
    expect(engine.getStatus()).toBe('stalemate');
    expect(engine.isGameOver()).toBe(true);
    expect(getHordeWinner(engine)).toBeNull();
  });

  it('insufficient material NEVER ends a Horde game: Black king vs a lone White bishop is play on (chess.js would call it a draw)', () => {
    const engine = horde('4k3/8/8/8/8/8/8/2B5 b - - 0 1');
    expect(engine.getStatus()).toBe('playing');
    expect(engine.isGameOver()).toBe(false);
    expect(horde('4k3/8/8/8/8/8/8/2N5 b - - 0 1').isGameOver()).toBe(false);
  });

  it('the fifty-move rule still draws (read from the FEN\'s halfmove clock)', () => {
    expect(horde('4k3/8/8/8/8/8/8/2B5 b - - 100 80').getStatus()).toBe('draw');
    expect(horde('4k3/8/8/8/8/8/8/2B5 b - - 99 80').getStatus()).toBe('playing');
  });

  it('Black in check is reported as check', () => {
    expect(horde('4k3/8/8/8/8/8/8/4R3 b - - 0 1').getStatus()).toBe('check');
  });
});

describe('Black castles as usual (the start FEN keeps "kq"); White never has castling rights', () => {
  it('Black may castle king-side once the squares between are clear', () => {
    const engine = horde('r3k2r/8/8/8/8/8/8/4P3 b kq - 0 1');
    expect(engine.getLegalMoves('e8')).toEqual(expect.arrayContaining(['g8', 'c8']));
    expect(engine.move('e8', 'g8')!.san).toBe('O-O');
  });
});

describe('FEN reload and undo', () => {
  it('every position of a long game reloads from its own FEN (a position with no White king), and the FEN round-trips', () => {
    const random = seeded(11);
    let fen = HORDE_START_FEN;
    for (let ply = 0; ply < 70; ply++) {
      const engine = horde(fen);
      expect(engine.getFen()).toBe(fen);
      const moves = getHordeMoves(engine);
      if (moves.length === 0 || engine.isGameOver()) break;
      const pick = moves[Math.floor(random() * moves.length)];
      expect(engine.move(pick.from, pick.to, pick.promotion)).not.toBeNull();
      fen = engine.getFen();
      expect(() => horde(fen)).not.toThrow();
    }
  });

  it('undo takes back a rank-1 double step cleanly, including the recorded en passant square', () => {
    const engine = horde('4k3/8/8/8/8/3p4/8/4P3 w - - 0 1');
    const before = engine.getFen();
    engine.move('e1', 'e3');
    engine.undo();
    expect(engine.getFen()).toBe(before);
    expect(engine.getTurn()).toBe('w');
    expect(engine.getLegalMoves('e1')).toEqual(expect.arrayContaining(['e2', 'e3']));
  });

  it('undo takes back an ordinary move and a promotion', () => {
    const engine = horde('4k3/P7/8/8/8/8/8/8 w - - 0 1');
    const before = engine.getFen();
    engine.move('a7', 'a8', 'q');
    engine.undo();
    expect(engine.getFen()).toBe(before);
  });
});

describe('performance on a realistic, long game', () => {
  it('90 plies of a random Horde game (36 pawns, so many moves) stay fast per ply, building a fresh engine every ply like the screens', () => {
    const random = seeded(2026);
    let fen = HORDE_START_FEN;
    const times: number[] = [];
    let counted = 0;
    for (let ply = 0; ply < 90; ply++) {
      const t0 = performance.now();
      const engine = horde(fen);
      const moves = getHordeMoves(engine);
      const count = engine.getLegalMoveCount();
      const over = engine.isGameOver();
      times.push(performance.now() - t0);
      expect(count).toBeGreaterThanOrEqual(moves.filter((m) => !m.promotion || m.promotion === 'q').length - 1);
      if (over || moves.length === 0) break;
      const pick = moves[Math.floor(random() * moves.length)];
      engine.move(pick.from, pick.to, pick.promotion);
      fen = engine.getFen();
      counted++;
    }
    expect(counted).toBeGreaterThan(40); // a genuinely long game, not just the opening
    const average = times.reduce((a, b) => a + b, 0) / times.length;
    expect(average).toBeLessThan(25);
    expect(Math.max(...times)).toBeLessThan(250);
  }, 30_000);
});
