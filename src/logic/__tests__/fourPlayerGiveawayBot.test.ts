import { describe, expect, it } from 'vitest';
import {
  FFA_RULES,
  GIVEAWAY_RULES,
  botStrength,
  chooseBotMove,
  chooseBotMoveFor,
  chooseGiveawayFourBotMove,
  HAND_WIN,
  VALUE_TIEBREAK,
  initialState,
  legalMoves,
  moveLabel,
  playMove,
  stateFromPieces,
  type FourPlayerState,
  type Move,
  type PositionOptions,
  type Seat,
} from '../fourPlayer';
import { mulberry32 } from './fourPlayerGoldenKit';

/**
 * The 4 Player Giveaway bot (src/logic/fourPlayer/giveawayBot.ts, FOUR_PLAYER_GIVEAWAY_SPEC.md section 6). A decision is a SCORED choice with
 * probability `botStrength(elo).bestChance` and a uniformly random legal move otherwise, so a test that wants to see the scored choice drives the rng:
 * `scored()` answers 0 on the first call (always below bestChance) and a seeded stream after (the wobble). With a constant 0 rng the wobble is nil too.
 */
const RED: Seat = 0;
const first = () => 0;

/**
 * Wall time of one deterministic call, robust to a busy machine: the BEST of `n` identical runs. A call that always does the same work can only be
 * slowed down by the machine (a scheduler pause, a garbage collection, another test suite), never sped up, so the minimum is its real cost. Comparing
 * two single timings taken at different moments is what made these tests fail when the suite ran next to another one.
 */
const bestOf = (n: number, run: () => void): number => {
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    run();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
};
const gp = (pieces: string[], options: PositionOptions = {}): FourPlayerState => stateFromPieces(pieces, { rules: GIVEAWAY_RULES, ...options });
const label = (move: Move | null) => (move ? moveLabel(move) : null);
/** An rng whose first draw takes the scored branch, then a seeded stream. */
const scored = (seed: number) => {
  const rest = mulberry32(seed);
  let n = 0;
  return () => (n++ === 0 ? 0 : rest());
};

// Red's rook can capture Green's LAST pawn on m5 (Green wins on the spot) or a Yellow pawn on e12 (Yellow keeps king + a pawn). Blue's rook on m9 sees m5, so
// the rook that takes there is itself capturable next (a "good" thing to a Giveaway player); the Yellow capture is not.
const HAND_THE_WIN = ['rR@e5', 'rK@h1', 'gP@m5', 'yP@e12', 'yK@d14', 'bR@m9', 'bK@a8'];

describe('the Giveaway bot is a legal player', () => {
  it('returns null only when the seat has no legal move, and otherwise always one of the legal moves (all ELOs, 30 seeded full games)', () => {
    let decisions = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const rng = mulberry32(seed);
      const elos = [400 + Math.floor(rng() * 2600), 600, 1200, 2000, 3000];
      let state = initialState({ ...GIVEAWAY_RULES, maxPlies: 600 });
      while (!state.result) {
        const elo = elos[state.turn % elos.length];
        const move = chooseGiveawayFourBotMove(state, elo, rng);
        expect(move, `seed ${seed} ply ${state.ply}`).not.toBeNull();
        const legal = legalMoves(state, state.turn);
        expect(legal.some((m) => m.from === move!.from && m.to === move!.to && m.flags === move!.flags), `seed ${seed} ply ${state.ply}: ${label(move)}`).toBe(true);
        state = playMove(state, move!, rng).state;
        decisions++;
      }
      expect(state.result).not.toBeNull();
    }
    expect(decisions).toBeGreaterThan(1500);
  });

  it('has no move to give a seat that has none', () => {
    const stuck = gp(['bP@f5', 'rP@g5', 'rK@h1', 'yK@d14', 'gK@n7'], { turn: 1 });
    expect(legalMoves(stuck, 1)).toEqual([]);
    expect(chooseGiveawayFourBotMove(stuck, 1500, first)).toBeNull();
  });

  it('respects the mandatory capture: with a capture available, only captures are ever chosen, at every ELO and rng', () => {
    const state = gp(HAND_THE_WIN, { turn: RED });
    expect(legalMoves(state, RED).map(moveLabel).sort()).toEqual(['e5xe12', 'e5xm5']);
    for (const elo of [400, 800, 1200, 2000, 3000]) {
      for (let seed = 1; seed <= 60; seed++) expect(['e5xe12', 'e5xm5']).toContain(label(chooseGiveawayFourBotMove(state, elo, mulberry32(seed))));
    }
  });
});

