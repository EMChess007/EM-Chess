import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { ChessEngine } from '../ChessEngine';
import { TORPEDO_START_FEN, getTorpedoMoves, torpedoExtraDoubleStep } from '../torpedo';

/**
 * Torpedo chess (see torpedo.ts): a pawn may always move one or two squares forward; everything else is standard chess.
 * Constants are written as LITERALS (a test that reads them from the module under test cannot kill a mutant of them).
 */
const torpedo = (fen: string) => new ChessEngine(fen, { torpedo: true });
const empty = () => false;
const occupiedAt = (...squares: string[]) => (square: string) => squares.includes(square);

describe('the shared rules block', () => {
  it('starts from the ordinary chess position', () => {
    expect(TORPEDO_START_FEN).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  });

  it('a White pawn on ranks 3-6 may step two squares when both are empty; the home rank is chess.js business (null)', () => {
    expect(torpedoExtraDoubleStep('e3', 'w', empty)).toBe('e5');
    expect(torpedoExtraDoubleStep('e4', 'w', empty)).toBe('e6');
    expect(torpedoExtraDoubleStep('e5', 'w', empty)).toBe('e7');
    expect(torpedoExtraDoubleStep('e6', 'w', empty)).toBe('e8');
    expect(torpedoExtraDoubleStep('e2', 'w', empty)).toBeNull();
    expect(torpedoExtraDoubleStep('e7', 'w', empty)).toBeNull();
    expect(torpedoExtraDoubleStep('e1', 'w', empty)).toBeNull();
  });

  it('a Black pawn on ranks 6-3 steps two squares down; rank 7 is the home rank, rank 2 has only the single step', () => {
    expect(torpedoExtraDoubleStep('e6', 'b', empty)).toBe('e4');
    expect(torpedoExtraDoubleStep('e5', 'b', empty)).toBe('e3');
    expect(torpedoExtraDoubleStep('e4', 'b', empty)).toBe('e2');
    expect(torpedoExtraDoubleStep('e3', 'b', empty)).toBe('e1');
    expect(torpedoExtraDoubleStep('e7', 'b', empty)).toBeNull();
    expect(torpedoExtraDoubleStep('e2', 'b', empty)).toBeNull();
    expect(torpedoExtraDoubleStep('e8', 'b', empty)).toBeNull();
  });

  it('both squares in front must be empty (a pawn never jumps)', () => {
    expect(torpedoExtraDoubleStep('e3', 'w', occupiedAt('e4'))).toBeNull();
    expect(torpedoExtraDoubleStep('e3', 'w', occupiedAt('e5'))).toBeNull();
    expect(torpedoExtraDoubleStep('e3', 'w', occupiedAt('d4', 'f5', 'e3'))).toBe('e5');
    expect(torpedoExtraDoubleStep('e5', 'b', occupiedAt('e4'))).toBeNull();
    expect(torpedoExtraDoubleStep('e5', 'b', occupiedAt('e3'))).toBeNull();
  });
});

