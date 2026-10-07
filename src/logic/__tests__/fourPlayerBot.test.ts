import { describe, expect, it } from 'vitest';
import {
  BOT_LEVELS,
  chooseBotMove,
  currentMoves,
  findLegalMove,
  initialState,
  legalMoves,
  parseSquare,
  playMove,
  squareName,
  stateFromPieces,
  type BotLevel,
  type FourPlayerState,
  type GameEvent,
  type Move,
  type Seat,
} from '../fourPlayer';

const RED = 0;
const BLUE = 1;
const YELLOW = 2;
const GREEN = 3;

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const label = (m: Move) => `${squareName(m.from)}-${squareName(m.to)}`;
const KINGS = ['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7'];

interface PlayedGame {
  state: FourPlayerState;
  decisions: number;
  totalMs: number;
  maxMs: number;
  illegal: string[];
  eliminated: number;
  plies: number;
}

/** Plays a whole game with `levels[seat]` for each seat (dead kings walk by themselves, as in the real game). */
function selfPlay(levels: BotLevel[], seed: number, maxDecisions = 400): PlayedGame {
  const rng = seeded(seed);
  let state = initialState();
  const out: PlayedGame = { state, decisions: 0, totalMs: 0, maxMs: 0, illegal: [], eliminated: 0, plies: 0 };
  while (!state.result && out.decisions < maxDecisions) {
    const started = performance.now();
    const move = chooseBotMove(state, levels[state.turn], rng);
    const elapsed = performance.now() - started;
    out.totalMs += elapsed;
    out.maxMs = Math.max(out.maxMs, elapsed);
    out.decisions++;
    if (!move) {
      out.illegal.push(`no move for seat ${state.turn}`);
      break;
    }
    if (!currentMoves(state).some((m) => m.from === move.from && m.to === move.to)) {
      out.illegal.push(`seat ${state.turn} chose illegal ${label(move)}`);
      break;
    }
    const applied = playMove(state, move, rng);
    out.eliminated += applied.events.filter((e: GameEvent) => e.kind === 'eliminated').length;
    state = applied.state;
  }
  out.state = state;
  out.plies = state.ply;
  return out;
}

