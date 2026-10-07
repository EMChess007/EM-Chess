import { describe, expect, it } from 'vitest';
import {
  CAREFUL_FROM_ELO,
  DEEP_FROM_ELO,
  botStrength,
  chooseBotMove,
  currentMoves,
  initialState,
  legalMoves,
  playMove,
  promotionOf,
  squareName,
  stateFromPieces,
  BISHOP,
  KNIGHT,
  QUEEN,
  ROOK,
  type FourPlayerState,
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
/**
 * Rngs that always take the bot's SCORED branch (a bot only plays its scored choice when rng() < bestChance, and bestChance >= 0.2 for any
 * ELO) with a little different noise each — for asserting which move a bot "wants" without the deliberate random weak moments.
 */
const SCORED_RNGS = [() => 0, () => 0.05, () => 0.1, () => 0.15];
const label = (m: Move) => `${squareName(m.from)}-${squareName(m.to)}`;
const KINGS = ['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7'];

interface PlayedGame {
  state: FourPlayerState;
  decisions: number;
  totalMs: number;
  maxMs: number;
  illegal: string[];
}

/** Plays a whole game with `elos[seat]` for each seat (dead kings walk by themselves, as in the real game). */
function selfPlay(elos: number[], seed: number, maxDecisions = 400): PlayedGame {
  const rng = seeded(seed);
  let state = initialState();
  const out: PlayedGame = { state, decisions: 0, totalMs: 0, maxMs: 0, illegal: [] };
  while (!state.result && out.decisions < maxDecisions) {
    const started = performance.now();
    const move = chooseBotMove(state, elos[state.turn], rng);
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
    state = playMove(state, move, rng).state;
  }
  out.state = state;
  return out;
}

describe('strength from ELO', () => {
  it('maps the roster ELO onto the same bestChance family as the other variants: 0.2 at 400 rising linearly to 0.9 at 3000, clamped outside', () => {
    expect(botStrength(400).bestChance).toBeCloseTo(0.2, 10);
    expect(botStrength(3000).bestChance).toBeCloseTo(0.9, 10);
    expect(botStrength(1700).bestChance).toBeCloseTo(0.55, 10);
    expect(botStrength(0).bestChance).toBeCloseTo(0.2, 10);
    expect(botStrength(5000).bestChance).toBeCloseTo(0.9, 10);
    expect(botStrength(1400).bestChance).toBeCloseTo(0.2 + (0.7 * 1000) / 2600, 10);
  });

  it('is monotonic over the whole roster: higher ELO never plays its scored move less often, nor with more noise, nor with a shallower search', () => {
    const roster = [400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600, 2800, 3000];
    const tiers = ['greedy', 'careful', 'deep'];
    for (let i = 1; i < roster.length; i++) {
      const lower = botStrength(roster[i - 1]);
      const higher = botStrength(roster[i]);
      expect(higher.bestChance, `${roster[i]}`).toBeGreaterThan(lower.bestChance);
      expect(higher.noise, `${roster[i]}`).toBeLessThan(lower.noise);
      expect(tiers.indexOf(higher.tier), `${roster[i]}`).toBeGreaterThanOrEqual(tiers.indexOf(lower.tier));
    }
    expect(botStrength(3000).noise).toBe(0);
  });

  it('the search tier steps up at the documented ELOs: greedy below 1000, careful from 1000, deep from 1800', () => {
    expect([CAREFUL_FROM_ELO, DEEP_FROM_ELO]).toEqual([1000, 1800]);
    expect(botStrength(999).tier).toBe('greedy');
    expect(botStrength(1000).tier).toBe('careful');
    expect(botStrength(1799).tier).toBe('careful');
    expect(botStrength(1800).tier).toBe('deep');
    expect(botStrength(3000).tier).toBe('deep');
  });

  it('the chosen ELO changes how often the bot finds the obviously best move (a free queen): ~20% at 400, rising steadily to ~90% at 3000', () => {
    const state = stateFromPieces([...KINGS, 'rR@e5', 'yQ@e10']);
    const rate = (elo: number) => {
      let hits = 0;
      const trials = 300;
      for (let i = 0; i < trials; i++) if (label(chooseBotMove(state, elo, seeded(i + 1))!) === 'e5-e10') hits++;
      return hits / trials;
    };
    const rates = [400, 1000, 1800, 3000].map(rate);
    for (let i = 1; i < rates.length; i++) expect(rates[i], `rates ${rates.join(', ')}`).toBeGreaterThan(rates[i - 1] + 0.08);
    expect(rates[0]).toBeLessThan(0.4);
    expect(rates[3]).toBeGreaterThan(0.8);
  });

  it('the noise term is what makes the best move of a weak bot only plausible: with a pawn to win among near-equal moves, ELO 400 often prefers something else, ELO 3000 never does', () => {
    // Force the scored branch (first rng call) and let the remaining calls be the bot's own noise.
    const scoredThenSeeded = (seed: number) => {
      const rng = seeded(seed);
      let first = true;
      return () => {
        if (first) {
          first = false;
          return 0;
        }
        return rng();
      };
    };
    const state = stateFromPieces([...KINGS, 'rR@e5', 'yP@e9']);
    const rate = (elo: number) => {
      let hits = 0;
      const trials = 200;
      for (let i = 0; i < trials; i++) if (label(chooseBotMove(state, elo, scoredThenSeeded(i + 1))!) === 'e5-e9') hits++;
      return hits / trials;
    };
    expect(rate(3000)).toBeGreaterThan(0.97);
    expect(rate(400)).toBeLessThan(0.9); // ~0.77 with the noise; exactly 1 without it
  });

  it('strength shows in actual games: rotate the seats among ELO 400 / 1000 / 1800 / 3000 — 3000 scores far more and wins most', () => {
    const elos = [400, 1000, 1800, 3000];
    const games = 12;
    const totals = new Map<number, number>(elos.map((e) => [e, 0]));
    const wins = new Map<number, number>(elos.map((e) => [e, 0]));
    for (let g = 0; g < games; g++) {
      const assign = [0, 1, 2, 3].map((seat) => elos[(seat + g) % 4]); // rotate who sits where
      const game = selfPlay(assign, 500 + g * 17);
      expect(game.illegal).toEqual([]);
      for (let seat = 0; seat < 4; seat++) totals.set(assign[seat], totals.get(assign[seat])! + game.state.score[seat]);
      for (const seat of game.state.result!.winners) wins.set(assign[seat], wins.get(assign[seat])! + 1 / game.state.result!.winners.length);
    }
    const avg = (e: number) => totals.get(e)! / games;
    expect(avg(400)).toBeLessThan(avg(1000));
    expect(avg(1000)).toBeLessThan(avg(3000));
    expect(avg(400)).toBeLessThan(avg(1800));
    expect(avg(1800)).toBeLessThan(avg(3000));
    expect(avg(3000)).toBeGreaterThan(1.5 * avg(1800));
    expect(wins.get(3000)!).toBeGreaterThanOrEqual(games / 2);
    expect(wins.get(400)!).toBeLessThanOrEqual(1);
  }, 300_000);
});

describe('bot choices', () => {
  it('returns a legal move at every strength, for every seat', () => {
    for (const elo of [400, 1000, 1800, 3000]) {
      for (const seat of [RED, BLUE, YELLOW, GREEN] as Seat[]) {
        const state = { ...initialState(), turn: seat };
        const legal = new Set(legalMoves(state, seat).map(label));
        for (let seed = 1; seed <= 3; seed++) {
          const move = chooseBotMove(state, elo, seeded(seed));
          expect(move, `elo ${elo} seat ${seat}`).not.toBeNull();
          expect(legal.has(label(move!))).toBe(true);
        }
      }
    }
  });

  it('returns null when the seat has no legal move at all', () => {
    const boxed = stateFromPieces(['rK@h1', 'rR@e10', 'rR@m4', 'bK@a8', 'yK@g14', 'gK@n11'], { turn: GREEN });
    expect(chooseBotMove(boxed, 3000)).toBeNull();
  });

  it('every tier takes a free queen when it plays its scored choice', () => {
    const state = stateFromPieces([...KINGS, 'rR@e5', 'yQ@e10']);
    for (const elo of [400, 1400, 2600, 3000]) for (const rng of SCORED_RNGS) expect(label(chooseBotMove(state, elo, rng)!), `elo ${elo}`).toBe('e5-e10');
  });

  it('careful and deep bots do not throw a queen away for a defended pawn', () => {
    const state = stateFromPieces([...KINGS, 'rQ@e5', 'yP@e9', 'yR@e12']);
    for (const elo of [1400, 2600]) for (const rng of SCORED_RNGS) expect(label(chooseBotMove(state, elo, rng)!), `elo ${elo}`).not.toBe('e5-e9');
    // The greedy tier cannot see the recapture: it happily takes the pawn (that is what makes it weak).
    expect(label(chooseBotMove(state, 800, () => 0)!)).toBe('e5-e9');
  });

  it('careful and deep bots find a mate in one against the next seat, and prefer it to winning material', () => {
    // Red's rook on d11 checkmates Blue (boxed in by its own pawns) by reaching a11 — while a juicy Green queen hangs elsewhere.
    const state = stateFromPieces(['rK@h1', 'rR@d11', 'bK@a8', 'bP@b7', 'bP@b8', 'bP@b9', 'yK@h14', 'gK@n7', 'rN@f2', 'gQ@g4']);
    for (const elo of [1400, 2600]) for (const rng of SCORED_RNGS) expect(label(chooseBotMove(state, elo, rng)!), `elo ${elo}`).toBe('d11-a11');
  });

  it('the greedy tier (below 1000) cannot see a mate in one — it takes the queen instead', () => {
    const state = stateFromPieces(['rK@h1', 'rR@d11', 'bK@a8', 'bP@b7', 'bP@b8', 'bP@b9', 'yK@h14', 'gK@n7', 'rN@f2', 'gQ@g4']);
    for (const rng of SCORED_RNGS) expect(label(chooseBotMove(state, 800, rng)!)).toBe('f2-g4');
  });

  it('looks ahead at the next ACTIVE seat: with Blue already out, it still finds the mate on Yellow', () => {
    // Blue (between Red and Yellow in turn order) is dead, so Yellow is the seat that actually answers Red's move.
    const state = stateFromPieces(['rK@h1', 'rR@k1', 'bK@d8', 'yK@h14', 'yP@g13', 'yP@h13', 'yP@i13', 'gK@n7'], { status: ['active', 'dead-king', 'active', 'active'] });
    for (const elo of [1400, 2600]) for (const rng of SCORED_RNGS) expect(label(chooseBotMove(state, elo, rng)!), `elo ${elo}`).toBe('k1-k14');
  });

  it('a deep bot does not grab bait that lets the next seat checkmate it (a free queen that costs a back-rank mate)', () => {
    // Red's rook on d1 is all that guards the back rank against Blue's rook on e11 (Re1#). Capturing Yellow's loose queen on d9 would leave it.
    const state = stateFromPieces(['rK@h1', 'rP@g2', 'rP@h2', 'rP@i2', 'rR@d1', 'bK@a8', 'bR@e11', 'yK@g14', 'yQ@d9', 'gK@n7']);
    expect(legalMoves(state, RED).map(label)).toContain('d1-d9'); // the bait really is on offer
    for (const rng of SCORED_RNGS) {
      const choice = chooseBotMove(state, 3000, rng)!;
      expect(label(choice)).not.toBe('d1-d9');
      const afterRed = playMove(state, choice, seeded(1)).state;
      const matedBy = legalMoves(afterRed, BLUE).filter((reply) => {
        const next = playMove(afterRed, reply, seeded(1)).state;
        return next.status[RED] !== 'active' || (next.turn === RED && legalMoves(next, RED).length === 0);
      });
      expect(matedBy.map(label), label(choice)).toEqual([]);
    }
  });
});

describe('careful versus deep', () => {
  it('a careful bot (1000-1799) looks only one ply, so it grabs bait that a deep bot (1800+) declines', () => {
    const state = stateFromPieces(['rK@h1', 'rP@g2', 'rP@h2', 'rP@i2', 'rR@d1', 'bK@a8', 'bR@e11', 'yK@g14', 'yQ@d9', 'gK@n7']);
    for (const rng of SCORED_RNGS) {
      expect(label(chooseBotMove(state, 1400, rng)!), 'careful').toBe('d1-d9');
      expect(label(chooseBotMove(state, 2000, rng)!), 'deep').not.toBe('d1-d9');
    }
  });
});

describe('self-play', () => {
  it('every strength plays complete, legal games to a finish (elimination or the ply cap)', () => {
    const games: [number[], number][] = [
      [[400, 400, 400, 400], 1],
      [[1400, 1400, 1400, 1400], 2],
      [[3000, 1400, 400, 2200], 3],
    ];
    for (const [elos, seed] of games) {
      const game = selfPlay(elos, seed);
      expect(game.illegal, elos.join('/')).toEqual([]);
      expect(game.state.result, `${elos.join('/')} did not finish`).not.toBeNull();
      expect(game.state.ply).toBeLessThanOrEqual(game.state.rules.maxPlies + 4);
      for (const s of game.state.score) expect(Number.isInteger(s) && s >= 0).toBe(true);
    }
  }, 180_000);

  it('performance: a decision takes well under a second even for the strongest bot in a busy middlegame', () => {
    const game = selfPlay([3000, 3000, 3000, 3000], 11, 120);
    expect(game.illegal).toEqual([]);
    const mean = game.totalMs / game.decisions;
    console.log(`[4pc perf] elo 3000 x4: ${game.decisions} decisions, mean ${mean.toFixed(1)} ms, max ${game.maxMs.toFixed(1)} ms`);
    expect(mean).toBeLessThan(250);
    expect(game.maxMs).toBeLessThan(1500);
  }, 180_000);
});

describe('promotion choice', () => {
  const promotionPick = (pieces: string[], elo: number, rng: () => number): number => {
    const state = stateFromPieces(pieces);
    return promotionOf(chooseBotMove(state, elo, rng)!);
  };

  it('a bot that wants its best move queens when nothing special is going on, at every tier', () => {
    for (const elo of [400, 1200, 3000]) {
      for (const rng of SCORED_RNGS) expect(promotionPick([...KINGS, 'rP@e7'], elo, rng), `elo ${elo}`).toBe(QUEEN);
    }
  });

  it('a strong bot queens even when it picks late among equal-looking moves: nothing else comes close to a queen in its evaluation', () => {
    // A bot only reaches its scored branch when rng() < bestChance, so use an rng just under it: ties would then pick the LAST candidate.
    for (const elo of [2000, 3000]) {
      const nearlyAlways = () => botStrength(elo).bestChance * 0.95;
      expect(promotionPick([...KINGS, 'rP@e7'], elo, nearlyAlways), `elo ${elo}`).toBe(QUEEN);
    }
  });

  it('a careful bot (one-ply search) promotes to something else when the queen would stalemate the next seat (Blue boxed in on a4)', () => {
    // Careful tier only: in this exact position a deep bot also weighs that the b5 rook would hang after a non-queen promotion, and
    // (reasonably, by its own valuation) takes the queen anyway.
    const pieces = ['rK@h1', 'yK@g14', 'gK@n7', 'bK@a4', 'rP@e7', 'rR@b5'];
    for (const elo of [1000, 1400, 1700]) {
      for (const rng of SCORED_RNGS) {
        const pick = promotionPick(pieces, elo, rng);
        expect([ROOK, KNIGHT], `elo ${elo} chose ${pick}`).toContain(pick); // queen and bishop would stalemate Blue (+20 to Blue)
      }
    }
  });

  it('the random branch can under-promote too (a weak bot does not always queen), and every promotion move it offers is legal', () => {
    const state = stateFromPieces([...KINGS, 'rP@e7']);
    const picks = new Set<number>();
    const rng = seeded(5);
    for (let i = 0; i < 200; i++) picks.add(promotionOf(chooseBotMove(state, 400, rng)!));
    expect(picks.has(QUEEN)).toBe(true);
    expect([...picks].some((p) => p === ROOK || p === BISHOP || p === KNIGHT)).toBe(true);
    expect(legalMoves(state, RED).filter((m) => promotionOf(m) !== 0)).toHaveLength(4);
  });
});
