import { describe, expect, it } from 'vitest';
import { ChessEngine } from '../ChessEngine';
import { getGameOutcome } from '../gameResult';
import { buildGamePayload } from '../gamePayload';
import { KNIGHTMATE_PROMOTION_CHOICES, PROMOTION_LABELS, getPromotionChoices } from '../promotion';
import { repetitionKey, isThreefoldRepetition } from '../repetition';
import { knightmateShape } from '../knightmateGame';
import {
  KNIGHTMATE_PROMOTIONS,
  KNIGHTMATE_START_FEN,
  kmApply,
  kmFen,
  kmInCheck,
  kmInsufficientMaterial,
  kmLegalMoves,
  kmOnlyRoyalKnight,
  kmParseFen,
  kmTimeoutResult,
} from '../knightmate';

/**
 * Knightmate (see knightmate.ts): the royal piece is a KNIGHT (letter k), the ordinary king is a non-royal COMMONER (letter m).
 * Constants are written as LITERALS (a test that reads them from the module under test cannot kill a mutant of them).
 * Every position below is a hand-built FEN in the internal letters: r rook, b bishop, q queen, p pawn, k ROYAL KNIGHT, m COMMONER.
 */
const km = (fen: string) => new ChessEngine(fen, { knightmate: true });
const targets = (fen: string, square: string) => km(fen).getLegalMoves(square).sort();
const perft = (fen: string, depth: number): number => {
  const pos = kmParseFen(fen);
  if (depth === 0) return 1;
  return kmLegalMoves(pos).reduce((sum, move) => sum + (depth === 1 ? 1 : perft(kmFen(kmApply(pos, move).position), depth - 1)), 0);
};

describe('the position and its notation', () => {
  it('starts with the royal knight on e1/e8 and the commoners on b1/g1/b8/g8', () => {
    expect(KNIGHTMATE_START_FEN).toBe('rmbqkbmr/pppppppp/8/8/8/8/PPPPPPPP/RMBQKBMR w KQkq - 0 1');
    const engine = km(KNIGHTMATE_START_FEN);
    expect(engine.getPieceAt('e1')).toEqual({ type: 'k', color: 'w' });
    expect(engine.getPieceAt('e8')).toEqual({ type: 'k', color: 'b' });
    for (const square of ['b1', 'g1']) expect(engine.getPieceAt(square)).toEqual({ type: 'm', color: 'w' });
    for (const square of ['b8', 'g8']) expect(engine.getPieceAt(square)).toEqual({ type: 'm', color: 'b' });
    expect(engine.getFen()).toBe('rmbqkbmr/pppppppp/8/8/8/8/PPPPPPPP/RMBQKBMR w KQkq - 0 1');
    expect(engine.getBoard()[0][4]).toEqual({ square: 'e8', piece: { type: 'k', color: 'b' } });
  });

  it('the opening has 18 moves (16 pawn moves and 2 royal-knight jumps; the commoners are boxed in) and 324 after two plies', () => {
    expect(perft(KNIGHTMATE_START_FEN, 1)).toBe(18);
    expect(perft(KNIGHTMATE_START_FEN, 2)).toBe(324);
    expect(km(KNIGHTMATE_START_FEN).getLegalMoves('e1').sort()).toEqual(['d3', 'f3']);
    expect(km(KNIGHTMATE_START_FEN).getLegalMoves('b1')).toEqual([]);
  });

  it('writes K for the royal knight and M for the commoner, and =M for a promotion to a commoner', () => {
    const engine = km(KNIGHTMATE_START_FEN);
    expect(engine.move('e2', 'e4')?.san).toBe('e4');
    expect(engine.move('a7', 'a6')?.san).toBe('a6');
    expect(engine.move('e1', 'f3')?.san).toBe('Kf3');
    expect(engine.move('b8', 'a7')?.san).toBe('Ma7');
    expect(engine.getHistory()).toEqual(['e4', 'a6', 'Kf3', 'Ma7']);
    const promo = km('7k/P7/8/8/8/8/8/K7 w - - 0 1');
    expect(promo.move('a7', 'a8', 'm')?.san).toBe('a8=M');
  });

  it('undo and reset restore the position and the history', () => {
    const engine = km(KNIGHTMATE_START_FEN);
    engine.move('e2', 'e4');
    engine.move('e8', 'f6');
    engine.undo();
    expect(engine.getFen()).toBe('rmbqkbmr/pppppppp/8/8/4P3/8/PPPP1PPP/RMBQKBMR b KQkq - 0 1');
    expect(engine.getHistory()).toEqual(['e4']);
    engine.reset();
    expect(engine.getFen()).toBe(KNIGHTMATE_START_FEN);
    expect(engine.getHistory()).toEqual([]);
  });
});

