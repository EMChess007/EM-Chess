# Testing & Quality Infrastructure — Frontend (EM-Chess)

This repo and its backend sibling (`chess-app-backend`) are tested together in places — several
backend test scripts import this repo's `src/logic/ChessEngine.ts` directly, since that's the
actual shared chess logic, not a reimplementation. See the backend's own `TESTING.md` for that
half; this document covers what's local to this repo.

## Cloud sessions (a Linux VM) — how to start, what the setup does, what differs from Windows

All work runs in Claude Code cloud sessions (Ubuntu 24.04 VM), not on the Windows laptop; the laptop only runs Expo and the backend for manual phone checks. Every gate in this file and in the backend's TESTING.md runs there with the same numbers.

**How to start a session.** The cloud environment's setup script (below) prepares the machine once and is cached; a session then starts with `bash scripts/cloud-setup.sh` (idempotent: about 3 s when nothing changed, 22-27 s with no `node_modules` and an empty database; the cache limit is about 5 minutes). It is needed every session because it starts the local PostgreSQL (the environment cache keeps files, not processes). Layout afterwards: the app at the repo root, the backend INSIDE it as `./backend` (the app's `.gitignore` lists `/backend`; the backend's test scripts import `../../src/...` of the app, so the nested layout of the laptop, `chess-app\backend`, is reproduced; a symlink `../chess-app-backend` points at it for tools that expect the sibling path). Gates are run one at a time; in the cloud any free port will do (the CI ports 3000 / 3002 are used as CI does), and the laptop-only rules (never :3000 / :8081 / :8082) still apply when a session runs on the laptop.

