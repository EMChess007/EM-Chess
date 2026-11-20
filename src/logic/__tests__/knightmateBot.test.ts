import { describe, expect, it } from 'vitest';
import { ChessEngine } from '../ChessEngine';
import { chooseKnightmateBotMove } from '../bots';
import { KNIGHTMATE_START_FEN } from '../knightmate';
import { getKnightmateMoves, knightmateTimeoutOutcome } from '../knightmateGame';

/** Seeded generator (mulberry32): no wall clock, no Math.random. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const km = (fen: string) => new ChessEngine(fen, { knightmate: true });

describe('the Knightmate bot', () => {
  it('lists the legal moves with their notation (K royal knight, M commoner)', () => {
    const moves = getKnightmateMoves(km(KNIGHTMATE_START_FEN));
    expect(moves).toHaveLength(18);
    expect(moves.map((m) => m.san)).toContain('Kf3');
    expect(moves.map((m) => m.san)).toContain('e4');
    expect(getKnightmateMoves(km(KNIGHTMATE_START_FEN), 'e1').map((m) => m.to).sort()).toEqual(['d3', 'f3']);
  });

  it('plays a mate in one when it has one (at full strength)', () => {
    // Queen b6 -> a7 mates the royal knight on a8: it attacks it and covers its two escape squares b6 / c7 ... via the queen's own lines.
    const engine = km('k7/8/1Q6/8/8/8/8/7K w - - 0 1');
    const choice = chooseKnightmateBotMove(engine, 3000, seeded(1));
    expect(choice).not.toBeNull();
    const after = km(engine.getFen());
    after.move(choice!.from, choice!.to, choice!.promotion);
    expect(after.getStatus()).toBe('checkmate');
  });

  it('does not hang its queen when a safe capture is available (full strength)', () => {
    // White can take the loose black queen on d5 with the commoner on e4 (Md5 is protected by nothing); the bot must prefer it to a quiet move.
    const engine = km('k7/8/8/3q4/4M3/8/8/K7 w - - 0 1');
    const choice = chooseKnightmateBotMove(engine, 3000, seeded(2));
    expect(choice).toMatchObject({ from: 'e4', to: 'd5', captured: 'q' });
  });

  it('never picks an illegal move: seeded bot-vs-bot games stay legal to the end, at several strengths', () => {
    for (const [seed, whiteElo, blackElo] of [[11, 400, 400], [12, 1500, 800], [13, 3000, 3000], [14, 2200, 400]] as const) {
      const rng = seeded(seed);
      const engine = km(KNIGHTMATE_START_FEN);
      for (let ply = 0; ply < 90 && !engine.isGameOver(); ply++) {
        const legalBefore = getKnightmateMoves(engine).map((m) => `${m.from}${m.to}${m.promotion ?? ''}`);
        const choice = chooseKnightmateBotMove(engine, engine.getTurn() === 'w' ? whiteElo : blackElo, rng);
        expect(choice).not.toBeNull();
        expect(legalBefore).toContain(`${choice!.from}${choice!.to}${choice!.promotion ?? ''}`);
        expect(engine.move(choice!.from, choice!.to, choice!.promotion)).not.toBeNull();
      }
    }
  });

  it('returns null when there is no legal move, and a random pick never under-promotes', () => {
    expect(chooseKnightmateBotMove(km('k7/Q7/8/8/8/8/8/7K b - - 0 1'), 3000, seeded(3))).toBeNull();
    const promoting = km('7k/P7/8/8/8/8/8/K7 w - - 0 1');
    for (let seed = 1; seed <= 20; seed++) {
      const choice = chooseKnightmateBotMove(promoting, 400, seeded(seed));
      if (choice?.from === 'a7') expect(choice.promotion).toBe('q');
    }
  });
});

describe('the clock rule for the game screens', () => {
  it('turns a win on time into a draw when the winner holds only its royal knight', () => {
    const bareWhite = 'k7/8/8/8/8/8/8/KM6 b - - 0 1';
    const bareBlack = 'k7/8/8/8/8/8/8/KM6 w - - 0 1';
    expect(knightmateTimeoutOutcome(bareBlack, 'b')).toEqual({ timeoutDraw: true, timeoutWinner: null }); // White flagged, Black has only its royal knight
    expect(knightmateTimeoutOutcome(bareWhite, 'w')).toEqual({ timeoutDraw: false, timeoutWinner: 'w' }); // Black flagged, White has a commoner
    expect(knightmateTimeoutOutcome(KNIGHTMATE_START_FEN, 'b')).toEqual({ timeoutDraw: false, timeoutWinner: 'b' });
    expect(knightmateTimeoutOutcome(KNIGHTMATE_START_FEN, null)).toEqual({ timeoutDraw: false, timeoutWinner: null });
  });
});
