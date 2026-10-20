# Bughouse (Doubles) - specification and decision list

Status: **DRAFT v1 for review (2026-10-20). Spec only: no game code, no engine change.** Written per CHECKLIST.md ("spec before code") in the shape of `CHATURAJI_SPEC.md`. Covers both repos: frontend `EM-Chess` and backend `chess-app-backend` (`backend/`). Nothing here is built; every "exists today" statement was checked against the code on `master` / `main` after the Chaturaji merge.

**What Bughouse is (the user's brief):** two teams of two, two boards played at the same time, teammates play opposite colours, a piece a player captures goes to their partner's pocket (the partner may drop it instead of moving), each player has their own clock, and the whole match ends as soon as any board ends.

**Where the rules come from.** Never from memory and never invented: each rule below carries its source. Where sources differ the rule is a **decision** in section 6 (numbered **B1..B22**) with the sources named, so the user can settle it - ideally with chess.com screenshots.

- **S1** chess.com support, "What is Bughouse?" (support.chess.com/en/articles/8615092-what-is-bughouse) - the only chess.com text I could read; it does not cover castling, en passant, draws, clocks, chat or abandonment.
- **S2** Wikipedia, "Bughouse chess" (the first 100,000 of its 132,000 characters were read; online-site differences are summarised there).
- **S3** PyChess, Bughouse variant page (pychess.org/variants/bughouse).
- **S4** Over-the-board rulesets surfaced by search (British Championships 2026 "Bughouse Rules", the WCCC 2007 / 2004 rule pages): only their titles and the search summary were seen, so **no rule here is taken from them**; they are listed because they show how strict an over-the-board set can be (a promoted pawn left on the board, laid on its side - irrelevant online).
- **S5** ICC's help page (chessclub.com/help/bughouse) **redirected to a generic help centre and could not be read**: nothing is claimed from ICC beyond what S2 says about it.
- **R** this repository's own Crazyhouse documentation (TESTING.md section 20, `src/logic/crazyhouse.ts` header): what the existing engine already does, so each difference is visible.

---

## 1. RULES

Notation: **[S1]**, **[S2]**... = where the rule is stated; **[R]** = what the existing Crazyhouse engine does; **(B7)** = decision number in section 6.

### 1.1 Board and team layout

1. **Four players, two teams of two, two boards.** Board A and board B each host one game between a player of each team. **Teammates play opposite colours** and sit on different boards. [S1][S2][S3]
2. **Seat map used throughout this spec** (it is an implementation choice, not a source): seat 0 = Board A White, seat 1 = Board A Black, seat 2 = Board B White, seat 3 = Board B Black. **Team 1 = seats 0 + 3** (A-White with B-Black), **Team 2 = seats 1 + 2**. So `partner(0) = 3`, `partner(3) = 0`, `partner(1) = 2`, `partner(2) = 1`, and a player's opponent on their own board is the other seat of that board.
3. **Both boards start at the same moment, White to move on each.** There is no turn order between the boards: each board has its own side to move, and the two games run concurrently. (Over the board the Black players start the clocks together [S2]; online the server starts both.)

### 1.2 Captures and pockets

4. **A capture goes to the capturer's partner's pocket** ("bank", "reserve"), immediately; the partner may use it as a drop on a later turn. [S1][S2][S3] A captured piece is NOT recoloured on the way: the pocket holds a piece of the colour of the player who will drop it (the partner's colour), exactly as Crazyhouse shows reserves. [R]
5. **A captured promoted piece goes to the pocket as a PAWN** ("counterfeit"), not as the piece it had become. [S1][S2][S3][R]  *(Decision B2 confirms it; the Crazyhouse engine already tracks promoted squares.)*
6. **A king is never banked** (a captured king cannot occur: the game ended at the check). [R]
7. **A player's pocket is visible to everybody** (information is public); the opponent's pocket on my board is what THEIR partner has captured.
8. **Pocket piece types:** pawn, knight, bishop, rook, queen, with counts. [R]

### 1.3 Drops

9. **A turn is ONE action: an ordinary move OR a drop** of a piece from the player's own pocket onto **any empty square** (never onto an occupied one: no "drop capture"). [S1][S2][S3][R] (S2 notes one rule set that also forbids drop-captures explicitly.)
10. **Pawns may not be dropped on the 1st or 8th rank.** [S1][S2][S3][R]
11. **A pawn dropped on the 2nd rank (the 7th for Black) may make the two-square first move**, and can then be captured en passant. [S1][S2][S3] *(Decision B1 records the choice; the existing engine already behaves this way because chess.js reads the FEN: a pawn on its home rank double-steps.)*
12. **A drop may give check and may deliver checkmate** ("drop check", "drop mate"). [S1: "a check that could be blocked by a dropped piece does not count as checkmate"; S2: pieces may be placed to give check or mate, but the Dutch rules quoted there forbid a drop check]. *(B3.)*
13. **A drop may block a check**, and while in check the only legal drops are onto the squares between a single sliding checker and the king; against a knight / pawn check or a double check no drop is legal. [R]
14. **A drop resets nothing about castling:** castling rights are flags that are lost once the king or rook moves or a rook is captured; a rook dropped back on its home square does NOT restore them in the existing engine [R]. S2 quotes a ruleset where such a rook may castle. *(B6.)*

### 1.4 Promotion, castling, en passant

15. **Promotion** is the standard chess rule (Q / R / B / N, by push or capture); a promoted piece is marked until it is captured (rule 5). [R]
16. **Castling** and **en passant** are the standard chess rules on each board. A dropped pawn never creates an en passant square by being dropped; a drop clears a stale one. [R]  S1 does not cover castling or en passant (stated above); S2 / S3 cover en passant after a 2nd-rank drop (rule 11).

### 1.5 End of the match

17. **The WHOLE match ends as soon as ANY board ends**, by checkmate, resignation or a flag. [S1][S2][S3] The team of the player who was mated / resigned / flagged loses; the other team wins.
18. **Checkmate means a real mate.** S1 states: *a check that could be blocked by a dropped piece does not count as checkmate, even if the player has no piece in the bank.* So a player who is in check, has no legal ordinary move, and could be saved by SOME drop (a single sliding checker with an empty square between it and the king) is **not mated**: they must wait for a piece (their clock keeps running). This differs from the existing Crazyhouse engine, whose "mate" requires no legal drop **given the current reserve** [R]. *(Decision B4.)*
19. **Stalemate and "no legal action"** (not in check, no legal move, no piece to drop): **not covered by S1, S2 or S3.** The options are a decision (B5).
20. **Insufficient material never ends a game** (a pocket can always refill a board). [R] Meaningless with drops.
21. **Illegal moves:** over the board an illegal move loses [S2]; online the UI and the server refuse them, so it cannot arise (the server answers an illegal request with an error and no state change).
22. **Draws:** S2 gives draw by agreement and "players on opposite teams flag or are mated at the same time"; S1 does not mention draws at all. Draw by agreement and the simultaneity rule are decisions (B8, B9). **Threefold repetition** is applied per board, and sites differ on whether pockets count (ICC counts them; FICS and chess.com do not [S2]) - the existing Crazyhouse engine never detects repetition [R]. *(B10.)*
23. **Fifty-move rule:** the Crazyhouse engine keeps it and a drop resets the clock [R]; with two boards and constant transfers it has no meaning. *(B10.)*

### 1.6 Clocks

24. **Four independent clocks, one per player.** On each board only the clock of the side to move runs; the two boards' running clocks tick at the same time. A flag on either board ends the match (rule 17). [S1][S2]
25. **Time controls and increment:** S1 and S2 name no controls. Which ones are offered and whether there is an increment is a decision (B11). The app's 4-seat games offer the normal list without Daily and without "No time limit" [R: `src/logic/timeControls.ts`, the 4-seat setup].
26. **Where the sources differ and the user decides:** B1 (2nd-rank double step), B3 (drop check), B4 (mate that a drop could block), B5 (stalemate), B6 (rook dropped on a home square and castling), B7 (match ends at once or the other board plays on), B8 (simultaneous flags / mates), B9 (draw by agreement), B10 (repetition and the fifty-move rule).

---

## 2. REUSE INVENTORY

"Reuse" = used as it is; "extend" = existing file/function gets a backwards-compatible addition (existing goldens and tests must stay byte-identical); "new" = does not exist.

### 2.1 Chess rules and Crazyhouse (the single-board engine)

| What | Where | Verdict |
|---|---|---|
| Crazyhouse rules block: reserves, promoted-square tracking, drop squares, check geometry, `crazyhouseDropSan` (`N@f3`) | `src/logic/crazyhouse.ts`, mirrored VERBATIM to `backend/src/game/crazyhouse.ts` (guard: `backend/scripts/test-crazyhouse.mjs`) | **Reuse + extend.** The per-board promoted tracking and drop legality are exactly what each Bughouse board needs. What differs is WHERE a capture is banked (the partner's pocket on the other board) and what counts as mate (rule 18). Both are new exports, not edits of existing functions. |
| `ChessEngine` with the `crazyhouse` option (`drop()`, `getLegalDrops()`, the per-ply `crazyhouse` state on each `Move`) | `src/logic/ChessEngine.ts` (944 lines; many variants) | **Reuse for single-board behaviour; do not put the match logic in it.** It is a client class with every other variant's code in it. |
| The server's twin engine (`RoomChessEngine` with the same `crazyhouse` option) | `backend/src/game/RoomChessEngine.ts` (830 lines) | **Reuse as the server's board engine for the first cut? see section 3** (it is a hand-maintained twin of `ChessEngine`; the bot code is not on the server). |
| Per-ply state helpers (`latestPlyState`, `plyStateAtView`) | `src/logic/perPlyState.ts` | Reuse (history / review of a board). |
| Differential oracle for the single-board rules (chessops' `Crazyhouse`, dev-only) | `src/logic/__tests__/crazyhouseOracle.test.ts` | **Reuse per board.** There is **no oracle for Bughouse** (chessops has none); the transfers need a small reference model written for the tests (section 4, HP1). |
| Crazyhouse tests, mutation notes | `crazyhouse.test.ts`, `crazyhouseEngine.test.ts`, `crazyhouseGame.test.ts`, `crazyhouseOnline.test.ts`, `crazyhouseBot.test.ts`; TESTING.md section 20 (43 + 21 mutants, the equivalent-mutant proofs) | Reuse as the regression floor; a **Crazyhouse golden** (byte transcript) does NOT exist yet and is recorded in W0 (section 7). |
| Crazyhouse bot (`chooseCrazyhouseBotMove`: a whole turn, a move or a drop; ELO = chance of the best choice; ~120 ms average, ~400 ms max in self-play per TESTING.md) | `src/logic/bots.ts` (about lines 667-830) | **Extend / new.** It plays one board with its own reserve; it knows nothing of a partner, a second board, or the server (it needs `ChessEngine`, which the server does not have). See HP4. |

### 2.2 The 4-seat online stack (rooms, queue, takeover, rejoin, spectate, chat)

| What | Where | Verdict |
|---|---|---|
| **The commit funnel**: ONE mutator of room state, clocks and a global `seq`; every action publishes exactly one full-state `four_state` to every seat and spectator | `backend/src/game/fourPlayerRooms.ts` (`commit`, 862 lines) | **Reuse the design, new class.** The same funnel gives Bughouse its total order of events (HP1). The class itself is bound to `FourPlayerState`, one clock timer per room and one bot timer per room, so it is not reused as is (section 3). |
| Seat runtime: socket, rejoin token, grace timer, `originalHuman`, controller `human` / `bot`, takeover (45 s grace, a bot plays the seat, the human retakes), all-gone abandonment, fast-forward when no human is left playing, move rate limit | `fourPlayerRooms.ts`; constants in `backend/src/game/fourPlayerConfig.ts` (`FOUR_TAKEOVER_GRACE_MS`, `FOUR_FILL_WAIT_MS`, `FOUR_BOT_THINK_MS`...) | **Reuse the model and the config; extend** the config with Bughouse names. |
| Matchmaker: lobby per `timeControl|variant`, 2 humans minimum, a 30 s fill wait, bots fill, random seat shuffle, a lone human waits forever | `backend/src/game/fourPlayerMatchmaking.ts` | **Extend** (the variant is typed `FourVariant`; a second instance or a widened type). Note the random shuffle decides the teams (B17). |
| Socket handlers (`four_*` events), wire types, validators, `four_state` / `four_seat_update` / `four_game_over`, spectate, active-games list, chat | `backend/src/game/fourPlayerHandlers.ts`, `fourPlayerWire.ts` | **Extend / new `bug_*` twins**; the patterns (ack shape, validation, rate limits) are reused. |
| Generated mirror (client source -> backend copy, with a CI check) | `backend/scripts/sync-fourplayer.mjs`, manifest `src/logic/fourPlayer/MIRRORED_TO_BACKEND.json`, `test:fourplayerSync` | **Reuse the mechanism** for a new `src/logic/bughouse/` module family (its own manifest), so client, server and bots share ONE engine. |
| Client reducer / session / UI logic for a 4-seat room | `src/logic/fourPlayerOnline.ts`, `fourPlayerOnlineSession.ts`, `fourPlayerOnlineUi.ts` | **Extend / new twins** (`bughouseOnline*`), same shape. |
| Persisted rejoin ("Return to your game", restart restore) | `src/logic/activeGame.ts` (`ActiveOnlineGame` is a union of `twoPlayer` and `fourPlayer`), `src/logic/onlineRejoin.ts` | **Extend** the union with a third kind. |
| Screens: queue, online game, spectator, Spectate list rows | `src/screens/FourPlayerMatchmakingScreen.tsx`, `FourPlayerOnlineGameScreen.tsx`, `FourPlayerSpectatorScreen.tsx`, `SpectateListScreen.tsx` | **Extend / new**; the board in them is `FourPlayerBoard`, which Bughouse does not use. |
| Chat panel | `src/components/FourPlayerChatPanel.tsx` | **Reuse** (B14). |
| Premove hook | `src/logic/usePremove.ts` / `premove.ts` (4-seat and bot screens; the 2-player online screen has its own inline copy and disables premoves in Crazyhouse) | **Extend or defer** (B22). |
| Local setup, Play-menu cards, resume link | `src/screens/FourPlayerSetupScreen.tsx`, `PlayModeSelectScreen.tsx` | **Extend** (a Bughouse card). |

### 2.3 Boards, pockets, clocks

| What | Where | Verdict |
|---|---|---|
| The 8x8 chess board with drop selection | `src/components/ChessBoard.tsx` (+ `useBoardGestures.ts`, `boardSize.ts`, `BoardAnnotations.tsx`) | **Reuse for BOTH boards**; extend for a second instance, a small "thumbnail" size and board-qualified labels. |
| Pocket widget: both reserves of one board in one fixed-height row, tap a chip then a square | `src/components/ReserveTray.tsx` | **Extend** (Bughouse shows four pockets, two per board, and only the player's own is interactive). |
| 2-player clock hook | `src/logic/useChessClock.ts` | **Extend / new**: four clocks, two running at once. |
| 4-seat clock model (one running clock, charged at each commit) | `src/logic/fourPlayer/clock.ts`, `useFourPlayerClock.ts` | **Not reusable** (single mover model); a per-board clock model is new (HP2). |
| 2-player server clocks (two clocks, ONE timer per room, 45 s abandonment grace) | `backend/src/game/rooms.ts` | Reuse the ideas (server time is the only source), not the class. |
| Time control list | `src/logic/timeControls.ts` | Reuse (B11). |

### 2.4 Test tooling

| What | Where | Verdict |
|---|---|---|
| Golden transcripts kit (hashed seeded games) | `src/logic/__tests__/fourPlayerGoldenKit.ts` and the FFA / Giveaway / Chaturaji goldens | **Reuse the kit** for a Bughouse golden; the existing three goldens are the "unchanged" gate. |
| Real-socket e2e + nightly fuzz with one section per variant (the fuzz uses the MOBILE app's own engine as the client) | `backend/scripts/test-fourplayer-online.mjs` (fixed total 427), `nightly-fuzz-online.mjs` (a Crazyhouse and three 4-seat sections) | **Extend** (new scenarios and a new fuzz section). |
| Copy-based mutation harness (chunks <= 20 min, hard timeouts, results outside the repo) | **NOT in the repo**: it lives in a scratch folder (`mutate-generic.cjs` + config files) | **New work item (W0):** commit the harness under `scripts/mutation/` with a README, or Bughouse's mutation gate cannot be rerun by anyone else. |
| Browser end-to-end (the real app against a private backend, one browser context per user) and its test-only switches | `backend/scripts/e2e-browser/` (`stack.mjs`, `truth.mjs`, `app.mjs`, `match.mjs`, `run.mjs`), `npm run test:e2eBrowser`, nightly; switches `FOUR_TEST_SEED`, `FOUR_TEST_SETUP_ENDPOINT` (`backend/src/game/fourTestSwitches.ts`), `AUTH_RATE_LIMIT_TEST_OVERRIDE`; `EXPO_PUBLIC_API_URL` on the app side | **Extend** (new scenarios; the setup endpoint arms a 4-seat snapshot, so Bughouse needs its own snapshot kind). |

---

## 3. ARCHITECTURE OPTIONS

### 3.1 The three options

**(A) Composition: a `BughouseMatch` made of two Crazyhouse boards, a new pure module family, a NEW room manager built on the 4-seat patterns.**
`src/logic/bughouse/` (generated mirror to the backend, like `fourPlayer/`): `BughouseMatch` = two board states (FEN + per-board promoted marks, using the Crazyhouse rules block), four pockets, four clocks, seat map, and a match result; a reducer `applyAction(match, seat, action)` with action = move | drop | resign | flag; a text snapshot; statuses including the new `stuck` state (rule 18). The server gets `BughouseRoomManager` (its own funnel, two clock timers, bot timers per board) reusing the seat runtime / takeover / rejoin / spectate / chat code by copying the **pattern**, the config, the wire conventions and a second matchmaker instance.
- *Files touched:* new `src/logic/bughouse/*` (+ manifest), new `backend/src/game/bughouse*.ts`, additive exports in `crazyhouse.ts` (+ its mirror), new screens / hooks, additive changes in `activeGame.ts`, `PlayModeSelectScreen.tsx`, `SpectateListScreen.tsx`, `fourPlayerConfig.ts` (names), `index.ts` (one more `register...Handlers`).
- *Risk:* medium. The engine is new but built from a verified single-board core; the room manager is new code with a proven shape. **Nothing existing is modified except additions**, so the goldens are untouched by construction.
- *Effort:* about 30 working days overall (section 7).
- *Impact on existing goldens:* none expected; the gate is that FFA, Giveaway, Chaturaji and geometry goldens plus a Crazyhouse golden (recorded first) stay byte-identical.

**(A2) The same engine, but generalise the existing `FourRoomManager` with an engine adapter** (applyAction / legal actions / serialise / clock model) so Bughouse and the three 4-seat games share one room class.
- *Files touched:* all of (A) minus the new manager, plus a deep refactor of `fourPlayerRooms.ts` (862 lines: the commit funnel, `charge`, `armClockTimer`, bot scheduling, takeover and rejoin all assume one `FourPlayerState`, one mover and one clock timer).
- *Risk:* **high.** Every line of the manager is pinned by four suites (rooms 237, bots 160, handlers 61, real-socket 427) and three variants in production; the refactor puts all of them at risk for a game that needs two timers and two movers anyway.
- *Effort:* about 6-8 days MORE than (A) for the refactor and re-proving three variants; saves roughly 2-3 days of duplicated manager code.
- *Impact on goldens:* the 4-seat engine goldens are untouched, but the server behaviour of three live variants is re-tested by the e2e suites only.

**(B) A dedicated Bughouse engine with its own move generator** (no chess.js, like the 4-seat engine reimplements move generation).
- *Files touched:* a full chess move generator, check detection, castling, en passant, promotion and drops, plus everything in (A).
- *Risk:* **high** for rules correctness: chess.js (millions of games) and the differential oracle for Crazyhouse are discarded; every chess rule is retested from scratch.
- *Effort:* +8-10 days for the generator and its oracle work; no oracle exists for Bughouse itself.
- *Impact on goldens:* none on existing variants; the new engine has no external reference.

### 3.2 Recommendation: **(A)**, with two additions

1. **A lean module, not `ChessEngine`.** The server needs bots, and the bots are written against the client's `ChessEngine`, which the backend does not have (the backend has a separate hand-maintained twin, `RoomChessEngine`). Putting a chess.js-based board wrapper plus the Crazyhouse rules block into `src/logic/bughouse/` and **generating** the server copy (the existing mirror mechanism) gives ONE engine for client, server and bots, a CI check that the copies cannot drift, and no change to `ChessEngine` or `RoomChessEngine`. Single-board behaviour is checked against the existing `ChessEngine` crazyhouse option and the chessops oracle (differential tests); the transfers against a small independent reference model.
2. **Copy the pattern of `FourRoomManager`, do not refactor it** (rejecting A2): it is the most heavily proven server code in the repo, and Bughouse needs two timers and two movers, which is a different shape. The duplicated parts (seat runtime, grace / takeover, rejoin, chat, spectate list) are small and mechanical; a later clean-up can merge them once Bughouse has its own suites.

**Why not (B):** it throws away the strongest assets (chess.js and the Crazyhouse oracle) for no benefit.

### 3.3 Interactions (CHECKLIST section 1, second box) - stated, not assumed

- **Crazyhouse (2-player):** unchanged behaviour. Bughouse adds exports to `crazyhouse.ts`; the Crazyhouse golden recorded in W0, `crazyhouse.test.ts`, the oracle and `test-crazyhouse.mjs` must stay green and byte-identical.
- **4 Player Chess, 4 Player Giveaway, Chaturaji:** unchanged. A Bughouse room is its own thing with its own lobby key (`timeControl|bughouse`), so the four 4-seat games can never share a lobby or a room. The `FourVariant` type is **not** widened (a second matchmaker instance), so no 4-seat code path learns about Bughouse.
- **2-player modes, tournaments, challenges, ratings, achievements, history, PGN, analysis, puzzles:** unaffected, as for the 4-seat games (no history, rating, PGN or analysis in v1; B18).
- **Mutual exclusivity:** Bughouse is its own preset: Chess960, Fog of War, Atomic, Duck, Spell, Horde, Setup Chess and the rest are NOT combinable with it (out of scope, section 4 HP7); on the server an unknown variant is refused at the queue like today.
- **Bots:** the 2-player Stockfish bots and the Crazyhouse bot are untouched; the Bughouse bot is new code that calls the shared rules (HP4).
- **Persisted rejoin:** a third `ActiveOnlineGame` kind carries the whole match snapshot; a dedicated real-socket case and a browser case (reload mid-game).

---

## 4. HARD PARTS

Each has: the problem, the proposed solution, the test strategy.

### HP1. Server ordering of pocket transfers between boards

**Problem.** A capture on board A must put a piece in the partner's pocket on board B; the partner may be dropping at the same instant. Who sees what, and when is the piece droppable?

**Solution.**
- **One authority, one total order.** The room has ONE funnel (`commit`, the pattern of `FourRoomManager.commit`) and ONE global `seq` for the whole match. Node handles one event at a time, so any two concurrent requests are ordered by arrival; there is no "same instant" inside the funnel.
- **A commit is atomic across boards.** Applying a capture on A, crediting the partner's pocket on B, charging the clocks and publishing ONE full-snapshot message (`bug_state` with both boards, all four pockets, four clocks, `seq`) are one step: a client can never observe a capture without the pocket credit, nor the reverse.
- **When the piece becomes droppable:** from the very commit that contains the capture (seq n); the partner's action is validated **at processing time** against the pockets of the snapshot it is applied to. A drop request is judged on arrival, not on send: if the piece is not in the pocket then, the server answers an error, changes nothing, and the client rolls back its optimistic drop and re-renders from the authoritative state.
- **Pockets are never trusted from a client**; the optimistic UI may show the dropped piece on the board, never a changed pocket count of someone else.
- **Conservation invariant** (the strongest test): over the whole match the total number of pieces on the two boards plus the four pockets is constant (64 at the start; a promoted piece captured becomes a pawn, so counts, not types, are conserved), and no pocket count is ever negative.

**Tests.** (1) A pure reference model of the transfer rules in the test (independent of the implementation), compared with the engine over seeded random games (the differential oracle for the part chessops cannot give). (2) Property test: random interleavings of the four players' legal actions with random arrival order; assert the conservation invariant, no negative pocket, each capture credited exactly once, and that replaying the published `seq` stream rebuilds the identical final state. (3) In-process room tests on stub sockets with fake timers: a capture and a drop of the same piece type arriving back to back in both orders; a drop request that arrives after the piece was taken by the partner's own drop. (4) Real-socket e2e with four clients and a spectator: `seq` strictly increasing, every client's snapshot byte-identical per `seq`. (5) Mutation on the credit target (the wrong board, the wrong colour, the promoted piece banked as itself, credited twice, credited to the capturer).

### HP2. Clocks: four clocks on two boards, fairness, a flag ends the match

**Problem.** Two clocks run at once; a flag on either board ends the match; timers must not drift apart; two boards' flags can come due together.

**Solution.**
- **Per-board clock model.** Each board has its own side to move and one running clock; a commit on board X charges only X's mover (`elapsed = now - turnStartedAt[X]`, as the 4-seat `charge`) and gives X's increment to X's mover; the other board's running clock is untouched. The server clock (`Date.now()`) is the only time source; no lag compensation (the same rule as the 2-player and 4-seat games). Clients display from the last snapshot plus local elapsed time and are corrected by every snapshot.
- **Two timers per room**, one per board, each armed for that board's mover and re-armed after every commit on that board; a fired timer re-checks with the "spend the whole remaining time" rule of the 4-seat `charge(force)` so an early wake still flags.
- **The first flag processed ends the match** (rule 17). When both flags are already due the order of processing decides unless B8 says draw.
- A player who cannot act (rule 18/19) simply loses time; there is no "pass".

**Tests.** Fake-timer room tests: the two boards advance independently; a commit on A never changes B's clock; each timer re-armed; flag on A while B is mid-move; both flags due together (B8); increment per mover; a snapshot's four clocks always equal the charged values; best-of-N load-robust assertions only (no single wall-clock sample; AGENTS rule). Mutation on charge, on which clock is charged, on the timer's re-arm.

### HP3. Premoves and drop premoves when the pocket changes under you

**Problem.** A premove is a promise made against a position that will change; for a drop the pocket itself can change (the partner captures, or the piece is used).

**Solution (v1, decision B21).** **No premoves in v1** - Crazyhouse has none today (the 2-player online screen disables them for variants). The design for a later step: a premove is a client intent `(from,to[,promotion])` or `(piece,square)`; it is resolved only when it becomes the player's turn, **against the authoritative snapshot including pockets**, and cancelled with a reason if illegal (the existing `usePremove` already models "cancelled with a reason"); a drop premove is cancelled when the pocket lacks the piece at resolve time. It must never be applied against a stale pocket.

**Tests (when built).** Reducer tests with a pocket changing between premove and turn (still there, gone, gained a different piece), cancellation reasons, one premove at a time.

### HP4. Bots: what plays a Bughouse seat

**Today.** The Crazyhouse bot (`chooseCrazyhouseBotMove`, `src/logic/bots.ts`) plays one board with its own reserve, including drops and mating drops, ELO = chance of the best choice, ~120 ms average and ~400 ms maximum in self-play. It is client-only (it needs `ChessEngine`). It has **no partner awareness**: it cannot know that its captures feed a partner, or that giving the opposing team material is bad beyond its own material count.

**Problems.** (a) **Latency on the server:** the 4-seat bots decide in 0.04-0.5 ms p99 and the repo asserts bot decisions under a 25 ms p99 budget; a synchronous 400 ms decision would stall the server's event loop and every other room's clocks. (b) The bot must live where the engine lives (HP above: the generated module). (c) A bot also needs to behave when its partner is human (it should drop the pieces the partner captured for it).

**Solution.** v1: a Bughouse bot = the Crazyhouse heuristic ported onto the shared lean engine, **with a hard decision budget** (the same 25 ms p99 gate, best-of-N, per ELO tier; candidates capped like the existing "best six" pass), plus the usual think delay (about 450 ms, 200 ms in bullet, as the 4-seat bots) so the budget is invisible to players. Partner awareness is **v2** (B-optional list in section 7): values captures by what the partner's pocket needs, avoids cheap trades that feed the opposing partner, never "sits"). If the budget cannot be met, the fallback is a worker thread for decisions, not a slower tick.

**Tests.** Legal action on every position over seeded games; mate-in-one by move and by drop; back-rank safety against a mating drop (the Crazyhouse bot's tests, per board); p99 latency per tier on seeded games (best-of-N); a bot golden (decisions hashed from the seeded games, like the 4-seat bots'); a clamp test (a server never trusts the bot's returned action); a partner-human test (the bot drops a piece the human partner captured when a mating or winning drop exists).

### HP5. Takeover, hand-back and rejoin with two boards

**Solution.** The 4-seat model carried over: a disconnected human's seat keeps its clock running; after the grace (45 s, `FOUR_GRACE_MS` in tests) a bot plays the seat (`botReason: takeover`); the human retakes it with the stored token at any time until the match ends; when no original human is connected the all-gone timer ends the match with no result; the persisted active-game record (a third kind) restores the screen after a reload or app kill. The rejoin answer is the full snapshot (both boards, four pockets, four clocks, `seq`, seat). A taken-over seat may be **partnered with a human**: that is the normal case with two humans on a team.

**Tests.** In-process: disconnect on each of the four seats, takeover, retake, the all-gone ending, the rejoin of a finished match (the result is kept for 5 minutes as in the 4-seat games). Real sockets: the same with four clients and a spectator; the persisted-rejoin case with a brand-new process holding only the saved record; browser: close the tab / reload mid-game with two boards (scenario-style as the Chaturaji suite).

### HP6. Spectating both boards, and what a player sees of the partner's board

**Solution.** A spectator sees **both boards** (equal size, the deciding board highlighted at the end) with all four clocks and four pockets, read-only, from the same snapshot stream (a `bug_spectate_game` twin of the 4-seat call). A player always sees their own board large and the partner's board small (B13), because coordination (what to capture, when to sit) depends on it; the information is public anyway, so there is no hidden-information problem.

**Tests.** The spectator's screens equal the server snapshot at every `seq` (the Chaturaji browser suite's `converge` pattern, per board); a spectator cannot move; the Spectate list shows a "Bughouse" section with the four names grouped by team.

### HP7. Out of scope (stated, not assumed)

Fog of War, Chess960 / Setup Chess, Atomic, Duck, Spell, Horde, Giveaway-style captures and every other variant are **not combinable** with Bughouse; there is no Bughouse analysis, Game Review, PGN export/import, hint or rating in v1.

### HP8 (found while writing this spec). The "stuck" player and the single ending that is not obvious

A player in check with no legal move who could be saved by a drop (rule 18), and a player with no legal action who is not in check (rule 19), are neither mated nor stalemated by the existing Crazyhouse engine's definition. They need a status of their own (`stuck`), a UI line ("waiting for a piece"), and a rule for the match (B4, B5). **Tests:** hand-built positions for each: a single slider check with and without an empty square to interpose, a knight check (real mate: no drop can help), a double check (real mate), a stalemate with an empty pocket; the status changes at the moment the partner's capture fills the pocket; the clock keeps running in `stuck`.

### HP9 (found while writing this spec). Orientation and colour are easy to get wrong with two boards

Teammates play opposite colours, so the partner's board is naturally seen from the other side, a pocket chip is drawn in the colour of the player who will drop it (not of the captured piece), and every cell label, test id and wire field must say which board it belongs to. This is the same class of bug as the cross-board square names of Chaturaji W3: a helper that defaults to "the board" works until there are two. **Rule (AGENTS.md): no helper that names a square, a cell or a clock may default to a board;** the board identity is a required argument everywhere (`A` / `B`), pinned by a whole-game property test like `chaturajiOnlineSquares.test.ts`.

---

## 5. UI - screens and layout

### 5.1 Phone portrait (the primary target; checked at 360 x 640 and 412 x 915 like Chaturaji)

Budget at 360 x 640: the Chaturaji screen needs about 345 px of chrome around an 8 x 8 board and gets 36 px cells (288 px). Two full boards cannot fit; a second board at a readable size cannot either. **Proposed layout:**

- **Own board large** (the width minus gutters: about 36 px cells at 360 x 640, 49 px at 412 x 915 - a cell-size function pinned for both sizes, like `getChaturajiCellSize`), oriented with the player's colour at the bottom.
- **Partner board as a thumbnail** (8 x 12 px cells, about 96 px) in a strip above or beside the clocks, with the partner's two clocks and the pocket chips of their board; **tap swaps** the thumbnail and the main board (B13). A thumbnail is read-only and never a drop target.
- **Four clocks**: the player's and the opponent's own board clocks next to the main board (as in 2-player chess), the partner's and the partner's opponent's clocks in the thumbnail strip.
- **Pockets:** the existing `ReserveTray` idea (one fixed-height row under the board: mine on one side, the opponent's on the other; chips with counts; promoted pieces shown with the `~`), plus a compact chip row in the thumbnail strip. Only MY chips are tappable, only on my turn, and a chip greys out when the piece has no legal square (the Crazyhouse `canDrop`).
- **Drop interaction is Crazyhouse's:** tap a chip (it lifts), the legal squares highlight, tap one - one tap pair, no second step. Ordinary moves unchanged. A "waiting for a piece" line shows in the `stuck` state (HP8).
- **Controls row** (Resign, Chat, Rules, Rotate as in the 4-seat games). Resign ends the match for the team (rule 17).
- **Game over:** both boards shown (the deciding board outlined with the reason: "Board A - checkmate", "flag", "resigned"), the winning team named, the four clocks and a per-player line; "Play again" re-queues at the same time control, as in the 4-seat games.

### 5.2 Tablet / landscape

Two equal boards side by side (each at least 40 px cells, so about 700 px of width), clocks and pockets between and under; the swap gesture is not needed. The cell-size function returns one size for both boards.

### 5.3 Screens and entry points

- **Play menu:** a "Bughouse" card with **Local** (vs bots) and **Online**, a "How to play" sheet (a Bughouse rules sheet built from the same constants as the engine, like the Chaturaji one), and the "Return to your game" link (as for the other 4-seat games).
- **Setup (local):** choose the seat (which board / colour), the three bots' ELO, the time control.
- **Queue screen** with the fill countdown (the 4-seat queue text, "bots fill the empty seats once two are here").
- **Spectate list:** a "Bughouse" section.

### 5.4 Partner communication (B14)

The existing 4-seat chat panel is reused. **Quick messages** ("Need a knight", "Need a pawn", "Sit!", "Go!", "Don't trade", "Thanks") are a decision: they are small buttons that send a chat line; they are valuable on a phone where typing mid-game is hard, and are marked optional in the workstreams.

### 5.5 Accessibility and tests

Every cell label carries the board ("e4, board A, Red knight"), every clock and pocket chip has an aria-label, and test ids are board-qualified (`A-e4`, `pocket-B-black-n`) so the rendered tests and the browser suite can address a board without guessing (HP9). The dom test project renders the real screens as for Chaturaji; the browser suite checks 360 x 640 and 412 x 915 for overflow and clipped text.

---

## 6. DECISIONS FOR THE USER

Each question: options, the recommended default with a one-line reason, and what changes if you pick differently. Answer by number (e.g. "B1 yes, B4 S1, B5 b ...").

**B1. May a pawn dropped on the 2nd rank (7th for Black) make the two-square first move (and be taken en passant)?**
Options: (a) yes; (b) no (a dropped pawn can only step one).
**Default (a):** chess.com, Wikipedia and PyChess all say yes [S1][S2][S3], and the existing engine already does it (chess.js reads the FEN).
*If (b):* a "dropped" flag per pawn is needed (state beside the FEN) and a new rule in move generation: +1 day in W1 and a Crazyhouse-divergence test; the 2-player Crazyhouse stays as is.

**B2. A captured promoted piece goes to the pocket as a pawn - confirm?**
**Default: confirm** [S1 "counterfeits"][S2][S3][R].
*If not:* promoted tracking is removed from the bank rule (simpler engine, a different game).

**B3. May a drop give check and checkmate?**
Options: (a) yes; (b) no drop check (the Dutch rules quoted in S2).
**Default (a):** S2 and S3 state it plainly (reserve pieces may go on any vacant square, including one that gives check or mate); S1 does not say so explicitly, but its mate rule (a check a drop could block is not mate) presupposes drops while in check; Crazyhouse here already allows it. Only the Dutch rules quoted in S2 forbid a drop check.
*If (b):* a drop-legality filter (the dropped piece may not attack the king) and its tests; the bot's mating-drop logic is removed.

**B4. A check that a dropped piece could block but the pocket is empty: checkmate or not?**
Options: (a) NOT mate; the player waits for a piece, their clock runs (S1); (b) mate when no legal move and no legal drop with the CURRENT pocket (what the Crazyhouse engine does).
**Default (a):** it is the only explicit rule from chess.com (S1: "does not count as checkmate, even if the player has no piece in the bank").
*If (b):* the Crazyhouse status code is reused unchanged (saves about a day) but the game ends earlier than on chess.com; the `stuck` state disappears for the check case.

**B5. Not in check, no legal move, nothing to drop ("stalemate"): what happens?**
Options: (a) nothing: the player waits (like B4a), the flag decides; (b) the match is drawn; (c) the stalemated player's team loses.
**Default (a):** consistent with B4a, and **no source I could read says otherwise** (S1, S2, S3 are silent). **Needs a chess.com screenshot to settle.**
*If (b)/(c):* one more match-ending reason and its tests; (c) is unusual and I have no source for it.

**B6. A rook dropped on its home square (a1/h1/a8/h8): may it castle?**
Options: (a) no - rights are lost once the king or a rook moved or a rook was captured (the Crazyhouse engine's FEN-flag behaviour); (b) yes (a ruleset quoted in S2).
**Default (a):** it is what the engine does, the case is very rare, and S1 does not say.
*If (b):* the castling flags need a "re-armed by a drop" state: about a day in W1 and tests; it also diverges from 2-player Crazyhouse.

**B7. When one board ends, does the match end at once?**
Options: (a) yes, immediately (S1, S2, S3); (b) the other board plays on, no new pieces enter, scores are added (a variant described in S2).
**Default (a):** the user's own brief and every online source.
*If (b):* a second match phase, a scoring rule and UI for a half-finished match: +3 days.

**B8. Both teams' flags (or a flag and a mate) in the same instant: who wins?**
Options: (a) the first one the server processes wins; (b) a draw when both flags are already due when the first is processed; (c) always a draw within N ms.
**Default (b):** it follows S2 ("a draw if players of opposite teams flag or are mated simultaneously") while staying deterministic on a server.
*If (a):* simpler, slightly less fair at the exact tie; *(c):* needs a tolerance constant and a justification.

**B9. Draw by agreement and "abort": offered?**
Options: (a) neither (resign only); (b) draw offers needing all four players; (c) abort when a player has not moved after N seconds.
**Default (a):** the 4-seat games have neither (the Chaturaji spec lists "no abort rule" as a known limit), S1 mentions neither, and a four-way agreement is a UI problem of its own.
*If (b)/(c):* a protocol (offer / accept) or a timer, plus screens: +2 days each.

**B10. Threefold repetition and the fifty-move rule?**
Options: (a) neither (disabled); (b) per-board repetition ignoring pockets (FICS / chess.com per S2); (c) repetition counting pockets (ICC per S2).
**Default (a):** the Crazyhouse engine never detects repetition (a known limit) and with constant transfers neither rule can fire in practice; the fifty-move rule is switched off for Bughouse.
*If (b)/(c):* position keys per board and a repetition result (+1.5 days; the engine rebuilds from FEN each ply today, which is why Crazyhouse never got it).

**B11. Time controls offered, and is there an increment?**
Options: (a) the existing list without Daily and "No time limit" (what the 4-seat games offer); (b) a short list of Bughouse-typical blitz controls only; (c) (b) plus increments.
**Default (b), with increments only where already in the list:** 1 min, 2 | 1, 3 min, 3 | 2, 5 min, 5 | 2, 10 min - four clocks make long games tedious and a long game with 4 humans is rarely finished. Sources name no controls.
*If (a):* nothing new to build, longer waits for partners; *if (c):* the same, the increment goes to the mover of the board where the action happened.

**B12. Which clock rule at the start: do both boards start together, and is there a first-move grace?**
Options: (a) both boards' White clocks start when the room is created, no grace; (b) a short grace for each player's first move.
**Default (a):** the same as the 4-seat games.
*If (b):* a per-player first-move flag in the clock model; about +0.5 day.

**B13. Partner board visibility and size.**
Options: (a) always visible as a small thumbnail with a tap-to-swap (section 5.1); (b) a toggle (hidden by default); (c) a tab / swipe, one board at a time.
**Default (a):** you cannot coordinate (what to capture, when to sit) without seeing it, and the information is public anyway.
*If (b)/(c):* the screen is simpler and the main board can be larger, at the cost of the partner game; the browser and layout tests change accordingly.

**B14. Partner chat and quick messages.**
Options: (a) none; (b) the existing 4-seat chat panel (free text, rate-limited, to all four); (c) (b) plus six quick-message buttons; (d) team-only chat.
**Default (b) in v1, (c) as an optional late workstream:** (b) is a reuse; quick messages matter on a phone; team-only chat needs a new channel in the server (+1 day).
*If (a):* removes `Chat` from the controls row.

**B15. Local mode.**
Options: (a) one human + three bots (partner bot, two opposing bots); (b) two humans on one device, each on their own board, bots as their partners; (c) four humans, pass-the-device.
**Default (a):** the only mode where one phone and one person play a full match; (b) / (c) need a device layout nobody has asked for.
*If (b)/(c):* a different local flow (two simultaneous players on one screen) and its own rotation / privacy rules: +3 to +5 days.

**B16. Online matchmaking.**
Options: (a) a solo queue with a random partner (the 4-seat matchmaker: four players, or two or more plus bots after 30 s); (b) play with a friend as a pair (a private room / invite code: the 2-player app has challenge codes, the 4-seat games have no private rooms); (c) queue as a ready-made pair.
**Default (a) in v1; (b) later:** (a) is the existing mechanism; private rooms are an open item for all 4-seat games.
*If (b)/(c) in v1:* new server concepts (private rooms, pairs in the queue): +4 days.

**B17. Bots filling empty seats online, takeover, and who is whose partner.**
Options: (a) as the 4-seat games: at least two humans must be queued, a 30 s wait, bots fill the rest, a random seat shuffle decides the teams (two humans may be opponents), a 45 s takeover grace; (b) the same, but when exactly two humans are present they are made partners; (c) a lone human may start with three bots.
**Default (a):** consistency and no new matchmaker logic; a lone human never gets bots today and the reason (no bot farming, a real person must be there) carries over.
*If (b):* the shuffle is replaced by a constrained assignment (+0.5 day); *(c):* a changed minimum (`FOUR_MIN_HUMANS`) for this variant only.

**B18. Ratings and history.**
Options: (a) none (as for all 4-seat games); (b) a team rating.
**Default (a):** the 4-seat games are not saved, rated or analysed, and a team rating raises questions (rated for what pair?) that need their own design.
*If (b):* a DB model and a rating rule for pairs: a separate workstream, not in the estimate.

**B19. What happens when the partner disconnects?**
Options: (a) the same takeover as any seat: a bot plays after the 45 s grace, the human may return; (b) the team forfeits after the grace; (c) the match pauses.
**Default (a):** the proven 4-seat behaviour; a pause would let one player freeze three others.
*If (b)/(c):* a different end condition or a pause state on the server (and a UI for it).

**B20. Seat, colour and board assignment.**
Options: (a) fixed by the seat map in rule 2 (seat 0 = Board A White ... seat 3 = Board B Black) with a random seat shuffle in the queue; (b) the player chooses the board / colour in the queue.
**Default (a):** nothing to choose in the queue, one rule everywhere.
*If (b):* a preference in the queue and a constrained shuffle: +1 day.

**B21. Premoves (and drop premoves).**
Options: (a) none in v1 (HP3); (b) ordinary-move premoves; (c) moves and drop premoves.
**Default (a):** Crazyhouse has none and the pocket-changing rule makes drop premoves the hardest part; but **premoves are a big part of real bughouse speed** - say so if you want (b)/(c) in v1.
*If (b)/(c):* reuse `usePremove` with an authoritative re-check; +2 / +3.5 days and a bigger test set.

**B22. Spectators and what a finished match keeps.**
Options: (a) spectators see both boards; the result is kept 5 minutes for a late rejoin (as the 4-seat games); (b) spectators choose a board.
**Default (a):** the same snapshot serves both; the Spectate list is a section like the 4-seat games'.
*If (b):* a UI toggle only.

---

## 7. WORKSTREAMS W0-W7 (branch `paired/bughouse` in both repos, from `master` / `main`)

Each row is a vertical slice with a stop-and-review. **Every workstream carries these gates:** `tsc` clean; the frontend suite and every backend suite green and unchanged at their current counts; **the existing goldens byte-identical (FFA, Giveaway, Chaturaji, geometry, and the new Crazyhouse golden from W0)**; `sync:fourplayer --check` and the new mirror's check; mutation on the new non-visual logic in **chunks of at most ~20 mutants / 20 minutes, a hard timeout per mutant, one chunk at a time, results outside the repo**, every survivor killed or proven equivalent with a test (AGENTS.md); a docs entry per workstream. **Lessons from AGENTS.md that apply from the first line:** no helper names a square, cell or clock without the board as a required argument (HP9); constants checked by mutation-targeted tests are literals; test-only switches follow CHECKLIST section 7 (opt-in name, ignored under `NODE_ENV=production` with one value-less warning, validated, set only by the e2e stack); no wall-clock assertions (best-of-N or structural), seeded randomness, fake timers in rendered tests; **the dev web path is checked, not only the export** (`expo export` bakes the production bundle, which talks to Render: the browser suite uses `--dev` with `EXPO_PUBLIC_API_URL`; every UI slice is also run once against the dev server, not only the exported build).

| | Slice | Scope and gates specific to it | Size (working days) |
|---|---|---|---|
| **W0** | **Foundations, no behaviour change.** (1) Commit the mutation harness to the repo (`scripts/mutation/`, a README, one example config) so the gate is repeatable. (2) Record a **Crazyhouse golden** on master (seeded games, every position / drop list / reserve / bot decision hashed with the existing golden kit) BEFORE touching `crazyhouse.ts`. (3) Add the bank-to-partner and "can a drop ever help" helpers to `crazyhouse.ts` as NEW exports (+ the verbatim backend mirror + `test-crazyhouse.mjs`). (4) The new mirror module family and its manifest (empty engine skeleton, the generator check wired). (5) Decide B1-B22 in the doc. | Gates: the Crazyhouse golden and `crazyhouse*.test.ts` / oracle / `test-crazyhouse.mjs` unchanged; mirror in sync; the benchmark of `legalDrops` before / after. | **2-2.5** |
| **W1** | **The Bughouse engine (pure, mirrored).** `BughouseMatch`: two boards (chess.js + the Crazyhouse rules block), four pockets, promoted marks per board, the seat map, `applyAction` (move / drop / resign / flag), the `stuck` status (B4, B5), the match result with the deciding board, a text snapshot and its parser, the legal-action lists per seat; hand-built scripted positions for every rule in section 1; the reference model for transfers; the differential tests per board against `ChessEngine`'s crazyhouse option and the chessops oracle; the conservation property test (HP1); a Bughouse golden; generated server copy. | Gates: the oracle agrees per board over seeded games; the conservation invariant over 500+ seeded interleavings; snapshot round-trips exactly; mutation chunks over transfer / status / result / drop legality / snapshot. | **5-6** |
| **W2** | **Server game loop and bots, in-process.** `BughouseRoomManager` (commit funnel, one global `seq`, two clock timers and per-board bot timers, rate limit, takeover / retake, all-gone, rejoin of a live and a finished match, spectate, chat, active-games list), the second matchmaker instance, `bug_*` handlers and wire, the Bughouse bot on the lean engine with its decision budget (HP4), config names; a compatibility matrix with the four 4-seat suites unchanged. | Gates: in-process tests on stub sockets and fake timers for HP1 / HP2 / HP5 scenarios; bot p99 per tier (best-of-N); bot golden; the 4-seat suites (rooms 237, bots 160, handlers 61, matchmaking 74, ...) unchanged. | **6-7** |
| **W3** | **Local screens (vs bots).** Play-menu card, setup, the two-board screen (own board large, thumbnail, swap), four clocks, four pockets, the drop interaction, `stuck` line, result with both boards, rules sheet; cell-size function pinned at 360 x 640 and 412 x 915; board-qualified labels and test ids; rendered tests in the `dom` project; browser pass on the dev server at both sizes in both themes. | Gates: rendered tests for every screen state; layout assertions (no overflow, nothing clipped); a whole-game property test that no UI helper defaults to a board (HP9). | **5-6** |
| **W4** | **Online client, spectator, rejoin.** Reducer / session / UI logic twins, queue screen, online game, spectator screen, Spectate list section, the third `ActiveOnlineGame` kind, resume link; rendered tests with a server simulator on the real engine (restore after rejoin, optimistic drop and rollback, takeover badge, partner thumbnail follows the stream). | Gates: reducer tests incl. a refused drop and a late snapshot; the persisted-rejoin restart test; mutation on the reducer. | **4-5** |
| **W5** | **Real sockets.** Real-socket e2e scenarios (a whole natural game with four clients and a spectator; a capture/drop race; resign; flag on each board; takeover and retake on each seat; spectator; lobbies never mix with the four other variants; persisted rejoin from a new process), a fixed total of checks (conditional checks counted apart), the nightly fuzz section (four clients on the mobile engine), CI / nightly wiring. | Gates: the e2e total fixed over three runs; fuzz 40+ games, 0 issues; the other variants' counts unchanged. | **3** |
| **W6** | **Browser end-to-end.** New scenarios in `backend/scripts/e2e-browser`: four users, ten rounds with every screen of both boards compared with the server after every action, capture-then-drop across boards, `stuck`, a flag, takeover and hand-back, reload, spectator, three variants plus Bughouse never mixing, layout at both sizes, touch. A constructed start position through a guarded start-position switch (a Bughouse snapshot kind) to reach promotion / a counterfeit / a drop mate reliably. | Gates: 3 of 3 consecutive runs and one under CPU load on the final commit, retries <= 1 per scenario and <= 2 per run, the dev web path exercised. | **3-4** |
| **W7** | **Close-out and merge readiness.** Docs roll-up (both TESTING.md, CHECKLIST, TODO, AGENTS), the final mutation re-run over everything Bughouse touched (per chunk: mutants / killed / equivalents with one-line proofs / time), the full gates, squash to logical commits, CI green on the exact commits, merge steps. | As the W5 close-out of Chaturaji. | **2-2.5** |

**Total: about 31-36 working days across eight stop-and-review cycles.** For scale: the Chaturaji spec estimated 9-12 days for six cycles and ended with a much heavier test and close-out load than its estimate; Bughouse has more new surface (two simultaneous boards, four clocks, cross-board state, a server-side bot, a new two-board screen) and no existing 4-seat engine to extend. **Optional, outside the estimate** (each its own cycle if wanted): partner quick messages (B14c) 1-1.5 d; premoves (B21) 2-3.5 d; partner-aware bot (HP4 v2) 3-4 d; friend / private rooms (B16b) 4 d; a team rating (B18b) not sized.

---

## 8. RISKS AND OPEN QUESTIONS

1. **Three rules rest on silence, not sources:** stalemate (B5), a rook dropped on a home square (B6), repetition (B10). I could not read ICC's page (S5) and chess.com's article is short (S1). **chess.com screenshots of the live game would settle B4, B5, B6 and B8** and cost nothing.
2. **The server needs an engine and a bot.** The mobile app's `ChessEngine` and bots are client-only; the backend has a separately maintained twin without bots. The recommended generated module removes the drift risk but is the largest new piece of tooling (a second mirror manifest and its generator check).
3. **Bot decision cost.** The Crazyhouse bot's measured ~120 ms average / ~400 ms max is not acceptable synchronously on the server; the 25 ms p99 gate may force a weaker first bot or a worker thread (HP4). The bot will be a shallow heuristic, as the Crazyhouse and Chaturaji bots are; it will not "sit" or play partner-aware in v1.
4. **No external oracle.** Single boards can be checked against chessops; the transfers and the match logic cannot: they rely on a reference model written for the tests and on the conservation invariant. That model must be written independently of the implementation, or it proves nothing.
5. **Two boards on a phone.** The thumbnail layout (96 px) is readable for who-is-where and pockets, not for deep tactics; the swap gesture is the safety valve. Needs the real browser pass and ideally a real phone; the Chaturaji suite only emulated touch.
6. **Latency and fairness.** Server-authoritative clocks without lag compensation favour low-latency players; with four real-time participants this is more visible than in 2-player chess. Same policy as today; flag it so it is a choice.
7. **Server load.** A Bughouse room has two clock timers, up to four bot timers and a snapshot twice the size of a 2-player one per action; it needs a measure (snapshot bytes, CPU per room) in W2 and a note on how many concurrent rooms one Render instance carries (the 4-seat games have no such number either).
8. **State is in memory.** As for the 4-seat games, a server restart ends every game (no persistence); a longer match makes that more painful than a 3-minute 2-player game. Not addressed here.
9. **Coverage of the browser suite.** It is nightly only (about 7 minutes today); four users and ten rounds will make it longer; the nightly budget and the retry policy may need a second look in W6.
10. **Naming and branding.** "Bughouse" is a public-domain game name; no chess.com text, graphics or branding is copied. The rules sheet is written from the engine's constants, not from any site.
11. **The estimate is a planning figure.** Chaturaji's real effort exceeded its estimate mainly in close-out; this one assumes the same discipline (goldens, mutation, browser suite) is kept.

**Needed before W0:** decisions B4, B5 and B16 (the three that change the most code); B1, B2, B3, B6-B22 have defaults I will build unless told otherwise.