**What `scripts/cloud-setup.sh` does** (each step skips what is already in place; it never prints or asks for a secret):
1. **Node 20** from `/opt/node20` (the version `.github/workflows/ci.yml` runs; the VM's default is 22, the laptop used 24), first on `PATH` for every login shell via `/etc/profile.d/zz-em-chess.sh`, which also sets two non-secret variables: `E2E_BROWSER_PATH=/opt/pw-browsers/chromium` (the browser end-to-end has no system Chrome there) and `EXPO_NO_TELEMETRY=1`.
2. **The backend** at `./backend`: an existing checkout is left alone; a checkout the environment attached next to the app (`../chess-app-backend`, from "Repositories" in the environment settings) is moved inside and a symlink left behind; otherwise `chess-app-backend` is cloned (the branch of the app when it is `paired/<x>` and the backend has it, else `main`; `CLOUD_BACKEND_REF` overrides).
3. **`npm ci` in both repos**, in parallel, skipped when `package-lock.json` and the Node version are unchanged (a stamp in `node_modules`).
4. **PostgreSQL 16**, the major of `backend/docker-compose.yml`, from the VM's own package (installed if missing), started as a local cluster; role `chess` / password `chess` / database `chess_app` as in `docker-compose.yml` and `.env.example`. **Docker is not used**: the daemon starts, but Docker Hub answers HTTP 429 from the cloud, so `postgres:16-alpine` cannot be pulled.
5. **`backend/.env`** with TEST-ONLY values: the local `DATABASE_URL` and a random `JWT_SECRET` (mode 600, git-ignored; the script refuses to continue if it is not ignored, and refuses an existing `.env` whose `DATABASE_URL` is not `localhost` / `127.0.0.1`, without printing it). Never commit it; a real `.env`, Neon or Render value is never used here.
6. **Prisma**: `generate` and `migrate deploy` against the local database; prints the local account count (0 on a new VM; the e2e suites delete every account they register).

**The environment's Setup script** (paste this; it uses the script from the checkout, and until this change is merged to `master` fetches it from the `chore/cloud-setup` branch; it always exits 0 so a failed setup never blocks a session):

```bash
#!/bin/bash
APP=/home/user/EM-Chess
SCRIPT="$APP/scripts/cloud-setup.sh"
if [ ! -f "$SCRIPT" ]; then
  git -C "$APP" fetch --depth=1 origin chore/cloud-setup \
    && git -C "$APP" show FETCH_HEAD:scripts/cloud-setup.sh > /root/cloud-setup.sh \
    && SCRIPT=/root/cloud-setup.sh
fi
CLOUD_APP_DIR="$APP" bash "$SCRIPT" || echo "cloud-setup failed (exit $?): run 'bash scripts/cloud-setup.sh' in the session"
exit 0
```

Environment settings: add `chess-app-backend` under **Repositories** (the setup script cannot clone a private repository on its own); no variables are required (the script sets the two non-secret ones in the shell profile). Network access: the default **Trusted** level is enough (npm, GitHub, nodejs.org only if Node 20 is ever missing from the image).

**Gates on the VM** (2026-10-28, app `paired/bughouse` a21dbdd + backend `paired/bughouse` 01a34f1, Node 20.20.0, PostgreSQL 16.15, Chromium 1243; every number equals the documented one): `tsc` clean in both repos; vitest **1913 / 1913, 110 files** (all goldens inside: FFA, Giveaway, Chaturaji, geometry, Crazyhouse, Bughouse; no tracked file changed); `sync:fourplayer --check` 11 files and `sync:bughouse --check` 12 files in sync; backend suites: Fog of War castling 61 / notation 35 (the other four print `PASS: 0 failure(s)`), repetition 86, giveaway 34, atomic 34, duck 41, spell 27, horde 38, crazyhouse 85, unlimited 24, rejoin-finished 42, fourplayerSync 117, bughouseSync 70, bughouse lockstep 9, rooms 259, messages 81, matchmaking 82, handlers 64, test switches 41, bot 7, 4-seat parity 70 / rooms 237 / bots 160 / matchmaking 74 / handlers 61 / giveaway 89 / Chaturaji 121, userCleanup 38, authRateLimit 43, fourTestSwitches 73, attemptLimiter 87, joinChallengeLimit 14, trustProxy 79, `check:productionInstall` OK; real sockets against the CI-style servers (3000 with `FOUR_GRACE_MS=1500` and `FOUR_FILL_MS=8000`, 3002 with the real fill wait): 2-player e2e **350**, tournaments **40**, 4-seat e2e **427** (conditional 4; 422 without the second server), Bughouse **80** (conditional 3), rejoin-persist **73**; online fuzz, Chaturaji and Bughouse sections of 40 games each: 40 / 40 and 40 / 40, 0 unexpected issues (408 s); browser end-to-end **11 / 11**, 0 retries (346 s); mutation harness: `mutationHarness.test.ts` 23 / 23, the example config 5 killed + 1 equivalent (as documented), `chaturaji-bot-constants.config.cjs` **9 / 9 killed** (18 s). The local database ends with the 0 accounts it started with.

**Known differences from Windows, and what was done**
- **No system Chrome**: the browser end-to-end launched `channel: 'chrome'` only. `E2E_BROWSER_PATH` (backend `scripts/e2e-browser/app.mjs`, `browserLaunchOptions`, pinned by `npm run test:e2eBrowserOptions`) names an executable instead; unset, nothing changed. A failed browser launch also used to leave the harness's backend running on :3191 (the launch was outside the `try`): fixed.
- **Node 20, not 24**: CI and the VM image use 20, the laptop ran 24. Every count above is the documented one on 20; nothing in the suites depends on the major.
- **`test:rejoinPersist` passes with `FOUR_GRACE_MS=1500` on Linux** (73 / 73); the "known limit" of section 28 (the restarted `tsx` child starts slower than the grace on Windows) does not occur here. Nothing to fix.
- **A machine path in a mutation config**: `bughouse-w2-server.config.cjs` named `C:/Users/...`; its `root` is now computed from `__dirname`, and `mutationHarness.test.ts` pins that no config names a drive letter or a home directory. (Branch `chore/cloud-setup-mutation`, on top of `paired/bughouse`, where the harness lives.)
- **Junctions vs symlinks**: the harness already links `node_modules` with a directory symlink outside Windows (`removeTree` unlinks it, tested); nothing else uses junctions. **Line endings**: `.gitattributes` forces LF everywhere, so shell scripts survive a Windows checkout. **Shell**: `npm run` scripts that use `shell: true` (the web export in the browser suite) work under `sh`; `taskkill` is only used on win32.
- **Processes do not survive**: PostgreSQL and any dev server stop with the session; the cached environment keeps files only, hence `bash scripts/cloud-setup.sh` at the start of each session.
- **Pushing to the backend**: the session tool that attaches a repository reported that Claude has no push access to `chess-app-backend` for this organization; the Claude GitHub App must be installed on it for a cloud session to push there.

## Android text fit and the Android device matrix (branch `fix/android-text-fit`)

**The bug.** On a real Android phone (Blackview Fort 200, Expo Go) the last characters of nearly every label were cut ("Hom", "Pla", "EM-Ches", "Mor", "Analysi", "BULLE"), the second line of a wrapped text was missing ("Fog of" for "Fog of War", "Spectate a live" for "...game", "Find the best" for "...move", "Turn:" without its value) and descenders were clipped ("Plav aaainst bots"). Every earlier UI check ran on web, where none of it happens.

**The mechanism (what the symptoms prove, and what they cannot).** A bare label such as the "Home" tab is in a flex cell with no fixed width, no `numberOfLines`, no fixed height: nothing in the code clips it. The only way it shows "Hom" is a text box that was measured for narrower / shorter glyphs than the ones it is drawn with: the word no longer fits its box, wraps INSIDE it, and the part that wrapped falls below the box and is clipped ("Fog of" / "War", "Spectate a live" / "game", "Turn:" / value); with a descender-heavy line the line sits lower than the box and its bottom is cut. The cut is 15-30 % of the text on every string, i.e. a scale error (a font whose metrics differ, or a font scale the layout did not use), not a fixed offset. A phone whose system font is an OEM font, or whose font size / display size is not the default, is exactly where measure and draw disagree. **That is the consistent explanation; only the phone can confirm which of the two (system font or font scale) it is**, so the fix removes both variables and the app now carries an instrument: More > Diagnostics > "Run text-fit check" renders the strings that were cut with the bundled font and with the phone's own, compares each box with its text and writes the result, the font scale and the screen size into the diagnostic log (`src/logic/textFitProbe.ts`, `src/components/TextFitProbe.tsx`). One screenshot of that log, before and after, settles it.

**The fix, app-wide (not screen by screen).**
- *One font.* Inter (OFL, `assets/fonts`, six files: 400 / 500 / 600 / 700 / 800 / 400 italic) is loaded with `expo-font` before anything renders (`useAppFonts`, App.tsx gate, a 6 s give-up that keeps the system font) and every `Text` / `TextInput` draws with it: glyph metrics no longer depend on the phone's font. Android cannot pick a weight inside a custom family, so each weight is its own family and `fontWeight` is reset (`resolveFontFamily`). Rejected: relying on `adjustsFontSizeToFit` (the browser ignores it and the phone applies it to the very box that is wrong; it is now banned by a scan), and setting `allowFontScaling={false}` everywhere (it would hide the problem by removing accessibility).
- *One Text.* `src/components/AppText.tsx` (`Text`, `DenseText`, `TextInput`) is the only way text is drawn (the `textFit.test.ts` scan fails any file that imports them from react-native): the bundled family, a line height of at least 1.25 x the font size (1.3 x when none is named, rounded up), `maxFontSizeMultiplier` 1.5 for running text and 1.2 for dense controls (tab bar labels, buttons, chips, the seat strip; Android allows up to 2.0, the cap keeps a fixed-size control from being asked to hold twice the text; text still grows 20-50 %), and on web a word wider than its box breaks inside the word. Board art (piece glyphs, the streak flame) is sized from its cell and ignores the font scale.
- *Containers grow.* Rows that held 3-5 labels wrap (`flexWrap`) instead of squeezing them (the Play menu's mode buttons now have a 96 dp minimum, the game control bars, the 4-seat strip, alert buttons, puzzle links, the puzzle rush durations); headers wrap instead of ending in an ellipsis; the game body (`GameScreenBody`) scrolls when the content is taller than the window (landscape, 2 x text) and ONLY then (`scrollEnabled`), so the board's drag-to-move is untouched while everything fits; every `Pressable` is at least 44 x 44 dp (`AppPressable`, `compact` opts out visibly); the root frame keeps clear of the side and bottom system areas (`SideInsetsFrame`) and the alert / rules sheet pad by the insets.
- *No infinite spinners.* The request deadline now covers reading the body (`fetchOnce`; it used to stop at the response headers, so a stalled body left `json()` pending for ever), and Home (Stats and Recent Games), the Analysis list, the leaderboard and the spectate list show "Can't reach the server" with a Retry button (`LoadFailed`, `loadErrorMessage`) once the client's own retries have failed - Home used to show a silent, false "0 games".

**The Android device matrix** (`scripts/browser/android-matrix*.mjs`, defined once in `android-matrix-def.mjs`, pinned by `androidMatrixDef.test.ts`). Every screen of `android-matrix-screens.mjs` (home with the tab bar, the Play menu, the time-control screen, every setup screen, a game screen of 2-player, 4 Player Chess, 4 Player Giveaway and Chaturaji, the Options menu, the Chaturaji rules sheet, a dialog, Puzzle / Puzzle Training / Puzzle Rush, Analysis, More and its sub-screens) is opened in a real Chromium and checked under the cross product of: 10 window sizes (320 x 568, 360 x 640, 360 x 740, 393 x 852, 412 x 915, 480 x 1000, 600 x 960, 800 x 1280, landscape 740 x 360 and 915 x 412) x 6 text scales (0.85, 1.0, 1.15, 1.3, 1.5, 2.0) x 2 fonts (the bundled one and DejaVu Sans as a wide OEM stand-in) x 3 display sizes (1.0, 1.15, 1.3: the same pixels at a higher density, so fewer dp, never below the 320 dp smallest width Android allows) x 2 themes = 720 combinations per screen. The system bars are emulated with CDP `Emulation.setSafeAreaInsetsOverride` (a notch + 24 dp gesture strip; a 24 dp status bar + 48 dp three-button bar; each moving to the right edge in landscape): spread over the 720 and swept over every size (`--profile sweep`, 30 more). The text scale is `window.__EM_TEXT_SCALE__`, a development-build-only switch (CHECKLIST 7: honoured on web in `__DEV__` only, finite, inside [0.5, 3], ignored in a release build; `typography.test.ts`).
- *Pass criteria, per screen and combination* (`android-matrix-checks.mjs`, run inside the page): no clipped text (its own box scrolls - which includes an ellipsis and a line clamp -, an ancestor that hides overflow cuts it, it lies outside the window sideways), no sideways page scroll, no control outside the window or below it with nothing to scroll, no two controls or two texts overlapping, no control under 44 dp (board squares answer to the board's own minimum cell: 2-player 24, 4 Player 20, Chaturaji 28, Bughouse 28), nothing inside a system bar or the cutout. Layers (a modal's backdrop, what lies under a modal) are not judged. `--self-test` renders a fixture with every defect on purpose and checks each is reported and a clean page is not (the checks are themselves tested).
- *Profiles.* `--profile mini` (4 combinations, the edit loop), `quick` (23, the pull-request job `device-matrix` in ci.yml, about 3.5 minutes with contact sheets), `full` (720, the nightly `android-matrix-nightly.yml`, also by hand), `sweep` (30). `--sheets` writes a contact sheet PNG per screen (7 fixed snapshots from 320 x 568 to a landscape phone, light and dark, the wide font at 2.0 x) into `<out>/sheets`; `results.json` holds every issue. It starts its OWN `expo start --web` on a free port and kills it by PID after proving the command line (`BASE_URL=...` uses one you started); it never touches :3000, :8081, :8082 or a deployed server (the screens need no backend).
- *Limits, stated plainly.* The browser measures and draws text with one engine, so it cannot reproduce the phone's measure-versus-draw mismatch itself; what it proves is that every layout has room for glyphs that are wider (DejaVu), taller (2.0 x) and in a smaller window (display size) than the layout was drawn for - which is what makes the app tolerant of whatever the phone's metrics are. Window size, zoom, insets and font are changed live on an already-loaded page (a reload per text scale and theme); a layout that reads a window size once at mount would not notice, and the game screens do read it reactively.
- *What only a phone can check* (the list in the report and CHECKLIST 6b): the real status-bar / cutout / navigation-bar insets from `react-native-safe-area-context` with Android edge-to-edge and the hidden navigation bar (the app hides it; it reappears on a swipe), keyboard avoidance on the login / register / challenge / PGN screens, the real system font and Bold text / font-size / display-size settings (run "Run text-fit check" first), and the touch layer of the dual Bughouse board (its own section on `paired/bughouse`).

**Tests added (all green; counts in the PR):** `typography` (every weight, boundary, line-height rule, the cap, the test-only switch in and out of production, the style fit), `loadError`, `apiRequestDeadline` (a body that never arrives ends as "timed out" after the retries, a request that never answers too, the happy path, a server error keeps its words; fake timers), `textFit` (scans: no `Text` / `TextInput` / `Pressable` from react-native, no `adjustsFontSizeToFit`, the fonts ship, the app waits for them, 44 in both places), `textFitProbe`, `androidMatrixDef` (the requirement's numbers as literals), and the rendered `appText.dom` (family per weight, line height, emulated scale and cap, nesting, release ignores it, the 44 dp floor and `compact`) and `loadFailed.dom` (Home, the Analysis list and the leaderboard: spinner, "Can't reach the server", Retry loads the data). Two older source-pin tests were changed on purpose: `spellChessLayout` (the game body is a ScrollView that scrolls only when it must; it was a clipped View) and nothing else (`mandatoryCaptureBanner`'s partial `react-native` mock now works because `AppText` reads `Platform` defensively).

## Offline states: requests that really end on a phone, and tab icons you can see (branch `fix/offline-states`)

**The bug (real phone, Blackview Fort 200, Expo Go, local backend off).** Home's Stats / Recent Games and the Analysis list still spun for more than 20 s and never showed "Can't reach the server", although the earlier branch's tests passed.

**The exact cause.** With `EXPO_PUBLIC_USE_ONLINE_BACKEND=false` Expo Go calls `http://<laptop LAN IP>:3000` (the host the bundle came from). With the laptop's backend off, or its firewall dropping the packets, nothing refuses the connection: the request just hangs. The client then did, per request: 12 s timeout, wait 3 s, 12 s, wait 6 s, 12 s = **45 s** before the first error, and even a plain refusal cost **9 s** of back-off. Not the cause: the timer covering only the body (fixed on the earlier branch), a missing AbortController (RN honours it and the code raced a timer as well), a socket wait (these screens use HTTP). The earlier tests used fake timers and a mocked fetch, which skip the waiting, so they could not see it.

**The fix.** `src/api/client.ts`: ONE budget per request, `REQUEST_DEADLINE_MS = 6000`, covering connect, headers, body and the retry; one quick retry (1 s) only for a try that failed at once (refused / unreachable / DNS), never after a hang. Writes nobody waits for (game save, rating sync, puzzle mark: `background: true`) keep the patient old policy (45 s, 3 tries) so a cold Render backend still gets them. Socket requests that wait for an answer go through `emitWithin` (`src/api/socketAck.ts`, 6 s; a bare `emit` with an ack on a socket that never connects is never answered): Spectate list, Spectator game, Tournament standings / create / join / start, Challenge create / join. Tournament standings and the Spectator game gained a Retry. One Diagnostic Log line per failed request: `[api] GET 192.168.1.5:3000/games failed: no response, 6004 ms, 1 try` (host, kind - `no response` / `the body stalled` / `network error "..."` / `HTTP n` -, elapsed, tries; never the token, a body or a query).

**Measured with real servers (VM, `apiOfflineRealServers.test.ts`, `scripts/browser/offline-servers.mjs`), old client -> new client:** refused port 9.0 s -> 1.0 s; accepts and never answers 45.0 -> 6.0; headers then stall 45.0 -> 6.0; half a body then stall 45.0 -> 6.0; non-routable 10.255.255.1 40.5 -> 6.0; DNS failure (`.invalid`) 9.0 -> 1.0. In the browser (`scripts/browser/offline-states-e2e.mjs`, the real web build against a server switched between the modes while the page is open): Home, the Analysis list and the leaderboard show the error in 1.3 s (refused) / 6.3-6.4 s (the rest, build and page overhead included), and Retry shows the data once the server is back.

**Tests.** `apiOfflineRealServers.test.ts` (node, real servers and clock, 12), `offlineScreens.dom.test.tsx` (the real Home, Analysis list, leaderboard and Spectate list rendered against the real client / real socket.io and the same servers, 5), `offlineSockets.dom.test.tsx` (the socket screens against a recording socket, 11), `apiRequestDeadline.test.ts` (the budget to the millisecond with fake timers, literals, 19), `socketAck.test.ts` (10), `tabIcons.test.ts`, the browser end-to-end `offline-states-e2e.mjs` (15 screens x modes, run by hand: it builds the web app). Mutation: `scripts/mutation/configs/offline-states.config.cjs`.

**Gates (VM, Node 20.20, Chromium 1243):** `tsc` clean; vitest **1622 / 1622, 96 files**, the four goldens untouched; the full device matrix **20880 checks, 0 failed, 0 of 29 screens affected** (720 combinations per screen, 1.6 ks with 3 workers) and `--self-test` green; the new tests (84 in 8 files) **10 / 10 runs plus once under four CPU-burning processes**, all green; browser end-to-end exit 0 (table above); mutation (`offline-states.config.cjs`, 54 mutants, three chunks of 73-331 s, one at a time): **53 killed, 1 equivalent** (`attempt <= retries`: past the last retry the wait is `NaN > 0`, never scheduled - pinned by the timer-count assertion of the patient-policy test). Survivors found on the first pass and killed: a helper that waited for a call that never settles (a hang instead of a failure), a source scan that matched `colors.text` inside `colors.textSecondary`, a pattern that was not unique.

**Tab icons.** The Home tab's `♟` is an emoji-font glyph on Android: fixed black, almost invisible on the dark bar whatever the text colour. The four tab icons are now drawn vectors (`TabIcon.tsx`, react-native-svg) in `colors.text` (active) / `colors.textSecondary` (inactive), both >= 3:1 on the bar in both themes (`tabIcons.test.ts`). The Android device matrix gained a `contrast` check (`android-matrix-checks.mjs`): an element marked `data-matrix-glyph` must have its ink, composited with its opacity over its background, at >= 3:1 (`CRITERIA.minGlyphContrast`) and be a drawn path; a screen that declares `glyphs: 4` (home, puzzles, analysis, more) must show four marked icons, so an icon that loses its mark is reported. `--self-test` covers the old black pawn, `#999` on white (2.85:1), an icon made faint by opacity, a see-through bar, a text glyph and a missing icon.

**Diagnostics in release builds / the text-fit check.** More > Diagnostics is NOT behind `__DEV__`: it is in every build, release included. "Run text-fit check" did not reproduce the clipping on the phone (6/6 and 6/6) but it costs nothing, runs only when tapped and writes two log lines: it stays as the on-device way to see a recurrence.

## Log in on a sleeping server, and "Server is starting up…" on the read screens (command #27b, branch `fix/offline-states`)

**The problem.** Branch #27 put EVERYTHING a person waits for - Log in and Sign up included - on the 6 s budget. The deployed backend (Render free tier) is asleep after a quiet period and takes "50 seconds or more" to answer the first request, so a person who logged in after a quiet period always saw an error.

**The policy (`src/api/client.ts`).**
- *Sign-in* = log in, register, the session check (`getMe`): `AUTH_POLICY`, **60 s in all**, on every backend. One try may wait the whole minute (Render holds the connection until the service is up); a try that FAILED - a rejected fetch (reset, refused, DNS) or a 502 / 503 / 504 from the gateway - is retried after 1, 2, 4, 8, 8 ... s while budget is left; a 4xx or a 500 is the app's own answer and is never retried. The error at the end of the minute says "The server did not answer in a minute. It may still be starting up - please try again." (a gateway that never recovers: "The server is still starting up..."). The app's startup session check reads SecureStore only (no request) and there is no token-refresh endpoint, so nothing else needed the patient path; `getMe` has it for when it is used.
- *The screen* (`SignInWaiting`, `useSignInRequest`, Login and Register): Cancel from the first moment; after 5 s (`AUTH_WAKING_NOTICE_MS`) the in-place message "Waking up the server… this can take up to a minute"; Cancel aborts the try in flight and ends the call as a `CancelledError` (no error text); leaving the screen cancels too.
- *Never more than one sign-in in flight*: a second call while one runs is refused at once, without a request ("A sign-in is already in progress..."); Cancel frees the slot in the same instant.
- *One Diagnostic Log line per failed try*: `[api] POST host/auth/login failed: no response, 60004 ms, 1 try` / `network error "..."` / `HTTP 503`, the running total and the try count; a cancel writes `cancelled by the person`. Never the email, the password or the token.
- *No second account*: the server is NOT idempotent (check, then insert; a repeat is a 409). The client guards: a register whose answer may have been lost (the minute ran out, Cancel, a reset, a 5xx) is remembered by (email, username); the next 409 for the same pair, or a 409 that follows a failed try of the same call, signs in with the SAME password instead - it succeeds only for the account this person just made - and otherwise reports the 409. (Backend finding, not changed here: two registers racing past the `findFirst` check would end in an unhandled unique-constraint error; the one-at-a-time slot makes it unreachable from the app.)
- *Read screens* (Home, Analysis, Leaderboard, Spectate, Tournament standings: `LoadFailed`, `logic/serverStartup.ts`): on the LAN / local backend nothing changes (6 s, "Can't reach the server", Retry). When the app points at the ONLINE backend and a load fails with no answer the block says "Server is starting up…" and tries again by itself 3, 6, 10 and 15 s after each failure (the last try starts before 60 s after the first failure and ends at about 64 s after the screen opened), then settles on "Can't reach the server" + Retry; the Retry button is there throughout and starts a new minute. An answer from the server (a 4xx / 5xx message) is not a sleeping server: its own words, no automatic try.

**Measured with REAL servers and the real clock** (`apiAuthRealServers.test.ts`, `scripts/browser/auth-servers.mjs`): a server that answers only after 40 s -> logged in after **39.9 s**, waking notice at **5.0 s**, ONE request, never two open; a port that REFUSES for 40 s and then starts -> logged in after **47.1 s** (8 failed tries, 8 diagnostic lines, each with the host and no credentials); a server that never answers -> the clear error at **60.0 s**, one notice, one line; 503 for 6 s -> logged in after **7.0 s**, 3 lines; Cancel -> the held request is really closed by the client, the call ends as a cancellation, the next sign-in is sent; a second sign-in while one runs -> refused, the server saw one request; register: answer lost (Cancel / connection reset) -> the retry signs in, **one** account on the server; another password -> the plain 409. Rendered against the same server (`signInWaking.dom.test.tsx`, a 7 s hold): Cancel shown at once, message after 5 s, signed in at 7 s, Cancel = no error and the socket closes, leaving the screen closes it, a wrong password is still the server's sentence.

**Tests.** `apiAuthPolicy` (fake timers, the numbers as literals: 60000 / 5000 ms, the retry schedule 0, 1, 3, 7, 15 ... 55 s, ten tries, the error at exactly 60000 ms, 502 / 503 / 504 retried and 400 / 401 / 404 / 408 / 409 / 429 / 500 not, one line per try, Cancel at every point, the slot, the register guard in every branch), `serverStartup` (the plan to the millisecond), `serverStarting.dom` (the block: starting up, four tries, then the plain message, Retry starts a new minute, a re-render does not restart the timer, leaving cancels, local backend never retries), `signInWaking.dom`, `apiAuthRealServers`. The old "log in is NOT patient" pin of `apiRequestDeadline.test.ts` was changed on purpose.

**Matrix.** Login / Register stay in the device matrix (More > Log in). The waking state needs a request in flight, which the matrix (no backend) does not have; its layout is a centered column of one message and a 44 dp Cancel (`SignInWaiting`) and is pinned rendered.

**Gates (VM, Node 20.20, Chromium):** `tsc` clean in both repos; vitest **1702 / 1702, 102 files**; the goldens untouched (`git diff d5c9b4e..HEAD -- src/logic/__tests__/fixtures` is empty); the backend is untouched (no mirrored file, no backend suite affected); the full device matrix **21420 checks, 0 failed** over all 29 screens (the first run had 3 `page.goto` timeouts of the Home screen while the web bundle was still compiling under three workers; Home re-run alone in the full profile: 720 / 720) and `--self-test` green; the new fake-timer / rendered tests (84 tests in 5 files) **10 / 10 runs plus once under four CPU-burning processes**; the real-server rendered test (6) **10 / 10**, the real-server node test (9) **3 / 3**, both together once under load (15 / 15).

**Mutation** (`scripts/mutation/configs/sign-in.config.cjs`, 100 mutants in five chunks of 371-578 s, one at a time, run from the harness on paired/bughouse with `MUTATION_ROOT`): the first pass left 15 survivors and one pattern that did not apply; each was killed by a test (a 404 / 408 / 429 is not retried; a Cancel during the wait between tries leaves no timer; a cancelled sign-in that finishes late does not free the slot of the one that replaced it; the session check is refused while a log in runs and the other way round; the register guard: the log in carries the email, the pair is compared without case, another username or email is another pair, a 400 or a success clears it; the hook reports and clears "waking"; the plan counts from the FIRST failure; the latest Retry function is the one called; a Register Cancel shows no error) - **98 killed, 2 equivalent**: `onWaking` reaches a request only through `authRequest` (pinned by the scan test "the waking notice belongs to the sign-in alone"), and the hook's reset at the START of a run (its finally already clears it; the finally's own mutant is killed).

**Hand-check on the phone** (Expo Go, `EXPO_PUBLIC_USE_ONLINE_BACKEND=true`, after the server has been idle for 15 minutes): More > Log in with a real account: Cancel is there; after 5 s the message appears; after up to a minute you are logged in. Cancel mid-way: no red text and the button works again. With the server awake: Home / Analysis / Leaderboard load; with it asleep they say "Server is starting up…" and fill in by themselves.

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
  merely empty (and not under the duck). Fog of War follows the same rule since §22 (it used to inherit chess.js's
  attack-based restriction, which was a bug).
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
game ›", which reopens the screen with `resume: true` (rejoin at once). An app restart or a web refresh used to forget it, as the decision said; since §25 the record is persisted and a restart rejoins the seat.

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

**Mutation check on the merged code (CHECKLIST §2; on a copy).** 24 bugs planted in the rules (start position and pawn count, the first-rank double step: rank-2 / landing-square blockers, rank restriction, landing rank, en passant after it; the winner rule and the horde count; promotions; en passant in the move list), the engine (the double step as a target and as a
move, pawn-only and White-only, the empty-horde game over, the legal-move count, the draw rules) and the pickers. **First pass 20 killed, 4 survived — all four real gaps**: nothing pinned that the move LIST reports an en passant capture as a capture; that a first-rank double step can be captured en passant; that the double step is a pawn rule (a knight on b1 must not
reach b3); or that a position with no White piece is game over with BLACK to move. Closed by `hordeEngine.test.ts`: **24/24 killed, 0 equivalents.** The backend half (12 server mutants, also 12/12) is the backend's `TESTING.md` §22.

## 20. Crazyhouse — scope, decisions and known limits

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
  that library behaviour changes). The server side was mutation-checked separately, see the backend's TESTING.md §23.

**Known limits**
- Threefold repetition is never detected (every screen rebuilds the engine from the FEN; see TODO.md).
- The bot is a shallow heuristic (a one-reply look-ahead): it plays legal, sensible Crazyhouse but is not trying to be strong, and it
  does not plan sacrifices that bank pieces.
- Analysis of a Crazyhouse game is unavailable (Stockfish cannot read a reserve); history shows the saved PGN with `P@e5`-style drops.

**Mutation check on the merged code (CHECKLIST §2; on a copy).** 21 bugs planted in the rules (a capture not banked / banked for the wrong side / a captured promoted piece banked as itself / the en passant victim's square; the promoted marks of a moved piece, a captured one and a castling rook; a drop that costs nothing, lands on an occupied square, uses an empty reserve, puts a pawn
on the first or last rank, ignores a single check, blocks the wrong squares, or answers a double check; the notation; the move list's en passant capture and promotions), the engine (the legal-move count with the drops), the online restore (the rejoin reserves, the ack reserves) and the picker. **First pass 18 killed, 3 survived: 1 real gap, 2 equivalent.** The gap: nothing pinned that the move LIST reports an en
passant capture as a capture; closed by `crazyhouseEngine.test.ts`. The two equivalents are documented inline in BOTH mirrored copies of the shared rules block (the no-drift test compares them byte for byte): a double check cannot be answered by a drop because `crazyhouseCheckInfo` already returns an empty block list unless exactly one piece checks, and the pawn taken en passant is never a promoted
piece, so which of its two squares is looked up in `promoted` makes no difference. **19 killed, 2 equivalent, 0 survivors.** The backend half is the backend's `TESTING.md` §23.

## 21. Browser verification of the online variants (2026-10-17, after Spell Chess / Horde / Crazyhouse landed on master)

Done in the built-in browser pane (390x760, logged in as the project owner) against the dev backend on `:3000` and a clean `npx expo start -c`, with scripted GUEST sockets as the opponent (no second account):

- **Spell Chess, a whole online game** against `npm run spell-opponent` (challenge, joined by code): 44 moves, ended by checkmate (44.Rxd8#) ("You Lost" card). Freeze and Jump were cast from the UI by both sides (the bar shows the side to move's charges: 5/2 at the start, 0/0 once both were spent), frozen pieces refused to move, the move list showed every cast (`F@e1`, `J@a6`, ...).
- **Rejoin.** The connection was dropped mid-game while an opponent Freeze was pending against the player (`socket.io.engine.close()` on the app's own socket): the screen showed "Connection lost - trying to reconnect...", a new socket id appeared, and the restored state was identical - charges (4/2), the whole move list with its casts, and the frozen zone (a frozen bishop still refused to move after the rejoin). **A page reload cannot rejoin**: the 2-player rejoin token lives in memory only (the app opens on the home screen, the seat is forfeited after the 45 s grace), the same decision as for 4 Player (TODO.md).
- **Pickers.** Horde and Crazyhouse appear in Quick Match and in Create Challenge. Horde was queued and played (10 plies with captures, a check and a king capture; every move accepted), Crazyhouse was played by challenge (three drops of its own, the opponent's drops shown as `P@f4`, the reserve chips) and by quick match; Classic online started and played.
- **Local regression.** 4 Player Chess (Free-for-All) and 4 Player Giveaway (Local) render 64 labelled squares, Red moves, the bots answer, and Giveaway shows "must capture".
- The guests were scripts outside the repo, except `npm run spell-opponent`; they refused nothing (0 refused moves in the Horde and Crazyhouse games).

## 22. Fog of War castling — the rule, who decides it, the information-leak audit (nightly #18 / backend issue #12)

**The rule (written before the code).** chess.com, "What is Fog of War chess?": *"Players are not notified when their king is in check and are not required to move out of check … the king can castle while in check, and can castle through, or into check."* So in Fog of War a castle is legal when, and only when: the king is on e1/e8 and the rook on its corner, **both still carrying the castling right**; the squares **between** them are empty (f,g kingside; b,c,d queenside); and the target squares are free. **No attacked-square condition of any kind** — out of, through and into check are all allowed. (King capture is the win condition, so there is no "check" to respect.)

**Why it was a bug and a leak.** The pseudo-legal API (`ChessEngine.getPseudoLegalMoves/movePseudoLegal`, Fog of War's move primitive on the client AND in the server's `RoomChessEngine`) is chess.js's `_moves({ legal: false })`, which drops the king-safety filter for every move EXCEPT castling: chess.js still withholds O-O/O-O-O when the king is in check or crosses/lands on an attacked square. The client generates from its fog view (hidden attackers are invisible there), the server from the true board — so the client offered e1-c1 and the server answered "Invalid move." purely because a piece the player cannot see attacked the king (game 171 ply 42: hidden bishop b4). The refusal told the player "a hidden piece attacks your king" — exactly what Fog of War hides, and a plausible cause of the old unreproduced "Fog of War online information leak" report (backend TESTING.md §4).

**Chess960 + Fog of War:** not combinable and cannot be reached — `VariantSelector` is a single choice and the server's `conflictingVariantError` refuses `isFogOfWar` together with any other variant flag; `movePseudoLegal` has never handled Chess960 castling. So there is no Chess960 Fog of War castling to specify (the helper below assumes the classical e-file king and a/h-file rooks).

**The fix — one place per engine.** `addUnrestrictedCastles` (ChessEngine.ts; byte-identical twin in the backend's RoomChessEngine.ts, checked by `backend/scripts/test-fogOfWarCastling.mjs`) adds back every castle chess.js withheld for attack reasons. `generateRaw` uses it for Duck Chess (with the duck's obstruction, as before) and now for the plain pseudo-legal path — i.e. Fog of War, whose engines are built with `skipValidation` and nothing else. Spell Chess is the one other user of that API (its freeze-escape move) and keeps chess.js's castling; Giveaway still drops castling entirely; ordinary `move()` / `getLegalMoves()` are untouched. Because every caller goes through `generateRaw`, every decision point follows automatically:

| Place | Before | After |
|---|---|---|
| `ChessEngine.getPseudoLegalMoves` (client; also visibility, `redactMoveHistory`, `useIncrementalFogRedaction`) | chess.js attack rule applied to castling | no attack condition |
| `ChessEngine.movePseudoLegal` (Local, Bot, Online mover, Online/rejoin replay engines, premove) | refused castling in/through/into check | accepts |
| `ChessBoard` legal targets / tap (`fogOfWar` → `getPseudoLegalMoves`) and `tryMove` | castle target missing when the *visible* position had an attacked square | offered in all three cases |
| `ChessBoard` / `OnlineGameScreen` / `BotGameScreen` premove validation (`premoveEngine.movePseudoLegal`) | same | same as above |
| `fogOfWar.ts` `getVisibleSquares` / `redactMoveHistory` | derived from the old generator (a replayed castle in check would desync) | follows the new generator (visible set unchanged: the rook already sees both targets) |
| Bot (`BotGameScreen`, Stockfish) | could never castle in/through/into check (Stockfish plays ordinary rules) | `chooseFogOfWarExtraCastle` runs after the king-capture check and before Stockfish |
| Server `RoomChessEngine.generateRaw` / `movePseudoLegal` / `getPseudoLegalMoves` | refused (the leak) | accepts; byte-identical helper |
| Server `rooms.ts` `applyMove` | unchanged — delegates to `movePseudoLegal` | unchanged |

**The Fog of War bot.** Stockfish cannot suggest these castles, so `chooseFogOfWarExtraCastle` (bots.ts) looks at the castles the rules allow here but ordinary chess forbids; it only considers one that leaves the king on a square the opponent cannot capture next move. Out of check onto such a square it is always taken, any other qualifying castle with probability 1/2. Stockfish decides everything else (including the ordinary castles).

**Tests.** `src/logic/__tests__/fogOfWarCastling.test.ts` (32): out of / through / into check on both wings and both colours, the exact end positions, game 171's two views, everything that still forbids a castle (rights, blockers on b/d/f/g, rook gone, a knight or the enemy king on e1), visibility unchanged, the ordinary engine / Spell Chess / Giveaway unchanged, no duplicate castle, the bot helper and where `BotGameScreen` calls it. Server side: `backend/scripts/test-fogOfWarCastling.mjs` (61 checks: a no-drift check, the exact game-171 position through `RoomManager.applyMove`, client/server parity over ~4000 random castling-rich positions, and a **strict no-leak property** — for ~6000 random true positions every move the player's own redacted view offers is accepted by the server except a quiet pawn push) and `test-multiplayer.mjs` §13b (two scripted real-socket games: O-O through a check from a hidden bishop on a6, O-O-O out of a check from a hidden bishop on b4). The nightly online fuzz now picks a castle half the time one is available and fails with the dedicated kind `server-refused-legal-fow-castle` if the server ever refuses one — **never whitelist it**.

**Mutation check** (copies only): 20 client/bot mutants (the check condition back, one wing only, rights / rook / between-squares / b-file / king ignored, wrong rank, duplicate, wrong flag, Spell Chess let in, the duck's obstruction dropped, the bot's filters / dice / wiring) and 15 server mutants (the same plus drift and `rooms.ts`) — all killed (the two Duck-obstruction mutants by `duckChess.test.ts` / `test-duck.mjs`, which share the helper). The headline server mutant is also killed by the real-socket e2e on its own.

**Information-leak audit — every reason the server can refuse a Fog of War move** (`rooms.ts` `applyMove`; `socketHandlers` forwards `make_move` untouched):
1. *No active game for this connection* / *the game is no longer active* — the caller's own session state.
2. *It's not your turn* — the turn is public (it is in the redacted FEN).
3. *Invalid move* for a `drop` (Crazyhouse only) or `promotion: 'k'` (Giveaway only) — a function of the payload and the room's variant flag.
4. *Invalid move* from `movePseudoLegal` returning null: no own piece on `from`; the shape is not that piece's; the target holds an own piece; a slider's path is blocked (the first blocker is always a capture target, hence visible to the mover, so the client already knows); a castle whose right is gone / rook missing / between-squares occupied (all own pieces or squares the king and rook see) — and, since the fix, nothing about attacks; a wrong promotion piece (the client chose it). **All of these depend only on the mover's own pieces, the rules, and squares the mover can see.** `test-fogOfWarCastling.mjs` §5 checks it as a property: 0 other refusals in ~236k offered moves.
5. **The accepted exception:** a quiet pawn push (one or two squares) into/through a hidden enemy piece is refused — chess.com does the same.

*Reported, not changed here:* (a) a modified client could also send a pawn **capture** to a fogged empty square and be refused — the other half of the same pawn-blind bit; only a client that deviates from what the app offers can do it (an honest client's generator never produces it), and it is inherent to any server-validated Fog of War. (b) **A genuine, separate, pre-existing leak — FIXED in §23: the SAN carried chess.js's `+`/`#`**, computed on the TRUE board; Fog of War's `movePseudoLegal` does not strip it (Duck/Giveaway do). Reproduced: `4k3/6b1/8/8/4N3/8/8/4R1K1`, White plays Ne4-c3 (a discovered check from the hidden rook e1): Black's `opponent_move` carries "Nc3+" while Black's redacted FEN shows no rook — Black is *notified of a check by a piece it cannot see*, which chess.com does not do. The mover's own ack is harmless (they attack the king, so they see it); `#` additionally says the opponent has no legal ordinary reply. Tracked in TODO.md.

## 23. Fog of War never announces a check — the notation ("Nc3+") leak

**The rule (written before the code).** chess.com: *players are never notified of check* in Fog of War. So during a LIVE Fog of War game no player-facing text, sound, haptic or highlight may carry a check computed from the true board. chess.js writes `+`/`#` into every SAN from the true position, so a discovered check by a piece the victim cannot see reached them as `Nc3+` (and as a heavy "you checked them" haptic — `haptics.ts` reads the suffix). **Decision:** live player-facing views never show `+`/`#`; spectators (who see the whole board) and the saved PGN of a finished game may show the real notation.

**Where Fog of War notation is produced and who sees it** (audit; "before" = the marker was shown):

| Place | Before | After |
|---|---|---|
| Engine `movePseudoLegal` (client `ChessEngine`, server `RoomChessEngine`) — the one producer of every Fog of War SAN | `Nc3+` | `san: "Nc3"`, real text in `trueSan` (server-only use) |
| Local (pass-the-device) move list, last-move text, history | shown | none (reads `san`) |
| Bot game move list, last-move text, history | shown | none |
| Online player view: move list, last-move text (own moves via ChessBoard, opponent's via the replay engine) | shown | none; plus `OnlineGameScreen` strips the marker from the server's SAN too (an older server) |
| Server → mover `make_move` ack `san` | `Nc3+` | `Nc3` |
| Server → opponent `opponent_move.san` | `Nc3+` — the leak | `Nc3` |
| Server → rejoining player (`redactedMovesFor` → `redactMoveHistory`) and the client's `redactMoveHistory` / incremental redaction | shown | none (they copy `san`) |
| Server → spectator `spectator_move`, `spectate_game` state | `Nc3+` | `Nc3+` — unchanged on purpose (`trueSan`, no `trueSan` field on the wire) |
| Saved PGN of the finished game (`persistGameResult`) | `Nc3+` | `Nc3+` (built from the real notation) |
| `game_over` payload | no SAN | no SAN |
| Haptics (`triggerMoveHaptics` reads the suffix: Heavy on `+`) — own move, opponent's, bot's | Heavy buzz on a check | Light/Medium like any move, for mover and victim alike |
| Move sounds (`moveSounds.ts`: move / capture / castle only) | no check sound exists | unchanged (a test pins it) |
| Check highlight on the king, "Check!" status text | already off in Fog of War (`usesPseudoLegalMoves`, `!fogOfWar` guards) | unchanged |
| Post-game card / Game Review / Local+Bot history export | shown | no marker either: Fog of War has no check, so the client keeps `san` as is (`trueSan` is stored but unused there) |

**Implementation.** `fogOfWarNotation.ts` (`stripCheckSuffix`, `hideCheckFromPlayers`) is byte-identical in the backend (`backend/scripts/test-fogOfWarNotation.mjs` compares the files). `movePseudoLegal` applies it on the plain pseudo-legal path = Fog of War — the same "derived, no flag" rule as the castling fix; Duck Chess and Giveaway already stripped it themselves, Spell Chess (freeze-escape) keeps its real check notation, and ordinary `move()` is untouched. The server stores `trueSan` in `room.moves` and gives it only to spectators and the PGN.

**Tests.** `fogOfWarNotation.test.ts` (16): the helper, the exact repro (`4k3/6b1/8/8/4N3/8/8/4R1K1`, Ne4-c3 → `Nc3` / `trueSan Nc3+`), a check, a mate, a promotion with check, a castle with check, the variants that must not change, a property over 200 random games (no `san` ever carries a marker, `trueSan` is exactly `san` + marker), the haptic channel and the sound channel, and the Online-screen guard. Server: `backend/scripts/test-fogOfWarNotation.mjs` (35) + `test-multiplayer.mjs` §13c (real sockets: `1.e4 d6 2.Bb5+` → mover and Black get `Bb5`, a spectator `Bb5+`, a live rejoin `Bb5`, nothing addressed to a player holds a marker or a `trueSan`) + the nightly online fuzz (strict: any marker in an ack or `opponent_move` is the failing kind `fow-check-notation-leak`). **Mutation** (copies): 12 client/screen mutants and 12 server mutants (the suffix back, Spell Chess stripped, `+`-only / `#`-only, no-op helper, `trueSan` lost/always set, opponent / ack sent the real notation, spectators / spectate state / PGN not restored, `trueSan` left on the wire, rejoin history real) — all killed; the headline server ones are also killed by the real-socket e2e alone.

**Point (a) from the castling report — a pawn capture onto a fogged empty square from a modified client.** The official app can never send it: its generator only offers a pawn capture onto a square that shows an enemy piece in the player's own view, and the server accepted all 3215 such captures offered over 3000 random positions. The refusal is `{ ok: false, error: 'Invalid move.' }` — the same text and the same shape as every other malformed move (a b-pawn to b6, a move from an empty square, a bad square name, a null move), produced by the same `movePseudoLegal` scan (~37 µs vs ~40 µs per refusal in-process, which is not observable over a socket). The same probe onto a hidden enemy piece is a legal capture and costs the turn. So the remaining bit is the one every server-validated Fog of War has — a modified client learns that a *specific* pawn move is illegal — and is the other face of the accepted blind-push; no code change.

## 24. Threefold repetition — one rule for every two-player mode

**The rule (written before the code).** chess.com ends a game automatically as a draw when the same position occurs three times (not necessarily in a row; [support: "How do draws work?"](https://support.chess.com/en/articles/8572743-how-do-draws-work) — automatic in Live *and* Daily). One rule for Classic, Chess960, King of the Hill, Three-Check, Setup Chess, Fog of War, Giveaway, Atomic, Duck Chess, Horde, Crazyhouse and Spell Chess, in Local, vs Bot, Engine vs Engine and Online: **an automatic draw when the same position occurs 3 times with the same side to move, the same castling rights and the same en passant possibility.** The end reason is `'repetition'` ("Draw by repetition" in the status line, "by Repetition" under the summary title) everywhere — client, server `game_over`, and the result `1/2-1/2` stored in history / PGN.

**What "position" means per mode** (`repetitionKey(fen, extra)` in `repetition.ts`):

| Mode | Position = |
|---|---|
| Classic / Chess960 / King of the Hill / Setup Chess / Giveaway / Atomic / Horde / Fog of War | placement + side to move + castling field + en passant square **only if a pawn of the side to move stands beside the double-stepped pawn** |
| Three-Check | the above + the check counters of both sides |
| Crazyhouse | the above + both pockets + the promoted-piece squares (a promoted piece reverts to a pawn when captured, so it is part of the position; the set is compared order-independently) |
| Duck Chess | the above + the duck's square (so the start position, with no duck, never recurs; the first position that does is the one after ply 1 — the third occurrence of that comes at ply 9, not 8) |
| Spell Chess | the above + the whole spell state: charges, cooldowns, the pending freeze (frozen squares, as a set) and the pending jump |

The move clocks are never part of a position. *Known approximation:* the en passant square counts when a capturing pawn is merely adjacent (no pin/legality test); at worst that delays a draw by one cycle in a pinned-pawn corner, and chess.js's own detector (still consulted by the server for its other draws) never fires earlier in practice.

**Fog of War — decision needed (implemented as option A, flagged).** I could not find a chess.com rule for repetition in Fog of War: the [Fog of War help article](https://support.chess.com/en/articles/8708650-what-is-fog-of-war-chess) only says the game is won by capturing the king, and the generic draws page does not mention it (a search summary of an academic paper on Fog of War endgames says threefold repetition is host-enforced; I did not verify it). Does a repetition draw leak hidden information? The draw is judged on the TRUE position (the server's own engine; the Local/Bot screens hold the whole board). It is announced only when the game ends, and the announcement says nothing a player can use — the game is over; the *absence* of a draw when a player's own view has repeated reveals nothing either, because every turn already tells you "a hidden move happened". So: **A (implemented): count the true position in Fog of War like everywhere else**; **B: no repetition draw in Fog of War** (matches "king capture is the only way it ends", but a Fog of War game could then only end by clock). Switching to B = skip the check for Fog of War in `rooms.ts` (`repeated`) and in `isRepetitionDraw` callers (2 places + the tests that list Fog of War).

**Design.** `repetition.ts` (byte-identical in the backend; `backend/scripts/test-repetition.mjs` compares) holds the key, `repetitionExtra`, `repetitionCount`, `isThreefoldRepetition`. The screens never track a counter: `repetitionHistory.ts` rebuilds the list of keys from `history` (initial position first, then each `fenAfter` with that ply's variant state) — so it survives the per-render FEN rebuild (chess.js cannot count repetitions on a rebuilt engine), is right after **Undo** and position review by construction, and is the same list the server keeps in the room (`room.repetitionKeys`, appended after every move; it also survives a **rejoin**). `getGameOutcome(..., repetitionDraw)` ranks it behind every decisive result and behind agreement / resignation / timeout. Atomic's old `isAtomicThreefoldRepetition` is no longer used by the screens or the server (kept for its oracle test). The server checks repetition *before* chess.js's own `isGameOver()` in each branch, so its reason is `'repetition'` and not `'draw'`.

**Ratings / history / achievements (corrected after review: the first version of this paragraph wrongly said the app has no rating system).** A repetition draw is an ordinary draw everywhere downstream. The stored result is `1/2-1/2` (PGN result tag); the end *reason* is not persisted (history rows keep result + PGN only), so the History / Home labels ("Draw") read the result. Ratings are the on-device per-category Elo (Bullet / Blitz / Rapid, `recordRatedGame`): Bot maps `outcome.result === '1/2-1/2'` to 0.5, Online maps a `game_over` with no winner to 0.5, so a repetition moves the rating by the Elo draw formula, adds a rating-history entry and syncs to the leaderboard like any draw; the variant exclusions are unchanged. Achievements (Giant Slayer, Comeback) are guarded by `result === 1`, so a draw never unlocks them; the streak is an app-open streak and no result feeds it. **A bug found in that review and fixed (`fix/repetition-history`):** `buildGamePayload` (the saved-game row for Local / Bot) did not know about the repetition, so a repetition draw was "not over" there and the game was never saved to the history (Atomic's old repetition draw, which went through `chessStatus`, regressed too). It now takes `repetitionDraw`; `repetitionResults.test.ts` (11) pins the payload, the rating / history / sync flow, the achievement guards and the labels, mutation-checked (9/9).

**Tests.** `repetition.test.ts` (28): the key, the shuffle in 8 modes rebuilt from the FEN each ply, Undo across a repetition, look-alikes that must NOT count (castling rights, en passant, Three-Check counters, Crazyhouse pockets, the duck, Spell charges / cooldowns / frozen squares / pending jump), `getGameOutcome` priorities, the end-reason text, and the wiring of Local / Bot / Engine vs Engine. Server: `test-repetition.mjs` (86 checks: no-drift, every mode through `RoomManager.applyMove` — third occurrence at ply 8 and not before —, look-alikes, rejoin mid-repetition, ply-by-ply parity with `historyRepetitionKeys` incl. 240 random repetition-prone games), `test-multiplayer.mjs` §13d (real sockets: Classic with a reconnect between the second and third occurrence, Fog of War, Crazyhouse), and the nightly online fuzz (Atomic's expectation now uses the shared module; a new section plays the shuffle over real sockets in 9 modes and fails with `repetition-not-declared` / `repetition-too-early`). **Mutation** (copies): 37 client mutants (36 killed, 1 equivalent: the `history.length < 8` guard is only a shortcut — no position can occur three times before ply 8) and 20 server mutants (all killed; the headline ones also by the real-socket e2e alone).

## 25. Rejoin after a page reload / app kill — the app remembers the online game it is in

**The problem.** The rejoin token (`playerToken`, from `match_found` / `four_match_found`) is the only thing that proves a socket owns a seat. It lived in memory only, so a web reload or an app kill during an online game dropped the seat: the 2-player opponent was awarded the win by abandonment after 45 s, and a 4 Player seat went to a bot. (Rejoining after a *dropped connection* inside a running app always worked.) The server side needed no change: `rejoin_game` / `four_rejoin` are keyed by room + token, not by socket, so any new connection holding the token is the seat again.

**What is stored** (`src/logic/activeGame.ts`, I/O in `src/api/activeGameStorage.ts`, same pattern as `authStorage.ts`): one record — the whole `match_found` payload (it carries the starting FEN, variant flags, colour / seat, time control, **and the token**), who it belongs to, and for 4 Player the time control — under the key `active_online_game`, plus a separate secret-free heartbeat number `active_online_game_seen`. **Secure storage:** SecureStore (Keychain / Keystore) on native, AsyncStorage on web (no secure enclave there — the same trust model as the auth session); keys use only `[A-Za-z0-9._-]` (a colon crashes SecureStore on Android). The token is never logged: every `logDiagnostic` line carries the room id and the outcome only (a test captures the log across save / touch / load / clear and asserts the token never appears; another scans the source).

**Lifecycle** (`App.tsx` owns it; the screens only report the end):
- *Saved* when a game screen opens (`onlineGame`, `fourPlayerOnlineGame`) — any entry: quick match, challenge, tournament, 4 Player queue.
- *Heartbeat* every 20 s while a game screen is open (or a 4 Player seat is still held after "Leave"): refreshes `seen` only, never rewrites the secret; a no-op for a game that was cleared.
- *Restored* on start, after the auth session is restored: if the record belongs to the signed-in account and was seen within 6 minutes (45 s grace + the 5 minutes the server keeps a result), and nothing else has been opened yet, the app goes **straight into the game** with `resume: true`. A record of another account, or an older one, is dropped (the dead secret is removed).
- *Cleared* on: game over (a live `game_over`, a result found on rejoin, or the server no longer having the game — `onGameEnded`), resign (the resulting `game_over`), leaving a 2-player game (`onExit`: leaving is a decision), a 4 Player exit without a live seat or "play again", and logout. After a clear, a reload goes to Home. (A 4 Player "Leave" while the seat is live keeps the record, because the menu then offers "Return to your game" and a reload may use it too.)

**How the screen resumes.** `OnlineGameScreen` gets `resume`: it starts in "Reconnecting…" and on mount sends the same `rejoin_game` handshake a restored connection sends (`rejoinNow`, shared with `handleReconnect`) — live state (position, clocks, move list, Spell charges / frozen zone, Crazyhouse pockets, Duck, the Fog of War *redacted* view), or the result of a game that ended meanwhile (shown like a live game over, rating applied once), or "unavailable". 4 Player already had `resume` (the in-session "Return to your game"); it now also receives it from the restore.

**Server confirmation (no server change; 45 s grace unchanged).** `backend/scripts/test-rejoin-persist.mjs` (npm `test:rejoinPersist`, in CI) proves with real sockets and a **real new process** as the restarted app (it has only the saved record, read with the app's own `parseActiveGame`): Classic (live position, full move list, clocks; the opponent sees `opponent_disconnected` then `opponent_reconnected` and no `game_over`; the process hears the opponent's next move; makes its own move; a second restart with the same record also works — the token is not single-use; a forged token is refused, and told nothing about a finished game; a result that arrived while away is reported), Crazyhouse (the pocket), Duck (the duck), Spell (charges + pending freeze), Fog of War (exactly the redacted view, back ranks still in fog), and 4 Player Chess + 4 Player Giveaway (`four_rejoin`: the seat with the room's current snapshot, human again, no bot ever took it; forged token refused). **Secrecy:** no event the opponent, a spectator or another seat received contains anybody's token.

**Tests.** `activeGame.test.ts` (29): record round-trip / refusals / account / window / 6-minute ≥ grace + retention; storage against in-memory SecureStore / AsyncStorage (native vs web, keys, a restart = fresh module, heartbeat semantics, stale and other-account cleanup, a broken store never throws, the token never logged); wiring scans of App.tsx and both screens. `onlineRejoin.test.ts` scans follow the new `rejoinNow`. **Mutation** (copies): 40 client mutants (record validation, resume gate, storage routing / heartbeat / cleanup / logging / key, App restore / save / heartbeat / clears, both screens) — 38 killed, 2 equivalent (`signed out may resume`: `null` never equals a user id; `never seen counts as seen`: `now - null` is already past the window); 15 server mutants (a forged token gets a seat, the new socket not registered, the opponent not told / told the token, Fog of War returning the true board, a variant's state dropped from the rejoin, the finished-game answer to anybody / never, the 4 Player seat to any token) — all killed by the real-socket e2e.

**With threefold repetition (§24).** The server's position list lives in the room, so a restart in the middle of a repetition changes nothing: the real-process e2e plays 6 plies of the shuffle, restarts White's app, lets it play ply 7 and ends the game with Black's ply 8 as a draw by `'repetition'` (Classic, Fog of War, Crazyhouse) - the restarted app is told the reason and shows "by Repetition".

**Browser check** (built-in pane, own Expo on :8082 against the local backend, a throwaway test account created on the local dev app): a real quick-match game vs a guest opponent (1.b4 c6) → the record appeared (token present, heartbeat advancing) → a real **page reload** → the app logged "Resuming a twoPlayer online game after a restart", `rejoin_game succeeded`, and showed the same position, "Your turn", clocks running; e4 was then accepted and the opponent answered (a5); **Resign** cleared the record and a second reload went to Home; the diagnostic log contains no token. (An earlier stale record from an hours-old game was dropped on load.)

**Limits.** Two tabs of the same account would both rejoin and fight over the seat (the last one wins). A tournament game resumes without the standings screen behind it. Physical-device kill/restart (Keystore) is not verified here, only the storage routing.

## 26. Giveaway — "Capture is mandatory" was invisible (2-player and 4 Player)

**The bug (reported on a phone, Expo Go, 4 Player Giveaway).** A capture was forced, so only the capturing pieces could move — the rule was right — but nothing said so: tapping any other piece did nothing and the game looked frozen.

**Diagnosis (every path checked, nothing in the rules was wrong).** The only trace of the rule was a plain, small status *suffix* — " — must capture" (4 Player: `statusSuffix`, `describeStatus`; 2-player: the `mustCapture` strings of Local / Bot / Online) in the normal grey-on-background status text, so it was easy to miss on a phone and it never said *which* pieces could move. It was present on every screen in the right states (Local, Bot, Online, after a bot move, after an elimination), so this was not a "missing on one path" bug but a *discoverability* bug: no highlight, and a tap on a blocked piece was silently ignored (`selectOwnPiece` / `handlePress` simply returned). 2-player Giveaway had the identical gap.

**The fix (frontend only; no rule, bot or server change; the mirrored 4 Player engine files are untouched, so the backend's `sync:fourplayer --check` stays valid).**
- **Status.** `MandatoryCaptureBanner` — an amber pill ("Your turn — Capture is mandatory", "Red to move — Capture is mandatory") that *replaces* the plain status line, never adds a row (the game screens have a fixed height budget and clip overflow; the 4 Player cell-size budget is pinned by a test), so it cannot push the board or be clipped. Amber with dark text in light mode, dark amber with light text in dark mode (WCAG AA, tested); it is not drawn on the board, so every board / piece theme is fine. It shows only when it is the human's turn: Local when the game is not over and not being reviewed, Bot only on the user's turn, Online only while connected, 4 Player Local only for a human seat, 4 Player Online only for the seat that can move; spectators see nothing (nothing for them to do).
- **Ring.** Every piece that can capture gets an amber ring inside a thin dark outline (the outline keeps it visible on every board theme: ≥ 3:1 against both squares of all of them, tested), in `Square` (2-player) and `FourPlayerBoard`'s cell (4 Player; screen readers hear ", can capture (a capture is mandatory)").
- **Tap message.** Tapping one of your own pieces that cannot move while a capture is mandatory shows, for 3.2 s, "A capture is mandatory — highlighted pieces can capture" in the same pill (`useCaptureNudge`; a second tap restarts the countdown; cleared on unmount). The text is smaller (11 px) and the pill keeps the same line height, so it stays one line on a 360 px phone and nothing moves under the finger.
- The sets come from the rules' own lists (`getGiveawayMoves`, 4 Player `legalMoves`) in `giveawayHints.ts` — nothing is decided twice.

**Tests.** `giveawayHints.test.ts` (24): the helpers (2-player: none when nothing is forced, only the capturer after 1.e4 d5, several capturers, a piece that captures twice listed once, Black to move + en passant, the king; 4 Player: only the rook that can capture, several, listed once, walled / eliminated seat → none, none at the start / for another seat / in 4 Player Chess), the wording, the colour contrast, and source scans proving the status, ring and tap message are wired on all five screens and both boards (and not on spectators, and no rule or bot file imports the helper). `captureNudge.test.ts` (3): the hook against a tiny hook runtime with fake timers (appears, expires, restart on a second tap, no timer after unmount). `mandatoryCaptureBanner.test.ts` (4): the rendered element (alert role + label, both wordings, amber light / dark, same height in both states). **Mutation** (copies of the source): 43 mutants (helpers, wording, ring, hook timer, banner, both boards, Square, five screens' conditions and wiring) — 43 killed after adding tests for the 10 that first survived (4 Player duplicates, the hook's timer, the banner, the 4 Player conditions).

**Browser check** (built-in pane, own Expo, both themes; 4 Player Local needed a temporary hand-built position, reverted afterwards): 2-player Local (light, 360x640) and vs Bot (dark, 412x915): amber pill on one 20 px line, ring on the capturers, a tap on a non-capturer shows the message. 4 Player Local Giveaway at 360x640 light, 412x915 light and dark, 360x640 dark: pill 273 px wide on one line, ring on the rook that can capture, a tap on the d3 pawn shows the message on one line (310 px, 19.6 px tall, both states equal). *First version of the message wrapped to two lines at 360 px and pushed the board down 12 px; fixed (smaller text, same line height) and pinned by tests.*

**Not covered.** Chaturaji (a separate variant, handled later). A real phone (Expo Go) was not available here; the web build at phone widths was checked instead.

## 27. Flaky tests under load - what failed, why, and how the timing tests are written now

**What was seen.** One full `vitest run` once failed 1 test of 1197 and passed on the very next run. Ten consecutive runs on an idle machine never reproduced it (10/10 green), so the failing test itself was not identified from that run; it was reproduced by **loading the machine**: three full suites at once (`vitest` already starts one worker per test file, ~65 of them). Under that load **9 of 9 runs failed with 5-8 failures each**, and the failures fall into exactly two causes:

1. **The 5 s default timeout (57 of 60 failures).** About ten tests do real work (random whole games, a 1000-position oracle comparison, 120 bot searches, source scans that read every shipped file) and take 3-5 s even on an idle machine, i.e. they were already at the default limit; a loaded or slow runner doubles that. They failed with "Test timed out in 5000ms" although nothing was wrong.
2. **Wall-clock assertions that compared single timings (3 of the first 60 failures; two more of the same kind showed up once those were fixed: the Horde per-ply max and the snapshot adoption max).** `p99 < 25 ms` per bot decision, "ELO 3000 costs about as little per decision as 1000" (two timings taken at different moments), "max < 250 ms per ply" (Horde), "max < 100 ms per snapshot adoption": one scheduler pause or GC in a busy run produced a 260-480 ms outlier for work that costs a fraction of a millisecond.

**The fix (test code only; no production code changed).**
- `vitest.config.mts` (new): `testTimeout` / `hookTimeout` 30 s. The default is a *hang detector*, not a performance assertion, so it is generous; a test that needs more still sets its own (as before). One explicit budget that was too tight (a 30 s limit on an 18 s test, hordeBot's ELO-dial test) is now 120 s like its siblings.
- Wall-clock assertions are **best-of-N of identical, deterministic work** (N = 3 or 5): a call that always does the same work can only be slowed down by the machine, never sped up, so the minimum is its real cost. The budgets are unchanged (25 ms, 250 ms, 100 ms, mean 5 / 25 ms, "top tier <= 4x careful + 50 ms") - they were not loosened - and where two things are compared they are measured one after the other per position, so a spike hits both or neither. Done in `fourPlayerGiveawayBot` (p99, tier cost), `horde` and `crazyhouse` (per-ply max / mean), `fourPlayerOnline` (snapshot adoption). The other timing assertions (`giveaway`, `atomic`: an average over 200-300 calls with a 10-50x margin; the bot games' total-time bounds) already pass under load and were left alone.

**Proof.** (a) Loaded: 4 rounds x 3 full suites in parallel = **12 of 12 runs, 1197 / 1197, 0 failures** (before the fix: 9 of 9 failing; intermediate states of the fix went 9 -> 1 failure per round and then 0). (b) The tests still fail on a real slowdown (mutation on a copy of the source): a search-like CPU burn for ELO >= 1800 in the Giveaway bot fails "there is no deep tier ..."; ~30 ms burnt per decision fails the p99 test; ~150 ms burnt per snapshot adoption fails "adopts a full-length game of snapshots quickly" (mean 150 ms > 5 ms) - all three killed.

**Cost / limit.** The best-of loops triple the work of those few perf tests (they are still ~1 s). A genuine regression makes them slow *and* fail, the failing run takes minutes rather than seconds because the retries are also slow; nothing is hidden. A machine so loaded that *every* repeat of a sample is slow would still fail - that is by design (it is then not a flake but a machine that cannot run the suite).

## 28. Chaturaji W0 - the geometry and rule-option seam (a refactor: no behaviour change)

**What W0 is.** CHATURAJI_SPEC.md (§8, option G) builds Chaturaji as a third rules preset of the existing 4-seat engine on a second board geometry. W0 is the groundwork and changes **no behaviour**: the 14x14 cross board becomes one `Geometry` object (`buildGeometry({ id, size, isPlayable })` in `board.ts` builds the mask, the ray / knight / king tables, the forward coordinate, square names and the display rotation) and the engine reads the board and four rule **options** (`board`, `pawnDoubleStep`, `castling`, `promotionTypes`) from the state's rules instead of module-level constants. Nothing Chaturaji-visible exists yet (no `CHATURAJI_RULES`, no 8x8 board, no UI, no wire change); that is W1.

**Files** (frontend; the five mirrored ones are regenerated into the backend): `board.ts` (+Geometry, +buildGeometry, +CROSS14, +GEOMETRIES; the old exports are CROSS14's members), `state.ts` (+RuleOptions, FFA_OPTIONS, GIVEAWAY_OPTIONS, optionsOf, geometryOf, KNOWN_RULES, validateRules; blank cells / kings / start / snapshot / listPieces read the geometry), `moves.ts` (`attackers` takes the board as its last parameter, `pseudoMoves` / `pushPawnMove` / `legalMoves` / `applyMoveRaw` read the geometry and the options; the cross rook-start table is consulted only when the rules have castling), `elimination.ts`, `bot.ts`, `premove.ts` (pass the state's geometry). Client-only UI (`FourPlayerBoard`, `presentation`, `annotations`) still reads the cross constants: only the cross board exists.

**Design decisions.** (1) `FFA_RULES` / `GIVEAWAY_RULES` stay value-for-value what they were (a pinned test asserts them with `toEqual`): their options are the *defaults of their mode* (`optionsOf(rules)` = `rules.options ?? FFA_OPTIONS | GIVEAWAY_OPTIONS`), a future preset carries its own `options`. (2) `validateRules` accepts a value only if it equals a shipped preset field for field (key order irrelevant), so no option mix can leak into a game it was not tested with. (3) `initialState` refuses a board it has no start layout for (W1 adds one). (4) `moveLabel` stays cross-only (it is used as `.map(moveLabel)`, so it cannot take a geometry parameter without a trap); W1 names squares through the geometry. (5) The test-only boards (`open14`: 14x14 with no cut corners, `small6`: 6x6, `big16`: 16x16) are registered in `fourPlayerSeam.test.ts` and removed after each test; the validator refuses them.

**Gates (all green).**
- **FFA golden transcripts** (48 seeded games + 9 scenes, hashed from the engine before the Giveaway work): byte-identical. **Giveaway golden** (new, recorded on master *before* any W0 engine edit, committed first: 40 seeded games + 13 hand-built scenes covering forced capture vs 1 / 3 seats, en passant, king capture, capture-promotion, walls, stuck, last piece, last standing, cap tie, no castling): byte-identical. **Geometry identity** (new, also recorded first: 13 sections - constants, mask, 160 playable squares, rays, knight / king tables, isPlayable over the margin, names and parseSquare incl. bad inputs, forward coordinate / step / pawn captures per seat and square, display rotation for all four views, castling layout, both start snapshots): identical. Total frontend: **1258 / 1258** tests in 70 files (was 1197 / 67 before the gates and seam), `tsc` clean, `getFourPlayerCellSize(360, 640) === 21`.
- **Seam tests** (`fourPlayerSeam.test.ts`, 30): the golden tests cannot see whether the engine really reads the geometry from the rules (with only the cross installed every read returns the same thing), so these run the engine on the three test boards: tables / names / rotation, snapshot rows and cell arrays, sliders / knights / kings / pawn captures / double step / promotion line and types / castling option / en passant square / walking dead king on a non-cross board, attack detection next to a corner, checkmate credit through `advance` and `mateCredit`, the bot's evaluation and hanging-piece test, promotion premoves, and the validator.
- **Mutation** (copies of the source): **47 mutants of the seam** (geometry builder arithmetic, every module-level 14 / cross table that could survive a read, options ignored, start / snapshot / listPieces / stateFromPieces, validator, every `attackers` argument, pawn / castling / promotion / en passant / dead-king reads, elimination, bot, premove) - the first run left 6 alive (kings found beyond the cross cell count, the knight table in attacks, pawn captures near a corner, castling generated despite the option with rights given by hand, the castling path attack test, the defender test of the hanging-piece check); a test each, then 47 / 47 killed.
- **Hot-path benchmark** (`scripts/bench-fourplayer.ts`; baseline recorded on the unchanged engine in `scripts/bench/fourplayer-baseline.json`): this machine is a busy Windows desktop and one *process* is one JIT history, which alone moves a workload by 10-20% (per-process minima of the same code spread 6-44%), so a single before / after run cannot resolve 5%. The comparison is made across processes (`scripts/bench/ab-procs.sh`, `ab-stats.cjs`): **30 pairs** (baseline tree vs this tree, alternating order), median of the per-process best times, bootstrap 90% interval of the ratio:

  | workload | baseline ms | W0 ms | ratio | 90% interval |
  |---|---|---|---|---|
  | FFA legalMoves | 125.5 | 128.0 | 1.020 | 0.969..1.073 |
  | FFA isInCheck | 58.5 | 60.8 | 1.040 | 1.003..1.088 |
  | FFA playMove | 89.7 | 89.0 | 0.992 | 0.944..1.047 |
  | FFA bot | 36.2 | 36.2 | 0.999 | 0.975..1.024 |
  | Giveaway legalMoves | 95.1 | 97.5 | 1.025 | 0.968..1.079 |
  | Giveaway playMove | 60.9 | 59.3 | 0.974 | 0.916..1.016 |
  | Giveaway bot | 45.4 | 45.9 | 1.012 | 0.957..1.045 |
  | serialize + deserialize | 42.2 | 39.7 | 0.941 | 0.907..1.001 |

  Every point estimate is within +-5% (the ratio of the single best runs is 0.965-1.031) except serialize, which is 5.9% *faster*; no interval excludes 1.0 on the slow side except `isInCheck` (4.0% slower, lower bound 1.003), whose extra cost is the geometry lookup in `isInCheck` and the `geo` hand-over to `attackers`; the machine's noise does not allow a tighter statement than "no regression beyond about 5%". An earlier version of `isPlayable` that called back into the spec predicate showed up as +3-14% on three workloads; it is now a bounds check and a table lookup. An in-process A/B harness (both engines in one process) was tried and discarded: the second-loaded engine ran 3-10x slower even when it was a copy of the first (a module-loading / JIT artefact), so it measured the harness.
- **Backend** (§29 of its TESTING.md): mirror regenerated (5 files), `sync:fourplayer --check` in sync, `test:fourplayer` parity 53 / 53 (it now compares `Geometry` objects by tables and by what their closures return), Sync 114, Rooms 220, Bots 160, Matchmaking 74, Handlers 61, Giveaway 89, 4 Player Online e2e 287 (real sockets).

**Verdict: option G is confirmed** - nothing in W0 needed an FFA / Giveaway behaviour change, every golden is byte-identical, and the speed cost is not distinguishable from noise.

**Known limit.** `test:rejoinPersist` (backend) fails its 4 Player section on this Windows machine with the CI grace of `FOUR_GRACE_MS=1500` because the restarted child process (`tsx` start-up) takes longer than the grace and the seat is taken over by a bot; with `FOUR_GRACE_MS=5000` it passes (52 checks). Environmental, not W0.

## 29. Chaturaji W1 - the rules, the 8 x 8 snapshot and the wire (no UI)

**What W1 is.** Chaturaji as a third rules preset of the 4-seat engine (CHATURAJI_SPEC.md section 8, option G confirmed by W0): `CHATURAJI_RULES` (mode `ffa`, so all the 4 Player Chess machinery - points, dead pieces, walking dead kings, elimination, highest score wins, shared on a tie - is reused) with `CHATURAJI_OPTIONS` on the new `SQUARE8` geometry. Nothing is visible in the app yet (no menu card, no screen); W3 adds that.

**Rules as built** (all decided in the spec, all with a test):
- **Board and start:** 8 x 8, a1-h8, all playable; the rotationally symmetric start of the live chess.com game (Red a1 boat / b1 knight / c1 bishop / d1 king, pawns a2-d2; Blue, Yellow, Green a quarter turn clockwise each); Red first, then Blue, Yellow, Green. 8 legal opening moves for every seat.
- **Pieces:** boat = rook, bishop, knight, king; no castling. Pawns: one step, no double step (so no en passant), capture one step diagonally forward, promote on the far edge to a **boat only** (a promoted rook, worth 5); the move carries no piece choice.
- **Capture the King:** no king safety at all (`legalMoves` = pseudo-legal moves): a check never has to be answered, a king may step into an attack, nothing is pinned; kings are capturable; **an army is eliminated only when its king is captured** (status `frozen`, army inactive, stays on the board).
- **Points:** pawn 1, knight 3, bishop 5, boat 5 (promoted boat 5), **king 3 once** (a live seat's or a resigned seat's walking one); inactive pieces 0. **Check forks:** a move whose own piece attacks two live enemy kings scores +1, three +5 (not discovered attacks; not the mover's own king, a walking king or an eliminated seat's king); scored before a king capture can end the game.
- **No legal move:** eliminated, no points (reason `stalemate`). **Resign / timeout:** the army goes inactive and the king keeps walking onto empty squares (4 Player Chess "dead king walking"); the walking king is capturable for 3 and then stops (`frozen`).
- **End:** three seats eliminated (or the 1000-ply cap, hard ceiling 5000); **the highest score wins, ties shared**, not the survivor; the one seat left is paid **+3 for every other seat's king still on the board** (a resigned / timed-out / no-move seat's walking king; a captured king is gone) - only when the game ends by elimination, never at the cap. No bare-kings ending (kings can capture kings), no repetition / 50-move draws, no claim win.

**What changed.** `board.ts` (+`SQUARE8`, `BoardId` 'square8'), `state.ts` (+5 `RuleOptions` fields with defaults that keep 4 Player Chess / Giveaway exactly as they were, `CHATURAJI_OPTIONS` / `CHATURAJI_RULES`, `SQUARE8_START`, `FourVariant` 'chaturaji', `rulesFor`, `variantOfRules`, the validator now knows three presets), `moves.ts` (`isCapturable` with `kingsCapturable`, no king-safety filter under Capture the King, king-capture scoring, `kingsAttackedBy`, `moveLabelOn`), `elimination.ts` (reason `kingCaptured`, event `fork`, fork scoring, king-capture elimination, walking-king capture, the last-standing bonus, bare-kings rule off, no checkmate under Capture the King), the wire (`validateFourVariant` accepts 'chaturaji'; `isCanonicalSquareName` / `validateFourMovePayload` check squares against the board of the ROOM, the cross board by default), the client helpers (`joinQueueRequest` sends the variant for every game but 4 Player Chess; `checkMatchVariant` message; `describeEvents` for king captured / fork / no-move elimination; `variantOfState` / titles / suffix).

**Deviations from the spec, and why.** (1) The hand-written server room manager (`fourPlayerRooms.ts`, not mirrored) needed three changes the spec did not list: squares and move labels are named on the board of the room (the cross-board `parseSquare` / `squareName` / `moveLabel` it used are wrong for 8 x 8), the move payload check takes the room's board, and a promotion with no piece named is the one allowed piece (the boat) where a queen is not allowed. (2) One existing source pin changed: `fourPlayerGiveawayScreens.test.ts` asserted the literal text of the `FourVariant` type; it now names the third value. (3) The bonus counts every other seat's king still on the board, which includes the king of a seat eliminated for having no move (its king stays, walking) - the spec said "resigned seats' walking kings"; the rule is the same, the set slightly wider. (4) Bots: a Chaturaji room uses the existing 4 Player Chess bot until W2 (it plays legal moves; it does not know the rules' priorities).

**Gates (all green).** Frontend **1336 / 1336** in 73 files (1258 before W1: +45 rules, +22 golden, +11 wire, a few changed seam assertions), `tsc` clean. **Unchanged and byte-identical:** the FFA golden (48 games + 9 scenes), the Giveaway golden (40 + 13), the geometry identity (13 sections), `getFourPlayerCellSize(360, 640) === 21`. **New Chaturaji golden** (recorded once the rules were final): 40 seeded games + 19 hand-built scenes (king capture, ignored check, forks of 2 / 3 kings, fork then king capture, discovered attack, promotion by capture, dead pieces, no-move elimination, resigned walking king, capture of a walking king, the three end rules, the cap, bare kings). **Hand-built rule tests** (`fourPlayerChaturaji.test.ts`, 45): the preset, the start position and its symmetry, every seat's 8 opening moves, pawns (one step, no double step, no en passant, diagonal capture), promotion on every far edge to a boat only, piece moves, Capture the King (no king safety, ignoring a check costs the king, +3 once, elimination and credit, inactive pieces 0), forks (2, 3, pawn / boat / bishop, blocked, discovered, kings that do not count, scored before the capture ends the game), no-move elimination without points, resign and the walking king (steps, capture +3, frozen), the end (highest score not the survivor, tie shared, +3 per surviving king, no bonus at the cap, cap, no bare-kings ending), snapshots, validator. **Property test:** 60 seeded random games with resignations - every chosen move legal, scores equal to an independent tally from the moves and events, invariants after every action (king squares, no castling / en passant, frozen seats never thaw, no unpromoted pawn on the far edge, snapshot round trip), every game terminates, winners are the highest scores. **Wire** (`fourPlayerChaturajiWire.test.ts`, 11): the variant value, the echo check of an old server (D15) for Chaturaji both ways, the 8-row snapshot read by the client, the room-board payload check.
- **Mutation** (copies of the source): **52 mutants** of the new rules, wire and client helpers (every preset number and option, the start layout, the board registry, kings capturable, king safety, king points, the king record, every fork exclusion and direction, blocking, elimination and credit, walking king, the bonus conditions, bare kings, checkmate under Capture the King, winner by score, text, the validator and the echo check) against the hand-built tests ALONE (the golden is not in this run): 49 killed, 3 survived; one test later (the bonus must not be paid at the cap) 50 killed and 2 left, both argued equivalent: `last.length >= 1` for `=== 1` (the branch is only reached when the reason is `elimination`, which means at most one active seat) and "a no-move seat is checkmated when its king is attacked". **The second argument was wrong and is withdrawn (W2, §30):** it said such a position cannot be constructed, but a KNIGHT attack on a king whose neighbours are all its own immobile pieces is exactly that position (the argument assumed the attacker had to be one of the pieces the blockers could capture; a knight is not). An exhaustive search over small positions found 15,000+ of them (`fourPlayerChaturajiNoMove.test.ts`). The engine's behaviour was already right (the seat is eliminated as `stalemate`, no points, no checkmate under Capture the King), so no rule changed, and the mutant is **killed** by that test, not equivalent.
- **Benchmark vs W0** (`scripts/bench/ab-procs.sh`, 30 process pairs of the W0 tree against this tree, median of the per-process best times, bootstrap 90% interval; the machine was much quieter than during W0, so the intervals are tight): the new rule branches cost 4 Player Chess and Giveaway nothing measurable.

  | workload | W0 ms | W1 ms | ratio | 90% interval |
  |---|---|---|---|---|
  | FFA legalMoves | 85.0 | 84.7 | 0.997 | 0.988..1.002 |
  | FFA isInCheck | 44.5 | 44.8 | 1.008 | 0.999..1.024 |
  | FFA playMove | 64.0 | 63.8 | 0.997 | 0.990..1.003 |
  | FFA bot | 26.9 | 26.9 | 0.999 | 0.990..1.006 |
  | Giveaway legalMoves | 67.4 | 65.4 | 0.971 | 0.960..0.975 |
  | Giveaway playMove | 43.3 | 42.7 | 0.987 | 0.977..0.999 |
  | Giveaway bot | 33.1 | 32.0 | 0.968 | 0.956..0.979 |
  | serialize + deserialize | 29.3 | 29.5 | 1.005 | 0.996..1.013 |

## 30. Chaturaji W2 - the bot and the whole game loop (no UI)

**What was built.** `fourPlayer/chaturajiBot.ts` (mirrored): a heuristic bot on the SAME ELO dial (`botStrength`: bestChance, wobble, tier; `deep` plays as `careful`, there is no deep tier, so the server clamp never binds). `chooseBotMoveFor` now dispatches Giveaway -> Giveaway bot, Chaturaji -> Chaturaji bot, else the Chess bot. Scoring (`scoreMoves`, exported so the weights can be pinned): points x 1.5 + material + 2 for a king capture + fork points x 1.5; careful adds minus 0.85 x the worst the next LIVE seat can win back (a king = 14, a defended piece only the difference to the piece that takes it), the end of the game (+25 if it wins, -25 if it hands the win to someone else, priced with the engine's own result), 0.3 per king attacked, 0.5 for a promotion. A check is never "answered" as such: the reply term sees only what can really be taken.
**Server loop.** No room-manager change was needed (W1 already made it geometry-aware): bots fill seats, takeover / hand-back, dead-king walking, per-seat clocks, resign, spectators and rejoin are the 4-seat code, now exercised for Chaturaji by the backend's `test-fourplayer-chaturaji.mjs` (backend TESTING.md §31). `joinQueueRequest` and the wire already carried the variant.
**Tests.** `fourPlayerChaturajiBot.test.ts` (36): the dial and the dispatcher (a seeded Chaturaji game: the dispatcher equals the Chaturaji bot at every ply and the Chess bot would differ somewhere), points (boat > knight > pawn, a king > everything, a walking king, dead pieces 0, forks, promotion), fear (king safety vs greedy, a check needs no answer, hanging pieces and recaptures), the end of the game priced by who wins it, **the weights pinned by outcome and by exact value** (careful minus greedy of the same move is exactly the promotion bonus / the king threat / +-25 at the end), `worstReplyLoss` priced exactly, determinism, ties broken by the rng, an rng that returns 1, legality over every roster ELO, a 24-game arena (all end by elimination, kings fall, forks score, pawns promote) and the dial in practice (one 3000 seat against three 400 seats takes 28 of 32 wins, fair share 8), latency. `fourPlayerChaturajiNoMove.test.ts` (6): the exhaustive proof for the W1 correction above. Mirror set pin updated (nine engine modules).
**Latency** (decision cost over 1,260 decisions of seeded games, best of 3 per decision, same method as the 4 Player Chess bot): ELO 3000 mean 0.19 ms, **p99 0.52 ms**, max 1.35 ms; ELO 1500 mean 0.20 ms, p99 0.56 ms, max 2.07 ms. One legal-move generation per candidate for the next seat and nothing deeper, so no cap beyond the existing server clamp is needed (a structural test pins "no search tree").
**Mutation** (copies; run in 7 chunks of 6-11 mutants, each with a hard time limit, 3.6-6.2 min per chunk, ~35 min in total; an earlier unbounded single run was lost to a suspended laptop and its result was discarded): **62 mutants of `chaturajiBot.ts` and the dispatcher, 62 killed, 0 survived, 0 equivalent**: constants 9/9 (every weight to 0 or to an extreme), entry 9/9, score 11/11, careful tier 11/11, helpers 13/13, choice and dispatch 9/9. The first pass (60 mutants against the tests as first written) killed 33 and left 27; they were **real gaps** - nothing pinned most weights (they only changed a choice between near-equal moves), the "defended" recapture maths, the next-live-seat rule, noise, tie-breaking and the dispatcher (a Chess bot dispatched on Chaturaji went undetected because both happened to pick the same move on the one position tested). Closed by the "weights, pinned by outcome" tests above; `scoreMoves` was exported and `worstReplyLoss` too. Two things that first looked like equivalent mutants were not: "the reply term is also applied after a game-ending capture" is killed once the ending position has a piece that would hang (a king does not attack from four squares away - the first test position was wrong, not the mutant), and the baseline `evaluate(before)` subtracted from every score was removed from the code instead (a constant shift of all candidates cannot change a choice, so there is nothing left to mutate). **The "defended king" mutant** (a king treated like any other defended piece, so its loss is 14 minus the piece that takes it): my first test position let the bot capture the attacking king instead, so it passed for the wrong reason; with the attacker's king off every line the honest bot saves the king (d1-e1) and the mutant takes the free boat (a4xh4); killed by the "a king is never defended" test and by `worstReplyLoss(...) === KING_LOSS` even with a covering boat. **W1's second mutant** ("a no-move seat is checkmated when its king is attacked"): killed by `fourPlayerChaturajiNoMove.test.ts` (rerun in this window; see §29).
**Gates (all green).** `tsc` clean; frontend **1378 / 1378** in 75 files (1336 / 73 before: +36 bot, +6 no-move); the FFA golden (48 + 9), the Giveaway golden (40 + 13), the Chaturaji golden (40 + 19) and the geometry identity are unchanged and green (no engine file changed in W2: only the new bot, the dispatcher and the manifest).
**Deviations from the spec.** (1) No deep tier and therefore no Elo cap for this variant (spec: "capped the same way if needed" - it is not needed at 0.5 ms). (2) The bot is a one-ply-plus-reply heuristic like the other two 4-seat bots, not calibrated: the weights are a first version, now pinned by tests so that tuning them later is a deliberate, visible change.

## 31. Chaturaji W3 - the screens (Local, vs Bots, Online), and the first rendered screen tests in this repo

**What was built (client only; the server did not change).** A Chaturaji card on the Play menu (Local, Online behind the login gate, a "How to play" link, and "Return to your game" under the card of the game that was left) feeding the existing 4-seat flow with `variant: 'chaturaji'`: setup (human / bot per seat with the roster), time control (no Daily; online also no "No time limit"), the game screens (local, online, spectator), the queue, the Spectate list (its own "Chaturaji" section). On the game screen: the 8 x 8 board with its own cell size (`getChaturajiCellSize`: 36 at 360 x 640, 49 at 412 x 915, bounds 28..52; the cross board's 21 is untouched), Red at the bottom and every army in its corner per the spec; **boats drawn as boats** (`BoatIcon.tsx`, original SVG artwork drawn for this app - three paths, no font, emoji or third-party set, so no licence to carry; white-on-disc on themed boards, seat-coloured on the glyph theme); per-seat card with name / bot label, clock, points, and the engine's status ("out", "king walking", "king attacked", plus the online badges "bot playing" / "offline · 32s"); the **"+N"** on the seat that scored (`useScoreGains`: the difference of two engine - or server - score arrays, shown 1.8 s, replaced by the next gain, cleared by Undo and by a catch-up jump, silent for the first position of a rejoin); **check never blocks**: an attacked king gets an amber ring and the card says so, and a pill REPLACES the status line ("Your king is attacked - it can be captured"), with every move still on offer; **automatic promotion** to a boat with a pulsing marker (`promoted` rides on the last move; premoves resolve to the boat; no picker); the game-over table with the points breakdown (`chaturajiResultRows`: "11 points - 5 from play + 6 for 2 kings left"), Rematch and Back to menu; the **rules sheet** (`chaturajiRulesSheet`, every number read from the engine's constants) from the Play menu, the setup screen and the Rules button of both game screens; the rules hint on setup and in the queue.
**What the screen tests found, in code that was not Chaturaji's:** the online client named and parsed squares on the CROSS board (`movePayloadFor`, the reducer's last move: every Chaturaji move would have gone to the wrong square); a premove with no piece named asked for a queen (cancelled, as there is no queen); the annotation maps, the premove line, the move log and the move sound named squares on the cross board; the resume link was only ever under the 4 Player Chess card. All fixed through the game's geometry, and pinned by `chaturajiWiring.test.ts` (no 4-seat UI file may import `SIZE` / `VALID` / `squareName` / `parseSquare` / `fromDisplay` / `getFourPlayerCellSize` / `moveLabel` any more).
**The new test project.** The repo had no renderer (the earlier tests said so in their headers), so `vitest.config.mts` now has two projects: `logic` (everything that was there) and `dom` (`*.dom.test.tsx`): the real screens and components rendered in jsdom through `react-native-web` (already a dependency: it is what the web build runs) with `@testing-library/react` (new dev dependencies: `jsdom`, `@testing-library/react`, `@testing-library/dom`; the brief said React Native Testing Library, which is not in the repo). `src/test/domSetup.ts` stubs only what is native or I/O (haptics, sound, storage, safe-area, `react-native-svg`, and ONE seam: the board's gesture hook hands the test its current options, and `src/test/domKit.tsx`'s `tapSquare` turns a square into the display cell a finger would have hit; everything from the tap on is real). No wall clock anywhere (fake timers; the bot test replays the same game on the bare engine with the same seeded stream and compares the table). Run: `npx vitest run` (both projects), `npx vitest run --project dom`, or a single file.
**Suites (new, all green):** `chaturajiUi.test.ts` (20: the "+N" = the engine's own difference for a pawn / knight / bishop / boat / king / fork / triple fork / capture + fork / dead piece / the last move's bonus; the status of a seat; the pill; the bonus and the final table - including a property over 36 seeded games that the bonus the table reports equals what the ENGINE paid, by replaying each game with the bonus switched off -; the sheet's every figure checked against what the engine pays and against distinct numbers), `chaturajiClient.test.ts` (16: cell sizes, the cell <-> square maps on the 8 x 8 board incl. every wrap-around cell, premoves and automatic promotion, the move payload and the last move on the room's board, the Spectate list, the queue request and the D15-style refusal, wording, the online table), `chaturajiWiring.test.ts` (8), `useScoreGains.dom.test.tsx` (10), `chaturajiLocal.dom.test.tsx` (20: the menu card, login gate, rules sheet, resume link; the setup screen; the local game from the start position, a tap-to-move with the engine's legal squares, "+1" for a capture with the engine's figure and its disappearance, +3 and the grey army for a king capture, a fork +1, auto-promotion with the marker, eliminated vs walking king, the attacked king never forced, the game-over table with the breakdown and Rematch, the winner by points not survival, a premove with promotion, a seeded mixed table played to its end and compared with the engine, the Rules button, and the other games unchanged), `chaturajiOnline.dom.test.tsx` (15: a rejoin snapshot restores the board (all 64 squares against the engine state), clocks, points, statuses and the takeover badge; offline and hand-back; the pill; the spectator; tap-to-move sends the engine's move for the room, a premove; the "+N" from consecutive snapshots and none for a catch-up; the server's result with the breakdown, abandoned, resign; the queue with the variant on the wire, the refusal of a server that answers with another game, the Spectate list), `annotationLifecycle.test.ts` (+5: Chaturaji's no-move turn advances and moves, a king capture and a dead king's walk). Six source pins in `fourPlayerApp.test.ts` / `fourPlayerOnlineApp.test.ts` were updated for the geometry-aware code.
**Gates.** `tsc` clean; **1473 / 1473 in 81 files** (1378 / 75 before: +95); goldens (FFA, Giveaway, Chaturaji, geometry) unchanged and green; `sync:fourplayer --check` in sync (no mirrored file changed). The new tests passed **10 / 10 consecutive runs** (123 tests, 16-18 s) and 3 / 3 with a CPU burner on every core (23-24 s); the slowest new test is 0.9 s (a bot-table test that took 6.8 s was reduced to a sparse position and replays the engine instead).
**Mutation** (copies, 5 chunks of 13-19 mutants, 54-108 s each, results outside the repo): **73 mutants of the new non-visual logic - `chaturajiUi.ts` (gains, status, pill, bonus, final table, sheet: 32), `useScoreGains.ts` (13), the online helpers (`movePayloadFor`, the last move, the online table, the Spectate rows: 13), cell sizes, premoves, annotation maps and wording (15) - 73 killed, 0 survived.** First pass: 67 killed, 6 survived, each a real gap or an equivalent mutant: a position where the game had already ended had no live attacker (so "not attacked once over" was unchecked), the sheet's bonus and king value are both 3 (the sheet is now parameterised by the rules and tested with distinct numbers), the hook's hold time was tested with the mutated constant itself, a position that goes away and comes back, and an out-of-board cell whose flat index wraps onto a real square. One was equivalent and removed from the code instead: cancelling a pending hold timer on Undo (the timer later empties an already empty list, the next gain cancels it, unmount cancels it - no test can tell, so the line is gone and a comment says why). Note on method: a test that reads a constant from the module under mutation cannot kill a mutant of that constant (the first hold-time test did); constants are pinned as literals.
**Browser check** (the built-in browser pane on an own Expo web port, :8087 - Playwright is not installed in this repo, so the pane's Chromium and `javascript_tool` drove the page; the user's :8081 and :3000 were not touched and the dev server was stopped afterwards). A tap is a real `pointerdown` / `mouseup` / `click` sequence on the cell. Local game, human Red + three bots (and an all-human hot-seat game for the scripted part): the start position matched the spec (24 pieces listed square by square in the set-up above; boats drawn as boats), a human move offered exactly the engine's squares, a bot capture showed "+3" at Green, a king capture eliminated Yellow (7 grey pieces, "out"), the pill and the amber rings with three kings attacked at once and a fork notice ("Green attacks 2 kings at once (+1)"), the **scripted all-human game promoted a pawn d7-d8=R without a picker (label "d8, Red boat, just promoted", the marker present) and then captured Yellow's king with it (+3, "Yellow's king was captured by Red")**, and a bot game ran to **game over** ("Game over - Green wins", table 13 / 3 / 0 / 0, Rematch / Back to menu). Layout measured at 360 x 640 (cell 36, board 288 px, no horizontal overflow, the New Game button at 628 of 640) and 412 x 915 (cell 49, board 392 px, button at 903 of 915). Not driven in the browser: the online screens (see TODO.md).
**Deviations from the brief, all forced by the spec or the repo:** (1) **No game history entry and no replay** (brief step 3): CHATURAJI_SPEC.md sections 12-13 say 4-seat games are not saved, rated, analysed or exported and the repo has no such feature for the other two 4-seat games (TODO.md says so); the spec wins. (2) **No React Native Testing Library** (not in the repo): the `dom` project above. (3) **No Playwright** (not in the repo): the browser pane. (4) Local pass-and-play uses the other 4-seat games' manual Rotate button and default view seat (the spec defines no other rotation rule).

## 32. Chaturaji W4 - the real app against the real server, in a real browser

**Why.** W3's screen tests found that the app's online client sent the CROSS board's square names, so every online Chaturaji move would have gone to the wrong square; the W1/W2 socket e2e could not see it because it uses its own client. W4 drives the REAL app (a web build) against the REAL server and compares every screen with the server's state after every move. The harness lives in the backend repo (`backend/scripts/e2e-browser/`, its TESTING.md section 33 says how to run it); this repo changed in two places.

**1. The server URL is configurable at build time (`src/api/apiBaseUrl.ts`, used by `src/api/client.ts`).** `EXPO_PUBLIC_API_URL` (a plain `http(s)://host[:port]` origin: no path, query, fragment or credentials) points a DEV build at another backend; it exists so the web build can reach a private test backend instead of port 3000 or Render. Order, first match wins: a release build always uses Render (the variable is ignored, `__DEV__` false); then the override; then `EXPO_PUBLIC_USE_ONLINE_BACKEND`; then localhost on the web; then the LAN address on a phone. **Unset, empty or invalid = ignored, so nothing changes for anyone who does not set it.** `apiBaseUrl.test.ts` (7 tests) pins this against a verbatim copy of the old function over all 2 x 2 x 3 x 2 x 2 x 8 = 192 input combinations, plus the override rules (http and https only, normalised origin, a user name or password, a path, a query or a fragment refused, release builds never take it), the local port and the two equivalent-mutant notes. A static `expo export` is a production bundle (`__DEV__` false = Render), so the e2e build uses `expo export --dev`. `.env.local` sets `EXPO_PUBLIC_USE_ONLINE_BACKEND`, so the e2e build forces it to `false`.

**2. A regression test for the W3 bug, as a unit test (`chaturajiOnlineSquares.test.ts`, 3 tests).** Three seeded whole Chaturaji games (bot-played, 60 plies each): at EVERY position, for EVERY legal move of the seat to move (over 1000 moves, most of whose squares the cross board spells differently, so a fallback cannot pass unnoticed) `movePayloadFor` gives the engine's 8 x 8 names, the server's validator accepts them against the 8 x 8 board, and the server's answer read by `applyFourState` gives back the same squares as the last move; plus a promotion for a pawn of each seat on every square it can promote from (payload `r`, last move `promoted`); plus the check that without the rules the helper IS the cross board's spelling (so the walk can tell the two apart). Mutants of `movePayloadFor` (always the cross names, the cross names with rules, from/to swapped, the promotion dropped) are all killed by it.

**What the browser run proved** (scenarios A-G in the backend's TESTING.md section 33): 10 full rounds with two humans and two bots, every move landing on the intended square on ALL clients with board, points, statuses and the non-moving clocks compared with the server after every position; "+N" on every screen for every score change; takeover and hand-back (both through the menu and by closing the tab); a hard reload restoring the game; a spectator; resignation, a clock timeout and a game to its end with the ranking and the +3 per surviving enemy king equal to the server's scores; three variants queued at once staying in their own rooms; layout at 360 x 640 and 412 x 915. **No app bug was found by scenarios A-G.** The regression evidence is the other way round: a bundle patched to send the cross board's names (`movePayloadFor` without the rules) fails scenario A at the first move (`timed out waiting for the server to accept b1-a3`).

**Gates.** `tsc` clean; **1483 / 1483 in 83 files** (1473 / 81 before: +10 tests in the two new files); goldens byte-identical (no tracked file changed; the golden tests green); `sync:fourplayer --check` in sync (11 generated files). **Mutation** (copies, results outside the repo): the server-URL resolver and the payload helper, 26 mutants: 24 killed, 2 equivalent (`new URL('')` throws so the empty check is redundant; an http(s) URL's pathname is never empty), each now annotated in `apiBaseUrl.ts` and pinned by a test that the premise holds; first pass 21 killed, 5 survived (a user name without a password accepted, the web port fixed at 3000, the promotion piece dropped from the payload, and the two equivalents): the first three are real test gaps, closed with a test each.

**The test-only switch rule** (CHECKLIST.md section 7): a knob that exists for tests must not exist in production. `EXPO_PUBLIC_API_URL` is ignored by release builds; the backend's `AUTH_RATE_LIMIT_TEST_OVERRIDE` (backend TESTING.md section 33) follows the same rule.

## 33. Chaturaji W5 - close-out: every Chaturaji suite in one place, and the final mutation re-run

**Where everything runs.** Frontend per push (`.github/workflows/ci.yml`: `npm run typecheck`, `npm test` = `vitest run`, both projects, 83 files / **1483 tests**): the 449 tests of the 23 files below are inside that run. Backend per push (backend `ci.yml`, with this repo checked out next to it on the same `paired/<x>` branch): the first nine scripts below. Backend nightly (`nightly.yml`): the online fuzz (Chaturaji is its last argument, 40 games) and the browser suite. `npm run ...` lines are in the backend unless marked.

| Suite | Command | Checks | Runs |
|---|---|---|---|
| Engine, geometry seam, goldens (FFA / Giveaway / Chaturaji) | `npm test` (frontend): `fourPlayerSeam` 30, `fourPlayerGeometry` 15, `fourPlayerFfaGolden` 11, `fourPlayerGiveawayGolden` 16, `fourPlayerChaturajiGolden` 22 | 94 | CI per push |
| Chaturaji rules, wire, no-move seat | `fourPlayerChaturaji` 45, `fourPlayerChaturajiWire` 11, `fourPlayerChaturajiNoMove` 6 | 62 | CI per push |
| Chaturaji bot | `fourPlayerChaturajiBot` 36 (the other bots: `fourPlayerBot` 21) | 36 | CI per push |
| UI logic and client helpers | `chaturajiUi` 20, `chaturajiClient` 16, `chaturajiWiring` 8, `chaturajiOnlineSquares` 3, `apiBaseUrl` 7, `useScoreGains.dom` 10 | 64 | CI per push |
| Online client | `fourPlayerOnline` 42, `fourPlayerOnlineSession` 44, `fourPlayerOnlineUi` 24, `fourPlayerOnlineApp` 18, `fourPlayerAnnotations` 9 | 137 | CI per push |
| Rendered screens (jsdom + react-native-web) | `chaturajiLocal.dom` 20, `chaturajiOnline.dom` 15 | 35 | CI per push |
| Mirror in sync / mirror check | `npm run sync:fourplayer -- --check` / `npm run test:fourplayerSync` | 11 files / 117 | CI per push |
| Engine parity (client engine vs server copy) | `npm run test:fourplayer` | 70 | CI per push |
| Room manager | `npm run test:fourplayerRooms` | 237 | CI per push |
| Bots over the room manager | `npm run test:fourplayerBots` | 160 | CI per push |
| Matchmaker (queue key `timeControl|variant`) | `npm run test:fourplayerMatchmaking` | 74 | CI per push |
| Socket handlers | `npm run test:fourplayerHandlers` | 61 | CI per push |
| Giveaway server | `npm run test:fourplayerGiveaway` | 89 | CI per push |
| Chaturaji server (bot over whole games, takeover, every ending, three variants in three rooms) | `npm run test:fourplayerChaturaji` | 121 | CI per push |
| Auth rate-limit override | `npm run test:authRateLimit` | 43 | CI per push |
| Test-only 4-seat switches (seed, start-position endpoint), incl. a real production-mode boot | `npm run test:fourTestSwitches` | 73 | CI per push |
| Production-style install and build | `npm run check:productionInstall` | pass / fail | CI per push |
| Real-socket e2e (Chess, Giveaway, Chaturaji; scenarios 17-22) | `npm run test:fourplayerOnline` (needs a server with `FOUR_GRACE_MS` / `FOUR_FILL_MS`, and a second one for `FOUR_E2E_REAL_FILL_URL`) | **427 fixed** + 5 conditional | CI per push |
| Rejoin after restart | `npm run test:rejoinPersist` | 58 | CI per push |
| Online fuzz, Chaturaji section | `npx tsx scripts/nightly-fuzz-online.mjs ... 40` (last argument) | 40 games, 0 issues | nightly |
| Browser end-to-end (real app, real server) | `npm run test:e2eBrowser` | 11 scenarios | nightly |

**Final mutation re-run (everything Chaturaji touched in W0-W5; copies of the source, results outside the repo, one chunk at a time, none over the 20-minute limit; the sets are the ones built during W0-W5, re-run against the final code, plus a new one for the W5 server code).** 378 mutants in 29 chunks: **373 killed, 4 equivalent (3 distinct), 1 placeholder, 0 unexplained survivors.**

| Chunk (mutants) | Scope | Killed | Survivors | Time |
|---|---|---|---|---|
| seam (47) | W0 geometry / rule-option seam, goldens | 47 (45 first pass; the 2 whose patterns had gone stale were rewritten against the current code and killed, one of them against the Chaturaji engine tests, which is where sliding attacks are pinned) | 0 | 381 s + 37 s |
| engine 1 (53, two chunks) | W1 rules: preset, points, forks, elimination, bonus, snapshot, wire | 51 | 1 placeholder (a mutant whose replacement text is identical to the original in the old config), 1 equivalent (below) | 1201 s (cut at the limit: 32 done) + 701 s (the other 21) |
| engine 2 (52, two chunks) | W1/W2 second pass (strengthened tests) | 51 | 1 equivalent (the same mutant) | 962 s + 890 s |
| bot (62, seven chunks) | W2 bot: constants, entry, scores, careful, helpers, choice | 62 | 0 | 345 + 345 + 413 + 417 + 279 + 197 + 193 s |
| W3 UI (73, five chunks) | gains, status, pill, bonus and table, sheet, score-gains hook, client helpers, cell sizes, premoves, annotations | 73 | 0 | 45 + 63 + 85 + 119 + 55 s |
| W4 front (26) | URL resolver, online payload helper | 24 | 2 equivalent | 82 s |
| server loop (13) | W2 room / handlers / matchmaking plumbing | 13 (12 first pass; the 13th's pattern had gone stale when the snapshot hook was added to the same call, rewritten and killed) | 0 | 38 s |
| auth rate limit (22) | W4 module | 22 (the first run of this chunk could not even start: its baseline was red, see below) | 0 | ~60 s |
| W5 switches (30, two chunks) | seed, setup switch, router, snapshot, room, handler hook | 30 (27 first pass; 3 survived and were closed, below) | 0 | 73 s + 105 s + 3 x 13 s |

**Every survivor, named.** *Real gaps, killed by a stronger test:* (1) the shuffle source rounding up (`Math.ceil`): the test drew 200 values from a FRESH generator each time, i.e. the same value 200 times; it now draws from one generator and checks that every value 0..3 occurs; (2) the unknown-variant case of the setup endpoint: its snapshot was invalid for the default rules anyway, so a variant check removed from the code still answered 400; it now uses a snapshot that is valid for them; (3) the production warning printing the value: the mutant was a no-op (a `${...}` inside a plain string) and was rewritten as a template string; killed. *Stale patterns* (the code under mutation had moved on): the two ray scans and the 13th server-loop mutant above. *A real regression found by the re-run's baseline:* the auth rate-limit test failed (its "the variable appears nowhere but ..." scan found the new switch test, which sets the variable on a real production-mode process): the baseline of that chunk was red, which is how it surfaced; the allow-list was extended. *Equivalent mutants, proofs:* (a) **`last.length === 1` -> `>= 1` in `endGame`'s bonus** (elimination.ts): an `'elimination'` ending is only ever reached through `activeSeats(state).length <= 1` (its one caller), so the number of active seats there is 0 or 1 and the two conditions cannot differ - pinned on whole seeded games by an assertion in `chaturajiUi.test.ts` (an elimination ending leaves at most one active seat); (b) `new URL('')` throws and the catch answers null, so the empty-string check in `parseApiUrlOverride` is redundant; (c) an http(s) URL's pathname is never empty, so `pathname !== ''` is unreachable; both pinned in `apiBaseUrl.test.ts` (and annotated in the source).

**Gates, final commit** (details in the backend's TESTING.md section 34): `tsc` clean in both repos; vitest **1483 / 1483, 83 files**; the goldens (FFA, Giveaway, Chaturaji, geometry) green and no tracked file changed; mirror in sync; every backend suite at the counts above; the real-socket e2e printed **427 (conditional 5)** three times; rejoin 58; the Chaturaji fuzz **40 / 40, 2891 plies, 0 issues**; the browser suite 11 / 11 in three consecutive runs (6:38, 6:30, 6:37, no retry) and once under load on every core (8:33, no retry). The local database ends with the 7 accounts it started with.

## 34. Bughouse W0 - foundations, no behaviour change (branch `paired/bughouse`)

**What W0 is.** BUGHOUSE_SPEC.md section 7, W0: four pieces of groundwork, none of which changes what any existing mode does. **Interactions (CHECKLIST 1):** the new Crazyhouse exports are called by nothing yet; 2-player Crazyhouse, the four 4-seat games, the bots, analysis, PGN and puzzles are untouched. The new module `src/logic/bughouse/` is not imported by any screen. Bughouse is mutually exclusive with every other variant from W2 on (the spec's section 4); nothing in W0 is reachable from a menu.

**1. The mutation harness is in the repo** (`scripts/mutation/`, `npm run mutate -- <config>`; README.md there). `mutate-generic.cjs` is the engine (copy of the source, `node_modules` shared through a Windows junction / a Linux directory symlink and never copied, one mutant at a time, a pattern must match exactly once and must change the text, a run that passes its time limit is killed WITH its process tree, a work directory inside the repository is refused, links are unlinked and never followed when the copy is cleaned and the real targets are checked afterwards); `run.cjs` is the runner (chunks of at most 20 mutants / 20 minutes - larger values are refused -, one chunk at a time, a lock file so that no second runner starts, results under the temp folder and refused inside the repo). `mutationHarness.test.ts` (20 tests): chunk planning and filtering, the safety refusals, the example config end to end with its one survivor, a copy with a linked `node_modules` whose real files must all still be there, a hanging run killed together with the child that keeps a heartbeat, the deadline, a red baseline, invalid patterns (exit 4), the runner's limits. **Proof that it is the same tool:** the Chaturaji bot constants set (`cfg-cjbot.cjs`, `const:`) re-run through `npm run mutate`: **9 killed, 0 survived**, the same nine mutants as the scratch run that gave 9 / 0 (305 s then, 338 s now), `node_modules` untouched (384 entries before and after).

**2. The Crazyhouse golden** (`crazyhouseGoldenKit.ts`, `crazyhouseGolden.test.ts`, `fixtures/crazyhouseGolden.json`), **recorded on master BEFORE `crazyhouse.ts` was touched** (commit `a0ed62a`, before the exports commit): 40 seeded games (every fifth from kings and pawn-heavy pockets, the generator weights captures, promotions, castling, en passant, the double step of a DROPPED pawn and drops that give check) and 16 hand-built scenes (a capture then drops; a drop that gives check; a drop that blocks a check, with the pawn refused on rank 1; a drop mate; a "mate" a drop answers - and the capture of the blocker that IS mate; a promoted queen captured returning as a pawn; an ordinary queen keeping its type; castling both ways; a rook re-dropped on h1 not restoring the right; en passant after a pawn dropped on its second rank double-stepped; a drop clearing the en passant square; pawn drops on ranks 1 and 8 refused; no drop against a knight check; none against a double check; stalemate refuted by a drop; king against king with a reserve). Every position's FEN, reserves and promoted squares, status, full legal-move AND legal-drop lists, the turn taken and its SAN are in the hash. **Byte-identical on three recordings** (the fixture's SHA-256 is the same on three `--record` runs) and in-process (a transcript replayed three times). Coverage the games really reach (asserted, so the gate cannot go vacuous): 5,842 plies, 1,755 captures, 1,731 drops, 331 drop checks, 8 drop mates, 93 promotions, 53 promoted pieces captured, 19 castles, 9 en passant captures of which 5 of a pawn that was dropped, 16 mates. **After the exports commit the golden is unchanged** (the 21 golden tests pass on the final tree).

**3. New exports in `crazyhouse.ts`** (inside the shared block, appended after `crazyhouseDropSan`; nothing above changed; verbatim backend mirror, `test-crazyhouse.mjs` section 4): `crazyhouseBankedPiece` (what a capture banks: a promoted piece banks a pawn, a king or an unknown type nothing), `creditCrazyhouseReserve`, `applyCrazyhouseMoveForPartner` (this board's state after a move with the MOVER's reserve left alone, and the piece the partner's reserve on the other board gains), `crazyhouseDropCouldAnswerCheck` (exactly one sliding checker with an empty square between - the question behind `stuck`, spec rule 18). `crazyhouseBughouseExports.test.ts` (22 tests): hand cases with literals; **differential checks** against `applyCrazyhouseMove` (600 random states and captures: the mover's reserve delta IS the banked piece), against the engine's own bookkeeping over six seeded whole games (same promoted marks, same opponent reserve, banked = the delta) and against `legalDropSquares` over 40 seeded games (every position with a check: "could answer" holds exactly when a reserve holding a knight, bishop, rook and queen has a legal drop). The pawn's rank limit is documented, not modelled: a pawn can never block on rank 1, any other piece can, and "could ever" asks about any piece.

**4. The empty Bughouse module and its mirror** (`src/logic/bughouse/types.ts` + a barrel + `MIRRORED_TO_BACKEND.json`; backend `scripts/sync-bughouse.mjs`, `npm run sync:bughouse [-- --check]`, `test:bughouseSync`, 46 checks; backend TESTING.md section 37): `BoardId`, the fixed seat map (seat 0 = A White, 1 = A Black, 2 = B White, 3 = B Black; Team 1 = seats 0 + 3, Team 2 = 1 + 2; partner(0) = 3, partner(1) = 2), `seatAt(board, color)`, `boardSquareKey(board, square)`. **The board is a required argument:** `bughouseBoardArgument.test.ts` (12 tests) pins the seat map as literals and SCANS the module's AST - no parameter of type `BoardId` is optional or has a default; every exported function whose name mentions a square, cell, pocket, reserve or clock takes `board: BoardId` as its first parameter (the one exception, the parser of a board-qualified key, is an explicit one-entry list and is itself checked). The second user of the mirror mechanism **reuses `rewriteModule` from `sync-fourplayer.mjs` unchanged** (the closure rule), with its own manifest, its own directory (`src/game/bughouse/`, so the two generators cannot disturb each other - tested) and one addition: `../crazyhouse` may be imported by a mirrored file (it has its own verbatim mirror) and `--check` then demands that `src/game/crazyhouse.ts` exist.

**Mutation, all through `npm run mutate`** (configs committed in `scripts/mutation/configs/`): the Crazyhouse additions **27 mutants - 26 killed, 1 equivalent** (`banked`: looking up the landing square instead of the victim's square for an en passant capture - the victim is a pawn and `captured` is `'p'` either way; the proof is pinned by a test that gives an en passant capture every possible promoted mark and expects `'p'` each time); the Bughouse module **31 mutants - 31 killed** after one real gap was closed (the first pass left "the key parser is not anchored at the start" alive: inputs such as `xA:e4` were never tried). The backend mirror of the exports is not mutated: it is a verbatim copy and any change to it fails the drift guard at once.

**Benchmark** (`scripts/bench-crazyhouse.ts` through `BENCH=bench-crazyhouse.ts scripts/bench/ab-procs.sh <master worktree> 14`; the same script on master d27ea66 and on the branch, alternating, 14 processes per side, best-of-run per process, median of the bests, 90% bootstrap interval of the ratio B / A): `getLegalDrops` **0.970** [0.945, 1.016], `getCrazyhouseMoves` **1.032** [0.999, 1.058], `crazyhouseCheckInfo` + `legalDrops` **0.994** [0.954, 1.013], a move + drop replay **0.980** [0.943, 1.024], **the bot (elo 3000, searching, 11 seeded positions, 80 ms per move on this machine) 0.986 [0.980, 1.010]**. Every ratio is inside +-5%; the one interval whose top edge is 1.058 belongs to `getCrazyhouseMoves`, which W0 does not touch (an earlier, shorter run of the same workload gave 0.973 [0.906, 1.038]): machine noise, not a slowdown. The reference "bot about 120 ms" of earlier notes was measured on other positions; the number above is this benchmark's own.

**Gates.** `tsc` clean; vitest **1558 / 1558, 87 files** (1483 + 75: the golden 21, the exports 22, the board argument 12, the harness 20); the goldens (FFA, Giveaway, Chaturaji, geometry, Crazyhouse) green and unchanged; the backend side is in the backend's TESTING.md section 37.

## 35. Bughouse W1 - the engine (branch `paired/bughouse`; backend TESTING.md section 39)

**What W1 is.** BUGHOUSE_SPEC.md section 7, W1: the pure match engine in `src/logic/bughouse/`, mirrored to `backend/src/game/bughouse/` by `npm run sync:bughouse`. No server code, no screen, nothing reachable from a menu (CHECKLIST 1: Bughouse interacts with no existing mode; the engine reuses chess.js and the Crazyhouse block and changes neither). Build log, deviations and what W2 needs: BUGHOUSE_SPEC.md section 9. The engine: `BughouseMatch` (two boards as FEN + promoted marks, four pockets, four clocks, the global `seq`, a verdict per board, the result), `applyAction` (one commit atomic across both boards: the move or drop, the credit to the capturer's PARTNER on the other board - a promoted piece as a pawn -, the clock charge and start, the verdicts, `seq + 1`), `settle` (due flags before any input), the verdicts `playing | check | checkmate | stuck`, results with no draw, `serializeMatch` / `deserializeMatch`, `resolvePremove`, `conservationProblems`.

**The tests (all in `npm test`; 163 new, 13 files: 1558 -> 1721 tests, 87 -> 100 files):**

| Suite | What it pins |
|---|---|
| `bughouseMatchModelA-D` (5) | THE WHOLE-MATCH REFERENCE MODEL: seeded random matches fed input by input to the engine and to an independent naive model (`bughouseReferenceModel.ts`: chessops for ONE board's rules - legal moves, drops, check, promoted marks, what a capture takes -; plain arithmetic for the credit to the partner, the clocks, the settlement and tie-break, `stuck` by brute force, the result). **2,000 matches, 118,688 plies, 4 parallel shards, 35 s wall-clock (about 114 s of CPU) on this machine.** After every input the outcome (applied / flag / idle / rejected AND the reason) and the whole state (both positions, promoted marks, four pockets, four clocks, verdicts, result, seq) agree; a refusal returns the same object; replaying the accepted stream of every 20th match rebuilds the identical text. |
| `bughouseBoards` (3) | THE PER-BOARD DIFFERENTIAL: 7,679 positions (from seeded matches, random sparse positions and a mate / stalemate hunt) questioned three ways - the engine, ChessEngine's Crazyhouse, chessops - legal moves, drops and the check flag identical; verdicts equal except the four deliberate differences, each asserted AND counted (D1 a mate a dropped piece could still answer is `stuck`: 20 positions; D2 stalemate is `stuck`: 26; D3 the fifty-move rule never ends a game: 87; D4 bare kings play on). |
| `bughouseInvariant` (2) | THE CONSERVATION INVARIANT after EVERY commit of 520 matches (30,084 commits, 9,992 credits, 6,391 drops): each colour owns 16 pawns / 4 knights / 4 bishops / 4 rooks / 2 queens / 2 kings (a promoted piece counted as the pawn it was), 64 in all; a credit is +1 to exactly the partner and to nobody else; a drop is -1 from the dropper's own pocket; seq +1 per commit; replay rebuilds the state. Seven kinds of damage are detected. |
| `bughouseSettle` (28) | every boundary with literals: `d == now + 1 / now / now - 1`, two flags 1 ms apart (either order), the exact tie at BOTH levels (lower start seq loses; equal seq: even room makes board A lose, odd board B), a flag against a mate one millisecond before / at / after its deadline and in both orders, the mover's own flag, a timer, a late callback, the increment, frozen clocks, refused instants, the end. |
| `bughouseRules` (38) | one scene per rule of BUGHOUSE_SPEC.md section 1 (R3-R26), B1 (2nd-rank drop, double step, en passant), B4 stuck versus a real mate and the exact commit at which a partner's capture flips it, B5, B6 (a dropped rook does not restore castling), the counterfeit, HP1 (a capture and a drop at the same millisecond in both arrival orders), every refusal. |
| `bughouseGolden` (25) + fixture | THE BUGHOUSE GOLDEN: 40 seeded full matches (driven by the engine alone, so independent of chessops) and 20 scripted scenes, the complete match text after every input hashed; byte-identical on three recordings and in-process; coverage asserted (3,571 commits, 1,273 captures, 975 drops, 32 promotions, 5 mates). |
| `bughouseSnapshot` (15), `bughousePremove` (8), `bughouseClock` (9), `bughouseEngineApi` (29), `bughouseBoardArgument` (13) | the text (one line, fixed keys, hostile input of many kinds refused with a reason, 3,000 random corruptions never throw), premove resolution (each cancellation reason), the clock helpers, the match API (creation, copies, listings, direct refusals, the proofs behind the equivalent mutants), and the AST scan that no helper naming a board's data defaults or omits the board. |

**What the first sketches got wrong, found by the tests, not by review:** (1) a back-rank rook check (`Rh8` against a king boxed in by its own pawns, `Q@e8`) is NOT mate - a piece dropped on f8 / g8 could block - so six of my "mate in one" scenes were `stuck`, and the engine was right each time; (2) chess.js's `moves({ verbose: true })` costs about 3 ms (a notation and two FENs per move) against 0.15 ms for `moves()`, which made the first model test 40 times too slow - `judgeBoard` now asks chess.js's raw "has a move" (`isCheckmate` / `isStalemate`) and the engine reads the board once per call.

**Mutation** (in-repo harness, `scripts/mutation/configs/bughouse-w1-engine.config.cjs`, two passes): **225 mutants - clock 23, settle 17, match 78, board 40, invariants 15, snapshot 39, premove 13 (types.ts had 31 in W0) - 221 killed, 4 proven equivalent.** First pass 186 killed in 12 chunks of at most 20 (fast suites); 39 survived; the slow suites (model shards, differential, invariant) killed 10; the other 29 were real test gaps (creation validation, copies, listings after the end, `applyAction` refusals called directly, the premove lookup, castling carrying a promoted mark, the notation, 8 `invariants.ts` checks that only the slow invariant test exercises) and `bughouseEngineApi` (29 tests) was written; a final full pass: 213 killed fast + 8 killed by the slow suites + 4 equivalent. **The four equivalent mutants, each with its proof pinned by a test:** the verdict recomputed with last turn's pockets (the verdict is about the side to move and depends on ITS pocket only; a commit on this board never changes it - `judgeBoard ... does not depend on the OTHER side's pocket`); an en passant capture not flagged (the victim is a pawn; no mark sits on the empty landing square of a reachable state - the conservation invariant); a drop keeping the en passant square (chess.js's `put()` already clears it - `chess.js clears the en passant square`); a rejected FEN after a drop treated as played (chess.js accepts the position of every legal drop - `playDrop accepts every legal drop`, 2,000+ drops). A note on the harness: a chunk of 20 slow-pass mutants took up to 17.5 minutes, under the 20-minute cap but not by much, so the slow pass is run on survivors only.

**Repeatability and load (the brief: new tests 10/10 and under CPU load, no wall-clock assertions).** The W1 and W0 Bughouse suites together (`bughouse*`, `crazyhouseBughouseExports`, `crazyhouseGolden`: 218 tests) were run **10 times in a row, 10 of 10 green (81-98 s each)**, and once with one busy thread per logical CPU running beside them: green (131 s). No test asserts a duration or reads a clock: every instant is an integer the test passes in; the only timing figures are the printed ones.

**Benchmark** (`BENCH=bench-crazyhouse.ts scripts/bench/ab-procs.sh <master worktree> 14`, master `d27ea66` against this branch, the same script on both): `getLegalDrops` 0.995 [0.984, 1.012], `getCrazyhouseMoves` 0.984 [0.973, 1.000], `crazyhouseCheckInfo` + `legalDrops` 0.998 [0.989, 1.010], a move + drop replay 1.001 [0.988, 1.015], **the bot 0.995 [0.979, 1.000]**; widest interval 0.973-1.015: inside +-5% (W1 does not touch `crazyhouse.ts`).

**Gates, final commit.** `tsc` clean in both repos; **vitest 1721 / 1721, 100 files** (1558 + 163); the goldens FFA, Giveaway, Chaturaji, geometry and Crazyhouse green and unchanged, plus the new Bughouse golden; `sync:fourplayer --check` (11 files) and `sync:bughouse --check` (10 files) in sync; the backend suites in the backend's TESTING.md section 39, all at their previous counts.

## 36. Bughouse W2 - the bot, the wire, and the server loop (branch `paired/bughouse`; backend TESTING.md section 40)

**What W2 is.** BUGHOUSE_SPEC.md section 7, W2: the server game loop, the bots, the team chat and the quick messages - NO screen, nothing reachable from a menu. The server half (room manager, matchmaker, handlers, the e2e) is in the backend's TESTING.md section 40; this repo holds what the app and the server SHARE: `src/logic/bughouse/bot.ts` (the bot) and `src/logic/bughouse/wire.ts` (the protocol: event names, payload types, validators, `classifyBugRejoinAck`), both mirrored to `backend/src/game/bughouse/` by `npm run sync:bughouse` (the manifest now lists 12 files). Build log, deviations and what W3 needs: BUGHOUSE_SPEC.md section 9. W1's engine changed in ONE way: **`disconnect` is no longer a result reason** (no W2 path issues it; rule 23), which removed one scene from the Bughouse golden (`bughouseGolden.test.ts`, its kit and `fixtures/bughouseGolden.json`: one line) - the other goldens are untouched.

**The tests (all in `npm test`; 81 new, 4 files: 1721 -> 1802 tests, 100 -> 104 files):**

| Suite | What it pins |
|---|---|
| `bughouseBot` (19, quick) | what the bot DOES: the caps it was measured with (5 / 12 / 3 / 2); 360 seeded decisions at three tiers, drops included, all inside the engine's legal lists; null when it is not the seat's turn, the match is over or the seat is stuck; `firstLegalAction`; determinism (the same match, seat, strength and seed give the same action; a whole bot match is a function of its seed; a stronger bot follows the scored choice more often); it finds a mate in one by a move and by a drop (the queen the human partner just captured on the other board); a back-rank "mate" in chess.js's notation is not a Bughouse mate; it takes the free queen rather than the free pawn, does not hang its queen for a defended pawn, does not take a pawn that allows a MATING DROP (and does when the opponent has nothing to drop), still finds a safe move when every good-looking move loses to a mate (the rescue batches), promotes to a queen, uses a piece in its pocket, drops to safe squares; nothing it says is played unchecked (the funnel refuses an illegal action); its signature has no board default. |
| `bughouseBotNumbers` (46) | WHY it does it, the numbers as literals: the strength dial at its exact thresholds (and clamped at both ends), the scripted random branch, every term of the pass-1 score, the drop filters and the cap of 12 (also in the bot's own decision: 13 candidates when there is one king move), the probe squares of a mating drop (`nearestDrops`: touching squares first from any distance, near = 2 squares), the reply (the BEST capture, a mate by a move, a mating drop beside the king), the look-ahead counted in ENGINE CALLS (a `vi.mock` pass-through counter: 5 finalists, 10 or 15 when a batch is fatal, never more), a first batch that is merely bad is not rescued, ties are told apart by the random stream, a seat not on move or in a finished match chooses nothing in the random branch too, a promotion on board B is played on board B, and the properties that make the unreachable guards unreachable (over real positions: every notation matches the pattern and resolves; a legal king move never lands on an attacked square; no move or drop changes the OPPONENT's pocket; a move or drop ends the match only by mate; a position always has both kings). |
| `bughouseBotBudget` (3, slow) | 2,400 seeded decisions all inside the engine's own legal lists (drops included); 40 whole self-play matches on a simulated clock through the real funnel (every action accepted, conservation intact, every match ends); the LATENCY per tier (below). |
| `bughouseWire` (13) | the protocol surface: the literals (limits, names), the closed reject list (the engine's nine, then the server's five), eleven client events and seven server events all `bug_*` and none shared with the 4-seat protocol, every validator (ids of at most 64 characters, boards A / B, the six time controls in ms, moves and drops with canonical squares and never a king drop, room and rejoin payloads, chat text trimmed / cut at 500 / refused when empty, quick codes 0-9 and nothing else), and `classifyBugRejoinAck` (a live match resumes, a finished one hands back its result, anything else is unavailable). |
| `bughouseBotKit.ts` | the bot ARENA (four bots, any ELO per seat, a simulated clock, every random choice from one seed, `onDecision`, `repeat`); the backend's `test-bughouse-bot.mjs` mirrors it. |

**The bot's decision cost, per tier** (500-650 seeded decisions per tier from real matches, each decision timed 3 times and the fastest kept; this machine, quiet; only the 25 ms p99 ceiling is asserted, the numbers are printed): ELO 400 p50 0.24 / p99 4.97 / max 6.22 ms; 800 0.26 / 4.50 / 5.71; 1200 0.28 / 4.01 / 4.48; 1700 1.39 / 4.39 / 5.59; 2000 1.64 / 4.78 / 5.33; 2400 1.68 / 4.58 / 5.07; 3000 2.10 / 4.72 / 6.97. With other work running on the machine (dev servers, a build) the same run read p99 12.5-15.7 and max up to 22 ms: the budget holds in both conditions. The cost does not grow with the dial because the work is bounded by counts, not by a clock.

**Tuning, not logic (not mutated).** The 0.04 centre bonus, the 0.02 / 0.1 jitters, the 0.3 castling bonus and the 0.05 / 0.3 pawn-drop reluctance only order moves the scores already rank within a fraction of a pawn; they are listed in the header of `scripts/mutation/configs/bughouse-w2-bot.config.cjs`.

**Mutation** (in-repo harness, copy-based, results outside the repo, chunks of at most 20 mutants). **The bot** (`bughouse-w2-bot.config.cjs`, 150 mutants: the dial, the candidate filters, the caps, the look-ahead batches, the mate and mating-drop checks, the reply, the probe squares, `touchesKing`): the first config had 122 mutants and 66 survived the quick suite - they were real gaps in what the tests pinned (numbers read from the module cannot kill a mutant of it) - so the bot was refactored to export its pure parts (`scoreCandidates`, `replyDanger`, `nearestDrops`), `bughouseBotNumbers` was written with literals, and the config grew to 150. Run 3 (8 chunks of at most 20, 229-305 s each, baselines green, none timed out): 127 killed, 23 survived; each survivor then either got a test (11: the default drop cap in the bot's own decision, the loss as the best capture rather than the sum or the least, three squares counting as near, a drop on the king's own square, a promotion on board B, the two choose guards through the random branch, ties told apart by the stream, the rescue threshold) or an EQUIVALENT label with its proof (12). Run 4 of those 23: 11 killed, the 12 labelled ones survive as expected. **Final: 150 mutants, 138 killed, 12 proven equivalent** (each a guard no reachable position can trigger; the proof is a property test over real positions, named in the config header: unparsable notation, a king move to an attacked square, no king, an unresolvable notation, a result other than mate, the opponent's pocket read before the move, an empty random pool, nothing to do). A lesson of the run: I had first labelled the two `choose` guards (not the seat's turn / a finished match) equivalent "because the fallback returns null" - wrong, the random branch does not go through the engine; a test killed them. A DIFFERENTIAL SEARCH found the positions for the three hardest survivors (the same seeded decisions run against the original and a mutated copy; the first position where they differ is pinned as a literal). **The server** (`bughouse-w2-server.config.cjs`, 372 mutants of the rooms, the matchmaker, the handlers and the config numbers; the backend repo is the one mutated): final run 19 chunks, **354 killed, 18 proven equivalent** (every one carries "EQUIVALENT" and its reason in its name; the first run had 41 survivors, 23 real gaps killed by new tests).

**Repeatability and load (the brief: new tests 10/10 and under CPU load, no wall-clock assertions).** The four frontend files above plus the backend's seven in-process Bughouse suites (rooms, messages, matchmaking, handlers, test switches, bot, lockstep) were run **10 times in a row: 10 of 10 green (about 103 s each)**, and once with a busy thread per logical CPU (8) running beside them: green. A test of mine was flaky once in the real-socket persisted-rejoin run (it read the LAST seat update, and the restarted app's socket ends shortly after its hand-back); it now reads the first update after the takeover. No test asserts a duration: every instant is an integer the test passes in, every wait ends on a condition.

**Gates, final commit.** `tsc` clean in both repos; **vitest 1802 / 1802, 104 files** (1721 + 81); the goldens FFA, Giveaway, Chaturaji, geometry and Crazyhouse green and unchanged, and the Bughouse golden changed ONLY by the removed `disconnect` scene; `sync:fourplayer --check` and `sync:bughouse --check` (12 files) in sync; `backend/src/game/fourPlayerRooms.ts` and every other 4-seat file: an empty diff against `main`; the backend suites, the real-socket e2e, the persisted rejoin and the fuzz at the counts in the backend's TESTING.md section 40. The local database ends with the 7 accounts it started with.

## 37. Bughouse W3a - the Local screens (branch `paired/bughouse`) and the audit of W2's "equivalent" mutants

**What W3a is.** BUGHOUSE_SPEC.md section 7, W3a: the Play-menu card and its rules sheet, the Local setup (the 4-seat Human / Bot seat model with Board / colour / team labels, four presets, the size gate), the standard layout for ONE human (large board + partner thumbnail with tap-to-swap in portrait, two equal boards in landscape), pass-and-play for humans on ONE board, the drop tap-pair, the `stuck` line, the capture -> partner-pocket highlight, the game-over card. Humans on BOTH boards are W3b: the setup refuses them below the minimum size and says "coming next" above it. **Interactions (CHECKLIST 1):** Bughouse is its own card and its own screens; nothing in the other variants changed except two additive props (`TimeControlSelectScreen.onlyIds`, an optional `seamKey` in `BoardGestureOptions` that the real hook ignores). Build log and deviations: BUGHOUSE_SPEC.md section 9.

**The code** (all new unless noted). Pure, no React: `bughouseLayout.ts` (seat rows, presets, `deriveBughouseLayout`, the cell sizes, `getBughouseDualCellSize`, the gate), `bughouseView.ts` (orientation, the turn lock `touchSeat`, `dropSquares`, `pocketChips`, `boardStatusLine`, king badges, `gameOverSummary`, clock text, the cell <-> square map), `bughouseLocal.ts` (the Local game state over the engine's `settle`, the bots' due seats and pace), `bughouseRulesSheet.ts` (generated from the engine's constants). Screens and components: `BughouseSetupScreen`, `BughouseGameScreen`, `BughouseBoardBlock`, `BughouseBoard`, `BughouseRulesSheet`; `PlayModeSelectScreen`, `App.tsx` and `TimeControlSelectScreen` extended. Every helper that names a square, a cell, a pocket or a clock takes the BOARD (or a seat, which names its board).

**The tests (all in `npm test`; 111 new, 7 files: 1802 -> 1913 tests, 104 -> 110 files):**

| Suite | What it pins |
|---|---|
| `bughouseLayout` (26) | the four rows' text and shapes, the presets as literals, ALL 16 human / bot patterns -> layout, `getBughouseDualCellSize` at every row of the spec's table, constructed ties (664 x 928 stacked, 700 x 960 side by side, 699 x 960 stacked) and the exact minimum (240 x 736, 472 x 352, one pixel less each way), the gate (`noHuman` / `tooSmall` with the spec's sentence / `comingNext`), the standard cell sizes (36 at 360 x 640, 49 at 412 x 915, 28..52), the arrangement rule, the six time controls, the rules sheet |
| `bughouseView` (26) | orientation per layout (the partner's board shows the PARTNER's colour; pass-and-play turns; auto-turn off), the cell <-> square map (corners and a 64-square round trip), the turn lock, `dropSquares` against the engine (62 knight squares, 48 pawn squares, never rank 1 / 8; in check only the blocking squares; none against a knight check), pocket chips, the status line (a `stuck` side is waiting, never mated; "Checkmate" only for a real mate - scholar's mate, not a distant queen check), the checked king, badges, the game-over summary for checkmate / flag / resignation / voided, the clock text |
| `bughouseLocal` (13) | the Local state through `settle`: last move per board, a capture banks for the PARTNER (the flash names seat and piece), a drop, refusals return the same state, the instant raised to the match's, the flag at the exact deadline and the tie-break, the bots' pace and due seats (none when stuck or over), the seat's own ELO, four bots playing a whole seeded match |
| `bughouseUiBoardArgument` (8) | the AST scan of the new logic files (no `BoardId` / `BughouseSeat` parameter optional or defaulted; every function naming a square / cell / pocket / reserve / clock takes a required board or seat, with two short listed exceptions that are themselves checked), no Bughouse UI file imports the 4-seat index or names `SIZE` / `squareName` / `parseSquare` / `fromDisplay` / ..., every test id or label that names a square names its board, the gesture seam is filed under the board |
| `bughouseLocal.dom` (35) | RENDERED (jsdom + react-native-web): the Play-menu card and the rules sheet from the menu, the setup and the game's Rules button; the setup's rows, presets, Human / Bot, the gate message at 360 x 640, 412 x 915 and at the exact boundaries; the layout per seat configuration; orientation and badges per layout; pass-and-play turn lock and flip; the drop flow with the engine's squares, a pawn never on rank 1 / 8, a drop in check; promotion; the capture -> partner pocket highlight; `stuck` as waiting; the check highlight and the last move; a whole game with one human and three bots played to its end with the deciding board marked; Rematch / Back to menu; a scholar's mate by two humans compared with the engine's own result; a regression for the bug below |

**What the screen tests and the browser found, in code of this workstream:** (1) a window of 0 x 0 - react-native-web reads `document.documentElement.clientWidth / clientHeight`, which jsdom reports as 0, so every earlier dom test ran in a 0 x 0 window; `setWindowSize` in `domKit.tsx` now sets it, and (command #24b) `domSetup.ts` starts EVERY rendered test at 412 x 915 (`domWindow.dom.test.tsx` pins it, 2 tests: 109 -> 111 new tests, 1911 -> 1913). **What the default changed in the existing rendered tests** (the whole `dom` project run at 0 x 0 and at 412 x 915, the hash of each test's markup, visible text and test ids / labels compared): all 80 tests pass at both sizes; the 24 Chaturaji screen tests and the 10 `useScoreGains` tests keep the same text, ids and labels (only the inline pixel sizes of the boards differ, which is why their markup hashes differ); one Chaturaji test ("a premove queued while the bots move ...") renders differently from run to run even at 0 x 0 (an unseeded bot move in its output; its result is stable, see TODO.md). No test needed fixing: none passed only because of 0 x 0. The Bughouse file had been setting 412 x 915 itself; with that removed, its 3 orientation / badge tests fail at 0 x 0 (they need the portrait layout) and pass at the default. (2) The dom test could not see it, the browser did: a selection (or a picked pocket piece) was cleared by EVERY commit, so with bots playing the other board a tap pair could never complete. A half-made action now remembers the position of ITS board and is dropped only when that board changes (`BughouseGameScreen`, test "a selection survives the bots playing the OTHER board"). (3) Landscape 800 x 360: the boards were the specified 232 px but the header, a controls row and tall bars made the page 393 px high in a 295 px viewport; there is now one 36 px bar and compact seat bars, and nothing scrolls.

**Mutation** (in-repo harness, `scripts/mutation/configs/bughouse-w3a-logic.config.cjs`, results outside the repo): **166 mutants of the non-visual logic - layout derivation, seat rows, presets, the size gate and every cell size, orientation, the cell map, the turn lock, drop squares, pocket chips, the status mapping, the checked king, badges, the clock text, the game-over summary, the Local state and the bots' due seats - 166 killed, 0 equivalent.** First pass (9 chunks of at most 20, 35-119 s each, baselines green): 158 killed, 8 not: 2 were invalid patterns (the same text occurred in another function: made unique), 1 survived because the removed `throw` is followed by a `TypeError` (the test now demands the `RangeError` and its message), and 5 were real gaps (a wide AND tall window where stacked still wins, one pixel of the standard chrome, pass-and-play on board B reading board A's turn, a voided match having a viewer result, the bot always playing at ELO 1200); each got a test and a second run killed all 8. Not mutated: colours and spacing of the components (the browser pass's job).

**The browser pass** (the built-in browser on an OWN Expo dev server, port 8093, never :8081 / :8082; stopped afterwards; screenshots outside the repo under `.claude/projects/.../tool-results/`): 412 x 915 - a full game, the move by two real clicks, a queen dropped from the pocket (31 highlighted squares, none on rank 1 / 8, the chip spent), the game ended by the human's flag: "Team 2 wins / Board A - flag fell", board A outlined, Rematch / Back to menu; 360 x 740 - a full game, cell 43, board 344 px, no horizontal overflow, the thumbnail swap (board B large with Black at the bottom, the badge on the partner's king), ended by flag; 360 x 640 - the setup with "2 teammates" shows the spec's sentence and Start is disabled, "You + 3 bots" and "2 opponents" start; 800 x 360 - two equal boards (232 px), my board White at the bottom and the partner's Black, a move played, nothing scrolls. Not done in the browser: pass-and-play (dom-tested), both colour themes, a mate or a promotion by a human.

**The audit of the 30 "equivalent" mutants of W2 (Part A of the brief).** The configs hold **31** (12 in the bot, 19 in the server; W2 said 18 for the server). Every one was read, an input that tells it apart was searched for, and the labels were checked by running them: **4 were wrong, now killed**, 27 stand.

| Mutant | Outcome |
|---|---|
| bot: a seat with nothing to do chooses | **KILLED.** It returns null on every path, but the random stream is shared by every later decision of a seeded match and the mutant draws one number first. New test: "a seat that cannot act draws NOTHING from the random stream" |
| server: the delay clamp in `armClockTimers` | **KILLED.** "The deadline is always after the instant" was wrong: the re-arm reads the clock AFTER the broadcast, so a broadcast slower than the remaining time leaves the deadline behind it (Node 24 prints `TimeoutNegativeWarning`). New check: a clock jump inside the `bug_state` emit |
| server: the "no legal action" report in `playBotTurn` | **KILLED.** Unreachable by the real engine, reachable by a state whose verdict says "playing" over a position with no move and no drop; the report is the safety net for exactly that. New check: the bot answers nothing and nothing is legal -> two ERROR lines |
| server: the stale-lobby guard of the matchmaker | **KILLED** by tests that already existed (the white-box `onFillTimer` calls): the label was wrong |
| bot: empty pool / unparsable notation / king penalised / no king (x2) / no candidates / unresolvable notation / any result is a mate (x2) / pocket read before / a thrown error escapes (11) | equivalent: each guard is unreachable (properties over real positions in `bughouseBotNumbers`, `openBoard` refuses a position without both kings, `chess.move(undefined)` throws and is caught, so even the "empty pool" mutant answers null) |
| server: the fired timer handle kept; a second all-gone countdown; `voidMatch` null / without result (2); the countdown handle after `endAbandoned` (5) | equivalent: the very next line replaces or clears the handle; a rejoin clears the countdown and a disconnect only counts the last human; `voidMatch` answers null only for a finished match or a backwards instant, both excluded by the guard and the held instant (pinned in `test-bughouse-rooms`) |
| server: bot tokens kept in the finished record; a replaced socket's late disconnect; the finished-room guards in `handleDisconnect` and `locate`; a bot seat's grace (5) | equivalent: a token is a string (the validator refuses anything else) and a bot's null never equals one; `rejoin` and the disconnect itself delete a replaced socket; a finished room is removed from the map; a bot seat has no socket |
| server: the idle message of `submit`; the handlers' token / empty token / ack-as-payload / label; 120.001 s bullet (6) | equivalent: `settle` answers idle only to a null input; `verifyToken` throws for both, every validator refuses a function as it refuses `undefined`, `createRoom` derives the same label, no time control lies between 120000 and 120001 ms |

**Repeatability.** The six frontend files that hold the 109 new tests (layout, view, local, board argument, dom, and `bughouseBotNumbers`: 155 tests) were run **10 times in a row, 10 of 10 green (33-49 s each)**; no test asserts a duration or reads a clock: every instant is injected or faked. **Under load:** once more with a busy worker thread per logical CPU (8, a self-terminating script with a 6-minute deadline, killed by PID after its command line was checked) the six files plus `domWindow.dom.test.tsx` (157 tests) were green in 50 s (33 s unloaded).

**Gates.** `tsc` clean in both repos; **vitest 1913 / 1913, 110 files** (1802 + 111: layout 26, view 26, local 13, board argument 8, dom 35, the default-window pin 2, and 1 in `bughouseBotNumbers`); goldens FFA, Giveaway, Chaturaji, geometry, Crazyhouse and Bughouse green and unchanged (no engine file changed); `sync:fourplayer --check` (11 files) and `sync:bughouse --check` (12 files) in sync; backend: `test:bughouseSync` 70, `test:bughouse` 9, `test:bughouseRooms` **259** (257 + the two audit checks), `test:bughouseMessages` 81, `test:bughouseMatchmaking` 82, `test:bughouseHandlers` 64, `test:bughouseTestSwitches` 41; the real-socket Bughouse e2e and the fuzz were not re-run (no server file changed, only a test script).

## 38. Bughouse W3b - humans on BOTH boards: two boards, two fingers (branch `paired/bughouse`)

**What W3b is.** BUGHOUSE_SPEC.md section 7, W3b: the Local layout for a seat setup with a human on each board (teammates, three or four humans), where two people (or one person with two fingers) play both boards at the same time. **The spike came first and is GO** (below). **Interactions (CHECKLIST 1):** only the Local Bughouse screen changes; the standard layout and pass-and-play (W3a) keep their `PanResponder` input and their tests (the two W3a tests that pinned "humans on both boards are refused above the minimum / say coming next" and the gate's `comingNext` were changed, because the helper they pin was extended on purpose); no engine file, no mirror, no server, no other variant is touched; premoves stay off (W5 decides nothing here: `premovesAllowed` is true only with exactly one human).

**The spike (HP12, go / no-go).** A throwaway page with two 8 x 8 grids, each with its own selection, driven by `useBoardTouches`, on the app's own Expo dev server (web) in the VM's Chromium, with CDP `Input.dispatchTouchEvent` carrying two `touchPoints`: overlapping touches on A and B both committed (the order they lifted in was theirs), a touch on A never cleared the selection on B and vice versa, a touch that started on A and ended on B was ignored, a touch in the gutter was ignored, a wander-and-return and a cancel were not taps, and 10 overlapping pairs (20 taps) all arrived on their own board. **GO on web. A phone cannot be verified from here** (see the hand-check list in the report and in BUGHOUSE_SPEC.md section 9); the fallback (`react-native-gesture-handler`) was NOT added.

**The code.** Pure: `boardTouches.ts` (a book of touches per board by identifier: a tap = a touch that lifts within 10 px of where it began and never wandered further; `insideGrid` / `gridTapCell`: both ends must lie inside the board's own grid), `bughouseSelection.ts` (the half-made action of ONE board - picked piece, picked pocket piece, a promotion waiting - as a reducer; a commit names its board; an action is dropped when ITS board's FEN changes or no human may act), `bughouseLayout.ts` additions (`dualBoardPlan`, `needsRotateOverlay`, `premovesAllowed`, the gate now starts a dual setup that fits, `BUGHOUSE_DUAL_GUTTER` 12, the overlay's words), `bughouseView.ts` (`dualBoardOrientation`). Components and screen: `useBoardTouches` (the raw touch / mouse handlers of a board's grid, its chips and its promotion buttons; no responder at all), `useBoardSelection` (one reducer instance per board), `BughouseBoard` / `BughouseBoardBlock` (`rawTouch`: chips and the promotion choice are plain Views; the promotion choice is drawn over ITS board because a shared Modal would cover the other board), `BughouseGameScreen` (the dual branch: `dualInput(board, input)` routes a tap to that board's reducer only; per-board orientation, pass-and-play rules on a board whose two colours are human - it turns to the side to move, its status line is the banner `turn-banner-A/B`, only the side to move may touch -, one slim bar in both arrangements, a Resign button per team that has a human, "Turn: auto / fixed", the rotate overlay). **Deviations from the spec text:** the promotion choice is per board and inline (not the Modal of the other layouts); Resign is per team in this layout; the stacked layout keeps the controls on their own slim row (four controls do not fit beside the title at 360 px); the block is taller than the spec's 8 cells + 96 px and the chrome differs - the browser measured what fits and the table of 5.6 still holds (the cell sizes are unchanged and pinned).

**The tests (124 new in 5 files: 1916 -> 2040 tests, 110 -> 115 files):**

| Suite | What it pins |
|---|---|
| `boardTouches` (18) | the book: a tap carries its start, end and target; the 10 px limit at 10 / 11 on both axes and on the diagonal; a wander that comes back is not a tap; a cancel; an identifier this book never saw changes nothing; two fingers in either order; 20 fingers in a row; the book is not mutated; **a plain-model property over 2000 seeded streams** (the proof for the one equivalent mutant); the dead zone at every edge, the cell under the LIFT, rectangular grids |
| `bughouseSelection` (18) | pick up / switch / clear / play; the commit names its board; promotion asks, offers exactly what the position allows (queen first), cancel, a tap gives it up; chips (lift, put back, replace, an empty chip cannot be lifted); a drop; stale FEN per part; nothing accepted when no human may act; **200 seeded interleavings of two reducers: each ends where it would alone, with the same commits** |
| `bughouseDualLayout` (8) | the nine dual setups board by board (`dualBoardPlan`), the colour at the bottom of each board (one human; shared: follows the turn, fixed with auto-turn off), `premovesAllowed` for all 16 patterns, the overlay and the gate at every row and boundary of 5.6, the words and the 12 px gutter |
| `bughouseDualBoardArgument` (12) | the AST scan: the board is a required argument of every new helper that names board data (with listed, themselves-checked exceptions), every commit carries a required `board`, the touch layer is made for a board and every callback takes it first, **no View / ScrollView of the game screen carries a touch / pointer / responder / press / click handler** (no backdrop), the touch files use no PanResponder / Pressable / responder property, the chips and promotion buttons are Views |
| `bughouseDual.dom` (68) | RENDERED: the nine setups' layout (blocks, four clocks, pockets, banners only on shared boards, both team badges on all four kings); stacked vs side by side at six windows with both boards at `getBughouseDualCellSize`; orientation per board; two overlapping fingers select on each board with the engine's squares; a tap on one board never clears the other's; a commit on A leaves B's selection; two simultaneous moves; a bot moving on the other board between the two taps; the turn locks (shared board, bots, the end of the match); a touch that starts on A and ends on B; the gutter and the margin; a wander / a cancel; identifier order; the mouse (left only, a finger's pointer events are not mouse taps, a cancel); two fingers in ONE event; the grid read when the finger lifts (a board that slides under it), with a `measure` stub on fake timers (the phone path), with a scrolled page; 20 taps in alternation; drops from a chip on A and on B, a chip of the opponent's pocket does nothing, an unusable or dragged chip does nothing; promotions waiting on both boards at once, each chosen / cancelled on its own; the rotate overlay (the spec's words, the clocks run, the boundary rows, not over a finished match, not in other layouts); Resign per team; the turn control; the other layouts keep the PanResponder path; the highlight, the dots and the "picked up" chip go with a finished match; **a whole-screen property: 6 seeded interleavings, some with overlapping fingers, each board ends exactly where the same touches on it ALONE leave it** |

**What the tests and the mutation run found in code of this workstream:** (1) a chip of the OPPONENT's pocket listened too, and with one reducer per board a tap on it lifted a piece of the side to move (the Pressable of the other layouts is `disabled` for every chip that is not usable): only a usable chip has touch props now; (2) the start-time read of the grid origin was redundant (the lift overwrites it): removed; (3) the picked chip had no state a test or a screen reader could read: its label ends ", picked up"; (4) the first stacked layout overflowed 412 x 915 by 38 px although the size function said it fits (the real chrome and block heights are larger than the plan): trimmed, and measured in the browser at every window (CHECKLIST 11).

**Mutation** (in-repo harness, results outside the repo, chunks of at most 20 mutants / 20 minutes, one at a time, baselines green). `bughouse-w3b-logic.config.cjs`: **122 mutants** (the touch book, the dead-zone math, the selection reducer, the layout additions, the orientation) in 7 chunks of 47-62 s: first pass 119 killed, 3 survived; 2 were test gaps (the cell under the LIFT when a tap crosses a cell edge; a square reached by a promoting and a non-promoting move) killed with new tests, **1 is equivalent** (a touch that has drifted is re-examined on a later move: it is marked drifted again either way; the plain-model property passes on the mutant) => **121 killed, 1 equivalent**. `bughouse-w3b-screen.config.cjs` (the hook's identifiers / mouse / origin / callbacks, the block's wiring, the screen's per-board routing; each mutant runs both Bughouse rendered suites, about 40 s): **62 mutants**, 6 chunks of 12 (230-245 s): first pass (clean) 55 killed, 7 survived; **5 were test gaps** (a right / middle mouse button; the release of a finger's pointer ending a mouse press; the grid read for a chip tap; raw touches wired on the other layouts; a chip in the TOP bar with auto-turn off; the picked-up highlight and chip; a stale selection drawn after the match ended) killed with new tests, **2 are equivalent** (a locked board refusing the tap early: the reducer drops everything for a board nobody may act on; a Resign guard for a team without a human, which has no button) => **60 killed, 2 equivalent**. Not mutated (the browser pass's job): colours and spacing, `scrollEnabled`, the arrangement-specific bar. Before this restart a first screen pass found 4 survivors, among them the redundant start-time read (item 2 above).

**The browser pass** (`scripts/browser/bughouse-dual-touch.mjs`: its OWN `expo start --web` on a free port, killed by PID after its command line is checked, a real Chromium through `E2E_BROWSER_PATH`, `playwright-core` from the sibling backend checkout; it never touches :3000 / :8081 / :8082 or a deployed server; the Local game needs no backend): **60 of 60 checks** at 412 x 915 and 360 x 740 (stacked) and 800 x 360 (side by side), with four humans (every board on move at once): both boards the same size, inside the window, the cell at least 28 px, no overflow, both blocks and every control fully on screen; two overlapping touches select a piece on EACH board; a touch on A never clears B's selection and vice versa; two moves at the same moment both commit; a touch that starts on A and ends on B is ignored on both; a touch in the 12 px gutter and one just beside the board change nothing (and an ordinary tap on an empty square still clears); 20 taps (ten overlapping pairs, select / deselect) right at every step; a single finger on Rules still works afterwards (the responder system is intact); no error logged by our code; at 412 x 915 and 360 x 740 rotating to 360 x 640 shows the overlay, a finger at a cell would hit the overlay, the clocks run, and rotating back removes it; a desktop mouse plays the dual layout too. Screenshots: see the report. **Not verified: a real phone** (two real fingers on Android / iOS in Expo Go): only web can be checked here.

**Repeatability.** The five new files (124 tests) were run **10 times in a row, 10 of 10 green (20.8-22.6 s each)**, and once with a busy worker thread per CPU (4, self-terminating, killed by PID): green in 32.7 s. No test asserts a duration or reads a clock: every instant is injected or faked.

**Gates.** `tsc` clean in both repos; **vitest 2040 / 2040, 115 files** (1916 + 124); every golden fixture byte-identical (none touched); `sync:fourplayer --check` (11 files) and `sync:bughouse --check` (12 files) in sync; backend suites unchanged and green: `test:bughouseSync` 70, `test:bughouse` 9, `test:bughouseRooms` 259, `test:bughouseMessages` 81, `test:bughouseMatchmaking` 82, `test:bughouseHandlers` 64, `test:bughouseBot` 7, `test:bughouseTestSwitches` 41, `test:e2eBrowserOptions` 11 (the backend is merged with `main` and otherwise unchanged).

## 39. Bughouse W3b on a real phone - every tap one rank too low, and the screen that did not fit (command #26, branch `paired/bughouse`)

**What the phone showed** (Blackview Fort 200, Expo Go, "4 players" preset, stacked boards): tapping the pawn b2 selected the knight b1, g2 selected g1, c3 selected c2, a back-rank piece selected nothing (the tap landed below the board) - one rank toward the bottom, on both boards. Every earlier check was on web, where the frames match.

**The exact cause** (read from React Native 0.86's own sources in `node_modules`, so it is the mechanism, not a guess; only the phone can confirm the magnitude): `useBoardTouches` turned a touch into a cell with `touch.pageX / pageY` minus the grid's origin, and it read the origin with `node.getBoundingClientRect()` whenever that method existed (the web branch came first). With the new architecture a View ref on a PHONE has that method too (`ReactNativeElement`), and its answer is in WINDOW coordinates: `RootViewUtil.getViewportOffset` adds the root view's position in the window and, with edge-to-edge off, subtracts the status-bar / cutout inset (`ReactAndroid .../uimanager/RootViewUtil.kt`) - a NEGATIVE offset for an app that draws under a translucent status bar. A touch's `pageX / pageY` are relative to the ROOT VIEW (`TouchesHelper.kt`: "pageX,Y values are relative to the RootReactView"). Origin in one frame, touch in another: every tap moves by the status-bar inset (about 32 dp is 0.8 of a 40 dp cell): b2 -> b1, and a1's centre (half a cell above the bottom edge) falls outside the grid. The rendered test of the "phone path" deleted `getBoundingClientRect` before stubbing `measure`, so the phone's real combination (both methods present) was never run. `useBoardGestures` (the PanResponder path) reads the origin with `measure()` (root frame) and never with the rectangle: it is not affected.

**The fix, two layers** (`logic/boardTouches.ts`, `components/useBoardTouches.ts`, `components/BughouseBoard.tsx`): (1) on a phone the grid carries a transparent overlay (`board-X-surface`, the last child, absolutely filling the grid) that has the board's touch props; its touches are targeted AT the overlay, so `locationX / locationY` are the finger's position INSIDE the grid - no origin is read, so no window, status-bar, navigation-bar, header or scroll offset can enter the answer (a tap carries both ends in that frame or neither, never a mix; the 10 px drift limit stays in page coordinates, which are differences). (2) Where an origin is still read, `originSource(os, hasRect, hasMeasure)`: on web the rectangle (same frame as the touch), on a phone `measure()` (root frame) and NEVER the rectangle. On web the cells stay the hit targets and nothing changed (60 of the W3b browser checks still pass).

**Is "You + 3 bots" affected?** No, by construction and pinned: the one-human layout (and pass-and-play) uses `useBoardGestures` (`BughouseBoard`: `touches ? ... : interactive ? gestures.panHandlers`), which measures with `measure()`; only the dual layout (`rawTouch={dual}`) uses the raw-touch layer. `bughouseTouchDebug.test.ts` pins both facts (the hook has no `getBoundingClientRect`, the screen gives raw touches to the dual layout only).

**Tests.** `boardTouchesFrames` (16, logic): every square of both boards, either colour at the bottom, five cell sizes, four deliberately wrong origins, all map to themselves; status bar 0 / 24 / 32 / 48 x navigation bar 0 / 24 / 48 x header 0 / 56 / 120 x stacked / side by side (648 combinations); corners and edges; both ends inside the grid; rectangular grids and fractional cells; **the bug reproduced** (an origin a 32 dp status bar too small: b2 -> b1, g2 -> g1, c3 -> c2, a1 and h1 -> nowhere); `originSource`'s whole table; `localOfTouch`; the book carries the frame all-or-nothing; `fingerCell`. `bughouseAndroidTouch.dom` (15, rendered, Platform android): the grid's node has a window-frame `getBoundingClientRect` and a root-frame `measure`, a touch carries pageX / pageY in the root frame and locationX / locationY in the overlay: pawns and knights of board A for status bars 0 / 24 / 32 / 48 each select their own piece with no measurement at all; the back rank is reachable; board B; a different status bar per board; a touch without the overlay frame falls back to `measure()` and lands right; a lift with one frame only is read in page coordinates; the overlay exists on a phone and not on web or in the other layouts. **The browser (CDP) pass** (`scripts/browser/bughouse-dual-touch.mjs`) gained `offset`: the whole page moved down by a simulated top inset of 24 / 36 / 48 px at 412 x 915 and 360 x 740 (a transform on `#root`, so every rectangle moves) and every pawn and knight of both boards tapped with a real CDP touch selects ITSELF (20 taps x 6 = 120 more checks, plus 6 that the page really moved). Two older source pins were updated on purpose (`bughouseDualBoardArgument`: the wiring of the grid / overlay and the two new no-board helpers).

**The dev touch-debug overlay** (development builds only, off by default): in the two-board layouts a "Touch debug: off / on" control appears with Rules / Turn / Resign; switched on, each finger draws, over its board, a red frame on the cell the app computes, the square's name and a dot at the finger's position in the grid's frame (`TouchDebugOverlay`, `pointerEvents` none) - on the phone it shows in seconds whether the frame sits under the fingertip. It does not exist in a release build: `App.tsx` `require`s `src/dev/registerTouchDebug` inside `if (__DEV__)` (a literal false in a release bundle, so the require and the overlay are dead code), the board reads it from `components/devOverlayRegistry.ts`, and `bughouseTouchDebug.test.ts` scans that nothing else imports it and that the switch needs `__DEV__` and a registered overlay.

**The header and the bars fit** (`BughouseGameScreen`, `BughouseBoardBlock`): the control row (Rules, Turn: auto / fixed, the two team Resign buttons, in a development build also Touch debug) wraps instead of running off the window (it overflowed at 360 dp with five controls); the slim bar of the two-board layouts has a minimum height and sits BELOW the status bar / cutout (it ignored the top inset); the layouts are sized from the usable area (window minus the insets), not the whole window; the Resign buttons say who resigns ("Resign ◆ Team 1", "Resign ● Team 2", accessibility label "Team N resigns"); seat names wrap instead of ending in an ellipsis; the two-board screen scrolls when - and only when - its content is taller than the window; the rules sheet pads by the insets; the bars' text grows at most 1.2 x with the system font scale (`BughouseText`: the spec's cell table is sized to the pixel); slim controls and pocket chips keep their slim size and reach 44 dp by `hitSlop` (8-9 dp above and below) with `compact` (ignored by react-native's Pressable here, effective once the branch uses `AppPressable`). The screens are in the Android device matrix (`scripts/browser/android-matrix-screens-extra.mjs`: setup, 4 players, time control, rules sheet, You + 3 bots, 4 players, 2 teammates): run against this branch merged with the text-fit branch, the quick profile (22 combinations per screen) passes on all seven screens.

**When Bug A (branch `fix/android-text-fit`) is merged to master and master is merged here:** run `node scripts/codemod-app-components.mjs` (this branch's files import `Text` / `Pressable` from react-native; `textFit.test.ts` fails on them until then), run `android-matrix.mjs --profile quick` (the extra screens file is loaded automatically), and the two `compact` spreads become effective.

**Hand-check on the phone** (Expo Go, development build): in More > Diagnostics run "Run text-fit check"; in Bughouse > 4 players, open a game, switch "Touch debug" on and put a finger on g2: the red frame and the label must say g2 and sit under the fingertip, on board A and on board B, with the status bar showing, and again in landscape; then play two fingers on two boards.

## 40. Bughouse after master's text-fit change was merged in (command #27, branch `paired/bughouse`)

**The merge.** `origin/master` (264bc6e, PR #26 "Android text fit") merged into `paired/bughouse` (fe14c5d): **no textual conflict**; the backend needed no merge (its `main` was already merged, fef5fdb). `node scripts/codemod-app-components.mjs` rewrote the 7 Bughouse files that imported `Text` / `Pressable` from react-native (`BughouseBoard`, `BughouseBoardBlock`, `BughouseRulesSheet`, `BughouseText`, `TouchDebugOverlay`, `BughouseGameScreen`, `BughouseSetupScreen`); `textFit.test.ts` 10 / 10. The two `compact` spreads (the slim controls of `BughouseGameScreen`, the pocket chips of `BughouseBoardBlock`) now reach `AppPressable` and take effect: `bughouseCompact.dom.test.tsx` pins it rendered (the dual layout's controls carry the matrix exemption mark, the standard layout's do not).

**What the full device matrix found on the Bughouse screens** (never run in the full profile before; 8 screens x 720 combinations, the 7 listed plus "2 opponents" pass-and-play, which had no entry): (1) the bar's back button had AppPressable's 44 dp floor, the header grew from 44 to 52 dp and two boards side by side no longer fitted a 360 dp high window (the browser CDP pass failed 1 of 72: "800 x 360 both blocks fit the window height") - the back button is slim now (28 dp + hit slop); (2) a pocket with many kinds of piece ran over the clock beside it and, side by side, pushed the second board past a landscape phone's edge - the pocket wraps (`minWidth: 0`) and, side by side only, a block is as wide as its board; (3) the "~" of a promoted piece and the chips' glyph and count grew with the system font (board art: `maxFontSizeMultiplier={1}`); (4) the matrix itself: two marks inside ONE board cell (the piece and its "~") are not an overlap, and it waits until the layout stops moving before it checks (a self-sizing screen needs a few passes). (2) and (3) only show with pieces in the pockets / a promoted piece, which the bots produce by chance: they were reproduced with an uncommitted fixture (full pockets, two promoted pieces, applied to the screen for the run and removed): 4 game screens x 720, 2880 checks, green, twice.

**Team 1 / Team 2.** `keepTogether` (`bughouseLayout.ts`) turns the space after "Team" / "Board" into a no-break space in what is DRAWN (the setup rows, the resign buttons, the rules sheet); labels, accessibility text and engine strings keep ordinary spaces. The no-break space is built from its code (`NO_BREAK_SPACE`): no invisible character in a source file.

**Board size in the stacked 4-player layout.** `stackedDualCell`'s 288 dp of chrome is a calibration; measured in the browser the chrome is 300 dp at font scale 1 (256 inside the scroll view + the 44 dp bar), so the table overshot by 12 dp (the screen scrolled) and on the phone the boards used about 60 % of the width with empty space below. `fitStackedCell` sizes the boards from the room the scroll view REALLY has: the table's cell plus whole cells for the free space, never wider than the window, never below the minimum (28) or the table's own cell for a window it calls too small, not once the result card is up. Cell size in dp, table -> measured fit, in Chromium (window without insets / with a gesture strip + cutout): 360 x 784 **31 -> 30** (the table's 31 scrolled by 12 dp; 30 fits) / 26 -> 26; 393 x 852 35 -> 34 / 30 -> 30; 412 x 915 39 -> 38 / 34 -> 33; 480 x 1000 44 -> 43 / 40 -> 39; 360 x 740 28 -> 28 (8 dp of scroll at the minimum) / 23 -> 23 (gated). The browser cannot show the phone's empty space (its text metrics fit the table), so there the change is "one cell smaller and no scrolling"; on the phone the boards grow into whatever is measured (hand-check below).

**Tests.** `bughouseFitStacked` (9), `bughouseKeepTogether` (5), `bughouseBoardArt` (6, source scans), `bughouseCompact.dom` (2), the changed `bughouseLocal.dom` row labels; the matrix self-test gained 3 board-art cases; `androidMatrixDef` pins the tab-bar screens. **Mutation** (`bughouse-polish.config.cjs`, in-repo harness, 27 mutants, 2 chunks 143-485 s): **26 killed, 1 equivalent** (`stacked` also true in the standard layouts: the adjustment only feeds the dual render). First pass: one pattern that named an invisible character (the source now has none).

**Gates (VM).** `tsc` clean in both repos; vitest **2179 / 2179, 130 files**; goldens byte-identical (`git diff fe14c5d..HEAD -- src/logic/__tests__/fixtures` empty); `sync:fourplayer --check` 11 files and `sync:bughouse --check` 12 files in sync; backend suites unchanged and green (bughouseSync 70, bughouse 9, rooms 259, messages 81, matchmaking 82, handlers 64, bot 7, test switches 41, fourplayerSync 117); **device matrix, full profile, all 37 screens: 26640 checks, 0 failed**; the W3b CDP pass (`bughouse-dual-touch.mjs`) **72 / 72** (this includes the page-offset 24 / 36 / 48 px tap tests of #26) and `boardTouchesFrames` (16) green; the 10 touched / new Bughouse test files (176 tests) **10 / 10 runs plus once under four CPU-burning processes**.

**Hand-check on the phone** (Expo Go): Bughouse > 4 players: "Board A · White · Team 1" on one line (or wrapping between the dots, never inside "Team 1"), the two boards clearly larger than before with no empty band below (and no scrolling), the back button still easy to hit; More > Diagnostics shows the `[api]` lines of the offline-states branch once it is merged here.

## 41. Bughouse on a real phone, round 2: pockets that stay in their strip, and pieces that are the right colour (command #27b, branch `paired/bughouse`)

**What the phone showed** (Blackview Fort 200, Android 36, Expo Go, 360 x 784, 4 players, stacked boards, `dd6fd4a`): with two or more kinds of piece in a pocket the chips stacked VERTICALLY, the second one covering the top rank of the board (in the bottom strip, hanging over "White to move"); the black king drawn WHITE from the first position (the black bishop on f8 once too); a stray "-" after "Board A · Black" for an empty pocket. #27 had said the pockets were fixed: its fixture passed on the web.

**Why the pockets broke, and why the web matrix passed.** The pocket was a `flex: 1; flexWrap: 'wrap'` row inside the seat bar (the previous fix changed `nowrap` to `wrap` "so the bar grows"). The bar's height, and with it the position of the board and the clipping of everything below, then depended on how the layout engine measures a wrapping flex child. Chromium's flexbox grows the bar around the wrapped chips, so the web device matrix (and the temporary fixture of that fix) saw nothing wrong; the phone's own engine (Yoga, and Android's drawing order) did not. At 360 dp the strip leaves the pocket about 100 dp next to the name ("Board A · White") and the 58 dp clock, so a second kind of piece always wrapped. What is PROVEN here: the real Yoga (yoga-layout 3.2, the engine react-native 0.86 vendors) lays this exact tree out correctly when it is built in isolation (the bar grows), so the failure on the phone is not Yoga's wrap algorithm alone; what the phone showed - a bar that did not grow, a chip drawn above the board - needs the whole Android view hierarchy (view flattening, draw order) that no cloud tool reproduces. So the fix does not rely on a guess about the engine: it removes EVERY dependence on it (below), and the matrix now checks rectangles, not "the page looks fine".

**The fix** (`logic/bughousePocket.ts`, `BughouseBoardBlock`): the pocket is ONE row that never wraps (`flexWrap: 'nowrap'`, a definite height: chip + 2), inside a strip that CLIPS what it holds (`overflow: 'hidden'`, `minHeight` 36 / 30 compact) - whatever a layout engine does, nothing can be drawn outside the strip, so nothing can cover the board, the clock or the status line. The chips have COMPUTED widths: 24..40 dp, from the MEASURED pocket row (`onLayout`), never wider than the room; a chip is the piece (a vector, see below) with the count as a small pill on its lower right corner (a 2-digit count fits in 24 dp). The seat's name gives up its place before the pocket does: the strip is MEASURED too, and below 280 dp (92 fixed + 132 for five chips + 56 for the name; decided by the width alone, never by what the pocket holds, so nothing jumps during a game) the name is left out (the colour dot, the team shape, the clock, the status line and the strip's accessibility label say who is who). The narrowest strips the layouts allow (224 dp: a stacked board at the 28 dp minimum cell) have exactly the 132 dp a full pocket needs. An empty pocket shows nothing. Hit slop: the strip's own edge above and below, half a gap to each neighbour (a touch outside a clipping parent is not a touch of its child): about 36 x 26..40 dp for a chip, the most five chips in a 304 dp strip allow. Drops are untouched: a chip is still a `Pressable` (one finger layouts) or a plain `View` with its board's touch handlers (humans on both boards); `bughousePockets.dom.test.tsx` drops a queen from a full pocket on both paths.

**Why the black king was white.** The pieces were Unicode chess glyphs: a white piece the OUTLINE glyph (U+2654..2659), a black piece the SOLID one (U+265A..265F), both in the default text colour. The bundled Inter (#26) has none of those code points (`cmap` read from the font files: 0 of 12), so each glyph came from whatever fallback font the phone picks - a different font per glyph (an emoji font draws U+265F in its own fixed colour), with its own design of "black" - and the colour of a piece depended on the phone. Not the cause (checked): the text colour, a tint / opacity prop, the "~" promoted mark and the team badge (separate views). The fix: every piece is a VECTOR (`components/pieceArt.ts`, `PieceIcon`, react-native-svg like the Chaturaji boat), original silhouettes, white = fill #fafafa with outline #1b1b1b, black = fill #1d1d1d with outline #f1f1f1, the 4 seats' pieces in the seat's colour with a dark outline; used by `Piece` (2-player, Bughouse, promotion picker, captured pieces, the Crazyhouse reserve, the theme preview), the Bughouse chips and `FourPlayerBoard` (4 Player Chess, Giveaway, Chaturaji). Image piece themes are unchanged. Found on the way and fixed: **the squares of every Bughouse board were the wrong way round** (a1 light, a8 dark).

**The permanent matrix scenarios** (`android-matrix-screens-extra.mjs`; the fixture switch is `window.__EM_BUGHOUSE_FIXTURE__`, `logic/bughouseFixture.ts`, CHECKLIST 7: web + development build only, closed set `fullPockets` / `allPieces`, ignored with one warning that does not print the value, set only by the matrix's page): `bughouse-full-pockets-single / -passplay / -dual / -teammates` (every pocket holds all five kinds, counts 1..16, both colours, both boards, a promoted white queen on b7 of A and a black rook on f8 of B) and `bughouse-all-pieces-dual` (all twelve kinds on light and dark squares). New checks in the page (`android-matrix-checks.mjs`, `pockets: true`): the pocket is inside its strip, the chips are in one row, no chip overlaps another, no pocket or chip rectangle intersects the board grid, a clock, a status line or the text beside it; `--self-test` proves each (wrapped chips, a chip over the board, over the clock, two chips on each other, no pocket on a screen that declares them). New in the runner (`android-matrix-pieces.mjs`, `pieces:` on game screens: Bughouse, 2-player, 4 Player, Giveaway, Chaturaji): the PIXELS of one cell per kind and square colour are read from a screenshot and must be the piece's ink (near-white, near-black, the seat's colour); `androidMatrixPieces.test.ts` proves a black king drawn white is reported on both square colours.

**Tests.** `bughousePocket` (26, the geometry as literals), `bughouseFixture` (22), `pieceArt`, `androidMatrixPieces`, `pieceColours.dom` (all twelve kinds' rendered fill / outline, the engine's position against what is drawn at the start, the 4-seat colours, the square colours), `bughousePockets.dom` (20: counts and colours of all four full pockets, no wrap + clip, the measured strip and row through react-native-web's layout handler, an empty pocket draws nothing, drops on both input paths). Mutation: `scripts/mutation/configs/bughouse-pockets-pieces.config.cjs`.

**Gates (`a8fe4b7`, cloud VM, one after the other).** `tsc` clean in both repos; vitest 136 files / 2291 tests; goldens byte-identical to `dd6fd4a` (0 diff lines); both sync checks in sync; backend untouched (`fef5fdb`); the CDP dual-board touch pass (W3b + #26 offsets) 72 / 72; the 8 new / changed test files (183 tests) 10 / 10 runs and once under 4 busy CPU loops; `--self-test` of the matrix; the full device matrix 42 screens x 720 combinations = 30240 checks, 0 failed, 0 unreachable. Mutation (`bughouse-pockets-pieces.config.cjs`, copy of the source, chunks of at most 20): 115 mutants = 113 killed + 2 equivalent (the `flexShrink: 0` chip default, which the clipped strip and the computed widths make unobservable, and the unmeasured pocket row read as 0 wide, which the first layout pass replaces; each pinned by a test).

**Hand-check on the phone** (Expo Go): Bughouse > 4 players, play until both boards' pockets hold several kinds: the chips stay in ONE row in the strip (smaller when there are many), nothing covers the board or "White to move"; tap a chip, then a square: the piece drops; both kings, all pieces: white pieces light with a dark outline, black pieces dark with a light outline, on both square colours; the black king on e8 is black; a1 is a dark square; no "-" for an empty pocket.

## 42. Black rook, queen and king drawn white on a real phone - every piece theme, every piece (command #27c, branch `paired/bughouse`)

**What the phone showed** (Blackview Fort 200, Android 36, Expo Go, Bughouse 4 players, after #27b): pockets, drops, a1 and the "-" were right; the BLACK rook, queen and king were drawn white (white fill, dark outline) from the start position on both boards; black pawns, knights and bishops were right. The piece style looked like a Staunton set (cross on the bishop, crowned king), i.e. possibly not the vector set of #27b but a selected image theme.

**What was checked, with the result (nothing here is a guess).** (1) The renderer: the built-in "Classic" theme is the vector set (`Piece.tsx` > `PieceIcon`, `pieceArt.ts`); Cburnett, Merida and Chess with Checkers are 12 base64 PNGs each in `src/data/pieceSets.json`, drawn by an `Image` at 85 % of the cell, key `${color}${type}`; a custom theme is 12 user PNGs built by `ThemeSelectScreen`. The Bughouse boards, the 2-player board, the 4-seat boards, the theme preview, the captured strip and the promotion picker all go through `Piece` (the Bughouse pocket chips are always vectors). (2) The assets: all 36 shipped PNGs were decoded - every one is 120 x 120, the 6 black pieces of each set are darker than the 6 white pieces (mean tone of the opaque pixels), the black rook / queen / king are darker than EVERY white piece of their set, no two of the 12 are alike. No theme maps a black piece to a white asset: registry, key map and 4-seat key map (`seatPieceImageKey`) are literal-checked. (3) Rendered: Chromium renders of the 2-player board and of the Bughouse dual screen under all four themes are correct (pixels sampled on both square colours). (4) Master: `pieceSets.json` and `pieceThemes.ts` are identical on master (no diff); master's Classic theme still draws Unicode glyphs (the font-fallback class of #27b); no separate master PR was opened because the fix below is not a small change to shared code and the assets are not wrong.

**The cause on the phone is NOT established.** It was not reproduced anywhere: the shipped themes are right in the data and in the renderer. The remaining candidates are a custom piece theme with wrong user images (More > Manage Board & Piece Themes shows which row is "Active"), a stale or glyph-era bundle (the failing set K / Q / R against the right set B / N / P is exactly the split of the Unicode chess block, U+265A..265C against U+265D..265F), or an Android-only drawing difference that no cloud tool reproduces. What this command closes is the hole that let it go unseen: image themes were never inspected (the matrix judged only the vector set, the image pieces had no marker, and the old ink judge cannot read a multi-colour asset).

**The change.** `Piece.tsx`: an image piece is a wrapper `View` (85 % box, role image, label "black rook", marker `data-piece`) with the `Image` filling it - the same pixels as before, but now findable. `android-matrix-pieces.mjs`: `judgeImageCell` - the expected cell is the theme's asset box-filtered into the marked element's rectangle over the square colour (read from the photograph), compared in 8 px blocks; the verdict needs the nearest asset to be of the piece's colour AND its own asset within 15 (real pieces are 1..7 away, the swapped colour 10..58). `android-matrix.mjs`: screens may name a `pieceTheme` (written to `settings:activePieceTheme` before the page loads); new screens `game-2p-theme-<id>` and `bughouse-all-pieces-dual-theme-<id>` for default / cburnett / merida / checkers (`PIECE_THEME_IDS`). Also fixed on the way: `checkPieceColours` threw when the page drew fewer pieces than it had listed (it killed the first full run after 53 minutes); now such a piece is not judged, pinned with a fake page.

**Tests.** `pieceThemes.test.ts` (31: the four themes in order, 12 keys each, the registry, every pair of the 12 differs, the pixels of every asset say the colour its name says, the 4-seat key map; a theme without a matrix screen fails here), `pieceThemes.dom.test.tsx` (24: the real `Piece`, the real 2-player board and the real Bughouse screen under all four themes against the engine's position), `androidMatrixPieces.test.ts` (122: the image judge on synthetic photographs, the corner / rectangle cases, the fake page). Mutation: `scripts/mutation/configs/piece-themes.config.cjs`, 68 mutants (registry, `Piece`, ink, shapes, 4-seat map, the judge, and every black piece of the three image sets replaced by the white one) = 68 killed, 0 survived (4 chunks, 200 / 203 / 216 / 94 s).

**Gates (`f1ce17b`, cloud VM, one after the other).** `tsc` clean in both repos; vitest 138 files / 2446 tests (all goldens inside, no tracked file changed); both sync checks in sync; backend untouched (`fef5fdb`) and its suites unchanged; the CDP dual-board touch pass 72 / 72; the 4 new / changed test files (183 tests) 10 / 10 runs and once under 4 busy CPU loops; the full device matrix 50 screens, 30256 checks, 0 failed, 0 unreachable (the 4 theme screens of each kind included).

**Hand-check on the phone.** Bughouse > 4 players with the current theme: the black rook, queen and king are dark; More > Manage Board & Piece Themes, pick another theme, back to Bughouse: still dark; a normal 2-player game: the black pieces are dark. If one is still white, tell which theme row says "Active" (and whether it is a custom one): that is the missing fact.

## 43. Two Android-only piece-colour bugs: Merida's black king / queen and Classic's black pieces on the dark squares (command #27d, branch `paired/bughouse`)

**What the phone showed** (Blackview Fort 200, Android 36, Expo Go, `expo start --clear`, Bughouse 4 players, Ocean board, only the piece theme switched): Cburnett right; **Merida** (PNG): the black king and queen drawn white on both boards and both square colours (rook, bishop, knight, pawn right); **Classic** (react-native-svg): a black piece on a DARK (blue) square drawn with a light fill, on a light square right (the 7th rank alternates black / white-outline), white pieces right. Chromium shows none of it.

**Evidence collected here (nothing is guessed; what is not proven says so).**
- *The assets are right.* All 36 PNGs decode as 120 x 120 RGBA; Merida's bk / bq are dark (opaque pixels: bk 26 % dark / 11 % light, wk 14 % / 22 %; bq 31 % / 7 % against wq 22 % / 13 %). The two data URIs of each pair have lengths 7066 / 6310 and 6566 / 11026 and share only the first 97 characters (the PNG header and size; Cburnett also 97, Checkers 80-83): a cache key that truncated at 97 characters would collide for EVERY pair of one theme, not for two kinds.
- *The cache-key hypothesis is not supported by the source in `node_modules`.* `ReactImageView.kt` builds `ImageRequestBuilder.newBuilderWithSource(uri)` from `ImageSource.uri = Uri.parse(source)`: the whole string, no hash, no truncation, no size limit (`ImageSource.kt`; its `equals` compares the full `source`). Fresco's own cache keys are NOT in the tree (it is a Gradle dependency), so what it does with a long data URI could not be read here: UNPROVEN either way.
- *Both bugs are the same kind of thing on Android.* `react-native-svg` does not draw paths on the view's canvas: `SvgView.onDraw` renders the whole SVG into an offscreen `Bitmap` (`drawOutput`) and `canvas.drawBitmap`s it (`android/.../SvgView.java`, `onDraw`); a PNG is a Fresco bitmap. Both reach the screen as a BITMAP, and a system that re-colours bitmaps by what is behind them (Android's forced dark / forced inversion, which a phone with "dark theme for all apps" applies to Expo Go; `userInterfaceStyle: light` in `app.json` is honoured by a built app, never by Expo Go) would produce exactly a square-colour-dependent light fill on a black piece, and a wrong Merida K / Q only (bitmaps are classified one by one). This is the LEADING CANDIDATE and it is UNPROVEN: no emulator or device is available in the cloud.
- *The code has no square input.* `PieceIcon` takes `type`, `ink`, `size`, `opacity`; the ink is a function of the colour; no drawing module imports a board colour (pinned by `pieceIcon.dom.test.tsx`: the same piece rendered in front of both square colours is byte-identical, and a scan). No `currentColor`, no style-vs-prop split, no opacity (the stroke is 4 of 100 units: it cannot cover a fill), `fillRule` is a literal. Nothing in the app could produce the Classic symptom.

**What changed.** (1) The three image themes are BUNDLED FILES (`assets/pieces/<theme>/<key>.png`, 36, byte-identical to the base64 of `src/data/pieceSets.json`, generated registry `src/logic/pieceAssets.ts`, `scripts/generate-piece-assets.mjs --check`); a custom theme is 12 files in the app's own folder (`piece-themes/<unique id>/<key>.png`, expo-file-system `legacy`, `customPieceFiles.ts` + `pieceFileStore.ts`; the record keeps file URIs; an old data-URI record is moved once at start; the browser keeps data URIs); `pieceImageSource` is the one place an Image source is made. (2) A vector piece's paint is written out in full (`piecePathPaint`, the svg's own `color` and `opacity`). (3) **More > Diagnostics > Piece gallery** (also in a release build): every theme x 12 pieces x light / dark square of the active board theme, the same 12 as pocket chips, three PROBES in the black ink (a plain view, an SVG rect, a flat PNG) on both squares, the system colour scheme, and two buttons ("Lock app to light" / "Follow system": `Appearance.setColorScheme`) that test the forced-dark candidate in one tap; the build identifier (git short hash + time, `app.config.js` -> `scripts/build-info.cjs`, at bundle time) is in the fixed header and on the Diagnostics screen. (4) The device matrix got `--progress FILE` (resumable) and the gallery screen.

**Found by the matrix while doing it.** Wrapping every non-number asset in `{ uri }` left every image theme BLANK on web (the Expo web build resolves an imported PNG to `{ uri, width, height }`, a phone to a number): the rendered tests could not see it (vitest gives a URL string), the matrix's pixel judge did (`game-2p-theme-*`, `bughouse-all-pieces-dual-theme-*`); fixed and pinned in `pieceImageSource.test.ts`. The Diagnostics button row overflowed at 320 dp with large text: it wraps now.

**Which boards share which bug.** Image bug (any image theme): the 2-player board, the Bughouse boards, the promotion picker, the theme preview (`Piece`); the 4-seat boards (4 Player Chess, Giveaway, Chaturaji: the image on a seat disc, `FourPlayerBoard`). SVG bug (Classic): the same boards through `Piece` > `PieceIcon`, plus every place that draws `PieceIcon` itself (Bughouse pocket chips and promotion choice, `ReserveTray`, `CapturedPieces`, the 4-seat Classic discs, the theme preview) and `BoatIcon`. The gallery and its probes exercise `Piece` and `PieceIcon` directly.

**Master** has the same exposure: `pieceThemes.ts` / `pieceSets.json` identical (data URIs), Classic still the Unicode glyphs of #27b. No PR to master was opened.

**Tests and mutation.** New: `pieceAssets.test.ts` (13), `pieceImageSource.test.ts` (6), `customPieceFiles.test.ts` (11), `pieceGallery.test.ts` (10), `androidMatrixProgress.test.ts` (9), `pieceIcon.dom.test.tsx` (12), `pieceGallery.dom.test.tsx` (13); changed: `pieceThemes.test.ts` (bytes of the bundled files against the JSON), the stub of react-native-svg in `domSetup.ts` (all props in `data-props`). Mutation (in-repo harness, chunks of 20): `piece-themes.config.cjs` 68 / 68 killed (the 36 asset rows now point a black file at the white file of its kind in `pieceAssets.ts`), new `piece-files.config.cjs` 59: 58 killed + 1 EQUIVALENT (reading the header line of the progress file as a screen: it has no `done` key, pinned by `androidMatrixProgress.test.ts`); two survivors on the first run (an "all data URIs" test for an old record, a broken line in the middle of the progress file) were killed with tests.

**Gates (`paired/bughouse`, cloud VM, one after the other).** App `803288a` + this work, backend `fef5fdb` (untouched): `tsc` clean in both repos; vitest 145 files / 2523 tests (all goldens inside, no tracked file changed); `sync:fourplayer` / `sync:bughouse --check` in sync; backend `test:fourplayerSync` 117, `test:bughouseSync` 70, `test:bughouse` 9, `test:crazyhouse` 85, `test:bughouseRooms` all pass; CDP dual-board touch pass (W3b + the #26 offset) 72 / 72; the 11 new / changed test files (144 tests) 10 / 10 runs and once under 4 busy CPU loops; device matrix: quick profile 51 screens, 798 checks, 0 failed; FULL profile once, resumable (`--progress`, 51 screens, **30976 checks, 0 failed, 0 unreachable**, the gallery and the 4 theme screens of each kind included); CI `ci.yml` green on `6221885` (the intermediate WIP pushes were red until the web-blank fix above).

**The phone check (needs the laptop).** `cd C:\Users\emman\Projects\chess-app; git pull; npx expo start --clear`, open More > Diagnostics (the build identifier must read the hash of the commit you pulled), Piece gallery; one screenshot per theme (Classic, Cburnett, Merida, Checkers) with the header visible. Read the probes first: if the plain view, the SVG rect and the PNG are all dark on the dark square the system is not touching them; if one is light, that kind of drawing is what Android changes. Then "Lock app to light" and look again.

## 44. The screenshots said what the pieces really were: dark-bodied Merida, thin-edged Classic - and Bughouse W4, the online client (command #28, branch `paired/bughouse`)

**Part A: what the phone showed (Piece gallery on `4cf8c46`, Blackview Fort 200, Android 36) - and what that proved.** The three black probes (a plain view, an SVG rect, a flat PNG in #1d1d1d) stayed dark on the light AND the dark square: **Android recolours nothing; section 43's forced-dark candidate is FALSE** (the probes and the "Lock app to light / Follow system" buttons were removed). The two bugs were in the ART, which a mean-tone test could not see:
- **Merida**: the black king's body was a WHITE crown rim and bands (the original drawing: a dark silhouette plus broad white-to-grey bands; 40-45 % of the body of bk / bq / br was light, bb 25 %, bn 20 %); the black rook partly light. A mean tone of "at most 100" passed all of it. Fixed by `scripts/darken-merida-black.mjs` (every channel of every pixel of the six black Merida PNGs capped at 76 of 255 - outlines, shapes and alpha untouched, the bands stay as faint detail lines; idempotent, `--check`), then `scripts/generate-piece-assets.mjs`. Cburnett and Checkers were right and are untouched. (The white Merida assets already had the right body; the black ones were recoloured in place because bk / wk share the very same silhouette.)
- **Classic** (vector): black pieces had a thick LIGHT outline (#f1f1f1, 4 of 100 units): at game size on the blue Ocean squares the outline dominated and black read white; on the dark pocket chips a black piece looked hollow. Now: black fill #1d1d1d with a thin dark-grey outline #666666, white fill #fafafa with outline #1b1b1b, outline 3 of 100 units (0.8 dp on a 27 dp piece, at most 1 dp at 32 dp). Pocket / reserve chips and the promotion button share one mid-tone background (`PIECE_CHIP_BACKGROUND` #b58863: black fill 5.3 : 1, white outline 4.6 : 1).

**The gallery** (More > Diagnostics > Piece gallery) shows, per theme: large on the active board, then GAME SIZE (32 dp cells) on EVERY board theme (Classic, Wood, Green, Ocean, Marble and any custom one), then the pocket chips; the build identifier stays in the header.

**Tests that would have caught it.** `pieceBodies.test.ts`: (1) a per-asset BODY test for every black and white image asset (the shape eroded by 4 px so the outline is out: black median <= 60, >= 70 % of it below 77, <= 30 % above 153; white median >= 200; Merida black: no body pixel above 90 - the old Merida king had 55 % dark and fails it); (2) every black image piece scaled to 27 px (a 32 dp cell), composited on the light and the dark square of all five board themes and on the chip, its dominant colour AND median luminance dark (`bodyLuminance`, `BLACK_BODY_MAX` 90 - the same judgement the matrix applies to a photograph); (3) the vector inks: contrast 3 : 1 between the black fill and all eleven squares and the chip, the white outline likewise, outline <= 1 dp at 32 dp. The matrix (`android-matrix-pieces.mjs`) gained the body check for every black piece, a finer background threshold for a WHITE piece (a near-white fill on Ocean / Marble light squares is 20-30 from the square: found by the first Ocean run, which reported "no piece" for white pieces), and `THEME_SCREENS` is now every piece theme x every board theme (20 screens, `game-2p-theme-<piece>[-<board>]`). Two older expectations changed on purpose (the old ink literals; the pairwise tone distance of Merida's bishop and pawn is 4.8 now: bound 4).

**Part B: W4 as built.** BUGHOUSE_SPEC.md section 9 is the build LOG; the scope of W4 is the row of section 7 (reducer / session / UI-logic twins, queue screen, online game in both layouts, spectator screen, Spectate list section, `ActiveOnlineGame` third kind, resume link, Quick grid, toast and clock icon, team-chat panel). Built here, as the command listed it: the Online entry (login-gated) in the Play menu, the six time controls, the searching screen (count, bots countdown, Cancel), match found -> the game opens with "You: Board A - White - Team 1 - Partner: ..." above the boards, the live game on the SERVER's snapshots through the Local game screen (`BughouseGameScreen` + an `online` binding: the same boards, touch input, pockets, layouts and result card, not a fork), moves and drops sent with `emitWithin` (6 s), clocks from `serverNowMs`, pockets / stuck line / game over / results, resign (asked first), leave (asked first), reconnect by `bug_rejoin`. Files: `bughouseOnline.ts` (pure view), `bughouseOnlineSession.ts` (the socket class), `useBughouseOnlineGame.ts`, `bughouseOnlineUi.ts`, `BughouseMatchmakingScreen.tsx`, `BughouseOnlineGameScreen.tsx`. **Deferred (W4b / later):** the spectator screen and the Spectate list section, the persisted rejoin across an app restart (third `ActiveOnlineGame` kind) and the "Return to your game" link, the Quick grid + toast + clock icon, the team-chat panel, optimistic drops with rollback (the command asked for server-only state, so a move is never shown before the server says it), and the device-matrix screens for the queue and the online game (they need a login; the browser run below covers 412 x 915). **W5-W9 untouched:** premoves, friend rooms, real-socket W7 totals, the full browser suite, the close-out (full matrix, mutation, CPU-load runs).
- *Server-authoritative.* `bughouseOnline.ts`: a snapshot is applied only when its `seq` is exactly ours + 1 (older: dropped; a gap or unreadable text: ONE `bug_rejoin`); one action in flight (a second tap sends nothing; the half-made selection is cleared when an action is sent); a refusal becomes a sentence per reason (`REFUSAL_TEXT`, the 14 reasons as literals); the clock estimate is `serverNowMs + (local now - arrival)`, never the wall clocks compared, never behind the match's own instant.
- *Every wait has a limit.* join, move, drop, resign and rejoin all go through `emitWithin` (6000 ms, pinned): no answer = "Can't reach the server" + Retry (the queue: `LoadFailed`; a rejoin: the in-game Retry; a move: a sentence and the room is read again) + ONE `[BughouseOnline]` line in the Diagnostic Log.
- *Tests.* `bughouseOnline.test.ts` + `bughouseOnlineSession.test.ts` (61: snapshot sync incl. stale / gap / invalid / banked piece, clock math with literals, acks, refusals, rejoin outcomes, the 6 s on every request, silence, handler failures), `bughouseOnline.dom.test.tsx` (21) and `bughouseMatchmaking.dom.test.tsx` (14) (rendered on a fake socket with the real engine's snapshots; layouts, taps sent not played, clocks, reconnect, Retry, resign, leave, result card, the Play-menu entry). Integration against the REAL backend (backend `scripts/test-bughouse-client.mjs`, `npm run test:bughouseClient`, in CI): the app's own `BughouseOnlineSession` on two real sockets, two real bots, a spectator, the connection of one client cut half-way and rejoined by itself, a whole game to a result, both clients byte-identical to the spectator at the end - **20 checks + 3 conditional**. CDP browser (backend `scripts/e2e-browser/bughouse-online.mjs`, `npm run test:e2eBrowserBughouse`, own stack on :3191 / :8087): queue -> searching screen -> Cancel -> queue again -> match -> 12 human actions by TAPS (moves and drops) with BOTH boards of BOTH screens compared with the server after each -> resign -> the game-over card -> Play again - **29 checks**.

**Gates (`paired/bughouse`, cloud VM, one after the other).** `tsc` clean in both repos; vitest **161 files / 2861 tests**, the goldens inside and no fixture changed; `sync:fourplayer --check` 11 files, `sync:bughouse --check` 12 files; backend: fourplayerSync 117, bughouseSync 70, bughouse 9, crazyhouse 85, rooms 259, messages 81, matchmaking 82, handlers 64, testSwitches 41, bot 7, client 20 (+3); CDP W3b + #26 offsets **72 / 72**; MATRIX_RESULT

**The phone check.** Piece gallery: one screenshot per theme (the game-size rows on every board theme). Online: `cd backend; npm run dev` on the laptop with `FOUR_FILL_MS=8000`, the phone pointed at it (`EXPO_PUBLIC_API_URL=http://<laptop LAN ip>:3000`), log in, Play > Bughouse > Online > 1 min: two humans (or one human and a second client) are needed for the queue to count down - a lone player waits for ever by design - then the bots fill the table; moves, drops, clocks, resign, and Wi-Fi off / on for the reconnect.
