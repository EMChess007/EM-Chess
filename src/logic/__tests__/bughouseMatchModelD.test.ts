import { describe, expect, it } from 'vitest';
import { voidMatch, type BughouseMatch } from '../bughouse';
import { TOTAL_MATCHES, runShard } from './bughouseMatchModelCore';
import { describeEngine, newPair } from './bughouseTestKit';

// Shard 3 of 4 of the whole-match reference-model test: see bughouseMatchModelCore.ts. This file also holds the one case the random driver never produces: a voided match.
describe('the engine against the whole-match reference model, shard D', () => {
  it(`matches 3, 7, 11, ... of ${TOTAL_MATCHES} agree with the model on every input`, { timeout: 900_000 }, () => {
    runShard(3);
  });

  it('a voided match agrees too: no winner, and nothing after it is accepted', () => {
    const pair = newPair(5);
    const voided = voidMatch(pair.engine, pair.engine.nowMs + 10);
    expect(voided).not.toBeNull();
    expect(pair.model.voidIt(pair.engine.nowMs + 10)).toBe(true);
    expect(describeEngine(voided as BughouseMatch)).toBe(pair.model.describe());
    expect(voidMatch(voided as BughouseMatch, pair.engine.nowMs + 20)).toBeNull();
  });
});
