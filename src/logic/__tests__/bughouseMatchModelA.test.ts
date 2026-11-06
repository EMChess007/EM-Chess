import { describe, it } from 'vitest';
import { TOTAL_MATCHES, runShard } from './bughouseMatchModelCore';

// Shard 0 of 4 of the whole-match reference-model test: see bughouseMatchModelCore.ts. (Four files, so that vitest runs the shards in parallel workers.)
describe('the engine against the whole-match reference model, shard A', () => {
  it(`matches 0, 4, 8, ... of ${TOTAL_MATCHES} agree with the model on every input`, { timeout: 900_000 }, () => {
    runShard(0);
  });
});
