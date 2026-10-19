import { defineConfig } from 'vitest/config';

/**
 * The only vitest setting this project changes: the per-test time budget.
 *
 * Why. vitest's default is 5 s per test, and this suite has dozens of CPU-bound tests (random whole games, 1000-position oracle comparisons,
 * bot-vs-bot runs) and a few I/O-bound ones (source scans that read every shipped file). On an idle machine the slowest of the default-budget
 * ones take 3-5 s, i.e. they were already living at the limit; with the suite's 60+ parallel workers, a second suite running, or a busy CI
 * runner, their wall time doubles or triples and they fail with "Test timed out in 5000ms" although nothing is wrong (reproduced by running three
 * full suites at once: 57 timeouts, always the same ~10 tests; ten runs on an idle machine never failed). The budget is therefore a *hang
 * detector*, not a performance assertion, and is generous. Tests that want a performance bound assert it themselves, with a load-robust
 * measurement (see "decision cost" and "there is no deep tier" in fourPlayerGiveawayBot.test.ts).
 *
 * A test that really needs longer than this still sets its own timeout, as before (e.g. `}, 120_000)`).
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
