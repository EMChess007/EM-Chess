import { describe, expect, it } from 'vitest';
import { getGameOutcome } from '../gameResult';
import { getThreeCheckCounts, getThreeCheckWinner, THREE_CHECK_TARGET } from '../threeCheck';
import { computeCapturedMaterial, materialValue } from '../material';
import { getKingOfTheHillWinner, KING_OF_THE_HILL_SQUARES } from '../kingOfTheHill';
import { ChessEngine } from '../ChessEngine';

describe('getGameOutcome', () => {
  it('reports no outcome for an ongoing game', () => {
    expect(getGameOutcome('playing', 'w', null)).toEqual({ over: false });
  });

  it('Fog of War win takes priority over every other reason', () => {
    const outcome = getGameOutcome('checkmate', 'w', 'b', 'b', true, 'b', 'b', 'w');
    expect(outcome).toEqual({ over: true, result: '1-0', reason: 'fogOfWar' });
  });

  it('checkmate result credits the side NOT to move (turn is who got mated)', () => {
    expect(getGameOutcome('checkmate', 'w', null)).toEqual({ over: true, result: '0-1', reason: 'checkmate' });
    expect(getGameOutcome('checkmate', 'b', null)).toEqual({ over: true, result: '1-0', reason: 'checkmate' });
  });

  it('stalemate and draw are always a draw result regardless of whose turn it is', () => {
    expect(getGameOutcome('stalemate', 'w', null)).toEqual({ over: true, result: '1/2-1/2', reason: 'stalemate' });
    expect(getGameOutcome('draw', 'b', null)).toEqual({ over: true, result: '1/2-1/2', reason: 'draw' });
  });

  it('timeout credits the side that did NOT run out of time', () => {
    expect(getGameOutcome('playing', 'w', 'b')).toEqual({ over: true, result: '0-1', reason: 'timeout' });
  });

  it('resignation credits the side the resigner did NOT play', () => {
    expect(getGameOutcome('playing', 'w', null, 'w')).toEqual({ over: true, result: '0-1', reason: 'resignation' });
  });

  it('king of the hill / three-check outrank ordinary chess.js status', () => {
    expect(getGameOutcome('checkmate', 'w', null, null, false, 'b')).toEqual({ over: true, result: '0-1', reason: 'kingOfTheHill' });
    expect(getGameOutcome('checkmate', 'w', null, null, false, null, 'w')).toEqual({ over: true, result: '1-0', reason: 'threeCheck' });
  });
});

describe('getThreeCheckCounts / getThreeCheckWinner', () => {
  it('counts only moves whose SAN actually ends in + or #, alternating by ply index', () => {
    const moves = [{ san: 'e4' }, { san: 'e5' }, { san: 'Bb5+' }, { san: 'c6' }, { san: 'Qh5+' }];
    expect(getThreeCheckCounts(moves)).toEqual({ w: 2, b: 0 });
  });

  it('a mating move (#) also counts as a check', () => {
    expect(getThreeCheckCounts([{ san: 'Qh7#' }])).toEqual({ w: 1, b: 0 });
  });

  it('nobody wins before reaching THREE_CHECK_TARGET checks', () => {
    const moves = Array.from({ length: THREE_CHECK_TARGET - 1 }, () => ({ san: 'Qh5+' }));
    // Not all on White's plies in this synthetic list, but the count-vs-target boundary is what's
    // under test — reconstruct an actual all-White sequence to isolate it cleanly.
    const whiteChecks: { san: string }[] = [];
    for (let i = 0; i < THREE_CHECK_TARGET - 1; i++) {
      whiteChecks.push({ san: 'Qh5+' }, { san: 'a6' });
    }
    expect(getThreeCheckWinner(whiteChecks)).toBeNull();
  });

  it('White wins the instant their checks reach THREE_CHECK_TARGET', () => {
    const moves: { san: string }[] = [];
    for (let i = 0; i < THREE_CHECK_TARGET; i++) moves.push({ san: 'Qh5+' }, { san: 'a6' });
    expect(getThreeCheckWinner(moves)).toBe('w');
  });

  it('is automatically correct after an Undo (just a shorter move list, no separate bookkeeping)', () => {
    const moves: { san: string }[] = [];
    for (let i = 0; i < THREE_CHECK_TARGET; i++) moves.push({ san: 'Qh5+' }, { san: 'a6' });
    expect(getThreeCheckWinner(moves)).toBe('w');
    const afterUndo = moves.slice(0, -2); // undo White's winning check + Black's reply
    expect(getThreeCheckWinner(afterUndo)).toBeNull();
  });
});

describe('computeCapturedMaterial / materialValue', () => {
  it('attributes each capture to the mover, grouped by the CAPTURED piece color', () => {
    const moves = [
      { captured: 'p' as const, moverColor: 'w' as const },
      { captured: undefined, moverColor: 'b' as const },
      { captured: 'n' as const, moverColor: 'b' as const },
    ];
    const { whiteCaptured, blackCaptured } = computeCapturedMaterial(moves);
    expect(whiteCaptured).toEqual(['p']); // White captured a black pawn
    expect(blackCaptured).toEqual(['n']); // Black captured a white knight
  });

  it('standard point values: pawn=1, knight=3, bishop=3, rook=5, queen=9', () => {
    expect(materialValue(['p'])).toBe(1);
    expect(materialValue(['n'])).toBe(3);
    expect(materialValue(['b'])).toBe(3);
    expect(materialValue(['r'])).toBe(5);
    expect(materialValue(['q'])).toBe(9);
    expect(materialValue(['p', 'p', 'n', 'q'])).toBe(1 + 1 + 3 + 9);
  });

  it('an empty capture list is worth zero', () => {
    expect(materialValue([])).toBe(0);
  });
});

describe('getKingOfTheHillWinner', () => {
  it('nobody wins while both kings are off the 4 center squares', () => {
    const engine = new ChessEngine();
    expect(getKingOfTheHillWinner(engine)).toBeNull();
  });

  it('declares the color of whichever king sits on ANY of the 4 center squares', () => {
    // Hand-written positions, one per center square, white king there and black king in a far
    // corner — ground truth, not generated logic that could itself hide a mirrored bug.
    const positionsBySquare: Record<string, string> = {
      d4: '7k/8/8/8/3K4/8/8/8 w - - 0 1',
      d5: '7k/8/8/3K4/8/8/8/8 w - - 0 1',
      e4: '7k/8/8/8/4K3/8/8/8 w - - 0 1',
      e5: '7k/8/8/4K3/8/8/8/8 w - - 0 1',
    };
    for (const square of KING_OF_THE_HILL_SQUARES) {
      const engine = new ChessEngine(positionsBySquare[square], { skipValidation: true });
      expect(getKingOfTheHillWinner(engine)).toBe('w');
    }
  });

  it("a black king on a center square is credited to black, not white", () => {
    const engine = new ChessEngine('7K/8/8/8/3k4/8/8/8 w - - 0 1', { skipValidation: true });
    expect(getKingOfTheHillWinner(engine)).toBe('b');
  });
});
