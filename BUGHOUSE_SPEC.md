# Bughouse (Doubles) - specification and decision list, v3

Status: **DRAFT v3, decisions final (2026-10-20). Spec only: no game code, no engine change.** Written per CHECKLIST.md ("spec before code") in the shape of `CHATURAJI_SPEC.md`. Covers both repos: frontend `EM-Chess` and backend `chess-app-backend` (`backend/`). Nothing here is built; every "exists today" statement was checked against the code on `master` / `main` after the Chaturaji merge.

**What Bughouse is (the user's brief):** two teams of two, two boards played at the same time, teammates play opposite colours, a piece a player captures goes to their partner's pocket (the partner may drop it instead of moving), each player has their own clock, and the whole match ends as soon as any board ends.

## 0. v3 changes (what is different from v2, `6ec2f1b`)

1. **B23 CHANGED: Local mode is ONE seat model, the same as the existing Local setups of 4 Player Chess, 4 Player Giveaway and Chaturaji** (`FourPlayerSetupScreen`: each of the four seats is Human or Bot, bots from the app's ELO roster). It replaces v2's "(a) 1 human + 3 bots / (b) 2 humans" split: **any combination is allowed**, including two humans as opponents, two humans as teammates, and three or four humans. The screen is **derived from where the humans sit**: (1) all humans on ONE board = pass-and-play on that board, the other board a thumbnail; (2) humans on BOTH boards = **both boards playable at the same time**, stacked at equal size in portrait, side by side in landscape / tablet, each oriented to the colour of the human playing it (a board with both colours human uses pass-and-play rules). **Minimum size for layout (2): 28 px cells = 240 x 736 portrait or 472 x 352 landscape**; below it the setup screen says so instead of showing a broken layout (5.6). Premoves are off whenever two or more humans share the device. The setup re-uses the existing 4-seat setup component and pattern with explicit board / colour / team labels.
2. **New hard part HP12 - and a correction of v2.** The board's input today is ONE `PanResponder` per board (`src/components/useBoardGestures.ts`) and the app has no gesture-handler dependency; React Native's (and react-native-web's) responder system grants **one responder at a time**, so **two boards played with two fingers do NOT work with the existing input**: a touch on board B would be ignored or would steal the responder and cancel board A's selection. The design (HP12) is a per-board **raw-touch input layer** keyed by touch identifier, with a go / no-go spike first and a stated fallback. v2's risk 7 said the browser suite cannot drive true multi-touch: **corrected** - it can, through a CDP session (`Input.dispatchTouchEvent` with two touch points); `touchscreen.tap` alone is single-touch.
3. **Q1 CHANGED: free-text chat is TEAM-ONLY in Bughouse rooms**, enforced **by the server** (only the partner receives it; opponents and spectators never do). Bughouse gets its own chat event; the 4-recipient wiring of the other 4-seat variants is not touched (HP10). **+1-1.5 days**, inside W2 and W4.
4. **Q7: both extra quick messages are ON: ten in total, codes 0-9** (the grid is 2 x 5).
5. **Defaults accepted:** Q2 login is required for friend rooms; Q3 pair against pair - the pair that has waited longer takes seats 0 + 3; Q4 is superseded by the new B23; Q5 web link + code entry, native deep link later; Q6 no draws at all (B9 and S-U2 stand over chess.com's terms page).
6. **Workstreams re-planned:** **W3 is split into W3a (Local core and the seat model) and W3b (Local with humans on both boards: simultaneous multi-touch)**; team chat is added to W2 / W4; the CDP multi-touch scenario to W8. **Total re-estimated: about 54-65 working days over eleven cycles** (v2: 44-54 over ten).
7. **Risks added** (section 8): simultaneous multi-touch on one phone (the input-layer risk, accidental touches, hands over the other board), rotating the device mid-game below the minimum size, local clocks that keep running, and the setup combinations that cannot be shown on a small phone.

## 0b. v2 changes (what was different from v1, `969ee7d`)

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
27. **Partners may talk freely** [S-U1]: in this app **the free-text chat and the quick messages are both TEAM-ONLY** - only the partner receives either; opponents and spectators never do, and **the server enforces it** (B14, Q1, HP10).

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
| Chat panel and the server's chat | `src/components/FourPlayerChatPanel.tsx`; `FourRoomManager.sendChat` (broadcasts to all four seats and the spectators; rate-limited) | **Panel: reuse with a "Team chat - only your partner sees this" label. Server: NEW `bug_chat` in the Bughouse manager that delivers to the sender and the partner only; the 4-seat `sendChat` and its wiring are not touched.** |
| **Friend invite codes (2-player)**: 6 characters from a 31-letter alphabet without 0 / O / 1 / I / L, a 10-minute TTL, a sweep, one code per creator, removed when the creator disconnects | `backend/src/game/challenges.ts`, the `create_challenge` / `join_challenge` handlers in `socketHandlers.ts` | **Reuse the code format, TTL and sweep; new lobby logic** (a Bughouse room has up to four seats and groups). **The existing join has no attempt limit** (risk 8): the Bughouse version must. |
| **Premove hook**: ONE premove at a time, a new one replaces the old, a Cancel drops it, a cancellation reason | `src/logic/usePremove.ts`, `premove.ts` (used by the 4-seat and bot screens; the 2-player online screen has its own inline copy and disables premoves in Crazyhouse) | **Extend** with drop intents. |
| Local pass-and-play board flip | `src/screens/LocalGameScreen.tsx` (`flipped` / `orientation`) | **Reuse the idea** for B23 (the board turns to the side to move). |
| **Local seat model** (B23): a `SeatConfig` of four seats, each Human or Bot, bots from the named roster (`DEFAULT_BOT_ELO`, `withController`, `isStartable`, `botDisplayName`, the "Select a Bot" picker via `onPickBot`) | `src/screens/FourPlayerSetupScreen.tsx` and `src/logic/fourPlayer/setup.ts` (the pattern all three 4-seat Local setups use) | **Reuse the component pattern and the seat model; extend** with board / colour / team labels and the screen-size gate. |
| **Board touch input** (a `PanResponder` per board: tap, long-press arrows) | `src/components/useBoardGestures.ts` | **Cannot serve two boards played at the same time** (one responder at a time); a per-board raw-touch layer is **new** (HP12). Fine for every single-board screen. |
| Play-menu cards, resume link | `PlayModeSelectScreen.tsx` | **Extend.** |

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
- **Off in Local whenever two or more humans share the device (B23):** on a pass-and-play board the device changes hands every move, so a queued premove would be entered by the wrong human and shown to the one about to move, and on two boards played at once a premove tap would compete with the other player's live touches; premoves are on in Local with exactly one human and in Online.

**Tests.** Reducer tests with: the square taken by the opponent's move; the position changing so the move is illegal; the king in check so a drop no longer answers it; the pocket diverging (optimistic drop refused); the queue replaced; Cancel; a premove resolving exactly on the snapshot that gives the turn and never before; a promotion premove; **the whole thing driven in the browser suite on two real pages** (premove a drop, the opponent takes the square, assert the notice and no action sent). Mutation on the validation order and on each cancellation reason.

### HP4. Bots: what plays a Bughouse seat

**Today.** The Crazyhouse bot plays one board with its own reserve (drops and mating drops included), ELO = chance of the best choice, ~120 ms average / ~400 ms max in self-play, client-only (needs `ChessEngine`), **no partner awareness**.

**Problems.** (a) **Server latency:** the 4-seat bots decide in 0.04-0.5 ms p99 and the repo asserts bot decisions under a 25 ms p99 budget; a synchronous 400 ms decision would stall the event loop and every other room's clocks. (b) The bot must live where the engine lives (the generated module). (c) A bot with a human partner must drop the pieces the partner captured for it.

**Solution.** v1: the Crazyhouse heuristic ported onto the shared lean engine **with a hard decision budget** (25 ms p99 per ELO tier, best-of-N; candidates capped like the existing "best six"), plus the think delay (about 450 ms, 200 ms in bullet) so the budget is invisible. Bots never use premoves and never send quick messages. Partner awareness is a later, optional step (section 7). If the budget cannot be met, the fallback is a worker thread, not a slower tick.

**Tests.** A legal action on every position over seeded games; mate in one by move and by drop; back-rank safety against a mating drop; p99 per tier; a bot golden; a clamp test (the server never trusts the returned action); a partner-human test (the bot drops a piece the human partner captured when a winning drop exists).

### HP5. Takeover, hand-back and rejoin with two boards

The 4-seat model carried over: a disconnected human's seat keeps its clock running; after the grace (45 s) a bot plays the seat (B19); the human retakes it with the stored token until the match ends; when no original human is connected the all-gone timer ends the match `voided` (rule 22); the persisted record (a third kind) restores the screen after a reload. The rejoin answer is the full snapshot (both boards, four pockets, four clocks, `seq`, the seat). A premove queued on a screen that reloads is **lost, by design** (client-only). **Tests:** in-process (each of four seats; takeover, retake, all-gone, rejoin of a finished match kept 5 minutes), real sockets, and a browser reload mid-game with two boards.

### HP6. Spectating both boards

A spectator sees **both boards** (equal size; each oriented as a player of that board would see it: Board A White at the bottom, Board B Black at the bottom, so Team 1's players face their own colour on each board), four clocks and four pockets, read-only, from the same snapshot stream (`bug_spectate_game`); the deciding board is outlined at the end; the Spectate list has a Bughouse section. **Tests:** the spectator's screens equal the server snapshot at every `seq`; a spectator cannot move; **quick messages and team chat are never delivered to a spectator** (and a spectator cannot send either).

### HP7. Out of scope

Fog of War, Chess960 / Setup Chess, Atomic, Duck, Spell, Horde and every other variant are not combinable with Bughouse; no analysis, Game Review, PGN, hints or ratings (B18).

### HP8. The `stuck` player

A player in check with no legal move who could be saved by a drop (rule 18), and a player with no legal action who is not in check (rule 19), are neither mated nor stalemated by the Crazyhouse engine's definition. They get a status of their own (`stuck`), a UI line ("waiting for a piece"), and no match effect: the clock decides. **Tests:** a single slider check with and without an empty square to interpose, a knight check (real mate), a double check (real mate), a stalemate with an empty pocket; the status flips the moment a partner capture fills the pocket; the clock keeps running while `stuck`.

### HP9. Orientation, colour and board identity (found while writing v1, sharpened by S-U3)

Teammates play opposite colours and, per S-U3, **each board is shown oriented to its player's colour**, so the partner's board is seen from the other side. A pocket chip is drawn in the colour of the player who will drop it; every cell label, test id and wire field says which board it belongs to. This is the class of bug that put every online Chaturaji move on the wrong square: a helper that defaults to "the board" works until there are two. **Rule (AGENTS.md): no helper that names a square, a cell, a pocket or a clock may default to a board;** the board is a required argument (`A` / `B`), pinned by a whole-game property test like `chaturajiOnlineSquares.test.ts`, and **orientation is a property of the VIEW (which colour is at the bottom), never of the board's data**.

### HP10. Quick messages and team chat: routing, limits, abuse

**Ten quick messages, codes 0-9, all enabled (Q7).** **Wire.** `bug_quick { code: 0..9 }` (the client sends a code from a closed set, never text; the server rejects any other value). The server forwards `bug_quick_from { seat, code }` **to the partner's seat only** - never to opponents and never to spectators; it is not stored and not logged with content. If the partner is a bot (or the seat was taken over) the sender gets an ack saying so and nothing is delivered.
**Limits.** Per seat: at most **1 message per 1.5 s** and **8 per 10 s**; excess is refused with a short error (no queue). An identical code within 1 s is dropped. Bots never send.
**Localisation.** The code is rendered by the receiving client, so a message is never an injection vector and needs no moderation.
**Tests.** Routing (only the partner receives), codes outside 0-9 refused, the three limits, a bot partner, a spectator never receiving, a taken-over seat; the browser suite checks the toast and the clock icon on the partner's page and that the opponent's page shows nothing.

**Free-text chat is TEAM-ONLY (Q1, resolved) and the SERVER enforces it.**
- **A new event of the Bughouse room only:** `bug_chat { text }`. The Bughouse manager delivers `bug_chat_from { seat, name, text }` to **the sender (as the echo) and the sender's partner's socket, and to no one else**: not to the two opponents, not to any spectator, not into the room's spectate stream and not into a late rejoin. The recipient set is computed **on the server from the seat map** (`partner(seat)`), never from anything the client sends: a client cannot name a recipient, so a modified client cannot broadcast.
- **What happens to the existing 4-recipient chat wiring:** nothing. `FourRoomManager.sendChat` (all four seats and the spectators) stays exactly as it is for 4 Player Chess, 4 Player Giveaway and Chaturaji; it is not generalised and not given a "scope" parameter, so those three variants cannot be affected by this feature; `FourPlayerChatPanel` is reused as the UI with a "Team chat - only your partner sees this" header and an empty-state line saying so.
- **Same limits as the existing chat** (the length cap and the minimum interval per seat, `FOUR_CHAT_MIN_INTERVAL_MS`) plus the rules above; a message to a bot partner (a seat a bot controls, including after a takeover) is **not delivered and the sender is told** ("your partner is a bot"), never silently dropped; a human who retakes a seat sees no chat history (nothing is stored, as today).
- **Tests (server-side, on stub sockets and over real sockets):** a four-seat room with four clients and a spectator: a message from each seat reaches exactly that seat and its partner; **no other socket receives it, checked by recording every event of every socket**; a spectator cannot send; a bot partner; a takeover mid-conversation; the rate limit; an over-long message; a payload that tries to name a recipient is ignored; and a **guard test that the 4-seat `sendChat` source is unchanged** in behaviour (its existing tests stay green and unedited). Mutation on the recipient computation (the opponent included, the spectators included, the sender's partner replaced by the other board's player).

### HP11. Private rooms ("play with a friend"), abuse and how a room joins the matchmaking

See the full flow in 5.7 and the decisions in B16. **The design points that are hard parts:**
- **A pair is a group:** the matchmaker's lobby entries become "solo" or "pair"; a pair is never split; seats are assigned by team (a pair takes seats 0+3, a second pair 1+2, two solos shuffled into the free team, bots after the fill wait).
- **Code guessing.** The code format is the existing one (6 of 31 characters, about 887 million codes) with a 10-minute TTL; **the existing 2-player join has no attempt limit** (risk 8), so Bughouse adds: a failed-attempt limit **per socket (5 per 5 minutes, then a 5-minute cooldown), per user (10 per 15 minutes) and per IP (30 per 15 minutes)**; **one identical error** for unknown / expired / full / started ("that code was not found or has expired"), so the response is no oracle; a code is **consumed** when the match starts and invalid after expiry; **one open room per user** and a process-wide cap (for example 500); codes never appear in logs; **both host and friend must be logged in** (see question Q2).
- **Lifetime:** in memory, expiry swept every 5 minutes (as the challenge manager); a host disconnect closes the room; a friend disconnect frees the friend seat and keeps the room.
**Tests.** The limiter (each of the three scopes, the cooldown, the identical error), expiry, one-room-per-user, the cap, host / friend leaving at each stage, a pair in the queue whose member disconnects, pair + pair / pair + solos / pair + bots assignments (every shuffle enumerated like the existing matchmaker test), and the browser flow with two real pages.

### HP12. Local with humans on both boards: two boards played with two fingers at the same time (new in v3)

**Problem, verified in the code.** `useBoardGestures` (`src/components/useBoardGestures.ts`) is **one `PanResponder` on each board's container**, and `package.json` has no `react-native-gesture-handler` (nor reanimated). React Native's responder system, and react-native-web's, grant **one responder at a time**: while one board holds the responder a second finger on the other board is not delivered to it, or - if the first board agrees to give up the responder - it **steals it and cancels the first board's gesture**. So with the existing input **a touch on board A cancels or blocks a selection on board B**, which is exactly what the user ruled out. The 4-seat boards and the 2-player board never needed more than one finger at a time, so nothing in the repo has ever tested this.

**Design: a per-board raw-touch input layer** (`useBoardTouches`, new), used by both boards ONLY in a layout where humans play both boards:
- Plain touch events on each board's container and on its pocket tray (`onTouchStart` / `onTouchMove` / `onTouchEnd` / `onTouchCancel`), which are delivered to the view the touch began in **independently of the responder system** (react-native-web forwards the touch props; to be re-verified for Move and Cancel in the spike).
- **Each touch is tracked by its `identifier` and belongs to the board it began in until it ends.** The layer produces the same `onTap(cell)` the existing hook produces, so `ChessBoard` is reused; long-press arrows are **off** in this layout (taps only).
- **Rules:** (1) **no screen-level backdrop handler and no "tap elsewhere to deselect"**: nothing outside a board may touch that board's selection; (2) **selection state (the picked square, the picked pocket chip, the highlighted legal squares) lives in a per-board reducer instance keyed by the board**, so board A's handler cannot read or write board B's; (3) a tap counts only if the touch **starts and ends on the same board**; a touch that drifts onto the other board is cancelled, never transferred; (4) a touch in the gutter between the boards is ignored; (5) the responder system is not used on the two boards, so the single-touch controls row (Resign, Rules) is unaffected.
- **Spike with a go / no-go (the first 0.5-1 day of W3b).** On web in Chrome with touch emulation: two-finger events through a CDP session (`Input.dispatchTouchEvent` with two `touchPoints`; Playwright's own `touchscreen.tap` is single-touch, so the browser suite gets a small CDP helper). **On a device** only the user can confirm (this environment verifies web only): Expo Go on a real Android phone and an iPhone is a listed hand-check. **Fallback if native raw touches do not arrive together:** add `react-native-gesture-handler` (a new dependency, a native module: the user is asked first, because it changes the build) and put a `Tap` gesture per board in a `GestureDetector`; the per-board reducer, the board-ownership rules and the tests are the same either way.

**Tests.** A pure reducer property test: two boards, random interleavings of two touch sequences (select on A, select on B, target on A, target on B, drifts, cancellations): each board ends in the state it would have reached alone, and **no event of one board ever changes the other's selection**; DOM tests with synthetic touch events carrying identifiers (two fingers down, one lifted first, one drifting across); the browser suite with a CDP two-finger scenario (select a piece on A and on B at the same instant; both resolve; then drop on A while moving on B); a mutation set on identifier handling, board ownership and the start-and-end-on-the-same-board rule.

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

**Ten buttons** in a 2 x 5 grid opened from the controls row (Quick), each one tap, partner-only (HP10), codes `0..9` in this order:
0. **Need a knight** 1. **Need a bishop** 2. **Need a rook** 3. **Need a queen** 4. **Need a pawn** 5. **Don't trade** 6. **Trade!** 7. **Sit / wait** 8. **Hurry!** 9. **Watch your king**
(Q7: all ten are on in v1; they are the ten examples the brief listed.)
**On the partner's screen:** a **non-blocking toast** at the top edge (about 2.5 s, no tap needed, never over a board's squares, `pointerEvents` off) plus **an icon with the message on the partner's clock for 8 s**; a light haptic on native; no sound by default. **Short rate limit** (HP10). Opponents and spectators never see it. **Free-text chat is team-only too** (HP10, Q1): the chat panel says "Team chat - only your partner sees this".

### 5.5 Premove UI (B21)

On the opponent's turn the board accepts the same taps as on mine: a move premove draws an arrow and a ghost piece in a distinct premove colour (as the 4-seat boards do); a **drop premove** shows the ghost piece on the square and the chip stays marked "premove". **One at a time:** a new tap sequence replaces it, tapping the ghost or a **Cancel** chip clears it. A cancellation shows a **visible toast with the reason** (HP3) and the marker disappears. **Premoves are off in Local whenever two or more humans share the device** (B23); with exactly one human they are on.

### 5.6 Local screens (B15, B23)

**One seat model, as the other 4-seat Local setups (B23, resolved in v3).** The setup screen is the existing `FourPlayerSetupScreen` pattern (a `SeatConfig`; each of the four seats is **Human** or **Bot**, a bot picked from the app's named roster with its ELO, `isStartable` needs at least one human) with the seat rows labelled **"Board A - White - Team 1", "Board A - Black - Team 2", "Board B - White - Team 2", "Board B - Black - Team 1"**, each with its team shape (a diamond for Team 1, a circle for Team 2) and colour. Four one-tap **presets** fill the same four rows - *You + 3 bots*, *2 players, opponents* (both on board A), *2 players, teammates* (one per board), *4 players* - they are shortcuts, not modes: **any combination is allowed**. Then the time control (the six). The screen shown during the game is **derived from where the humans sit**:

| Humans | Layout | Boards and input |
|---|---|---|
| **Exactly one** | the standard layout of 5.1 / 5.2: own board large + partner thumbnail (portrait), two equal boards (landscape) | the human's colour at the bottom; premoves on; one finger |
| **Two or more, all on ONE board** (both colours of that board; for example opponents on board A, bots on B) | **(1) pass-and-play:** that board large and shared, the other board a thumbnail | the board **turns to face the side to move** (a switch keeps it fixed), a **"<Colour> to move" banner**, **only the side to move can touch** (the other human's touches are ignored), turn-based, one finger; no hidden information, so no cover screen |
| **Humans on BOTH boards** (teammates, one per board; three humans; four humans) | **(2) dual-board:** **both boards fully playable at the same time**; **portrait: the two boards stacked vertically at equal size**, each with its own pockets and its own two clocks; **tablet / landscape: side by side at equal size, as in S-U3** | **simultaneous multi-touch** (HP12): each board takes input only from its own touches and **a touch on one board never cancels or changes a selection on the other**; **each board is oriented to the colour of the human playing it**; a board on which **both colours are human uses the pass-and-play rules of (1) for that board** (it turns to its side to move, its own banner, only its side to move may touch it) |

**Other rules of the local screens.** Four clocks always (two per board block in layout (2)); the match ends as ever when any board ends or any flag falls (rule 17, HP2); each board's pocket tray is interactive for the side to move there. **Premoves are off whenever two or more humans share the device**, on with exactly one (HP3, 5.5). **Quick messages and chat do not exist in Local** (nobody to send them to). **Team badge (5.3):** with one human the "your team" badge; with two or more humans there is no single "me", so **both team badges are shown on all four kings** (diamond Team 1, circle Team 2). Long-press arrows are off in layout (2) (taps only).

**Minimum screen size for layout (2), and what the user sees below it.** The two boards need a **cell of at least 28 px** (the Chaturaji minimum, `CHATURAJI_MIN_CELL`) to be tappable at speed. With a block per board of 8 cells + two clock rows (28 px each) + the pocket tray row (32 px + 8 px margin) = `8c + 96`, and a header (44 px), a controls row (44 px) and an 8 px gap:
- **Portrait, stacked:** height needed = `16c + 288`; width needed = `8c + 16`. At c = 28: **240 x 736 px**. The cell size is `min(floor((H - 288) / 16), floor((W - 16) / 8))`.
- **Landscape / tablet, side by side:** a compact header (32 px) + the block rows = `8c + 128` high, `16c + 24` wide. At c = 28: **472 x 352 px**. The cell size is `min(floor((H - 128) / 8), floor((W - 24) / 16))`.
- The layout with the larger cell wins; on a tie, side by side when the width is at least 700 px (S-U3), otherwise stacked.
| Window (points) | Stacked | Side by side | Result |
|---|---|---|---|
| 360 x 640 (a small phone, portrait) | 22 | 21 | best is 22, below 28: **refused** |
| 375 x 667 | 23 | 21 | best is 23: **refused** |
| 360 x 740 | 28 | 21 | stacked, 28: the minimum, works |
| 360 x 800 | 32 | 21 | stacked, 32: works |
| 390 x 844 | 34 | 22 | stacked, 34: works |
| 412 x 915 | 39 | 24 | stacked, 39: works |
| 800 x 360 (a phone, landscape) | 4 | 29 | side by side, 29: works |
| 568 x 320 (a small phone, landscape) | 2 | 24 | best is 24: **refused** |
| 768 x 1024 (a tablet, portrait) | 46 | 46 | tie, width >= 700: side by side |
| 1024 x 768 (a tablet, landscape) | 30 | 62 | side by side, 62: works |
**Below the minimum** the setup screen shows, instead of a broken layout, and keeps **Start disabled**: *"This seat setup needs a larger screen. Turn the device to landscape, or put every human on one board."* - evaluated against the CURRENT window, so rotating the phone on the setup screen updates it at once. **During a game**, rotating below the minimum shows a blocking overlay "Rotate the device to keep playing" (Local has no pause: the clocks keep running, as they do online; this is a stated risk, section 8). The thresholds and the sizes in the table are pinned by a pure `getBughouseDualCellSize(w, h)` test at 360 x 640, 412 x 915 and the rows above, like `getChaturajiCellSize`.

**Worked examples.** *Two opponents* (human on seat 0 = A White, human on seat 1 = A Black, bots on seats 2 and 3 as their partners): layout (1) - board A large and shared, turning to the side to move, board B the thumbnail with its two bot clocks; each human's pocket is fed by THEIR bot partner's captures on board B. *Two teammates* (humans on seats 0 and 3): layout (2) - A White at the bottom of the first board, B Black at the bottom of the second, both playable at the same moment with a finger each; bots on seats 1 and 2. *Three humans* (seats 0, 1, 3): layout (2) with board A on pass-and-play rules (both colours human) and board B oriented to seat 3. *Four humans*: layout (2) with both boards on pass-and-play rules, two people tapping at once, one per board.

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

**All of B1-B23 are RESOLVED by the user (20/10; B23 and Q1 were changed in v3). Items marked *PROPOSED* are my design inside a resolved decision and still need a yes; they are collected at the end of this section.**

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
**B14. Chat and quick messages - RESOLVED: chat PLUS quick messages in v1; in v3 the free-text chat became TEAM-ONLY (Q1) and all ten quick messages are on (Q7).** *PROPOSED set (ten, codes 0-9):* Need a knight, Need a bishop, Need a rook, Need a queen, Need a pawn, Don't trade, Trade!, Sit / wait, Hurry!, Watch your king; partner-only; a closed code set; 1 per 1.5 s and 8 per 10 s; a non-blocking toast plus an icon near the partner's clock. **Free-text chat: only the partner receives it; opponents and spectators never; enforced by the server in a new `bug_chat`; the other variants' chat wiring is untouched.** Section 5.4, HP10. chess.com's glossary page also mentions shortcuts for partner communication.
**B15. Local mode - RESOLVED (v3, changed): the same seat model as the other 4-seat Local setups - each of the four seats is Human or Bot, any combination.** This replaces v2's "(a) 1 + 3 bots / (b) 2 humans" split; the screen follows from where the humans sit (B23).
**B16. Online play - RESOLVED: BOTH a solo queue with a random partner and play with a friend (private room, invite code, the friends are teammates; the other seats from the queue or bots after the fill wait).** *PROPOSED design:* 5.7 and HP11 (code format and 10-minute expiry reused from the 2-player challenges; a friend pair is one matchmaking entry; attempt limits that the 2-player flow lacks).
**B17. Bots, fill and takeover - RESOLVED: as the 4-seat games (>= 2 humans, 30 s fill, takeover after 45 s); in a friend room the friends stay teammates and bots fill the opposing team if needed.**
**B18. Ratings and history - RESOLVED: none.**
**B19. Partner disconnect - RESOLVED: a bot takes the seat after the grace, then hand-back on return.**
**B20. Seat map - RESOLVED: fixed (rule 2); random shuffle in the solo queue; in a friend room the friends are seats 0 + 3.**
**B21. Premoves - RESOLVED: premoves AND drop premoves in v1.** *PROPOSED rules:* queue length **one**; client-only, resolved against the authoritative snapshot that gives me the turn; a visible reason on every cancellation; **off in Local whenever two or more humans share the device (v3)**. Section 5.5, HP3.
**B22. Spectators and a finished match - RESOLVED: both boards for spectators; the result kept 5 minutes for a late rejoin.**

**B23. Local with several humans on one device - RESOLVED (v3, CHANGED): the same four-seat Human / Bot model as the existing Local setups of 4 Player Chess, 4P Giveaway and Chaturaji; any combination is allowed (two humans as opponents, two as teammates, three or four humans).** It replaces v2's "opponents (ii) / teammates (i)" choice: both are now just seat configurations. The screen is derived from where the humans sit (section 5.6):
1. **All humans on ONE board** (both colours of that board human): **pass-and-play on that board** - the board flips to the side to move, a "<Colour> to move" banner, only the side to move can touch; the other board is a thumbnail.
2. **Humans on BOTH boards** (teammates; three or four humans): **both boards playable at the same time** - stacked vertically at equal size in portrait (each with its own pockets and two clocks), side by side in landscape / tablet (S-U3); **simultaneous multi-touch** works because the boards use the per-board raw-touch layer of HP12: each board takes input only from its own touches, and a touch on one board never cancels a selection on the other; **each board is oriented to the colour of the human playing it**; a board on which both colours are human uses the pass-and-play rules of (1).
- **Minimum size for (2): 28 px cells = 240 x 736 portrait or 472 x 352 landscape**; below it the setup screen says "This seat setup needs a larger screen. Turn the device to landscape, or put every human on one board." and Start stays disabled (the full table of window sizes is in 5.6).
- **Premoves are off in Local whenever two or more humans share the device.**
- The setup re-uses the existing 4-seat Local setup component and pattern, with explicit Board A / B, White / Black and team labels.
- *Cost of the change:* W3 splits into **W3a (the seat model, the standard layout and pass-and-play) and W3b (dual-board simultaneous play)**; +7-8.5 days over v2's W3 (section 7). *The new risk:* the existing board input cannot do this (HP12), so there is a spike with a go / no-go and a stated fallback (a gesture-handler dependency, which the user would be asked about first).

**The v2 questions - all RESOLVED (20/10).**
- **Q1 (CHANGED): free-text chat is TEAM-ONLY in Bughouse**, enforced by the server; the other variants' chat is unchanged (HP10).
- **Q2: login is required** for friend rooms (host and friend).
- **Q3: pair against pair - the pair that waited longer takes seats 0 + 3.**
- **Q4: superseded** by the new B23.
- **Q5: web link + code entry**; the native deep link comes later.
- **Q6: no draws at all** - B9 and S-U2 stand over chess.com's terms page ("a draw can be agreed", an over-the-board allowance).
- **Q7: both extra quick messages are ON** - ten in total, codes 0-9.

**Still *PROPOSED* inside the resolved decisions (my numbers; they need only a yes, and each is a few lines to change):** the flag tie-break (B8, HP2); the ten-message wording (B14); the friend-room numbers - 10-minute code life, the attempt limits 5 / 5 min + 5 min cooldown per socket, 10 / 15 min per user, 30 / 15 min per IP, one open room per user, a global cap (B16, HP11); the premove rules - a queue of one, cancellation reasons (B21, HP3); the 28 px minimum cell and the window sizes of 5.6 (B23).

---

## 7. WORKSTREAMS W0-W9 (W3 is two cycles: W3a, W3b; eleven cycles in all; branch `paired/bughouse` in both repos, from `master` / `main`)

Each row is a vertical slice with a stop-and-review. **Gates on every workstream:** `tsc` clean; the frontend suite and every backend suite green at their counts; **the existing goldens byte-identical (FFA, Giveaway, Chaturaji, geometry, and the new Crazyhouse golden from W0)**; `sync:fourplayer --check` and the new mirror's check; mutation on the new non-visual logic in **chunks of at most ~20 mutants / 20 minutes, a hard timeout per mutant, one at a time, results outside the repo**, every survivor killed or proven equivalent with a test (AGENTS.md); a docs entry per workstream. **Lessons from AGENTS.md from the first line:** no helper names a square, cell, pocket or clock without the board as a required argument (HP9); constants checked by mutation-targeted tests are literals; test-only switches follow CHECKLIST section 7 (opt-in, ignored under production with one value-less warning, validated, set only by the e2e stack); no wall-clock assertions (best-of-N or structural), seeded randomness, fake timers in rendered tests; **the dev web path is checked, not only the export** (`expo export` bakes the production bundle, which talks to Render; every UI slice is also run once against the dev server with `EXPO_PUBLIC_API_URL`).

| | Slice | Scope and gates specific to it | Days |
|---|---|---|---|
| **W0** | **Foundations, no behaviour change.** (1) The mutation harness into the repo (`scripts/mutation/`, a README, an example config). (2) A **Crazyhouse golden** recorded on master BEFORE `crazyhouse.ts` is touched. (3) New exports in `crazyhouse.ts` (bank-to-partner, "can a drop ever help") with the verbatim backend mirror and `test-crazyhouse.mjs`. (4) The new mirror module family with its manifest and generator check, empty engine skeleton. | Crazyhouse golden, `crazyhouse*.test.ts`, oracle and `test-crazyhouse.mjs` unchanged; mirror in sync; `legalDrops` benchmark before / after. | **2-2.5** |
| **W1** | **The engine (pure, mirrored).** `BughouseMatch` (two boards, four pockets, promoted marks, seat map), `applyAction`, the `stuck` status, **the pure `settle` (HP2: deadlines, due flags first, the tie-break) and the result model without a draw (`voided`)**, the text snapshot, legal-action lists per seat, premove-resolution validation as a pure function (HP3), scripted positions for every rule of section 1, the reference model for transfers, differential tests per board against `ChessEngine` and the chessops oracle, the conservation property test, a Bughouse golden, the generated server copy. | Oracle agrees per board; the invariant over 500+ seeded interleavings; every `settle` case of HP2; snapshot round-trip; mutation chunks over transfer, status, settlement, result, drop legality, snapshot. | **5.5-6.5** |
| **W2** | **Server game loop, bots and quick messages (server side), in-process.** `BughouseRoomManager` (funnel, one `seq`, two clock timers on the monotonic source, per-board bot timers, rate limit, takeover / retake, all-gone `voided`, rejoin of a live and a finished match, spectate), the second matchmaker instance, `bug_*` handlers and wire, **`bug_quick` routing and limits for ten codes (HP10) and the TEAM-ONLY `bug_chat` with server-side recipient computation (HP10, Q1: +0.7-1 d)**, the Bughouse bot with its decision budget (HP4), config names, a compatibility matrix with the four 4-seat suites unchanged (their chat tests untouched). | HP1 / HP2 / HP5 / HP10 scenarios on stub sockets and fake timers, **every socket's received events recorded to prove opponents and spectators never get a chat line**; bot p99 per tier; bot golden; the 4-seat suites unchanged. | **8-9.5** |
| **W3a** | **Local core: the seat model, the standard layout and pass-and-play (B15, B23 cases "one human" and "all humans on one board").** Play-menu card; **the setup screen = the existing `FourPlayerSetupScreen` pattern with the four Human / Bot seats, Board / colour / team labels, the four presets and the screen-size gate (`getBughouseDualCellSize`, the refusal message)**; the two-board screen in **both layouts (B13)** with per-board orientation and the **team badge**; four clocks, four pockets, the drop tap-pair, the `stuck` line; **pass-and-play on a board (turning to the side to move, the banner, only the side to move may touch)**; result with both boards; rules sheet; board-qualified labels and test ids; rendered tests; a browser pass on the dev server at both sizes and both themes. | Rendered tests for every state and every seat configuration that maps to layout (1) or the standard one; the layout / min-size pure tests at the rows of 5.6; the whole-game property test that no UI helper defaults to a board; orientation / badge tests per layout. | **9-10.5** (v2's W3 was 7-8.5; the seat model, its labels, presets and the size gate add about 2) |
| **W3b** | **Local with humans on BOTH boards: simultaneous play (B23 case 2).** **The HP12 spike (0.5-1 d, go / no-go, the gesture-handler fallback decided with the user)**, the per-board raw-touch input layer and per-board selection reducers, the dual-board layouts (stacked equal-size boards in portrait, side by side in landscape / tablet), per-board orientation to the human's colour and pass-and-play rules for a board whose two colours are human, the rotate-below-minimum overlay, premoves off for 2+ humans, both team badges; rendered tests with synthetic multi-touch; a CDP two-finger browser check. | The interleaved-touch property test (HP12); DOM tests with touch identifiers; no screen-level backdrop handler (a source scan like `chaturajiWiring.test.ts`); **a real-device hand-check list for the user (Expo Go, Android and iPhone)**; mutation on identifier handling and board ownership. | **5-6.5** |
| **W4** | **Online client, spectator, rejoin, quick-message UI.** Reducer / session / UI-logic twins, queue screen, online game in both layouts, spectator screen, Spectate list section, the third `ActiveOnlineGame` kind, resume link, the **Quick** grid of ten, toast and clock icon, **the team-chat panel (the existing panel with its "only your partner sees this" label: +0.3-0.5 d)**; rendered tests with a server simulator on the real engine (restore after rejoin, optimistic drop and rollback, takeover badge, thumbnail follows the stream, a quick message and a team-chat line arriving only for the partner). | Reducer tests incl. a refused drop and a late snapshot; the persisted-rejoin restart test; mutation on the reducer. | **6-7** |
| **W5** | **Premoves and drop premoves (B21).** The one-deep premove (moves and drops) with authoritative resolution, cancellation reasons and toasts, the premove marker / ghost UI, the pocket-divergence case, **on in Local only with exactly one human and off whenever two or more humans share the device**; reducer tests; extends `usePremove`; a browser scenario on two real pages. | Every cancellation reason tested; "never sent early" asserted at the socket level; mutation on validation order. | **3-3.5** |
| **W6** | **Friend rooms (B16).** The private-room manager (create / join / leave / start / expiry / sweep), the attempt limiter (per socket, user and IP; the identical error; one room per user; a global cap), **groups in the matchmaker** (a pair is never split; team-aware seat assignment; the fill clock at once), the Room / Join / pair-queue screens, the invite link, the native share and web clipboard paths; tests for every limiter scope and every leaving case; a **guarded test-only switch** for the browser suite if it needs to shorten the expiry (CHECKLIST section 7). | Limiter tests for each scope; every seat-assignment shuffle enumerated; real-socket cases for pair + pair, pair + solos, pair + bots, a pair broken in the queue; mutation on the limiter, the groups and the expiry. | **4.5-5.5** |
| **W7** | **Real sockets.** Real-socket e2e scenarios (a whole natural game with four clients and a spectator; a capture / drop race; resign; a flag on each board; a flag against a mate; takeover and retake on each seat; spectator; quick messages routing; **team chat reaching only the partner, every socket's events recorded**; lobbies never mix with the four other variants; persisted rejoin from a new process), a fixed total of checks (conditional checks counted apart), the nightly fuzz section, CI / nightly wiring. | Total fixed over three runs; fuzz 40+ games, 0 issues; the other variants' counts unchanged. | **4-4.5** |
| **W8** | **Browser end-to-end.** Scenarios in `backend/scripts/e2e-browser`: four users, ten rounds with every screen of both boards compared with the server after every action; capture-then-drop across boards; `stuck`; a flag; **orientation and badge on both layouts**; **quick messages and team chat (the opponent's page shows nothing)**; **premove drop cancelled by the opponent's move**; **the friend flow with two real pages (create, code, join, start with bots, find opponents as a pair)**; **local pass-and-play and, through a CDP session, true two-finger simultaneous play on the stacked and side-by-side dual-board layouts (a touch on one board never cancels the other's selection)**; the setup screen's refusal at 360 x 640; takeover and hand-back; reload; spectator; the five variants never mixing; layout at both sizes; touch; a constructed start position through a guarded start-position switch (a Bughouse snapshot kind) to reach promotion / a counterfeit / a drop mate. | 3 of 3 consecutive runs and one under CPU load on the final commit, retries <= 1 per scenario and <= 2 per run, the dev web path exercised. | **4.5-6** |
| **W9** | **Close-out and merge readiness.** Docs roll-up (both TESTING.md, CHECKLIST, TODO, AGENTS), the final mutation re-run over everything Bughouse touched (per chunk: mutants / killed / equivalents with one-line proofs / time), the full gates, squash to logical commits, CI green on the exact commits, merge steps. | As the Chaturaji close-out. | **2.5-3** |

**Total: about 54-65 working days across eleven stop-and-review cycles** (W0 2-2.5, W1 5.5-6.5, W2 8-9.5, W3a 9-10.5, W3b 5-6.5, W4 6-7, W5 3-3.5, W6 4.5-5.5, W7 4-4.5, W8 4.5-6, W9 2.5-3). **v2 was 44-54 over ten; v3 adds about 10-11 days:** the Local seat model, its setup labels, presets and screen-size gate (about 2), pass-and-play kept, and above all **dual-board simultaneous play with the new multi-touch input layer, the spike and its tests (5-6.5, W3b)**, plus **team-only chat (1-1.5)** and the CDP multi-touch and chat scenarios in W7 / W8 (about 1-1.5). v1 was 31-36 over eight. For scale: Chaturaji was estimated at 9-12 days and its test and close-out load exceeded the estimate.
**The one estimate that can move:** W3b depends on the HP12 spike. If native raw touches work, it is 5-6.5 days; if the gesture-handler fallback is needed, add about 1-2 days (a new dependency, a build change and its checks) and the user is asked first.
**Optional, outside the estimate:** a partner-aware bot 3-4 d; chained premoves 1.5-2 d; a team rating (not sized); a native deep link for invites (Q5) 1-2 d.

---

## 8. RISKS AND OPEN QUESTIONS

1. **The one rule without a source is the flag tie-break (B8).** It is deterministic and unbiased and only matters at an exact millisecond (or at `seq` 0); if you would rather see a different one (for example always the board with the lower index), it is a three-line change in `settle`.
2. **The server needs an engine and a bot.** The mobile app's `ChessEngine` and bots are client-only; the backend has a separately maintained twin without bots; the generated module removes the drift risk but is the largest new piece of tooling.
3. **Bot decision cost.** The measured ~120 ms average / ~400 ms max is not acceptable synchronously on the server; the 25 ms p99 gate may force a weaker first bot or a worker thread. The v1 bot is a shallow heuristic: no partner awareness, no premoves, no quick messages.
4. **No external oracle** for the transfers and the match logic: they rely on an independent reference model and the conservation invariant.
5. **Two boards on a phone.** The 96 px thumbnail shows who-is-where and pockets, not deep tactics; the swap is the safety valve. Needs the real browser pass and ideally a real phone (the Chaturaji suite only emulated touch).
6. **Latency and fairness.** Server-authoritative clocks without lag compensation favour low-latency players; with four real-time participants this is more visible; the same policy as today, stated so it is a choice.
7. **Several humans on one screen, two boards at once (new, B15 / B23; sharpened in v3).** Pass-and-play on one board is turn-based and low-risk (the hand-over must be unmistakable: the board turning, a banner, touches of the other side ignored). **Dual-board simultaneous play is the largest UI risk of the whole spec:** (a) **the existing board input cannot do it** (one `PanResponder` per board, one responder at a time, no gesture-handler: a second finger is ignored or steals the first board's gesture - HP12), so a new input layer is required and **its behaviour on real native devices cannot be verified in this environment** - only web (Chrome, CDP two-finger events) can; the user must hand-check it in Expo Go on an Android phone and an iPhone, and the fallback is a new native dependency; (b) **accidental touches and hands covering the other board** with two people on one glass at bughouse speed (mitigations: board-ownership rules, a gutter dead zone, taps only, no arrows); (c) **a minimum size**: a 360 x 640 phone cannot show two playable boards (22 px cells), so some seat setups are **refused on small phones** and must say why, which some users will find limiting; (d) **rotating below the minimum mid-game** shows an overlay while the Local clocks keep running (there is no pause, as online): a rotation can cost a player time. v2's claim that the browser suite cannot drive multi-touch is withdrawn: it can, through CDP.
17. **Team chat enforcement (new, Q1).** The guarantee that opponents and spectators never see a line rests on the server computing the recipients from the seat map; the risk is regressions that route a Bughouse line through the 4-seat broadcast path - covered by recording every socket's events in tests and by the guard that the 4-seat `sendChat` is not changed. Free text between partners can still be abusive towards the PARTNER (no moderation exists in any variant; reporting is not in scope).
18. **The seat-model setup grows combinations** (humans on boards, colours, bots, time controls) that all need screens and tests: the layout derivation is a pure function with a table test over all 16 human / bot patterns of the four seats, so no combination is left to hand-checking.
8. **Private rooms and abuse (new, B16).** A 6-character code from 31 letters (about 887 million) with a 10-minute life is guessable at network speed **if there is no attempt limit - and the existing 2-player `join_challenge` has none** (only the HTTP routes are rate-limited; a socket event is not). This is **a finding outside the scope of this spec**: I recommend a separate small fix for the 2-player flow (the same limiter as HP11) and have not touched it. Further risks of rooms: an unlimited number of open rooms (memory; capped), invite-link phishing / spam (a link opens an app screen that needs a login and shows the host's name), a host holding a room open (10-minute life, one room per user), a friend slot squatted by a stranger who guessed the code (the host sees who joined and can **Close**).
9. **Premove-drop races (new, B21).** The design removes server-side races (client-only, resolved at the turn, validated by the server against its own state) and the analysis in HP3 shows pocket changes cannot invalidate a premove between queueing and resolving; the residual risks are **client / server divergence after an optimistic drop is refused** and **UI confusion about which action is queued**; both are covered by reducer and browser tests.
10. **Quick messages (new, B14).** Closed codes, partner-only, rate-limited, no text: the abuse surface is spam (limited); the open point is accessibility (a toast must not be the only channel: it has the clock icon and an accessible live-region line).
11. **Matchmaking with groups is new complexity (new, B16).** Pair + solo + bot mixes and a pair broken mid-queue are the places bugs will hide; every shuffle must be enumerated in tests, as the existing matchmaker's are.
12. **Server load.** A room has two clock timers, up to four bot timers and a snapshot twice the size of a 2-player one per action; W2 must measure snapshot bytes and CPU per room, and say how many rooms one Render instance carries (no 4-seat game has such a number).
13. **State is in memory,** as for the 4-seat games: a restart ends every match, and rooms vanish. Longer matches make that more painful.
14. **The browser suite is nightly only** (about 7 minutes today); four users, ten rounds, the friend flow and pass-and-play will lengthen it; W8 must re-check the budget and the retry policy.
15. **Naming and branding.** No chess.com text, graphics or branding is copied; the badge, the quick-message icons and the rules sheet are our own. S-U3 is a description, not an asset.
16. **The estimate is a planning figure** that assumes the same discipline (goldens, mutation, browser suite) as Chaturaji.

### Questions

**The v2 questions Q1-Q7 are all answered (section 6).** What remains is a short list of **checks, not blockers**; each has a default I will build:

- **N1. The multi-touch spike may fail on a real device (HP12).** Only web can be verified here. Default: build the raw-touch layer, hand over a device check list (Expo Go, Android, iPhone) at the end of W3b; **if native raw touches do not arrive together, I stop and ask before adding `react-native-gesture-handler`** (a new native dependency, about +1-2 days).
- **N2. The 28 px minimum cell** (the Chaturaji minimum) is a proposal: it refuses 360 x 640 portrait for any seat setup with humans on both boards. Lower (for example 24 px, which fits 360 x 680) means smaller touch targets for two simultaneous players; higher means more refusals. Default: 28.
- **N3. Local has no pause** (the clocks run, as online), so rotating the device below the minimum mid-game costs time. Default: accept it and say so on the overlay; a Local-only pause is about 0.5-1 day if you want it.
- **N4. Team chat to a bot partner is "not delivered, and the sender is told"** rather than a silent drop. Default: as written.
- **N5. A native deep link for invites** (Q5) needs the app's URL scheme / domain decided before it can be built; not blocking for the web link plus code entry.

**Needed before W0:** nothing. Every B1-B23 and Q1-Q7 has an answer; the proposals marked *PROPOSED* in section 6 and N1-N5 have defaults and are asked again only at the workstream that uses them (N1 and N2 at W3b, N3 at W3b, N4 at W2, N5 at W6).
