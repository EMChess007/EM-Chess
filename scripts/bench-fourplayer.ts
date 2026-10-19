/**
 * Hot-path benchmark of the 4-seat engine (CHATURAJI_SPEC.md sections 8.2 and 11): the before / after gate of Chaturaji W0.
 *
 *   backend/node_modules/.bin/tsx scripts/bench-fourplayer.ts [--out file.json] [--compare baseline.json]
 *
 * W0 turns module-level board constants into a geometry object read from the rules; the one risk the golden transcripts cannot see is SPEED (an extra
 * property read inside a move-generation loop). Each workload below replays DETERMINISTIC inputs (seeded games, built before the clock starts) through
 * one hot function, repeated `RUNS` times after a warm-up; the number reported is the BEST (minimum) run - a deterministic call can only be slowed
 * down by the machine, never sped up, so the minimum is its real cost and is what a before / after comparison should use - together with the median
 * (how noisy the machine was). `--compare` prints the ratio of the minima against a recorded baseline and exits non-zero outside +-LIMIT.
 *
 * The recorded baseline is machine-specific (see `env` in the JSON); re-record it on the same machine before comparing across machines.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import {
  FFA_RULES,
  GIVEAWAY_RULES,
  chooseBotMove,
  chooseGiveawayFourBotMove,
  deserialize,
  initialState,
  isInCheck,
  legalMoves,
  playMove,
  serialize,
  type FourPlayerRules,
  type FourPlayerState,
  type Move,
  type Seat,
} from '../src/logic/fourPlayer';
import { mulberry32 } from '../src/logic/__tests__/fourPlayerGoldenKit';

const RUNS = 12;
const WARMUP = 3;
const LIMIT = 0.05;

/** Plays a seeded game of uniformly random legal moves; returns every position and the moves played. */
function game(rules: FourPlayerRules, seed: number, plies: number): { states: FourPlayerState[]; moves: Move[] } {
  const rng = mulberry32(seed);
  const states: FourPlayerState[] = [];
  const moves: Move[] = [];
  let state = initialState(rules);
  for (let i = 0; i < plies && !state.result; i++) {
    states.push(state);
    const legal = legalMoves(state, state.turn);
    const move = legal[Math.floor(rng() * legal.length)];
    moves.push(move);
    state = playMove(state, move, mulberry32(seed * 7 + i)).state;
  }
  return { states, moves };
}

const ffa = [11, 12, 13].map((seed) => game(FFA_RULES, seed, 220));
const giveaway = [21, 22, 23].map((seed) => game(GIVEAWAY_RULES, seed, 220));
const ffaStates = ffa.flatMap((g) => g.states);
const giveawayStates = giveaway.flatMap((g) => g.states);
const botStates = ffaStates.filter((_, i) => i % 6 === 0);
const gwBotStates = giveawayStates.filter((_, i) => i % 3 === 0);
const snapshots = ffaStates.map(serialize);

let sink = 0; // keeps the optimiser honest

/** Each workload is repeated `x` times inside one timed run so a run lasts ~100 ms: below that the timer, the JIT and the OS dominate the number. */
const REPS: Record<string, number> = {
  'ffa.legalMoves (all seats, every position)': 2,
  'ffa.isInCheck (all seats, every position)': 60,
  'ffa.playMove (replay 3 seeded games)': 5,
  'ffa.bot (careful 1400 + greedy 600)': 6,
  'giveaway.legalMoves (all seats, every position)': 25,
  'giveaway.playMove (replay 3 seeded games)': 40,
  'giveaway.bot (careful 1500)': 120,
  'serialize + deserialize (every position)': 3,
};

