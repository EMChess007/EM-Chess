# Testing & Quality Infrastructure — Frontend (EM-Chess)

This repo and its backend sibling (`chess-app-backend`) are tested together in places — several
backend test scripts import this repo's `src/logic/ChessEngine.ts` directly, since that's the
actual shared chess logic, not a reimplementation. See the backend's own `TESTING.md` for that
half; this document covers what's local to this repo.

## 4 Player Giveaway — roll-up (read this first for the whole feature)

**What it is.** The Antichess version of the 4-seat board: **Local, Bots and Online built together**, on the SAME engine as 4 Player Chess (`src/logic/fourPlayer/`), which dispatches on `state.rules.mode` (`'ffa'` | `'giveaway'`) at a fixed list of
touch points (header of `giveaway.ts`). Captures are mandatory for everyone (kings are ordinary pieces, no check, no castling, promotion to Q/R/B/N); a seat that loses its last piece wins at once, a seat to move with no legal move **wins**, a resigned / flagged
seat is eliminated and **cannot win** (its pieces stay as permanent walls that block squares and slide-rays and cannot be captured); the last active seat wins; at 1000 plies the fewest pieces win (ties shared). No points: seat cards and the result table count
pieces left. Online uses the same queue / room / lobby / spectate machinery as 4 Player Chess, with the lobby keyed by time control **and variant**; the wire stays backward compatible (absent `variant` = Free-for-All). Spec: `FOUR_PLAYER_GIVEAWAY_SPEC.md`;
the backend's half is in its own `TESTING.md` (same roll-up at its top).

**Where each workstream is documented**

| | What | Frontend | Backend |
|---|---|---|---|
| W1 | rules engine, wire core, FFA golden gate, generated mirror | §13 | §15 |
| W2 | the Giveaway bot, the variant through rooms / lobbies / handlers | §14 | §16 |
| W3 | every screen (menu card, local + online flow, variant-aware wording, D15 echo check) | §15 | §17 |
| W4 | real-socket e2e scenarios, nightly fuzz, CI wiring | §16 | §18 |
| W5 | this roll-up, the last mutation re-run on the final code, the online browser pass, the Resign-wording fix | §17 | §19 |

**Final numbers.** Frontend vitest suite: **817 tests in 41 files** (the 4 Player Chess Online close-out had 673); Giveaway-specific: 133 in 5 files (`fourPlayerGiveaway*.test.ts` ×4 and the FFA golden gate) plus 11 added to `annotationLifecycle.test.ts`. Backend scripts at the end of W5
(each count is the script's current total, so Giveaway additions are inside the earlier scripts' figures): mirror sync 114, engine parity 53, rooms 220, bots 160, matchmaking 74, handlers 61, **Giveaway 89**, real-socket e2e 287 (not re-run in W5: no server code changed since W4), plus the Giveaway section of the nightly fuzz (random, not counted).
**Mutation checks, every workstream's set re-run on the final code** (always on a disposable copy, never the real files; W4's mutants run a mutated copy as a REAL server): **192 planted, 187 killed, 5 equivalent, 0 real survivors.**

| | Planted | Killed | Equivalent | Survivors |
|---|---|---|---|---|
| W1 (52 rules / wire / client / presentation, 20 in the engine-parity script) | 72 | 72 | 0 | 0 |
| W2 (22 bot, 17 rooms / matchmaker / handlers, 8 mirrored bot) | 47 | 45 | 2 | 0 |
| W3 (screens, reducer and UI helpers) | 54 | 53 | 1 | 0 |
| W4 (12 against the real-socket e2e, 7 against the fuzz) | 19 | 17 | 2 | 0 |
| **Total** | **192** | **187** | **5** | **0** |

Every equivalent has an `EQUIVALENT-MUTANT NOTE` in the code. The ones in THIS repo: `giveawayBot.ts` — ties are not broken among the best (the tie pick and the noise are each redundant with the other: both only matter when two moves score the same);
`fourPlayerVariant.ts` — `rankSeats`'s trailing `a - b` (a stable sort already keeps seat order). The backend's three (the queue entry's own `variant` copy; the matchmaker's variant validation, which the handler's validator makes unreachable over a socket; the fuzz's cap-winner mutant, which needs a 1000-ply game) are in its roll-up.
Two honest details of the W5 fuzz run: "last standing at two seats" is only killed at the CI setting of 80 plies (games end by resignation there), and "the rejoin room state has no variant" was killed this time by the fuzz harness failing without printing a summary (the earlier run killed it with 3 named issues).

**What W5 found.** The online browser pass (below) found one real gap that no pure test had caught: the ONLINE Resign dialog said "its pieces stay on the board as dead blockers" in a Giveaway game (they are walls nobody can capture). The wording now comes from one helper, `describeResignWarning`, used by both game screens, with
tests that pin the exact four sentences and that neither screen carries its own copy.

