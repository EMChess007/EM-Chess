# Testing & Quality Infrastructure — Frontend (EM-Chess)

This repo and its backend sibling (`chess-app-backend`) are tested together in places — several
backend test scripts import this repo's `src/logic/ChessEngine.ts` directly, since that's the
actual shared chess logic, not a reimplementation. See the backend's own `TESTING.md` for that
half; this document covers what's local to this repo.

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

## 9. Horde — scope, decisions and known limits

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

## 10. Crazyhouse — scope, decisions and known limits

Added following CHECKLIST.md. Rules and helpers live in `src/logic/crazyhouse.ts` (the shared rules block is mirrored VERBATIM in
`backend/src/game/crazyhouse.ts`, guarded by the backend's `test-crazyhouse.mjs`); the engine-level pieces sit behind `ChessEngine`'s
opt-in `crazyhouse` option. Local + Bots + Online were built together; Tournaments never offer it.

**Rules as built (chess.com's own documentation).** A captured piece changes colour and goes into the CAPTURER's reserve. A turn is
ONE action: an ordinary move, or a DROP of a reserve piece on any empty square (pawns never on rank 1 or 8). A captured PROMOTED piece
goes into the reserve as a PAWN. Drops may give check or mate, and a drop may block a check. Notation is `N@f3` (`P@e5` for a pawn).
Win/draw conditions are the standard ones — but a side is only checkmated/stalemated if it also has NO legal drop (a drop can interpose),
and insufficient material never ends a game (a reserve can still be dropped; chess.js's `isDraw()` is never consulted). The fifty-move
rule stays and a drop resets the halfmove clock.

**State that is not in the FEN.** The reserves and "which pieces are promoted" travel BESIDE the position as a `CrazyhouseState`, the way
Duck Chess's duck does: `ChessEngine` takes it as an option and updates it on every `move()`/`drop()`; each move carries the state
AFTER it (`move.crazyhouse`), the screens store that on `GameHistoryEntry.crazyhouse` (one per ply), and the engine is rebuilt from
`(fen, state)` each ply. Undo, position review and analysis therefore restore reserves for free. The shared helpers `latestPlyState` /
`plyStateAtView` (`perPlyState.ts`) answer "what is it now" / "what was it in the position displayed" once, instead of re-deriving it
per screen (Duck Chess and Spell Chess still carry their own inline copies of that logic; they behave the same and could migrate).
We did NOT use the "Q~" FEN suffix other implementations print: chess.js cannot parse it, and the side-channel gets Undo/Redo right
without touching the FEN everything else already understands.

**Promoted-piece tracking (the one new mechanism).** `promoted` is the set of SQUARES holding a piece that started as a pawn. A pawn
promoting marks its target; a marked piece that moves takes the mark with it; a capture ON a marked square banks a pawn and clears the
mark; castling carries a marked rook; en passant captures on a different square than the landing one (the victim is a pawn, so it is
never marked). Dropped pieces are never marked.

**Drop legality needs no search.** Placing a piece can never expose your own king (it only adds a blocker), so a drop is legal on any
empty square when not in check; with exactly one SLIDING checker only the squares between it and the king; against a knight/pawn check
or a double check, none. `crazyhouseCheckInfo` / `legalDropSquares` implement that; chessops (and a chess.js brute force) confirm it.

**Decisions worth knowing**
- **`gameResult.ts` needs no new slot.** Crazyhouse has no result of its own: checkmate/stalemate/draw come in through `chessStatus`
  (the engine's `getStatus()` is drop-aware), unlike Horde, whose extinction win chess.js misreads as a stalemate. Pinned in `gameModes.test.ts`.
- Castling rights are FEN flags: a rook captured and re-dropped on its home square does NOT restore them (tested at engine and server
  level). A dropped pawn never creates an en passant square, and a drop clears a stale one.
- **One tap-pair per drop** (not Duck Chess's two-step turn): pick a piece in the reserve tray, tap a highlighted square, done. The
  tray is a single fixed-height row under the board (White left, Black right), so the board keeps full size; the Spell Chess compact
  spacing is reused. Promoted pieces show a small red `~`. With many piece types on both sides the row cannot wrap, so it measures
  its content and scales down to fit the screen (floor 0.6): the extreme — all five types held by both sides — was checked in the
  browser at 390x760 and 360x640 and fits inside the gutters (a first version clipped it on both sides; found by that check).
- Bots do NOT use Stockfish (`chooseCrazyhouseBotMove`): it has no concept of drops or a reserve. One heuristic picks a whole turn
  (move or drop): pass 1 scores material incl. reserves (a promoted victim is worth a pawn), promotion/check bonuses and mate/stalemate;
  pass 2 subtracts the opponent's best capture and any mate-in-one reply (including a mating DROP beside the bot's king) for the best six.
  ELO is the chance of playing that choice vs a random one (~20% at 400, ~90% at 3000). Average decision ~120 ms (max ~400 ms) in self-play.
  Hence the rating guard excludes Crazyhouse (unlike Spell Chess).
- No hints, premoves, rating changes or Game Review. The bot list shows "Crazyhouse bot" and offers no custom UCI engines.
- **PGN: export yes, import refused.** Saved games get `[Variant "Crazyhouse"]` and write drops as `P@e5`; replay (analysis) and import
  refuse them, because a replay would lose the reserves and chess.js cannot read `@`. `parsePgn` now reads the `[Variant]` tag from the
  raw text too, so the refusal is clear instead of "could not parse the moves" (chess.js throws before setting any header on `P@e5`).
- Not combinable with any other variant (single-select `GameVariant`; on the server, `conflictingVariantError`).

**How it is tested**
- `crazyhouse.test.ts` — reserve banking, promoted tracking incl. a multi-level promote → capture → drop → promote → capture chain, drop
  squares, the pawn-rank rule, self-check cases (+ a brute force against chess.js), en passant and castling-flag cases, mate/stalemate
  with and without drops, FEN reload / undo / redo with non-empty reserves, notation, and a performance check over a long game.
- `crazyhouseOracle.test.ts` — **differential tests against chessops's `Crazyhouse`** (dev-only, GPL): moves, drops, reserves, promoted
  squares, castling flags and endings agree over random games biased toward promotions and promoted captures. Documented divergence:
  chessops ends some insufficient-material positions that this app (like chess.com's clock rules) plays on.
- `crazyhouseBot.test.ts`, `crazyhouseGame.test.ts`, `crazyhouseOnline.test.ts`, the Crazyhouse cases in `gameModes.test.ts` — the bot
  (legal turns, mate in one by move and by drop, back-rank safety against a mating drop, self-play, cost with 100+ candidate drops),
  wiring guards, per-ply state restore, PGN tagging/refusal, wire flags, rejoin/opponent_move replay and revert.
- Mutation-checked (43 mutants over the rules block and the engine, each deliberately breaking one rule: promoted demotion and
  mark carrying, reserve credit, every drop-legality condition, the pawn-rank rule, check geometry for each piece type, drop-aware
  status, the fifty-move rule, castling and en passant handling). 35 were killed on the first run. Two genuine gaps were found and
  closed with new tests (state clones sharing the promoted array; castling not carrying a promoted rook); every other survivor is an
  equivalent mutant: a double check is excluded twice over (`crazyhouseCheckInfo` AND `legalDropSquares`); a king can never be banked;
  an en passant victim is always a pawn, which is never marked, so its square is irrelevant to the banking rule; and `drop()`'s explicit
  "clear the en passant square" is redundant with chess.js's own `put()`, which already clears it (the test stays as a guard in case
  that library behaviour changes). The server side was mutation-checked separately, see the backend's TESTING.md §11.

**Known limits**
- Threefold repetition is never detected (every screen rebuilds the engine from the FEN; see TODO.md).
- The bot is a shallow heuristic (a one-reply look-ahead): it plays legal, sensible Crazyhouse but is not trying to be strong, and it
  does not plan sacrifices that bank pieces.
- Analysis of a Crazyhouse game is unavailable (Stockfish cannot read a reserve); history shows the saved PGN with `P@e5`-style drops.
