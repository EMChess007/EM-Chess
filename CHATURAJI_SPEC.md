# Chaturaji (4-seat, 8x8) — spec (v2, SPEC ONLY — nothing is implemented)

Status: **v2, approved with all defaults (2026-10-19). Built so far on `paired/chaturaji` (both repos, not merged): W0 (the geometry and rule-option seam, behaviour-neutral) and W1 (the rules, the 8 x 8 snapshot and the wire, no UI) - see TESTING.md section 28 / 29 in the frontend and 29 / 30 in the backend for what was built, the gates and the deviations from this text; W2-W5 are pending.** v2 replaces v1 after you checked the live game on chess.com: **C1 (check model) and C2 (start layout) are resolved from your screenshots and tooltips**, C4-C10 follow from them, only genuinely open items remain **[confirm]** (§14), and **the architecture recommendation changed** (§8): v1 recommended a separate 8x8 engine and I overstated the cost of generalising ours - measured against the code, the better fit is to treat Chaturaji exactly as chess.com does, **4 Player Chess plus rule options on an 8x8 custom position**. Written per CHECKLIST.md ("spec before code"), in the same shape as `FOUR_PLAYER_GIVEAWAY_SPEC.md` and `FOUR_PLAYER_ONLINE_SPEC.md`. Covers both repos: frontend `EM-Chess` and backend `chess-app-backend` (`backend/`).
Same process as the earlier 4-seat features: **every workstream builds Local, Bots and Online together for its slice** (§10), after each workstream I stop and wait for an explicit "go", nothing is pushed or merged unless asked.

## 0. Summary (the 3-5 sentences)

Chaturaji is a four-player free-for-all on an **8x8** board: each seat (Red, Blue, Yellow, Green, clockwise, Red first) starts in one corner with four pawns, a king, a bishop, a knight and a **boat** (a rook), there are no dice and no queens, pawns promote to a boat on the far edge, and the winner is the seat with the **most points** (captures, king captures, and double / triple checks score). On chess.com it is **4 Player Chess with four rule options** - a custom start position, **Capture the King**, **3-point checkmate** (king captures are worth 3) and **pawns promote to a rook on the 8th rank** - and that is how I now propose to build it: a third *rules preset* of our existing 4-seat engine (`FFA_RULES`, `GIVEAWAY_RULES`, **`CHATURAJI_RULES`**) on a second *board geometry* (`square8`), reusing check detection, scoring, dead pieces, walking dead kings, elimination, serialization, the bot dial, the wire, the rooms and rejoin (§5, §8). The existing 4 Player Chess and 4 Player Giveaway are protected by regression gates that **already exist** (the 48-game + 9-scene FFA golden transcripts, the mirror drift check, the parity script) plus two I add in W0 (a Giveaway golden and a byte-identity test of the extracted geometry tables) (§11). Estimated 9-12 working days over six stop-and-review workstreams; **what I need from you before W0** is the answer to §14 item 1 (the architecture) and a look at items 2-4 (stalemate, walking dead kings, end-of-game bonus) if you can find them on chess.com.

## 1. What chess.com says (sources, and which one wins)

**Primary source (you, from the live game on desktop; variants are web-only, the mobile app does not offer them):** the start position, the four rule options and their tooltips, the point values and the pawn / boat rules below. Where anything I read conflicts with these, **your screenshots win**. (I cannot see the attachments in this session - the facts below are taken from your message; please tell me if a screenshot shows something different.)

