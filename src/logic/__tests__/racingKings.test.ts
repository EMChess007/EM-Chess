import { describe, expect, it } from 'vitest';
import { ChessEngine } from '../ChessEngine';
import { chooseRacingKingsBotMove } from '../bots';
import { getGameOutcome } from '../gameResult';
import {
  getRacingKingsMoves,
  getRacingKingsOutcome,
  getRacingKingsWinner,
  racingKingsKingsOnGoal,
  racingKingsOutcomeFromFen,
} from '../racingKings';

// Racing Kings: rules engine, outcome, bot. Literals on purpose (mutation-targeted constants are never read from the module).
const START = '8/8/8/8/8/8/krbnNBRK/qrbnNBRQ w - - 0 1';
const rk = (fen: string) => new ChessEngine(fen, { racingKings: true });

function seededRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('Racing Kings start position', () => {
  it('is the standard layout and White moves first', () => {
    const engine = rk(START);
    expect(engine.getFen()).toBe(START);
    expect(engine.getTurn()).toBe('w');
    expect(engine.getPieceAt('h2')).toEqual({ type: 'k', color: 'w' });
    expect(engine.getPieceAt('a2')).toEqual({ type: 'k', color: 'b' });
    expect(engine.getStatus()).toBe('playing');
    expect(engine.isGameOver()).toBe(false);
  });

  it('offers only check-free moves, and the count agrees with the list', () => {
    const engine = rk(START);
    const moves = getRacingKingsMoves(engine);
    expect(moves.length).toBeGreaterThan(0);
    expect(engine.getLegalMoveCount()).toBe(moves.length);
    for (const m of moves) {
      const probe = rk(START);
      const played = probe.move(m.from, m.to);
      expect(played).not.toBeNull();
      expect(played?.san).not.toMatch(/[+#]/);
    }
  });
});

describe('giving check is illegal', () => {
  it('a rook move that would check the black king is refused, a quiet one is allowed', () => {
    const engine = rk('8/8/7k/8/8/8/8/R3K3 w - - 0 1');
    expect(engine.getLegalMoves('a1')).not.toContain('a6'); // checks along rank 6
    expect(engine.move('a1', 'a6')).toBeNull();
    expect(engine.getFen()).toBe('8/8/7k/8/8/8/8/R3K3 w - - 0 1'); // nothing was played
    expect(engine.getLegalMoves('a1')).toContain('a5');
    expect(engine.move('a1', 'a5')).not.toBeNull();
  });

  it('a king may not step into check (the ordinary half of the rule)', () => {
    const engine = rk('8/8/8/8/8/k7/3r4/4K3 w - - 0 1');
    const moves = engine.getLegalMoves('e1');
    for (const covered of ['d1', 'e2', 'f2']) expect(moves).not.toContain(covered); // all on the black rook's lines
    expect(moves).toContain('d2'); // capturing the rook is fine
    expect(moves).toContain('f1');
  });

  it('the same position in ordinary chess DOES allow the checking move (control)', () => {
    const engine = new ChessEngine('8/8/7k/8/8/8/8/R3K3 w - - 0 1');
    expect(engine.getLegalMoves('a1')).toContain('a6');
  });
});

describe('results', () => {
  it('reads which kings stand on rank 8', () => {
    expect(racingKingsKingsOnGoal('K6k/8/8/8/8/8/8/8 w - - 0 1')).toEqual({ w: true, b: true });
    expect(racingKingsKingsOnGoal('K7/8/8/8/8/8/8/k7 b - - 0 1')).toEqual({ w: true, b: false });
    expect(racingKingsKingsOnGoal(START)).toEqual({ w: false, b: false });
  });

  it('both kings on rank 8 is a draw', () => {
    expect(racingKingsOutcomeFromFen('K6k/8/8/8/8/8/8/8 w - - 0 1')).toBe('draw');
  });

  it('only Black on rank 8 is a Black win at once', () => {
    expect(racingKingsOutcomeFromFen('8/8/8/8/8/8/K7/k7 w - - 0 1')).toBeNull();
    expect(racingKingsOutcomeFromFen('k7/8/8/8/8/8/K7/8 w - - 0 1')).toBe('b');
  });

  it('White on rank 8, Black to move and unable to reach it: White wins', () => {
    const engine = rk('K7/8/8/8/8/8/8/k7 b - - 0 1');
    // Black king a1 needs seven moves: it cannot reach rank 8 in one.
    expect(getRacingKingsOutcome(engine)).toBe('w');
    expect(getRacingKingsWinner(engine)).toBe('w');
  });

  it('White on rank 8, Black to move and ABLE to reach it: play goes on, and Black reaching it is a draw', () => {
    const engine = rk('K7/6k1/8/8/8/8/8/8 b - - 0 1');
    expect(getRacingKingsOutcome(engine)).toBeNull();
    expect(engine.move('g7', 'g8')).not.toBeNull();
    expect(getRacingKingsOutcome(engine)).toBe('draw');
    expect(getRacingKingsWinner(engine)).toBeNull();
    expect(engine.isGameOver()).toBe(true);
  });

  it('stalemate is a draw and never reported as checkmate', () => {
    const engine = rk('6r1/8/8/8/k7/8/1r6/7K w - - 0 1');
    expect(engine.getStatus()).toBe('stalemate');
    expect(engine.isGameOver()).toBe(true);
    expect(engine.getLegalMoveCount()).toBe(0);
  });

  it('the fifty-move rule is a draw, and so is insufficient material (bare kings)', () => {
    expect(rk('8/8/8/8/8/8/k7/R6K w - - 100 80').getStatus()).toBe('draw');
    expect(rk('8/8/8/8/8/8/k7/R6K w - - 0 1').getStatus()).toBe('playing');
    expect(rk('8/8/8/8/8/8/k7/7K w - - 0 1').getStatus()).toBe('draw');
  });

  it('Black reaching rank 8 FIRST wins (White is not there)', () => {
    const engine = rk('8/6k1/8/8/8/8/K7/8 b - - 0 1');
    expect(getRacingKingsOutcome(engine)).toBeNull();
    expect(engine.move('g7', 'g8')).not.toBeNull();
    expect(getRacingKingsOutcome(engine)).toBe('b');
    expect(getRacingKingsWinner(engine)).toBe('b');
    expect(engine.isGameOver()).toBe(true);
  });
});

describe('getGameOutcome threading', () => {
  it('maps the Racing Kings outcome to a PGN result with its own reason', () => {
    const base = ['playing', 'w', null, null, false, null, null, null, null, null, null, null, null, false] as const;
    expect(getGameOutcome(...base, 'w')).toEqual({ over: true, result: '1-0', reason: 'racingKings' });
    expect(getGameOutcome(...base, 'b')).toEqual({ over: true, result: '0-1', reason: 'racingKings' });
    expect(getGameOutcome(...base, 'draw')).toEqual({ over: true, result: '1/2-1/2', reason: 'racingKings' });
    expect(getGameOutcome(...base, null)).toEqual({ over: false });
  });
});

describe('the Racing Kings bot', () => {
  it('takes a king move that wins the race outright', () => {
    const engine = rk('8/6K1/8/8/8/8/8/k7 w - - 0 1');
    const move = chooseRacingKingsBotMove(engine, 3000, () => 0);
    expect(move?.from).toBe('g7');
    expect(move?.to[1]).toBe('8');
  });

  it('never plays a move the engine refuses, over a seeded game', () => {
    const rng = seededRng(7);
    const engine = rk(START);
    for (let ply = 0; ply < 60 && !engine.isGameOver() && !getRacingKingsOutcome(engine); ply++) {
      const move = chooseRacingKingsBotMove(engine, ply % 2 === 0 ? 1500 : 400, rng);
      if (!move) break;
      const played = engine.move(move.from, move.to, move.promotion);
      expect(played).not.toBeNull();
      expect(played?.san).not.toMatch(/[+#]/);
    }
  });

  it('returns null when it has no legal move', () => {
    expect(chooseRacingKingsBotMove(rk('6r1/8/8/8/k7/8/1r6/7K w - - 0 1'), 1500, () => 0)).toBeNull();
  });
});
