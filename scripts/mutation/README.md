# Mutation testing harness

A copy-based mutation harness. It injects ONE bug at a time into a COPY of the source, runs the tests of that area, and reports whether the tests noticed. **The real repository is only ever read.** It was a scratch folder through Chaturaji, FFA, Giveaway, the variants and the join-challenge limiter; it lives here since Bughouse W0 so that every later workstream (and CI, if it ever wants to) runs the same code.

```
npm run mutate -- <config.cjs> [--chunk-size 20] [--chunk N] [--match text] [--chunk-minutes 20] [--mutant-timeout ms] [--out dir] [--keep] [--dry-run]
```

| file | what it is |
| --- | --- |
| `mutate-generic.cjs` | the engine: copy, link, baseline, one mutant at a time, restore. Also runnable alone (`node scripts/mutation/mutate-generic.cjs <config> [--from N --to M]`). |
| `run.cjs` | the runner behind `npm run mutate`: slices a config into chunks, runs them **one at a time** in child processes with a hard limit each, writes results outside the repo. |
| `example/` | a tiny module, its check and a config with five killable mutants and one equivalent one: `npm run mutate -- scripts/mutation/example/example.config.cjs` (a survivor exits 1; that is the point of the example). |
| `mutationHarness.test.ts` | the harness's own tests (vitest, project `logic`). It also pins that no committed config names a drive letter or a home directory (the server config's `root` is `<app>/backend`, computed from `__dirname`). |
| `configs/chaturaji-bot-constants.config.cjs` | the quick real set (9 mutants, about 20 s, all killed): every weight of the Chaturaji bot set to 0 or an extreme. The smoke test of a new machine (cloud VM, TESTING.md "Cloud sessions"): `npm run mutate -- scripts/mutation/configs/chaturaji-bot-constants.config.cjs` must print `ALL KILLED`. |

## A config

A CommonJS module exporting `{ root, work, copy, junction, cmd, mutants, mutantTimeoutMs, baselineTimeoutMs }`:

- `root` - the repository to mutate; default: this repository. `work` - where the copy is made; default `<tmp>/em-chess-mutation/<config>-<pid>`. **It must be outside `root`** (the harness refuses otherwise, and refuses a directory that contains `root`).
- `copy` - paths copied into the work directory (`['src', 'package.json', 'tsconfig.json', 'vitest.config.mts']`). **Never `node_modules`.**
- `junction` - paths linked instead of copied, normally `['node_modules']`: a directory *junction* on Windows (no privilege needed), a directory *symlink* elsewhere. The copy never contains a second `node_modules`; the real one is shared read-only.
- `cmd` - the shell command run inside the work directory; exit code 0 = tests pass.
- `mutants` - `[name, file, find, replace]` rows. `find` must occur **exactly once** in `file` (otherwise the row is reported `PATTERN` and the run exits 4: a mutant that did not apply proves nothing), and the replacement must change the text. Line endings are normalised for matching and the file's own style is written back.
- `mutantTimeoutMs` - the time limit of one test run (default 20 minutes). A run that exceeds it is killed **with its whole process tree** (`taskkill /T /F` on Windows, the process group elsewhere) and counts as killed (`timeout`).

A mutant is **killed** when `cmd` fails or times out and **survives** when it passes. The baseline (the unmutated copy) must be green, or the run stops with exit 2.

## Chunks, time limits, results

- **At most 20 mutants and 20 minutes per chunk** (AGENTS.md); `--chunk-size` and `--chunk-minutes` accept smaller values and refuse larger ones. When the minutes pass the chunk's process tree is killed and the chunk is reported `TIMED OUT` (exit 3); the mutants it did not reach are `not run`. The answer is a smaller chunk, never a longer limit.
- **One chunk at a time and one runner at a time**: a lock file in the temp directory holds the runner's PID; a second runner refuses to start while that process lives. Do not run a chunk next to another test run - it slows both and turns timing-sensitive tests into false kills.
- `--match text` runs only the mutants whose name contains the text; chunk numbers are over the matching list, so they are stable. `--chunk N` runs one chunk. `--dry-run` prints the plan.
- **Results are written outside the repository**, by default to `<tmp>/em-chess-mutation-results/<config>-<timestamp>/`: `chunk-<n>.json` (every mutant: status `killed` / `survived` / `timeout` / `invalid` / `not-run`, the first failing line, the milliseconds), `chunk-<n>.log` and `summary.txt`. `--out` can name another directory; one inside the repository is refused.
- Exit code: 0 every mutant killed; 1 a mutant survived; 2 the baseline is red; 3 a timeout or mutants not run; 4 an invalid pattern or config.

## What to do with a survivor

Kill it with a test, or prove it equivalent **and pin the proof with a test** (AGENTS.md). Constants that a mutation-targeted test checks are written in the test as **literals** (a test that reads the constant from the module under mutation can never kill a mutant of it). A mutant that is a no-op (for example `${x}` in a plain string) is not a mutant; the harness reports `PATTERN ... changes nothing` only when the whole replacement is identical text.

## Windows and Linux

Tested on Windows 11 (junction) and in CI on Linux (directory symlink): `mutationHarness.test.ts` runs the example config end to end on whichever it is, checks that the real `node_modules` stand-in survives the cleaning, that a hanging test run is killed with its children, and that a work directory inside the repository is refused.

## Where the configs live

Per-area configs are the record of what was mutated and why; put them in the workstream's own folder or, while they are scratch, outside the repository - only the harness and the example are committed here. A config's mutants carry their reason in the name (`(EQUIVALENT: ...)`) so a log is readable without the config.