| Fact (from your check of the live game) | |
|---|---|
| Start position, rotationally symmetric, 90° per army | Red a1 boat, b1 knight, c1 bishop, d1 king, pawns a2 b2 c2 d2, moves up; Blue a8 boat, a7 knight, a6 bishop, a5 king, pawns b8 b7 b6 b5, moves right; Yellow h8 boat, g8 knight, f8 bishop, e8 king, pawns h7 g7 f7 e7, moves down; Green h1 boat, h2 knight, h3 bishop, h4 king, pawns g1 g2 g3 g4, moves left. Turn order Red -> Blue -> Yellow -> Green. |
| Rule option 1 | "Custom position 'Chaturaji'" |
| Rule option 2 | "**Capture the King**" - *"To checkmate, kings must be captured."* |
| Rule option 3 | "**3-point checkmate**" - *"Checkmates & king captures are worth 3 points."* |
| Rule option 4 | "**Pawns promote to a rook on the 8th rank**" (boat = rook) |
| Points ([chess.com/terms/chaturaji](https://www.chess.com/terms/chaturaji)) | pawn 1, knight 3, king 3, bishop 5, boat 5, double check +1, triple check +5; capturing inactive (eliminated) pieces scores 0; an eliminated army's pieces stay on the board, inactive. Pawns: one step, no double step, no en passant, capture diagonally forward. Boat = rook. |

**Read to resolve what was still unknown (URLs actually read):**

| Source | What it settled |
|---|---|
| [support.chess.com: 4 Player Chess (4PC)](https://support.chess.com/en/articles/8614233-4-player-chess-4pc) (official, FFA section) | **Elimination**: a player is eliminated by checkmate, stalemate, resignation or timeout; their army turns "dead" (grey), capturing dead pieces earns nothing. **Resign / timeout: the army dies but the king stays live and walks randomly** until it is checkmated or stalemated ("dead king walking"). **Game end: "the game ends when three players are eliminated"**; the last remaining player gets a bonus per live enemy king left on the board (+20 in 4PC; +3 in the Chaturaji info text quoted below). Draws (insufficient material, threefold repetition, 50-move): the remaining players share points. **Winner = most points** ("total points do not directly affect rating, only final placement"). Check-fork points: *"Checking two players simultaneously: +1 with a Queen, otherwise +5; three: +5 with a Queen, otherwise +20"* - so the points belong to **the piece that gives the check**. A resign / timeout before every player has made three moves aborts the game. "Pass", "claim win" and "Capture the King" are **not** described there; the article says to press the "?" icon of a variant for its specific rules. |
| [chess.com/terms/4-player-chess](https://www.chess.com/terms/4-player-chess) | Same elimination / dead-piece / three-eliminated / most-points rules; **claim win**: with two players left, a leader by 21+ points may claim victory by resigning (4PC values); stalemating a player gives +10 to each remaining player (older table; the support article says stalemating yourself +20 - the two disagree, and neither is for Chaturaji); FFA pawns promote automatically on the 8th rank. Capture the King is not mentioned. |
| [Wikibooks: Four-Player Chess/Variants](https://en.wikibooks.org/wiki/Four-Player_Chess/Variants) | **Capture the King defined:** *"the only way to checkmate an opponent is to capture the king"*; **kings are not restricted in any way and a player is not obliged to respond to checks** (responding is only advisable); a player in check may capture another king instead of moving; **pieces are never absolutely pinned.** Stalemate under it: **not covered.** Promotion is configurable ("on a different rank and to a different piece"). |
| [chess.com forum: 4PC Variants List](https://www.chess.com/clubs/forum/view/4pc-variants-list) (BabYagun, 2018, locked) | Rule variants combine freely with the main formats and are written `CaptureTheKing`, `Prom=5 PromoteTo=...`, a custom position via `StartFen4`; **"en passant and Dead King Walking became standard rules from 21-May-2019"** (so a resigned / timed-out army keeps a walking king in every 4PC rule set unless a variant removes it). |
| [forum: Chaturaji Strategy](https://www.chess.com/forum/view/chess-variants/chaturaji-strategy?lc=1) (quotes the in-app info panel) | The panel text as quoted by a player (its numbers are Chaturaji-scaled - +3 where 4PC says +20 - but the poster notes it still mentions queens, so treat it as probably-Chaturaji, not certain): clockwise Red, Blue, Yellow, Green; pieces become dead when a player is eliminated and capturing them scores nothing; **"the game is finished when three players have been eliminated"**; **"the last remaining player will be given +3 for each enemy king left on the board"**; *"in case of insufficient material, threefold repetition or the 50-move rule, the remaining players will share +3 points"*; **claim win / autoclaim** exist; points do not directly change rating. |
| [forum: Chaturaji history on chess.com](https://chess.com/clubs/forum/view/chaturaji-history-on-chess-com-openings-and-trading-1) (Botbeg, 2023) | Confirms "3 pt mate" and "capture-the-king" were added to Chaturaji later (matches your options 2 and 3); the first versions are described as BNRK and RNBK. |
| [Wikipedia: Chaturaji](https://en.wikipedia.org/wiki/Chaturaji), [forum thread 2011](https://www.chess.com/forum/view/chess960-chess-variants/interesting-chess-variant-chaturaji) | The **historical** game (dice, a jumping boat, king worth 5). Not chess.com's version; used only to name what is **not** implemented. |
| [support.chess.com: challenge a friend to a variant](https://support.chess.com/en/articles/16202719-how-do-i-challenge-a-friend-to-a-chess-variant) | Variants are web-only; multiplayer variant games can have players replaced by bots. Chaturaji is not named. |

**Could not read:** the live variant page (client-rendered), `chessvariants.org` / the Fandom Chaturaji page (HTTP 403 / 402), and **no chess.com page defines what happens to a stalemated player, or exactly when a double check scores, under Capture the King** - those two answers below are proposals, marked [confirm].

**The questions you asked, answered:**

1. **How are check points (+1 double, +5 triple) awarded when check never has to be answered?** In the 4PC engine the points are a property of *the move*, not of the answer: they are awarded to the mover at the moment the **piece that moved attacks two (three) live enemy kings** - the support article scores by "with a queen / otherwise", i.e. by the checking piece, and it does not mention a response. Capture the King only removes the obligation to answer; it does not change what a check is, so the fork still scores, and it is now also a *real threat* (each attacked king can be captured for +3 and an elimination). Proposed exactly: on every applied move, count the live enemy kings attacked by the moved piece from its new square; 2 -> +1, 3 -> +5 to the mover; **discovered checks (a different piece now attacks) do not score**; dead (walking) kings and eliminated seats' kings do not count. **[confirm] (C7)**
2. **What happens to a player with no legal move (stalemate) under Capture the King?** No source. Under Capture the King "legal" means pseudo-legal (nothing is ever illegal for exposing the king), so a seat has no move only when every piece is blocked (rare, typically a lone boxed-in king). Proposal: **it is eliminated, as in 4 Player Chess** (the engine already does this; no new concept), **with no points** (the 4PC stalemate points are +20 / +10 at 4PC scale; no Chaturaji scale is documented). **[confirm] (C8)**
3. **When does the game end and who wins?** Sourced (support article + the Chaturaji info text): **when three seats are eliminated, the game ends; the winner is the seat with the most points, not the survivor**; the last remaining seat additionally receives **+3 per live enemy king still on the board** (the Chaturaji-scaled figure; live enemy kings exist only when a seat resigned / timed out and its king is still walking). Not sourced: the ply cap (we keep the 4-seat 1000 / 5000), ties (we share the win, as the 4-seat engine does), and the "dead position" rule (the 4PC engine ends the game when every active seat is a bare king because kings can never check; under Capture the King **kings can capture kings**, so that rule is switched off and only the cap ends such a game). **[confirm] (C9)**
4. **Claim win?** It exists on chess.com (4PC: leader by 21+ with two players left; the Chaturaji thresholds are not documented). Our 4-seat games have no claim-win today. Proposal: **not in v1**. **[confirm] (C10)**
5. **Can a player pass?** No source mentions a pass, and the 4PC engine has none: **no pass.** (Not [confirm]: nothing suggests it.)

## 2. Premises checked against the code (v2 corrects v1)

| Premise | The code says | Consequence |
|---|---|---|
| "The 4-seat engine is hard-wired to the 14x14 cross board" (v1 and your brief) | **True, but the coupling is small - v1 overstated it.** I counted every use of the geometry symbols outside tests: `RAYS` 3, `KNIGHT_TARGETS` 3, `KING_TARGETS` 4, `isPlayable` 2, `stepForward` 4, `pawnCaptureSquares` 2, `forwardCoord` 3 (+2 premove, +2 bot), `PAWN_START_COORD` 2, `FFA_PROMOTION_COORD` 3, `VALID` 2 in `state.ts`, `SIZE` 7 in `state.ts` / 3 in `presentation.ts` / 4 in `annotations.ts` / 8 in `FourPlayerBoard.tsx`, `CELLS` 6, `toDisplay` 3, and the start layout (`KING_START`, `CASTLES`, `ROOK_START_BIT`, the back-rank table) in `state.ts`. About **45 references in 5 mirrored files and 3 client files**, not "~1,200 lines threaded". The tables are built once at import from one predicate (`isPlayable`). | A geometry object is a bounded, mechanical change. See §8. |
| "chess.com implements Chaturaji as 4 Player Chess rule options" | Our engine is already built that way for Giveaway: `FourPlayerRules` is a discriminated union read at "a handful of defined touch points", the doc comment of `state.ts` says "nothing hard-codes the numbers, so a future mode supplies its own rules object", and **`FFA_PROMOTION_COORD = 7` already means "the 8th rank"** - which on 8x8 is the far edge. Check detection (`attackers`, `isInCheck`), scoring (`CAPTURE_POINTS`), dead pieces and the **walking dead king** (`dead-king` status), seat elimination, `playMove` / `advance` / `resign`, the cap, the golden gates, bots and wire all exist. | Most of Chaturaji is *already implemented* as FFA machinery; what is missing is small and listed in §5.2. |
| "Check-fork points are part of our FFA scoring" | **No.** `elimination.ts` states "Not modelled: check-fork bonuses, draw claims". | Check-fork points are **new code** (a few dozen lines, §5.2), needed by Chaturaji and optional for 4P Chess. |
| "The capture-hint UI (this week) is reusable" | `MandatoryCaptureBanner`, `useCaptureNudge`, the capturer ring exist for Giveaway (a capture is *mandatory* there). | Not needed in Chaturaji (no forced capture); the *patterns* serve a "king attacked" warning (§9). |

## 3. Decisions

**Locked in** - L1 Local + Bots + Online built together, every workstream a vertical slice (§10); L2 reuse the 4-seat infrastructure (rooms, matchmaker, bot driver, clocks, rejoin, chat, spectate); L3 the same quality gates as the earlier 4-seat features (spec first, hand-built scripted tests, mutation checks on copies, performance numbers, explicit cross-feature check, generated server engine with a drift check, parity script, nightly fuzz, docs); L4 **4 Player Chess and 4 Player Giveaway stay untouched, proven by gates** (§11).

**Resolved by your check of the live game**

| | Decision |
|---|---|
| C1 | **Capture the King.** No forced answer to check; a king may stay in or move into check; **an army is eliminated only when its king is actually captured**; pieces are never absolutely pinned. (Wikibooks definition + your tooltip.) |
| C2 | **Start position as in §1 / §4.1** (rotationally symmetric, from your list). |
| C3 | Boat = **rook**. |
| C4 | Pawns: one step forward, **no double step, hence no en passant**, capture one step diagonally forward, promote on reaching the far edge ("8th rank") **to a boat only**. |
| C5 | Points: capture of a **live** piece pawn 1, knight 3, bishop 5, boat 5, **king 3** (the "3-point checkmate" = a king capture is worth 3; one award, not king + mate); a promoted pawn counts as a boat (5, as in the 4PC table); **dead pieces score 0**. Double check +1, triple check +5 (§1 question 1). |
| C6 | **Elimination**: when a king is captured its army becomes inactive (grey), stays on the board, may be captured for 0 points, blocks squares, never attacks. Resign / timeout: see C8. |

**Open - each with my proposed default, all [confirm]** (reasons in §1 and §4)

| | Question | Proposed default **[confirm]** |
|---|---|---|
| C7 | Exactly when do check points score? | The piece that **moved** attacks 2 / 3 live enemy kings from its new square (§1 question 1); discovered checks do not score. |
| C8 | A seat with **no pseudo-legal move** on its turn; and **resign / timeout** | No move: **eliminated, no points** (the 4PC mechanism). Resign / timeout: the army dies and **the king keeps walking** randomly onto empty squares, exactly as 4 Player Chess ("dead king walking", standard since 2019); a walking king is **capturable for the king value 3** (and then it is gone). If you would rather the whole army freeze on resign, say so - it is a one-line rule. |
| C9 | End of game | Three seats eliminated -> game ends, **most points wins, ties shared**; the last remaining seat gets **+3 per live enemy king left** (walking kings of resigned seats); ply cap 1000 / hard 5000; the bare-kings "dead position" rule is **off** (kings can capture kings); no draws by repetition / 50-move / insufficient material in v1 (4PC has them as shared points; our 4-seat games have none). |
| C10 | Claim win / autoclaim | **Not in v1.** |
| C11 | Time controls | The same list 4 Player Chess offers (no Daily); the forum's `1/4\|0` "Hyper Fiesta" is a claim, not offered specially. Online lobbies keyed by time control + variant. |
| C12 | Bots | Same dial / roster, **Chaturaji tiers: greedy + careful, no deep tier in v1** (§7). |
| C13 | Where it appears | Third card "**Chaturaji**" on the Play menu under the two 4 Player cards, with **Local** and **Online**. |
| C14 | Teams / alliances (chess.com has Teams) | **Out of scope** - FFA only, like every 4-seat feature here. |

## 4. The rules, precisely (under the defaults above)

**4.1 Setup.** 8x8, files a-h, ranks 1-8, all 64 squares playable. Seats, order and colours are the 4-seat engine's (Red bottom, Blue left, Yellow top, Green right; Red first). Eight pieces per seat, 32 on the board:

| Seat | Boat | Knight | Bishop | King | Pawns (move direction) |
|---|---|---|---|---|---|
| Red (bottom) | a1 | b1 | c1 | d1 | a2 b2 c2 d2 (up) |
| Blue (left) | a8 | a7 | a6 | a5 | b8 b7 b6 b5 (right) |
| Yellow (top) | h8 | g8 | f8 | e8 | h7 g7 f7 e7 (down) |
| Green (right) | h1 | h2 | h3 | h4 | g1 g2 g3 g4 (left) |

**4.2 Moves.** Boat = rook; bishop, knight, king as in chess; **no castling**; pawn per C4. A move may capture a piece of any other seat, live or dead, **including a king** (C1). **Nothing is illegal because of check**: every pseudo-legal move is legal (a king may walk into an attack, a pinned piece may move).

**4.3 Scoring and elimination.** Per C5-C6 and C7-C8. Capturing a king: the mover scores 3 once, the victim's army becomes inactive immediately, the game may end (three eliminated). A fork scores for the mover (C7).

**4.4 End.** Per C9.

**Worked examples** (each becomes a hand-built scripted test, §11):
1. *Start.* Red's legal first moves, by hand: 4 pawn pushes (a3, b3, c3, d3), the knight b1 to a3 or c3, the king d1 to e1 or e2 (the boat and bishop are boxed in) = **8**, asserted as an exact list; the same count for each seat by the 90° symmetry.
2. *Perpendicular pawns.* A Blue pawn on b5 moves to c5, captures on c4 / c6, never up or down; no seat has a double step.
3. *Capture the King.* Blue's knight takes Yellow's king: Blue +3, Yellow's seven other pieces turn grey, the turn skips Yellow; a Yellow piece could have captured Blue's king instead on its move even though Yellow was "in check" - nothing forced it.
4. *Fork.* A knight lands attacking two live kings: +1 to its owner (and a bishop attacking three: +5); the same knight arriving by a discovered line does not score.
5. *Dead pieces.* A boat takes a grey pawn: legal, 0 points.
6. *Promotion.* A Red pawn stepping or capturing onto a8 / b8 / c8 / d8 ... becomes a boat (a promoted pawn is worth 5 afterwards); no choice is offered.
7. *Walking king.* Green resigns: its army greys out, its king keeps stepping onto empty squares; Red captures it: +3 and it is gone.
8. *End.* Three seats eliminated: the winner is the seat with the most points (not necessarily the survivor); the survivor gets +3 per live enemy king left; a tie for the top is shared.

## 5. What is reused as-is and what is genuinely new

### 5.1 Reused unchanged (the existing 4 Player Chess machinery)
`attackers` / `isInCheck` (needed for fork points and the bot, never for legality here), `CAPTURE_POINTS` and the promoted-piece values, **dead pieces** (inactive, capturable for 0), the **walking dead king** (`dead-king` status, random empty-square steps, freeze when boxed in), `eliminateSeat` / `advance` / `resign` / `playMove` and the event shapes, three-eliminated game end and highest-score winner (`endGame`), the ply cap, `clock.ts`, `setup.ts`, premove resolution (via `findLegalMove`), annotation lifecycle (`state.ply` epoch), the room manager, matchmaker, bot driver and the bot ELO dial (`botStrength`), takeover / retake, chat, spectating, persisted rejoin (the saved `four_match_found` payload already carries the variant), the generated server mirror with its drift check.

### 5.2 Genuinely new (all small, all behind the rules preset)
1. **Geometry** `square8` (a 64-cell mailbox, its own tables from the same builder, forward coordinate, display rotation for 8x8, file letters a-h) next to the existing cross (§8).
2. **Rule options on the rules object**, read at defined points: `captureTheKing` (kings capturable, **no king-safety filter in `legalMoves`**, king capture = score + elimination), `kingPoints` (3), `forkPoints` (`{double: 1, triple: 5}`), `pawnDoubleStep` (off), `promotionTypes` (`[ROOK]`), `deadPositionEnds` (off), `lastStandingKingBonus` (3), `stalemate` outcome (eliminate, 0 points), a `startPosition` per geometry.
3. **Check-fork points** (C7): after `applyMoveRaw`, count live enemy kings attacked by the moved piece (a small variant of `attackers` keyed to one piece).
4. **King-capture elimination**: `eliminateSeat(..., 'kingCaptured')` (a fourth reason next to checkmate / stalemate / resign / timeout) and the walking-king capture rule.
5. **Snapshot text for 8x8** (8 rows) and the Chaturaji start position; the wire's variant value `'chaturaji'`.
6. **Bot terms** for Capture the King (§7), an **8x8 board rendering path** and texts (§9).

## 6. Wire and server changes (backward compatible)

- `FourVariant` (single wire file, generated to the backend) gains `'chaturaji'`; `rulesFor('chaturaji')` returns `CHATURAJI_RULES`; `validateFourVariant` accepts it. **Event names do not change**; every `four_*` event already carries `variant`. `FourReason` gains `kingCaptured`-related reasons only if the end reasons differ (the end reasons stay `elimination | cap` plus `abandoned`; the elimination *event* gains the new reason).
- **The snapshot is variant-aware already** (the client reads it with the room's rules). With geometry carried by the rules, `serialize` / `deserialize` use the geometry's row count: **a 4 Player Chess / Giveaway snapshot is byte-identical** (same 14 rows), a Chaturaji one has 8.
- Moves: `from` / `to` are square names; `a1`-`h8` is a subset of the existing grammar; the optional promotion letter is never needed (promotion is forced to the boat).
- **Rollout safety = D15 again:** the client sends `variant: 'chaturaji'` only for Chaturaji and refuses to play unless `four_match_found` echoes it (an old server would ignore the field and queue the player into a Chess game). Deploy backend first. Old clients are unaffected.
- **Compatibility matrix** (each cell a test): new client + new server; new client Chess / Giveaway + new server (identical to today); old client + new server; new client Chaturaji + old server (refuses with a clear message).

## 7. Bots

Same ELO dial (`botStrength`: `bestChance`, `noise`, tiers) and roster; a Chaturaji evaluation next to the Chess and Giveaway ones, dispatched by the position's rules (`chooseBotMoveFor`) so a wrong bot can never be attached. Under Capture the King the dominant terms are: **points won** (captures incl. kings, dead pieces 0), **do not leave your king capturable by the next active seat** (it eliminates you - the largest penalty; the existing "hanging piece" term extended with a king weight), **king hunting** (a capture of a king is worth 3 *and* removes a rival), **fork points**, a promotion bonus and a small advance term. Tiers: **greedy** (elo < 1000: points and material, will hang its king), **careful** (>= 1000: adds the king-safety and hanging-piece terms and the next-seat reply); **no deep tier in v1**. The existing tiers' structure (`bot.ts`: scoring one ply, next ACTIVE seat's reply) is reused; what changes are the evaluation terms. Server: the same injectable chooser seam; takeover bots keep the human's name; fill bots Amateur 1200. Decision cost is measured per tier and asserted structurally (not by wall-clock thresholds that flake - see TESTING §27) and reported.

## 8. Architecture: (S) a separate 8x8 engine vs (G) generalise the existing engine

v1 recommended S on the argument that a geometry parameter would be "threaded through ~1,200 mirrored lines". **That was wrong**: the real coupling is ~45 references (§2), the engine is *already* a rules-preset engine (Giveaway), and your point that chess.com builds Chaturaji out of 4PC rule options is exactly the shape the engine already has. Honest comparison, with what each option really involves:

### 8.1 (S) A separate 8x8 engine
New `src/logic/chaturaji/` (board, state, moves, elimination / scoring, serialization, bot), added to the mirror manifest, behind a small `SeatGameEngine` seam so rooms and screens pick an implementation by variant; share only the table *builder*, seats, clocks, setup and result / event types.
- **Reuse of our FFA rules: low.** Because Chaturaji needs check *detection* (fork points, bot), **walking dead kings**, dead pieces that stay capturable, scoring with promoted-piece values, three-eliminated end and highest-score winner - everything the FFA engine already does - S **re-implements about 650 lines of it** (`attackers` ~75, `pseudoMoves` ~90, `legalMoves` ~25, `applyMoveRaw` ~35, elimination / advance / resign ~150, state + serialize ~120, bot ~160) in a second place that must be kept in step forever (a fix to dead-king walking, score handling or event shapes must be made twice).
- **Risk to 4 Player Chess / Giveaway: none by construction** - their files are not edited (except extracting the table builder, covered by an identity test).
- **Mirrored-line impact:** the existing mirrored files are unchanged; a new folder (~900 lines) is added to the manifest.
- **Wire / rooms:** a second engine means a **seam** in the room manager (12 call sites) and in the client hook / reducer - new indirection in code that works today.
- **Tests:** a full new engine suite (rules, scripted games, parity, fuzz) with nothing inherited; the FFA suites are not exercised by Chaturaji.
- **Estimate:** W0 seam ~1-1.5 d, W1 engine 3-3.5 d (it now includes check detection, DKW, fork points), W2 1.5-2, W3 2-3, W4 1-1.5, W5 1 = **~10-12.5 days**.

### 8.2 (G) Generalise our 4-seat engine: a `square8` geometry + Chaturaji as 4PC rule options (recommended)
- **Geometry** (§5.2 item 1): extract `buildGeometry({ size, isPlayable })` from `board.ts` (the code that already produces `VALID`, `RAYS`, `KNIGHT_TARGETS`, `KING_TARGETS` from one predicate), keep the **cross14** instance as exactly today's exported constants (so every untouched caller and test compiles unchanged), add **square8**, and give `FourPlayerRules` a `board` field. The ~25 edit sites read `geometryOf(state.rules)` once at function entry (hoisted out of the hot loops; the arithmetic per ray step is unchanged). `PAWN_START_COORD`, `FFA_PROMOTION_COORD`, the start layout and the rotation helpers become geometry / rules data.
- **Rule options** (§5.2 item 2) as fields of the rules object with a preset `CHATURAJI_RULES`, validated so that **only the three presets exist** (FFA, Giveaway, Chaturaji): an arbitrary option mix is refused, so no untested combination (for example Capture the King on the cross board) can be reached.
- **Reuse of our FFA rules: high** - everything in §5.1 is shared, not copied; the new code is §5.2 (~250-350 changed lines in the mirrored files + ~200 new).
- **Risk to 4 Player Chess / Giveaway: real but gated.** Every mirrored file except `giveaway.ts` / `clock.ts` is edited (`board`, `state`, `moves`, `elimination`, `bot`, plus the wire), so a mistake could change FFA. The gates: the **FFA golden transcripts that already exist** (`fourPlayerFfaGolden.test.ts`: 48 seeded games + 9 scenes hashed from the engine *before* the Giveaway work - positions, legal-move lists, bot decisions, events) must stay byte-identical; I add, **before touching the engine**, a **Giveaway golden** recorded the same way and a **geometry identity test** (the extracted cross tables equal the recorded `VALID` / `PLAYABLE_SQUARES` / `RAYS` / `KNIGHT_TARGETS` / `KING_TARGETS` byte for byte; `toDisplay` / `fromDisplay` for 14 equal today's); a before / after **hot-path benchmark** of `legalMoves` and a bot game (a measured, asserted-structurally comparison, not a feeling).
- **Mirrored-line impact:** the five mirrored files change and the generator regenerates the backend copy (`sync:fourplayer --check` in CI); because both repos change together the work uses **paired branches** (`paired/<x>`), as Giveaway did. More mirrored diff than S, but regenerated, never hand-edited.
- **Wire / rooms: nothing new** - the variant, rooms, matchmaker, bot driver, rejoin and the snapshot path already treat the rules as opaque; no engine seam is needed.
- **Tests:** the existing suites run unchanged (they are the regression net); new tests are rules / option tests for the Chaturaji preset, scripted games, parity and fuzz for the new variant, plus the option-by-option mutation set.
- **Estimate:** W0 geometry + options plumbing, **no behaviour change** (goldens, identity, benchmark) ~1.5-2 d; W1 Chaturaji rules + 8x8 snapshot + wire ~2-2.5 d; W2 bot + server loop ~1.5-2; W3 screens ~2-3; W4 ~1-1.5; W5 ~1 = **~9-12 days** (about a day less than S: it spends more in W0 and saves the duplicate engine).

### 8.3 Side by side

| | **S separate engine** | **G generalise + options** |
|---|---|---|
| Matches how chess.com builds it | no | **yes** |
| FFA rules reused (check, scoring, dead pieces, walking king, elimination, bot dial) | re-implemented (~650 lines, twice forever) | **shared** |
| Risk to 4 Player Chess / Giveaway | none by construction | real, **gated** by existing goldens + 3 new gates |
| Mirrored files edited | 0 existing (+1 new folder) | 5 existing (regenerated) |
| Room / client seam needed | yes (12 + n call sites) | no |
| Estimate | 10-12.5 d | **9-12 d** |
| What could go wrong | two engines drift apart over time | W0 reveals a perf regression or an FFA drift |

**Recommendation: (G).** It is the smaller total change, it keeps one implementation of the rules that are shared by construction, and the risk it adds is the kind our process already controls (golden transcripts, drift check, parity, mutation). **Decision point inside the plan:** W0 ends with a stop-and-review; if the golden gate cannot be kept byte-identical, or the benchmark shows a hot-path regression I cannot remove, I stop and we switch to S - W0 changes no behaviour, so nothing is wasted but the day.

## 9. Frontend (screens and UX)

- **Entry:** Play menu -> **Chaturaji** card -> **Local** (-> `FourPlayerSetupScreen` with a variant-aware title / intro -> `TimeControlSelectScreen` excluding Daily -> `FourPlayerGameScreen variant="chaturaji"`) or **Online** (login gate -> time control, excluding Daily and "No time limit" -> `FourPlayerMatchmakingScreen` -> `FourPlayerOnlineGameScreen`). `variant` rides in the screen state as it does for Giveaway.
- **Board:** `FourPlayerBoard` reads the geometry from the state's rules (size, playable mask, rotation) - the rendering path for 64 cells at about 1.75x the cell size; the 14x14 case is exactly today's. `getFourPlayerCellSize(360, 640) = 21` is pinned by a test and stays for the cross board; Chaturaji gets its own function with its own pinned values at 360x640 and 412x915. Annotations: epoch `state.ply` as in the other 4-seat modes, the no-move turn advances (an eliminated seat skipped, a flag fall) added to `annotationLifecycle.test.ts`.
- **Presentation (pure, unit-tested):** status line, seat cards with **points** (as 4 Player Chess), result card (points table, winner(s), reason "Three players eliminated" / "Move limit reached"), `describeEvents` (capture with points, **king captured -> army eliminated**, fork points, walking king, resign / flag), the rules hint on setup / queue ("Capture kings and pieces - the most points wins; a king must be captured, check need not be answered"). The check highlight (`isInCheck`) is reinterpreted as a **"king attacked" marker** (amber ring + outline, the same theme-safe pattern as the Giveaway capturer ring) and a one-line pill "Your king is attacked" that *replaces* the status line (height-neutral, the pattern of this week's capture banner) - useful precisely because nothing forces you to answer.
- Dead pieces render grey (the existing dead-piece art path).

## 10. Workstreams and order (branch `paired/chaturaji` in both repos, from `master` / `main`)

Each row is a vertical slice that touches **Local, Bots and Online** where the slice has something to say; each ends with the stop-and-review rule. Mutation checks use the copy-based harness, equivalents documented, performance numbers reported per slice (asserted with load-robust, best-of-N or structural measures).

| | Slice | Local | Bots | Online | Size | Independent? |
|---|---|---|---|---|---|---|
| **W0** | **Geometry + options plumbing, no behaviour change.** First: record a **Giveaway golden** on master (same kit as the FFA one) and a before-benchmark. Then `buildGeometry`, `cross14` = today's constants, `square8`, `board` on the rules, the ~25 edit sites read the geometry; rule-option fields exist with FFA / Giveaway defaults; `validateRules` (only the three presets); the mirror regenerated. Gates: FFA + Giveaway goldens byte-identical, the table identity test, the existing suites unchanged, the after-benchmark. | the engine every local game runs | - | the engine the server runs | **M, ~1.5-2 d**, ~300 changed lines + ~500 test lines | yes |
| **W1** | **Chaturaji rules + 8x8 snapshot + wire.** `CHATURAJI_RULES`; Capture the King in `legalMoves` / `applyMoveRaw` / `eliminateSeat`; king points 3; fork points; no double step; boat-only promotion; the start position; stalemate = eliminate; walking-king capture; last-standing bonus; dead-position off; 8-row snapshot; `'chaturaji'` on the wire; hand-built scripted tests (§4 examples); parity script with seeded Chaturaji games; mirror regenerated. | the engine | the move set | the contract | **L, ~2-2.5 d**, ~250-350 changed + ~200 new + ~1,200 test lines | after W0 |
| **W2** | **Bot + the whole game loop in-process.** Chaturaji evaluation + tiers; room manager / matchmaker / handlers accept the variant; a full game (bots, takeover, retake, fast-forward, resign, flag fall) on stub sockets and the local game logic on seeded replays; compatibility matrix. | local logic with bots | heuristic, dial, perf | server plumbing | **M, ~1.5-2 d** | after W1 |
| **W3** | **Every screen.** Menu card, setup texts, 8x8 board path + cell-size function, seat card, result card, status variants, "king attacked" marker and pill, the online client (reducer, queue, game, spectator, Spectate list rows, echo check), annotation-lifecycle additions, source pins; web verification at 360x640 and 412x915, both themes. | playable end to end | bots on screen | online screens | **L, ~2-3 d** | after W1-W2 |
| **W4** | **Real sockets.** e2e scenarios (king capture eliminates, promotion to boat, points and forks, walking king, flag fall, takeover bot, spectator, lobbies never mix, persisted rejoin), the nightly fuzz section, CI / nightly wiring. | - | server bots over sockets | the whole protocol | **M, ~1-1.5 d** | after W1-W3 |
| **W5** | **Close-out.** Docs roll-up (both TESTING.md, TODO.md), final mutation re-run, browser verification (two humans needed - a lone human never gets bots; backend with `FOUR_FILL_MS` / `FOUR_GRACE_MS`; I will ask for the login hand-off up front). | browser pass | bot fill on screen | two-tab pass | **S, ~1 d** | last |

**Total: about 9-12 working days across six stop-and-review cycles** (S: ~10-12.5).

## 11. Test plan (CHECKLIST 2, 3, 4, 5)

**4 Player Chess and 4 Player Giveaway stay untouched - what proves it (the L4 gate, G):** (1) the **FFA golden transcripts that already exist** (48 seeded games + 9 scenes: every position, legal-move list, bot decision and event hashed from the engine before any Giveaway change) must stay byte-identical after every workstream; (2) a **Giveaway golden** recorded on master *before* W0 (new, same kit); (3) the **geometry identity test** (the extracted cross tables, `toDisplay` / `fromDisplay`, the 14-row snapshot text equal the recorded ones); (4) the 22 frontend test files and the backend's `sync:fourplayer --check`, `test:fourplayerSync`, `test:fourplayer` (parity), rooms, bots, matchmaking, handlers, online e2e and Giveaway scripts run **unchanged and green**; (5) a before / after **benchmark** of `legalMoves` and a bot game on the cross board (structural, best-of-N); (6) the cell-size pin `getFourPlayerCellSize(360, 640) === 21`; (7) the rules **validator** refuses every option mix except the three presets, so an option can never leak into FFA or Giveaway.
**Edge cases, each with a named test (hand-built positions):** the exact first moves of each seat; pawn directions for all four seats incl. perpendicular neighbours; diagonal capture, no double step, no en passant; promotion by push and by capture on each seat's far edge to a boat only, and its 5-point value afterwards; boat / bishop / knight / king move sets incl. blocked by dead pieces; **a king moving into check is legal, a "pinned" piece moves**; **king capture** by a pawn, knight, slider and king, +3 once, army grey at once, turn skipping, game end at three eliminated; capturing the king of the seat next to move and of the seat that just moved; a seat captured while it was "in check" and one that ignored a check; **fork points** (2 -> +1, 3 -> +5, discovered check scores 0, dead kings and eliminated seats' kings not counted, the mover's own king not counted); dead pieces capturable for 0; **walking king** (resign / timeout, random empty-square steps, capture +3, boxed-in freeze); stalemate = elimination without points; resign / flag of the mover and off-turn; three eliminated decided **by points, not survival** incl. a survivor who is not the winner; the +3-per-live-king bonus; the cap and hard ceiling with a tied top score; dead-position rule **off** with bare kings; every result reason round-trips through `serialize` / the wire; 8-row snapshot round-trip (random seeded positions); Undo across a king capture (local); a premove cancelled by an elimination.
**Deterministic scripted games:** hand-built games forcing each end reason and asserting exact events, results and scores (not only seeded random ones).
**Parity (CHECKLIST 4):** the generated server copy and `sync:fourplayer --check` (CI); the parity script replays seeded Chaturaji games through the app engine and the generated copy in lockstep (identical snapshot, events, legal-move lists and bot choices at every ply); the nightly fuzz gets a Chaturaji section with four real clients on the app's engine.
**Performance (CHECKLIST 3):** `legalMoves` on the 64-cell board and on the cross board before / after; bot decision mean / p99 / max per tier; a 1000-ply game's CPU; snapshot size. Assertions are structural or best-of-N, never single wall-clock samples. **Mutation checks** on the new logic (king capture = score + elimination, fork counting and its exclusions, pawn direction per seat, no double step, promotion piece / line, dead-piece scoring, walking-king capture, end conditions and their order, winner-by-points, last-standing bonus, validator, variant echo, the bot's king-safety term) with the copy-based harness, plus mutants on the W0 geometry reads. **Cross-feature (§12), docs:** doc comments on every new file; a "Chaturaji" section per repo's TESTING.md per workstream, then the roll-up; TODO.md.

## 12. Interactions (CHECKLIST §1, second box) - stated, not assumed

- **4 Player Chess and 4 Player Giveaway:** unchanged behaviour (§11 gates). One room has exactly one variant, fixed at creation; the lobby key `tc|variant` means three games can never share a lobby or a room.
- **2-player modes, tournaments, challenges, Setup Chess, ratings, achievements, history, PGN, analysis, puzzles:** unaffected, as for the other 4-seat games (4-seat games are not saved, rated, analysable or PGN-exportable in v1; chess.com also rates by placement only and this app has no 4-seat rating).
- **Bots:** the 2-player bots and the two existing 4-seat bots are untouched; the Chaturaji evaluation is used only for Chaturaji positions (dispatch on the rules).
- **Online mutual exclusivity:** Chaturaji is its own preset with no combining flags and a validator that refuses any other option mix.
- **Persisted rejoin:** the saved `four_match_found` payload carries `variant`; the restart path restores the right rules via `rulesFor`; a dedicated e2e case in W4.
- **Premoves / arrows / Undo (local):** kept (rules-agnostic board and hooks).
- **The capture-hint feature:** not applicable (no mandatory capture); its patterns are reused for the "king attacked" marker (§9).

## 13. Known limits (deliberate, v1)

No Teams / alliances (C14); no claim win / autoclaim (C10); no draw-by-repetition / 50-move / insufficient-material shared points; no dice, jumping boat, boat triumph or sinhasana (not in chess.com's version); no deep bot tier; bots are a first-version heuristic; no ratings, history, saved games, PGN or analysis (same as the other 4-seat games); no "game aborted if a player leaves before everyone has moved three times" rule (the 4PC site has it; our 4-seat games do not); no private rooms; a lone human can wait in the queue indefinitely; web verification only (no React Native renderer or device here).

## 14. Please confirm (only what is genuinely open)

1. **Architecture (§8): G - Chaturaji as a rules preset + an `square8` geometry of our 4-seat engine - rather than S, a separate engine.** I recommend G; W0 is the checkpoint where we can still switch to S. *(Needed before W0.)*
2. **C7 - check-fork points:** awarded when the **moved piece** attacks 2 (+1) / 3 (+5) live enemy kings from its new square; discovered checks do not score. (Sourced only by analogy with the 4PC table; if you can see "double check" in a game log or the panel, tell me what scored.)
3. **C8 - no-move seat:** eliminated with no points (the 4PC mechanism). And **resign / timeout:** the army dies but **the king keeps walking** (4PC standard), a walking king can be captured for 3.
4. **C9 - end of game:** three eliminated, **most points wins (ties shared)**, survivor +3 per live enemy king, cap 1000 / 5000, bare-kings dead-position rule off, no draw-by-repetition / 50-move / insufficient material.
5. **C10 - claim win / autoclaim not in v1.**
6. **C11 - time controls:** the normal 4-seat list (no Daily), no special `1/4|0`.
7. **C12 / C13 - bot (greedy + careful tiers) and a third Play-menu card "Chaturaji" with Local and Online.**
8. **C5 detail:** a promoted pawn counts as a boat (5 points).
9. **C14 - FFA only** (no Teams).

**Needed before W0:** item 1 (and your eye on 3 and 4 if the live game shows them). Everything else has a default I will build unless you say otherwise.
