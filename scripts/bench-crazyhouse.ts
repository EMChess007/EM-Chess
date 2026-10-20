/**
 * Hot-path benchmark of 2-player Crazyhouse (BUGHOUSE_SPEC.md section 7, W0): the before / after gate for the Bughouse additions to crazyhouse.ts.
 *
 *   backend/node_modules/.bin/tsx scripts/bench-crazyhouse.ts [--out file.json]
 *   scripts/bench/ab-procs.sh <baseline-checkout> [pairs] [out-dir]     with  BENCH=bench-crazyhouse.ts
 *
 * The additions are new exports (nothing existing changes), so the expected result is "no difference"; the benchmark exists to PROVE that on the paths a game uses: drop
 * generation, the check geometry, applying a move, and the bot (which calls all of them thousands of times per move). Each workload replays DETERMINISTIC inputs (seeded games,
 * built before the clock starts) through one hot function, repeated `RUNS` times after a warm-up; the number reported is the BEST (minimum) run - a deterministic call can only be
 * slowed down by the machine, never sped up - together with the median. The comparison is made across PROCESSES (ab-procs.sh / ab-stats.cjs), because one process is one JIT
 * history and on a busy desktop that alone moves a workload by 10-20%.
 *
 * It imports only functions that exist on master, so the same file runs in the baseline checkout.
 */
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { chooseCrazyhouseBotMove } from '../src/logic/bots';
import { ChessEngine } from '../src/logic/ChessEngine';
import { crazyhouseCheckInfo, getCrazyhouseMoves, initialCrazyhouseState, legalDrops, type CrazyhouseState } from '../src/logic/crazyhouse';
import { START_FEN } from '../src/types/chess';
import { mulberry32 } from '../src/logic/__tests__/fourPlayerGoldenKit';

const RUNS = 8;
const WARMUP = 2;

interface Position {
  fen: string;
  state: CrazyhouseState;
}

/** Plays seeded games (60% moves biased to captures, 40% drops when there are any) and returns every position reached. */
function games(seeds: number[], plies: number): Position[] {
  const positions: Position[] = [];
  for (const seed of seeds) {
    const rng = mulberry32(seed);
    const engine = new ChessEngine(START_FEN, { crazyhouse: true, crazyhouseState: initialCrazyhouseState() });
    for (let ply = 0; ply < plies && !engine.isGameOver(); ply++) {
      positions.push({ fen: engine.getFen(), state: engine.getCrazyhouseState() });
      const drops = engine.getLegalDrops();
      if (drops.length > 0 && rng() < 0.4) {
        const d = drops[Math.floor(rng() * drops.length)];
        engine.drop(d.piece, d.square);
        continue;
      }
      const moves = getCrazyhouseMoves(engine);
      if (moves.length === 0) break;
      const captures = moves.filter((m) => m.captured);
      const pool = captures.length > 0 && rng() < 0.6 ? captures : moves;
      const m = pool[Math.floor(rng() * pool.length)];
      engine.move(m.from, m.to, m.promotion);
    }
  }
  return positions;
}

const all = games([21, 22, 23, 24, 25, 26], 70);
const withReserve = all.filter((p) => p.state.reserve.w.p + p.state.reserve.w.n + p.state.reserve.b.p + p.state.reserve.b.n > 0);
const botPositions = all.filter((_, i) => i % 40 === 0);
const engineAt = (p: Position) => new ChessEngine(p.fen, { crazyhouse: true, crazyhouseState: p.state });

let sink = 0; // keeps the optimiser honest

/** Each workload is repeated `x` times inside one timed run so a run lasts ~100 ms: below that the timer, the JIT and the OS dominate the number. */
const REPS: Record<string, number> = {
  'crazyhouse.getLegalDrops (positions with a reserve)': 30,
  'crazyhouse.getCrazyhouseMoves (every 8th position)': 2,
  'crazyhouse.checkInfo (both kings, every position)': 12,
  'crazyhouse.move + drop (replay 2 seeded games)': 1,
  'crazyhouse.bot (elo 3000, searching, every 40th position)': 1,
};

const engines = all.map(engineAt);
const moveEngines = engines.filter((_, i) => i % 8 === 0);
const reserveEngines = withReserve.map(engineAt);

const WORKLOADS: Record<string, () => void> = {
  'crazyhouse.getLegalDrops (positions with a reserve)': () => {
    for (const e of reserveEngines) sink += e.getLegalDrops().length;
  },
  'crazyhouse.getCrazyhouseMoves (every 8th position)': () => {
    for (const e of moveEngines) sink += getCrazyhouseMoves(e).length;
  },
  'crazyhouse.checkInfo (both kings, every position)': () => {
    for (let i = 0; i < engines.length; i++) {
      const e = engines[i];
      for (const color of ['w', 'b'] as const) {
        let king: string | null = null;
        for (const row of e.getBoard()) for (const cell of row) if (cell.piece?.type === 'k' && cell.piece.color === color) king = cell.square;
        if (king) sink += crazyhouseCheckInfo(king, color, (sq) => e.getPieceAt(sq)).checkers + legalDrops(all[i].state, color, (sq) => e.getPieceAt(sq)).length;
      }
    }
  },
  'crazyhouse.move + drop (replay 2 seeded games)': () => {
    for (const seed of [21, 22]) {
      const rng = mulberry32(seed);
      const engine = new ChessEngine(START_FEN, { crazyhouse: true, crazyhouseState: initialCrazyhouseState() });
      for (let ply = 0; ply < 70 && !engine.isGameOver(); ply++) {
        const drops = engine.getLegalDrops();
        if (drops.length > 0 && rng() < 0.4) {
          const d = drops[Math.floor(rng() * drops.length)];
          engine.drop(d.piece, d.square);
          continue;
        }
        const moves = getCrazyhouseMoves(engine);
        if (moves.length === 0) break;
        const captures = moves.filter((m) => m.captured);
        const pool = captures.length > 0 && rng() < 0.6 ? captures : moves;
        const m = pool[Math.floor(rng() * pool.length)];
        engine.move(m.from, m.to, m.promotion);
      }
      sink += engine.getHistory().length;
    }
  },
  // `() => 0` makes the bot take its SEARCH branch every time (a seeded generator would sometimes pick the cheap random move) and breaks ties the same way on every run.
  'crazyhouse.bot (elo 3000, searching, every 40th position)': () => {
    for (const p of botPositions) {
      const choice = chooseCrazyhouseBotMove(engineAt(p), 3000, () => 0);
      sink += choice ? 1 : 0;
    }
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
  env: { node: process.version, cpu: os.cpus()[0]?.model, cores: os.cpus().length, platform: os.platform(), runs: RUNS, positions: { all: all.length, withReserve: withReserve.length, bot: botPositions.length } },
  results,
  sink,
};

const outIndex = process.argv.indexOf('--out');
if (outIndex >= 0 && process.argv[outIndex + 1]) writeFileSync(process.argv[outIndex + 1], JSON.stringify(report, null, 1));
console.log(`positions: ${all.length} (${withReserve.length} with a reserve, ${botPositions.length} for the bot)`);
for (const [name, r] of Object.entries(results)) console.log(`${name.padEnd(54)} best ${r.min.toFixed(1).padStart(8)} ms   median ${r.median.toFixed(1).padStart(8)} ms`);
