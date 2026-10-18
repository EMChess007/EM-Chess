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

## Spell Chess: what it still leaves out

Built on the `paired/spell-chess` branches (rules, Local, Bots and Online together; see TESTING.md §18 and the backend's §21 for what is tested and mutation-checked). The old status log that used to sit here ("no test-spell.mjs", "no mutation run", "tsx cannot run in the sandbox") is obsolete:
`test-spell.mjs`, a real-socket scenario in `test-multiplayer.mjs`, the mutation checks and the live opponent script all exist now. What is still open:

- **No premoves, no Hint** (by design: a queued move cannot carry a cast, and a possible cast changes which moves are legal after the opponent's reply). If premoves are ever wanted they need a cast-aware premove model first.
- **The bot's moves are Stockfish's, its casts a heuristic.** Stockfish has no concept of Freeze, so when its suggestion is a frozen piece the bot falls back to a random legal move (`getSpellChessLegalMoves`); the cast (`chooseSpellChessBotCast`) is an ELO-scaled chance plus a few rules of thumb, not a search. A strong bot therefore does not play Spell Chess strongly.
- **Not offered in Tournaments or Engine-vs-Engine**, and **not checked: the Analysis screen on a finished Spell game** (the analysis engine knows nothing about spells; the saved PGN carries a `[Variant "Spell Chess"]` tag and `F@e4` / `J@d5` comment tags).
- **No React Native renderer in the project**: the board, the spell bar and the layout were verified in the web build (360x640, 390x760, 412x915), not on a device.
- **Online is offered in Quick Match and Challenge** (the variant picker); `npm run spell-opponent` (backend) is a manual guest opponent for exercising it from the app.

## 2-player Online: a page reload or app restart mid-game cannot rejoin

**What is missing.** Rejoining after a dropped connection works (the app re-sends `rejoin_game` with the player token and restores the position, clocks and, for Spell Chess, the charges, cooldowns and frozen zone - checked in the browser). But the token only lives in memory: reloading the web page, or restarting the app, opens the home screen and the seat is forfeited when the 45 s grace expires. 4 Player Online made the same decision (see its section below); a persisted token (sessionStorage / AsyncStorage, cleared when the game ends) would fix both.

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

