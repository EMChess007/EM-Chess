import { describe, expect, it } from 'vitest';
import {
  BUGHOUSE_BOT_DROP_PROBES,
  BUGHOUSE_BOT_LOOKAHEAD,
  BUGHOUSE_BOT_MAX_DROP_CANDIDATES,
  BUGHOUSE_BOT_RESCUE_BATCHES,
  BUGHOUSE_TIME_CONTROLS,
  applyAction,
  chooseBughouseAction,
  firstLegalAction,
  legalActions,
  settle,
  type BughouseAction,
  type BughouseMatch,
} from '../bughouse';
import { runArena } from './bughouseBotKit';
import { mulberry32 } from './bughouseTestKit';
import { move, play, scene, START } from './bughouseScenes';

/**
 * The Bughouse bot (BUGHOUSE_SPEC.md HP4, W2): legal only, drops included; deterministic for a seed; finds a mate in one by a move and by a drop (also a drop fed by the partner's capture);
 * does not walk into a mate by a dropped piece; never under-promotes by choice; its cost is bounded by counts and measured at every ELO tier (p99 under the 25 ms budget).
 * The caps are literals here, not read from the module under test.
 */
const BEST = () => 0; // every random draw is 0: the "use the scored choice" branch, and ties go to the first
const TIERS = [400, 800, 1200, 1700, 2000, 2400, 3000];
const keyOf = (a: BughouseAction): string => (a.kind === 'move' ? `m:${a.board}:${a.from}${a.to}${a.promotion ?? ''}` : a.kind === 'drop' ? `d:${a.board}:${a.piece}@${a.square}` : a.kind);

describe('the caps are the ones the budget was measured with', () => {
  it('lookahead 5, 12 drop candidates, 3 drop probes per candidate, 2 rescue batches (at most 15 candidates played out)', () => {
    expect(BUGHOUSE_BOT_LOOKAHEAD).toBe(5);
    expect(BUGHOUSE_BOT_MAX_DROP_CANDIDATES).toBe(12);
    expect(BUGHOUSE_BOT_DROP_PROBES).toBe(3);
    expect(BUGHOUSE_BOT_RESCUE_BATCHES).toBe(2);
  });
});

describe('legal only', () => {
  it('2,400 seeded decisions across every tier, drops included, are all in the engine\'s own legal lists (and the match never refuses one)', { timeout: 240_000 }, () => {
    let decisions = 0;
    let drops = 0;
    let refused = 0;
    let nothing = 0;
    for (const [i, elo] of TIERS.entries()) {
      for (let seed = 1; seed <= 7; seed++) {
        const result = runArena({
          seed: 100 * (i + 1) + seed,
          elos: [elo, elo, elo, elo],
          maxCommits: 70,
          onDecision: (match, seat, action) => {
            decisions++;
            if (action === null) {
              nothing++;
              expect(legalActions(match, seat).moves.length + legalActions(match, seat).drops.length).toBe(0);
              return;
            }
            const legal = legalActions(match, seat);
            const keys = new Set([...legal.moves.map((m) => `m:${action.kind === 'move' ? action.board : '?'}:${m.from}${m.to}${m.promotion ?? ''}`), ...legal.drops.map((d) => `d:${action.kind === 'drop' ? action.board : '?'}:${d.piece}@${d.square}`)]);
            expect(keys.has(keyOf(action)), `illegal bot action ${keyOf(action)} for seat ${seat} at seq ${match.seq}`).toBe(true);
            if (action.kind === 'drop') drops++;
          },
        });
        refused += result.refused.length;
        expect(result.conservation).toEqual([]);
      }
    }
    expect(refused).toBe(0);
    expect(decisions).toBeGreaterThanOrEqual(2000);
    expect(drops).toBeGreaterThanOrEqual(100);
    expect(nothing).toBeLessThan(decisions / 10); // the bot nearly always has a turn when the match asks it
  });

  it('returns null when it is not the seat\'s turn, when the match is over, and when the seat is stuck', () => {
    const m = scene({ a: START, b: START });
    expect(chooseBughouseAction(m, 1, 3000, BEST)).toBeNull(); // black on board A, white to move
    expect(chooseBughouseAction(m, 3, 3000, BEST)).toBeNull();
    const over = play(m, 0, { kind: 'resign' }, 1500);
    expect(chooseBughouseAction(over, 2, 3000, BEST)).toBeNull();
    const stuck = scene({ a: 'R6k/6pp/8/8/8/8/8/K7 b - - 0 1', b: START });
    expect(stuck.verdicts.A.status).toBe('stuck');
    expect(chooseBughouseAction(stuck, 1, 3000, BEST)).toBeNull();
    expect(firstLegalAction(stuck, 1)).toBeNull();
    expect(firstLegalAction(over, 0)).toBeNull();
  });

  it('firstLegalAction is a legal move in chess.js\'s order, or the first drop when there is no move', () => {
    const m = scene({ a: START, b: START });
    const first = firstLegalAction(m, 0) as BughouseAction;
    expect(first.kind).toBe('move');
    expect(applyAction(m, 0, first, m.nowMs).ok).toBe(true);
    const inCheck = scene({ a: 'R6k/6pp/8/8/8/8/8/K7 b - - 0 1', b: START, pockets: { 1: { r: 1 } } });
    const drop = firstLegalAction(inCheck, 1) as BughouseAction;
    expect(drop.kind).toBe('drop');
    expect(applyAction(inCheck, 1, drop, inCheck.nowMs).ok).toBe(true);
  });
});