describe('the heuristic: lose pieces, do not hand anyone the game', () => {
  it('careful (ELO >= 1000) will not take a seat\'s LAST piece - that wins the game for it - when it has another capture', () => {
    const state = gp(HAND_THE_WIN, { turn: RED });
    for (const elo of [1000, 1500, 2500, 3000]) expect(label(chooseGiveawayFourBotMove(state, elo, first)), `elo ${elo}`).toBe('e5xe12');
  });

  it('greedy (ELO < 1000) only sees what it exposes, so it happily takes the last piece (the rook lands where Blue can capture it)', () => {
    const state = gp(HAND_THE_WIN, { turn: RED });
    for (const elo of [400, 700, 999]) expect(label(chooseGiveawayFourBotMove(state, elo, first)), `elo ${elo}`).toBe('e5xm5');
  });

  it('careful will not leave the next seat with no legal move (it would be stuck, and a stuck seat wins)', () => {
    // Blue's lone pawn on f5 is free to move (forward to g5). Red's only piece is a knight with eight moves, none of which can be captured next - except that
    // the jump to g5 blocks the pawn for good. Every move scores 0 on exposure, so only the stuck penalty tells them apart.
    const state = gp(['rN@e4', 'bP@f5', 'yK@d14', 'gK@n7'], { turn: RED });
    const moves = legalMoves(state, RED).map(moveLabel);
    expect(moves).toContain('e4-g5'); // the trap move exists
    expect(moves).toHaveLength(7);
    for (let seed = 1; seed <= 120; seed++) expect(label(chooseGiveawayFourBotMove(state, 3000, scored(seed))), `seed ${seed}`).not.toBe('e4-g5');
    // the greedy tier cannot see it: over many scored decisions it DOES play into it (every move ties, the pick is a coin toss among seven)
    const greedyPicks = new Set(Array.from({ length: 200 }, (_, i) => label(chooseGiveawayFourBotMove(state, 600, scored(i + 1)))));
    expect(greedyPicks.has('e4-g5')).toBe(true);
  });

  it('prefers to be captured: of two quiet moves, it plays the one that offers a piece to the next seat', () => {
    // Red's knight can go to f7 (attacked by Blue's pawn on e6 -> capturable next turn) or stay safely around; its other moves expose nothing.
    const state = gp(['rN@e5', 'rK@h1', 'bP@e6', 'bK@a8', 'yK@d14', 'gK@n7'], { turn: RED });
    const moves = legalMoves(state, RED).map(moveLabel);
    expect(moves).toContain('e5-f7');
    // after Nf7 Blue's pawn on e6 attacks f7 (Blue captures towards +file: e6 -> f7 / f5)
    for (const elo of [600, 1500, 3000]) expect(label(chooseGiveawayFourBotMove(state, elo, first)), `elo ${elo}`).toBe('e5-f7');
  });

  it('careful prefers a victim that is far from running out of pieces (helping a seat that is nearly out is worse)', () => {
    // Capture A takes Green\'s pawn (Green keeps just its king); capture B takes one of Yellow\'s six pieces. Nothing is exposed either way.
    const state = gp(['rR@e5', 'rK@h1', 'gP@m5', 'gK@n7', 'yP@e12', 'yP@d11', 'yP@f11', 'yP@h11', 'yP@i11', 'yK@d14', 'bK@a8'], { turn: RED });
    expect(legalMoves(state, RED).map(moveLabel).sort()).toEqual(['e5xe12', 'e5xm5']);
    for (const elo of [1000, 1800, 3000]) expect(label(chooseGiveawayFourBotMove(state, elo, first)), `elo ${elo}`).toBe('e5xe12');
  });
});