describe('the double step from any rank', () => {
  it('start position: 20 legal moves, exactly as in standard chess', () => {
    const engine = new ChessEngine(TORPEDO_START_FEN, { torpedo: true });
    expect(engine.getLegalMoveCount()).toBe(20);
    expect(engine.getLegalMoves('e2').sort()).toEqual(['e3', 'e4']);
  });

  it('a White pawn on e3 may go to e4 or e5; after the move it stands on e5', () => {
    const engine = torpedo('4k3/8/8/8/8/4P3/8/4K3 w - - 0 1');
    expect(engine.getLegalMoves('e3').sort()).toEqual(['e4', 'e5']);
    const played = engine.move('e3', 'e5');
    expect(played).not.toBeNull();
    expect(played?.san).toBe('e5');
    expect(engine.getPieceAt('e5')).toEqual({ type: 'p', color: 'w' });
    expect(engine.getPieceAt('e3')).toBeNull();
    expect(engine.getTurn()).toBe('b');
  });

  it('a Black pawn on d6 goes to d5 or d4, and a White pawn on c5 goes to c6 or c7', () => {
    expect(torpedo('4k3/8/3p4/8/8/8/8/4K3 b - - 0 1').getLegalMoves('d6').sort()).toEqual(['d4', 'd5']);
    expect(torpedo('4k3/8/8/2P5/8/8/8/4K3 w - - 0 1').getLegalMoves('c5').sort()).toEqual(['c6', 'c7']);
  });

  it('is blocked when either square in front is occupied: a piece on e4 stops everything, a piece on e5 only the long step', () => {
    expect(torpedo('4k3/8/8/8/4n3/4P3/8/4K3 w - - 0 1').getLegalMoves('e3')).toEqual([]);
    const blockedFar = torpedo('4k3/8/8/4n3/8/4P3/8/4K3 w - - 0 1');
    expect(blockedFar.getLegalMoves('e3')).toEqual(['e4']);
    expect(blockedFar.move('e3', 'e5')).toBeNull();
    expect(blockedFar.getFen()).toBe('4k3/8/8/4n3/8/4P3/8/4K3 w - - 0 1');
  });

  it('is a pawn rule, and only for the side to move', () => {
    expect(torpedo('4k3/8/8/8/8/8/8/4KN2 w - - 0 1').getLegalMoves('f1').sort()).toEqual(['d2', 'e3', 'g3', 'h2']);
    expect(torpedo('4k3/8/3p4/8/8/4P3/8/4K3 w - - 0 1').getLegalMoves('d6')).toEqual([]);
    expect(torpedo('4k3/8/3p4/8/8/4P3/8/4K3 w - - 0 1').move('d6', 'd4')).toBeNull();
  });

  it('cannot be used by a pinned pawn: a bishop on h8 pins the d4 pawn to the king on a1, so no step of any length', () => {
    const engine = torpedo('7b/8/8/8/3P4/8/8/K3k3 w - - 0 1');
    expect(engine.getLegalMoves('d4')).toEqual([]);
    expect(engine.move('d4', 'd6')).toBeNull();
    expect(engine.getPieceAt('d4')).toEqual({ type: 'p', color: 'w' });
  });

  it('an unpinned pawn leaves a pinned file alone: a rook pin along the file still allows both steps', () => {
    // Rook on e8 pins nothing sideways; the pawn on e3 stays on the king's file, so e4 and e5 are both legal.
    const engine = torpedo('4r2k/8/8/8/8/4P3/8/4K3 w - - 0 1');
    expect(engine.getLegalMoves('e3').sort()).toEqual(['e4', 'e5']);
  });

  it('undo takes a double step back completely', () => {
    const engine = torpedo('4k3/8/8/8/8/4P3/8/4K3 w - - 0 1');
    const before = engine.getFen();
    engine.move('e3', 'e5');
    engine.undo();
    expect(engine.getFen()).toBe(before);
  });
});

describe('promotion by a double step', () => {
  it('a pawn on e6 reaches e8 in one move and promotes (queen by default, any piece on request)', () => {
    const queen = torpedo('8/7k/4P3/8/8/8/8/K7 w - - 0 1');
    expect(queen.getLegalMoves('e6').sort()).toContain('e8');
    const played = queen.move('e6', 'e8', 'q');
    expect(played?.promotion).toBe('q');
    expect(played?.san).toBe('e8=Q');
    expect(queen.getPieceAt('e8')).toEqual({ type: 'q', color: 'w' });

    const knight = torpedo('8/7k/4P3/8/8/8/8/K7 w - - 0 1');
    const under = knight.move('e6', 'e8', 'n');
    expect(under?.promotion).toBe('n');
    expect(knight.getPieceAt('e8')).toEqual({ type: 'n', color: 'w' });
  });

  it('a Black pawn on c3 reaches c1 in one move and promotes', () => {
    const engine = torpedo('7k/8/8/8/8/2p5/8/K7 b - - 0 1');
    expect(engine.getLegalMoves('c3')).toContain('c1');
    expect(engine.move('c3', 'c1', 'r')?.promotion).toBe('r');
    expect(engine.getPieceAt('c1')).toEqual({ type: 'r', color: 'b' });
  });

  it('a pawn on the 7th rank only has the one promoting step, and it is blocked by a piece on e7', () => {
    expect(torpedo('7k/4P3/8/8/8/8/8/K7 w - - 0 1').getLegalMoves('e7')).toEqual(['e8', 'e8', 'e8', 'e8']);
    expect(torpedo('7k/4n3/4P3/8/8/8/8/K7 w - - 0 1').getLegalMoves('e6')).toEqual([]);
  });

  it('the move list expands the double-step promotion into the four pieces', () => {
    const moves = getTorpedoMoves(torpedo('7k/8/4P3/8/8/8/8/K7 w - - 0 1'), 'e6');
    expect(moves.filter((m) => m.to === 'e8').map((m) => m.promotion).sort()).toEqual(['b', 'n', 'q', 'r']);
    expect(moves.filter((m) => m.to === 'e7')).toHaveLength(1);
  });
});

