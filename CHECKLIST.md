# EM-Chess — Definition of Done

Applies to every change in this repo or chess-app-backend — a new game variant, a UI tweak, a
backend endpoint, a refactor, anything. Not done until it clears every section below. This
exists because Fog of War cost real hours on problems that should have been caught before it
was called "done" — don't repeat that on anything else.

## 1. Spec before code
- Write 3-5 sentences: exactly what changes, and which existing code/infrastructure is reused
  vs. genuinely new.
- State explicitly how this interacts with existing features it could plausibly combine or
  conflict with (other variants, bots, Online mode, analysis, puzzles) — never a silent
  assumption that it's independent. (Fog of War + Chess960 are explicitly non-combinable today —
  that's the kind of thing that needs to be said out loud, not discovered later.)

## 2. Correctness
- Explicit list of edge cases this change touches, with a test for each.
- For anything chess-logic-related specifically: en passant, promotion, castling, undo/redo, FEN
  serialization/reload (especially if a king can be missing/captured — see Fog of War's
  skipValidation precedent).
- New or updated tests in the matching __tests__ file; add cases to gameModes.test.ts if this
  changes getGameOutcome.
- For any new self-contained rules engine (a variant that reimplements move legality, a new
  draw/insufficient-material rule, …): do a mutation check before calling it done — deliberately
  break one real invariant (e.g. Atomic's pawn immunity to explosions) and confirm the suite
  actually FAILS, not just that it passes when the code is right. Surviving mutants are test gaps
  (the Atomic insufficient-material rule had two on the first pass); note any that are genuinely
  equivalent (cannot change behaviour) instead of silently ignoring them.

## 3. Performance
- Anything on a hot path (every render, every move, every keystroke, a long list) tested against
  realistic scale (e.g. a 40+ move game), not just the happy-path demo. If something recomputes
  from scratch on every render instead of incrementally, flag it before merge — don't wait for a
  lag report to find out.

## 4. Online/backend parity
- If it touches Online mode: client and server logic kept in sync, with their own side-by-side
  tests (the way RoomChessEngine mirrors the client for Fog of War) — not "seems to work in a
  manual demo".

## 5. CI / cross-feature impact
- tsc and vitest stay green.
- If it affects bots: explicit decision on whether Stockfish can be reused as-is or needs a
  custom heuristic — never a silent assumption that "it'll probably work".
- Explicit check: does this break bots, analysis mode, PGN export/import, game history, or
  puzzles? All of those already exist and a new change can break them without anyone noticing.

## 6. Documentation
- A doc-comment explaining why this exists and any non-obvious gotchas, same style as the
  existing code — so the next session (you, future Claude Code) doesn't rediscover the same
  traps from zero.

### Extra, specifically when the change is a new game variant/mode
- Explicit mutual-exclusivity declaration with every other variant. Every variant-wide statement or list
  names ALL of them, the 4-seat games included (4 Player Chess, 4 Player Giveaway, Chaturaji): menu card,
  setup, queue (the queue key is `timeControl|variant`), Spectate list section, rejoin, resume link, result.
- Fits the existing pattern: VariantSelector entry, screen prop threading (fogOfWar/chess960/
  setupChess-style), gameResult.ts priority slot.
- Board annotations (arrows/highlights) follow the app-wide invariant in
  `src/logic/annotationLifecycle.ts`: cleared when a MOVE is played, by anyone, and at no other
  time — never keyed to whose turn it is, a turn starting, or a seat being skipped/eliminated/
  flagged without a move. Name the mode's position epoch (classic: the FEN; the 4-seat games - 4 Player Chess, 4 Player Giveaway and Chaturaji -: the ply),
  clear through `useClearAnnotationsOnMove`, and add the mode's no-move turn-advance paths to
  `annotationLifecycle.test.ts`. This applies to Online boards too.
- A mode with a different BOARD (Chaturaji's 8 x 8 square) reaches the screens through the game's geometry
  (`geometryOf(state.rules)`): no UI or client file may name a square, parse one, size the board or map a
  cell through the cross board's module-level helpers (`SIZE`, `squareName`, `parseSquare`, `fromDisplay`,
  `getFourPlayerCellSize`, ...). `chaturajiWiring.test.ts` pins it for the 4-seat files; a new board adds
  its files to that list.
- Screens are tested RENDERED, not only by source scans: the `dom` vitest project (`*.dom.test.tsx`, jsdom +
  react-native-web, `src/test/domSetup.ts` / `domKit.tsx`) renders the real screens against the real engine
  or a server simulator. A new mode adds a menu / setup / game / result test there, with fake timers and
  no wall-clock assertions. What a screen shows that comes from the engine (points, statuses, the result)
  is compared with the engine, never recomputed in the test or the UI.
- Mutation chunks are bounded: at most ~20 mutants per chunk with a hard per-mutant time limit, run one at
  a time with the result written down as it finishes (a long unbounded background run can be lost to a
  suspended laptop). A test that reads a constant from the module under mutation cannot kill a mutant of
  that constant: pin constants as literals.

## 7. Test-only switches (a knob that exists for tests must not exist in production)
- A test-only environment variable or build-time setting is read in ONE small module, has an opt-in name that says
  what it does, is ignored when `NODE_ENV=production` (one warning at startup that does not print the value), only
  accepts a finite value inside a bound (it can raise a limit, never switch it off), is set only by the test
  stack's own child process (never in a workflow `env`, `.env.example`, `render.yaml` or any deployment config),
  and has tests for: the default unchanged, ignored in production, honoured outside it, no secret read or logged.
- **Auth rate-limit override absent/ignored in production**: `AUTH_RATE_LIMIT_TEST_OVERRIDE` (backend
  `src/lib/authRateLimit.ts`) - `npm run test:authRateLimit` in the backend pins all of the above. The same rule
  for the app: `EXPO_PUBLIC_API_URL` is honoured by dev builds only (`src/api/apiBaseUrl.ts`, `apiBaseUrl.test.ts`).
- **A proxy hop count is a measurement, not an assumption** (`TRUSTED_PROXY_HOPS`, backend TESTING.md sections 35-38): any limit that is keyed by client address must be checked on the
  deployed server (`GET /health/client-ip`: `clientIsPrivate` false, `chain` as expected, a spoofed `X-Forwarded-For` changes nothing) before it is trusted.

## 8. Generated mirrors and the mutation harness (Bughouse W0 / W1)
- A module that runs on the client AND the server is GENERATED into the backend, never copied by hand: list it in the directory's `MIRRORED_TO_BACKEND.json`, run `npm run sync:fourplayer` /
  `npm run sync:bughouse` in the backend, commit the result, and keep `--check` in CI. The closure rule applies: a mirrored file imports only another mirrored file (or `../crazyhouse`, which
  has its own verbatim mirror), and the one package allowed in the Bughouse mirror is `chess.js` (`ALLOWED_PACKAGES` in `backend/scripts/sync-bughouse.mjs`; a dependency of BOTH repos).
- The server copy of an engine gets a LOCKSTEP test against the app's (`npm run test:bughouse` in the backend): the same seeded inputs, byte-identical match text after each.
- Mutation runs go through the in-repo harness: `npm run mutate -- <config>` (`scripts/mutation/README.md`): chunks of at most 20 mutants / 20 minutes, one runner at a time, a copy of the source
  with `node_modules` linked and never copied, results outside the repo. A config's mutants carry their reason in the name when they are equivalent; every survivor is killed or proven
  equivalent by a test that pins the proof.
- A rule that is easy to get wrong silently is pinned by a SCAN, not by memory: the board as a required argument is `bughouseBoardArgument.test.ts` (an AST scan of `src/logic/bughouse`).

## 9. A server loop and a bot (Bughouse W2): what the work taught
- A room manager has ONE funnel: every input and every timer goes through the engine's `settle(match, input | null, nowMs)` with one injected monotonic integer clock; a late or stale timer is then `idle`
  and cannot change the outcome. Timers are re-armed from the engine's `runningClocks`, never from a second copy of the deadlines. Tests inject the clock and the timers (`manualTimers`); nothing waits.
- A bot that runs in-process on the one event loop has a WORK budget made of COUNTS (candidates, probes, batches), never a clock; it is measured per ELO tier (p50 / p99 / max printed, only a ceiling
  asserted, best of 3 per decision) and its caps are pinned as literals. A bot is never trusted: every action goes through the funnel, and a faulty answer falls back to the first legal action.
- A message feature is proved by RECORDING every socket's events and inspecting ALL of them (the recipients are computed by the server from the seat map; a payload that names recipients is ignored);
  matchmaking is proved isolated by running the new queue next to every existing one on the same `io` at the same time control.
- A test that reads a number from the module it tests cannot kill a mutant of that number. When a mutation run leaves dozens of survivors, export the pure parts (scoring, probing, ordering) and pin them
  with literals; for the hardest survivors run a DIFFERENTIAL SEARCH (the original and the mutated copy on seeded positions) and pin the first position where they differ.
- Before labelling a mutant EQUIVALENT, write the property that proves it over real positions (and run it); an equivalence argued from the code's shape alone was wrong once (a guard the random branch
  reaches without the engine) and a test killed it.
- A real-socket test must not read "the last" event of a stream that a later, legitimate event can follow (a restarted app's socket ends after its hand-back): read the first event after the cause.
- A test that scans the repo for a switch's name (CHECKLIST 7) must be taught about every new test that names the switch; run the older scans when a new switch test is added.
- The 4-seat real-socket e2e prints 427 only with the second server for the real 30 s fill guard (`FOUR_E2E_REAL_FILL_URL`); without it the guard is skipped and the total is 422. Compare like with like.
