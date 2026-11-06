@AGENTS.md

# EM-Chess — frontend (Expo app). Read this first; it links the long docs instead of copying them.

## WHAT
EM-Chess: a chess app with many variants (Classic, 960, KotH, 3-check, Setup Chess, Fog of War, Giveaway, Atomic, Duck,
Spell, Horde, Crazyhouse; 4-seat: 4 Player, 4P Giveaway, Chaturaji; Crazy Bughouse), played Local, vs Bots and Online.
- This repo = the app: Expo SDK 58, React Native 0.88, TypeScript, Node >= 22 (CI uses 22). Web build via react-native-web.
- Backend = repo `chess-app-backend` (Express + socket.io + Prisma/Postgres), cloned at `./backend`. Deployed on Render, DB on Neon,
  Sentry for crash reports (never touch any of them from a session).
- Server rules twin the client rules: a game rule lives in BOTH repos (`src/logic/*.ts` here, `src/game/*.ts` in the backend).
  4P / Bughouse engines are GENERATED into the backend (run `npm run sync:fourplayer` / `sync:bughouse` inside `backend/`); never edit the copy.

## SESSION START (always, in this order)
1. `git fetch origin` and branch from the fresh remote: `git checkout -B <branch> origin/master` (backend: `origin/main`). Never from an old local branch.
2. `bash scripts/cloud-setup.sh` (idempotent, seconds; starts local PostgreSQL, which does not survive a session).
3. If `package-lock.json` changed since the last session, or `tsc` shows errors in files you did not touch: `npm ci` first (also in `backend/`).
4. Read `CHECKLIST.md` (Definition of Done) before implementing or reviewing anything. Then only the doc sections your task needs.

## HARD RULES
- Never connect to Neon / Render / the deployed backend. `backend/.env` is test-only, git-ignored, never committed, never printed.
- File edits ONLY with Edit / Write. No heredoc, `sed -i`, `python -c`, `node -e` writes (see AGENTS.md).
- No `react-native-gesture-handler` (touch handling is our own: `useBoardTouches` / `boardTouches`).
- Expo changed: check https://docs.expo.dev/versions/v58.0.0/ (SDK 58 notes: TESTING.md 33b) before writing Expo code.
- Every task finishes in < 1 hour. If it won't, do what fits, push cleanly, report what remains.
- Grep before reading. Never read a big file whole (TESTING.md is 2000+ lines: `grep -n '^## '` then read one section). Never dump long logs into
  the conversation: write them to a file under the scratchpad, then grep it.
- Locally run ONLY the tests related to the change + `npm run typecheck`. Full suites run in CI / the pre-push hook.
  e.g. `npx vitest run src/logic/__tests__/horde` (name filter); dom screens: `npx vitest run --project dom <file>`.
- Heavy gates (full Android device matrix, mutation runs, 3/3 repeat runs) ONLY when the user asks.
- Push, then report immediately. Never wait on, poll or watch CI.
- One branch per task, PR to `master` (backend: `main`). Never merge. Never force-push. Never `SKIP_PREPUSH` on a final commit.
- The user merges only when `test`, `device-matrix`, `android-e2e` and `security-audit` are all green.
- Do not edit generated files: `src/engine/generated/*`, and the backend's `src/game/fourPlayer/*` / `src/game/bughouse/*` (use the sync scripts).
- Tests: literals for mutation-targeted constants, seeded randomness, no wall-clock assertions, fake timers in rendered tests (AGENTS.md).
- Phone notes: the round gear in Expo Go is Expo's own button, ignore it. If the phone shows an old version: Expo Go -> Clear storage.

## MAP
- `App.tsx` navigation; `src/screens/` (one file per screen, tests in `screens/__tests__/*.dom.test.tsx`); `src/components/` (board, pieces,
  `VariantSelector.tsx`); `src/logic/` rules, bots, storage, hooks (tests in `logic/__tests__`); `src/api/` REST + socket client;
  `src/engine/` Stockfish / custom UCI adapters; `src/data/` openings, puzzles, piece sets; `scripts/` tooling, `scripts/android`,
  `scripts/browser` (device matrix), `scripts/mutation`.
- Vitest projects (`vitest.config.mts`): `logic` (`*.test.ts`) and `dom` (`*.dom.test.tsx`, jsdom + react-native-web, `src/test/domSetup.ts`, `domKit.tsx`).
- CI (`.github/workflows`): `ci.yml` (test = tsc + vitest, device-matrix), `android-e2e.yml`, `android-matrix-nightly.yml`, `security-audit.yml`.
  Pre-push hook: `.githooks/pre-push` -> `scripts/pre-push.mjs` (tsc + fast vitest).