describe('en passant after a double step from any rank', () => {
  it('White e3-e5 beside a Black pawn on d5: the FEN records e4 and Black takes en passant, removing the e5 pawn', () => {
    const engine = torpedo('4k3/8/8/3p4/8/4P3/8/4K3 w - - 0 1');
    expect(engine.move('e3', 'e5')).not.toBeNull();
    expect(engine.getFen().split(' ')[3]).toBe('e4');
    expect(engine.getLegalMoves('d5')).toContain('e4');
    const taken = engine.move('d5', 'e4');
    expect(taken?.captured).toBe('p');
    expect(engine.getPieceAt('e5')).toBeNull();
    expect(engine.getPieceAt('e4')).toEqual({ type: 'p', color: 'b' });
  });

  it('Black e6-e4 beside a White pawn on d4: the en passant square is e5 and White takes there', () => {
    const engine = torpedo('4k3/8/4p3/8/3P4/8/8/4K3 b - - 0 1');
    expect(engine.move('e6', 'e4')).not.toBeNull();
    expect(engine.getFen().split(' ')[3]).toBe('e5');
    expect(engine.move('d4', 'e5')?.captured).toBe('p');
    expect(engine.getPieceAt('e4')).toBeNull();
  });

  it('a position loaded from such a FEN (every screen rebuilds the engine each ply) still offers the capture', () => {
    const afterStep = torpedo('4k3/8/8/3p4/8/4P3/8/4K3 w - - 0 1');
    afterStep.move('e3', 'e5');
    const fen = afterStep.getFen();
    expect(fen).toBe('4k3/8/8/3pP3/8/8/8/4K3 b - e4 0 1');
    const reloaded = torpedo(fen);
    expect(reloaded.getFen()).toBe(fen);
    expect(reloaded.getLegalMoves('d5')).toContain('e4');
    expect(reloaded.move('d5', 'e4')?.captured).toBe('p');
  });

  it('the right is only for the very next move', () => {
    const engine = torpedo('4k3/8/8/3p4/8/4P3/7P/4K3 w - - 0 1');
    engine.move('e3', 'e5');
    engine.move('e8', 'd8'); // Black declines
    engine.move('h2', 'h3');
    expect(engine.getFen().split(' ')[3]).toBe('-');
    expect(engine.getLegalMoves('d5')).not.toContain('e4');
  });

  it('is not allowed when the capture would expose the capturing side’s own king (chess.js legality stays authoritative)', () => {
    // Black king a5 and White rook h5 with Black pawn d5 and the White pawn arriving on e5: taking en passant empties the 5th rank for the rook.
    const engine = torpedo('8/8/8/k2p3R/8/4P3/8/4K3 w - - 0 1');
    expect(engine.move('e3', 'e5')).not.toBeNull();
    expect(engine.getLegalMoves('d5')).not.toContain('e4');
  });
});

