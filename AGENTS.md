Before implementing or reviewing ANY change to this app — not just a new game variant — read CHECKLIST.md and follow it.

# Never edit or write files through shell one-liners

Never create or change a file with a shell one-liner that contains backticks, template literals (`${...}`), escaped newlines or any multi-line string: `node -e "..."`, `sed -i` with a long program, `python -c`, `echo`/`printf`/heredocs that embed code. The shell expands backticks and `$`, collapses backslashes and rewrites `\n`, which silently corrupts the file (it has happened repeatedly: garbled docs, a test file that no longer parsed, a stray run of a test script).
Use the Edit / Write tools for every file change. If a change really needs a program (a bulk transform), write the program to a script FILE with the Write tool and run that file. A shell one-liner is fine for read-only commands and for plain single-line edits with no quotes, backticks or `$` in them.

# Waiting for CI and for background jobs

- Waiting for CI: ONE watcher, polled no more often than every 2 minutes, never parallel pollers (command #24b ran three watchers at once and hit the GitHub API rate limit).
- Waiting for any background job (a build, a long test run, a mutation chunk): one watcher, no polling loop faster than every 60 seconds.

# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Rules learned building Chaturaji (W2-W5): they apply to every later change

- A square name, a square parse, a cell size or a cell <-> square map in 4-seat code goes through `geometryOf(state.rules)` - never the cross board's module-level `squareName` / `parseSquare` / `SIZE` / `fromDisplay` (it silently misreads an 8 x 8 game: every online move once went to the wrong square). `chaturajiWiring.test.ts` and `chaturajiOnlineSquares.test.ts` pin it.
- A constant that a mutation-targeted test checks is written in the test as a LITERAL (a test that reads the constant from the module under mutation can never kill a mutant of it).
- Mutation runs: on a COPY of the source (never in place), chunks of at most ~20 mutants / 20 minutes, a hard timeout per mutant, one chunk at a time and never next to other gates, results written outside the repo after each chunk; every survivor is killed with a test or proven equivalent with a test that pins the proof.
- A switch that exists only for tests (an environment variable, a build-time setting, an endpoint) follows CHECKLIST.md section 7: opt-in name, ignored in production with one warning that does not print the value, a finite validated value, set only by the test stack's own process.
- A test asserts nothing about wall-clock time: waits end on a condition (their bounds only turn a hang into a failure), no 5-second timeouts, seeded randomness, fake timers in rendered tests. A check whose NUMBER depends on what an unseeded server did is counted apart as "conditional", so the printed total is the same on every run.
- The browser end-to-end runs only against its OWN private backend and web build (never :3000, :8081, :8082 or the deployed backend), registers throw-away accounts and deletes them, and kills only the processes it started, proven by PID and command line first.
- A screen is tested rendered (the `dom` project) as well as by source scans, and what it shows that comes from the engine is compared with the engine, never recomputed in the test.

# Cloud sessions (a Linux VM; TESTING.md, "Cloud sessions")

- Work runs in Claude Code cloud sessions, not on the laptop: start every session with `bash scripts/cloud-setup.sh` (idempotent, seconds when cached; it also starts the local PostgreSQL, which does not survive a session) and find the backend at `./backend`.
- The laptop-only rules above (never touch :3000 / :8081 / :8082) still apply whenever a session runs locally on the laptop.
- In the cloud use any free port (CI itself uses 3000 and 3002); the rules that never change: no deployed backend, no Neon, no Render, no real secret.
- Never commit the VM's `backend/.env` (test-only values, git-ignored): a real `.env` is never asked for, read or printed.
