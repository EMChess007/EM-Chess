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

## 9. 4 Player Chess (Free-for-All, Local + Bots) — scope, decisions and known limits

A genuinely new mode, not a variant flag: its own pure-TypeScript engine in `src/logic/fourPlayer/` (no React, no chess.js, no
`ChessEngine`; a test pins that the folder imports only from itself), its own `FourPlayerBoard` component, and two screens
(`FourPlayerSetupScreen`, `FourPlayerGameScreen`). It surfaces as its own card on the Play menu, not in `VariantSelector`.
Branch `fourPlayerChess` (frontend only; no backend changes).

**Board.** 14 x 14 minus a 3 x 3 corner = 160 squares, stored as a flat 196-cell `Int8Array` mailbox (-1 off-board, 0 empty,
`seat * 8 + type` for pieces, type 7 = a promoted queen). Neighbour/ray tables are precomputed and already stop at the cut corners,
so move generation has no bounds checks. State is immutable (`FourPlayerState`); Undo is a stack of states.

**Rules as built.** Movement is standard chess; pawns move/capture in their own seat's direction and double-step from their
starting line; promotion is to a queen only, on each seat's own 8th rank (Red rank 8, Yellow rank 7, Blue file h, Green file g).
Legality generalises king safety: a move is legal iff no LIVE enemy seat attacks your king afterwards (double check from two seats
works). En passant is generic across directions (a Blue pawn can take a Red pawn) and lasts one applied move. Castling is per seat
(king two squares towards the rook, rook onto the crossed square). Kings are never captured.

**Elimination (the new part).** Checkmate is never stored as "pending": after every move the turn passes clockwise and the next seat
is examined *at that moment* (`advance` in `elimination.ts`). A seat with no legal move is checkmated (in check) or stalemated,
eliminated on the spot, and that **consumes its turn**. An eliminated seat's pieces turn dead (a status flip, no per-piece flag): they
block and can be captured for 0 points, but never move, capture or give check — except the king, which walks to a random empty square
each time its turn comes round and freezes (no points) when it cannot. Because nothing is decided until the mated seat's turn, a mate
can dissolve (the checker is captured), an intervening seat can deliver it (credit goes to the most recent mover among the attackers),
and eliminating a seat can lift checks it was giving. The game ends when at most one seat is active or at the 300-ply cap; the
highest score of ALL FOUR seats wins (ties shared).

**Scoring (simplified).** Capture values pawn 1, knight 3, bishop 5, rook 5, queen 9, promoted queen 1; dead pieces 0; checkmate +20 to
the credited seat; stalemate +20 to the stalemated seat and +10 to every other active seat. Not modelled: check-fork bonuses, draw
claims, points for mating a dead king. No clocks; resign is the only voluntary elimination (the engine has a `'timeout'` reason ready).

**Bot.** `fourPlayer/bot.ts`, three levels, no Stockfish (it cannot play this game). Easy = random with a capture preference; medium =
one ply (points, material vs the average active opponent, hanging-piece penalty, mate of the next seat); hard = two ply against the
next ACTIVE seat's worst reply including being mated by it. Not ELO-rated (4-player games are never rated).

**UI.** Fixed top-down cross board; `viewSeat` rotates it purely at render time (the sole human sits at the bottom in vs-bots games;
hotseat starts Red-at-bottom with a Rotate button). Tap a piece, tap a highlighted square (no drag in this pass). Squares are 26 px on a
390 px-wide phone (22 px on 360x640, up to 34 px on tablets/desktop): checked in the browser at 390x760 and 360x640, no clipping or
horizontal overflow, including a full bot-only game played to its end (ranking card shown).