describe('checkmate and stalemate see the double step', () => {
  // White king h8 in check from the bishop a1; g8 (rook g1), h7 (rook a7) and g7 are covered. In ordinary chess this is mate;
  // in Torpedo the pawn on e3 blocks on e5 with a double step (a single step to e4 would not).
  const BLOCKABLE_MATE = '7K/r7/8/8/1k6/4P3/8/b5r1 w - - 0 1';

  it('control: standard chess calls it checkmate', () => {
    const standard = new ChessEngine(BLOCKABLE_MATE, { skipValidation: true });
    expect(standard.getStatus()).toBe('checkmate');
    expect(standard.isGameOver()).toBe(true);
  });

  it('Torpedo: still check, the game goes on, and the only legal move is the block e3-e5', () => {
    const engine = torpedo(BLOCKABLE_MATE);
    expect(engine.getStatus()).toBe('check');
    expect(engine.isGameOver()).toBe(false);
    expect(engine.getLegalMoveCount()).toBe(1);
    expect(engine.getLegalMoves('e3')).toEqual(['e5']);
    expect(getTorpedoMoves(engine).map((m) => `${m.from}${m.to}`)).toEqual(['e3e5']);
    expect(engine.move('e3', 'e4')).toBeNull();
    expect(engine.move('e3', 'e5')).not.toBeNull();
    expect(engine.getStatus()).toBe('playing');
  });

  it('a mating move that the opponent can still parry with a double step is a check ("+"), not a mate ("#")', () => {
    const engine = torpedo('7K/r7/8/8/1k6/4P3/3b4/6r1 b - - 0 1');
    const played = engine.move('d2', 'c3');
    expect(played?.san).toBe('Bc3+');
    expect(engine.getStatus()).toBe('check');
  });

  it('a real checkmate stays a checkmate: with the pawn blocked from the diagonal there is no double step to save it', () => {
    // Same net, but the pawn stands on e4 with e5 occupied by a Black knight... the diagonal is blocked at e5 already, so use a pawn on h3 instead.
    const engine = torpedo('7K/r7/8/8/1k6/7P/8/b5r1 w - - 0 1');
    expect(engine.getStatus()).toBe('checkmate');
    expect(engine.isGameOver()).toBe(true);
    expect(engine.getLegalMoveCount()).toBe(0);
  });

  it('a stalemate stays a stalemate', () => {
    const engine = torpedo('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(engine.getStatus()).toBe('stalemate');
    expect(engine.isGameOver()).toBe(true);
  });

  it('the fool’s mate is still mate (the double step from the start rank is chess.js’s own)', () => {
    const engine = torpedo(TORPEDO_START_FEN);
    for (const [from, to] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) expect(engine.move(from, to)).not.toBeNull();
    expect(engine.getStatus()).toBe('checkmate');
  });
});

describe('draws are the standard ones', () => {
  it('fifty-move rule', () => {
    expect(torpedo('4k3/8/8/8/8/8/R7/4K3 w - - 100 80').getStatus()).toBe('draw');
    expect(torpedo('4k3/8/8/8/8/8/R7/4K3 w - - 99 80').getStatus()).toBe('playing');
  });

  it('insufficient material is a draw (king against king, king and bishop against king)...', () => {
    expect(torpedo('4k3/8/8/8/8/8/8/4K3 w - - 0 1').getStatus()).toBe('draw');
    expect(torpedo('4k3/8/8/8/8/8/8/3BK3 w - - 0 1').getStatus()).toBe('draw');
  });

  it('...but never while a pawn is on the board: it can still step to promotion', () => {
    expect(torpedo('4k3/8/8/8/8/8/P7/4K3 w - - 0 1').getStatus()).toBe('playing');
  });
});

describe('everything else is ordinary chess', () => {
  it('castling still works', () => {
    const engine = torpedo('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(engine.getLegalMoves('e1')).toContain('g1');
    expect(engine.move('e1', 'g1')?.san).toBe('O-O');
    expect(engine.getPieceAt('f1')).toEqual({ type: 'r', color: 'w' });
  });

  it('a normal capture, check and the one-step move are unaffected', () => {
    const engine = torpedo('4k3/8/3p4/4P3/8/8/8/4K3 w - - 0 1');
    expect(engine.getLegalMoves('e5').sort()).toEqual(['d6', 'e6', 'e7']); // e7: the torpedo step; the capture on d6 is ordinary
    expect(engine.move('e5', 'd6')?.captured).toBe('p');
  });
});

// --- Oracle: an independent derivation of the double steps, by rewriting the FEN instead of make/undo -----------------

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every torpedo double step the rules allow in `fen`, derived WITHOUT the engine: move the pawn in the placement string and ask chess.js whether the
 * mover's king is attacked in the resulting position. */
function oracleDoubleSteps(fen: string): string[] {
  const [placement, turn, castling, , , fullmove] = fen.split(' ');
  const rows = placement.split('/').map((row) => {
    const cells: string[] = [];
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') for (let i = 0; i < Number(ch); i++) cells.push('');
      else cells.push(ch);
    }
    return cells;
  });
  const own = turn === 'w' ? 'P' : 'p';
  const step = turn === 'w' ? -1 : 1; // row index moves toward rank 8 for White
  const found: string[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (rows[row][col] !== own) continue;
      const rank = 8 - row;
      if ((turn === 'w' && rank === 2) || (turn === 'b' && rank === 7)) continue; // chess.js's own double step
      const toRow = row + 2 * step;
      if (toRow < 0 || toRow > 7 || rank < 2 || rank > 7) continue;
      if (rows[row + step][col] !== '' || rows[toRow][col] !== '') continue;
      const next = rows.map((r) => [...r]);
      next[row][col] = '';
      next[toRow][col] = rows[toRow][col] === '' && (toRow === 0 || toRow === 7) ? (turn === 'w' ? 'Q' : 'q') : own;
      const placementAfter = next.map((r) => {
        let out = '';
        let run = 0;
        for (const cell of r) {
          if (cell === '') run++;
          else {
            if (run) out += run;
            run = 0;
            out += cell;
          }
        }
        return run ? out + run : out;
      }).join('/');
      const skipped = `${'abcdefgh'[col]}${8 - (row + step)}`;
      const after = new Chess(`${placementAfter} ${turn === 'w' ? 'b' : 'w'} ${castling} ${skipped} 0 ${fullmove}`, { skipValidation: true });
      const king = after.findPiece({ type: 'k', color: turn as 'w' | 'b' })[0];
      if (king && after.isAttacked(king, turn === 'w' ? 'b' : 'w')) continue;
      found.push(`${'abcdefgh'[col]}${rank}${'abcdefgh'[col]}${8 - toRow}`);
    }
  }
  return found.sort();
}

