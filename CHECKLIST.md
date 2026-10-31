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
- Log in, register and the session check are NOT loads (command #27b): they use the PATIENT sign-in policy (`AUTH_POLICY`, 60 s, one try may wait the whole minute, 502/503/504 and failed connections retried after 1, 2, 4, 8 s) because the Render free tier is asleep after a quiet period and takes up to a minute to answer. The screen shows Cancel at once and "Waking up the server…" after 5 s (`SignInWaiting`, `useSignInRequest`); never two sign-ins in flight; a register that may have created the account (a lost answer, Cancel) signs in with the same password on the next 409 instead of failing. On the ONLINE backend a failed read shows "Server is starting up…" and retries by itself 3, 6, 10 and 15 s apart (`LoadFailed`, `logic/serverStartup.ts`); the local / LAN backend keeps the plain 6 s error. These too are tested against REAL servers that wake after 40 s, never wake, answer 503 or lose the answer (`scripts/browser/auth-servers.mjs`, `apiAuthRealServers.test.ts`, `signInWaking.dom.test.tsx`).
- An icon in the tab bar (or any icon that is a glyph) is a drawn vector (`TabIcon`) in a theme colour token with at least 3:1 against its background in both themes - never a text glyph or an emoji (Android draws some, like the black pawn, in a fixed colour). The device matrix reports a `contrast` issue for a `data-matrix-glyph` icon below 3:1.
- The matrix's text-scale switch follows section 7: `window.__EM_TEXT_SCALE__` (`src/logic/typography.ts` `readEmulatedFontScale`, pinned by `typography.test.ts` and `appText.dom.test.tsx`) is read in ONE function, honoured only on web in a development build (`__DEV__`) and only for a finite value in [0.5, 3] (it scales text; the `maxFontSizeMultiplier` cap still applies), ignored in a release build and on a device, set only by the matrix's own page.
- A piece's colour is checked under EVERY piece theme, not under the default one (command #27c: the phone showed black rook / queen / king white, and every earlier colour test had only ever looked at the built-in vector set). A new piece theme is added to `PIECE_THEME_IDS` in `scripts/browser/android-matrix-screens.mjs` (`pieceThemes.test.ts` fails otherwise), which gives it a 2-player and a Bughouse-dual matrix screen whose pixels are compared with the theme's own images; its twelve assets must pass the tone tests of `pieceThemes.test.ts`. Every drawn piece, vector or image, carries `data-piece` and a "white king" style label (`Piece.tsx`): a piece the matrix cannot find is a piece nothing checks.
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

## 10. Screens with two boards (Bughouse W3a): what the work taught
- Before labelling a mutant EQUIVALENT, RUN the claim, do not argue it: W2's 31 "equivalent" mutants had 4 wrong labels (a stream draw, a clamp that does act under a slow broadcast, a log level, a guard an existing test already killed). Re-run the labelled ones through the harness with `--match EQUIVALENT` whenever the tests around them change.
- A half-made action on a screen with several boards (a selection, a picked pocket piece, a promotion choice) is tied to the position of ITS board and dropped when that board changes - never when "the match" changes: with bots playing the other board the first tap would be erased before the second. The rendered tests cannot see this (nothing else moves); a browser pass with live bots does. Test it with a bot move on the other board between the two taps.
- jsdom reports a 0 x 0 window (react-native-web reads `document.documentElement.clientWidth`), so `domSetup.ts` starts EVERY rendered test in a 412 x 915 phone window (`DOM_DEFAULT_WINDOW`, pinned by `domWindow.dom.test.tsx`); a layout that depends on another size is tested through `setWindowSize` in `domKit.tsx`. A new rendered test needs no window set-up for the phone case.
- Styles from a `StyleSheet` become classes, not inline styles: a rendered test cannot read a border or a background colour the code sets statically. Give the state an accessibility label ("Board A, deciding board", "pocket, just received a piece") and test that - it is also what a screen reader needs.
- A layout that must fit a window is measured in the browser at that size (the page's scroll height against the viewport), not only computed: the specified boards fit at 800 x 360 but the chrome around them did not.
- A source-pin test of an older screen may fix the exact text of a line you extend (`TimeControlSelectScreen`): extend around it (a caller prop, a second filter) instead of editing the pinned line.

## 11. Two fingers on two boards (Bughouse W3b): what the work taught
- Two simultaneous fingers cannot go through the responder system (a `PanResponder` / `Pressable` grants ONE responder: the second finger is ignored or steals the first). A screen that must take two touches at once listens to plain `onTouchStart` / `Move` / `End` / `Cancel` on each target, tracks every touch by its `identifier` in a book of that target's own, and uses NO responder at all on those targets (a scan pins it: `bughouseDualBoardArgument.test.ts`). Everything that was a `Pressable` on such a screen (pocket chips, the promotion choice) becomes a plain View with the same touch props; a shared `Modal` (the promotion picker) cannot be used either - it would cover the other board - so the choice is drawn over ITS board.
- A touch belongs to the target where it began: events of a touch are delivered to the view it began in, so "start and end on the same board" is a COORDINATE test against that board's own grid (both ends inside it), not an event-target test. The gutter between the boards and the margins are a dead zone by construction (no handler there) and by math (`insideGrid`).
- A mouse is a touch with its own identifier (`pointerType` "mouse" only; a finger's pointer events would count it twice). The page origin of a grid is read when a touch LIFTS (a layout can shift under a held finger; a start-time read is overwritten by it, so it was removed when the mutation run showed it redundant), plus the scroll offset on web, awaited `measure` on a phone: all three are tested (the native path with a `measure` stub on fake timers). A chip of the OPPONENT's pocket must not listen at all: with one reducer per board a tap on it would lift the piece of the side to move (found by a test, fixed: only a usable chip has touch props).
- CDP multi-touch (`Input.dispatchTouchEvent`): the points of a `touchStart` are the ACTIVE points; the points of a `touchEnd` are the ones that LEFT. The script `scripts/browser/bughouse-dual-touch.mjs` drives it on the app's own dev server; Playwright's `touchscreen.tap` is single-touch. react-native-web's own responder store may log "Cannot find single active touch" on multi-touch in dev: it is not ours and changes nothing, but a run that prints it is not "no errors" - the script filters it and says so.
- The spec's block height (8 cells + 96 px) was a plan: the real block (two bars, pockets, the board, the status line) is taller, and the chrome above it is not 88 px. At 412 x 915 the first stacked layout overflowed by 38 px although `getBughouseDualCellSize` said it fits. The stacked dual layout was trimmed (one slim bar, slim controls, compact blocks, controls on their own row because four controls do not fit beside the title at 360 px) and the browser script measures, at every viewport, that both blocks, the boards and every control are fully inside the window.
- A property over a whole screen beats a property over its parts: "each board ends exactly where the same touches on that board ALONE would have left it", run through the rendered screen with seeded interleavings (some with overlapping fingers), found nothing the unit tests had missed but is the only test that would catch a routing mix-up between the two reducers.


## 12. Touch coordinates are in ONE frame (Bughouse on a real phone, command #26)
- A touch position and the rectangle it is compared with must come from the SAME frame. React Native: `pageX / pageY` are relative to the app's ROOT VIEW; `measure()` gives `pageX / pageY` in that frame; `getBoundingClientRect()` on a View ref exists on a phone with the new architecture but answers in WINDOW coordinates (the root view's position plus the viewport offset, negative under a translucent status bar). Web: page coordinates and the rectangle share a frame, so web tests cannot see the difference. A phone never reads `getBoundingClientRect()` for a touch origin (`originSource`).
- Prefer a position that needs no origin: a transparent overlay over the grid that is the touch's target, then `locationX / locationY`. A tap carries both ends in that frame or neither.
- A "phone path" test runs with Platform android AND with every method a phone's node really has (a window-frame rectangle AND `measure`), never with the browser's method deleted: the missing combination is where this hid.
- A dev-only diagnostic (a touch overlay, a log) is loaded from `if (__DEV__) require(...)` in the app entry and registered, never imported by a screen, with a scan that says so (`bughouseTouchDebug.test.ts`).

## 13. Chips that left their strip, and a king that was the wrong colour (Bughouse on a real phone, command #27b)
- A row of controls whose HEIGHT or POSITION decides where the board is drawn never depends on how the phone's layout engine measures a wrapping flex child. The pocket was `flex: 1; flexWrap: 'wrap'` in a bar: with two kinds of piece the chips stacked vertically and one was drawn over the top rank of the board, on the phone only (the browser's flexbox grows the bar, so the web matrix passed). A strip is ONE row that never wraps, clips what it holds (`overflow: 'hidden'`), has chips of COMPUTED widths (`logic/bughousePocket.ts`, from the MEASURED strip and row) and gives the seat's name up before the pocket (`showSeatName`). A fixed-size row of board art may have a fixed height; text beside it may not.
- Whatever a phone can show that a test fixture did not is a permanent matrix scenario, not a temporary patch: the worst case (`bughouse-full-pockets-*`: every pocket holds all five kinds up to 16, a promoted piece on each board) runs in every profile, with `pockets: true` (the `pocket` check: one row, inside its strip, no rectangle on the board, a clock, a status line, the name beside it, or another chip). A fixture is a test-only switch (section 7): `window.__EM_BUGHOUSE_FIXTURE__`, read in ONE function (`readBughouseFixture`), web + development build only, a closed set of names, one warning that does not print the value elsewhere.
- A chess piece is never a font glyph. The bundled Inter has no chess glyphs, so every piece came from whatever font the phone fell back to, and "black" looked white. Pieces are vectors (`components/pieceArt.ts`, `PieceIcon`, `Piece`; the 4-seat boards too) with the fill and outline written as literals, marked `data-piece` / `data-seat-piece` so a test reads the kind and colour a screen RENDERS (`pieceColours.dom.test.tsx`) and the device matrix reads the PIXELS on both square colours (`pieces:` in the screen list, `android-matrix-pieces.mjs`; `androidMatrixPieces.test.ts` proves a black king drawn white is reported).
- An empty list shows nothing, never a placeholder character that sits next to a label ("Board A · Black –").
- Mutation of layout code is possible in jsdom: react-native-web keeps each view's `onLayout` handler on its DOM node (`__reactLayoutHandler`), so a rendered test hands the strip and the pocket row the widths a phone would measure (`bughousePockets.dom.test.tsx`).

## 14. Piece colours that only a phone can see (command #27d): what the work taught
- A piece image is never a base64 data URI. The built-in image themes are BUNDLED files (`assets/pieces/<theme>/<key>.png`, imported by the generated `src/logic/pieceAssets.ts`, made from `src/data/pieceSets.json` by `scripts/generate-piece-assets.mjs`, `--check` in `pieceAssets.test.ts`); a custom theme is 12 files in the app's own folder (`piece-themes/<unique id>/<key>.png`, `customPieceFiles.ts`, `pieceFileStore.ts`) and its record keeps file URIs. Every `<Image>` of a piece takes its source from `pieceImageSource` (a scan pins it). The browser keeps data URIs for custom themes (it has no file system).
- A vector piece's paint is written out in full (`piecePathPaint`: fill, fill opacity, fill rule, stroke, stroke opacity, width, join, cap, and the svg's own `color` and `opacity`) and is a function of the piece's COLOUR only; the drawing modules import no square or board-theme module (`pieceIcon.dom.test.tsx` renders a piece in front of both square colours and compares the markup).
- What a browser cannot show, the PHONE shows: More > Diagnostics > Piece gallery (every theme x 12 pieces x light and dark square, the pocket chips, three colour probes, the system colour scheme, the build identifier in its fixed header). A change that touches how a piece is drawn is not "done" until a screenshot of that screen per theme exists; the build identifier (`app.config.js` -> `scripts/build-info.cjs` -> `src/logic/buildInfo.ts`, at bundle time) says which commit it came from.
- A long matrix run is RESUMABLE: `--progress FILE` writes every finished screen of a page group at once and a restart skips it (`android-matrix-progress.mjs`). Always `export E2E_BROWSER_PATH=/opt/pw-browsers/chromium` before a browser script.
- A cause that cannot be reproduced is written down as UNPROVEN with the evidence for and against (TESTING.md section 43), never as a finding; the instrument that will prove it (the gallery's probes) goes in with the change.
- (#28: the instrument settled it - the probes stayed dark on both squares, so "Android recolours bitmaps" was FALSE and the probes and the lock-to-light buttons were removed. The causes were in the art.)

## 15. A piece is judged by its BODY, on every board theme, at game size (command #28): what the work taught
- A mean tone says nothing about a piece whose body is half light bands (Merida's black king passed "mean <= 100"). Judge the BODY: the shape eroded by the outline width, its median and its dark / light shares (`pieceBodies.test.ts`), and from a photograph the median luminance of every pixel that is not the square (`bodyLuminance`, `BLACK_BODY_MAX`). Every black piece must read dark at 32 dp on the light and the dark square of EVERY board theme and on the pocket chip; a new board theme or piece theme is added to `BOARD_THEME_IDS` / `PIECE_THEME_IDS` (the matrix runs piece x board).
- A piece never has a light edge on its dark side: black = dark fill + thin dark-grey outline, white = light fill + thin dark outline, at most 1 dp at 32 dp (`PIECE_OUTLINE_WIDTH`). Chips holding a vector piece use the ONE mid-tone `PIECE_CHIP_BACKGROUND`. A near-white fill on a light square is 20-30 from it: the pixel judge uses a finer threshold for a white piece, so "the fill is the square" never hides a missing piece.
- Edit the art in `src/data/pieceSets.json` through a script (`scripts/darken-merida-black.mjs`, idempotent, `--check`) and regenerate the bundled files (`generate-piece-assets.mjs`); never hand-edit a PNG.

## 16. An online Bughouse client (W4): what the work taught
- The server is the only authority: the client never plays a move it sent. `bughouseOnline.ts` applies a snapshot only at `seq + 1`, one action is in flight, and the clocks are `serverNowMs + local time since arrival` (differences of the LOCAL clock only). A test that needs the "other order" (snapshot before ack, ack before snapshot) pins both.
- Reuse the Local game screen through a binding (`online`): the layouts, touch input and result card are one code path; the online-only parts (session, queue, leaving, resigning) wrap it. A half-made selection is dropped when an online action is SENT (the position will not change until the snapshot).
- Every wait has a limit AND an owner: `emitWithin` 6 s, a sentence, ONE Diagnostic Log line, a way out (Retry in the queue and after a failed rejoin; a move reads the room again). A fake socket with `silence(event)` (src/test/fakeBugSocket.ts) is how a test says "no answer".
- The integration test uses the app's own session class on real sockets against a private copy of the real server (`backend/scripts/test-bughouse-client.mjs`); the browser test drives two real pages through the UI and compares BOTH boards of BOTH screens with the server's spectator stream after every action (`backend/scripts/e2e-browser/bughouse-online.mjs`). A queue of one human waits for ever (by design): the phone needs a second human - `npm run bughouseBuddy` in the backend.

## 17. Android is tested on Android (command #29): "done" means `android-e2e` is green
- **No report may say "done", "ready" or "green" unless the `android-e2e` check (`.github/workflows/android-e2e.yml`) is green on the FINAL commit** of the branch, with the run's link in the report. Chromium-only checks (the web matrix, the `dom` project, the CDP scripts) are necessary and were not enough: every Android-only bug of command #20-#28 passed all of them. A red `android-e2e` is a finding to fix or to explain with its screenshot, never a check to re-run until it passes.
- A WIP push may skip the local pre-push gate (`SKIP_PREPUSH=wip git push`, logged in `.git/pre-push-skips.log`); a report must then say so, and the final commit is never pushed that way.
- A new or changed screen is added to `scripts/browser/android-matrix-screens*.mjs` (the steps are read by BOTH the web matrix and `scripts/android/e2e.mjs`, which taps the same text / label / testID on the emulator), and a screen that needs a login or a backend gets an online scenario in `scripts/android/e2e.mjs`.
- What the run cannot see is written down in TESTING.md section 45 ("what android-e2e does not cover"), not assumed.
- A test-only switch the run needs (`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_E2E`) is set on Metro's own process by `scripts/android/metro.sh`, never in a workflow `env` (section 7).

## 18. Reading an app from outside (command #30): what the green android-e2e taught
- **Never read a file a failed command may not have written.** `uiautomator dump && cat file` returned the previous screen's tree for a whole day of runs; the file is removed first, and the tool's own message is kept and counted (`accessibility dumps that failed`).
- **State comes from the app, not from a screen it may not be able to describe.** The e2e build reports every board's position, selection, last move and rectangle to the driver (`src/dev/e2eBeacon.ts`, CHECKLIST section 7 rules, registered through `devOverlayRegistry.ts`); the tree and the photograph confirm. A new screen with a board mounts the probe; a new test-only address is written and PINNED by a test that parses the line that sets it (a missing space made the whole beacon dead for two runs).
- A judge is **calibrated before it is trusted and before it is turned on**: draw the old and the new art offline (`scripts/android/calibrate-pieces.mjs`), choose the limit between them with margin, pin the limits as literals, and read the photographed numbers off the first run (they matched). A judge that compares a photograph with the repository's own copy of the art can never fail on a bad copy.
- **A proof is a pair**: the current code GREEN and the reverted code RED in the check that is meant to catch it, and nothing else RED. It needs the failing condition to exist in the run first (the emulator is edge-to-edge; the status-bar frame is created on purpose and the run FAILS if the app does not report it). Run the proofs AFTER the branch's own run, not beside it: 21 concurrent jobs slowed the emulators enough to fail unrelated blind scrolls.
- A red run is read from ONE short log (the aggregate job's digest), not from artifacts nobody can open and not from 3000 lines of service-container output.
- The stopwatch of a time limit starts at the action it limits (the last tap), never at the start of the path that leads to it.