describe('determinism', () => {
  it('the same match, seat, strength and seed give the same action, run after run', () => {
    const result = runArena({ seed: 77, elos: [1200, 2400, 3000, 800], maxCommits: 60, onDecision: () => undefined });
    expect(result.commits).toBeGreaterThan(20);
    const m = scene({ a: START, b: START });
    for (const elo of TIERS) {
      for (let seed = 1; seed <= 5; seed++) {
        const first = chooseBughouseAction(m, 0, elo, mulberry32(seed));
        expect(chooseBughouseAction(m, 0, elo, mulberry32(seed))).toEqual(first);
        expect(chooseBughouseAction(m, 2, elo, mulberry32(seed))).toEqual(chooseBughouseAction(m, 2, elo, mulberry32(seed)));
      }
    }
  });

  it('a whole bot match is a function of its seed: two runs give the same final match text', () => {
    const a = runArena({ seed: 4242, elos: [1700, 1200, 2400, 3000], maxCommits: 120 });
    const b = runArena({ seed: 4242, elos: [1700, 1200, 2400, 3000], maxCommits: 120 });
    expect(a.match).toEqual(b.match);
    expect(a.commits).toBe(b.commits);
    const c = runArena({ seed: 4243, elos: [1700, 1200, 2400, 3000], maxCommits: 120 });
    expect(c.match).not.toEqual(a.match);
  });
});

