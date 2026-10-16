import { describe, expect, it } from 'vitest';
import { ChessEngine } from '../ChessEngine';
import { getHordeMoves } from '../horde';

/**
 * Gaps found by the mutation check of the merged Horde (paired/horde-chess): nothing pinned that (1) the move LIST reports an en passant capture as a capture,
 * (2) a first-rank double step can really be captured en passant, (3) the double step belongs to PAWNS only, and (4) a position where White has nothing left is
 * game over even with BLACK to move (chess.js alone would call it "playing" there). Each test names the mutant it kills.
 */
const horde = (fen: string) => new ChessEngine(fen, { horde: true });

describe('en passant in the Horde move list', () => {
  it('a pawn that can take en passant is listed WITH its captured pawn (the list drives material, sounds and the bot)', () => {
    // Black has just played d7-d5 beside White's pawn on e5: the FEN carries the en passant square d6, so White's e5 pawn may take there.
    const engine = horde('4k3/8/8/3pP3/8/8/8/8 w - d6 0 1');
    const moves = getHordeMoves(engine, 'e5');
    const ep = moves.find((m) => m.to === 'd6');
    expect(ep).toBeDefined();
    expect(ep?.captured).toBe('p');
  });
});

describe('the first-rank double step can be captured en passant', () => {
  it('White a1-a3 passes over a2; a Black pawn on b3 may take on a2, which removes the pawn on a3', () => {
    const engine = horde('4k3/8/8/8/8/1p6/8/P7 w - - 0 1');
    expect(engine.getLegalMoves('a1')).toContain('a3');
    const stepped = engine.move('a1', 'a3');
    expect(stepped).not.toBeNull();
    expect(engine.getFen().split(' ')[3]).toBe('a2'); // the en passant square is recorded
    expect(engine.getLegalMoves('b3')).toContain('a2');
    const taken = engine.move('b3', 'a2');
    expect(taken).not.toBeNull();
    expect(engine.getPieceAt('a3')).toBeNull(); // the stepped pawn is gone, not the one on a2
    expect(engine.getPieceAt('a2')?.color).toBe('b');
  });
});

describe('the first-rank double step is a PAWN rule', () => {
  it('a White knight on b1 cannot "double step" to b3', () => {
    const engine = horde('4k3/8/8/8/8/8/8/1N6 w - - 0 1');
    expect(engine.getLegalMoves('b1')).not.toContain('b3');
    expect(engine.move('b1', 'b3')).toBeNull();
  });

  it('...while a pawn on b1 does have it (control)', () => {
    expect(horde('4k3/8/8/8/8/8/8/1P6 w - - 0 1').getLegalMoves('b1')).toContain('b3');
  });
});

describe('an empty horde is game over whoever is to move', () => {
  it('with Black to move and no White piece left the game is over (Black won by capturing the last one)', () => {
    expect(horde('4k3/8/8/8/8/8/8/8 b - - 0 1').isGameOver()).toBe(true);
  });

  it('a position with White material left and Black to move is not over', () => {
    expect(horde('4k3/8/8/8/8/8/P7/8 b - - 0 1').isGameOver()).toBe(false);
  });
});