describe('bot choices', () => {
  it('returns a legal move at every level from the start position, for every seat', () => {
    for (const level of BOT_LEVELS) {
      for (const seat of [RED, BLUE, YELLOW, GREEN] as Seat[]) {
        const state = { ...initialState(), turn: seat };
        const legal = new Set(legalMoves(state, seat).map(label));
        for (let seed = 1; seed <= 3; seed++) {
          const move = chooseBotMove(state, level, seeded(seed));
          expect(move, `${level} seat ${seat}`).not.toBeNull();
          expect(legal.has(label(move!))).toBe(true);
        }
      }
    }
  });

  it('returns null when the seat has no legal move at all', () => {
    const boxed = stateFromPieces(['rK@h1', 'rR@e10', 'rR@m4', 'bK@a8', 'yK@g14', 'gK@n11'], { turn: GREEN });
    expect(chooseBotMove(boxed, 'hard')).toBeNull();
  });

  it('medium and hard take a free queen; easy at least sometimes does', () => {
    const state = stateFromPieces([...KINGS, 'rR@e5', 'yQ@e10']);
    for (const level of ['medium', 'hard'] as const) {
      for (let seed = 1; seed <= 6; seed++) expect(label(chooseBotMove(state, level, seeded(seed))!), `${level} ${seed}`).toBe('e5-e10');
    }
    const easyTakes = Array.from({ length: 30 }, (_, i) => label(chooseBotMove(state, 'easy', seeded(i + 1))!)).filter((m) => m === 'e5-e10');
    expect(easyTakes.length).toBeGreaterThan(5);
  });

  it('does not throw a queen away for a defended pawn', () => {
    const state = stateFromPieces([...KINGS, 'rQ@e5', 'yP@e9', 'yR@e12']);
    for (const level of ['medium', 'hard'] as const) {
      for (let seed = 1; seed <= 8; seed++) expect(label(chooseBotMove(state, level, seeded(seed))!), `${level} ${seed}`).not.toBe('e5-e9');
    }
  });

  it('finds a mate in one against the next seat, and prefers it to winning material', () => {
    // Red's rook on d11 checkmates Blue (boxed in by its own pawns) by reaching a11 — while a juicy Green queen hangs elsewhere.
    const state = stateFromPieces(['rK@h1', 'rR@d11', 'bK@a8', 'bP@b7', 'bP@b8', 'bP@b9', 'yK@h14', 'gK@n7', 'rN@f2', 'gQ@g4']);
    for (const level of ['medium', 'hard'] as const) {
      for (let seed = 1; seed <= 5; seed++) expect(label(chooseBotMove(state, level, seeded(seed))!), `${level} ${seed}`).toBe('d11-a11');
    }
  });

  it('looks ahead at the next ACTIVE seat: with Blue already out, it still finds the mate on Yellow', () => {
    // Blue (between Red and Yellow in turn order) is dead, so Yellow is the seat that actually answers Red's move.
    const state = stateFromPieces(['rK@h1', 'rR@k1', 'bK@d8', 'yK@h14', 'yP@g13', 'yP@h13', 'yP@i13', 'gK@n7'], { status: ['active', 'dead-king', 'active', 'active'] });
    for (const level of ['medium', 'hard'] as const) {
      for (let seed = 1; seed <= 5; seed++) expect(label(chooseBotMove(state, level, seeded(seed))!), `${level} ${seed}`).toBe('k1-k14');
    }
  });

  it('hard does not grab bait that lets the next seat checkmate it (a free queen that costs a back-rank mate)', () => {
    // Red's rook on d1 is all that guards the back rank against Blue's rook on e11 (Re1#). Capturing Yellow's loose queen on d9 would leave it.
    const state = stateFromPieces(['rK@h1', 'rP@g2', 'rP@h2', 'rP@i2', 'rR@d1', 'bK@a8', 'bR@e11', 'yK@g14', 'yQ@d9', 'gK@n7']);
    expect(legalMoves(state, RED).map(label)).toContain('d1-d9'); // the bait really is on offer
    for (let seed = 1; seed <= 8; seed++) {
      const choice = chooseBotMove(state, 'hard', seeded(seed))!;
      expect(label(choice), `seed ${seed}`).not.toBe('d1-d9');
      const afterRed = playMove(state, choice, seeded(1)).state;
      const matedBy = legalMoves(afterRed, BLUE).filter((reply) => {
        const next = playMove(afterRed, reply, seeded(1)).state;
        return next.status[RED] !== 'active' || (next.turn === RED && legalMoves(next, RED).length === 0);
      });
      expect(matedBy.map(label), `seed ${seed}: ${label(choice)}`).toEqual([]);
    }
  });
});

describe('self-play', () => {
  it('every level plays complete, legal games to a finish (elimination or the ply cap)', () => {
    const games: [BotLevel[], number][] = [
      [['easy', 'easy', 'easy', 'easy'], 1],
      [['medium', 'medium', 'medium', 'medium'], 2],
      [['hard', 'medium', 'easy', 'hard'], 3],
    ];
    for (const [levels, seed] of games) {
      const game = selfPlay(levels, seed);
      expect(game.illegal, levels.join('/')).toEqual([]);
      expect(game.state.result, `${levels.join('/')} did not finish`).not.toBeNull();
      expect(game.state.ply).toBeLessThanOrEqual(game.state.rules.maxPlies + 4);
      // Scores only ever increase and are consistent with the points table (multiples/sums of whole numbers).
      for (const s of game.state.score) expect(Number.isInteger(s) && s >= 0).toBe(true);
    }
  }, 180_000);

  it('performance: a decision takes well under a second even for the hard bot in a busy middlegame', () => {
    const game = selfPlay(['hard', 'hard', 'hard', 'hard'], 11, 120);
    expect(game.illegal).toEqual([]);
    const mean = game.totalMs / game.decisions;
    console.log(`[4pc perf] hard x4: ${game.decisions} decisions, mean ${mean.toFixed(1)} ms, max ${game.maxMs.toFixed(1)} ms`);
    expect(mean).toBeLessThan(250);
    expect(game.maxMs).toBeLessThan(1500);
  }, 180_000);
});