describe('the royal knight is the only royal piece', () => {
  it('cannot move into check', () => {
    // A black rook on g8 covers g2: the royal knight on e1 may go to c2, d3 and f3 only.
    expect(targets('k5r1/8/8/8/8/8/8/4K3 w - - 0 1', 'e1')).toEqual(['c2', 'd3', 'f3']);
  });

  it('can never stand a knight\'s move from the enemy royal knight (each would attack the other)', () => {
    // The black royal knight on a8 attacks b6 and c7; the White one on a4 may jump to b2, c3 and c5 but not b6.
    expect(targets('k7/8/8/8/K7/8/8/8 w - - 0 1', 'a4')).toEqual(['b2', 'c3', 'c5']);
  });

  it('a commoner CAN move onto an attacked square and CAN be captured', () => {
    // The black rook on h5 attacks all of rank 5; the White commoner on e4 may still step to d5, e5 and f5.
    const fen = 'k7/8/8/7r/4M3/8/8/K7 w - - 0 1';
    expect(targets(fen, 'e4')).toEqual(['d3', 'd4', 'd5', 'e3', 'e5', 'f3', 'f4', 'f5']);
    const engine = km(fen);
    expect(engine.move('e4', 'e5')?.san).toBe('Me5');
    expect(engine.move('h5', 'e5')?.captured).toBe('m');
    expect(engine.getStatus()).toBe('playing');
  });

  it('a commoner next to the royal knight gives check, and a piece pinned to the royal knight cannot leave the line', () => {
    expect(kmInCheck(kmParseFen('k7/M7/8/8/8/8/8/7K b - - 0 1'))).toBe(true);
    // Bishop on e2 pinned by the rook on e8 against the royal knight on e1: it has no move at all.
    expect(targets('k3r3/8/8/8/8/8/4B3/4K3 w - - 0 1', 'e2')).toEqual([]);
    // A pinned rook may only move along the pin: up the e-file, capturing the pinner, never sideways.
    expect(targets('k3r3/8/8/8/8/8/4R3/4K3 w - - 0 1', 'e2')).toEqual(['e3', 'e4', 'e5', 'e6', 'e7', 'e8']);
  });

  it('checkmate ends the game for the side to move; stalemate is a draw', () => {
    const mate = km('k7/Q7/8/8/8/8/8/7K b - - 0 1');
    expect(mate.getStatus()).toBe('checkmate');
    expect(mate.isGameOver()).toBe(true);
    expect(getGameOutcome(mate.getStatus(), mate.getTurn(), null)).toMatchObject({ over: true, result: '1-0', reason: 'checkmate' });
    const stale = km('k7/8/8/2Q5/8/8/8/7K b - - 0 1');
    expect(stale.getStatus()).toBe('stalemate');
    expect(stale.isGameOver()).toBe(true);
    expect(getGameOutcome(stale.getStatus(), stale.getTurn(), null)).toMatchObject({ over: true, result: '1/2-1/2', reason: 'stalemate' });
  });
});