describe('how exposure is counted', () => {
  it('a piece attacked by TWO of the next seat pieces is one exposed piece, not two (so two equally exposing moves tie)', () => {
    // Red's knight on i5 can go to g6 (attacked by both Blue pawns) or g4 (attacked by one); every other jump is safe. Both exposed squares hold ONE Red
    // piece, so they must tie - a count of attackers instead of pieces would always prefer g6.
    const state = gp(['rN@i5', 'bP@f5', 'bP@f7', 'yK@d14', 'gK@n7'], { turn: RED });
    expect(legalMoves(state, RED)).toHaveLength(8);
    const picks = new Set<string | null>();
    for (let seed = 1; seed <= 60; seed++) picks.add(label(chooseGiveawayFourBotMove(state, 3000, scored(seed))));
    expect([...picks].sort()).toEqual(['i5-g4', 'i5-g6']);
  });

  it('it is the next ACTIVE seat that answers: with Blue eliminated, the Yellow pawn is the one to offer a piece to', () => {
    // Blue is out (its king is a wall). Yellow's pawn on e8 captures d7 and f7: the knight's jumps there are the exposing ones. If the bot looked at Blue
    // (frozen: no moves at all) it would think every move leaves the next seat stuck and score them all alike.
    const state = gp(['rN@e5', 'rK@h1', 'bK@a8', 'yP@e8', 'yK@d14', 'gK@n7'], { turn: RED, status: ['active', 'frozen', 'active', 'active'] });
    const picks = new Set<string | null>();
    for (let seed = 1; seed <= 60; seed++) picks.add(label(chooseGiveawayFourBotMove(state, 3000, scored(seed))));
    expect([...picks].sort()).toEqual(['e5-d7', 'e5-f7']);
  });
});

describe('exposure only counts MY pieces, and value is a tiebreak', () => {
  it('captures the next seat could make of the other seats pieces are not my exposure: only the move that offers MY pawn is preferred', () => {
    // Blue rook eyes the Green pawn on rank 5. The Red pawn can step onto rank 5 and shield it - the pawn is then the only thing Blue can take (one exposed Red
    // piece); a king step leaves Blue to take the GREEN pawn (none of mine). A bot that also counted the Green pawn as exposure would call all six moves equal.
    const state = gp(['rP@h4', 'rK@h1', 'bR@a5', 'gP@m5', 'gK@n7', 'yK@d14'], { turn: RED });
    expect(legalMoves(state, RED)).toHaveLength(6);
    const picks = new Set<string | null>();
    for (let seed = 1; seed <= 80; seed++) picks.add(label(chooseGiveawayFourBotMove(state, 3000, scored(seed))));
    expect([...picks]).toEqual(['h4-h5']);
  });

  it('between two equally exposing moves the more valuable piece is slightly preferred (rook over pawn), but only as a tiebreak', () => {
    // Rook e5 can step onto h5 / j5 (each attacked by a Blue pawn); the pawn on j6 can step onto j7 (attacked by another). One exposed piece each - the rook wins the tie.
    const state = gp(['rR@e5', 'rP@j6', 'bP@g6', 'bP@i6', 'yK@d14', 'gK@n7'], { turn: RED });
    const moves = legalMoves(state, RED).map(moveLabel);
    expect(moves).toEqual(expect.arrayContaining(['e5-h5', 'e5-j5', 'j6-j7']));
    const picks = new Set<string | null>();
    for (let seed = 1; seed <= 80; seed++) picks.add(label(chooseGiveawayFourBotMove(state, 3000, scored(seed))));
    expect([...picks].sort()).toEqual(['e5-h5', 'e5-j5']);
  });

  it('the weights keep their documented order: the value tiebreak can never outweigh ONE extra exposed piece, and handing the win dwarfs any exposure', () => {
    expect(VALUE_TIEBREAK).toBeGreaterThan(0);
    expect(VALUE_TIEBREAK * 9).toBeLessThan(0.5); // the biggest value gap (queen vs pawn, 9 - 0) is worth less than half a piece
    expect(HAND_WIN).toBeGreaterThan(3 * (1 + VALUE_TIEBREAK * 9)); // more than the exposure of three queens
  });
});

