import { describe, expect, it } from 'vitest';
import { ChessEngine } from '../ChessEngine';
import { getCrazyhouseMoves } from '../crazyhouse';

/**
 * Gap found by the mutation check of the merged Crazyhouse (paired/crazyhouse): nothing pinned that the move LIST reports an en passant capture as a capture
 * (the list drives the material tray, the capture sound and the bot). The en passant capture also banks a pawn: tested here through the engine, which is what
 * the game screens use.
 */
const crazy = (fen: string) => new ChessEngine(fen, { crazyhouse: true });

describe('en passant in Crazyhouse', () => {
  // Black has just played d7-d5 beside White's pawn on e5: the FEN carries the en passant square d6, so White's e5 pawn may take there.
  const FEN = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';

  it('the move list reports the en passant capture WITH the captured pawn', () => {
    const ep = getCrazyhouseMoves(crazy(FEN), 'e5').find((m) => m.to === 'd6');
    expect(ep).toBeDefined();
    expect(ep?.captured).toBe('p');
  });

  it('...and playing it banks one pawn for the capturer', () => {
    const engine = crazy(FEN);
    expect(engine.move('e5', 'd6')).not.toBeNull();
    expect(engine.getCrazyhouseState().reserve.w.p).toBe(1);
    expect(engine.getCrazyhouseState().reserve.b.p).toBe(0);
    expect(engine.getPieceAt('d5')).toBeNull(); // the pawn taken en passant is gone from ITS square
  });
});
