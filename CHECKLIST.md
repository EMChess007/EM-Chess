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

## 6b. Every new or changed screen passes the Android device matrix (found on a real phone, Blackview Fort 200)
- Every new or changed screen must pass the Android device matrix before it is called done: `node scripts/browser/android-matrix.mjs --profile mini --screens <your screen>` while you work, `--profile quick` (the CI job `device-matrix`) before the PR, and `--profile full` when the layout of the screen changed (the nightly runs it for everything). Add the screen to `scripts/browser/android-matrix-screens.mjs` (steps from a fresh load; its `boardKind` if it has a board) - a screen that is not in the list is not covered. TESTING.md "Android text fit and the Android device matrix" has the criteria.
- Text is `Text` / `TextInput` from `components/AppText`, buttons are `Pressable` from `components/AppPressable`, never react-native's (a scan test fails otherwise): the bundled font, a line height that leaves room for descenders, the font-scale cap and the 44 dp touch-target floor live there. A dense control passes `DenseText` / `maxFontSizeMultiplier={DENSE_MAX_FONT_SIZE_MULTIPLIER}`; board art (a glyph in a cell) is sized from its cell and passes `maxFontSizeMultiplier={1}`.
- A container never has a fixed `height` / `width` for text that can grow: `minHeight`, `flexWrap` on a row of labels, `flexShrink` on a label next to a button. A row of 3+ labels or buttons wraps. `adjustsFontSizeToFit` and a single-line `numberOfLines` on a label that matters are not used (the browser ignores the first and the phone applies it to a wrongly measured box; the second shows "Cha..." instead of the word).
- A screen's content must be reachable at any window size: a scroll view when it can be taller than a landscape phone, or a size gate with its own message (never a clipped View). The root frame handles the side and bottom system areas; a screen that draws full-bleed text or controls handles its own.
- A screen that loads from the server shows a failed load as "Can't reach the server" + Retry (`LoadFailed`), never a spinner that can outlive the request and never a silent empty state. `api/client.ts` gives every request ONE budget of 6 s (`REQUEST_DEADLINE_MS`, retries and body included; only game-save / rating / puzzle writes nobody waits for keep the patient 45 s policy), a socket request that waits for an answer goes through `emitWithin` (`api/socketAck.ts`, 6 s): a bare `socket.emit(event, payload, ack)` on a socket that never connects waits for ever. A new screen that fetches is added to `offlineScreens.dom.test.tsx` and to `scripts/browser/offline-states-e2e.mjs`; the tests that model it use REAL servers (`scripts/browser/offline-servers.mjs`: refused, accepts and never answers, headers then stall, half a body, non-routable, DNS), never only fake timers (they skipped the 45 s of retries that made the phone spin).
- An icon in the tab bar (or any icon that is a glyph) is a drawn vector (`TabIcon`) in a theme colour token with at least 3:1 against its background in both themes - never a text glyph or an emoji (Android draws some, like the black pawn, in a fixed colour). The device matrix reports a `contrast` issue for a `data-matrix-glyph` icon below 3:1.
- The matrix's text-scale switch follows section 7: `window.__EM_TEXT_SCALE__` (`src/logic/typography.ts` `readEmulatedFontScale`, pinned by `typography.test.ts` and `appText.dom.test.tsx`) is read in ONE function, honoured only on web in a development build (`__DEV__`) and only for a finite value in [0.5, 3] (it scales text; the `maxFontSizeMultiplier` cap still applies), ignored in a release build and on a device, set only by the matrix's own page.
- Native-only factors a browser cannot test get a line in the real-phone checklist of the PR: safe-area insets with edge-to-edge and the hidden navigation bar, keyboard avoidance, the real system font and font-size / bold-text / display-size settings (More > Diagnostics > "Run text-fit check" first), touch coordinates (pageX / locationX frames).

## 7. Test-only switches (a knob that exists for tests must not exist in production)
- A test-only environment variable or build-time setting is read in ONE small module, has an opt-in name that says
  what it does, is ignored when `NODE_ENV=production` (one warning at startup that does not print the value), only
  accepts a finite value inside a bound (it can raise a limit, never switch it off), is set only by the test
  stack's own child process (never in a workflow `env`, `.env.example`, `render.yaml` or any deployment config),
  and has tests for: the default unchanged, ignored in production, honoured outside it, no secret read or logged.
- **Auth rate-limit override absent/ignored in production**: `AUTH_RATE_LIMIT_TEST_OVERRIDE` (backend
  `src/lib/authRateLimit.ts`) - `npm run test:authRateLimit` in the backend pins all of the above. The same rule
  for the app: `EXPO_PUBLIC_API_URL` is honoured by dev builds only (`src/api/apiBaseUrl.ts`, `apiBaseUrl.test.ts`).
