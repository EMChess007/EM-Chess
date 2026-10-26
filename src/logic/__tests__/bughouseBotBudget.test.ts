import { describe, expect, it } from 'vitest';
import { BUGHOUSE_TIME_CONTROLS, legalActions, type BughouseAction } from '../bughouse';
import { runArena } from './bughouseBotKit';

/**
 * The SLOW half of the Bughouse bot's tests (the quick half is bughouseBot.test.ts): thousands of seeded decisions against the engine's own legal lists, whole self-play matches, and the
 * decision budget at every ELO tier. Kept in its own file so the mutation run (scripts/mutation) can use the quick half first and this one for the survivors.
 */
const TIERS = [400, 800, 1200, 1700, 2000, 2400, 3000];
const keyOf = (a: BughouseAction): string => (a.kind === 'move' ? `m:${a.board}:${a.from}${a.to}${a.promotion ?? ''}` : a.kind === 'drop' ? `d:${a.board}:${a.piece}@${a.square}` : a.kind);

describe('legal only, at scale', () => {
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
            const legal = legalActions(match, seat);
            if (action === null) {
              nothing++;
              expect(legal.moves.length + legal.drops.length).toBe(0);
              return;
            }
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
    expect(ends.checkmate ?? 0).toBeGreaterThan(0);
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
