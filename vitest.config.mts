import { defineConfig } from 'vitest/config';

/**
 * Two test projects.
 *
 * `logic` is everything this repo has always had: pure TypeScript run in node (engine, wire, reducers, source-scan pins). Its one setting is the per-test time budget.
 * Why. vitest's default is 5 s per test, and this suite has dozens of CPU-bound tests (random whole games, 1000-position oracle comparisons,
 * bot-vs-bot runs) and a few I/O-bound ones (source scans that read every shipped file). On an idle machine the slowest of the default-budget
 * ones take 3-5 s, i.e. they were already living at the limit; with the suite's 60+ parallel workers, a second suite running, or a busy CI
 * runner, their wall time doubles or triples and they fail with "Test timed out in 5000ms" although nothing is wrong (reproduced by running three
 * full suites at once: 57 timeouts, always the same ~10 tests; ten runs on an idle machine never failed). The budget is therefore a *hang
 * detector*, not a performance assertion, and is generous. Tests that want a performance bound assert it themselves, with a load-robust
 * measurement (see "decision cost" and "there is no deep tier" in fourPlayerGiveawayBot.test.ts).
 *
 * A test that really needs longer than this still sets its own timeout, as before (e.g. `}, 120_000)`).
 *
 * `dom` (Chaturaji W3) renders the REAL screens and components - `*.dom.test.tsx` - in jsdom through react-native-web, with @testing-library/react. The repo had no renderer
 * before (its tests said so in their headers); react-native-web is already a dependency (it is what the web build runs), so aliasing `react-native` to it renders the very
 * components the app ships, with the native-only modules (haptics, audio, storage, the socket) replaced by the stubs in src/test/domSetup.ts.
 */
const budget = { testTimeout: 30_000, hookTimeout: 30_000 };

export default defineConfig({
  test: {
    ...budget,
    projects: [
      {
        extends: true,
        test: { name: 'logic', include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] },
      },
      {
        extends: true,
        resolve: { alias: { 'react-native': 'react-native-web' } },
        test: {
          name: 'dom',
          include: ['src/**/*.dom.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['src/test/domSetup.ts'],
        },
      },
    ],
  },
});
