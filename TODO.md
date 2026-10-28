# EM-Chess — known issues / TODO

Tracked items that are real but deliberately NOT part of whatever change found them. Each entry says
what is wrong, how it was verified, and where to start fixing. Remove an entry when it is fixed.

## Giveaway bot picker still says "Stockfish 11"

**What's wrong.** `BotSelectScreen` prints `getEngineName(getEngineIdForElo(bot.elo))` on every bot card, so in
Giveaway each bot is labelled e.g. "Stockfish 11 (Classical)" even though Giveaway bots are the custom
`chooseGiveawayBotMove` heuristic (see `BotGameScreen`), not Stockfish. The label is now misleading, especially next
to Atomic's honest "Atomic search bot" label on the same screen. The "My Engines" (custom engine) cards also appear
for Giveaway and Atomic although those variants never use a UCI engine.

**Not fixed in the Atomic branch.** Separate fix on its own branch: show a Giveaway-specific label the way Atomic
does (one conditional in `BotSelectScreen`) and decide whether custom-engine cards should be hidden for variants
that can't use them.

## Rejoin after a reload / app kill: two known limits

The persisted rejoin record (activeGame.ts / activeGameStorage.ts, TESTING.md §25) works for 2-player and 4 Player games. Two cases are knowingly not handled:

**Two tabs / devices of the same account.** The record is per browser profile / device and the server seats whoever presents the token last. A second tab (or a second device with the same record) that restores the game rejoins the seat too and the two fight over it - the last rejoin wins, the other keeps showing a game it no longer owns until its next action fails. Not verified beyond reading the code. A fix needs a "this seat was taken over" event from the server (rooms.ts rejoin already knows the old socket id: emit it to that socket and have the screen leave with a message), plus a test in test-rejoin-persist.mjs with two live sockets on one token.

