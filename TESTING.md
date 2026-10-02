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

### To actually turn this on, a maintainer needs to:

1. Create a free account at [sentry.io](https://sentry.io) (or self-host, if preferred).
2. Create a new project, platform **React Native**.
3. Copy its DSN (Settings → Projects → [project] → Client Keys (DSN)).
4. Put it in `.env.local` (already gitignored, already has a placeholder line added):
   ```
   EXPO_PUBLIC_SENTRY_DSN=https://xxxxx@xxxxx.ingest.sentry.io/xxxxx
   ```
5. For EAS builds (not just local `expo start`), add the same key as an EAS secret so it's present
   at build time: `eas secret:create --name EXPO_PUBLIC_SENTRY_DSN --value <your-dsn> --type string`.
6. That's enough for JS-level crash/error capture (unhandled exceptions, unhandled promise
   rejections, React render errors via `Sentry.wrap`). `app.json`'s `plugins` array already has
   the bare `"@sentry/react-native"` config plugin (added automatically by `expo install`) —
   this enables native-level crash symbolication too, with no further action needed for that part.
7. **Optional, for readable native stack traces and automatic source map upload during EAS
   builds**: that needs your Sentry **organization slug** and **project slug**, plus a
   `SENTRY_AUTH_TOKEN` (Settings → Account → API → Auth Tokens, scope `project:releases`) set as
   an EAS secret. Once you have those, replace the plugin entry in `app.json` with:
   ```json
   ["@sentry/react-native/expo", { "organization": "your-org-slug", "project": "your-project-slug", "url": "https://sentry.io/" }]
   ```
   This step was deliberately left out for now — it needs real values this session doesn't have,
   and a wrong/placeholder value here risks failing a real build, whereas skipping it just means
   slightly-less-readable native crash traces until it's added.

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
| Premoves, Undo | Partial | Exercised incidentally by the backend's E2E tests (premove resolution is tested as part of Online Fog of War flows) and by this session's own manual verification earlier, but no dedicated regression test for either as a standalone feature. |

As in the backend's audit: this is not equal-depth coverage everywhere, by design — the chess
engine and Fog of War got the deepest investment because that's where every bug this project has
actually found so far has lived. Gaps above are named, not hidden, so a future session knows
exactly where to look first if something in one of those areas turns out wrong.