**How it is tested** (all in `src/logic/__tests__/`)
- `fourPlayerBoard.test.ts` — 160 squares and exactly which corners are cut; the start position square by square for all four seats
  (including Blue/Green's king-queen swap); the invariant that every queen is on an even-parity square and every king on an odd one;
  rays stopping at the corners; render rotation; serialisation round-trips (statuses, scores, en passant, a finished result).
- `fourPlayerMoves.test.ts` — every piece in each seat's direction; double steps, promotion lines for all four seats, captures per
  direction, no king capture; castling for all 8 rook sides plus every refusal and every way to lose it; en passant (across axes,
  one-move window, own pawn, exposing the capturer's king); multi-seat check, pins, dead pieces never attacking; **a differential test
  against chess.js** on an 8x8 window (two live seats, 1000 random positions: legal moves and "in check" agree exactly).
- `fourPlayerElimination.test.ts` — the 8 named scenarios (1 a pending mate dissolves; 2 an intervening mate credits the later attacker,
  2b credits the earlier one when alone; 3 an elimination lifts a check; 4 the turn is consumed and a walled-in dead king freezes, 4b a free
  one walks; 5 one move mates two seats; 6 stalemate scoring; 7 the game ends mid-cycle and the highest score wins even if dead; 8 dead
  pieces block, score 0 and never attack), plus resign, timeout, the third resignation, the ply cap, skipped frozen seats and turn order.
- `fourPlayerBot.test.ts` — legal at every level and seat, null when boxed in, takes a free queen, does not trade a queen for a defended
  pawn, finds mate in one (also with a dead seat in between), hard declines bait that costs a back-rank mate, complete self-play games at
  every level, and a timing budget.
- `fourPlayerApp.test.ts` — seat setup, labels/narration, cell sizing, and wiring/isolation pins (the engine imports only itself; the
  2-player plumbing never mentions it; the game is not rated/saved; menu and `App.tsx` routing).
- **Mutation-checked**: 54 deliberate breakages of the engine and bot (corner size, pawn directions and start/promotion lines, rotation,
  piece order, point values, castling geometry and rights, every attack/legality rule, dead-piece handling, mate-credit order, scoring,
  game end, freezing, resign, the ply cap, bot evaluation). 46 were killed on the first run; 5 real gaps (dead pawns/knights giving check,
  a dead king capturing, an eliminated seat keeping castling rights, the bot treating a dead seat as its opponent) were closed with new
  tests and now die; 3 survivors are equivalent mutants: the sign of a pawn's perpendicular is irrelevant because both sides are always
  used, the TYPE of the mover's own piece on the arrival square cannot change its own king's safety (only that something stands there),
  and a dead seat's material is never read by the evaluation.

**Performance.** `legalMoves` from the start position takes ~0.07 ms. Full bot-vs-bot games (up to the 300-ply cap): easy ~0.1 ms per
decision, medium ~4 ms (max ~20 ms), hard ~16 ms mean (max ~260 ms); a complete four-hard-bot game computes in ~3-5 s in total.
Nothing recomputes per render except the legal-move list for the position on screen (memoised per position).

**CHECKLIST sections, explicitly.** *Spec before code*: written and reviewed before implementation. *Correctness*: above. *Performance*:
above. *Online/backend parity*: **N/A this pass** — fully isolated, no Online component, no backend change; the engine is written so
it can be mirrored verbatim later (no React/chess.js imports, serialisable state). *Cross-feature*: nothing else imports the folder;
bots (a separate bot), analysis (4-player games are not analysable), PGN export/import (not saved, so nothing to export), game history,
ratings/achievements, puzzles and tournaments are untouched — pinned by `fourPlayerApp.test.ts`. *Documentation*: doc comments at the
top of every engine file explain the lazy-mate rule, dead pieces, the scoring simplifications and the generic en passant. *Variant
extras*: not combinable with any 2-player variant because it is not one (no `VariantSelector` entry, no `gameResult.ts` slot).

**Known limits** — see TODO.md ("4 Player Chess: what the first pass leaves out"): Teams, Solo, Online, clocks, saved games/analysis,
check-fork scoring, drag input, repetition draws.