describe('castling', () => {
  // The Black royal knight on b8 is attacked by neither rook (a8 would be: the rook on a1 sees the whole a-file).
  const both = '1k6/8/8/8/8/8/8/R3K2R w KQ - 0 1';

  it('the royal knight castles on both sides: two squares toward the rook, the rook to its other side', () => {
    expect(targets(both, 'e1')).toContain('g1');
    expect(targets(both, 'e1')).toContain('c1');
    const kingside = km(both);
    expect(kingside.move('e1', 'g1')?.san).toBe('O-O');
    expect(kingside.getFen()).toBe('1k6/8/8/8/8/8/8/R4RK1 b - - 1 1');
    const queenside = km(both);
    expect(queenside.move('e1', 'c1')?.san).toBe('O-O-O');
    expect(queenside.getFen()).toBe('1k6/8/8/8/8/8/8/2KR3R b - - 1 1');
  });

  it('is refused through an attacked square, into one, out of check, and with a piece in the way', () => {
    expect(targets('k4r2/8/8/8/8/8/8/R3K2R w KQ - 0 1', 'e1')).not.toContain('g1'); // f1 attacked
    expect(targets('k4r2/8/8/8/8/8/8/R3K2R w KQ - 0 1', 'e1')).toContain('c1');
    expect(targets('k5r1/8/8/8/8/8/8/R3K2R w KQ - 0 1', 'e1')).not.toContain('g1'); // g1 attacked
    expect(targets('k3r3/8/8/8/8/8/8/R3K2R w KQ - 0 1', 'e1')).not.toContain('g1'); // in check
    expect(targets('k3r3/8/8/8/8/8/8/R3K2R w KQ - 0 1', 'e1')).not.toContain('c1');
    expect(targets('k7/8/8/8/8/8/8/R2MK2R w KQ - 0 1', 'e1')).not.toContain('c1'); // d1 occupied
    expect(targets('k7/8/8/8/8/8/8/R3KM1R w KQ - 0 1', 'e1')).not.toContain('g1'); // f1 occupied
  });

  it('may pass over an attacked b1 (only the royal knight\'s own squares count)', () => {
    expect(targets('kr6/8/8/8/8/8/8/R3K2R w KQ - 0 1', 'e1')).toContain('c1');
  });

  it('is lost when the royal knight moves, or when that rook moves or is captured', () => {
    const moved = km(both);
    moved.move('e1', 'd3');
    moved.move('b8', 'c6');
    moved.move('d3', 'e1');
    moved.move('c6', 'b8');
    expect(moved.getLegalMoves('e1')).not.toContain('g1');
    expect(moved.getLegalMoves('e1')).not.toContain('c1');
    const rook = km(both);
    rook.move('h1', 'h2');
    rook.move('b8', 'c6');
    rook.move('h2', 'h1');
    rook.move('c6', 'b8');
    expect(rook.getLegalMoves('e1')).not.toContain('g1');
    expect(rook.getLegalMoves('e1')).toContain('c1');
    const captured = km('6k1/8/8/8/8/8/6b1/R3K2R b KQ - 0 1');
    expect(captured.move('g2', 'h1')?.captured).toBe('r');
    expect(captured.getFen().split(' ')[2]).toBe('Q');
  });
});

describe('promotion, en passant and the draws', () => {
  it('a pawn promotes to a queen, rook, bishop or commoner -- never a knight', () => {
    const fen = '7k/P7/8/8/8/8/8/K7 w - - 0 1';
    expect(KNIGHTMATE_PROMOTIONS).toEqual(['q', 'r', 'b', 'm']);
    const promotions = kmLegalMoves(kmParseFen(fen)).filter((m) => m.from === 48).map((m) => m.promotion);
    expect(promotions).toEqual(['q', 'r', 'b', 'm']);
    expect(km(fen).move('a7', 'a8', 'n')).toBeNull();
    expect(km(fen).move('a7', 'a8', 'k')).toBeNull();
    expect(km(fen).move('a7', 'a8', 'm')?.promotion).toBe('m');
    expect(km(fen).getPieceAt('a7')).toEqual({ type: 'p', color: 'w' });
    const queen = km(fen);
    queen.move('a7', 'a8');
    expect(queen.getPieceAt('a8')).toEqual({ type: 'q', color: 'w' });
    const commoner = km(fen);
    commoner.move('a7', 'a8', 'm');
    expect(commoner.getPieceAt('a8')).toEqual({ type: 'm', color: 'w' });
  });

  it('en passant works', () => {
    const engine = km('k7/8/8/8/3p4/8/4P3/K7 w - - 0 1');
    engine.move('e2', 'e4');
    expect(engine.getFen()).toBe('k7/8/8/8/3pP3/8/8/K7 b - e3 0 1');
    const capture = engine.move('d4', 'e3');
    expect(capture?.captured).toBe('p');
    expect(engine.getPieceAt('e4')).toBeNull();
    expect(engine.getPieceAt('e3')).toEqual({ type: 'p', color: 'b' });
  });

  it('two bare royal knights are an automatic draw; any other piece plays on', () => {
    expect(km('k7/8/8/8/8/8/8/K7 w - - 0 1').getStatus()).toBe('draw');
    expect(kmInsufficientMaterial(kmParseFen('k7/8/8/8/8/8/8/K7 w - - 0 1'))).toBe(true);
    expect(km('k7/8/8/8/8/8/8/KM6 w - - 0 1').getStatus()).toBe('playing');
    expect(km('k7/8/8/8/8/8/P7/K7 w - - 0 1').getStatus()).toBe('playing');
    expect(km('k7/8/8/8/8/8/8/KB6 w - - 0 1').getStatus()).toBe('playing');
    expect(getGameOutcome('draw', 'w', null)).toMatchObject({ over: true, result: '1/2-1/2', reason: 'draw' });
  });

  it('the fifty-move rule draws at 100 half-moves, but checkmate still wins on that move', () => {
    expect(km('k7/8/8/8/8/8/8/KM6 w - - 100 80').getStatus()).toBe('draw');
    expect(km('k7/8/8/8/8/8/8/KM6 w - - 99 80').getStatus()).toBe('playing');
    expect(km('k7/Q7/8/8/8/8/8/7K b - - 100 80').getStatus()).toBe('checkmate');
  });
});

