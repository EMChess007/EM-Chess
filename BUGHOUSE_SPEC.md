# Bughouse (Doubles) - specification and decision list, v2

Status: **DRAFT v2 for review (2026-10-20). Spec only: no game code, no engine change.** Written per CHECKLIST.md ("spec before code") in the shape of `CHATURAJI_SPEC.md`. Covers both repos: frontend `EM-Chess` and backend `chess-app-backend` (`backend/`). Nothing here is built; every "exists today" statement was checked against the code on `master` / `main` after the Chaturaji merge.

**What Bughouse is (the user's brief):** two teams of two, two boards played at the same time, teammates play opposite colours, a piece a player captures goes to their partner's pocket (the partner may drop it instead of moving), each player has their own clock, and the whole match ends as soon as any board ends.

## 0. v2 changes (what is different from v1, `969ee7d`)

1. **All v1 decisions are settled by the user (20/10)** and written into section 6 as RESOLVED, each with its source: B1 yes, B2 confirmed, B3 yes, B4 not mate (the player waits), B5 the player waits and the clock decides, B6 no, B7 yes, B9 none, B10 none, B11 changed (1, 2|1, 3, 3|2, 5, 5|2; 10 min dropped), B12 together and no grace, B13 layouts, B14 chat + quick messages, B15 both local modes, B16 both queue and friend room, B17 as the 4-seat games, B18 none, B19 takeover then hand-back, B20 fixed seat map, B21 premoves AND drop premoves, B22 as proposed.
2. **No draws.** New source S-U2 ("there are no draws in Bughouse"): B8 is changed, draw offers (B9), repetition and the fifty-move rule (B10) are out, and the **result model has no draw**. Flags are settled by authoritative server time (section 4, HP2): the flag that fell earlier loses; a flag against a mate is whichever the server committed first; an exact-millisecond tie is broken deterministically - **that tie-break is the ONLY rule in this spec that has no source** and is marked as such.
3. **Online, "illegal move" is not an ending** (it is one over the board [S-U1]): an illegal request is rejected and never played.
4. **New decision B23** (Local with two humans on one device: teammates on a split screen, or opponents pass-and-play): recommendation and full screen / input design in sections 5.6 and 6; **recommended: opponents, pass-and-play** for the phone.
5. **Two UI layouts and a team badge** (S-U3): phone portrait = own board large + partner thumbnail with tap-to-swap; tablet / landscape = two equal boards side by side; in both, **each board is oriented to its player's colour** (the partner's board shows the partner's colour at the bottom) and **teammates' kings carry a team badge** (our own design).
6. **Quick messages are in v1** (partner-only, sent as a code, never text): the set, the wire, the rate limit and the toast are specified (5.4, HP10).
7. **Friend rooms are in v1** (private room with an invite code, the friends are teammates): the whole flow - create, code / link, join, start, expiry, a friend leaving, and how a room joins the matchmaking as a pair - is designed (HP9, 5.7), with the abuse controls it needs. **Finding while designing it:** the existing 2-player challenge join has no attempt limit (risk 8).
8. **Premoves and drop premoves are in v1**: a one-deep queue resolved on the client against the authoritative snapshot, never sent early; every cancellation has a visible reason (HP3, 5.5).
9. **Workstreams re-planned** (section 7): W0 unchanged (foundations, no behaviour change); friend rooms, premoves and quick messages each have a place with their own gates; **total re-estimated from 31-36 to about 44-54 working days over ten cycles.**
10. **Sources added:** S-U1 (the user's rules summary), S-U2, S-U3, and a re-read of chess.com's own Bughouse glossary page (chess.com/terms/bughouse-chess; the wording below is my summary of it, not a quotation), which **confirms** teams of two, opposite colours, clocks started at the same time, the partner receiving the original pawn of a captured promoted piece, a game ending by checkmate, flag or resignation with the opposing team winning the match even if the other game would continue, blitz as the usual control, and that chess.com **offers shortcuts for partner communication** (supports B14); it also says a draw can be agreed (an over-the-board allowance; it conflicts with S-U2 - section 8, question Q6; the user's B9 stands).

**Where the rules come from.** Never from memory and never invented: each rule carries its source. Where sources differ the rule is a **decision** in section 6 (B1..B23).

- **S1** chess.com support, "What is Bughouse?" (support.chess.com/en/articles/8615092-what-is-bughouse) - read in v1; silent on castling, en passant, draws, clocks, chat and abandonment.
- **S2** Wikipedia, "Bughouse chess" (first 100,000 of 132,000 characters read).
- **S3** PyChess, Bughouse variant page (pychess.org/variants/bughouse).
- **S4** Over-the-board rulesets surfaced by search (British Championships 2026, WCCC 2007 / 2004): titles and search summary only; **no rule here is taken from them**.
- **S5** ICC's help page redirected to a generic help centre and could not be read; nothing is claimed from ICC beyond what S2 says about it.
- **S-U1** the user's rules summary (20/10), citing chess.com/terms/bughouse-chess, the chessfed.gr WCCC 2007 bughouse rules, Simple Wikipedia, chessworld.com.au, szachy.info.pl and a league rules PDF (bullittcountychessleague). Main points as the user gave them: two teams of two, partners play opposite colours; both board clocks start at the same time; blitz, typically 3-5 minutes; the match ends the moment any board ends (checkmate, resignation, time-out, illegal move) and the team that won on that board wins; captures go to the partner's reserve; a drop is a full turn onto any empty square; no pawn drops on the 1st / 8th rank; dropped pawns can promote; captured promoted pieces return as pawns; drops may give check / mate; no move or drop may leave your own king in check; partners may talk freely. *Only chess.com/terms/bughouse-chess was re-read by me (see change 10); the other pages are cited as the user summarised them.*
- **S-U2** chess.com/blog/ChessOfficial2016/bughouse-chess-rules-and-basics (a player blog): "There are no draws in Bughouse." Nothing else relevant. *Cited as the user reported it.*
- **S-U3** a chess.com desktop screenshot supplied by the user: two same-size boards side by side, slightly offset vertically; the user's board has White at the bottom; the partner's board (partner plays Black) has BLACK at the bottom - each board is oriented to the teammate's colour; both teammates' kings carry a small team badge. *Described as the user reported it; I have not seen the image.*
- **R** this repository's own Crazyhouse documentation (TESTING.md section 20, `src/logic/crazyhouse.ts` header): what the existing engine already does.

---

## 1. RULES

Notation: **[S1]** ... = source; **[R]** = what the existing Crazyhouse engine does; **(B7)** = the decision in section 6 that settled it. Every rule below is now settled; the decision numbers record who decided what.

### 1.1 Board and team layout

1. **Four players, two teams of two, two boards.** Board A and board B each host one game between a player of each team. **Teammates play opposite colours** and sit on different boards. [S1][S2][S3][S-U1]
2. **Seat map used throughout this spec** (an implementation choice, B20): seat 0 = Board A White, seat 1 = Board A Black, seat 2 = Board B White, seat 3 = Board B Black. **Team 1 = seats 0 + 3**, **Team 2 = seats 1 + 2**. `partner(0) = 3`, `partner(3) = 0`, `partner(1) = 2`, `partner(2) = 1`; a player's opponent on their own board is the other seat of that board. In the solo queue the seats are shuffled; **in a friend room the two friends are seats 0 + 3** (one team).
3. **Both boards start at the same moment, White to move on each, and all clocks start together with no first-move grace.** [S-U1][chess.com glossary] (B12)

### 1.2 Captures and pockets

4. **A capture goes to the capturer's partner's pocket** ("bank", "reserve"), immediately; the partner may use it as a drop on a later turn. [S1][S2][S3][S-U1] The pocket holds a piece of the colour of the player who will drop it (the partner's colour). [R]
5. **A captured promoted piece goes to the pocket as a PAWN** ("counterfeit"). [S1][S2][S3][S-U1][R] (B2)
6. **A king is never banked** (the game has ended at the check). [R]
7. **A player's pocket is visible to everybody** (public information); the opponent's pocket on my board is what THEIR partner has captured.
8. **Pocket piece types:** pawn, knight, bishop, rook, queen, with counts. [R]

### 1.3 Drops

9. **A turn is ONE action: an ordinary move OR a drop** of a piece from the player's own pocket onto **any empty square** (never onto an occupied one: no "drop capture"). [S1][S2][S3][S-U1][R]
10. **Pawns may not be dropped on the 1st or 8th rank.** [S1][S2][S3][S-U1][R]
11. **A pawn dropped on the 2nd rank (7th for Black) may make the two-square first move and can then be taken en passant.** [S1][S2][S3] (B1: yes; the existing engine already does it because chess.js reads the FEN.) **A dropped pawn may promote.** [S-U1][S2]
12. **A drop may give check and may deliver checkmate.** [S-U1][S2][S3] (B3: yes.)
13. **No move or drop may leave your own king in check.** [S-U1] For moves this is the standard legality. For drops it only restricts drops while in check: **a drop may block a check, and then the only legal drops are onto the squares between a single sliding checker and the king; against a knight / pawn check or a double check no drop is legal.** (A drop can never expose your own king by itself: it only adds a blocker.) [R]
14. **Castling rights are flags that are lost once the king or rook moves or a rook is captured; a rook dropped back on its home square does NOT restore them.** [R] (B6: no.)

### 1.4 Promotion, castling, en passant

15. **Promotion** is the standard rule (Q / R / B / N, by push or capture); a promoted piece is marked until captured (rule 5). [R]
16. **Castling** and **en passant** are the standard chess rules on each board; a drop never creates an en passant square and clears a stale one. [R]

### 1.5 End of the match - and there are no draws

17. **The WHOLE match ends as soon as ANY board ends**, by checkmate, resignation or a flag; **the team that won on that board wins the match**, even if the other game would continue. [S1][S2][S3][S-U1]; chess.com's glossary page says the same (summarised: when one board is lost the opposing team wins the match). (B7: yes.)
18. **Checkmate means a real mate: no legal move AND no drop could ever answer the check.** A check that a dropped piece could block is **not** mate even when the player's pocket is empty: the player waits (their clock keeps running) until a piece arrives or the flag falls. [S1] (B4.) This differs from the existing Crazyhouse engine, whose "mate" requires no legal drop given the current reserve [R]; Bughouse needs a status of its own, `stuck` (HP8).
19. **Stalemate and "no legal action"** (not in check, nothing to move, nothing to drop): the player waits; **nothing ends the board; the clock decides.** (B5.) Consistent with S-U2 (no draws).
20. **Insufficient material never ends a game** (a pocket can always refill a board). [R]
21. **Illegal moves do not exist online.** Over the board an illegal move loses the game [S-U1][S2]; here the client never offers one and the server **rejects** an illegal request with an error and no state change: it is never played, so it is never an ending, never costs time and never needs a penalty rule. (B7.)
22. **There are no draws.** [S-U2] So the match has **no draw by agreement** (B9), **no threefold repetition** (B10), **no fifty-move rule** (B10) and **no draw by simultaneity**. Every match ends with a winner team, with exactly **one non-winner outcome that is not a draw: `voided`** - the match is abandoned because **no human is left** in it (every human has left and the all-gone timer has expired), exactly as the 4-seat games end "with no result"; nobody wins and nothing is recorded. **No other rule needs a draw** (checked: flag ties, mate and flag in the same instant, both boards ending in the same commit are all resolved by rule 25 without one).
23. **Who loses on each ending:** the player who is mated, who resigns, or whose flag falls loses for their team; the other team wins. A player may resign at any time, not only on their own turn.

### 1.6 Clocks and flags

24. **Four independent clocks, one per player.** On each board only the clock of the side to move runs; the two boards' running clocks tick at the same time. A flag on either board ends the match. [S1][S2][S-U1]
25. **Settlement of a flag (B8, changed):** all four clocks and every commit use **one authoritative server clock with integer-millisecond precision**; a running clock has a **flag deadline** `d = turnStart + remaining` (integer ms). Before ANY input (a move, a drop, a resignation, a timer) is applied, the server settles the flags that are already due (`d <= now`): **the player with the earliest `d` loses**, the input is discarded. So **a flag against a checkmate is decided by the instants: the flag wins if its deadline is not later than the instant the server took the mating move, otherwise the mate was committed first and wins** - the same thing as "whichever event the server committed first", because due flags are always committed before the action in the same step. An exact-millisecond tie between two deadlines is broken by **the tie-break chain of HP2 - the only rule in this spec that has no source.**
26. **Time controls:** 1 min, 2 | 1, 3 min, 3 | 2, 5 min, 5 | 2. **10 minutes is dropped**: S-U1 says blitz, typically 3-5 minutes. No Daily and no "No time limit" (a running clock is part of the rules). (B11.)
27. **Partners may talk freely** [S-U1] (B14: the chat plus partner-only quick messages).

---

## 2. REUSE INVENTORY

"Reuse" = as it is; "extend" = a backwards-compatible addition (existing goldens and tests stay byte-identical); "new" = does not exist.

### 2.1 Chess rules and Crazyhouse (the single-board engine)

| What | Where | Verdict |
|---|---|---|
| Crazyhouse rules block: reserves, promoted-square tracking, drop squares, check geometry, `crazyhouseDropSan` (`N@f3`) | `src/logic/crazyhouse.ts`, mirrored VERBATIM to `backend/src/game/crazyhouse.ts` (guard: `backend/scripts/test-crazyhouse.mjs`) | **Reuse + extend.** What differs is WHERE a capture is banked (the partner's pocket on the other board) and what counts as mate (rule 18): new exports, not edits of existing functions. |
| `ChessEngine` with the `crazyhouse` option (`drop()`, `getLegalDrops()`, the per-ply `crazyhouse` state on each `Move`) | `src/logic/ChessEngine.ts` (944 lines; every variant) | **Reuse for single-board behaviour; the match logic does not go in it.** |
| The server's twin engine | `backend/src/game/RoomChessEngine.ts` (830 lines) | Hand-maintained twin of `ChessEngine`; **no bots on the server**. See section 3. |
| Per-ply state helpers | `src/logic/perPlyState.ts` | Reuse. |
| Differential oracle for single-board rules (chessops `Crazyhouse`, dev-only) | `src/logic/__tests__/crazyhouseOracle.test.ts` | **Reuse per board.** There is **no oracle for Bughouse**: the transfers need a reference model written for the tests (HP1). |
| Crazyhouse tests and mutation notes | `crazyhouse*.test.ts`; TESTING.md section 20 | Regression floor. A **Crazyhouse golden** does not exist and is recorded in W0. |
| Crazyhouse bot (`chooseCrazyhouseBotMove`: a whole turn, move or drop; ~120 ms average / ~400 ms max in self-play) | `src/logic/bots.ts` (about lines 667-830) | **Extend / new**: one board, no partner awareness, client-only (HP4). |

### 2.2 The 4-seat online stack (rooms, queue, takeover, rejoin, spectate, chat)

| What | Where | Verdict |
|---|---|---|
| **The commit funnel**: ONE mutator of state, clocks and a global `seq`; one full-state `four_state` per action | `backend/src/game/fourPlayerRooms.ts` (`commit`, 862 lines) | **Reuse the design, new class.** Bound to `FourPlayerState`, one mover, one clock timer and one bot timer per room (section 3). |
| Seat runtime, takeover (45 s grace, `botReason: takeover`), retake, all-gone abandonment, fast-forward, move rate limit | `fourPlayerRooms.ts`; `backend/src/game/fourPlayerConfig.ts` | **Reuse the model and the config; extend** with Bughouse names. |
| Matchmaker: lobby per `timeControl|variant`, 2-human minimum, 30 s fill wait, bots fill, random seat shuffle | `backend/src/game/fourPlayerMatchmaking.ts` | **Extend**: a second instance for `bughouse`, and **groups** (a friend pair is one lobby entry that is never split, HP9). |
| Handlers, wire types, validators, spectate, active-games list, chat (rate-limited) | `fourPlayerHandlers.ts`, `fourPlayerWire.ts` | **Extend / new `bug_*` twins.** |
| Generated mirror (client source -> backend copy, with a CI check) | `backend/scripts/sync-fourplayer.mjs`, `src/logic/fourPlayer/MIRRORED_TO_BACKEND.json` | **Reuse the mechanism** for `src/logic/bughouse/`. |
| Client reducer / session / UI logic of a 4-seat room | `src/logic/fourPlayerOnline.ts`, `fourPlayerOnlineSession.ts`, `fourPlayerOnlineUi.ts` | **Extend / new twins.** |
| Persisted rejoin | `src/logic/activeGame.ts` (`ActiveOnlineGame` = `twoPlayer` or `fourPlayer`), `onlineRejoin.ts` | **Extend** (a third kind). |
| Screens: queue, online game, spectator, Spectate list | `FourPlayerMatchmakingScreen.tsx`, `FourPlayerOnlineGameScreen.tsx`, `FourPlayerSpectatorScreen.tsx`, `SpectateListScreen.tsx` | **Extend / new**; they draw `FourPlayerBoard`, which Bughouse does not use. |
| Chat panel | `src/components/FourPlayerChatPanel.tsx` | **Reuse.** |
| **Friend invite codes (2-player)**: 6 characters from a 31-letter alphabet without 0 / O / 1 / I / L, a 10-minute TTL, a sweep, one code per creator, removed when the creator disconnects | `backend/src/game/challenges.ts`, the `create_challenge` / `join_challenge` handlers in `socketHandlers.ts` | **Reuse the code format, TTL and sweep; new lobby logic** (a Bughouse room has up to four seats and groups). **The existing join has no attempt limit** (risk 8): the Bughouse version must. |
| **Premove hook**: ONE premove at a time, a new one replaces the old, a Cancel drops it, a cancellation reason | `src/logic/usePremove.ts`, `premove.ts` (used by the 4-seat and bot screens; the 2-player online screen has its own inline copy and disables premoves in Crazyhouse) | **Extend** with drop intents. |
| Local pass-and-play board flip | `src/screens/LocalGameScreen.tsx` (`flipped` / `orientation`) | **Reuse the idea** for B23 (the board turns to the side to move). |
| Local setup, Play-menu cards, resume link | `FourPlayerSetupScreen.tsx`, `PlayModeSelectScreen.tsx` | **Extend.** |

### 2.3 Boards, pockets, clocks

| What | Where | Verdict |
|---|---|---|
| 8x8 chess board with drop selection | `src/components/ChessBoard.tsx` (+ `useBoardGestures.ts`, `boardSize.ts`, `BoardAnnotations.tsx`) | **Reuse for both boards;** extend for a second instance, a thumbnail size, per-board orientation and the team badge. |
| Pocket widget (one fixed-height row, tap a chip then a square) | `src/components/ReserveTray.tsx` | **Extend** (four pockets; only mine is interactive). |
| 2-player clock hook | `src/logic/useChessClock.ts` | **Extend / new**: four clocks, two running. |
| 4-seat clock (one running clock) | `src/logic/fourPlayer/clock.ts`, `useFourPlayerClock.ts` | **Not reusable** (single mover); a per-board model with deadlines is new (HP2). |
| Time controls | `src/logic/timeControls.ts` | Reuse the six chosen ids. |

### 2.4 Test tooling

| What | Where | Verdict |
|---|---|---|
| Golden transcripts kit | `src/logic/__tests__/fourPlayerGoldenKit.ts` and the FFA / Giveaway / Chaturaji goldens | **Reuse the kit**; the three goldens are the "unchanged" gate. |
| Real-socket e2e (fixed total 427) and the nightly fuzz (a section per variant) | `backend/scripts/test-fourplayer-online.mjs`, `nightly-fuzz-online.mjs` | **Extend.** |
| Copy-based mutation harness | **NOT in the repo** (a scratch folder) | **New (W0):** commit it under `scripts/mutation/` with a README. |
| Browser end-to-end and its test-only switches | `backend/scripts/e2e-browser/`, `npm run test:e2eBrowser`, nightly; `FOUR_TEST_SEED`, `FOUR_TEST_SETUP_ENDPOINT` (`fourTestSwitches.ts`), `AUTH_RATE_LIMIT_TEST_OVERRIDE`, `EXPO_PUBLIC_API_URL` | **Extend** (its setup endpoint arms a 4-seat snapshot; Bughouse needs its own kind). |

---

## 3. ARCHITECTURE OPTIONS

### 3.1 The three options

**(A) Composition: a `BughouseMatch` of two Crazyhouse boards in a new pure module family, a NEW room manager built on the 4-seat patterns.**
`src/logic/bughouse/` (generated mirror to the backend): `BughouseMatch` = two board states (FEN + per-board promoted marks, using the Crazyhouse rules block), four pockets, four clocks with deadlines, seat map, result (winner team or `voided`, never a draw); a reducer `applyAction(match, seat, action)` (move | drop | resign) and a pure `settle(match, input, now)` that decides flags first; a text snapshot; statuses including `stuck`. The server gets `BughouseRoomManager` (own funnel, two clock timers, bot timers per board, quick-message routing, private-room lobbies) copying the **pattern** of the 4-seat manager.
- *Files:* new `src/logic/bughouse/*` (+ manifest), new `backend/src/game/bughouse*.ts`, additive exports in `crazyhouse.ts` (+ mirror), new screens / hooks, additive changes in `activeGame.ts`, `PlayModeSelectScreen.tsx`, `SpectateListScreen.tsx`, `fourPlayerConfig.ts`, `index.ts`.
- *Risk:* medium (new engine on a verified core; a manager with a proven shape); nothing existing is modified except additions.
- *Effort:* see section 7 (about 44-54 working days with all v2 features).
- *Goldens:* none expected; the gate is FFA, Giveaway, Chaturaji, geometry and a new Crazyhouse golden byte-identical.

**(A2) The same engine with the existing `FourRoomManager` generalised by an engine adapter.**
- *Risk:* **high** - 862 lines pinned by four suites (rooms 237, bots 160, handlers 61, real-socket 427) and three live variants; Bughouse needs two timers and two movers anyway. *Effort:* +6-8 days, saves 2-3. *Goldens:* engine goldens untouched, server behaviour of three variants re-tested only by e2e.

**(B) A dedicated Bughouse engine with its own move generator.**
- *Risk:* **high** - throws away chess.js and the Crazyhouse oracle. *Effort:* +8-10 days. *Goldens:* none on existing variants; no external reference for the new engine.

### 3.2 Recommendation: **(A)**, with two additions

1. **A lean module, not `ChessEngine`.** The server needs bots, and the bots are written against the client's `ChessEngine`, which the backend does not have. A chess.js board wrapper plus the Crazyhouse rules block in `src/logic/bughouse/`, **generated** into the backend (the existing mirror mechanism), gives one engine for client, server and bots, a CI check against drift, and no change to `ChessEngine` or `RoomChessEngine`.
2. **Copy the pattern of `FourRoomManager`, do not refactor it** (rejecting A2).

### 3.3 Interactions (CHECKLIST section 1, second box) - stated, not assumed

- **Crazyhouse (2-player):** unchanged. The Crazyhouse golden (W0), `crazyhouse*.test.ts`, the oracle and `test-crazyhouse.mjs` stay green and byte-identical.
- **4 Player Chess, 4 Player Giveaway, Chaturaji:** unchanged. A Bughouse room has its own lobby key (`timeControl|bughouse`) and the `FourVariant` type is **not** widened, so no 4-seat code path learns about Bughouse.
- **2-player modes, tournaments, challenges, ratings, achievements, history, PGN, analysis, puzzles:** unaffected; **no rating, history, PGN or analysis for Bughouse** (B18: none).
- **Mutual exclusivity:** Bughouse is its own preset; Chess960, Fog of War, Atomic, Duck, Spell, Horde, Setup Chess etc. are not combinable (HP7).
- **Bots:** the 2-player Stockfish bots and the Crazyhouse bot are untouched; the Bughouse bot is new code on the shared rules.
- **Persisted rejoin:** a third `ActiveOnlineGame` kind carries the match snapshot.
- **The 2-player challenge flow:** unchanged by this work; its missing join-attempt limit is reported (risk 8), not fixed here.

---

## 4. HARD PARTS

### HP1. Server ordering of pocket transfers between boards

**Problem.** A capture on A must put a piece in the partner's pocket on B; the partner may drop at the same instant.

**Solution.**
- **One authority, one total order:** ONE funnel (`commit`) and ONE global `seq` for the match; concurrent requests are ordered by arrival.
- **A commit is atomic across boards:** the capture on A, the pocket credit on B, the clock charge and the published snapshot (`bug_state`: both boards, four pockets, four clocks, `seq`) are one step: a client can never see a capture without the credit, nor the reverse.
- **A captured piece is droppable from the very commit that contains the capture (seq n).** A drop is judged **on arrival, not on send**: if the piece is not in the pocket then, the server answers an error and changes nothing; the client rolls back its optimistic drop. Clients never change someone else's pocket count.
- **Conservation invariant:** the number of pieces on the two boards plus the four pockets is constant (64 at the start; counts, not types, because a captured promoted piece becomes a pawn); no pocket is ever negative.

**Tests.** (1) A pure reference model of the transfer rules written independently of the implementation, compared with the engine over seeded random games. (2) Property test: random interleavings of the four players' legal actions with random arrival order: the invariant, each capture credited exactly once, and that replaying the `seq` stream rebuilds the identical final state. (3) In-process room tests with fake timers: a capture and a drop arriving in both orders. (4) Real-socket e2e with four clients and a spectator: `seq` strictly increasing, snapshots byte-identical per `seq`. (5) Mutation on the credit (wrong board, wrong colour, a promoted piece banked as itself, credited twice, credited to the capturer).

### HP2. Clocks, flag settlement and the one non-sourced rule

**Problem.** Two clocks run at once; either flag ends the match; **there are no draws** (S-U2), so every race must have a winner, deterministically.

**Design.**
- **One clock source:** a single monotonic counter in integer milliseconds for the whole match (`matchMs`, taken from a monotonic timer, not `Date.now()`, so a wall-clock jump cannot reorder anything). All four clocks, all commits and all timers read it. Each player's clock stores `remainingMs` as of its `turnStartMs`; while running, its **flag deadline** is `d = turnStartMs + remainingMs`.
- **Settlement is a pure function** `settle(match, input, now)`, part of the mirrored module so it is tested without sockets: for any input (an action or a timer firing) the funnel reads `now` ONCE and (1) collects the running clocks with `d <= now`; if any, the match ends by flag and **the player with the smallest `d` loses** - the input, if it was an action, is discarded (it arrived after a flag had fallen); (2) otherwise applies the action; if it ends the board (mate or resignation), the match ends with that result. A timer that fires late cannot change the order, because the comparison is between **deadlines and receipt instants**, not between callback times.
- **Flag against checkmate** (B8): a mating move received at instant `t_m` and a flag deadline `d_f`: if `d_f <= t_m` the flag is due at the dequeue and wins; if `d_f > t_m` the mate commits first and wins. This is exactly "whichever event the server committed first", because **due flags are always committed before the action of the same step**.
- **The tie-break (the only rule in this spec with no source).** Two flag deadlines equal to the millisecond: (1) **the player whose clock started running at the lower global `seq` loses** (they have been on the move longer in the server's total order); (2) if both clocks started at the same `seq` (possible only at `seq` 0, before any commit), **the board whose index equals the room's creation number modulo 2 loses (A = 0, B = 1)** - deterministic, replayable, and unbiased across rooms: no team, colour or seat is systematically disadvantaged. No draw is ever needed.
- **Result model:** `MatchResult = { winnerTeam: 1 | 2, reason: 'checkmate' | 'flag' | 'resign', board: 'A' | 'B', loserSeat }` or `{ voided: true, reason: 'abandoned' }` (rule 22). **No draw value exists in the type.**
- Increment (when the control has one) goes to the mover of the board where the action happened, after the action. A player who cannot act (`stuck`) simply loses time; there is no "pass".
- Per-board timers are re-armed after every commit on that board; a fired timer is just an input to `settle`.

**Tests.** Pure tests of `settle`: one flag; two due flags (the earlier deadline loses even if the later one's timer fired first); a flag due at the same instant as a mate on the other board, both orders; a flag one millisecond after a mate; equal deadlines resolved by rule (1); equal start `seq` resolved by rule (2) for both parities; a discarded late action never changes state; best-of-N load-robust assertions for the timers in room tests (no single wall-clock sample, AGENTS rule); mutation on the comparison operators (`<=` vs `<`), on `min`, on the tie-break order, on which board loses.

### HP3. Premoves and drop premoves (in v1, B21)

**Rules.**
- **Queue length: ONE.** A new premove replaces the old one; tapping the premove or a Cancel control removes it (the existing `usePremove` contract). A longer chain compounds invalidity after every opponent move; chaining can be added later if wanted.
- **Two intents:** a move `(from, to, promotion?)` or a drop `(piece, square)`. A drop premove can only be queued with a piece that is **in my pocket at that moment** (the chip must exist and not be greyed), on an empty square, and not on a rank-1 / rank-8 square for a pawn.
- **A premove is client-only and is never sent early.** It is resolved when the authoritative snapshot that gives me the turn arrives: it is validated against THAT snapshot (all four pockets and both boards) and, if valid, sent as an ordinary action. The server never stores a premove and so has **no premove ordering to get wrong**.
- **Why this is race-free:** while it is the opponent's turn on my board, nothing but the opponent's single move can change my board; my pocket can only GROW (my partner captures) and can shrink only through my OWN drop. So between queueing and resolving, a premove can be invalidated by the opponent's move or by the game ending - **not by a pocket race**. The validation still re-checks the pocket (defence in depth, and the one case where client and server diverge, e.g. an optimistic drop that the server refused and the client rolled back).
- **Cancellation, always with a visible reason** (a toast at the top of the board, the premove marker removed): *"the move is no longer legal"* (the position changed), *"the square is occupied"* (a drop square taken by the opponent's move), *"the piece is no longer in your pocket"* (divergence case), *"your king is in check: this drop does not answer it"* (a drop that no longer blocks), *"the game is over"* (silent). Pawn-rank and in-check rules are re-applied at resolve time.
- **Server / client ordering with the global `seq`:** each client action carries `baseSeq`, the `seq` of the snapshot it was validated against, purely for diagnostics and stale-state refusal messages; **the server's validation is against its current state, not against `baseSeq`**, and since my board cannot change while I hold the turn the two cannot disagree except through the pocket-growth case above, which is harmless.
- **Not in local pass-and-play (B23): the device changes hands every move, so a queued premove would be entered by the wrong human and shown to the one about to move**; premoves are on in Local vs bots and Online.

**Tests.** Reducer tests with: the square taken by the opponent's move; the position changing so the move is illegal; the king in check so a drop no longer answers it; the pocket diverging (optimistic drop refused); the queue replaced; Cancel; a premove resolving exactly on the snapshot that gives the turn and never before; a promotion premove; **the whole thing driven in the browser suite on two real pages** (premove a drop, the opponent takes the square, assert the notice and no action sent). Mutation on the validation order and on each cancellation reason.

### HP4. Bots: what plays a Bughouse seat

**Today.** The Crazyhouse bot plays one board with its own reserve (drops and mating drops included), ELO = chance of the best choice, ~120 ms average / ~400 ms max in self-play, client-only (needs `ChessEngine`), **no partner awareness**.

**Problems.** (a) **Server latency:** the 4-seat bots decide in 0.04-0.5 ms p99 and the repo asserts bot decisions under a 25 ms p99 budget; a synchronous 400 ms decision would stall the event loop and every other room's clocks. (b) The bot must live where the engine lives (the generated module). (c) A bot with a human partner must drop the pieces the partner captured for it.

**Solution.** v1: the Crazyhouse heuristic ported onto the shared lean engine **with a hard decision budget** (25 ms p99 per ELO tier, best-of-N; candidates capped like the existing "best six"), plus the think delay (about 450 ms, 200 ms in bullet) so the budget is invisible. Bots never use premoves and never send quick messages. Partner awareness is a later, optional step (section 7). If the budget cannot be met, the fallback is a worker thread, not a slower tick.

**Tests.** A legal action on every position over seeded games; mate in one by move and by drop; back-rank safety against a mating drop; p99 per tier; a bot golden; a clamp test (the server never trusts the returned action); a partner-human test (the bot drops a piece the human partner captured when a winning drop exists).

### HP5. Takeover, hand-back and rejoin with two boards

The 4-seat model carried over: a disconnected human's seat keeps its clock running; after the grace (45 s) a bot plays the seat (B19); the human retakes it with the stored token until the match ends; when no original human is connected the all-gone timer ends the match `voided` (rule 22); the persisted record (a third kind) restores the screen after a reload. The rejoin answer is the full snapshot (both boards, four pockets, four clocks, `seq`, the seat). A premove queued on a screen that reloads is **lost, by design** (client-only). **Tests:** in-process (each of four seats; takeover, retake, all-gone, rejoin of a finished match kept 5 minutes), real sockets, and a browser reload mid-game with two boards.

### HP6. Spectating both boards

A spectator sees **both boards** (equal size; each oriented as a player of that board would see it: Board A White at the bottom, Board B Black at the bottom, so Team 1's players face their own colour on each board), four clocks and four pockets, read-only, from the same snapshot stream (`bug_spectate_game`); the deciding board is outlined at the end; the Spectate list has a Bughouse section. **Tests:** the spectator's screens equal the server snapshot at every `seq`; a spectator cannot move; quick messages are never delivered to a spectator.

### HP7. Out of scope

Fog of War, Chess960 / Setup Chess, Atomic, Duck, Spell, Horde and every other variant are not combinable with Bughouse; no analysis, Game Review, PGN, hints or ratings (B18).

### HP8. The `stuck` player

A player in check with no legal move who could be saved by a drop (rule 18), and a player with no legal action who is not in check (rule 19), are neither mated nor stalemated by the Crazyhouse engine's definition. They get a status of their own (`stuck`), a UI line ("waiting for a piece"), and no match effect: the clock decides. **Tests:** a single slider check with and without an empty square to interpose, a knight check (real mate), a double check (real mate), a stalemate with an empty pocket; the status flips the moment a partner capture fills the pocket; the clock keeps running while `stuck`.

### HP9. Orientation, colour and board identity (found while writing v1, sharpened by S-U3)

Teammates play opposite colours and, per S-U3, **each board is shown oriented to its player's colour**, so the partner's board is seen from the other side. A pocket chip is drawn in the colour of the player who will drop it; every cell label, test id and wire field says which board it belongs to. This is the class of bug that put every online Chaturaji move on the wrong square: a helper that defaults to "the board" works until there are two. **Rule (AGENTS.md): no helper that names a square, a cell, a pocket or a clock may default to a board;** the board is a required argument (`A` / `B`), pinned by a whole-game property test like `chaturajiOnlineSquares.test.ts`, and **orientation is a property of the VIEW (which colour is at the bottom), never of the board's data**.

### HP10. Quick messages: routing, limits, abuse

**Wire.** `bug_quick { code: 0..9 }` (the client sends a code from a closed set, never text; the server rejects any other value). The server forwards `bug_quick_from { seat, code }` **to the partner's seat only** - never to opponents and never to spectators; it is not stored and not logged with content. If the partner is a bot (or the seat was taken over) the sender gets an ack saying so and nothing is delivered.
**Limits.** Per seat: at most **1 message per 1.5 s** and **8 per 10 s**; excess is refused with a short error (no queue). An identical code within 1 s is dropped. Bots never send.
**Localisation.** The code is rendered by the receiving client, so a message is never an injection vector and needs no moderation.
**Tests.** Routing (only the partner receives), codes outside 0-9 refused, the three limits, a bot partner, a spectator never receiving, a taken-over seat; the browser suite checks the toast and the clock icon on the partner's page and that the opponent's page shows nothing.

### HP11. Private rooms ("play with a friend"), abuse and how a room joins the matchmaking

See the full flow in 5.7 and the decisions in B16. **The design points that are hard parts:**
- **A pair is a group:** the matchmaker's lobby entries become "solo" or "pair"; a pair is never split; seats are assigned by team (a pair takes seats 0+3, a second pair 1+2, two solos shuffled into the free team, bots after the fill wait).
- **Code guessing.** The code format is the existing one (6 of 31 characters, about 887 million codes) with a 10-minute TTL; **the existing 2-player join has no attempt limit** (risk 8), so Bughouse adds: a failed-attempt limit **per socket (5 per 5 minutes, then a 5-minute cooldown), per user (10 per 15 minutes) and per IP (30 per 15 minutes)**; **one identical error** for unknown / expired / full / started ("that code was not found or has expired"), so the response is no oracle; a code is **consumed** when the match starts and invalid after expiry; **one open room per user** and a process-wide cap (for example 500); codes never appear in logs; **both host and friend must be logged in** (see question Q2).
- **Lifetime:** in memory, expiry swept every 5 minutes (as the challenge manager); a host disconnect closes the room; a friend disconnect frees the friend seat and keeps the room.
**Tests.** The limiter (each of the three scopes, the cooldown, the identical error), expiry, one-room-per-user, the cap, host / friend leaving at each stage, a pair in the queue whose member disconnects, pair + pair / pair + solos / pair + bots assignments (every shuffle enumerated like the existing matchmaker test), and the browser flow with two real pages.

---

## 5. UI - screens and layout

### 5.1 Phone portrait (primary target; checked at 360 x 640 and 412 x 915 like Chaturaji) - B13

Budget at 360 x 640: Chaturaji needs about 345 px of chrome around an 8 x 8 board and gets 36 px cells (288 px); two full boards cannot fit. Layout:
- **Own board large** (about 36 px cells at 360 x 640, 49 px at 412 x 915; a cell-size function pinned for both sizes, like `getChaturajiCellSize`), **my colour at the bottom**.
- **Partner board as a thumbnail** (8 x 12 px cells, about 96 px) in a strip with the partner's clock, the partner's opponent's clock and the pocket chips of that board, **oriented to the PARTNER's colour** (so when I am White the thumbnail shows Black at the bottom, S-U3). **Tap swaps** the thumbnail and the main board; after a swap the partner's board is the large one, still partner-oriented, and a "Your board" thumbnail takes the strip. The thumbnail is read-only and never a drop target.
- **Four clocks:** mine and my opponent's next to the main board, the partner's and the partner's opponent's in the strip. **Pockets:** the `ReserveTray` idea (a fixed-height row under the board: mine one side, the opponent's the other, chips with counts, promoted pieces with the `~`) plus a compact chip row in the strip; only MY chips are tappable, only on my turn.
- **Drop interaction is Crazyhouse's:** tap a chip (it lifts), the legal squares highlight, tap one - one tap pair. **Premove variant:** on the opponent's turn the same two taps queue a premove (5.5). A **"waiting for a piece"** line shows in `stuck` (HP8). **Controls row:** Resign, Chat, Quick, Rules, Rotate.
- **Game over:** both boards shown (the deciding board outlined: "Board A - checkmate", "flag", "resigned"), the winning team named, four clocks, a per-player line; Play again re-queues at the same time control.

### 5.2 Tablet / landscape (B13)

**Two boards side by side, the same size** (each at least 40 px cells, so about 700 px of width), as in S-U3, with clocks above / below each board and pockets between and under; **each board is oriented to its player's colour** - my board White at the bottom (when I am White), the partner's Black at the bottom. The swap gesture is not needed. One cell-size function returns the one size for both boards. A spectator sees the same layout (HP6).

### 5.3 The team badge (B13, S-U3) - our own design

A **small vector badge on each of my team's two kings** (mine and my partner's), in both layouts and in the thumbnail: a filled diamond in the cell's top-right corner, drawn from our own shapes and colours (not chess.com's asset). Sizes: about 8 px on 49 px cells, 6 px on 36 px cells, 3 px on thumbnail cells; it is **shape-coded as well as colour-coded** (a spectator sees two badge shapes, a diamond for Team 1 and a circle for Team 2, because they have no "my team"), and every king cell's accessible label ends with ", your team" / ", Team 1" / ", Team 2". The opponents' kings carry no badge for a player (spectators see both). Pinned by a rendered test per layout and by the whole-game board-identity property test.

### 5.4 Quick messages (B14) - the set

**Eight buttons** in a 2 x 4 grid opened from the controls row (Quick), each one tap, partner-only (HP10):
1. **Need a knight** 2. **Need a bishop** 3. **Need a rook** 4. **Need a queen** 5. **Don't trade** 6. **Trade!** 7. **Sit / wait** 8. **Hurry!**
Codes `0..9`, so two more can be added without a protocol change: `Need a pawn` and `Watch your king` (reserved, off in v1; they are the ten examples the brief listed - trimmed to eight to keep the grid thumb-sized).
**On the partner's screen:** a **non-blocking toast** at the top edge (about 2.5 s, no tap needed, never over a board's squares, `pointerEvents` off) plus **an icon with the message on the partner's clock for 8 s**; a light haptic on native; no sound by default. **Short rate limit** (HP10). Opponents and spectators never see it. Free-text chat stays as it is (Q1).

### 5.5 Premove UI (B21)

On the opponent's turn the board accepts the same taps as on mine: a move premove draws an arrow and a ghost piece in a distinct premove colour (as the 4-seat boards do); a **drop premove** shows the ghost piece on the square and the chip stays marked "premove". **One at a time:** a new tap sequence replaces it, tapping the ghost or a **Cancel** chip clears it. A cancellation shows a **visible toast with the reason** (HP3) and the marker disappears. Premoves are off in local pass-and-play (B23).

### 5.6 Local screens (B15, B23)

**(a) One human + three bots:** the standard layout of 5.1 / 5.2. Setup: which seat (board / colour) the human takes, the three bots' ELO (default the same), the time control. Premoves on.

**(b) Two humans on one device + two bots (B23).** *Recommended: the two humans are OPPONENTS on the same board (pass-and-play), the bots play the other board and are their partners.* So: human 1 = seat 0 (A White), human 2 = seat 1 (A Black); bot partners are seat 3 (B Black, human 1's partner) and seat 2 (B White, human 2's partner). **Screen:** board A large and shared (the layout of 5.1; on tablet 5.2 with board A and board B equal), board B as the thumbnail; four clocks; four pockets. **Input:** turn-based - **only the side to move is allowed to tap** (the other human's taps are ignored), no simultaneous touches, no multi-touch. **Hand-over:** after each move the board turns to face the side to move (`orientation` follows the turn - the existing 2-player local screen already has a flipped / orientation state), with a switch to keep it fixed; there is no hidden information, so no "pass the device" cover screen is needed - a clear "Black to move" banner and the turned board are the hand-over. **Clocks:** each human's own clock runs only on their turn on board A, the bots' clocks run on board B simultaneously, so the pressure is real; the match ends as always when any clock flags or any board ends. **Pockets:** the side to move's pocket is the interactive one; each human's pocket is fed by THEIR bot partner's captures on board B. **Premoves: off** (HP3). **Teammates option (not recommended for v1, available on tablet / landscape only):** each human owns one board of the side-by-side layout, simultaneous input, each board oriented to its owner's colour - see B23 and the estimate.

### 5.7 Friend rooms (B16) - screens and flow

*Proposed - confirm (the design is mine, the requirement is the user's).*
1. **Create:** Play menu > Bughouse > **Play with a friend** > time control (the six) > the **Room screen**: a large **6-character code** (the existing alphabet, no 0 / O / 1 / I / L), **Copy**, **Share** (the native share sheet; on web the clipboard plus an invite link `<app URL>/bughouse/join/<code>`), the two team slots (**You** / **Friend: waiting**), the expiry countdown (**10 minutes** from creation), and the buttons **Find opponents**, **Start with bots**, **Close room**. A **Friend leaves** or **Close** returns everyone to the menu with a message.
2. **Join:** Play menu > Bughouse > **Join with a code** (or the invite link, when logged in) > a code field (auto-upper-case, only the 31 allowed characters, paste accepted) > **Join**. Success shows the room ("Room of <host>: you are teammates"), the time control, and **Leave**. Failure shows the one identical message ("That code was not found or has expired") whatever the reason; after repeated failures the limiter's cooldown message.
3. **Start:** when both friends are in, the host chooses: **Start with bots** (the two bots fill the opposing team at once; seats 0+3 are the friends), or **Find opponents**, which **enters the matchmaking as a pair** (below); the friend's screen follows the host's choice and shows the same queue screen.
4. **Matchmaking with a pair:** the pair is one lobby entry in the time control's Bughouse lobby. It counts as **two humans immediately**, so the 30 s fill countdown starts when it enters (a pair never waits indefinitely like a lone human). Seats: the pair takes seats 0+3; two solos (shuffled) take 1+2; a second pair takes 1+2; after the fill wait free seats of the opposing team are filled by bots (the friends are never split and never partnered with a bot). When two pairs are waiting, the one waiting longer takes 0+3.
5. **Expiry and leaving:** the room code is valid **10 minutes** from creation until the match starts, after which it is consumed; a **host disconnect closes** the room; a **friend who leaves before the start frees the friend slot** (the code stays valid; the host may share it again or press **Find a match** alone, which becomes a normal solo queue entry); if a pair is already in the matchmaking and one friend disconnects, **the pair entry is cancelled** and the remaining friend returns to the room screen with the slot free; both leaving deletes the room. Once the match has started, the code no longer works and normal takeover / rejoin rules apply (HP5).
6. **Errors:** expired, full, closed, "you already have an open room", offline; each a single clear line.

### 5.8 Menu, setup, queue, spectate

**Play menu:** a "Bughouse" card with **Local**, **Online**, **Play with a friend**, **Join with a code**, a "How to play" sheet (built from the engine's constants, like the Chaturaji one) and the "Return to your game" link. **Queue screen** with the fill countdown (the 4-seat text). **Spectate list:** a "Bughouse" section with the four names grouped by team.

### 5.9 Accessibility and tests

Every cell label carries the board ("e4, board A, Red knight"), every clock, pocket chip, quick-message button and badge has a label, and test ids are board-qualified (`A-e4`, `pocket-B-black-n`). The `dom` project renders the real screens; the browser suite checks 360 x 640 and 412 x 915 for overflow and clipped text, both themes, and the dev server (not only the export).

---

## 6. DECISIONS

**All B1-B22 are RESOLVED by the user (20/10). B23 is new. Items marked *PROPOSED* are my design inside a resolved decision and need a yes.**

**B1. 2nd-rank pawn drop: two-square first move and en passant? - RESOLVED: yes.** Sources S1, S2, S3 (the existing engine already does it).
**B2. A captured promoted piece goes to the pocket as a pawn? - RESOLVED: confirmed.** S-U1, S1, S2, S3, R.
**B3. Drops may give check / mate? - RESOLVED: yes.** S-U1, S2, S3.
**B4. A check a drop could block with an empty pocket: mate? - RESOLVED: not mate; the player waits.** S1; nothing in S-U1 contradicts it (S-U1 adds that no move or drop may leave your own king in check: rule 13).
**B5. Stalemate / no legal action: - RESOLVED: the player waits; the clock decides.** Consistent with S-U2 "no draws".
**B6. A rook dropped on a home square regains castling? - RESOLVED: no.**
**B7. The match ends the moment any board ends? - RESOLVED: yes.** S-U1, S1, S2, S3 and chess.com's glossary. **Online, an "illegal move" ending does not apply**: illegal requests are rejected, never played (rule 21).
**B8. Simultaneous flags / flag against mate - RESOLVED (CHANGED from v1 because of S-U2 "no draws"):** the player whose flag fell earlier by authoritative server time loses; a flag against a checkmate is whichever the server committed first (due flags are committed before the action in the same step); comparison = remaining time at the deadline, integer milliseconds, one clock source for all four clocks (rule 25, HP2). **Tie-break chosen (the ONLY rule in this spec with no source):** (1) the player whose clock started running at the lower global `seq` loses; (2) at `seq` 0, the board whose index equals the room's creation number modulo 2 loses. The result model has **no draw**; its only non-win outcome is `voided` (no human left), which is not a draw.
**B9. Draw offers / abort - RESOLVED: none.** (S-U2.)
**B10. Repetition and the fifty-move rule - RESOLVED: none.** (S-U2.)
**B11. Time controls - RESOLVED: 1, 2 | 1, 3, 3 | 2, 5, 5 | 2.** 10 minutes dropped: S-U1 says blitz, typically 3-5 minutes.
**B12. Clocks - RESOLVED: all start together, no grace.** S-U1.
**B13. Layouts - RESOLVED:** phone portrait = own board large + partner thumbnail with tap-to-swap; tablet / landscape = two equal boards side by side (S-U3). In BOTH: the partner's board is oriented to the partner's colour (S-U3) and the teammates' kings carry a team badge (S-U3; our own design). Section 5.1-5.3.
**B14. Chat and quick messages - RESOLVED: the existing chat PLUS quick messages in v1.** *PROPOSED set:* Need a knight / bishop / rook / queen, Don't trade, Trade!, Sit / wait, Hurry! (eight; codes 0-9 reserved for ten; partner-only; a closed code set; 1 per 1.5 s and 8 per 10 s; a non-blocking toast plus an icon near the partner's clock). Section 5.4, HP10.
**B15. Local mode - RESOLVED: BOTH (a) 1 human + 3 bots and (b) 2 humans on one device + 2 bots.** (b) is B23.
**B16. Online play - RESOLVED: BOTH a solo queue with a random partner and play with a friend (private room, invite code, the friends are teammates; the other seats from the queue or bots after the fill wait).** *PROPOSED design:* 5.7 and HP11 (code format and 10-minute expiry reused from the 2-player challenges; a friend pair is one matchmaking entry; attempt limits that the 2-player flow lacks).
**B17. Bots, fill and takeover - RESOLVED: as the 4-seat games (>= 2 humans, 30 s fill, takeover after 45 s); in a friend room the friends stay teammates and bots fill the opposing team if needed.**
**B18. Ratings and history - RESOLVED: none.**
**B19. Partner disconnect - RESOLVED: a bot takes the seat after the grace, then hand-back on return.**
**B20. Seat map - RESOLVED: fixed (rule 2); random shuffle in the solo queue; in a friend room the friends are seats 0 + 3.**
**B21. Premoves - RESOLVED: premoves AND drop premoves in v1.** *PROPOSED rules:* queue length **one**; client-only, resolved against the authoritative snapshot that gives me the turn; a visible reason on every cancellation; off in local pass-and-play. Section 5.5, HP3.
**B22. Spectators and a finished match - RESOLVED: both boards for spectators; the result kept 5 minutes for a late rejoin.**

**B23 (NEW). Local mode (b): two humans on one device - how are they placed?**
- **(i) Teammates:** each human owns one board, the two boards on the same screen in a split layout, the partner's board never hidden; both humans play AT THE SAME TIME (their partner-opponents are the bots).
  *Screen / input:* only workable on tablet / landscape (two boards at 40+ px cells, about 700 px wide) with the two humans sitting side by side; each board is oriented to its owner's colour; **each human taps only their own board** (a per-board touch responder; touches that start on the other board are ignored); clocks under each board; premoves allowed. *Risks:* two people on one glass at bughouse speed (accidental touches, multi-touch on web and on React Native, hands covering the partner's board); portrait phones cannot show it at a usable size; the browser suite cannot drive true simultaneous multi-touch.
- **(ii) Opponents on the same board (pass-and-play):** the two humans play each other on board A, bots play board B and are their partners (section 5.6).
  *Screen / input:* one shared board, turn-based, the board turns to the side to move, only the side to move may tap, no hidden information; works in portrait, uses the existing local flip logic; premoves off.
**Recommended: (ii).** It is the only option that works on a phone, has no simultaneous-touch problem, reuses the local 2-player screen's logic, and every part of it can be tested without multi-touch. (i) is what "two friends on a tablet" would want: offered as an **optional later cycle, tablet / landscape only**.
*If (i) is chosen instead (or added):* +4-5 working days (per-board responders, simultaneous clocks on one screen, a split layout, conflict tests) and the phone cannot offer mode (b) at all.

---

## 7. WORKSTREAMS W0-W9 (branch `paired/bughouse` in both repos, from `master` / `main`)

Each row is a vertical slice with a stop-and-review. **Gates on every workstream:** `tsc` clean; the frontend suite and every backend suite green at their counts; **the existing goldens byte-identical (FFA, Giveaway, Chaturaji, geometry, and the new Crazyhouse golden from W0)**; `sync:fourplayer --check` and the new mirror's check; mutation on the new non-visual logic in **chunks of at most ~20 mutants / 20 minutes, a hard timeout per mutant, one at a time, results outside the repo**, every survivor killed or proven equivalent with a test (AGENTS.md); a docs entry per workstream. **Lessons from AGENTS.md from the first line:** no helper names a square, cell, pocket or clock without the board as a required argument (HP9); constants checked by mutation-targeted tests are literals; test-only switches follow CHECKLIST section 7 (opt-in, ignored under production with one value-less warning, validated, set only by the e2e stack); no wall-clock assertions (best-of-N or structural), seeded randomness, fake timers in rendered tests; **the dev web path is checked, not only the export** (`expo export` bakes the production bundle, which talks to Render; every UI slice is also run once against the dev server with `EXPO_PUBLIC_API_URL`).

| | Slice | Scope and gates specific to it | Days |
|---|---|---|---|
| **W0** | **Foundations, no behaviour change.** (1) The mutation harness into the repo (`scripts/mutation/`, a README, an example config). (2) A **Crazyhouse golden** recorded on master BEFORE `crazyhouse.ts` is touched. (3) New exports in `crazyhouse.ts` (bank-to-partner, "can a drop ever help") with the verbatim backend mirror and `test-crazyhouse.mjs`. (4) The new mirror module family with its manifest and generator check, empty engine skeleton. | Crazyhouse golden, `crazyhouse*.test.ts`, oracle and `test-crazyhouse.mjs` unchanged; mirror in sync; `legalDrops` benchmark before / after. | **2-2.5** |
| **W1** | **The engine (pure, mirrored).** `BughouseMatch` (two boards, four pockets, promoted marks, seat map), `applyAction`, the `stuck` status, **the pure `settle` (HP2: deadlines, due flags first, the tie-break) and the result model without a draw (`voided`)**, the text snapshot, legal-action lists per seat, premove-resolution validation as a pure function (HP3), scripted positions for every rule of section 1, the reference model for transfers, differential tests per board against `ChessEngine` and the chessops oracle, the conservation property test, a Bughouse golden, the generated server copy. | Oracle agrees per board; the invariant over 500+ seeded interleavings; every `settle` case of HP2; snapshot round-trip; mutation chunks over transfer, status, settlement, result, drop legality, snapshot. | **5.5-6.5** |
| **W2** | **Server game loop, bots and quick messages (server side), in-process.** `BughouseRoomManager` (funnel, one `seq`, two clock timers on the monotonic source, per-board bot timers, rate limit, takeover / retake, all-gone `voided`, rejoin of a live and a finished match, spectate, chat), the second matchmaker instance, `bug_*` handlers and wire, **`bug_quick` routing and limits (HP10)**, the Bughouse bot with its decision budget (HP4), config names, a compatibility matrix with the four 4-seat suites unchanged. | HP1 / HP2 / HP5 / HP10 scenarios on stub sockets and fake timers; bot p99 per tier; bot golden; the 4-seat suites unchanged. | **7-8.5** |
| **W3** | **Local screens (B15, B23): vs bots AND two humans pass-and-play.** Play-menu card, setup for both, the two-board screen in **both layouts (B13)** with per-board orientation and the **team badge**, four clocks, four pockets, drop tap-pair, `stuck` line, board turning to the side to move (b), result with both boards, rules sheet; the cell-size function at 360 x 640 and 412 x 915; board-qualified labels and test ids; rendered tests; a browser pass on the dev server at both sizes and both themes. | Rendered tests for every state; layout assertions; the whole-game property test that no UI helper defaults to a board; orientation / badge tests per layout. | **7-8.5** (of which pass-and-play + hand-over about 2.5-3; the teammates option (i) is NOT included) |
| **W4** | **Online client, spectator, rejoin, quick-message UI.** Reducer / session / UI-logic twins, queue screen, online game in both layouts, spectator screen, Spectate list section, the third `ActiveOnlineGame` kind, resume link, the **Quick** grid, toast and clock icon; rendered tests with a server simulator on the real engine (restore after rejoin, optimistic drop and rollback, takeover badge, thumbnail follows the stream, a quick message arriving). | Reducer tests incl. a refused drop and a late snapshot; the persisted-rejoin restart test; mutation on the reducer. | **5.5-6.5** |
| **W5** | **Premoves and drop premoves (B21).** The one-deep premove (moves and drops) with authoritative resolution, cancellation reasons and toasts, the premove marker / ghost UI, the pocket-divergence case, off in pass-and-play; reducer tests; extends `usePremove`; a browser scenario on two real pages. | Every cancellation reason tested; "never sent early" asserted at the socket level; mutation on validation order. | **3-3.5** |
| **W6** | **Friend rooms (B16).** The private-room manager (create / join / leave / start / expiry / sweep), the attempt limiter (per socket, user and IP; the identical error; one room per user; a global cap), **groups in the matchmaker** (a pair is never split; team-aware seat assignment; the fill clock at once), the Room / Join / pair-queue screens, the invite link, the native share and web clipboard paths; tests for every limiter scope and every leaving case; a **guarded test-only switch** for the browser suite if it needs to shorten the expiry (CHECKLIST section 7). | Limiter tests for each scope; every seat-assignment shuffle enumerated; real-socket cases for pair + pair, pair + solos, pair + bots, a pair broken in the queue; mutation on the limiter, the groups and the expiry. | **4.5-5.5** |
| **W7** | **Real sockets.** Real-socket e2e scenarios (a whole natural game with four clients and a spectator; a capture / drop race; resign; a flag on each board; a flag against a mate; takeover and retake on each seat; spectator; quick messages routing; lobbies never mix with the four other variants; persisted rejoin from a new process), a fixed total of checks (conditional checks counted apart), the nightly fuzz section, CI / nightly wiring. | Total fixed over three runs; fuzz 40+ games, 0 issues; the other variants' counts unchanged. | **3.5-4** |
| **W8** | **Browser end-to-end.** Scenarios in `backend/scripts/e2e-browser`: four users, ten rounds with every screen of both boards compared with the server after every action; capture-then-drop across boards; `stuck`; a flag; **orientation and badge on both layouts**; **quick messages**; **premove drop cancelled by the opponent's move**; **the friend flow with two real pages (create, code, join, start with bots, find opponents as a pair)**; **local pass-and-play**; takeover and hand-back; reload; spectator; the five variants never mixing; layout at both sizes; touch; a constructed start position through a guarded start-position switch (a Bughouse snapshot kind) to reach promotion / a counterfeit / a drop mate. | 3 of 3 consecutive runs and one under CPU load on the final commit, retries <= 1 per scenario and <= 2 per run, the dev web path exercised. | **4-5** |
| **W9** | **Close-out and merge readiness.** Docs roll-up (both TESTING.md, CHECKLIST, TODO, AGENTS), the final mutation re-run over everything Bughouse touched (per chunk: mutants / killed / equivalents with one-line proofs / time), the full gates, squash to logical commits, CI green on the exact commits, merge steps. | As the Chaturaji close-out. | **2.5-3** |

**Total: about 44-54 working days across ten stop-and-review cycles** (v1: 31-36 across eight; the difference is friend rooms 4.5-5.5, premoves 3-3.5, quick messages about 1.5-2 now inside W2 / W4, the second local mode and the two layouts with orientation and badge about 4-5, and the no-draw settlement and its tests about 0.5-1). For scale: Chaturaji was estimated at 9-12 days and its test and close-out load exceeded the estimate.
**Optional, outside the estimate:** B23(i) teammates on one tablet 4-5 d; a partner-aware bot 3-4 d; a team-only free-text chat 1-1.5 d (Q1); the two reserved quick messages 0.3 d; chained premoves 1.5-2 d; a team rating (not sized).

---

## 8. RISKS AND OPEN QUESTIONS

1. **The one rule without a source is the flag tie-break (B8).** It is deterministic and unbiased and only matters at an exact millisecond (or at `seq` 0); if you would rather see a different one (for example always the board with the lower index), it is a three-line change in `settle`.
2. **The server needs an engine and a bot.** The mobile app's `ChessEngine` and bots are client-only; the backend has a separately maintained twin without bots; the generated module removes the drift risk but is the largest new piece of tooling.
3. **Bot decision cost.** The measured ~120 ms average / ~400 ms max is not acceptable synchronously on the server; the 25 ms p99 gate may force a weaker first bot or a worker thread. The v1 bot is a shallow heuristic: no partner awareness, no premoves, no quick messages.
4. **No external oracle** for the transfers and the match logic: they rely on an independent reference model and the conservation invariant.
5. **Two boards on a phone.** The 96 px thumbnail shows who-is-where and pockets, not deep tactics; the swap is the safety valve. Needs the real browser pass and ideally a real phone (the Chaturaji suite only emulated touch).
6. **Latency and fairness.** Server-authoritative clocks without lag compensation favour low-latency players; with four real-time participants this is more visible; the same policy as today, stated so it is a choice.
7. **Two humans on one screen (new, B15 / B23).** (ii) is turn-based and low-risk; (i) brings simultaneous touches (accidental taps, multi-touch on web and React Native, hands covering the partner's board) and cannot be driven by the browser suite as true multi-touch. (ii) also needs a hand-over that is unmistakable (the board turning, a banner) so the wrong human does not move.
8. **Private rooms and abuse (new, B16).** A 6-character code from 31 letters (about 887 million) with a 10-minute life is guessable at network speed **if there is no attempt limit - and the existing 2-player `join_challenge` has none** (only the HTTP routes are rate-limited; a socket event is not). This is **a finding outside the scope of this spec**: I recommend a separate small fix for the 2-player flow (the same limiter as HP11) and have not touched it. Further risks of rooms: an unlimited number of open rooms (memory; capped), invite-link phishing / spam (a link opens an app screen that needs a login and shows the host's name), a host holding a room open (10-minute life, one room per user), a friend slot squatted by a stranger who guessed the code (the host sees who joined and can **Close**).
9. **Premove-drop races (new, B21).** The design removes server-side races (client-only, resolved at the turn, validated by the server against its own state) and the analysis in HP3 shows pocket changes cannot invalidate a premove between queueing and resolving; the residual risks are **client / server divergence after an optimistic drop is refused** and **UI confusion about which action is queued**; both are covered by reducer and browser tests.
10. **Quick messages (new, B14).** Closed codes, partner-only, rate-limited, no text: the abuse surface is spam (limited); the open point is accessibility (a toast must not be the only channel: it has the clock icon and an accessible live-region line).
11. **Matchmaking with groups is new complexity (new, B16).** Pair + solo + bot mixes and a pair broken mid-queue are the places bugs will hide; every shuffle must be enumerated in tests, as the existing matchmaker's are.
12. **Server load.** A room has two clock timers, up to four bot timers and a snapshot twice the size of a 2-player one per action; W2 must measure snapshot bytes and CPU per room, and say how many rooms one Render instance carries (no 4-seat game has such a number).
13. **State is in memory,** as for the 4-seat games: a restart ends every match, and rooms vanish. Longer matches make that more painful.
14. **The browser suite is nightly only** (about 7 minutes today); four users, ten rounds, the friend flow and pass-and-play will lengthen it; W8 must re-check the budget and the retry policy.
15. **Naming and branding.** No chess.com text, graphics or branding is copied; the badge, the quick-message icons and the rules sheet are our own. S-U3 is a description, not an asset.
16. **The estimate is a planning figure** that assumes the same discipline (goldens, mutation, browser suite) as Chaturaji.

### Open questions (new in v2; each has a default I will build unless you say otherwise)

- **Q1. Free-text chat audience.** Today's 4-seat chat goes to all four seats. Default: **reuse it as is in v1**, and quick messages are partner-only. If you want free text to be team-only: +1-1.5 days (a team channel on the server and a "Team / All" switch).
- **Q2. Must friend-room hosts and friends be logged in?** Default: **yes** (the limiter and the one-room-per-user rule need an identity; the 4-seat queue itself allows guests today). If guests must be allowed in a friend room, the limits can only be per socket and per IP.
- **Q3. Pair against pair: which pair takes seats 0+3?** Default: **the pair that has waited longer** (so seats are assigned by arrival, never by colour preference); friends cannot choose White. Confirm, or ask for a "swap colours" button inside the room (+0.5 day).
- **Q4. Do you also want the teammates mode (B23 i) for tablets?** Default: **no, not in this plan** (+4-5 days if yes).
- **Q5. Invite-link format and the native share:** the web link `<app URL>/bughouse/join/<code>` and the native share sheet are in the design; **a native deep link scheme** (so a tapped link opens the installed app) needs the app's URL scheme / domain decided. Default: web link plus code entry, native deep link later.
- **Q6. chess.com's glossary page says a draw can be agreed** (an over-the-board allowance) while S-U2 says there are no draws. Default: **follow your B9 / S-U2: no draws at all**; say if you want agreed draws.
- **Q7. Quick messages: `Need a pawn` and `Watch your king`** are reserved (codes 8-9) but off in v1; say if you want them on (the grid becomes 2 x 5).

**Needed before W0:** nothing is blocking now - every B1-B23 has an answer or a default. Questions Q1-Q7 have defaults and can be answered at any time before the workstream that uses them (Q1 before W2, Q2-Q3 and Q5 before W6, Q4 before W3, Q6-Q7 before W4).