describe('seeded playouts agree with an independent oracle', () => {
  it('every position of 24 random games: the engine offers exactly the oracle’s double steps, every listed move is playable, the king is never left attacked and the FEN round-trips', () => {
    let positions = 0;
    let doubleStepsPlayed = 0;
    for (let game = 0; game < 24; game++) {
      const random = mulberry32(1000 + game);
      let fen = TORPEDO_START_FEN;
      for (let ply = 0; ply < 90; ply++) {
        const engine = torpedo(fen);
        expect(torpedo(engine.getFen()).getFen()).toBe(fen);
        if (engine.isGameOver()) break;
        const moves = getTorpedoMoves(engine);
        expect(moves.length).toBeGreaterThan(0);
        positions++;

        const offered = new Set<string>();
        for (const m of moves) {
          const piece = engine.getPieceAt(m.from);
          if (piece?.type === 'p' && m.from[0] === m.to[0] && Math.abs(Number(m.to[1]) - Number(m.from[1])) === 2) offered.add(`${m.from}${m.to}`);
        }
        const turn = engine.getTurn();
        const homeRank = turn === 'w' ? '2' : '7';
        const extra = [...offered].filter((s) => s[1] !== homeRank).sort();
        expect(extra).toEqual(oracleDoubleSteps(fen));

        expect(engine.getLegalMoveCount()).toBe(moves.length); // both count a promotion once per piece

        const pick = moves[Math.floor(random() * moves.length)];
        const scratch = torpedo(fen);
        const played = scratch.move(pick.from, pick.to, pick.promotion);
        expect(played).not.toBeNull();
        const kingSquare = scratch.getBoard().flat().find((s) => s.piece?.type === 'k' && s.piece.color === turn)?.square;
        expect(kingSquare).toBeDefined();
        expect(scratch.isSquareAttacked(kingSquare as string, turn === 'w' ? 'b' : 'w')).toBe(false);
        if (offered.has(`${pick.from}${pick.to}`) && extra.includes(`${pick.from}${pick.to}`)) doubleStepsPlayed++;
        fen = scratch.getFen();
      }
    }
    expect(positions).toBeGreaterThan(1000);
    expect(doubleStepsPlayed).toBeGreaterThan(50);
  });
});