describe('the ELO dial is the same one as the Chess bot\'s', () => {
  it('strength rises with ELO in how often the right (not-hand-the-win) capture is chosen: ~random at 400, mostly at 1500, nearly always at 3000', () => {
    const state = gp(HAND_THE_WIN, { turn: RED });
    const rate = (elo: number) => {
      let good = 0;
      const n = 600;
      for (let seed = 1; seed <= n; seed++) if (label(chooseGiveawayFourBotMove(state, elo, mulberry32(seed * 7 + elo))) === 'e5xe12') good++;
      return good / n;
    };
    const low = rate(400);
    const mid = rate(1500);
    const high = rate(3000);
    // greedy 25% scored -> picks the bad one; 75% random -> half: ~0.37.  careful 1500: 50% scored (good) + 50% random (half) = ~0.75.  3000: 90% + 5% = ~0.95
    expect(low).toBeGreaterThan(0.25);
    expect(low).toBeLessThan(0.5);
    expect(mid).toBeGreaterThan(0.65);
    expect(mid).toBeLessThan(0.85);
    expect(high).toBeGreaterThan(0.9);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
    expect(botStrength(400).tier).toBe('greedy');
    expect(botStrength(1000).tier).toBe('careful');
  });

  it('the careful bot victim preference is MID-DECISION (the noise matters): 60-80% take the richer victim, not never and not always', () => {
    const state = gp(['rR@e5', 'rK@h1', 'gP@m5', 'gK@n7', 'yP@e12', 'yP@d11', 'yP@f11', 'yP@h11', 'yP@i11', 'yK@d14', 'bK@a8'], { turn: RED });
    let rich = 0;
    let total = 0;
    for (const elo of [1000, 1100, 1200, 1400]) {
      for (let seed = 1; seed <= 500; seed++, total++) if (label(chooseGiveawayFourBotMove(state, elo, mulberry32(seed * 13 + elo))) === 'e5xe12') rich++;
    }
    expect(rich / total).toBeGreaterThan(0.55);
    expect(rich / total).toBeLessThan(0.9);
  });

  it('a CLOSE call is decided partly by the noise: the slightly better capture is chosen only a little more than half of the time', () => {
    // Green keeps 2 pieces after capture A (penalty 4/3), Yellow 3 after capture B (penalty 1): a gap of 0.33 against a wobble of ~1.7-1.9 pawns. With the wobble
    // the scored choice picks B only ~60% of the time (and half the decisions are random anyway); without it, 100% of the scored ones would.
    const state = gp(['rR@e5', 'rK@h1', 'gP@m5', 'gK@n7', 'gN@l9', 'yP@e12', 'yP@d11', 'yP@f11', 'yK@d14', 'bK@a8'], { turn: RED });
    let better = 0;
    let total = 0;
    for (const elo of [1000, 1100, 1200, 1400]) {
      for (let seed = 1; seed <= 1500; seed++, total++) if (label(chooseGiveawayFourBotMove(state, elo, mulberry32(seed * 13 + elo))) === 'e5xe12') better++;
    }
    expect(better / total).toBeGreaterThan(0.5);
    expect(better / total).toBeLessThan(0.62); // 0.564 measured; ~0.71 if the noise were removed
  });

  it('there is no deep tier: ELO 3000 costs about as little per decision as 1000 (it never searches past the next seat)', () => {
    const states: FourPlayerState[] = [];
    const rng = mulberry32(5);
    let state = initialState(GIVEAWAY_RULES);
    for (let i = 0; i < 120 && !state.result; i++) {
      if (i % 4 === 0) states.push(state);
      const moves = legalMoves(state, state.turn);
      state = playMove(state, moves[Math.floor(rng() * moves.length)], first).state;
    }
    // Per position, best of 5 identical runs, the two strengths measured one after the other (so a load spike hits both or neither), then summed.
    let careful = 0;
    let top = 0;
    for (const s of states) chooseGiveawayFourBotMove(s, 1000, scored(1)); // warm-up
    for (const s of states) {
      careful += bestOf(5, () => chooseGiveawayFourBotMove(s, 1000, scored(1)));
      top += bestOf(5, () => chooseGiveawayFourBotMove(s, 3000, scored(1)));
    }
    expect(top).toBeLessThan(careful * 4 + 50); // same tier: not an order of magnitude apart (a deep search would be)
  });
});