**What was NOT verified (read this before calling it finished).** Browser-verified in W5 (the user's own logged-in tab + a scripted guest socket as the second human): the Giveaway queue screen, a live online game (a quiet move while a capture is mandatory is refused, a capture is accepted), leaving and returning, the Spectate tag, Resign and the result card.
**Not seen rendered:** the D15 refusal screen (needs a server that does not echo the variant, i.e. an older one), a server bot taking over a seat in the browser, and the 4 Player CHESS online screens after the variant changes (they are covered by the golden gate and the pure layers, not by eyes). The v1 limits are in `TODO.md` ("4 Player Giveaway: what it still leaves out").

**Merge order.** Same as 4 Player Chess Online: the backend's `ci.yml` tests against a branch of this repo only when the backend branch is named `paired/<x>` and this repo has the same `paired/<x>` (otherwise it uses this repo's default branch; rule and reasons in the backend's `TESTING.md` §20), so push / merge this repo's PR first (or together with the backend's). `fourPlayerGiveaway` is merged in both repos, frontend first.

## 4 Player Chess Online — roll-up (read this first for the whole feature)

**What it is.** Online Free-for-All 4 Player Chess, built on top of the local mode of §9. Players queue per time control (live Bullet/Blitz/Rapid only); four humans start a game at
once, and with at least two the server fills the empty seats with Amateur bots after 30 s. The server is the only authority: it validates every move with the engine, runs the four
clocks and broadcasts a numbered snapshot (`four_state`, `seq`) that every client adopts, so every seat and every spectator holds the identical position. A player who stays away for 45 s
is replaced by a bot and may retake the seat until the game ends; there is chat, spectating, an active-games list and premoves. Nothing is saved, rated or analysed (v1), and the 2-player
Online mode is unchanged apart from one fix (W0). Spec: `FOUR_PLAYER_ONLINE_SPEC.md`; the backend's half is in its own `TESTING.md` (same roll-up at its top).

**Where each workstream is documented** (the per-workstream sections stay as they are)

| | What | Section |
|---|---|---|
| W0 | 2-player "rejoin after the game ended" fix | frontend §10; backend "Rejoin after the game ended" |
| W1 | wire contract and the generated engine mirror | frontend §11; backend §10 |
| W2 | the room manager | backend §11 |
| W3 | bots, takeover, retake, abandonment | backend §12 |
| W4 | matchmaker and socket handlers | backend §13 |
| W5 | the client: queue, game and spectator screens, chat, premoves | frontend §12 |
| W6 | real-socket end-to-end test, nightly fuzz section, `FOUR_GRACE_MS` | backend §14 |
| W7 | this roll-up, the last mutation re-run on the final code | here and the backend roll-up |

**Final numbers, both repos.** Automated checks written for the feature: **1,085** — **188 vitest tests in this repo** (W0 14, W1 46, W5 128) and **897 script checks in the backend**
(W0 42, W1 142, W2 220, W3 160, W4 135, W6 198), plus the 4 Player section of the nightly fuzz (random, so not counted). The whole frontend suite is 673 tests in 36 files.
**Mutation checks, every workstream's set re-run on the final code** (always on a disposable copy of the repos, never the real files): **565 bugs planted, 543 killed, 22 equivalent, 0 survivors.**

| | Planted | Killed | Equivalent | Survivors |
|---|---|---|---|---|
| W0 (backend 13, client 15) | 28 | 27 | 1 | 0 |
| W1 (generator 38, wire 41, mirror-set guard 10, engine parity 18) | 107 | 107 | 0 | 0 |
| W2 | 65 | 63 | 2 | 0 |
| W3 | 68 | 62 | 6 | 0 |
| W4 | 83 | 79 | 4 | 0 |
| W5 | 188 | 180 | 8 | 0 |
| W6 (17 unit + 9 against a real server) | 26 | 25 | 1 | 0 |
| **Total** | **565** | **543** | **22** | **0** |

Every equivalent mutant is justified individually and, since W7, documented in the code next to the thing it is about (`EQUIVALENT-MUTANT NOTE` comments). The ones in THIS repo:
- W0 client — a `if (ack.ok === false)` branch added after `if (!ack.ok)`: dead code, identical behaviour.
- W5 (8; notes in `fourPlayerOnline.ts`, `fourPlayerOnlineSession.ts`, `fourPlayerOnlineUi.ts`): the log entry's seat (`move.seat` equals the previous snapshot's turn in any valid flow); `seq: payload.seq` vs `view.seq + 1`
  (equal in that branch); a null seat in `canMove` (the turn test refuses it anyway); an identical expression (`displayState`); a clock running for an inactive seat (the engine never leaves the turn there in an
  unfinished game); `readSnapshot`'s `typeof` fast path (the catch covers it); the session's belt-and-braces `moveAcked` (unreachable: every path to `view.seq >= ack.seq` already cleared `pending`);
  `fillInMs === null` (`Number.isFinite(null)` is already false).
The backend's 13 are listed in its roll-up.

**What the W7 re-run changed.** It was run so that nothing is taken on trust from an earlier pass. The W5 first-pass kills (120, made before a few hardening edits) were re-classified against the current code: all 188
re-run, 180 killed, 8 equivalent, 0 survivors. Six mutants of the older harnesses (W3 ×2, W4 ×4) had gone stale when W6 moved the `FOUR_*_MS` override rules into one shared helper; they were retargeted and now die.
The W6 mutants that had first been "killed" by an over-strict clock assertion were re-run on the final code: 9/9 killed, each by the check that names it.

**What was NOT verified (read this before calling it finished).** The two-tab browser pass of the player screens (queue, game, spectator, takeover, "Return to your game") that W5's known limits flagged as never having been seen
rendered was **not performed**: the project owner declined it for this workstream. Those screens are covered by the pure layers (reducer, session class against a fake socket, UI wording) and by source pins, and the real session class
was driven over real sockets against the real backend (17/17, W5), but nobody has looked at them on screen yet. Other deliberate v1 limits: rejoin token in memory only, no chat history after a reconnect, no private rooms,
no saved games / ratings, no Teams/Solo online, the bot promotion-nudge parity follow-up, and no game in the nightly fuzz ends by the engine itself within 80 plies (those endings are unit-tested).

**Merge order.** The backend's nightly fuzz imports the app's 4-seat engine from this repo's DEFAULT branch, and its CI pairs with a branch of this repo only for `paired/<x>` names (backend `TESTING.md` §20; it used to match any same-named branch): merge this repo's `fourPlayerOnline` first (or together with the backend's).

## 1. What runs on every commit/PR (`.github/workflows/ci.yml`)

Triggers on every push/PR to `master`:

1. `npm ci`
2. `npm run typecheck` (`tsc --noEmit`)
3. `npm test` (`vitest run`)

**This blocks merges only once branch protection is turned on** in this repo's GitHub settings —
`Settings → Branches → Branch protection rules → Require status checks to pass before merging`,
selecting the `test` job. That's a repo-admin action nothing in this codebase can do remotely.

The chess-engine-specific Fog of War regression suite (en passant, performance, redaction
history, visibility ground truth) runs from the **backend** repo's CI instead, since those scripts
also test the server's own twin implementation (`RoomChessEngine.ts`) side by side — see its
TESTING.md §3. Extended nightly fuzzing likewise lives there (backend TESTING.md §2).

## 2. Unit tests (`vitest`, `src/logic/__tests__/`)

Newly added this round — previously this repo had `tsc --noEmit` as its only automated check.
Pure-logic modules only (no React Native rendering needed, so no simulator/emulator/jsdom-for-RN
setup required):

- `chess960.test.ts` — the Chess960 starting-position generator satisfies its own stated rules
  (bishops on opposite-colored squares, king strictly between the rooks, correct piece counts)
  across 500 random seeds, not just "runs without throwing"; `expandFenRank`/`collapseFenRank`
  round-trip; `getChess960BackRankFiles` reads back exactly what a generated position used.
- `gameModes.test.ts` — `getGameOutcome`'s full priority ordering (Fog of War > King of the Hill
  / Three-Check > draw-by-agreement > resignation > timeout > ordinary chess.js status) as a
  decision table; `getThreeCheckCounts`/`getThreeCheckWinner` against hand-built SAN sequences,
  including that Undo (a shorter move list) is automatically correct with no separate bookkeeping;
  `computeCapturedMaterial`/`materialValue` against the standard point values; `getKingOfTheHillWinner`
  for each of the 4 center squares, both colors.
- `puzzles.test.ts` — the daily puzzle is deterministic per UTC calendar day (including right at a
  day boundary, regardless of the machine's local timezone) and varies across different days;
  `getRandomPuzzle`'s exclusion-set and theme-filter behavior, including its fallback once
  exclusions would otherwise exhaust the pool.
- `analysis.test.ts` — `evaluationToComparable`'s mate-vs-centipawn ordering (closer mate always
  beats farther mate, any mate-for-me beats any centipawn score however good); `evalToWinPercent`
  is monotonic and saturates within [0,100]; `evalToWhiteFillPercent` saturates to exactly 0/100
  for a real forced mate (not just "close"); evaluation formatting/perspective-flipping.

Run locally: `npm test` (or `npx vitest` for watch mode).

## 3. Crash/error reporting (Sentry)

`@sentry/react-native` is installed and wired in (`src/logic/sentry.ts`, called from `index.ts`
before the root component registers; `index.ts` also wraps the root component in `Sentry.wrap`
for render-time error capture). **It is currently a deliberate no-op** — `Sentry.init()` is called
with `enabled: !!dsn`, and no DSN is set, so nothing is captured or sent anywhere; the app behaves
exactly as before this was added.

`src/logic/diagnosticLog.ts`'s `logDiagnostic()` (see §4) now also forwards every call to
`Sentry.addBreadcrumb()` — a no-op under the same condition, but means any crash report that DOES
reach Sentry once configured will carry the same recent-app-state trail already visible via
`More → Diagnostics → Copy All`.

### Current setup (already done)

- **Sentry project**: organization `manoskapa`, project `em-chess`.
- **DSN** (`EXPO_PUBLIC_SENTRY_DSN`): in `.env.local` (gitignored) for local runs, and an EAS
  environment variable (plaintext — it's a public client key by design) for the `production`,
  `preview` and `development` environments.
- **Source maps** (`SENTRY_AUTH_TOKEN`): an organization auth token, in `.env.local` for local
  uploads and an EAS environment variable with **sensitive** visibility for all three environments.
  Never put it in `app.json`, `eas.json` or any committed file — it's only read at build/export
  time and is not bundled into the app.
- `app.json` carries the `@sentry/react-native/expo` plugin with the org/project slugs (not
  secret); `metro.config.js` uses `getSentryExpoConfig` so every bundle carries a debug ID that
  uploaded source maps are matched against.

### How source maps get uploaded

- **EAS native builds** (`eas build`): the Sentry plugin uploads automatically during the build,
  using the `SENTRY_AUTH_TOKEN` EAS variable. Nothing to run by hand.
- **Local export / OTA updates** (verified end to end this round):
  ```
  npx expo export --platform android --source-maps --output-dir dist-sentry-test
  npx sentry-expo-upload-sourcemaps dist-sentry-test      # needs SENTRY_AUTH_TOKEN in the environment
  ```
  Note `--source-maps` is required — `expo export` doesn't emit maps by default. A successful run
  prints a debug ID per bundle; Sentry's `artifact-lookup` API resolves that ID to the uploaded
  bundle, which is how this was confirmed.

### If the token ever needs rotating

Create a new organization token in Sentry (Settings → Developer Settings → Organization Tokens),
update `.env.local`, then `eas env:update` (or delete/re-create) `SENTRY_AUTH_TOKEN` with
**sensitive** visibility, and revoke the old token in Sentry.

## 4. Diagnostic logging (`More → Diagnostics` in-app)

Pre-existing infrastructure (`src/logic/diagnosticLog.ts`, `DiagnosticLogsScreen.tsx`) — a small
persisted ring buffer (100 entries), the only way to see a signed preview/production build's own
log without a cable + `adb logcat`. Extended this round to cover more of what item 4 of this
round's request asked for:

- **Fog of War, every mode** (`src/logic/fogOfWar.ts`'s `logFogOfWarPly`/`logFogOfWarGameStart`,
  wired into `LocalGameScreen.tsx`, `BotGameScreen.tsx`, `OnlineGameScreen.tsx`) — one line per
  ply: the real SAN/destination and, per relevant perspective, whether it was revealed and that
  perspective's full visibility set at that moment. Never shown in gameplay UI.
- **Multiplayer sync events** (`OnlineGameScreen.tsx`) — opponent disconnected/reconnected, own
  connection dropped/restored + rejoin result, and a server-rejected move (the exact "our own
  board thought this was legal, the server disagreed" desync case) with the fen it was computed
  from.
- **Engine timing** (`BotGameScreen.tsx`) — requested vs. actual think time for every bot move
  (a large gap would point at the WebView bridge, not the engine itself).

**Deliberately NOT routed through this ring buffer**: `ChessBoard.tsx`'s own per-tap touch-
resolution diagnostic (`[ChessBoard] tap -> ...`) stays `__DEV__`-console-only. It fires on every
single tap — far more often than anything else logged here — and would cycle the shared 100-entry
buffer out within a handful of moves, crowding out everything else. A build that genuinely needs
that specific log can still get it via a cable, same as before this round.

## 5. Subsystem coverage audit — what's covered, what's a known gap

| Subsystem | Coverage | Notes |
|---|---|---|
| Chess engine / move generation | Strong | See backend TESTING.md §3 — tests live there since they also cover the server's twin implementation, but they test THIS repo's `ChessEngine.ts` directly. |
| Fog of War (Local/Bot) | Strong | Same engine-level coverage, plus `test-fogOfWarRedactionHistory.mjs` (backend) mirrors this repo's own `useIncrementalFogRedaction` byte-for-byte. |
| Fog of War (Online) | Strong (server side) + the diagnostic logging above (client side) | See backend TESTING.md §4 for the one open, unconfirmed report. |
| Touch/gesture handling (`ChessBoard.tsx`) | **None automated** | No React Native test renderer is set up in this repo (would need `@testing-library/react-native` + a device/simulator or a mocked native layer) — the long-press/tap-vs-annotation logic fixed this round was verified by code-level reasoning and the existing `__DEV__` diagnostic, not an automated test. Known gap. |
| Clocks (`useChessClock.ts`) | **None automated** | A hook with timers — testable with `@testing-library/react`'s `renderHook` + fake timers, not set up here. Implicitly exercised by the backend's one E2E clock-timeout test, which covers the *server's* clock, not this hook's own increment/consume logic directly. |
| Puzzle mode | Good (pure logic) | `puzzles.test.ts` above. Puzzle *solving* UI (move validation against the puzzle's solution sequence) is screen-level, not covered. |
| Analysis mode | Partial | `analysis.test.ts` covers the evaluation/formatting math. `classifyMove`'s move-quality classification (brilliant/blunder/etc.) itself, and `gameSummary.ts`/`moveExplanations.ts`'s narrative generation, remain untested — a known gap; they're more integration-shaped (depend on real engine analysis lines) and would need either a mocked engine or a slower, closer-to-E2E test than this round's time budget covered. |
| Engine-vs-Engine, Spectator | **None** | Thin, mostly network/orchestration-driven screens with little pure logic of their own to unit-test; would need the same RN-renderer investment as touch/gesture above. |
| Draw by threefold repetition (every mode except Atomic) | **Not working** | Engines are rebuilt from FEN every render, so chess.js never sees repetitions — tracked in `TODO.md`, not fixed here. |
| Premoves, Undo | Partial | Exercised incidentally by the backend's E2E tests (premove resolution is tested as part of Online Fog of War flows) and by this session's own manual verification earlier, but no dedicated regression test for either as a standalone feature. |

As in the backend's audit: this is not equal-depth coverage everywhere, by design — the chess
engine and Fog of War got the deepest investment because that's where every bug this project has
actually found so far has lived. Gaps above are named, not hidden, so a future session knows
exactly where to look first if something in one of those areas turns out wrong.

## 6. Giveaway (Antichess) — scope, decisions and known limits

Added following CHECKLIST.md. Rules and the shared logic live in `src/logic/giveaway.ts`; the
engine-level pieces chess.js can't express (no castling, promotion to a king, no '+'/'#' in SAN)
sit behind `ChessEngine`'s opt-in `giveaway` option, so every other mode's move generation is
untouched.

**Scope (decided with the maintainer): Local + Bots only.** Online, Challenges, Tournaments and
Engine vs Engine do NOT offer Giveaway — the Online setup screens exclude it from their
`VariantSelector`, and there is deliberately no server-side implementation yet. CHECKLIST §4
(client/server parity tests) therefore doesn't apply until Online is added; when it is, it needs a
`RoomChessEngine` twin of the `giveaway` option plus mandatory-capture validation in
`rooms.ts`, with side-by-side tests (same shape as the Fog of War ones).

**Mutual exclusivity:** Giveaway cannot combine with any other variant (it has its own
`getGameOutcome` priority slot next to Fog of War, no check/checkmate/stalemate/draw concept).

**Decisions worth knowing**
- Castling is forbidden (standard Antichess; chess.js would otherwise offer it).
- A pawn may promote to a king (picker shows 5 pieces in Giveaway).
  A promoted king may be a SECOND king of that colour (own king still alive). chess.js refuses a second
  king when loading a FEN, which used to make it vanish on the next ply (screens/bots rebuild their engine
  from the FEN every move); `loadGiveawayFen` in `ChessEngine.ts` re-adds it, with regression tests in
  `giveaway.test.ts`. The server's `RoomChessEngine` does the same.
- Bots do NOT use Stockfish (`chooseGiveawayBotMove` in `bots.ts`): a 1-ply heuristic that scores a
  move by the material it hands the opponent, avoids moves that leave them with no legal move (that
  wins THEM the game), and uses ELO only as a "chance to play the best-scoring move" dial
  (~20% at 400 up to ~90% at 3000). It is a first version — how strong Giveaway bots should be is a
  product decision, not tuned yet.
- No hints, no premoves, no accuracy review. The post-game modal skips the Stockfish analysis and
  Game Review button, and saved PGNs carry `[Variant "Antichess"]` so Game History's "analyze"
  refuses to replay them under ordinary chess rules. Games don't move the player's chess rating or
  unlock rating-based achievements.

**Known limits**
- SAN disambiguation (e.g. "Nbd7" vs "Nd7") is computed by chess.js from its own legal-move list,
  which assumes ordinary king safety, so in rare positions a SAN in the move list/PGN could omit a
  disambiguator. Cosmetic only — the moves themselves come from the Giveaway generator.
- No React Native renderer in this project: board/screen wiring is guarded by source-level tests in
  `giveaway.test.ts`, and was verified by hand in the web build (Local and Bot), not on a device.

## 7. Atomic chess — scope, decisions and known limits

Added following CHECKLIST.md. Unlike Giveaway (a filter over chess.js's pseudo-legal moves), Atomic changes
legality itself, so its rules are a **self-contained implementation in `src/logic/atomic.ts`** (no chess.js
move generation): explosions, own-king-explosion = illegal, enemy-king-explosion = win, adjacent kings are
never in check, its own castling, SAN/'+'/'#', status, repetition. `ChessEngine` gets one opt-in option,
`atomic: true`, which routes `getLegalMoves`/`move`/`getStatus`/`isGameOver`/`getLegalMoveCount`/`getFen` to
`atomic.ts` (chess.js is kept only as the board model, reloaded from the new FEN after every move — the same
FEN-surgery approach as `performChess960Castle`). The option forces `skipValidation` (a finished game's FEN
has no king for the loser). With it off, no other mode's behaviour changes.

**Scope (decided with the maintainer): Local + Bots only**, mutually exclusive with every other variant. Online,
Challenges and Tournaments exclude it from their `VariantSelector`; Engine vs Engine has no Atomic entry; no
server twin exists, so CHECKLIST §4 parity doesn't apply until Online is added (it would need a server copy of
`atomic.ts` plus side-by-side tests).

**Decisions worth knowing**
- A king-exploded win has outcome reason `'atomic'`; ordinary mate/stalemate/draws inside Atomic keep
  `'checkmate'`/`'stalemate'`/`'draw'`. Draws: 50-move rule, stalemate, Atomic insufficient material and
  history-based threefold repetition (Atomic only — the app-wide repetition bug is tracked in `TODO.md`).
- Capture-promotions skip the picker and auto-pick a queen (the new piece explodes with the capturer, so every
  choice gives the same board); quiet promotions still ask.
- Every removed piece is a loss for its owner in the captured-pieces tray (`Move.exploded`); each row keeps the
  existing convention (it lists the opponent's losses).
- Explosion visuals: a flash plus fading ghosts of the removed pieces (`ChessBoard`), no new assets.
- Bots do NOT use Stockfish (`chooseAtomicBotMove` in `bots.ts`): shallow alpha-beta (1/2/3 plies by ELO, node
  budget) over Atomic's own legal moves with a material evaluation; blowing up the enemy king scores as a win and
  losing your own as a loss. ELO is also the chance of playing the searched move vs a random legal one
  (~20% at 400 up to ~90% at 3000). Fairy-Stockfish (WASM) was explicitly ruled out for this round.
- No hints, premoves, accuracy review or rating changes; saved PGNs carry `[Variant "Atomic"]` and both the
  Game History replay and PGN import refuse Atomic/Antichess PGNs instead of mis-analysing them.

**How it is tested**
- `atomic.test.ts` — every rule above on hand-written positions through the real `ChessEngine` API, FEN
  round-trips, a random-play consistency fuzz, a performance budget, and source-level wiring guards (including
  that `chessops` is never imported outside tests).
- `atomicOracle.test.ts` — differential tests against **chessops**'s `Atomic` class (a GPL-3.0 dev/test-only
  dependency, `devDependencies` only, never imported by shipped code): perft from the start position
  (depths 1–4, computed live from chessops — 20, 400, 8902, 197326 at the time of writing), five capture-heavy
  positions, ~6,500 plies of capture-biased random play comparing legal moves, resulting position, check/mate/
  stalemate/king-explosion state and SAN at every ply, and random small endgames for insufficient material (see Known limits).
- Mutation-checked: deliberately breaking pawn immunity in explosions makes 6 of the 9 oracle tests fail, and each
  insufficient-material mutation tried (dropping the bishop-colour or blocking-pawn conditions, loosening the piece
  caps) fails at least one test — the first attempt left two mutants alive, which is what led to the hand-written
  bishop/pawnitised cases. One mutant survives because it is equivalent (the opposite-coloured-bishops guard in the
  3-piece branch can never matter).
- `atomicBot.test.ts` — the bot always finds an immediate king explosion, never leaves its own king blastable when
  a safe move exists, ELO scales the chance of the best move, and bot-vs-bot games stay legal and terminate.
- `gameModes.test.ts` — `getGameOutcome`'s Atomic slot/priority and the exploded-piece tray accounting.

**Known limits**
- Insufficient material follows **lichess's scalachess** rule (`isAtomicInsufficientMaterial`), chosen over
  chessops's per-side rule after comparing them on ~71,000 positions. They disagree in three documented ways:
  closed pawn positions (scalachess: draw), a bare king vs K + 2+ same-coloured bishops (scalachess: draw), and
  K + 2 same-coloured bishops vs K + an opposite-coloured bishop (chessops: draw, scalachess plays on because a
  help-mate exists). scalachess is right in all three. `atomicOracle.test.ts` asserts exact agreement outside those
  categories and that each category really occurs. The rule was transcribed by hand from the Scala source (it was
  not executed), so the closed-position and bishop cases also have hand-written tests in `atomic.test.ts`.
- The tray shows kings never (a king in the blast ends the game and carries no material value).
- No React Native renderer in this project: the explosion animation and screen wiring are guarded by source-level
  tests and were verified by hand in the web build (Local and Bot), not on a device. The animation needs a running
  `requestAnimationFrame` loop, so it only plays while the app window is visible.

## 8. Duck Chess — scope, decisions and known limits

Added following CHECKLIST.md. Rules and helpers live in `src/logic/duckChess.ts`; the engine-level pieces sit behind
`ChessEngine`'s opt-in `duckChess`/`duckSquare` options (move generation drops every candidate the duck blocks).
The duck's square is NOT in the FEN, so every engine is built from `{ fen, duckSquare }`; the game state derives it
from `GameHistoryEntry.duckSquare` (one entry = one TURN: a regular move + the duck's new square, which is also what
makes Undo atomic). Mirrored on the server in `backend/src/game/duckChess.ts`.

**Rules as built.** No check/checkmate: the game ends the instant a king is CAPTURED (reason `duckChess`), the
capturing move needs no duck placement. One neutral duck blocks every piece (no landing on it; sliders and double pawn
steps cannot pass over it; castling is blocked when it sits on a square the king or rook crosses). A turn is a move,
then the duck on any OTHER empty square (it must move every turn); there is no duck before White's first move. A side
with no regular move at all is a draw (blockade).

**Scope (decided with the maintainer): Local + Bots + Online.** Online is a separate change on top of this one (the
server must understand the protocol first); until it lands the Online/Challenge/Tournament pickers exclude it.

**Decisions worth knowing**
- **Castling has no attack restriction** ("no check at all"): chess.js's generator withholds O-O/O-O-O when the king's
  squares are attacked, so `ChessEngine.generateRaw` adds back every castle whose right remains and whose squares are
  merely empty (and not under the duck). This deliberately differs from Fog of War, which still inherits chess.js's
  attack-based castling restriction.
- The duck-placement UI lives in `ChessBoard`: after a regular move it shows the post-move position with the legal
  duck squares highlighted and only calls `onMove` (with `move.duck`) once the duck is placed, so clocks, history and
  the opponent only ever see complete turns. Tapping the piece that just moved takes the move back.
- Notation is `e4 @g6` in the move list and last-move text; saved PGNs carry it as a comment (`1.e4 {@g6} d5 {@c4}`)
  with `[Variant "Duck"]`, and replay/import refuse such games. No hints, premoves, rating changes or Game Review.
- Bots do NOT use Stockfish (`chooseDuckBotMove`): a whole turn is chosen at once — take a king if possible, otherwise
  score a move by what it captures minus the most valuable thing the opponent could then capture AFTER the best duck
  placement, and put the duck where it minimises that biggest threat (random among ties, so the first placement is
  random). ELO is the chance of playing the searched turn vs a random one (~20% at 400 up to ~90% at 3000).

**How it is tested**
- `duckChess.test.ts` — the geometry helpers, every blocking rule through the engine, castling (duck and no attack
  restriction), en passant, no-check behaviour, placement squares, blockade, and a **friendly-blocker oracle**: random
  Duck games are checked at every ply for both colours against plain chess.js with the duck replaced by an ordinary piece
  of the side to move (castling compared against the plain rule, since chess.js restricts it by attack).
- `duckChessGame.test.ts` — whole turns as the screens commit them (first-turn duck, atomic Undo, king capture,
  `getGameOutcome`), saved-PGN tagging, replay/import refusal and source-level wiring guards.
- `duckBot.test.ts` — the bot takes a king, uses the duck to block the line to its own king, always names a legal duck
  square, scales with ELO, and bot-vs-bot games stay legal and terminate.
- Mutation-checked: eight deliberate breakages (slides over the duck, knight landing on it, castling across it, the duck
  staying put, no attack-free castling, check marks in SAN, a king capture needing a duck, the bot ignoring a king) each
  fail at least one test.

**Known limits**
- SAN disambiguation is computed by chess.js from its own legal-move list, which assumes ordinary king safety and ignores
  the duck, so in rare positions a move could carry an unnecessary disambiguator. Cosmetic only.
- The duck animation is a plain emoji on the square; the placement UI and the duck rendering were verified in the web
  build, not on a device.

## 9. 4 Player Chess (Free-for-All, Local + Bots) — scope, decisions and known limits

A genuinely new mode, not a variant flag: its own pure-TypeScript engine in `src/logic/fourPlayer/` (no React, no chess.js, no
`ChessEngine`; a test pins that the folder imports only from itself), its own `FourPlayerBoard` and `FourPlayerSeatStrip` components,
and two screens (`FourPlayerSetupScreen`, `FourPlayerGameScreen`). It surfaces as its own card on the Play menu, not in
`VariantSelector`. Branch `fourPlayerChess` (frontend only; no backend changes).

**Flow.** Play → 4 Player Chess → *seat setup* (per seat: Human, or Bot — tapping a bot opens the app's real "Select a Bot" roster
screen, `BotSelectScreen`, subtitled with the seat) → *time control* (the real `TimeControlSelectScreen`, Daily excluded: Bullet /
Blitz / Rapid / No time limit) → game. The seat choices travel in App's navigation state, so they survive the trip to the bot picker.
There are no preset shortcuts: the per-seat toggles cover them.

**Board.** 14 x 14 minus a 3 x 3 corner = 160 squares, stored as a flat 196-cell `Int8Array` mailbox (-1 off-board, 0 empty,
`seat * 16 + type` for pieces: types 1-6 the ordinary pieces, 7-10 a promoted queen / knight / bishop / rook, each of which MOVES as the piece it
became — `baseTypeOf` — but keeps its own code because its capture value and its UI marker depend on it). Neighbour/ray tables are precomputed and already stop at the cut corners,
so move generation has no bounds checks. State is immutable (`FourPlayerState`); Undo is a stack of states (with their clocks).

**Rules as built.** Movement is standard chess; pawns move/capture in their own seat's direction and double-step from their
starting line; a pawn reaching its seat's 8th rank (Red rank 8, Yellow rank 7, Blue file h, Green file g) PROMOTES, and the player chooses queen,
rook, bishop or knight: the generator emits one move per choice (queen first; the choice lives in bits 5-6 of `Move.flags`) and
`findLegalMove(state, seat, from, to, promotion = QUEEN)` picks one. This replaces the first pass's auto-queen (chess.com's Teams mode allows
under-promotion; its FFA notes do not say, so this is a deliberate decision, not a sourced rule). Bots choose like everything else they
choose: by their evaluation (so they queen unless a stalemate or a tactic says otherwise), and a weak bot's random moments can under-promote.
Legality generalises king safety: a move is legal iff no LIVE enemy seat attacks your king afterwards (double check from two seats
works). En passant is generic across directions (a Blue pawn can take a Red pawn) and lasts one applied move. Castling is per seat
(king two squares towards the rook, rook onto the crossed square). Kings are never captured.

**Elimination.** Checkmate is never stored as "pending": after every move the turn passes clockwise and the next seat is examined *at
that moment* (`advance` in `elimination.ts`). A seat with no legal move is checkmated (in check) or stalemated, eliminated on the spot,
and that **consumes its turn**. An eliminated seat's pieces turn dead (a status flip, no per-piece flag): they block and can be captured
for 0 points, but never move, capture or give check — except the king, which walks to a random empty square each time its turn comes
round and freezes (no points) when it cannot. Because nothing is decided until the mated seat's turn, a mate can dissolve (the checker
is captured), an intervening seat can deliver it (credit goes to the most recent mover among the attackers), and eliminating a seat can
lift checks it was giving. The game ends when at most one seat is active, when **no checkmate can happen any more** (every ACTIVE seat is a
bare king — `isDeadPosition`; deliberately strict, K+minor-piece endings are not declared dead), or at the ply cap (1000; and never beyond
`HARD_MAX_PLIES` = 5000, a ceiling no rules object can raise, so no bug in the rules above can make a game run on for ever); the highest score of
ALL FOUR seats wins (ties shared). Resigning and running out of time are the two voluntary/clock eliminations (no points for anyone).

**Clocks.** Four independent clocks (`fourPlayer/clock.ts`, a pure model; `useFourPlayerClock` is the timer around it — the 4-seat
counterpart of `useChessClock`, which is two-seat all the way down and was left untouched). Only the seat whose turn it is runs, and the
engine only ever hands the turn to an ACTIVE seat, so an eliminated seat's clock is simply never touched again — it freezes at its last
reading and is greyed — and a dead king's random walk costs nobody time (and earns no increment). A seat whose clock reaches 0 is
eliminated through the engine's `resign(..., 'timeout')` path: its pieces go dead, the turn passes on, and the game ends if it was the third
elimination. The increment goes to the seat that just moved. "No time limit" disables ticking entirely. Time is converted from timestamps
every 200 ms (so a flag fall is noticed within 0.2 s); Undo restores the clocks as they were. Bots use real clock time while they
"think" (200 ms in bullet, 450 ms otherwise).

**Scoring (simplified).** Capture values pawn 1, knight 3, bishop 5, rook 5, queen 9; a promoted piece is worth what it was promoted to (promoted
knight 3, bishop 5, rook 5) **except the promoted queen, which stays at 1** (chess.com's FFA table; it stops a pawn being farmed into nine points
— it is one line in `CAPTURE_POINTS` if that should change); dead pieces 0; checkmate +20 to
the credited seat; stalemate +20 to the stalemated seat and +10 to every other active seat. Not modelled: check-fork bonuses, draw
claims, points for mating a dead king.

**Bots (strength from ELO).** `fourPlayer/bot.ts`; no Stockfish (it cannot play this game). The bot a player picks is the roster bot
(Kiddo 400 … The Unbeatable 3000, from `BOT_PERSONALITIES`, not a copy); the engine folder stores only its ELO, and `botStrength(elo)` turns
that into play, in the same family as `chooseGiveawayBotMove` / `chooseAtomicBotMove` / … : `bestChance = 0.2 + 0.7 * clamp((elo - 400) / 2600)`
is the chance of playing the scored choice at all (otherwise a uniformly random legal move); `noise = 2.5 * (1 - strength)` is a random wobble
on every candidate's score (0 at 3000), so a weak bot's "best" move is only plausible; and an internal search tier layered under it:
*greedy* (ELO < 1000: points and material only — it hangs pieces and cannot see a mate), *careful* (1000-1799: plus hanging-piece, castling and
promotion terms and spotting a mate or stalemate of the next seat), *deep* (1800+: two ply against the next ACTIVE seat's worst reply,
including being mated by it). The old fixed Easy/Medium/Hard labels are gone. Measured over 16 rotated-seat games (ELO 400 / 1000 / 1800 /
3000 around the board): average scores about 15 / 34 / 45 / 103 and ELO 3000 won 14 of 16. Adjacent roster steps (e.g. 1400 vs 2200) overlap
within the noise of a sample that size: strength is genuinely monotonic and clearly separated across the roster, not a precise rating.
Not ELO-rated (4-player games are never rated).

**UI.** Fixed top-down cross board; `viewSeat` rotates it purely at render time (the sole human sits at the bottom in vs-bots games;
hotseat starts Red-at-bottom with a Rotate button). Tap a piece, tap a highlighted square (no drag-and-drop of pieces). Long-press-drag draws an **arrow** and a long press highlights a square, and
while the bots play the human can queue a **premove** — see "Arrows and premoves" below. **Piece themes:** the board
reads the same `useActivePieceTheme()` as the 2-player board. Themes only have white and black art (all three built-in sets, and uploads), so
there is no honest per-seat art to select; a themed piece is drawn as the theme's own image on a disc in the seat's colour, using the white set
on Red/Blue/Green and the black set on Yellow (`seatPieceImageKey`), grey and faded once the seat is out, with a small bar under a promoted
piece. Tinting the silhouettes was rejected because the art's detail is its dark outline and fill; a flat tint turns each piece into a blob.
The built-in Classic theme keeps its tinted glyphs. **Promotion choice:** a tap on a promotion square opens the shared `PromotionPicker` (the
modal that used to be inline in `ChessBoard.tsx`, extracted so both boards use one implementation), with the four pieces drawn for the seat that
owns the pawn. The **seat strip** is one
card per seat with, together: colour + name, the score (right), the remaining time in large type (red under 10 s while it is running; omitted
for "No time limit"), and who plays the seat (Human or the roster bot's name; "out" once eliminated, greyed). The seat to move has a border in
its colour. Squares are 26 px on a 390 px-wide phone (21 px on 360x640, up to 34 px on tablets/desktop); checked in the browser at both
sizes: no clipping or horizontal overflow, a flag fall played out (the idle human's 1-minute clock ran out, the seat went grey and the bots
carried on), and complete games played to the ranking card.

**Arrows and premoves** (ported from the 2-player board; the mechanics are shared, only the geometry and the extra seats differ).
*Spec.* The 4 Player board gets the same two features as classic chess: long-press-drag draws arrows (long press highlights a square), and a
player waiting for their turn can pick one of their own pieces and a destination, which is played automatically when the turn comes back if it is
still legal, and cancelled with a notice if it is not. Reused: the whole touch handler (now `components/useBoardGestures.ts`, extracted unchanged in
behaviour from `ChessBoard.tsx` and used by both boards), the SVG overlay `BoardAnnotations` (generalised from a fixed 8 x 8 to any grid, with an
optional stroke scale), `PromotionPicker` (for a promoting premove), and the premove rules themselves (`logic/premove.ts` + `logic/usePremove.ts`, lifted
from BotGameScreen/OnlineGameScreen). New: the cell <-> square mapping through the viewing seat (`fourPlayer/annotations.ts`), the engine side of a
premove (`fourPlayer/premove.ts`), and the board/screen wiring. Interaction with other features (written when 4-player games were local only; Online exists since §11-§12, and its board is this same component): there is no
Online/backend side; the 2-player board's behaviour must not change, which is why the gesture decision was moved into a pure, unit-tested module.
*What the 2-player implementation does (and the 4-player version keeps).* ONE premove at a time: queueing a new one REPLACES the old one (there is no
chain or queue), a Cancel button drops it, nothing is previewed or validated when it is queued (no legal-move dots while premoving), and when the turn
returns a fresh engine validates it: legal -> played as if the player had just moved; illegal -> dropped with "Premove was no longer legal —
cancelled." Arrows are wiped whenever the position changes.
*What 4 players forces to differ.*
- **Three seats move in between, and you can be eliminated.** `stepPremove` decides, in this order: game over -> drop silently; the seat is out
  -> drop with "Premove cancelled — you are out of the game."; not our turn yet -> wait; otherwise ask the engine. The engine is never asked while it is
  not the player's turn. Everything that can go stale in three moves (a blocked path, the piece captured, a new pin, a check you did not answer, a
  target that moved away — which simply makes it a quiet move) is judged by the same `findLegalMove` as a hand-made move.
- **A promoting premove asks for its piece when it is queued** (as the 2-player picker does), via the shared picker in the premoving seat's colour; if the
  square is blocked by the time it fires it is cancelled like any other.
- **Only a single human can premove** (vs bots). With several humans on one device "my turn" is ambiguous, so there is no premove (`premoveSeat`).
- **Arrows are stored as absolute squares, not screen cells.** The 2-player board stores the cells it was drawn on and gets away with it because it wipes
  them on every move and never rotates mid-position. This board has a Rotate button, and a different bottom seat per player, so an arrow is converted
  once with `gridToSquare(cell, viewSeat)` and drawn through the CURRENT rotation with `squareToGrid(square, viewSeat)`: after a Rotate it still joins the
  same two real squares (checked in the browser: the same arrow runs up the screen in Red's view and left along the right edge in Blue's). A gesture that
  starts or ends in one of the four cut corners draws nothing.
- **Taps now come from the gesture hook, not a Pressable per cell** (a Pressable would claim the touch before the board's responder could see a drag). The
  cells keep their accessibility labels and `onAccessibilityTap`, as the 2-player squares have no per-square press either.
- **Selection survives other seats' moves while premoving.** On the 2-player board a position change clears a half-made selection, which is harmless
  when the opponent moves once; here three bots move in a row (about 1.4 s) and would wipe the player's selection before they could tap the target. While
  premoving, the selection and an open promotion choice are kept as long as the piece is still the player's own.
- **Arrows and highlights follow ONE app-wide invariant** (`logic/annotationLifecycle.ts`, mirrored in CHECKLIST.md): they persist across turns — the
  player's own and every other seat's — and are cleared when a MOVE is played, by anyone, and at no other time. Not when "my turn starts", not while
  "waiting", not tied to whose turn it is at all (this replaced an earlier rule that wiped on the player's own turn). Each board names a *position epoch*
  — a value that changes iff the position changed — and clears through the single hook `useClearAnnotationsOnMove`: classic chess uses the FEN (it has no
  pass or skip, so the FEN changes exactly when a move is played or the position is replaced); 4 Player Chess uses `state.ply`, which is incremented in
  exactly one place (a move being applied) and therefore does NOT change on any turn that advances without a move: a seat resigning or timing out, a
  seat eliminated at its turn by `advance` (checkmate/stalemate found when its turn comes), a frozen seat skipped. An eliminated king's random walk IS a
  move (it changes the position), so it clears. Undo / stepping back / a new game / an Online resync REPLACE the position and clear too — a deliberate
  superset of "a move was played", since arrows on a position that is no longer shown would point at something else. Rotating the board never clears
  (annotations are stored as absolute squares). There is no separate "clear" gesture on either board; drawing a new arrow adds to the existing ones.
- **The "illegal premove" notice goes away once the player has moved** (the 2-player screens keep it until the next premove or cancel).
- A queued premove is dropped on Undo and New Game (it was made against a position that no longer exists), and its two squares are tinted while queued.
Not migrated: BotGameScreen / OnlineGameScreen still hold their own inline copy of the premove slot (same rules; `usePremove` is the shared form for any
new board). *Reusable for future 4-player variants:* nothing in `premove.ts`, `usePremove.ts`, `boardGestures.ts`, `useBoardGestures.ts` or
`BoardAnnotations` knows about this mode; the engine-side helpers read `state.rules` and legality always comes from `findLegalMove`, so a variant with other
promotion lines, scoring or elimination rules needs no change here.

**How it is tested** (all in `src/logic/__tests__/`)
- `fourPlayerBoard.test.ts` — 160 squares and exactly which corners are cut; the start position square by square for all four seats
  (including Blue/Green's king-queen swap); every queen on an even-parity square and every king on an odd one; rays stopping at the
  corners; render rotation; serialisation round-trips (including every promoted piece type, compared as piece codes, not just letters).
- `fourPlayerMoves.test.ts` — every piece in each seat's direction; double steps, promotion lines for all four seats, captures per
  direction, no king capture; castling for all 8 rook sides plus every refusal and every way to lose it; en passant (across axes,
  one-move window, own pawn, exposing the capturer's king); multi-seat check, pins, dead pieces never attacking; **a differential test
  against chess.js** on an 8x8 window (1000 random positions: legal moves and "in check" agree exactly); **promotion choice**: exactly four
  moves (Q R B N) for every seat, for pushes and captures; each choice puts its own promoted piece on the square; promoted pieces move and give
  check as the piece they became (and NOT as a queen); notation `=Q/=R/=B/=N`; capture values (promoted N 3, B 5, R 5, queen 1, ordinary queen 9,
  0 once the seat is out); the classic reason to under-promote, a verified position where queen or bishop stalemates and rook or knight does not.
- `fourPlayerElimination.test.ts` — the 8 named scenarios (a pending mate dissolves; an intervening mate credits the later attacker; an
  elimination lifts a check; the turn is consumed and a walled-in dead king freezes while a free one walks; one move mates two seats;
  stalemate scoring; the game ends mid-cycle and the highest score wins even if dead; dead pieces block, score 0 and never attack), plus
  resign, timeout, the third resignation, the ply cap, skipped frozen seats and turn order; the **dead position** (the capture that leaves
  every active seat a bare king ends the game on the spot, any other material or a promoted queen keeps it going, dead seats' material does not
  count, an out-of-turn elimination that removes the last live material ends it too); and the **hard ply ceiling** (a game nothing else can end
  stops exactly at the cap; `maxPlies` of Infinity still stops at `HARD_MAX_PLIES`).
- `fourPlayerClock.test.ts` — the clock integration: only the seat to move ticks (every seat); time accumulates and never goes negative;
  a disabled clock never ticks; a timeout eliminates through the engine's timeout path (no points, pieces dead, turn passed, nobody else's
  clock touched, flags at exactly zero, skips already-eliminated seats, the third timeout ends the game); **an eliminated seat's clock stays
  frozen** after a timeout and after a checkmate, through dead-king walks and many later rounds; increments go to the mover only and never to
  an eliminated seat; a whole simulated 60 s game checks every step that only the mover's clock changed and that eliminated seats never change
  again; clock construction from time controls.
- `fourPlayerBot.test.ts` — `botStrength` (the 0.2-0.9 family, clamped, monotonic over the whole roster, tier thresholds), the effect of the
  chosen ELO (how often the bot finds a free queen rises ~20% → ~90%; the noise term; **rotated-seat games where higher ELO scores more and
  ELO 3000 wins most**), legality at every strength, tier behaviour (greedy cannot see mate and takes a defended pawn, careful grabs bait that
  deep declines, careful/deep find mate in one, also past a dead seat), complete self-play games, a timing budget, and promotion choice (strong
  bots queen even when they pick late among ties; careful bots avoid a stalemating queen; weak bots' random branch can under-promote).
- `fourPlayerPremove.test.ts` — the 4-seat premove cases against the real engine: after Blue, Yellow and Green have moved the premove is still legal and is
  played; or it is cancelled because another seat blocked the path, captured the piece, pinned it to the king, gave check it does not answer, or blocked a
  promotion square; a target that was occupied and has emptied still fires as a quiet move; the seat was checkmated (its turn consumed) or resigned/timed
  out while waiting (notice) and the game ended (silent); the wait is "wait" after every one of the three intermediate moves; `stepPremove`'s order of
  decisions and that the engine is never asked out of turn; promotion premoves (piece carried, default queen, ignored for ordinary moves, one step from
  each seat's own line only); `canPremove`, `premoveSeat`, `describePremove`; the notice lifecycle.
- `fourPlayerAnnotations.test.ts` — screen cell <-> square is an exact bijection on the 160 squares for every viewing seat (and the 36 cut-corner cells are
  not squares), agrees with where the board component draws each square, puts the viewer's king row at the bottom; an arrow from a player's own king one
  step forward is the same absolute arrow for every seat; the same absolute arrow points right / up / left / down in views 0 / 1 / 2 / 3; after a Rotate an
  arrow ends on the cells where its pieces are now drawn, and rotates rigidly by a quarter per seat; corners and zero-length arrows draw nothing.
- `annotationLifecycle.test.ts` — the app-wide arrow invariant (cleared when a move is played, never because of a turn): the pure rule; every 4 Player
  no-move turn advance against the real engine (a seat resigning off turn, the seat to move resigning so the NEXT seat's turn starts, a flag falling on
  the seat to move through `clockTick`, a seat stalemated at its turn after the previous seat resigned — two turns pass — and a frozen seat skipped) leaves
  the epoch and so the arrows alone; every move by every seat, a dead king's walk, moves that eliminate seats, and Undo all change it; classic chess's FEN
  changes on every move and never on reads, an identical rebuilt position, or anything else; each board clears through the one shared hook, keyed to the
  FEN / `positionEpoch(state)`, in exactly one place, and `ply` is incremented in exactly one place in the engine.
- `boardGestures.test.ts` — what a finished touch means (stationary = tap even if held past the long-press time; the 10 px threshold is inclusive; an
  armed drag is an arrow, or a highlight on its own cell; an unarmed drag does nothing) and the pixel -> cell clamp for both grid sizes.
- `fourPlayerApp.test.ts` — seat setup, the roster glue (every roster bot maps to a controller and back to its name; the setup screen
  contains no copy of the roster, no tiers, no presets), the new flow in `App.tsx`, `TimeControlSelectScreen`/`BotSelectScreen` gaining only
  optional props, the seat-card contents, clock formatting, cell sizing, and a **regression pin for a bug found in the browser**: the bot
  effect must not depend on `apply`, which changes on every clock tick and would cancel the bot's timer forever (bots never moved); the piece
  theme wiring (the same hook as the 2-player board, every seat x piece type resolves to an image in every built-in theme, the white/black set per
  seat), the promotion flow (the shared picker, no hidden default pick, a half-made choice dropped when the position changes) and the result text.
- **Mutation-checked**: the first pass's 54 engine/bot mutants (corner geometry, pawn lines, rotation, piece order, point values, castling,
  every attack/legality rule, dead pieces, mate-credit order, scoring, game end, freezing, resign, the ply cap: 51 killed, 3 equivalent —
  the sign of a pawn's perpendicular, the type of the mover's own piece on its arrival square, and dead seats' material never being read), plus 34 new mutants for this
  pass (ELO formula and scale, noise, tier thresholds and what each tier sees, clock ticking/flooring/flagging/disabling/increments/timeout
  reason/initial times, clock formatting, setup defaults, roster glue). 27 were killed on the first run; 5 real gaps (noise never applied,
  greedy bots seeing mates, careful bots searching two ply, a clock ticking an inactive seat, the hotseat start seat) were closed with new
  tests, and 2 "survivors" were harness artifacts (the search string also matched a header comment) that were retargeted and then killed:
  **all 34 now die**. A third round for the follow-ups (promotion generation/choice/application, promoted-piece movement, check and values,
  the dead-position rule, the hard ceiling, themed piece keys): 36 mutants, 30 killed first time, 5 real gaps closed (the R/B notation letters
  were only checked as an unordered set; `isPromotedType` and promoted-rook serialisation were not pinned at the piece-code level; the bot's
  under-promotion values were not distinguished from a queen because ties picked the first candidate; the ceiling's size was not bounded) and
  1 genuinely equivalent (the legality scratch board promoting to a queen: it only asks whether the mover's own king is exposed, and the
  promoted piece is the mover's own, so only that it blocks matters, not what it is). **All non-equivalent mutants die.** The harness now runs
  each mutant with `--bail`, a wall-clock kill of the whole process tree and per-mutant progress output.

A fourth round for arrows and premoves (the premove step, the engine-side premove helpers, the rotation mapping, the gesture decision, the notice
  lifecycle): 39 mutants, 34 killed first time, 5 real gaps closed (a fixture where the game simply ended hid that an eliminated seat could premove; a
  pawn two steps from its line and another seat's pawn on a promotion step were untested; the notice lifecycle only existed inside the React hook, so it
  became a pure function) and 0 equivalent; the re-run of those plus new mutants of the extracted function: 8 of 8 killed. The hardened harness ran with no timeouts.
  Verified in the browser (not mockable): taps, a real e2-e4 and a premoved d2-d3 that fired after Blue, Yellow and Green had moved, an impossible premove that
  produced the "no longer legal" notice (and lost it after the next move), a selection that survived a bot's move, and an arrow + highlight that stay on the
  right squares through a Rotate. (An earlier version of this note claimed the long-press-drag release could not be verified in the browser pane and that the
  original ChessBoard "behaved identically under synthetic events". That was wrong: the identical behaviour WAS a bug, found in the next round — see
  "Arrows vanishing on release" below.)

**Arrows vanishing on release (found by a screen recording, fixed).** Symptom: in a timed 4 Player game, drawing an arrow showed a correct live preview
while dragging and then removed it the instant the finger lifted, with no move played. Cause, from instrumenting the touch path: the shared gesture hook
(carried over from ChessBoard, where a comment said "deliberately NOT memoized") created a NEW `PanResponder` on every render. A PanResponder keeps its
gesture state (`dx`, `dy`, `moveX`…) inside the instance, and the board re-renders constantly mid-drag — on every live-arrow move (it is state) and, in a
timed 4 Player game, every 200 ms clock tick — so every event was handled by a different instance (grant: #57, moves: #62, #63, #64, …) and the release by
one that had never seen a move (`dx = dy = moveX = 0`). `decideRelease` therefore saw a stationary touch and treated the drag as a tap, so the arrow was
never committed. It was NOT the screen-cell -> square mapping (the start cell was correct), and not the clear-on-move rule. Two consequences of the same
bug: a fast swipe over the board that never armed was also misread as a tap at the release cell (so a scroll could select or move a piece), and the
distance used to cancel an unarmed long press was wrong. Fix: ONE PanResponder per board (a lazy `useState` initializer) whose handlers read the latest
options through a ref. The classic board shares the hook, so it had the same latent bug and is fixed by the same change.
Tested in `useBoardGestures.test.ts`: the real react-native-web PanResponder driven by a tiny hook runtime that re-renders between events (and extra times,
like clock ticks): the arrow commits with two distinct cells on both grid sizes, the handlers object survives re-renders, taps / slow taps / unarmed drags /
highlights / terminated touches / the "armed arrows refuse to be interrupted" rule behave, and handlers and square size follow the latest render. Run against
the OLD hook the same file fails 5 of 12 (the arrow list is empty). Mutation: 10 mutants of the hook, 8 killed first time and 2 test gaps closed. Verified in
the browser on a timed game: the arrow persists after release while the clock keeps running, survives a Rotate (re-pointing correctly), survives a piece
selection, and is cleared by a played move; the same on a timed classic game. Note the highlight gesture needs a drag of more than 10 px that ends inside the
SAME square (the distance is net displacement, so wandering away and back is a tap): the original design, since a slow tap must never become an annotation.
  A fifth round for the annotation invariant: 15 mutants (the pure rule inverted / always / never; the 4 Player epoch as the turn, turn + active seats,
  the score or a constant; a move not advancing `ply`; an elimination or a bare turn advance WITH a `ply` increment; the hook always/never clearing; both
  boards keyed to the turn): 14 killed first time. The one survivor — the hook keeping the FIRST epoch instead of the latest, which only misbehaves when
  the position returns to its very first value (Undo to the start) — is React-hook behaviour with no renderer here, so it is pinned at source level
  (and the hook's redundant "did it change" guard is an equivalent mutant of the effect's own dependency list).

**Game length, the ply cap and the dead position.** Measured over 30 seeded bot games per matchup (ELO at all four seats, cap lifted to
5000): before the dead-position rule, games between weak and mid bots almost never finished: they trade every non-king piece (60 captures —
the whole non-king material — in every capped game) and then four bare kings shuffle until the cap. After it: all-400 median 556 plies
(95% done by 800), all-1200 median 484, all-2000 median 431, all-3000 median 269, a mixed 400/1000/1800/3000 table median 223; only 0-17 of 30
finish within 300 plies (0 / 3 / 5 / 17 / 23 for those five tables). So the original cap of 300 was too low for human + bots games: it mostly ended games by points
before they have run their natural course. Raising it is a one-number change (`FFA_RULES.maxPlies`); a value around 1000 would let ~95-100%
of these games end naturally. **Decision: `FFA_RULES.maxPlies` is now 1000** (the dead-position rule already ends games early when nothing more can happen, so the larger cap does not bring back dead time).

**Performance.** `legalMoves` from the start position takes ~0.07 ms (a promotion square adds three more moves; the dead-position scan is one
pass over 196 cells per turn handover). Bot decisions: ELO < 1000 ~0.3 ms, mid roster ~4 ms (max ~20 ms), 1800+
~16 ms mean (max ~260 ms); a complete four-strong-bot game computes in ~3-5 s in total. The clock timer touches one number per 200 ms and
re-renders only the strip and status. Nothing recomputes per render except the legal-move list for the position on screen (memoised).

**CHECKLIST sections, explicitly.** *Spec before code*: written and reviewed (first pass); the refinement pass was UI/flow, bot-strength and clock
work; the follow-up pass added under-promotion (a rules decision, see Rules as built), the dead-position end condition (found by measuring real
bot games) and piece themes. *Correctness*: above (elimination-by-timeout, clock-stops-on-elimination and only-current-seat-ticks have their own tests).
*Performance*: above. *Online/backend parity*: **N/A at the time of §9** (Online was added later: §11-§12 and the backend's TESTING.md §10-§13) — fully local, no backend change; the clock model is pure and serialisable, ready to
be mirrored with the rest of the engine when Online comes. *Cross-feature*: nothing else imports the folder; the only shared files touched are
`BotSelectScreen` and `TimeControlSelectScreen` (optional props, unchanged behaviour for their existing callers) and, in the follow-up pass,
`ChessBoard.tsx`, whose inline promotion modal moved verbatim into the shared `components/PromotionPicker.tsx` (same Modal, backdrop, labels and
styles; the existing source-pin test in `promotion.test.ts` was retargeted at the new component, not weakened, and the full suite is green) and, for arrows,
`ChessBoard.tsx`'s ~250 lines of gesture handling, which moved into the shared `useBoardGestures` hook (its decision logic into the pure `boardGestures.ts`)
and `BoardAnnotations.tsx` (new optional `rows`/`cols`/`scale`, defaults = the old look) — a refactor of live 2-player code, covered by the full suite, the
browser checks above and the parity check against the original; the 2-player
`useChessClock`/`bots.ts` are untouched — pinned by `fourPlayerApp.test.ts`. Analysis, PGN, game history, ratings, achievements, puzzles and
tournaments are untouched (4-player games are not saved). *Documentation*: doc comments at the top of every engine file; this section.
*Variant extras*: not combinable with any 2-player variant because it is not one.

**Known limits** — see TODO.md ("4 Player Chess: what it still leaves out"): Teams, Solo, Online, saved games/analysis, check-fork scoring,
drag input, repetition draws; clock granularity is 200 ms; Undo gives back the time spent on the undone moves.


## 10. Online: rejoin after the game ended — what the client does now

**The bug (2-player Online).** If a player's connection dropped while the game ended (checkmate, a flag, resignation, or the abandonment
their own absence caused), the server no longer had the room, answered `rejoin_game` with "not found", and `OnlineGameScreen` stayed on
"Reconnecting…" for ever without ever learning the result (and without the rating/achievement side effects of a finished game).

**The fix, client side.** The server (backend repo, see its TESTING.md "Rejoin after the game ended") now keeps a finished game's result
for 5 minutes and answers a late rejoin with a refusal that carries it: `{ ok: false, error, finished: true, gameOver }`. The screen sends
every rejoin answer through the pure `classifyRejoinAck` (`src/logic/onlineRejoin.ts`):
- **state** — the game is still on: resume exactly as before (position, clocks, move list rebuilt from the server).
- **finished** — show the result through the SAME `handleGameOver` a live `game_over` uses, and leave the "reconnecting" state. That
  handler is now idempotent (`gameOverHandledRef`), so rating and achievements run exactly once however the result arrives.
- **unavailable** — the server has no such game (too long ago, a restarted server): a new `connectionState` ('unavailable') shows
  "Game unavailable" and a plain banner, and the board is disabled, instead of an endless "Reconnecting…".
The `finished` flag is checked BEFORE `ok` because the finished answer is deliberately `ok: false`: app builds already in the wild only
know `ok` / `error` / `state`, and an `ok: true` answer without a `state` would crash them inside the socket callback. Old clients now see
a refusal, exactly as they always did.

**Tests.** `onlineRejoin.test.ts`: the classifier for every outcome (every end reason, a draw's null winner, refusals keep the server's
message, malformed answers are "unavailable", the finished answer is a refusal that a pre-change handler cannot mistake for success) and
source pins for the screen wiring (no React Native renderer here). `duckOnline.test.ts`'s one pin on the rejoin handler was retargeted from
`ack.state` to `outcome.state`. Mutation-checked (15 mutants: the classifier's branches and order, the idempotence guard, each screen branch;
14 killed, the 15th is a deliberate equivalent control). Many of the screen mutants are killed by source pins rather than behaviour — the
behaviour itself was verified in the browser against a running backend (below).

**Verified end to end, in a real browser against a real server** (a guest opponent over a socket; two temporary, reverted hooks — a local
session stand-in and a DOM event that closes the page's socket transport): the page was dropped, the opponent resigned 7 ms after the
disconnect, and on reconnecting the screen showed "You Won by Resignation" within about a second (before: hung); and with the backend
restarted under a live game the screen showed "Game unavailable" and the banner (before: hung). Not verified here: a physical-device
network drop, and a release build talking to the new server (covered by the old-client check in the backend script instead).

**A reconnect AFTER the result is already on screen (found in a review pass, fixed in a follow-up commit).** The reconnect listener stays
attached while the result sheet is showing. The first version still sent a `rejoin_game` then, and acted on whatever came back: with the
backend restarted (the finished record gone) the red "This game is no longer available…" banner appeared directly above "You Won by
Resignation" (reproduced in the browser on the first version); within the 5 minutes, a `finished` answer would also have snapped a move
the player was reviewing back to the live position (`setViewIndex(null)`). Now, once a result has been handled (`gameOverHandledRef`),
`handleReconnect` sends nothing and just clears "reconnecting", and an answer to a request that was already in flight is ignored too
(a live `game_over` that lands first wins; the guard sits after classifying and before any outcome is acted on, so `finished`,
`unavailable` and `state` are all covered). `onlineRejoin.test.ts` pins both guards and their order (3 mutants: either guard removed, or
the reconnect guard moved after the emit — all killed; pin-based, like the other screen mutants). The ref is never reset because the
screen holds ONE match's state (`gameOver`, the move list, ...) and App mounts it fresh for every match — every route into `onlineGame`
comes from a different screen; the comment on the ref says so. Verified in the browser, same scenario before/after: live resignation,
result shown, backend restarted, page reconnects — before: banner over the result; after: result untouched, no banner.

## 11. 4 Player Chess ONLINE — the wire contract and the mirrored file set (workstream W1)

Spec: `FOUR_PLAYER_ONLINE_SPEC.md`. W1 adds the shared protocol file and the guard around the engine files the server copies; **no screen,
hook or socket code changed and no existing file was modified** — Local 4 Player, 2-player Online and everything else behave exactly as before.

**`src/logic/fourPlayerWire.ts`** is the single source of truth for the `four_*` protocol: every payload, ack and event name, the limits both
sides enforce, and a few pure validators. The backend's `src/game/fourPlayerWire.ts` is GENERATED from it (backend repo, `npm run
sync:fourplayer`), so client and server cannot disagree on a field or a limit. It may import only the mirrored engine modules, extensionless.
Highlights: the unit of sync is `serialize(FourPlayerState)` plus the engine's own `GameEvent`s (already plain JSON, so nothing is converted);
`four_state` carries `seq` (+1 per state; the client ignores `seq <=` current and resyncs on a gap); there are **no draw events** (the engine
models no draws); a move payload has **no seat field** (the server uses the socket's own seat); `four_rejoin` on a finished game is a plain
success carrying `finished: true` + the result (a new event, so no released client needs the 2-player `ok: false` trick).

**Validators (the server's only defence against a hostile or buggy client, so strict by default):**
- `validateFourTimeControl`: whole seconds, 60-3600 initial, 0-30 increment; "No time limit", Daily, fractions, NaN, Infinity, strings are refused;
  only the two known fields are returned (extra and `__proto__` keys never reach the server logic).
- `validateFourMovePayload`: a valid room id; `from`/`to` must be **canonical names of playable squares**; promotion one of `q r b n`; legality is the engine's
  job. **Review finding:** the engine's `parseSquare` accepts a leading zero, so `e02`/`a04` parsed as `e2`/`a4` and would have been quietly
  normalised. Decision: refuse them (`isCanonicalSquareName`: `squareName(parseSquare(x)) === x`), not relax the test.
- `normalizeFourChatText` (trim, then cut to 500, refuse if empty — same rule as 2-player), `validateFourId`, `validateFourJoinQueue`.
- None of them throws on any input (a `Symbol`, an object whose `toString` throws, an array dressed with the right property names, 1000 random shapes).
- `clocksToWireMs` (one rounding rule for both sides) and `classifyFourRejoinAck` (the 4-player twin of `classifyRejoinAck`).

**`src/logic/fourPlayer/MIRRORED_TO_BACKEND.json`** lists the files the backend copies (the six engine modules + the wire file at the time; `giveaway.ts` joined later, see section 13). The owner of the
source owns the list. `fourPlayerMirrorSet.test.ts` fails here — not only later in the backend's CI — if an engine file imports a client-only
module, a package, uses `require`/`import()`, spells an extension, or if the list stops being exactly the closure of `bot`, `clock` and the wire file.

**Tests:** `fourPlayerWire.test.ts` (limits and every validator boundary; event surface — the runtime name lists must equal the typed
interfaces; engine events survive a JSON round trip, of every kind, in a game that is guaranteed to end; payload size measured and bounded) and
`fourPlayerMirrorSet.test.ts`. The generator and engine parity are tested in the backend repo (its TESTING.md §10).
**Mutation-checked:** wire validators/constants 41 mutants, **41/41 killed**; mirror-set guard 10 mutants, **10/10 killed**. First-pass survivors
were test gaps, not equivalents, and were closed: a promotion/label key that is always emitted (`toEqual` ignores `undefined` keys — the
value assertions are now `toStrictEqual`), arrays accepted as payloads, and the validator throwing on exotic values.
Two first-run test failures were bugs in the tests themselves (an unsorted expected list; a default parameter that turned `undefined` into `0`).

**Sizes:** a typical `four_state` is 700 bytes (ply 150); a 1000-entry move log is 28 KB.

## 12. 4 Player Chess ONLINE — the client (workstream W5)

Spec: `FOUR_PLAYER_ONLINE_SPEC.md` §8. W5 is the first workstream with UI: the Online entry, the queue, the game, spectating, chat, premoves. The server
(backend TESTING.md §11-§13) was already complete and is **unchanged**; this section is the frontend repo only.

**What changed, what is reused.** New: a pure reducer, a socket "session" class around it, a thin React hook, three screens, two components. Reused
unchanged: `FourPlayerBoard` (viewed from the player's own seat, premoves always on), `usePremove` + `resolvePremove`, `GameControlBar`,
`GameScreenBody`, `TimeControlSelectScreen` (with `excludeCategories: ['daily','unlimited']`), `appAlert`. Edited (small): `FourPlayerSeatStrip` (optional
`labels`; the local game still passes `seats` and gets its old text), `SpectateListScreen` (a 4 Player section), `PlayModeSelectScreen` (an Online button on the
4 Player card + an optional "Return to your game" link), `App.tsx` (four screens, one piece of in-memory state).

**Decisions confirmed before W5** (all built as decided): entry = a second "Online" button on the existing 4 Player card, behind the login gate; spectating
open to guests, in the existing Spectate list, with read-only chat and Rotate; premoves online always on; seat wording exactly "Bot (Amateur)" / name +
"bot playing" / "offline · Ns" grace countdown; Rotate as in the local game; rejoin token in memory only (like the 2-player screen); Back mid-game asks
"Leave the game? A bot takes your seat after 45s. You can return until the game ends."; after the game: result card + "Play again" + "Back to menu".

**Interpretation to note.** "You can return until the game ends" with "in-memory token, no persistence" means the app must remember the game while it is
running. It does, in one `useState` in `App.tsx` (`fourResume`: token + the match): leaving mid-game stores it, the 4 Player card then shows "Return to your
game ›", which reopens the screen with `resume: true` (rejoin at once). An app restart or a web refresh forgets it, exactly as the decision says.

### Design (`logic/fourPlayerOnline.ts`, `fourPlayerOnlineSession.ts`, `fourPlayerOnlineUi.ts`, `useFourPlayerOnlineGame.ts`)
- **Authority and a pending copy, side by side.** `view.state` / `seq` / `clocksMs` are the last adopted server snapshot and are never edited by a local move.
  A move the player makes becomes `view.pending` (the engine's `applyMoveRaw` copy, no randomness); the screen draws `displayState(view)`. A refusal
  therefore "rolls back" by dropping `pending` - there is no undo that could go wrong. Each pending move has an `id`, so a late refusal of an earlier move can
  never roll back a later one. The board is not interactive while a move is pending, a rejoin is in flight, the connection is down, or the game is over (`canMove`).
- **Ordering (the spec's rule).** `seq <= current` -> ignored and the view is returned *by reference unchanged* (equal = duplicate, smaller = late arrival);
  `seq == current + 1` -> adopted; `seq > current + 1` -> a gap: one `four_rejoin`, however many later states arrive while it is in flight. The reducer says
  when to send (`result.resync`), the caller never decides.
- **Untrusted server data.** Snapshots go through the engine's `deserialize` inside a try; clocks, seats and `four_game_over` are shape-checked before they can
  reach a render (a malformed `four_game_over` used to be accepted and would have crashed the status line - found by the tests, below). Nothing in any socket
  callback can throw out of the session (`guard`).
- **The session class** holds the reconnect/rejoin/spectate logic against a minimal `FourSocket` (Socket.IO's client satisfies it; the tests fake it) and
  injected effects (sound, haptics, clock, log), so the part that decides *when to send what* is unit-tested without a renderer. The hook is ~40 lines.
- **Reconnect.** Socket.IO `reconnect` -> `four_rejoin` (a spectator re-asks `four_spectate_game`). Answers: state -> adopt (and re-key the board); finished ->
  show the result (no haptic for a game that ended while away); not found / unreadable -> an explicit `unavailable` state with the reason, never "Reconnecting…"
  for ever. A move nobody answers (8 s) rolls back **and** re-reads the room, because the server may have applied it.
- **An older server** (no `four_*` handlers) never answers: the queue screen says so after 10 s; the Spectate list drops only its 4 Player section after 5 s.
- **Premove.** `isMyTurn` for the premove slot is "my turn *and* a move could really be sent now", so a premove is not spent on a reconnect or a pending move;
  it is resolved against the authority, and fired through the same path as a hand-made move.

### Tests (all in `src/logic/__tests__/`, 673 in the whole suite)
- `fourPlayerOnline.test.ts` (42) - the reducer, against a **server simulator built on the real engine** (`fourPlayerOnlineKit.ts`: the same `playMove` /
  `resign` / `serialize` the server's mirror runs, so every payload is exactly what `four_state` carries). The four tests the spec asked for are named and
  stand alone: **NAMED 1** out-of-order seq ignored and the view untouched (by reference); **NAMED 2** duplicate seq; **NAMED 3** a genuine gap sends exactly
  ONE `four_rejoin` however many later states arrive, the answer repairs the view, late stragglers are stale, a second gap may ask again; **NAMED 4** a refused
  optimistic move rolls back to exactly the last authoritative snapshot (same object, same text, same seq/clocks/log). Also: a 3-seed lockstep game with
  eliminations and dead-king walks (asserted to occur) compared with the server after every ply; gap-then-straggler; wrong room; after game over;
  unreadable snapshots / clocks / seq (10 shapes, one rejoin each); whole-room answers (older / equal / newer, pending kept or dropped); optimistic moves in
  every refusal situation; premoves (queued, waits, fired on the turn snapshot, cancelled when eliminated); clocks; malformed seats / game-over / events.
- `fourPlayerOnlineSession.test.ts` (44) - the session against a **fake socket**: listener symmetry; a normal game with sounds; refusal vs silence vs
  ack-before-state; gap / invalid -> exactly one rejoin; disconnect / reconnect / finished / unavailable / junk answers; resume; game over; seat updates; chat;
  resign; spectating (load, refusal, silence, reconnect, gap); hostile payloads and acks (+ a pseudo-random flood that must converge to the server's truth).
- `fourPlayerOnlineUi.test.ts` (24) - seat wording, status line, result table, leave wording, queue line, chat log, Spectate rows.
- `fourPlayerOnlineApp.test.ts` (18) - source pins for what has no renderer: every `four_*` string is a real event (the app's socket is untyped), every listener
  is removed, the server stays the only authority, the Online button is behind the login gate, presets vs the server's validator, spectators send nothing.
- `fourPlayerApp.test.ts`: one existing pin retargeted (the seat strip's player text) - same behaviour pinned, new spelling.

### Mutation checks (188 planted bugs in the reducer, the session and the UI-wording file)
Final disposition: **180 killed, 8 equivalent (each documented in the code beside it), 0 survivors** (the 188th, added late, re-creates the callback-guard defect below). The first pass found 21 survivors; the closed ones were real
test gaps (promotion letters on the wire; `canMove` ignoring game over / a final state / an eliminated seat; stale `lastMove` / `moveError` / seats after a newer
room answer; a late rejoin answer over a result already on screen; junk rejoin replies; callbacks after `stop()`; a chat sender seat out of range; two UI
wordings). The equivalents: the log entry's seat (`move.seat` equals the previous turn in any valid flow), `seq: payload.seq` vs `view.seq + 1` (equal in that
branch), a null seat in `canMove` (refused by the turn test anyway), an identical expression, the turn on an inactive seat (never in an unfinished game),
`readSnapshot`'s `typeof` fast path (the catch covers it), the session's belt-and-braces `moveAcked` (unreachable), `fillInMs === null` (`isFinite(null)` is false).
Honest limits: the 120 kills of the first pass were made before a few small hardening edits (the guard now survives a throwing logger); the final classification
of those 120 was not re-run - W7's last mutation pass should.
**The mutation harness was interrupted twice, and the second time taught the right design.** (1) A run was killed mid-mutant and left one mutation applied in
`fourPlayerOnlineSession.ts`; it was found by a read-only check (does each mutant's original text still exist?) and repaired. (2) The first fix - restore the
files from a signal handler (SIGINT/SIGTERM/exit) and keep a copy aside - was then put through a REAL interrupt (a Ctrl-C and a terminal close, in the app's
terminal panel, while a mutant was demonstrably applied). **It did not work:** the run loop is synchronous (`spawnSync`), so the JavaScript SIGINT handler never
got a turn and Ctrl-C was ignored, and closing the terminal kills the process outright, leaving the mutant on disk (caught again by the read-only check and
repaired from the copy). The handler-based restore was never a safety net on Windows. **The harness now never touches the real files:** it copies `src/` to a
work directory (linking `node_modules`), mutates and tests only the copy, and re-hashes the real files at the end. Re-tested the same way: Ctrl-C stops it, closing
the terminal stops it, and the real files were byte-identical at the moment of the interrupt and after. The read-only check stays as a cheap audit. Lesson for
any future harness here: do not rely on cleanup code surviving the interruption; make the interruption harmless.

### Performance
`applyFourState` over 605 real snapshots (one full bot game): total 43 ms, **mean 0.07 ms, p99 0.35 ms, max 1.9 ms** (three runs: 42.5-44.5 ms). The cost is the
engine's `deserialize` of one snapshot per state; a frame is 16 ms. The test asserts generous bounds (mean < 5 ms, max < 100 ms) so a slow CI machine does not flake.

### Real-network check (throwaway, not committed)
The real `FourOnlineSession` driven over real sockets against the real backend (`FOUR_FILL_MS=1500` on port 3101): two guest players queued, got one room and
different seats, played 4 moves each; a guest spectator joined; chat reached the other player and the spectator, a spectator's chat attempt sent nothing; one
player's connection was cut and the session showed "reconnecting", rejoined with its token and play continued; both resigned, the bots finished the game, and
all three clients ended with the same result, the same final position, the same `seq` (57), and the end announced once each. 17/17 checks passed. The
player *screens* need a logged-in account (the project rule is no account creation in browser tests), so the on-screen check of those is W7's.

### Bugs the tests found in this workstream (all fixed)
1. A rejoin answer that was not an object made the classifier throw inside the callback, leaving the "catching up" flag set for ever. Now an explicit `unavailable`.
2. A malformed `four_game_over` was accepted (a missing `winners` would have crashed the status line / result card). Now shape-checked.
3. The callback guard logged first, unprotected, so a logger that threw skipped the recovery that follows it (the resync flag stayed set). Each step is now independent; covered by its own test, `NAMED GUARD - with a logger that ALWAYS throws...`, which fails against the old guard (verified by re-introducing it as a mutant).

### Known limits (deliberate, v1)
Rejoin token in memory only. Chat history is not replayed after a reconnect (the server does not send it). The player screens are covered by pins and by the
pure layers, not by a rendered test (no React Native renderer); W7 verifies them in the browser. Only move/capture sounds. The badge line adds one small text
row to a seat card that carries one (a takeover or an offline seat); on the smallest phones the board budget is unchanged but that was not measured on a device.

## 13. 4 Player Giveaway — rules + wire core (workstream W1)

Spec: `FOUR_PLAYER_GIVEAWAY_SPEC.md`. W1 is the engine and the contract only: **no screen, hook, bot or server-room code changed**, so nothing a
player can see is different yet. Rules in one paragraph: the 4 Player board and armies, but you want to LOSE your pieces — captures are mandatory
(any capture of any other active seat; the mover picks), kings are ordinary pieces (capturable, no check, no castling), the first seat to lose its
last piece or to be stuck on its own turn wins and ends the game, resign / flag = eliminated (its pieces become permanent **walls**: not capturable,
never forcing, they block squares and slide-rays for good), last active seat wins, ply cap 1000 → fewest pieces win, ties shared, no draws, no points.

**Where it lives.** One discriminated rules object (`FourPlayerRules = FfaRules | GiveawayRules`, `GIVEAWAY_RULES`, `rulesFor(variant)`), pure helpers in
the new mirrored `fourPlayer/giveaway.ts` (mandatory-capture filter, piece counts, out-of-pieces, cap winners; it imports only types back, so
no cycle), and a `state.rules.mode === 'giveaway'` dispatch at a fixed, **listed** set of touch points (the header of `giveaway.ts` is the list):
`moves.ts` (`isCapturable`, castling, en passant against a wall, the capture filter replacing king safety, no points, captured-king bookkeeping) and
`elimination.ts` (eliminate → `frozen`, last standing, cap = fewest pieces, `advanceGiveaway`, outOfPieces right after the move, the mover re-checked
for "stuck" after an off-turn resignation). The snapshot text format is **unchanged** (castling field `0`, scores all zero) and the variant travels beside it.
Order of the end checks (each tested): outOfPieces → cap → pass the turn → stuck; a resignation: lastStanding → mover stuck.

**Wire (`fourPlayerWire.ts`, backward compatible).** `FourVariant`, `FourJoinQueuePayload.variant?` (omitted = `ffa`), `validateFourVariant` (strict:
anything but undefined/`ffa`/`giveaway` — including `null` — is refused), `variant?` on match-found / room state / active-game summary (**optional in the type**
because an older server never sends it; read with `fourVariantOf`; a client that asked for Giveaway must see it echoed — D15, built in W3), `FourReason`
now derived from the engine's result reasons (+ `abandoned`) with a compile-checked runtime list `FOUR_REASONS` that the client's game-over validator uses.
A join payload from an old client validates to exactly what it always did.

**Regression gate for 4 Player Chess.** `fourPlayerFfaGolden.test.ts` + `fourPlayerGoldenKit.ts` replay **48 seeded FFA games (4 929 steps) and 9 hand-built scenes**
(double mate, stalemate, cap, shuffle-to-cap, dead position, dead-king walk, both castles, mixed) and compare a SHA-256 of everything observable (position,
full legal-move list, bot choices, action, events) with `fixtures/fourPlayerFfaGolden.json`, **recorded from the engine before any Giveaway change**. Regenerate only
for a deliberate Chess rule change (`npx tsx src/logic/__tests__/fourPlayerGoldenKit.ts --record`). The random games alone hit 1 checkmate and no stalemate/cap/dead
position — hence the hand-built scenes. Every pre-existing 4 Player suite passes unchanged; the **only** existing test edited is the pinned file list in
`fourPlayerMirrorSet.test.ts` ("six engine modules" → seven, `giveaway.ts` joined).

**Tests** (`src/logic/__tests__/`, 75 new, 748 in the whole suite): `fourPlayerGiveaway.test.ts` — one hand-built position per rule (forced capture vs 1/2/3
seats, the rule is global not per piece, en passant as the only capture, king captured / captures a king / adjacent kings, no check, no castling even with every
right set, promotion Q/R/B/N + refused king + promoting by capture + capture-promotion of a last piece, walls for rook/bishop/queen/knight/king/pawn, walls
permanent, last piece → immediate win (and beats the cap on the cap ply, exactly one `gameOver`), stuck win, blocked-then-freed, eliminated seats skipped with 1/2/3 out,
off-turn resign, flag fall, the mover left stuck by a resignation, last standing, cap tie / eliminated can't win / hard ceiling, three scripted games with exact events) plus a
**property test**: 160 seeded random games (16 079 steps), after EVERY move or resignation the game is over **iff** an independently restated rule says so, with the right reason
and winners, no points, no castling rights, only active/frozen statuses, mixed capture/quiet lists impossible, pieces never created, walls never move, snapshot round trip exact.
Endings reached by the random games: `outOfPieces` 133, `stuck` 13, `lastStanding` 14 (the 400-ply cap is never reached randomly; it is covered by hand-built tests).
`fourPlayerGiveawayWire.test.ts` — variant validation (omitted/ffa/giveaway, 20 hostile values refused), old-client payloads unchanged, optional-on-read fields,
`FOUR_REASONS`, game-over payloads with the new reasons, no king promotion on the wire.

**Mutation checks (copy-based, `mutate-gw1.cjs`).** 52 planted bugs across `moves.ts`, `giveaway.ts`, `elimination.ts`, `state.ts`, the wire, the client validator and the
presentation text, including 5 Chess-side mutants for the golden gate: **52/52 killed**. First pass: 50 killed, 2 survived — both real test gaps, closed with named tests:
a frozen seat with no pieces must not "win" by being hollow (`seatOutOfPieces` status guard), and the cap-before-outOfPieces ordering was invisible because the later result
overwrote the earlier (now the test requires exactly one `gameOver` event). No equivalent mutants.

**Performance** (40 seeded random games, 588 positions, node, this machine): `legalMoves` under Giveaway mean **5.8 µs**, p99 13.5 µs (max 2.8 ms, a one-off JIT/GC
outlier) vs **16.1 µs / 52.3 µs** for the same positions under Chess rules — about 2.8× cheaper (no scratch board, no attack scans). A whole random game is ~100 plies and ~4 ms;
a long sparse game costs ~9 µs per ply including the turn-pass and stuck checks (a 1000-ply game would be ≈ 9 ms — extrapolated, random play never gets that far). The snapshot is
428 characters at the start (Chess 430): the format did not change.

**Cross-feature check.** 2-player Giveaway, Atomic, Duck, bots, analysis, PGN, history and puzzles share no file with this change (`git diff` touches only `src/logic/fourPlayer*`);
the 4 Player **Chess** bot is untouched and must not be called on a Giveaway state (it scores check and mates) — W2 adds the Giveaway bot and the server picks by variant.
Known W1 limits, by design: `readSnapshot` and the screens still read every snapshot with Chess rules (W3), and premove / annotation lifecycle for Giveaway are W3 items.

## 14. 4 Player Giveaway — the bot and the whole game loop in-process (workstream W2)

Spec: `FOUR_PLAYER_GIVEAWAY_SPEC.md` §6 and §7. W2 adds **one new file** to the engine — `src/logic/fourPlayer/giveawayBot.ts` (mirrored to the server) — and
threads the variant through the **server's** room manager, matchmaker and handlers (backend repo, its `TESTING.md` §16). **No screen, hook or client-socket code changed**:
the app still plays 4 Player Chess exactly as before; Giveaway has no entry point until W3.

**The bot** (`chooseGiveawayFourBotMove(state, elo, rng)`, same signature and **same ELO dial** as the Chess bot — `botStrength`: `bestChance`, `noise`, tiers). Not Stockfish
(it cannot play a 4-seat game). A Giveaway bot wants to LOSE pieces without handing anyone the game. The candidate list is already the legal set (the captures, when it has any), so
its choice is *which* capture or quiet move. Only the next ACTIVE seat answers before it moves again, so, as in the Chess bot, it looks at that one seat.
`score = exposure − handed-win penalty − victim penalty + noise`: **exposure** = the bot's own pieces the next seat could capture after the move, **one per piece** (a piece attacked twice counts once)
plus a tiny value tiebreak that stays far below one extra piece; the **greedy** tier (ELO < 1000) sees only that; the **careful** tier (ELO ≥ 1000) also subtracts 30 for a move that
wins the game for someone else (it takes a seat's **last piece**, or leaves the next seat with **no legal move** — stuck wins) and a small `4 / (1 + pieces the victim has left)` for
feeding a seat that is close to empty. **No deep tier** in v1 (decision D12), so the server's ELO clamp (1700) stays but never binds. It is a first version, on purpose.
`chooseBotMoveFor(state, elo, rng)` dispatches on `state.rules.mode` and is now the **default chooser of the server's room manager** — a Giveaway room can never get the Chess bot — while the
Chess path is move for move the old one (a test plays 60 Chess plies through both and compares).

**Tests** (`src/logic/__tests__/fourPlayerGiveawayBot.test.ts`, 21): always a legal move over 30 full games at mixed ELOs (1 500+ decisions); null for a seat with none; only captures when one exists;
careful won't take a last piece / won't leave the next seat stuck / prefers to be captured / prefers a richer victim; greedy does all of those blindly; a piece attacked twice counts once; the
**next ACTIVE seat** (not a frozen one) is the one that answers; a captured piece of ANOTHER seat is not my exposure (a blocker-pawn position where only the exposure of my own pawn makes the
difference); rook-over-pawn as a tiebreak and the documented order of the weights; the ELO dial (the right capture is chosen ~40 % at 400, ~75 % at 1500, ~95 % at 3000; measured bands asserted);
a close call is decided partly by the noise (56 % measured, 71 % if the noise were removed); no deep tier (ELO 3000 costs within a small factor of ELO 1000: nothing searches deeper); the dispatcher; and 40 whole bot-vs-bot games from the
start position at random ELO mixes. **Local game loop:** those bot games ARE the local game logic (the local screen is `playMove` + a chooser), with seeded replays — no screen exists yet.
Endings of those 40 games: `outOfPieces` 37, `stuck` 3, mean 99 plies.

**Mutation checks (copy-based, `mutate-gw2.cjs`).** Bot: 22 planted bugs; first pass 16 killed, 6 survived — four were real test gaps (exposure of another seat's piece; no value tiebreak; an
oversized value tiebreak; the dispatcher test used a position where both bots happen to agree) plus the noise (the first noise test was not sensitive to it), all closed with named tests above;
one is **equivalent and documented inline** (`EQUIVALENT-MUTANT NOTE` in `giveawayBot.ts`): taking the first best move instead of a random one among the best — the added noise already makes exact ties
vanishingly rare, so either randomiser alone is redundant. **21/22 killed + 1 equivalent.** Mirrored bot (parity script): 8 mutants, first pass 7 killed + 1 survivor (the stuck-next-seat penalty had no
constructed sweep), closed → **8/8**. Server plumbing: see the backend's `TESTING.md` §16.

**Performance.** One bot decision, over 1 204 decisions of 12 seeded games (ELOs 800 / 1200 / 1700 / 3000): **mean 42 µs, p99 291 µs, max 577 µs** — no search, a few `legalMoves` calls per candidate
(the Chess careful tier is ~20 ms worst case). A whole bot-vs-bot game is ~100 plies.

**Compatibility matrix (spec §7) — what is tested where.** New client + new server, Giveaway ✓ (server script §1–§6, over the handlers); new client **Chess** + new server ✓ (explicit `"ffa"`
and the unchanged Chess traffic: the one visible difference is a `variant: "ffa"` key on Chess payloads and on the active-games list rows — additive); **old client + new server** ✓ (a payload
with no `variant` gets a Chess room, never a Giveaway one); new client **Giveaway + old server** — the *client's* refusal when the echo is missing (D15) is built and tested in **W3**; it cannot be
tested server-side.

**Existing tests edited in W2 (all pinned lists / key sets, none relaxed):** `fourPlayerMirrorSet.test.ts` (the file list and the closure's entry points gain `giveawayBot.ts`).
Everything else, the whole frontend suite (769 tests), passes unchanged.

**Known W2 limits.** The Giveaway bot is a v1 heuristic: it does not plan to *be stuck* (which wins), does not look past the next seat, and has no opening/endgame knowledge; whether it is fun to play against
is for the browser pass (W5) and tuning. The screens still call the Chess bot (W3 swaps them to `chooseBotMoveFor`).

## 15. 4 Player Giveaway — every screen (workstream W3)

Spec: `FOUR_PLAYER_GIVEAWAY_SPEC.md` §8. W3 makes Giveaway playable end to end **in the app**: Local (hot-seat, with bots), and the Online client (queue, game, spectator, Spectate list). The server side
was W2; real-socket scenarios are W4.

**Entry.** Play menu → a new **4 Player Giveaway** card under the 4 Player Chess one (decision D13): **Local** (seat setup → bot picker → time control without Daily → game) and **Online** (login gate →
time control without Daily and "No time limit" → queue → game). The variant rides in `App.tsx`'s screen state exactly like the seat choices (`variant: FourVariant`, required in every 4-player screen state, so a
forgotten one is a compile error); every Chess entry passes `'ffa'`. "Play again" re-queues the SAME variant. `FourVariant` now lives in the engine (`fourPlayer/state.ts`, next to `rulesFor`) and the wire re-exports it,
so the local screens still know nothing of the wire or the socket (the old isolation pin holds).

**What differs on screen (all in the new pure `logic/fourPlayerVariant.ts`, unit-tested):** titles ("4 Player Giveaway · Antichess"); the setup intro and the one-line rule ("Captures are mandatory — lose all your pieces to win");
the seat card counts **pieces left** instead of points (`seatMetric`, read from `state.rules.mode`, so every board — local, online, spectator — does it with no extra plumbing); **no king-in-check highlight** (`checkedKingSquares`
returns none) and no "in check!" — instead the status says **"— must capture"** when the seat to move has a capture (a small extra to the spec: it explains why quiet moves are refused); the result table ranks the **winner first, then
the fewest pieces** (`rankSeats`); the result note names the seat ("Green lost its last piece and wins.", "Yellow had no legal move and wins.", "Everyone else resigned or ran out of time — Red wins.", "Move limit reached — fewest pieces
wins."); the resign dialog says the pieces stay as walls nobody can capture. The local game uses `initialState(rulesFor(variant))` (also for "New Game") and the dispatching bot `chooseBotMoveFor`. Premoves, arrows, Undo, Rotate, the promotion
picker and clocks are unchanged (they read legality from the engine): a premove made illegal by a forced capture is cancelled with the existing notice; Undo is the stack of immutable states.

**Online client.** The reducer's view carries `variant` (from `four_match_found` / the rejoin / spectate answers; absent = Chess) and reads **every** snapshot with that room's rules (`readSnapshot(text, rulesFor(view.variant))` — the
snapshot text has no rules in it); an answer that names another or an unknown variant is refused (`invalid`), an unknown variant builds no view. `describeStatus`, `resultRows` and `describeFourResultNote` take the variant (default Chess).
The Spectate list gives each 4-seat variant its own section ("4 Player Chess" keeps its header and keys; "4 Player Giveaway" is new); a game of a variant this client does not know (a newer server) is **left out** rather than
listed under the wrong name.
**Rollout safety (D15), built here:** `joinQueueRequest` sends `variant` **only for Giveaway** (a Chess join is byte-for-byte what released clients send); `checkMatchVariant` accepts a match only if `four_match_found` names the game that was
asked for (a missing field means Chess, so a Giveaway request answered without an echo is an older server that started a Chess game); on a refusal the queue screen shows "This server does not support 4 Player Giveaway yet…", **resigns the seat
it was just given** (so the table is not left waiting) and never hands over to the game screen.

**Tests** (`fourPlayerGiveawayScreens.test.ts` 35, plus 11 added to `annotationLifecycle.test.ts`; 815 in the whole frontend suite). Pure: wording, `seatMetric` / singular "1 piece left", `checkedKingSquares` (Chess marks the king; Giveaway none; an eliminated
seat's king never), `statusSuffix`, `rankSeats` (winner first, fewest next, a tied cap, ties by seat; Chess unchanged), the result notes, `resultRows`; the online view (a Giveaway match gives the Giveaway legal moves — the capture is forced — and the
same text read as Chess does not; no variant = Chess; unknown variant = no view; later snapshots, rejoin answers and the final snapshot all read with the room's rules; mismatched / missing / unknown variant on a rejoin refused);
**whole Giveaway games through the reducer** (6 seeded games, 300+ states, with an off-turn resignation: the client position equals the server's after every state); the optimistic move of a forced capture and its rollback on a refusal;
the status line ("Your move — must capture"; Chess "in check!" unchanged); the join request and the D15 echo matrix; the Spectate list; a premove cancelled by a forced capture; Undo across a forced capture; and **source pins** for
every screen (menu card and login gate, App routing, the local game, board, seat card, setup, queue, online game, spectator, result card) since there is no renderer. **Annotation lifecycle (CHECKLIST "Extra" box):** the mode's epoch is still `state.ply`;
Giveaway's no-move turn advances are pinned like Chess's — off-turn resign (frozen, never dead-king), the mover resigning, a flag fall, a frozen seat skipped, a resignation that leaves the seat to move STUCK (the game ends with no move: arrows survive),
last standing — and every move (including a forced capture and a whole bot game, where nothing ever moves unseen) clears.

**Existing tests edited (9 pins, none relaxed):** `fourPlayerApp.test.ts` (7) and `fourPlayerOnlineApp.test.ts` (2) assert the EXACT source of the Chess flow; Giveaway threads a `variant` through the same screens, so the strings gain it
(`variant: FourVariant` in the state union, `variant: 'ffa'` at the Chess entries, `chooseBotMoveFor`, `seatMetric`, `describeResultNote(game.result, variant)`). Each pin still protects what it did.

**Mutation checks (copy-based, `mutate-gw3.cjs`; the whole `src/` is copied, the real tree is only read).** 54 planted bugs in the new logic, the online reducer / UI helpers and the screens' wiring. First pass **49 killed, 4 survived**:
the rejoin answer was not checked for the rules it was read with (test gap → closed: the adopted position's legal moves), the result card's pass-through was unpinned (→ pinned), a game of an unknown variant was listed under "4 Player Chess"
(a **real design flaw**, fixed: unknown variants are left out, with a test), and one **equivalent, documented inline**: the explicit `a - b` tie-break in `rankSeats` repeats what a stable sort already does. **53/53 killable killed + 1 equivalent.**

**Performance.** The only new per-render work is `statusSuffix` (one `legalMoves` call for the seat to move; Giveaway's costs ~6 µs, see §13) and `seatMetric` (a 196-cell count); nothing is computed per frame beyond that.

**Browser check (the local flow, done against the existing Expo web dev server, read-only).** Play menu shows the new card; Local → setup (Giveaway title/intro/rule hint) → time control ("4 Player Giveaway · Antichess") → the game: seat cards read 16 pieces each; with
a capture available the status reads "Red to move — must capture"; a quiet move was **refused** and a capture accepted; the bots answered with legal forced captures and the cards dropped to 15. **Not checked in a browser:** anything Online (queue, game,
spectator, the D15 refusal) and the result card — they need a second human, a login and a running backend; that is W5's pass, with the login hand-off asked up front.

**Known limits.** "Return to your game" still sits on the 4 Player Chess card (one resume slot for both variants). The Giveaway setup screen shows the rule twice (intro + hint line) — kept because the spec lists the hint on the setup screen.

## 16. 4 Player Giveaway — real sockets and the nightly fuzz (workstream W4)

W4 changes only the backend repo's test scripts and workflows (its `TESTING.md` §18); **no app source changed**. The nightly fuzz's Giveaway clients use THIS repo's own engine (`src/logic/fourPlayer/state.ts`, `moves.ts`, `giveaway.ts`),
independently of the server's generated mirror, which is why the fuzz can catch a server that disagrees with the app: it caught every planted server bug it could reach (capture not mandatory, points as scores, a missing variant, a missing last-piece win, last standing at two seats).
The frontend suite and typecheck are unchanged (815 tests).

## 17. 4 Player Giveaway — close-out (workstream W5)

W5 adds no feature. It re-runs every workstream's mutation set on the final code, drives the online screens in a real browser, writes the roll-up at the top of this file and records what is still left out (`TODO.md`).

**Online browser pass (the one W7 of 4 Player Chess skipped).** The built-in browser pane, logged in by the project owner themselves (no account was created and no password was typed by the assistant), against the owner's own dev backend on `:3000`; the second human was a scripted
guest socket (not a second real account). Seen on screen: the Giveaway queue, a live online game, a quiet move **refused** while a capture was mandatory and a capture accepted, leaving the game and "Return to your game", the Spectate tag on the active-games list, Resign and the result card. One real finding: the online Resign dialog used the Chess wording ("dead blockers"). Fixed in `fourPlayerVariant.ts` (`describeResignWarning(variant, online)`, used by `FourPlayerGameScreen` and `FourPlayerOnlineGameScreen`), with two tests in `fourPlayerGiveawayScreens.test.ts`
(the four exact sentences; a source pin that neither screen keeps its own copy). The local dialog was re-checked in the pane after the fix. (The header "Online · W5Guest" seen during the pass was only the label of the scripted guest, not an app issue.)
**Not browser-verified:** the D15 refusal screen, a bot taking over in the browser, the 4 Player Chess (non-Giveaway) online screens.

**Mutation re-run on the final code** (`scratchpad/w5-final`, each on a disposable copy): W1 52/52 + parity 28/28 (20 W1 + 8 W2 mirrored-bot mutants); W2 bot 21 killed + 1 equivalent, plumbing 16 + 1; W3 53 + 1; W4 real-socket 11 + 1, fuzz 6 + 1. **187 killed, 5 equivalent, 0 survivors** — every one of the five is the documented
equivalent (names in the roll-up and in the code). Frontend vitest 817/817, `tsc --noEmit` clean in both repos (the untracked `_claude_harness.mts` / `_probe.mts` scratch files are not part of the project).

## 18. Spell Chess — scope, decisions and known limits

Branch pair `paired/spell-chess` (frontend + backend), landed on the refactored board of `master`. Rules and helpers: `src/logic/spellChess.ts` (its "shared rules block" is mirrored VERBATIM in `backend/src/game/spellChess.ts`, guarded by the backend's `test-spell.mjs`);
the engine pieces sit behind `ChessEngine`'s opt-in `spellChess` / `frozenSquares` / `jumpSquare` / `freezeEscapeActive` options. Local, Bots and Online were built together; the backend half is the backend's `TESTING.md` §21.

**Rules (from chess.com's help pages, see the header of `spellChess.ts`).** A turn is an OPTIONAL cast (at most one, before the move) and then the move. **Freeze**: 3x3 zone around any square (clipped at the edges); those pieces cannot move during the opponent's NEXT
turn only (a castling move is refused when its rook is frozen); casting it while in check waives the check when the zone covers EVERY checker. **Jump**: over one occupied square S, for the caster's own move and the opponent's reply, a rook / bishop / queen blocked only by S may capture
the first piece beyond it, the king included (a king capture ends the game, reason `spellChess`). 5 Freeze and 2 Jump charges each, a 3-own-turn cooldown per spell. Checkmate / stalemate / draw all still apply. The spell state (charges, cooldowns, pending effects) is NOT in the FEN: it travels
next to it, per ply in `GameHistoryEntry.spellState`, and the whole `SpellChessState` is echoed by the server on every payload.

**Mutually exclusive** with every other variant (Chess960, King of the Hill, Three-Check, Setup Chess, Fog of War, Giveaway, Atomic, Duck Chess, Horde, Crazyhouse): the `VariantSelector` is a single choice, and the server refuses `isSpellChess` combined with any other flag ("cannot be combined with another variant").
No Hint and **no premoves** in Spell Chess (online, against a bot and local): a queued move cannot carry a cast, and a possible cast changes which moves are legal after the opponent's reply. Stockfish plays the bot's MOVES (it has no concept of Freeze, so a frozen-piece suggestion falls back to
`getSpellChessLegalMoves`); the CAST is the heuristic `chooseSpellChessBotCast`, so the bot is ELO-calibrated for moves only.

**The turn context (the trap).** `spellTurnContext(state, mover, cast)` reads the frozen squares from the state BEFORE the cast (a frozen mover who casts their own Freeze must stay frozen), the jump square AFTER it (a Jump takes effect at once) and the zone cast THIS turn (only that zone may waive check).
It is used at every read site: `ChessBoard` (via its own derivation), `OnlineGameScreen` (opponent-move replay and the rejoin rebuild) and the server's `RoomManager.applyMove`. A mutant that reads the frozen squares after the cast is killed by the server test.

**Annotations / epoch (CHECKLIST).** The mode's position epoch is the FEN, like Classic: arrows and highlights are cleared when a move is played and at no other time. Entering cast mode, picking a Freeze/Jump target and cancelling the pending cast do NOT clear them (checked in the browser).

**Tests (frontend).** `spellChess.test.ts` (26: zone clipping, charges, cooldowns, lifetimes, the turn context, Jump captures, the check waiver, notation, plus a seeded random-game property test in `spellChessFreeze.test.ts`), `spellChessFreeze.test.ts` (13), `spellChessBot.test.ts` (8), `spellChessLayout.test.ts` (9, source pins for the bar and the zone preview),
`spellChessEngine.test.ts` (5: Jump charges, Freeze at 0 charges, engine-level Jump captures and Freeze waiver) and `spellChessOnline.test.ts` (14 source pins for what lives in screens: the rejoin restore, the spectator path, no premove, and that the Spell layer sits on the shared gesture hook and `PromotionPicker`, never the old inline PanResponder / Modal).

**Mutation check (CHECKLIST §2), on the merged code, on a copy.** 44 bugs planted in the rules, the engine, the board and the screens (zone shapes, expiry, charges, cooldowns, the turn-context trap, the check waiver, castling with a frozen rook, king capture, notation, the board's cast / preview / reset, the rejoin restore, opponent / ack /
refused-move / spectator state adoption, premove, the cast sent to the server). **First pass 40 killed, 4 survived — all four real test gaps**: casting Jump never cost a charge in any test; Freeze was never tried with 0 charges; the engine's own `getLegalMoves` / `move()` Jump captures and Freeze waiver were only exercised through helpers.
Closed by `spellChessEngine.test.ts`: **44/44 killed, 0 equivalents.**

**Browser (the built-in pane against the dev server, the real Bots screen, Kiddo).** 360x640 / 390x760 / 412x915: the board is the same size as Classic's (192 / 304 / 376 px) and, in every state (idle, Freeze mode with its hint, a pending Freeze with the 3x3 zone previewed live and the cancel chip, a cancelled cast, Jump mode, a Jump target on a pawn,
the bot thinking, after its reply), no element is clipped or overlaps another (measured from the DOM rectangles). Arrows persist through selecting a piece and while the bot thinks and are cleared by the move; the same in Classic, where a queued premove plays after the bot's reply and the spell bar is absent.

**Known limits.** No React Native renderer in this project (touch handling is verified in the web build, not on a device); Spell Chess is not offered in Tournaments (they exclude it in `TournamentScreen`) or Engine-vs-Engine. Not checked: the Analysis screen on a finished Spell game (the analysis engine knows nothing about spells; the saved PGN carries a `[Variant "Spell Chess"]` tag and `F@e4` / `J@d5` comment tags).
## 19. Horde — scope, decisions and known limits

Added following CHECKLIST.md. Rules and helpers live in `src/logic/horde.ts` (the shared rules block is mirrored VERBATIM in
`backend/src/game/horde.ts`, guarded by the backend's `test-horde.mjs`); the engine-level pieces sit behind `ChessEngine`'s
opt-in `horde` option. Local + Bots + Online were built together; Tournaments never offer it.

**Rules as built (chess.com's own documentation).** White has 36 pawns and NO king; Black has the normal army and keeps its
castling rights (start FEN `rnbqkbnr/pppppppp/8/1PP2PP1/PPPPPPPP/PPPPPPPP/PPPPPPPP/PPPPPPPP w kq - 0 1` — note the `kq`, not `-`:
only White's king is missing). White wins by checkmating Black's king; Black wins by capturing every White piece (reason `horde`);
stalemate is a DRAW for either side. En passant works normally; promotion is normal. The one real deviation: **White pawns on
rank 1 or 2 may double-step** — positional, not a first-move flag, so a pawn that went 1->2 may still go 2->4.

**Much less custom than Giveaway/Atomic/Duck Chess.** chess.js (loaded with skipValidation, which `horde` implies) already
tolerates a missing White king and plays every rule above except one move: it generates the rank-2 double step but not the
**rank-1 double step**, which `ChessEngine` synthesizes through chess.js's unvalidated `_makeMove` (BIG_PAWN flag, so the en
passant square is recorded). It also gets two things WRONG, which `ChessEngine` overrides: **insufficient material** (chess.js
calls "Black king + one White bishop" king-versus-king, a draw — in Horde Black must capture it, so insufficient material never
ends a Horde game) and **"White has nothing left"** (no moves, no check = "stalemate" to chess.js; it is Black's WIN, decided by
`getHordeWinnerFromFen` first — `getGameOutcome` takes it as its 13th argument, in the top tier ABOVE `chessStatus`).

**Decisions worth knowing**
- **En passant after a rank-1 double step is allowed** (`HORDE_FIRST_RANK_DOUBLE_STEP_ALLOWS_EN_PASSANT`). chess.com says only "en
  passant captures are allowed" and does not single this case out; Lichess (and the chessops oracle) forbids it for this one case.
  `hordeOracle.test.ts` allows exactly that divergence and nothing else. Flip the constant in both repos to follow Lichess.
- Bots do NOT use Stockfish (`chooseHordeBotMove`): it cannot be given a position with no White king. One heuristic plays EITHER
  side: pass 1 scores every move (captures, promotion gain, White pawn advances, checks; checkmate / taking the last piece are
  decisive), pass 2 subtracts the opponent's best reply and any mate-in-one for the best eight. ELO is the chance of playing
  that choice vs a random move (~20% at 400 to ~90% at 3000). Hence the rating guard excludes Horde (unlike Spell Chess).
- No hints, premoves, rating changes or Game Review (Stockfish cannot analyse a kingless position). The bot list shows "Horde bot"
  and offers no custom UCI engines. Saved PGNs get `[Variant "Horde"]` plus SetUp/FEN; replay and import refuse them.
- Not combinable with any other variant (mutual exclusivity is enforced by the single-select `GameVariant` and, on the server,
  `conflictingVariantError`).

**How it is tested**
- `horde.test.ts` — start position, no-king behaviour, the positional double step (rank 1 / rank 2 / blocked / not rank 3 / 1->2->4),
  en passant, promotion, every way a game ends, FEN reload, undo, and a 90-ply performance check.
- `hordeOracle.test.ts` — **differential tests against chessops's `Horde`** (dev-only, GPL): legal moves, resulting positions and
  endings agree over random games and hand-picked positions; the one en passant divergence above is pinned.
- `hordeBot.test.ts`, `hordeGame.test.ts`, `hordeOnline.test.ts`, the Horde cases in `gameModes.test.ts` — the bot (legal moves, mate in
  one beats winning a queen, takes the last piece, ELO dial, self-play, cost), wiring guards, wire flags, rejoin replay.
- Mutation-checked: nine deliberate breakages (no rank-1 double step, a blocker on rank 2 ignored, stalemate as a loss,
  insufficient material trusted, no skipValidation, "nothing left" ignored, winner checked below the draw status, the bot ignoring
  mate) each fail at least one test; one more (a double step also offered from rank 3) is an equivalent mutant — the helper
  checks the pawn's own square, so it can never fire — and one test gap (the bot's mate value) was found and closed.

**Known limits**
- Threefold repetition is never detected (every screen rebuilds the engine from the FEN; see TODO.md).
- The Horde bot is a shallow heuristic: it is not trying to be strong, and long endgames (a few White pieces against Black's
  army) can shuffle until the move cap.