describe('around the engine: the picker, the pictures, the result and repetition', () => {
  it('the promotion picker offers queen, rook, bishop and Commoner -- no knight, and the giveaway king is not mixed in', () => {
    expect(KNIGHTMATE_PROMOTION_CHOICES).toEqual(['q', 'r', 'b', 'm']);
    expect(getPromotionChoices(false, true)).toEqual(['q', 'r', 'b', 'm']);
    expect(getPromotionChoices(false)).toEqual(['q', 'r', 'b', 'n']);
    expect(PROMOTION_LABELS.m).toBe('Commoner');
  });

  it('draws the royal knight from the theme\'s knight and the commoner from the theme\'s king (every theme, custom ones too)', () => {
    expect(knightmateShape('k')).toBe('n');
    expect(knightmateShape('m')).toBe('k');
    for (const type of ['p', 'b', 'r', 'q'] as const) expect(knightmateShape(type)).toBe(type);
  });

  it('a flag fall against a bare royal knight is a draw by timeout; against anything else the flagged side loses', () => {
    expect(getGameOutcome('playing', 'w', null, null, false, null, null, null, null, null, null, null, null, false, null, true)).toEqual({ over: true, result: '1/2-1/2', reason: 'timeout' });
    expect(getGameOutcome('playing', 'w', 'b')).toEqual({ over: true, result: '0-1', reason: 'timeout' });
  });

  it('the saved game is tagged [Variant "Knightmate"] and a drawn flag fall is 1/2-1/2', () => {
    const payload = buildGamePayload({
      chessStatus: 'playing',
      turn: 'w',
      timeoutWinner: null,
      timeoutDraw: true,
      knightmate: true,
      history: [{ move: { from: 'e2', to: 'e4', san: 'e4' }, fenBefore: KNIGHTMATE_START_FEN, fenAfter: KNIGHTMATE_START_FEN }] as never,
      initialFen: KNIGHTMATE_START_FEN,
      chess960: false,
      timeControl: { label: '5 min' } as never,
      opponentType: 'human',
    });
    expect(payload?.result).toBe('1/2-1/2');
    expect(payload?.pgn).toContain('[Variant "Knightmate"]');
  });

  it('threefold repetition works on a Knightmate FEN (the key reads placement, turn, castling and en passant only)', () => {
    // No castling rights (a royal knight that moved has lost them): the two royal knights shuffle a1-b3-a1 and a8-b6-a8.
    const engine = km('k7/8/8/8/8/8/8/KM6 w - - 0 1');
    const keys = [repetitionKey(engine.getFen())];
    for (let round = 0; round < 2; round++) {
      for (const [from, to] of [['a1', 'b3'], ['a8', 'b6'], ['b3', 'a1'], ['b6', 'a8']] as const) {
        expect(engine.move(from, to)).not.toBeNull();
        keys.push(repetitionKey(engine.getFen()));
      }
    }
    expect(keys[0]).toContain('k7/8/8/8/8/8/8/KM6');
    expect(isThreefoldRepetition(keys)).toBe(true);
    expect(isThreefoldRepetition(keys.slice(0, 5))).toBe(false); // only twice by then
  });
});

describe('the clock', () => {
  it('a flag with the opponent holding ONLY the royal knight is a draw; otherwise the flagged side loses', () => {
    const bareBlack = kmParseFen('k7/8/8/8/8/8/8/KM6 w - - 0 1');
    expect(kmOnlyRoyalKnight(bareBlack, 'b')).toBe(true);
    expect(kmOnlyRoyalKnight(bareBlack, 'w')).toBe(false);
    expect(kmTimeoutResult(bareBlack, 'w')).toBe('draw'); // White flags, Black has only its royal knight
    expect(kmTimeoutResult(bareBlack, 'b')).toBe('w'); // Black flags, White still has a commoner
    expect(kmTimeoutResult(kmParseFen(KNIGHTMATE_START_FEN), 'w')).toBe('b');
    expect(kmTimeoutResult(kmParseFen(KNIGHTMATE_START_FEN), 'b')).toBe('w');
  });
});