describe('what the bot finds', () => {
  it('a mate in one by a MOVE', () => {
    const m = scene({ a: START, b: '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1' });
    const action = chooseBughouseAction(m, 2, 3000, BEST) as BughouseAction;
    const outcome = applyAction(m, 2, action, m.nowMs);
    expect(outcome.ok && outcome.match.result !== null && 'winnerTeam' in outcome.match.result && outcome.match.result.reason === 'checkmate').toBe(true);
  });

  it('a mate in one by a DROP: the queen the human partner just captured on the other board', () => {
    // seat 3 (the bot\'s partner, board B Black) takes White\'s queen with the rook: the queen lands in seat 0\'s pocket - and seat 0 drops it for mate on board A
    const m0 = scene({ a: '7k/8/6K1/8/8/8/8/8 w - - 0 1', b: 'r3k3/8/8/8/8/8/8/Q3K3 b - - 0 1' });
    const m1 = play(m0, 3, move('B', 'a8', 'a1'), 1500);
    expect(m1.pockets[0].q).toBe(1);
    const action = chooseBughouseAction(m1, 0, 3000, BEST) as BughouseAction;
    expect(action.kind).toBe('drop');
    const outcome = applyAction(m1, 0, action, m1.nowMs);
    expect(outcome.ok && outcome.match.result !== null && 'winnerTeam' in outcome.match.result && outcome.match.result.reason === 'checkmate').toBe(true);
  });

  it('back-rank / smothered safety: it does not take a free pawn that allows a MATING DROP, and it does when the opponent has nothing to drop', () => {
    // White Kh1 Rg1 pawns g2 h2 (a smothered king), Be4 can take the pawn on h7. If Black holds a knight in its pocket, Bxh7 (or any move that leaves the setup) allows N@f2#.
    const fen = 'k7/7p/8/8/4B3/8/6PP/6RK w - - 0 1';
    const trapped = scene({ a: fen, b: START, pockets: { 1: { n: 1 } } });
    const trap = play(play(trapped, 0, move('A', 'e4', 'h7'), 1500), 1, { kind: 'drop', board: 'A', piece: 'n', square: 'f2' }, 1600);
    expect(trap.result !== null && 'winnerTeam' in trap.result && trap.result.reason === 'checkmate').toBe(true); // the trap is real
    for (const elo of [1200, 3000]) {
      const action = chooseBughouseAction(trapped, 0, elo, BEST) as BughouseAction;
      expect(keyOf(action)).not.toBe('m:A:e4h7');
      const outcome = applyAction(trapped, 0, action, trapped.nowMs);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        // whatever it chose, Black has no mating drop afterwards
        const replies = ['p', 'n', 'b', 'r', 'q'].flatMap((piece) => (outcome.match.pockets[1][piece as 'n'] > 0 ? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].flatMap((f) => ['1', '2', '3', '4', '5', '6', '7', '8'].map((r) => `${f}${r}`)).map((square) => ({ piece: piece as 'n', square })) : []));
        const mated = replies.some((d) => {
          const reply = applyAction(outcome.match, 1, { kind: 'drop', board: 'A', ...d }, outcome.match.nowMs);
          return reply.ok && reply.match.result !== null && 'winnerTeam' in reply.match.result;
        });
        expect(mated).toBe(false);
      }
    }
    const free = scene({ a: fen, b: START });
    expect(keyOf(chooseBughouseAction(free, 0, 3000, BEST) as BughouseAction)).toBe('m:A:e4h7');
  });

  it('when every move that looks good loses to a mate in one, the rescue batches still find a move that does not', () => {
    // White has four free captures (a2xb3, c2xb3, c2xd3, e2xd3) and four central pawn pushes - eight moves that all look better than a quiet rook or g/h-pawn move, and every one of them leaves
    // the smothered king (Kh1, Rg1, pawns g2 h2) to N@f2#. The five best-looking moves are all fatal, so only the rescue batches reach a move that is not.
    const fen = 'k7/8/8/8/8/1p1p4/P1P1P1PP/6RK w - - 0 1';
    const m = scene({ a: fen, b: START, pockets: { 1: { n: 1 } } });
    const trap = play(play(m, 0, move('A', 'e2', 'd3'), 1500), 1, { kind: 'drop', board: 'A', piece: 'n', square: 'f2' }, 1600);
    expect(trap.result !== null && 'winnerTeam' in trap.result && trap.result.reason === 'checkmate').toBe(true); // the trap is real
    const action = chooseBughouseAction(m, 0, 3000, BEST) as BughouseAction;
    const outcome = applyAction(m, 0, action, m.nowMs);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const squares = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].flatMap((f) => ['1', '2', '3', '4', '5', '6', '7', '8'].map((r) => `${f}${r}`));
    const mated = squares.some((square) => {
      const reply = applyAction(outcome.match, 1, { kind: 'drop', board: 'A', piece: 'n', square }, outcome.match.nowMs);
      return reply.ok && reply.match.result !== null && 'winnerTeam' in reply.match.result;
    });
    expect(mated, `the bot chose ${keyOf(action)}, which allows a mating drop`).toBe(false);
  });

  it('never under-promotes by choice: the scored branch promotes to a queen or a knight, the random branch to a queen', () => {
    const m = scene({ a: '8/P6k/8/8/8/8/8/K7 w - - 0 1', b: START });
    const best = chooseBughouseAction(m, 0, 3000, BEST) as Extract<BughouseAction, { kind: 'move' }>;
    expect(best.kind).toBe('move');
    expect(['q', 'n', undefined]).toContain(best.promotion);
    for (let seed = 1; seed <= 40; seed++) {
      const random = chooseBughouseAction(m, 0, 400, mulberry32(seed)) as Extract<BughouseAction, { kind: 'move' }>;
      if (random.from === 'a7') expect(random.promotion).toBe('q');
    }
  });

  it('a seat with pieces in the pocket uses them: over a bot match the bots drop (so a human partner\'s captures are not hoarded)', { timeout: 120_000 }, () => {
    let drops = 0;
    let decisions = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const r = runArena({ seed: 900 + seed, elos: [2400, 2400, 2400, 2400], maxCommits: 150 });
      drops += r.decisions.filter((d) => d.kind === 'drop').length;
      decisions += r.decisions.length;
    }
    expect(drops).toBeGreaterThan(20);
    expect(decisions).toBeGreaterThan(250);
  });
});