### Where a 2-player variant plugs in (Horde/Crazyhouse are the closest models)
Frontend (`src/`):
1. Rules: `logic/<variant>.ts` + hooks inside `logic/ChessEngine.ts` (legal moves, check/result).
2. `components/VariantSelector.tsx` (`GameVariant` union + entry); `logic/onlineVariants.ts` (`OnlineVariantFlags`, `variantWireFlags`, `variantTitlePrefix`).
3. Results / text: `logic/gameResult.ts` (priority slot), `gameOutcomeText.ts`, `gamePayload.ts`, `pgn.ts`, `pgnImport.ts`, `pgnReplay.ts`.
4. Bots: `logic/bots.ts` (`choose<Variant>BotMove`), screen wiring in `screens/BotGameScreen.tsx`, `BotSelectScreen.tsx`.
5. Screens: `LocalGameScreen`, `BotGameScreen`, `OnlineGameScreen`, `SpectatorGameScreen`, `PlayModeSelectScreen`, `ChallengeScreen`,
   `TournamentScreen`/`TournamentStandingsScreen`; wire types in `types/multiplayer.ts`; board rendering `components/ChessBoard.tsx`.
6. Rules sheet (the "how to play" sheet for the variant), time controls (picker is shared, see below), rejoin (`logic/activeGame.ts`).
Backend (`src/game/`): `types.ts` (flags), `<variant>.ts`, `RoomChessEngine.ts`, `matchmaking.ts` (queue key `timeControl|variant`),
`challenges.ts`, `rooms.ts`, `socketHandlers.ts`, `tournaments.ts`, `setupChessPairing.ts`; scripts `test-<variant>.mjs` (+ `test-multiplayer.mjs`, nightly fuzz).
Tests to COPY from the closest variant (`horde*`): `hordeEngine`, `hordeOracle`, `hordeBot`, `hordeGame`, `hordeOnline`, `horde.test.ts`
(frontend `logic/__tests__`) + `gameModes.test.ts`, `repetitionResults.test.ts`, `activeGame.test.ts` entries; backend `scripts/test-horde.mjs`.
Mutual exclusivity with ALL other variants (4-seat games included) is part of the checklist: CHECKLIST.md "new game variant".
Android: add the variant to the android-e2e smoke (`scripts/android/smoke.mjs`, TESTING.md §45-46).

### Other subsystems
- 4-seat engine (4 Player, 4P Giveaway, Chaturaji): `src/logic/fourPlayer/` (`index.ts`; geometry via `geometryOf(state.rules)`), screens
  `FourPlayer*Screen`, hooks `useFourPlayerOnlineGame` / `useFourPlayerClock`. Docs: FOUR_PLAYER_GIVEAWAY_SPEC.md, FOUR_PLAYER_ONLINE_SPEC.md,
  CHATURAJI_SPEC.md; TESTING.md §9, 11-17, 28-33.
- Crazy Bughouse (2v2, two boards): `src/logic/bughouse/` (+ `bughouse*.ts` UI helpers), screens `Bughouse*Screen`, `useBughouseOnlineGame`.
  Docs: BUGHOUSE_SPEC.md; TESTING.md §34-52; CHECKLIST.md §8-18.
- Online rooms / matchmaking: client `src/api/socket.ts`, `logic/onlineGames.ts`, `onlineRejoin.ts`, `MatchmakingScreen`; server `rooms.ts`,
  `matchmaking.ts`. Generic friend rooms (private code rooms): `FourPlayerRoomScreen`, `BughouseRoomScreen`, `logic/fourPlayerRoomUi.ts`,
  `bughouseFriendRoomUi.ts`, `friendCodeJoin.ts`; backend `friendRooms.ts`, `bughouseFriendRooms.ts`. TESTING.md §25, §48, §51.
- Time controls: ONE shared list `TIME_CONTROLS` in `src/logic/timeControls.ts` used by every mode's picker
  (`TimeControlSelectScreen`, `components/TimeControlSections.tsx`); CHECKLIST.md §22. Unlimited / Daily: TODO.md.
- Piece themes: `logic/pieceThemes.ts` (+ `pieceAssets.ts`, `src/data/pieceSets.json`, `components/Piece*.tsx`); CHECKLIST.md §14-15.
- Diagnostics: `More -> Diagnostics`; `logic/diagnosticLog.ts` (`logDiagnostic`), `screens/DiagnosticLogsScreen.tsx`; TESTING.md §4.
- Crash reporting: `logic/sentry.ts`. Known issues / open work: `TODO.md`.

## REPORT FORMAT (write it in Greek, <= 10 lines)
1. What changed. 2. Tests run (names + result). 3. Branch + commit + PR link. 4. Anything not done. 5. What to check on the phone.
No long logs, no per-file lists, no re-explaining the project.

## SLASH COMMANDS
`/new-variant <name>` builds one 2-player variant; `/fix-bug <description>` fixes one bug test-first (files in `.claude/commands/`).

## ROADMAP (in this order; each item is its own task)
- Group A (one variant per task): Racing Kings, Torpedo, Knightmate.
- B: From Position. C: Capablanca 10x8 (plan first, needs non-8x8 geometry). D: 3/5/6-player (plan first). E: Diddy Chess (plan first).
- Then: Learn tab + coach games; engine/bots for all variants (evaluate Fairy-Stockfish); analysis for all variants; rating from online games
  only; avatars; more achievements; voice moves; camera board.
- v2 backlog: Daily-online persistence (TODO.md), chained premoves, constructed positions / stuck in the browser suite,
  large-perf process death (UNPROVEN).