describe('chooseBotMoveFor picks the bot by the position\'s rules', () => {
  it('Giveaway positions get the Giveaway bot, Chess positions the Chess bot - with identical results for the same rng', () => {
    const giveaway = gp(HAND_THE_WIN, { turn: RED });
    const chess = stateFromPieces(HAND_THE_WIN, { turn: RED, rules: FFA_RULES });
    for (let seed = 1; seed <= 40; seed++) {
      expect(label(chooseBotMoveFor(giveaway, 1500, mulberry32(seed)))).toBe(label(chooseGiveawayFourBotMove(giveaway, 1500, mulberry32(seed))));
      expect(label(chooseBotMoveFor(chess, 1500, mulberry32(seed)))).toBe(label(chooseBotMove(chess, 1500, mulberry32(seed))));
    }
    // the Giveaway bot's own choice on a position where the two bots disagree is what the dispatcher gives for a Giveaway state
    const disagree = gp(['rN@e5', 'rK@h1', 'bP@e6', 'bK@a8', 'yK@d14', 'gK@n7'], { turn: RED });
    expect(label(chooseBotMoveFor(disagree, 1500, first))).toBe('e5-f7');
    // the two bots really are different programs on the same board
    // (the Chess bot avoids hanging a piece - the Giveaway bot offers it)
    const offer = gp(['rN@e5', 'rK@h1', 'bP@e6', 'bK@a8', 'yK@d14', 'gK@n7'], { turn: RED });
    expect(label(chooseGiveawayFourBotMove(offer, 1500, first))).toBe('e5-f7');
    expect(label(chooseBotMove(offer, 1500, first))).not.toBe('e5-f7');
  });

  it('a Chess game played by chooseBotMoveFor is move for move the same as one played by chooseBotMove (the Chess path is untouched)', () => {
    let a = initialState(FFA_RULES);
    let b = initialState(FFA_RULES);
    for (let i = 0; i < 60 && !a.result; i++) {
      const rngA = mulberry32(1000 + i);
      const rngB = mulberry32(1000 + i);
      const ma = chooseBotMove(a, 1200, rngA)!;
      const mb = chooseBotMoveFor(b, 1200, rngB)!;
      expect(moveLabel(mb)).toBe(moveLabel(ma));
      a = playMove(a, ma, mulberry32(i)).state;
      b = playMove(b, mb, mulberry32(i)).state;
    }
  });
});

describe('whole bot games: the local game loop, seeded', () => {
  it('four bots play complete Giveaway games to a result from the start position (every ELO mix), and the endings are the rule endings', () => {
    const reasons = new Map<string, number>();
    let plies = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const rng = mulberry32(seed * 101);
      const elos = [0, 1, 2, 3].map(() => 400 + Math.floor(rng() * 2600));
      let state = initialState(GIVEAWAY_RULES);
      while (!state.result) {
        const move = chooseGiveawayFourBotMove(state, elos[state.turn], rng);
        expect(move).not.toBeNull();
        state = playMove(state, move!, rng).state;
      }
      plies += state.ply;
      reasons.set(state.result.reason, (reasons.get(state.result.reason) ?? 0) + 1);
      expect(state.score).toEqual([0, 0, 0, 0]);
    }
    expect([...reasons.keys()].every((r) => ['outOfPieces', 'stuck', 'cap', 'lastStanding'].includes(r))).toBe(true);
    expect(plies).toBeGreaterThan(1000);
    // eslint-disable-next-line no-console
    console.info('Giveaway bot-vs-bot (40 games, mixed ELOs):', Object.fromEntries(reasons), 'mean plies', Math.round(plies / 40));
  }, 120_000);

  it('decision cost: mean / p99 / max per decision over seeded games stays small (reported; the structural bound is generous)', () => {
    const samples: number[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const rng = mulberry32(seed);
      let state = initialState(GIVEAWAY_RULES);
      while (!state.result) {
        const elo = [800, 1200, 1700, 3000][state.turn];
        // The decision is timed 3 times with an identical fresh rng (same work each time) and the best time is the sample: one scheduler pause or GC
        // in a busy run would otherwise be a 30 ms "p99" for a decision that costs a fraction of a millisecond. The game advances on the last result.
        const decisionSeed = seed * 100_003 + state.ply;
        let move!: ReturnType<typeof chooseGiveawayFourBotMove>;
        samples.push(bestOf(3, () => (move = chooseGiveawayFourBotMove(state, elo, mulberry32(decisionSeed)))));
        state = playMove(state, move!, rng).state;
      }
    }
    samples.sort((a, b) => a - b);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const p99 = samples[Math.floor(samples.length * 0.99)];
    // eslint-disable-next-line no-console
    console.info(`Giveaway bot decision: n=${samples.length} mean ${(mean * 1000).toFixed(0)} us, p99 ${(p99 * 1000).toFixed(0)} us, max ${(samples[samples.length - 1] * 1000).toFixed(0)} us`);
    expect(p99).toBeLessThan(25); // ms - the Chess careful tier is ~20 ms worst case; this variant has no search
  }, 120_000);
});