describe('self-play: whole matches end, and what is conserved stays conserved', () => {
  it('40 matches with mixed strengths all terminate on their own, with the conservation invariant, no refusal, and every kind of end reachable', { timeout: 300_000 }, () => {
    const ends: Record<string, number> = {};
    let refused = 0;
    let commits = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const tier = [TIERS[seed % 7], TIERS[(seed + 2) % 7], TIERS[(seed + 4) % 7], TIERS[(seed + 6) % 7]] as [number, number, number, number];
      const r = runArena({ seed: 5000 + seed, elos: tier, timeControl: BUGHOUSE_TIME_CONTROLS[seed % 6], maxCommits: 3000 });
      expect(r.match.result, `match ${seed} did not end`).not.toBeNull();
      expect(r.conservation).toEqual([]);
      refused += r.refused.length;
      commits += r.commits;
      const result = r.match.result;
      if (result && 'winnerTeam' in result) ends[result.reason] = (ends[result.reason] ?? 0) + 1;
    }
    expect(refused).toBe(0);
    expect(commits).toBeGreaterThan(1500);
    expect(ends.flag ?? 0).toBeGreaterThan(0);
  });
});

describe('the decision budget', () => {
  it('p50 / p99 / max per decision at every tier (best of 3 per decision); p99 stays under the 25 ms budget', { timeout: 600_000 }, () => {
    runArena({ seed: 999, elos: [3000, 3000, 3000, 3000], maxCommits: 200 }); // warm-up: the first decisions pay for the JIT
    const rows: string[] = [];
    for (const elo of TIERS) {
      const samples: number[] = [];
      for (let seed = 1; seed <= 12; seed++) samples.push(...runArena({ seed: 7000 + seed, elos: [elo, elo, elo, elo], maxCommits: 400, repeat: 3 }).decisions.map((d) => d.ms));
      samples.sort((a, b) => a - b);
      const p = (q: number) => samples[Math.floor(samples.length * q)];
      rows.push(`elo ${elo}: n=${samples.length} p50 ${p(0.5).toFixed(2)} ms, p99 ${p(0.99).toFixed(2)} ms, max ${samples[samples.length - 1].toFixed(2)} ms`);
      expect(p(0.99), `p99 at ELO ${elo}`).toBeLessThan(25);
    }
    console.info(`Bughouse bot decision cost (best of 3 per decision):\n${rows.join('\n')}`);
  });
});

describe('the funnel is the judge: nothing the bot says is played unchecked', () => {
  it('an action the engine refuses is refused (the bot module has no way around settle)', () => {
    const m = scene({ a: START, b: START });
    const outcome = settle(m, { seat: 0, action: { kind: 'move', board: 'A', from: 'e2', to: 'e5' } }, 1500);
    expect(outcome.kind).toBe('rejected');
  });
});

describe('typing', () => {
  it('chooseBughouseAction takes the match, the seat, the strength and the random stream and nothing else (no board default)', () => {
    expect(chooseBughouseAction.length).toBe(4);
    const m: BughouseMatch = scene({ a: START, b: START });
    expect(typeof chooseBughouseAction(m, 0, 1200, BEST)).toBe('object');
  });
});