**Tournament games resume without the standings screen behind them.** The record stores `returnToTournamentId`, so leaving the resumed game goes back to the tournament standings, but the socket the tournament screens rely on (participant tracking is keyed by socket.id, see OnlineGameScreen's `keepSocketAlive`) is a brand-new one after a restart and has not re-registered as a tournament participant: the live standings push updates may not reach it until the player re-enters the tournament screen. Not verified in a browser (needs a tournament with two logged-in players); the e2e covers Classic / variants / 4 Player only.

## Spell Chess: what it still leaves out

Built on the `paired/spell-chess` branches (rules, Local, Bots and Online together; see TESTING.md §18 and the backend's §21 for what is tested and mutation-checked). The old status log that used to sit here ("no test-spell.mjs", "no mutation run", "tsx cannot run in the sandbox") is obsolete:
`test-spell.mjs`, a real-socket scenario in `test-multiplayer.mjs`, the mutation checks and the live opponent script all exist now. What is still open:

- **No premoves, no Hint** (by design: a queued move cannot carry a cast, and a possible cast changes which moves are legal after the opponent's reply). If premoves are ever wanted they need a cast-aware premove model first.
- **The bot's moves are Stockfish's, its casts a heuristic.** Stockfish has no concept of Freeze, so when its suggestion is a frozen piece the bot falls back to a random legal move (`getSpellChessLegalMoves`); the cast (`chooseSpellChessBotCast`) is an ELO-scaled chance plus a few rules of thumb, not a search. A strong bot therefore does not play Spell Chess strongly.
- **Not offered in Tournaments or Engine-vs-Engine**, and **not checked: the Analysis screen on a finished Spell game** (the analysis engine knows nothing about spells; the saved PGN carries a `[Variant "Spell Chess"]` tag and `F@e4` / `J@d5` comment tags).
- **No React Native renderer in the project**: the board, the spell bar and the layout were verified in the web build (360x640, 390x760, 412x915), not on a device.
- **Online is offered in Quick Match and Challenge** (the variant picker); `npm run spell-opponent` (backend) is a manual guest opponent for exercising it from the app.

## Daily (correspondence) games Online

**What's wrong / what's missing.** Online play is live-only. Daily time controls (1–14 days) exist for Local and Bot
games but cannot be played Online: quick match pairs two players who are connected to the queue at the same moment,
and a room only lives while both sockets stay connected. Making Daily real is its own feature, not a picker entry:

- **Persisted game state.** `RoomManager` rooms are in-memory (lost on a server restart or a Render sleep). A Daily
  game needs the position, move list, clocks and players stored in Postgres and reloaded.
- **Abandonment exemption.** `ABANDONMENT_GRACE_MS` (45 s) forfeits a player who disconnects, whatever the time
  control — Daily must be exempt (the move clock is the only deadline).
- **Move timers across restarts.** `scheduleTimeout` uses `setTimeout`, which is neither persisted nor safe for very
  long delays; Daily needs a persisted deadline checked by a job.
- **Async pairing.** A challenge/queue entry has to survive while its owner is offline.
- **Move notifications** (push) so the opponent knows it is their turn.
- **A "my games" list** to find, resume and spectate ongoing Daily games.

**Found while adding "No time limit".** That one *is* offered Online now, as live-only play with hidden clocks
(see `isUnlimitedTimeControl` in the backend's `rooms.ts` and `playerClockText` in `src/logic/time.ts`). The
Challenge screen does not offer it (nor Daily) yet — a small follow-up since the server already accepts it.

## 4 Player Giveaway: what it still leaves out

Built on the `fourPlayerGiveaway` branches (workstreams W1-W5; roll-up at the top of TESTING.md). Local, Bots and Online all exist; these are the deliberate v1 limits:

- **No king promotion.** Promotion is Q/R/B/N only (kings are ordinary pieces that can be captured, but a pawn cannot become one) - the spec's decision, not a sourced rule.
- **No history, ratings, saved games or analysis** for Giveaway games (same reason as 4 Player Chess: the saved-game payload and PGN are 2-player shaped).
- **The bot is a v1 heuristic.** Same ELO dial as 4 Player Chess, no deep tier. It does not plan to get stuck on purpose (being stuck WINS) and looks only at the move and the NEXT seat, so it rarely engineers a win by running out of moves.
- **"Return to your game" shares one resume slot** on the 4 Player card, so a player in a Chess game and a Giveaway game at once is only offered one of them.
- **The setup screen says the rule twice** (the hint line and the intro paragraph): a copy tidy-up.
- **The 1000-ply cap is unreachable by random or bot play.** It is pinned by hand-built positions in the engine and parity tests, but no real-socket game has ever ended by it.
- **Not seen in a browser:** the D15 refusal screen (a server that does not echo the requested variant), a bot taking over a seat on screen, and the 4 Player Chess online screens after the variant changes (covered by the golden gate and pure tests only).
- **Everything else under "4 Player Chess: what it still leaves out"** that is not about points or check (private rooms, a persisted rejoin token, chat history after a reconnect, small cells on phones) applies unchanged.

## Chaturaji: what it still leaves out

Built on the `paired/chaturaji` branches (workstreams W0-W5, finished; TESTING.md sections 28-33 in the frontend, 29-34 in the backend; CHATURAJI_SPEC.md). Local, Bots and Online screens exist; these are the open items:

- **Chaturaji bot weight calibration (arena-based).** The weights in `chaturajiBot.ts` (points x1.5, the reply term 0.85, the end-of-game +-25, the king threat 0.3, the promotion bonus 0.5, the king-capture bonus 2) are a first version, pinned by tests so that changing one is a deliberate, visible act (`the weights, pinned by outcome` in `fourPlayerChaturajiBot.test.ts`). The natural way to tune them is an arena: seat each candidate weight set against the roster at the same ELO for a few hundred seeded games and keep what wins, then re-run the mutation set. No deep tier exists (the bot decides in about 0.5 ms at the top ELO, so there is no cap either).
- **No history, ratings, saved games or analysis for ANY 4-seat game** (4 Player Chess, Giveaway, Chaturaji): the saved-game payload, `GameHistoryEntry`, PGN and the analysis screen are 2-player shaped. CHATURAJI_SPEC.md sections 12-13 say so for Chaturaji; the W3 brief asked for a history entry and a replay, which the spec does not allow, so W3 did not build one. A 4-seat history would be one workstream for all three games: a seat-list / points / result record (`localGameHistory` has the storage), a move list with stepping (the engine's `playMove` replays from the start snapshot and the move labels are already logged on screen), and a Spectate-style read-only board.
- **The browser suite is nightly only.** `backend/scripts/e2e-browser` (scenarios A-I and T: ten rounds with every screen compared to the server, takeover and hand-back, reload, spectator, endings with the points breakdown, three variants never mixing, layout, an automatic promotion to a boat, the D15 refusal, touch) takes about 7 minutes, so it runs in the nightly workflow, not per push; the nightly checks out the frontend's DEFAULT branch, so its first meaningful run is the night after the Chaturaji merge (merged 20/10; what it must show: backend TESTING.md section 34, 1D - check it and close this note). Not covered: the D15 refusal is driven by rewriting the server's frame in the browser (a real older server is not available), touch is emulated (a real phone is not).
- **~~Set `NODE_ENV=production` on Render after the Chaturaji merge~~ - CLOSED 20/10: nothing to set.** Confirmed after the merge (backend PR #20, Render deploy `4b1c1b9` Live, `GET /health` answers `{"ok":true}`): the Render deploy log prints `[startup] NODE_ENV=production`, because Render sets `NODE_ENV=production` for Node services by default at runtime (its documentation says runtime only, not build time). The service still holds only `DATABASE_URL` and `JWT_SECRET`; do NOT add `NODE_ENV` by hand (it would also apply to the build). The test-only switches' production guard (`AUTH_RATE_LIMIT_TEST_OVERRIDE`, `FOUR_TEST_SEED`, `FOUR_TEST_SETUP_ENDPOINT`) is therefore active in production, and the build no longer depends on devDependencies in any case (`npm run check:productionInstall`). Backend TESTING.md section 34 keeps the analysis.
- **The real touch path is the same as every other board** (and since W5 the browser suite plays scenario A on an emulated touch phone, taps instead of clicks). Screen tests deliver a tap to the board as the display cell a finger would have hit (the pixel-to-cell step is `useBoardGestures`, shared by all boards and checked in the browser); long-press arrows were checked by `fourPlayerAnnotations.test.ts` (now also for the 8 x 8 board) and not re-driven on screen.
- **Cell sizes are pinned for 360 x 640 (36) and 412 x 915 (49)** and checked in the browser at those sizes; a very short window (a landscape phone) falls to the 28 px minimum and may need to scroll.
- **The "How to play" sheet is Chaturaji-only.** The other 4-seat games explain themselves in their intro lines; a shared sheet would be a copy of this component with its own text.

## 4 Player Chess: what it still leaves out

The engine (`src/logic/fourPlayer/`) is built so the rest slots in without rework, but none of these exist yet:

- **Teams and Solo modes.** `FourPlayerRules` already carries the knobs that differ (`promotionCoord` — Teams promotes on the 11th
  rank — and the point values); what is missing is the notion of allies (`attackers()` treats every other seat as an enemy) and the
  team/solo scoring and end conditions in `elimination.ts`.
- **Online — done, except the browser pass below: built and tested on the `fourPlayerOnline` branch (workstreams W0-W7).** Live Free-for-All with a queue per time control, bots filling to four,
  server bots taking over for a dropped player (retake until the game ends), spectating, chat, premoves, a real-socket end-to-end test and a nightly fuzz section. See
  `FOUR_PLAYER_ONLINE_SPEC.md` and the "4 Player Chess Online" roll-up at the top of TESTING.md. What is still out, by design (v1): private rooms / invite links, saved games / history /
  ratings / analysis of online games, Teams and Solo online, a persisted rejoin token (an app restart or web refresh forfeits the seat to a bot), chat history after a reconnect, and the bot
  promotion-nudge parity follow-up (the one server-bot behaviour only covered by the random parity games). **Partly open, found by the W7 close-out:** the 4 Player Chess player screens were never looked at
  rendered. The 4 Player Giveaway browser pass (its W5) covered the screens both variants share - queue, game, leave and "Return to your game", spectate list, resign, result card - so what is still unseen for CHESS is the variant-specific wording there and a bot takeover in the browser; do it with two humans (a lone human never gets bots) and
  the backend started with `FOUR_FILL_MS=3000 FOUR_GRACE_MS=3000` (a scripted guest socket works as the second human).
- **Saved games / history / rating / analysis.** Games are not saved: the saved-game payload, PGN and `GameHistoryEntry` are 2-player
  shaped, and Stockfish cannot analyse a 4-seat position. Needs a 4-player record format (chess.com's FEN4/PGN4 is the obvious dialect)
  before any of that.
- **Game length.** `FFA_RULES.maxPlies` is 1000 (chosen from measurements: ~95% of bot games end naturally by 800 plies);
  `HARD_MAX_PLIES` (5000) is the absolute ceiling. Other draw-like endings are not detected (repetition, no-progress, K+minor positions that
  cannot mate).
- **Under-promotion scoring.** A captured promoted queen is worth 1 point (chess.com's FFA table) while an under-promoted knight/bishop/rook
  is worth its ordinary value: a modelling decision, not a sourced rule; one line in `CAPTURE_POINTS`.
- **Scoring details not modelled.** Check-fork bonuses (checking two or three royals at once), draw claims, and points for mating an
  already-dead king. The numbers that are modelled live in `FFA_RULES`.
- **Bot finesse.** Strength is a heuristic dial (`botStrength`), not a calibrated rating: it is clearly monotonic across the roster, but two
  neighbouring roster bots are not reliably distinguishable in a handful of games. The bot looks only at the NEXT active seat; it never
  models the two seats that move after that.
- **Clocks.** Local only. The tick is 200 ms (a flag fall is noticed within 0.2 s), there is no pause, and Undo restores the clocks rather
  than keeping the time already spent.
- **Input.** Tap-to-select only (no drag-and-drop of pieces). Squares are ~26 px on a 390 px-wide phone (21 px on 360x640), which is tappable but small; a zoom or
  larger cells on tablets would help (tablets already get up to 34 px).
- **One premove implementation (follow-up cleanup).** BotGameScreen and OnlineGameScreen still carry their own inline premove slot (each has a
  `TODO(follow-up cleanup)` comment at it); `logic/usePremove.ts` + `logic/premove.ts` are the shared form the 4 Player screen uses. Migrating the
  2-player screens is a pure refactor, deliberately left alone until Online can be properly exercised. Note the shared hook clears its "illegal"
  notice after the player has moved, where the inline copies keep it until the next premove/cancel: decide which behaviour wins when they merge.
- **Threefold repetition / no-progress draws** are not detected (the ply cap — 1000 — ends a runaway game by points instead).

## Crazyhouse: no analysis / Game Review, and per-ply state helpers could be shared

**What's missing.** A saved Crazyhouse game cannot be opened for analysis or Game Review: Stockfish cannot read a reserve or
play a drop, and `replayPgn` / `parsePgn` refuse `[Variant "Crazyhouse"]` (the `P@e5` drops are not moves, and the reserves and
promoted pieces are not in a PGN). Supporting it would need a Crazyhouse-capable engine (e.g. Fairy-Stockfish via UCI_Variant) plus a
PGN/FEN dialect that carries the pockets and the `~` promoted marks (the same dialect lichess/chess.com use).

**Small follow-up.** `src/logic/perPlyState.ts` (`latestPlyState` / `plyStateAtView`) is the shared way to read per-ply side-channel state.
Crazyhouse uses it; Duck Chess (`displayDuck`) and Spell Chess (`displaySpellState`) still carry equivalent inline copies in each game screen and
could migrate to it without any behaviour change.

## Bughouse: what W0, W1 and W2 built, and what is left (BUGHOUSE_SPEC.md sections 7 and 9)

Built (branch `paired/bughouse`, both repos): the mutation harness, the Crazyhouse golden, the four Crazyhouse additions, the generated mirror `sync:bughouse`, the pure engine in `src/logic/bughouse/`
(match, `settle`, `stuck`, results without a draw, snapshot, premove resolution), and (W2) the SERVER: `BughouseRoomManager`, the matchmaker, the `bug_*` handlers, the wire contract (`wire.ts`, mirrored), the bot
(`bot.ts`, mirrored), team chat and quick messages. **Nothing is reachable from a menu yet** (the server side is wired in `backend/src/index.ts`, but no client speaks `bug_*`). Left, in order: W3a / W3b the
screens and the multi-touch layer, W4 the online client, W5 premoves, W6 friend rooms, W7 real-socket scenarios beyond W2's, W8 browser end-to-end, W9 close-out (this is also where `/health/client-ip` may go).
Known limits of what exists:
- **`legalMovesOn` / `legalActions` cost about 3 ms a position** (chess.js lists each move with its notation and two FENs). The funnel never calls them (`applyAction` validates one move directly, about 0.2 ms);
  the bot uses chess.js's string list (~0.25 ms) instead, and a UI that highlights squares should ask for one piece's moves, not the whole list.
- **The Bughouse bot is NOT partner-aware (v1).** It drops what is in its pocket on its own merits (safe squares, checks, mates, material) and never plans around what its partner could capture, never uses premoves and never
  sends quick messages. Partner awareness (hold a piece for the partner's coming mate, ask for a piece) is the optional 3-4 day step of BUGHOUSE_SPEC.md section 7. The ELO dial is the chance of using the scored choice;
  the cost does not grow with it (p99 about 10-16 ms at every tier), so the server does not clamp the strength.
- **The 8-messages-per-10-s quick-message limit can never refuse anyone while the 1.5 s interval holds** (messages 1.5 s apart: at most 7 fit in 10 s). It is kept as a second line of defence and pinned white-box;
  if the interval is ever relaxed it becomes the binding rule.
- **One game at a time is not enforced ACROSS the managers**: a socket seated in a 4-seat game can still queue for Bughouse (and the same already holds between the 2-player and 4-seat servers). The W4 client must keep
  one active game; if it ever needs a server rule, the three handlers need one shared "seated anywhere" check.
- **Friend rooms (W6) plug in at two places only**: `BughouseMatchmaker.joinGroup` (a pair is one group that is never split) and `placeGroups` (the one function that assigns seats; today a uniform shuffle).
- **State is in memory**: a server restart ends every match (the result is not even recorded: nothing is persisted for Bughouse).
- **The whole-match model test compares full legal lists on a sample** (one commit in 25 of the board that moved, and every commit of every 50th match): every list is also exercised by playing the model's moves
  and by the per-board differential on thousands of positions. A future change that makes the engine list an EXTRA illegal move which no test plays would be caught by the differential, not by the model.
- **`Bughouse` text snapshots are canonical-only on read** (the FEN must be exactly what the engine writes): a snapshot written by a future engine that changes the FEN writer must bump `SNAPSHOT_VERSION`.

## Bughouse Local (W3a): what it still leaves out

Built on `paired/bughouse` (TESTING.md section 37, BUGHOUSE_SPEC.md section 9). Open:

- **Humans on both boards cannot play yet** (W3b: the raw-touch input layer, per-board selection reducers, the dual layouts, the rotate-below-minimum overlay). The setup refuses them with the spec's size sentence below 28 px cells and "coming next" above it.
- **No premoves** in Local, also with one human (W5).
- **Not checked in the browser:** pass-and-play (dom-tested only), dark theme, a human mate or promotion, a rotation mid-game. Not checked on a device (Expo Go): taps on the board and the 36 px landscape bar are web-verified only.
- **The partner thumbnail shows its pockets as text** ("Q1 R2 N2 P8") and its status as a sentence; a long pocket does not wrap on a 360 px phone beside the 96 px board (it fits in the tests and the browser pass, but a pocket of 20 pieces was not tried).
- **Bots on the unwatched board play fast** (200 ms bullet / 450 ms): in a 1-minute game the partner board can finish dozens of moves while a human thinks; there is no "slow bots" setting (the spec does not ask for one).
- **A rendered test of Chaturaji is not deterministic in its OUTPUT**: "a premove queued while the bots move is played when the turn comes back ..." (`chaturajiLocal.dom.test.tsx`) leaves a different page on two identical runs (hash of the markup and its text differ), although it always passes. Found by the window-size audit (command #24b); the likely cause is a bot move from an unseeded stream. Not investigated; the AGENTS rule is seeded randomness.
- **A game left on the game-over card keeps its two boards mounted** until Rematch or Back; nothing is saved (no history, rating or PGN for Bughouse, B18).


## Chaturaji bot: a raised `KING_LOSS` is not pinned by any test

Found on the cloud VM (command #25-cloud) when the constants mutation set was rebuilt in the repo (`scripts/mutation/configs/chaturaji-bot-constants.config.cjs`, 9 of 9 killed). `KING_LOSS` in `chaturajiBot.ts` LOWERED (14 -> 0, 14 -> 7) is killed by `fourPlayerChaturajiBot.test.ts`; RAISED (14 -> 28, 100, 1000) survives it. Not proven equivalent: a larger loss may change a choice between a big capture and a king at risk, and no hand-built position there pins an upper bound. Start with a position where a capture worth more than 14 points leaves a king attackable, and decide which move the bot must pick.