const WORKLOADS: Record<string, () => void> = {
  'ffa.legalMoves (all seats, every position)': () => {
    for (const s of ffaStates) for (const seat of [0, 1, 2, 3] as Seat[]) sink += legalMoves(s, seat).length;
  },
  'ffa.isInCheck (all seats, every position)': () => {
    for (const s of ffaStates) for (const seat of [0, 1, 2, 3] as Seat[]) sink += isInCheck(s, seat) ? 1 : 0;
  },
  'ffa.playMove (replay 3 seeded games)': () => {
    for (const g of ffa) {
      let state = initialState(FFA_RULES);
      for (let i = 0; i < g.moves.length; i++) state = playMove(state, g.moves[i], mulberry32(i)).state;
      sink += state.ply;
    }
  },
  'ffa.bot (careful 1400 + greedy 600)': () => {
    for (const s of botStates) sink += chooseBotMove(s, 1400, mulberry32(5))?.to ?? 0;
    for (const s of botStates) sink += chooseBotMove(s, 600, mulberry32(6))?.to ?? 0;
  },
  'giveaway.legalMoves (all seats, every position)': () => {
    for (const s of giveawayStates) for (const seat of [0, 1, 2, 3] as Seat[]) sink += legalMoves(s, seat).length;
  },
  'giveaway.playMove (replay 3 seeded games)': () => {
    for (const g of giveaway) {
      let state = initialState(GIVEAWAY_RULES);
      for (let i = 0; i < g.moves.length; i++) state = playMove(state, g.moves[i], mulberry32(i)).state;
      sink += state.ply;
    }
  },
  'giveaway.bot (careful 1500)': () => {
    for (const s of gwBotStates) sink += chooseGiveawayFourBotMove(s, 1500, mulberry32(5))?.to ?? 0;
  },
  'serialize + deserialize (every position)': () => {
    for (const s of ffaStates) sink += serialize(s).length;
    for (const text of snapshots) sink += deserialize(text).ply;
  },
};

interface Result {
  min: number;
  median: number;
}

function measure(run: () => void): Result {
  for (let i = 0; i < WARMUP; i++) run();
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    run();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { min: times[0], median: times[Math.floor(times.length / 2)] };
}

const results: Record<string, Result> = {};
for (const [name, run] of Object.entries(WORKLOADS)) {
  const times = REPS[name] ?? 1;
  results[name] = measure(() => {
    for (let i = 0; i < times; i++) run();
  });
}

const report = {
  env: { node: process.version, cpu: os.cpus()[0]?.model, cores: os.cpus().length, platform: os.platform(), runs: RUNS, positions: { ffa: ffaStates.length, giveaway: giveawayStates.length } },
  results,
  sink,
};

const outIndex = process.argv.indexOf('--out');
if (outIndex > 0) writeFileSync(process.argv[outIndex + 1], JSON.stringify(report, null, 1) + '\n');

const compareIndex = process.argv.indexOf('--compare');
const baseline = compareIndex > 0 ? (JSON.parse(readFileSync(process.argv[compareIndex + 1], 'utf8')) as typeof report) : null;
let failed = false;
console.log(`${'workload'.padEnd(52)} ${'min ms'.padStart(9)} ${'median'.padStart(9)}${baseline ? `  ${'base min'.padStart(9)} ${'ratio'.padStart(7)}` : ''}`);
for (const [name, r] of Object.entries(results)) {
  let tail = '';
  if (baseline?.results[name]) {
    const ratio = r.min / baseline.results[name].min;
    const bad = Math.abs(ratio - 1) > LIMIT;
    if (bad) failed = true;
    tail = `  ${baseline.results[name].min.toFixed(2).padStart(9)} ${ratio.toFixed(3).padStart(7)}${bad ? '  <-- outside +-' + LIMIT * 100 + '%' : ''}`;
  }
  console.log(`${name.padEnd(52)} ${r.min.toFixed(2).padStart(9)} ${r.median.toFixed(2).padStart(9)}${tail}`);
}
if (baseline) console.log(failed ? 'BENCHMARK: outside the +-5% band' : 'BENCHMARK: all workloads within +-5% of the baseline');
process.exit(failed ? 1 : 0);
