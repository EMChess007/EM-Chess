import { describe, it } from 'vitest';
import { TOTAL_MATCHES, runShard } from './bughouseMatchModelCore';

// Shard 1 of 4 of the whole-match reference-model test: see bughouseMatchModelCore.ts.
describe('the engine against the whole-match reference model, shard B', () => {
  it(`matches 1, 5, 9, ... of ${TOTAL_MATCHES} agree with the model on every input`, { timeout: 900_000 }, () => {
    runShard(1);
  });
});
