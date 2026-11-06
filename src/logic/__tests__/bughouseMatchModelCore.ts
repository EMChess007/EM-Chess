import { expect } from 'vitest';
import { conservationProblems, deserializeMatch, legalDropsOn, legalMovesOn, serializeMatch } from '../bughouse';
import { describeEngine, dropKey, emptyStats, feed, moveKey, mulberry32, newPair, nextStep, type RunStats } from './bughouseTestKit';

/**
 * The body of the whole-match reference-model test (BUGHOUSE_SPEC.md HP1, W1 test 2b), shared by the four shard files bughouseMatchModel{A,B,C,D}.test.ts so that vitest runs the shards
 * in parallel workers. Seeded random matches are fed, input by input, to the engine (src/logic/bughouse) and to an independent naive model (bughouseReferenceModel.ts: chessops for one
 * board's rules; arithmetic for transfers, clocks, settlement, `stuck`, the result). After EVERY input the two must agree on the outcome (applied / flag / idle / rejected, and the reason of
 * a refusal) and on the whole state - both positions, the promoted marks, the four pockets, the four clocks, the verdicts, the result, seq. A refusal returns the very same match object.
 * Legal moves and drops of the board that just moved are compared on one commit in LIST_EVERY and of both boards in every match whose index is a multiple of 50: chess.js lists a move
 * with its notation and two FENs (about 3 ms a position), which is the only thing here that is expensive; every legal move the model lists is also PLAYED by the driver, and the
 * per-board differential test (bughouseBoards.test.ts) compares complete lists on thousands of positions. The conservation invariant is checked after every commit of one match in
 * eight (bughouseInvariant.test.ts checks it after EVERY commit of 600 other matches), the text snapshot round-trips every 25 steps, and replaying the accepted inputs of every 20th match
 * from the start rebuilds the identical state.
 *
 * BUGHOUSE_MODEL_MATCHES is the TOTAL number of matches over the four shards (default 2,000; the nightly runs 20,000).
 */
export const TOTAL_MATCHES = Number(process.env.BUGHOUSE_MODEL_MATCHES ?? 2000);
export const SHARDS = 4;
const MAX_STEPS = 72;
const LIST_EVERY = 25;

/** A comparison that costs nothing when it holds: the message (and the expect) is only built when the two differ. */
export function agree<T>(actual: T, expected: T, label: () => string): void {
  if (actual !== expected) expect(actual, label()).toBe(expected);
}

function runMatch(index: number, stats: RunStats): void {
  const seed = 700000 + index * 7919;
  const pair = newPair(seed);
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const accepted: { input: any; now: number }[] = [];
  const compareLists = index % 50 === 0;
  stats.matches++;
  for (let step = 0; step < MAX_STEPS && pair.engine.result === null; step++) {
    const before = pair.engine;
    const driver = nextStep(rng, before, pair.model);
    const { engine, model } = feed(pair, driver);
    stats.steps++;
    const where = () => `match ${index} (seed ${seed}) step ${step}: ${JSON.stringify(driver)}`;

    // the outcome
    agree(engine.kind, model.kind, where);
    if (engine.kind === 'rejected' && model.kind === 'rejected') {
      agree(engine.reason, model.reason, where);
      agree(pair.engine, before, where); // a refusal changes nothing: the very same object
      stats.rejected++;
    }
    if (engine.kind === 'applied' && model.kind === 'applied') {
      const bank = engine.events.find((e) => e.kind === 'bank');
      agree(bank === undefined || bank.kind !== 'bank' ? 'none' : `${bank.seat}${bank.piece}`, model.banked === null ? 'none' : `${model.banked.seat}${model.banked.piece}`, where);
      const played = engine.events[0];
      if (played.kind === 'move' || played.kind === 'drop') {
        stats.plies++;
        if (played.kind === 'drop') stats.drops++;
        if (played.san.includes('x')) stats.captures++;
        if (played.san.includes('=')) stats.promotions++;
      }
      if (bank) stats.banks++;
      accepted.push({ input: driver.input, now: driver.now });
    }
    if (engine.kind === 'flag') {
      stats.flags++;
      accepted.push({ input: driver.input, now: driver.now });
    }
    if (engine.kind === 'applied' || engine.kind === 'flag') stats.commits++;

    // the whole state
    agree(describeEngine(pair.engine), pair.model.describe(), where);
    if (pair.engine.verdicts.A.status === 'stuck' || pair.engine.verdicts.B.status === 'stuck') stats.stuckPositions++;

    // the invariant and the text, after commits
    if (engine.kind === 'applied' || engine.kind === 'flag') {
      if (index % 8 === 0) agree(conservationProblems(pair.engine).join(' | '), '', where);
      if (step % 25 === 0) {
        const text = serializeMatch(pair.engine);
        const back = deserializeMatch(text);
        agree(back.ok ? serializeMatch(back.match) : `not ok: ${back.error}`, text, where);
      }
    }

    // what can be played
    const moved = engine.kind === 'applied' && (engine.events[0].kind === 'move' || engine.events[0].kind === 'drop') ? engine.events[0].board : null;
    const boards: ('A' | 'B')[] = compareLists ? ['A', 'B'] : moved !== null && step % LIST_EVERY === 0 ? [moved] : [];
    for (const board of boards) {
      const b = board === 'A' ? 0 : 1;
      agree(legalMovesOn(pair.engine, board).map(moveKey).sort().join(' '), pair.model.legalMoveKeys(b).join(' '), () => `${where()} moves ${board}`);
      agree(legalDropsOn(pair.engine, board).map(dropKey).sort().join(' '), pair.model.legalDropKeys(b).join(' '), () => `${where()} drops ${board}`);
    }
  }
  if (pair.engine.result !== null) {
    const r = pair.engine.result;
    if ('voided' in r) stats.voids++;
    else if (r.reason === 'checkmate') stats.mates++;
    else if (r.reason === 'resign') stats.resigns++;
  }
  // replaying the accepted inputs rebuilds the identical state (the seq stream)
  if (index % 20 === 0) {
    const replay = newPair(seed);
    for (const a of accepted) feed(replay, { input: a.input, now: a.now });
    agree(describeEngine(replay.engine), describeEngine(pair.engine), () => `replay of match ${index}`);
    agree(serializeMatch(replay.engine), serializeMatch(pair.engine), () => `replay of match ${index}, text`);
  }
}

/** Runs this shard's matches (every SHARDS-th index starting at `shard`) and checks that the sample reached what it claims to test. */
export function runShard(shard: number): RunStats {
  const stats = emptyStats();
  const started = performance.now();
  for (let index = shard; index < TOTAL_MATCHES; index += SHARDS) runMatch(index, stats);
  const seconds = (performance.now() - started) / 1000;
  console.log(`bughouseMatchModel shard ${shard}: ${JSON.stringify(stats)} in ${seconds.toFixed(1)} s`);
  const share = TOTAL_MATCHES / SHARDS;
  if (TOTAL_MATCHES >= 2000) expect(stats.plies).toBeGreaterThanOrEqual(25_000); // 4 shards: at least 100,000 plies in all
  expect(stats.captures).toBeGreaterThan(share * 2);
  expect(stats.banks).toBeGreaterThan(share * 2);
  expect(stats.drops).toBeGreaterThan(share);
  expect(stats.rejected).toBeGreaterThan(share);
  expect(stats.flags + stats.mates + stats.resigns).toBeGreaterThan(0);
  expect(stats.stuckPositions).toBeGreaterThan(0);
  expect(stats.promotions).toBeGreaterThan(0);
  return stats;
}
