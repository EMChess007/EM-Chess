# Chaturaji (4-seat, 8x8) — spec (v1, SPEC ONLY — nothing is implemented)

Status: **draft for review. No code, no branch, no engine work exists for this yet.** Written per CHECKLIST.md ("spec before code"), in the same shape as `FOUR_PLAYER_GIVEAWAY_SPEC.md` and `FOUR_PLAYER_ONLINE_SPEC.md`. Covers both repos: frontend `EM-Chess` (this one) and backend `chess-app-backend` (`backend/`).
Same process as the two earlier 4-seat features: **every workstream builds Local, Bots and Online together for its slice** (§10), after each workstream I stop and wait for an explicit "go", nothing is pushed or merged unless asked. Items marked **[confirm]** are details where the sources disagree or are silent and I chose a default; they are collected in §14. **Read §1 first: chess.com's own Chaturaji rules are not available in one authoritative, readable place, and the sources I could read contradict each other on the single most important rule (check / checkmate).**

## 0. Summary (the 3-5 sentences)

Chaturaji is a four-player, free-for-all chess variant on an **8x8** board: each seat (Red, Blue, Yellow, Green, clockwise, Red first) starts with eight pieces in one corner - four pawns, a king, a bishop, a knight and a **boat** (moves like a rook) - there are no dice and no queens, pawns always promote to boats, and the winner is the player with the **most points** (captures are worth points). It is a **third game kind next to 4 Player Chess and 4 Player Giveaway**, using the same four seats, clocks, rooms, matchmaker, bot driver, takeover / retake, chat, spectating and persisted rejoin; what is genuinely new is a **separate 8x8 rules engine** (the existing 4-seat engine is hard-wired to the 14x14 cross board and 160 squares), its bot heuristic, an 8x8 board UI, and the 8x8 snapshot text on the existing `four_*` wire. I recommend a **separate engine, not a geometry parameter threaded through the existing one**, sharing only the *table builder* (so ray / knight / king tables and board rotation are built by the same code) so that 4 Player Chess and 4 Player Giveaway stay byte-for-byte unaffected, proven by recorded fixtures and by their existing suites running unchanged (§8, §11). Because the rules are only partly documented, **fourteen [confirm] decisions** (§14) must be answered before W0 - three of them (C1 check model, C2 start layout, and the architecture choice) change what is built first and how big it is.

## 1. What chess.com actually says (sources read, and what I could not read)

**Read (and what each is):**

| Source | What it is | What it gave me |
|---|---|---|
| [chess.com/terms/chaturaji](https://www.chess.com/terms/chaturaji) | chess.com's own glossary page ("Chaturaji: Rules, History & How to Play") | 8x8; each player has **4 pawns + king + bishop (originally "elephant") + knight + boat**; boat = rook movement; Red moves first, then Blue, Yellow, Green; **no dice** (you choose the piece); **pawns always promote to boats on the last rank**; points per capture **pawn 1, knight 3, king 3, bishop 5, boat 5**; "double check +1, triple check +5"; **"There are no checks or checkmates"**; a player who **loses their king is eliminated and their pieces become inactive**; capturing inactive pieces scores nothing; goal = more points than the opponents. Starting squares exist only as a picture. The page contradicts itself on check (points for checks, but "no checks"). Stalemate, the end condition and time controls are not covered. |
| [forum: Chaturaji Strategy](https://www.chess.com/forum/view/chess-variants/chaturaji-strategy?lc=1) (quotes the in-app info screen, 2021 and later) | player-written, but quotes the game's own "?" panel | Gameplay begins with Red, **clockwise Red, Blue, Yellow, Green**; "pawns will promote on your 8th rank" (promote to Ships); pieces become **"dead" (grey) when a player is eliminated, capturing them scores nothing**; **"the game is finished when three players have been eliminated"**; "**the last remaining player will be given +3 for each enemy king left on the board**"; "in case of insufficient material, threefold repetition or the 50-move rule the remaining players share +3"; "points do not directly affect rating changes, only final placement does"; "a disconnected player has 60 seconds to reconnect"; **claim win / autoclaim** (a player so far ahead on points that they win even if they resign). The poster notes the info text is the general 4-player-FFA text (it lists queens, which Chaturaji does not have), so some lines may not apply. Players also talk about "mating nets" and "check the player on your left", i.e. check exists in play. |
| [forum: Chaturaji history on chess.com, openings and trading](https://chess.com/clubs/forum/view/chaturaji-history-on-chess-com-openings-and-trading-1) (Botbeg, 2023, crediting an earlier article) | player history of the implementation | chess.com added Chaturaji to its 4-player server; first version **BNRK** (bishop-knight-rook-king), later **RNBK** "the same starting position as the chaturaji we have in the variants server"; **"3 pt mate" and "capture-the-king" were added later** (so the *current* variant has checkmate worth 3 points **and** king capture); in Teams mode you lose if your teammate is checkmated; default time control **1/4\|0 "Hyper Fiesta"** (a forum claim, not official); another "1\|5 Chaturaji". |
| [forum/blog: Chaturaji basic opening theory](https://www.chess.com/forum/view/chess-variants/chaturaji-basic-opening-theory) | opening advice | Red's **king starts on d1**; pawns are numbered 1-4, "1 is the rook pawn, 4 is the king pawn"; Red moves first. Diagrams are images. |
| [forum: Chaturaji history and modernity](https://www.chess.com/clubs/forum/view/chaturaji-history-and-modernity) | club thread | debates a "standard" vs a proposed "modern" start (the **green knight and king swapped** - i.e. the standard chess.com layout is **not** a perfect rotation of Red's); historical scoring 1/2/3/4/5; same info-screen lines as above. Not an official statement. |
| [Wikipedia: Chaturaji](https://en.wikipedia.org/wiki/Chaturaji) | the **historical** game | Dice, boats that jump two squares diagonally, a king worth 5, "boat triumph", "sinhasana", pawn promotion to a captured piece. **None of this is in chess.com's version** (no dice; boat = rook there), so I use it only to name what I am *not* implementing. |
| [support.chess.com: How do I challenge a friend to a chess variant](https://support.chess.com/en/articles/16202719-how-do-i-challenge-a-friend-to-a-chess-variant) | official help | variants are **web only**; multiplayer variant games can have **players replaced by bots**; custom time control is chosen when challenging. **Chaturaji is not mentioned.** |

**Could not read / not found:** the live variant page `chess.com/variants/chaturaji` (it returned only site navigation: the rules panel is rendered client-side and needs a login), `chess.com/blog/CBO1245/chaturaji` (returned a blog listing), `chessvariants.org` (HTTP 403), and **no `support.chess.com` article about Chaturaji exists in the search results** (a site search returned nothing). I also found nothing official about bots in Chaturaji or its time controls beyond the forum claim above.

**What this means.** The rules below are my best reconstruction from the sources above, *not* a verified copy of chess.com. Where sources conflict I say so and propose a default. **The most useful thing you can do is open the "?" info panel / setup picture of Chaturaji on chess.com (you can see it, I cannot) and answer C1-C3 from it.**

## 2. Premises checked against the code

| Premise | The code says | Consequence |
|---|---|---|
| "The 4-seat engine is hard-wired to the 14x14 cross board" | **True.** `board.ts`: `SIZE = 14`, `CELLS = 196`, `VALID` (160 playable, 36 cut-corner cells), `FORWARD`, `PAWN_START_COORD = 1`, `FFA_PROMOTION_COORD = 7`; the tables `RAYS`, `KNIGHT_TARGETS`, `KING_TARGETS` are built once at import and baked into every move generator. `state.ts` hard-codes the start layout (king squares, castling squares, back-rank order incl. a queen), the cell array is `Int8Array(196)`, and the snapshot text is "14 rows ... 196 cells". Besides `board.ts` itself, about seven frontend files read these constants (`boardSize.ts`, `FourPlayerBoard.tsx`, `presentation.ts`, `annotations.ts`, `state.ts`, `moves.ts`, `activeGame.ts`). | A geometry parameter would have to be threaded through ~1,200 lines of mirrored, hot, parity-tested code. See §8. |
| "Seats, clocks, rooms, bots, rejoin are reusable" | **Mostly true.** The room manager (`backend/src/game/fourPlayerRooms.ts`, 848 lines) calls the engine through ~12 functions only (`initialState`, `legalMoves`, `findLegalMove`, `playMove`, `resign`, `clockTick`, `serialize`, `chooseBotMoveFor`, `rulesFor`, `piecesLeft`, `parseSquare`, `deserialize`) and a `variant` already rides on the room, the lobby key and the wire (Giveaway). `clock.ts` has no geometry. `SeatConfig` / setup is rules-agnostic. | A small engine **seam** (§8.2) lets a third game kind plug in. |
| "The room manager only knows `ffa` / `giveaway`" | `FourVariant = 'ffa' \| 'giveaway'` in the single wire file; `validateFourVariant` refuses anything else. | The wire needs a third value (`'chaturaji'`), backward compatible exactly like D15 of the Giveaway spec. |
| "The new capture-hint UI (this week) is reusable" | `MandatoryCaptureBanner`, `useCaptureNudge`, the capturer ring. | They are **Giveaway-specific** (they exist because a capture is mandatory). Chaturaji has no mandatory capture (§4), so the banner is not used; the *patterns* are (§9.4). |

## 3. Decisions

**Locked in by your brief**

| | Decision |
|---|---|
| L1 | Local + Bots + Online are built **together**, every workstream a vertical slice across all three (§10). |
| L2 | Reuse the proven 4-seat infrastructure (rooms, matchmaker, bot driver scheduling, clocks, rejoin incl. persisted rejoin, chat, spectate) rather than fork it. |
| L3 | Same quality gates as the earlier 4-seat features: spec first, hand-built deterministic scripted tests, mutation checks on copies, performance numbers, explicit cross-feature check, generated (not hand-mirrored) server engine with a CI drift check, a parity script, nightly fuzz, docs. |
| L4 | **4 Player Chess and 4 Player Giveaway stay untouched** - proven by a recorded-fixture gate (§11). |

**Rule decisions - each with my proposed default, all [confirm]** (reasons in §4; the C-numbers are the ones in §14)

| | Question | Proposed default **[confirm]** |
|---|---|---|
| C1 | **Check / checkmate?** (sources conflict, §1) | **No check, no checkmate. The king is an ordinary capturable piece; capturing a king eliminates that seat.** (chess.com's own glossary; simplest; matches "capture-the-king".) The alternative **C1-B** is 4 Player-style check and checkmate (checkmated seat eliminated, +3 to the credited mater, plus the +1 / +5 multi-check points) - see §4.4. |
| C2 | Start layout (the real one is only a picture) | **Corners, each army rotated 90° clockwise from Red's**: Red a1 boat, b1 knight, c1 bishop, d1 king, pawns a2-d2 (moving up); Blue a8 / a7 / a6 / a5 (K on a5), pawns b8-b5 (moving right); Yellow h8 / g8 / f8 / e8 (K on e8), pawns h7-e7 (moving down); Green h1 / h2 / h3 / h4 (K on h4), pawns g1-g4 (moving left). Anchored on "king on d1 for Red, RNBK, pawn 1 = rook pawn, pawn 4 = king pawn". The forum says the real "standard" is not perfectly rotational, so this is the biggest unverified fact. |
| C3 | Boat movement | **Rook** (the chess.com glossary), not the historical 2-square diagonal jump. |
| C4 | Pawns | One step forward only (no double step, hence **no en passant**), capture one step diagonally forward, promote to a **boat only** on the far edge ("your 8th rank": Red rank 8, Yellow rank 1, Blue file h, Green file a). |
| C5 | Dead (eliminated) pieces | Stay on the board, grey, **capturable for 0 points**, block squares and rays, never "attack" anyone (the glossary and the info screen). **No walking dead king** (the 4 Player Chess engine has one; nothing says Chaturaji does). |
| C6 | Points | Capture a **live** piece: pawn 1, knight 3, king 3, bishop 5, boat 5 (a promoted pawn is a boat = 5 **[confirm]**); dead pieces 0. No points for check under C1-A. |
| C7 | A seat with no legal move on its turn | **Passes** (its turn is skipped, nothing else changes) - rare without check. Sources are silent; the 4 Player Chess "stalemate eliminates with points" rule exists because of checkmate. |
| C8 | End of game and winner | The game ends when **three seats are eliminated**, or at the **ply cap**, or when **no capture is possible any more** (every active seat is a bare king / only kings can move and none can reach another - "dead position", as the 4 Player Chess engine already has). **Winner = highest points among all four seats (not only the survivor); ties shared.** The info screen's "+3 per enemy king left for the last player" is **not modelled** in v1 (the 4 Player Chess engine does not model it either). |
| C9 | Draws (threefold, 50-move, insufficient material) and "claim win" | **None in v1** (consistent with 4 Player Chess here: no draws, ply cap instead). Claim win / autoclaim are an early-end convenience, not a rule; omitted. |
| C10 | Resign and flag fall | The seat is eliminated (pieces go dead, C5), no points change, the game continues (exactly the 4 Player Chess behaviour). |
| C11 | Teams / alliances | **Out of scope** (chess.com has a Teams mode; this app's 4-seat features are all FFA). |
| C12 | Time controls | The same set 4 Player Chess offers (no Daily). Hyper-bullet-style `1/4\|0` is a forum claim; I will **offer the normal list** and not special-case it. Online lobbies keyed by time control + variant, as today. |
| C13 | Bots | A new heuristic (§7), the same ELO dial and roster; **no deep tier in v1**. |
| C14 | Where it appears | A third card "**Chaturaji**" on the Play menu under the two 4 Player cards, with **Local** and **Online** buttons, same login gate. |

## 4. The rules, precisely (as I would implement them, under the defaults above)

**4.1 Setup.** 8x8 board, files a-h, ranks 1-8, all 64 squares playable. Four seats in clockwise turn order Red, Blue, Yellow, Green (same `Seat` type and colours as the 4-seat engine), Red first. Start layout per C2:

| Seat | Boat | Knight | Bishop | King | Pawns (move direction) |
|---|---|---|---|---|---|
| Red (bottom) | a1 | b1 | c1 | d1 | a2 b2 c2 d2 (up the ranks) |
| Blue (left) | a8 | a7 | a6 | a5 | b8 b7 b6 b5 (right along the ranks) |
| Yellow (top) | h8 | g8 | f8 | e8 | h7 g7 f7 e7 (down) |
| Green (right) | h1 | h2 | h3 | h4 | g1 g2 g3 g4 (left) |

(Rotation check: a1 -> a8 -> h8 -> h1 under a clockwise quarter turn; the glossary's "pawns move perpendicular to neighbouring pawns" holds: Red's pawns go up, Blue's go right.) Eight pieces per seat, 32 on the board.

**4.2 Moves.** Boat = rook; bishop, knight, king as in chess (the king one step in any direction); **no castling**. Pawn: one step forward onto an empty square, capture one step diagonally forward, no double step, no en passant (C4). A move may capture a piece of any other seat (live or dead). Moving into "check" is legal because check does not exist (C1-A); a king attacked by a seat that moves next to it is simply capturable.

**4.3 Capturing, points, elimination (C1-A).** A capture of a **live** piece scores its value (C6) to the mover. Capturing a **king** eliminates that seat: its remaining pieces turn dead (C5), the turn passes on, the capturer scores 3 for the king like any capture. Resign or a flag fall eliminates the same way with no points (C10). Eliminated seats are skipped in the rotation. A seat whose pawn reaches the far edge promotes it to a boat at once (no choice to ask for; the move carries no promotion letter).

**4.4 The alternative C1-B (4 Player-style check).** If you answer that chess.com's current Chaturaji has check and checkmate: the engine keeps king-safety legality (a move may not leave your own king attacked), a seat with no legal move is **checkmated** (eliminated, the seat credited with the mate gets **+3**, the "3 pt mate" of the forum) or **stalemated** (passes / eliminated: another [confirm]), multi-checks score +1 (two kings attacked at once) / +5 (three), the dead-king walk question reappears, and king capture still exists as a fallback. This is, by my guess, **a good third more engine and a heavier bot**, reusing the *ideas* of the existing 4 Player Chess check / `mateCredit` code (not its code: different board). It is a switch of rules inside the new engine, decided now so W1 builds the right one - not a later add-on.

**4.5 End.** Three eliminated seats, the ply cap (the same 1000 / hard 5000 as the 4-seat engine), or no capture possible any more (C8). Winners = highest points, ties shared.

**Worked examples** (each becomes a hand-built scripted test, §11):
1. *Start position.* Red's legal first moves, by hand: 4 pawn pushes (a3, b3, c3, d3), the knight b1 to a3 or c3 (d2 is its own pawn), the king d1 to e1 or e2 (the boat and bishop are boxed in) = **8 moves**, asserted as an exact list; the same count for each seat by symmetry.
2. *Pawns perpendicular.* A Blue pawn on b5 moves to c5 (right), captures on c4 / c6 (diagonally forward), never up or down.
3. *King capture.* Blue's knight captures Yellow's king: Yellow is eliminated, its seven other pieces turn grey, Blue +3, the turn skips Yellow.
4. *Dead piece.* A boat captures a grey pawn: legal, 0 points, and it can be captured again by anyone.
5. *Promotion.* A Red pawn on a7 steps to a8 (if that square is empty) and becomes a boat; a Red pawn on b7 captures onto a8 / c8 and becomes a boat. Boat points afterwards = 5.
6. *Ply cap / no-captures end.* Winner by points, tie shared.
7. *Flag fall.* The mover's clock hits zero: eliminated, pieces dead, play continues; if only one active seat is left the game ends and the winner is chosen **by points** (not by being last).

## 5. What is reused as-is and what is genuinely new

### 5.1 Shared as-is
Seats / `nextSeat` / seat colours (`board.ts`, one import), `clock.ts` (four clocks, increment, `clockTick`), `setup.ts` (`SeatConfig`), the event / result **shapes** (`GameEvent`, `FourPlayerResult`), the whole server room machinery (commit funnel, lazy clocks, grace / takeover / retake, all-gone, chat, spectating, finished-room retention, rate limits, rejoin), the matchmaker (lobby key already `tc|variant`, fill rule, Amateur bots), the socket session class and reducer on the client (optimistic move + rollback, `seq` ordering), the queue / game / spectator screens' structure, persisted rejoin (`activeGame.ts`: the saved `four_match_found` payload already carries `variant`), premove and annotation *logic* patterns (`annotations.ts` keys on `state.ply`).

### 5.2 Genuinely new
A rules engine (`src/logic/chaturaji/`: `board.ts` for the 8x8 tables, `state.ts`, `moves.ts`, `elimination.ts` / scoring, `bot.ts`), mirrored to the backend by the existing generator; the 8x8 snapshot text; `'chaturaji'` on the wire; an 8x8 board rendering path; Chaturaji-specific presentation texts; the bot.

## 6. Wire and server changes (backward compatible)

- `FourVariant` (single wire file, generated to the backend) gains `'chaturaji'`; `validateFourVariant` accepts it; `FourReason` gains nothing new if the end reasons stay `allEliminated | cap | deadPosition | abandoned` (names to be fixed in W1 - the existing generic reasons are reused where the meaning is identical).
- **The snapshot is already variant-aware** (the client reads it with the room's variant's engine, D-decision of the Giveaway spec). A Chaturaji snapshot is its own text: 8 rows joined by `/`, one two-character cell each (same encoding style: seat letter + type letter, `--` empty), then the same trailing fields (turn, statuses, scores, clocks-independent counters). **It is never produced for a 4 Player Chess / Giveaway room**, so those snapshots stay byte-identical.
- **No new event names.** `four_join_queue` / `four_match_found` / `four_state` / `four_move` / `four_game_over` etc. all carry `variant`; the move payload (`from`, `to`, optional promotion) stays valid (squares are named `a1`-`h8`, a subset of the existing name grammar; promotion is implicit so the field is simply absent).
- **Rollout safety = D15 again:** the client sends `variant: 'chaturaji'` only for Chaturaji and refuses to play unless `four_match_found` echoes it (an old server would ignore the field and queue the player into a Chess game). Deploy backend first. Old clients on the new server are unaffected (they never send `chaturaji`; an unknown variant string from them is refused, as today).
- **Compatibility matrix** (each cell a test): new client + new server (Chaturaji works); new client Chess / Giveaway + new server (identical to today); old client + new server; new client Chaturaji + old server (refuses with a clear message).

## 7. Bots

Stockfish cannot play 4 seats, and this is a different game anyway, so a new heuristic `chooseChaturajiBotMove(state, elo, rng)` **with the same ELO dial** (`botStrength` is geometry-free and is imported, not copied): the roster (Kiddo 400 ... The Unbeatable 3000), the setup picker and the online "Bot (Amateur)" fill work unchanged. Evaluation (C1-A): **points won** (capture values, dead pieces 0), **do not hang pieces to the next active seat** (the one seat whose reply is predictable, as in the existing bots), **king safety = do not leave the king capturable by the next seat** (it eliminates the seat - the single biggest penalty), **promotion bonus** (pawn about to promote), a small advance / centre term. Tiers: **greedy** (elo < 1000: points and material only, hangs pieces), **careful** (>= 1000: adds the hanging-piece and king-capture penalties); **no deep tier in v1** (like Giveaway, D12), so a decision is a few move generations on a 64-cell board - cheaper than the 14x14 Chess bot; the number is measured and reported, not assumed. Same server driver seam (`chooseBotMoveFor` already dispatches on the position's rules, extended by one case) so a Chaturaji room can never get the Chess bot. A "first version, to be tuned later" bot, like every other variant's.

## 8. Architecture: generalising the geometry

### 8.1 The two options, and the recommendation

**Option G - a geometry abstraction threaded through the existing engine.** Make `SIZE`, `VALID`, `FORWARD`, the tables, the start layout, `PAWN_START_COORD`, the promotion line and the cell-array length parameters of a `Geometry` object carried by the state, and make Chaturaji a second geometry plus a rules mode. *For:* one move generator. *Against:* the move generators, `state.ts`, `elimination.ts`, `bot.ts` and the presentation helpers all read module-level constants and typed arrays created at import (the hot path indexes `RAYS[square * 8 + dir]` with no indirection); threading a geometry through ~1,200 mirrored lines adds an indirection in every hot loop, changes the generated server copy of **both existing games**, and puts the byte-parity guarantee for 4 Player Chess and 4 Player Giveaway at risk for a game that shares little with them: Chaturaji differs in **the piece set** (boat, no queen), **pawn rules** (no double step, no en passant, boat-only promotion, promotion on a different line), **no castling**, **no check** (C1-A), **different elimination and scoring**, and an **8x8 square** board with no cut corners. What would remain shared in the move generator is essentially "sliders walk a ray, knights jump": ~100 lines.

**Option S - a separate Chaturaji engine behind a small seam (recommended).** New folder `src/logic/chaturaji/` with its own 64-cell mailbox, move generator, elimination / scoring, bot; the existing engine files are not edited for geometry. **Share only what is genuinely geometry-independent**: (a) the *table builder* - extract `buildTables({ size, isPlayable })` from `board.ts` (the code that produces `VALID`, `RAYS`, `KNIGHT_TARGETS`, `KING_TARGETS`) as a pure function; 4 Player's `board.ts` calls it with the cross shape and exports exactly the same constants, Chaturaji calls it with an 8x8 full square; a test proves the 14x14 output is **byte-identical** to the recorded tables; (b) `Seat`, `nextSeat`, `seatBefore`, seat names / colours, the quarter-turn display rotation (generalised over `size`), `clock.ts`, `setup.ts`, and the result / event types.

### 8.2 The seam (so rooms and screens do not branch on the game kind everywhere)

A small interface, implemented by two adapters, `fourPlayerEngine` (existing functions, unchanged) and `chaturajiEngine`:

```
interface SeatGameEngine<S> {
  initial(): S;                       legal(state: S, seat): Move[];
  find(state: S, seat, from, to, promo?): Move | null;
  play(state: S, move, rng): { state: S; events: GameEvent[] };
  resign(state: S, seat, rng, reason): ...;     tick(state: S, clock, elapsed, rng): ...;
  serialize(state: S): string;        deserialize(text: string): S;
  chooseBot(state: S, elo, rng): Move;   piecesOrScores(state: S): number[];
}
```

`engineFor(variant)` returns the adapter. The server room (`fourPlayerRooms.ts`) and the client hook / reducer call `engineFor(room.variant)` instead of the concrete functions - **12 call sites server-side, a handful client-side** - and for `ffa` / `giveaway` the adapter is a pass-through to today's functions, so their behaviour cannot change (W0 is exactly this refactor, with the regression gate of §11 green before anything Chaturaji exists).

### 8.3 What stays shared vs new

| Shared (unchanged) | New |
|---|---|
| Room manager funnel, lazy clocks, takeover / retake, all-gone, fast-forward, resign, chat, spectating, rate limits, finished-room retention | `chaturaji/` engine (rules, scoring, elimination, bot) |
| Matchmaker (lobby key `tc\|variant`, fill rule, Amateur fill bots) | `'chaturaji'` in `FourVariant` + 8x8 snapshot codec |
| Bot driver scheduling, pacing, ELO dial (`botStrength`), takeover bots | Chaturaji bot heuristic |
| Clocks (`clock.ts`), `SeatConfig` / setup logic, premove resolution (via `find`), annotation lifecycle (`state.ply` epoch) | 8x8 board rendering path, 8x8 cell-size budget, Chaturaji texts (status, result card, seat card = points) |
| Persisted rejoin (`activeGame.ts`; the saved payload already has `variant`), session class, reducer | Chaturaji start-layout / scoring / end tests, parity script cases, nightly fuzz section |

### 8.4 Frontend board
`FourPlayerBoard` is parametrised by a small `BoardGeometry` render prop (`size`, `isPlayable`, `toDisplay` / `fromDisplay`) - rendering only; the 14x14 instance is exactly today's, the 8x8 instance draws 64 cells at about 1.75x the cell size (the 4 Player cell-size budget `getFourPlayerCellSize(360, 640) = 21` is pinned by a test and stays; Chaturaji gets its own function with its own pinned values). The seat strip shows **points** (as 4 Player Chess does, unlike Giveaway). Board annotations: the position epoch is `state.ply` as in the other 4-seat modes (CHECKLIST "Extra" box), with the no-move turn advances (an eliminated seat skipped, a flag fall) added to `annotationLifecycle.test.ts`.

### 8.5 Parity / mirror plan
The Chaturaji engine folder is added to the **existing** mirror manifest (`MIRRORED_TO_BACKEND.json`) and generator (`sync:fourplayer`, with its `--check` in CI): the backend copy is **generated, never hand-edited**. The generator already handles a folder of pure TS files with relative-specifier rewriting; a new folder is new content, not new machinery. The closure rule (a mirrored file may not import client-only code) holds: the engine imports only `board.ts`' shared helpers and its own files. A parity script (like `test-fourplayer.mjs`) replays **seeded Chaturaji games** through the app's engine and the generated copy in lockstep (identical snapshot text, events, legal-move lists and bot choice at every ply); the nightly fuzz gets a Chaturaji section with four real clients on the app's engine ("identical snapshots to every seat at every seq, every move legal in its own engine, the final result matches `four_game_over`").

## 9. Frontend (screens and UX)

- **Entry:** Play menu -> **Chaturaji** card -> **Local** (-> `FourPlayerSetupScreen` with a variant-aware title / intro -> `TimeControlSelectScreen` excluding Daily -> `FourPlayerGameScreen variant="chaturaji"`) or **Online** (login gate -> time control, excluding Daily and "No time limit" -> `FourPlayerMatchmakingScreen` -> `FourPlayerOnlineGameScreen`). `variant` rides in the screen state as it does for Giveaway.
- **Presentation (pure and unit-tested):** status line ("Red to move" / "Blue (bot) is thinking..." / result), seat cards with points, result card (points table, winner(s) first, reason: "Three players eliminated", "Move limit reached", "No captures left"), `describeEvents` (capture with points, king capture / elimination, resign / flag text), the rules hint on setup / queue ("Capture kings and pieces to score - the most points wins").
- **9.4 The new capture-hint UI patterns, applied where they fit.** Chaturaji has no forced capture, so the "Capture is mandatory" banner and capturer ring are not used. The *patterns* are: (1) a status pill that **replaces** the plain status line (never adds height) for a warning that matters - used for **"Your king is attacked"** (a courtesy under C1-A, where nothing forces you to respond and a king capture ends your game; the same single-line, theme-safe pill, same contrast tests); (2) a ring + dark outline marker, visible on every board theme - used on the attacked king and on the last-move / capture squares if wanted; (3) a short message on a blocked interaction - used if a tap on a dead (grey) piece or an eliminated seat's controls needs explaining. All three are optional polish for W3, decided with you, not required for correctness.
- **Dead pieces** render grey (the existing dead-piece art path from 4 Player Chess is reused).

## 10. Workstreams and order (branch `chaturaji` in both repos, from `master` / `main`)

Each row is a vertical slice that touches **Local, Bots and Online** where the slice has something to say; each ends with the stop-and-review rule. Mutation checks use the copy-based harness (never the real files), equivalents documented inline, performance numbers reported per slice. Sizes are my estimate in **review-and-build working days** (one focused day = one stop-and-review cycle) with the order of magnitude of the code; they carry the usual uncertainty, larger if C1-B is chosen.

| | Slice | Local | Bots | Online | Size | Independent? |
|---|---|---|---|---|---|---|
| **W0** | **The seam, no Chaturaji.** `buildTables` extracted from `board.ts` with a byte-identity test; `SeatGameEngine` + `engineFor`; the server room and client hook / reducer call through it (pass-through adapters for `ffa` / `giveaway`); **recorded fixtures** of seeded 4 Player Chess and Giveaway games (snapshots, events, legal-move lists, bot choices) captured on master *before* the change and required byte-equal after. Changes no behaviour. | adapter | - | adapter | **M, ~1-1.5 d**, ~300 changed lines + ~400 test lines | yes |
| **W1** | **Rules + wire core.** `chaturaji/` engine (board tables from `buildTables`, state, moves, elimination / scoring, snapshot codec, the 8x8 clock use); `'chaturaji'` on the wire; mirror manifest + generated server copy; hand-built scripted tests (§4 examples, §11); parity script with seeded Chaturaji games. | the engine every local game runs | the move set bots choose from | the engine and contract the server runs | **L, ~2.5-3 d** (more with C1-B), ~900 engine lines + ~1,300 test lines | after W0 |
| **W2** | **Bot + the whole game loop in-process.** `chooseChaturajiBotMove`; the room manager, matchmaker and handlers accept the variant; a complete Chaturaji game (bots, takeover, retake, fast-forward, resign, flag fall) through the server on stub sockets and the local game logic on seeded replays; compatibility matrix. | local logic with bots (no screens yet) | heuristic, dial, perf numbers | server variant plumbing | **M, ~1.5-2 d** | after W1 |
| **W3** | **Every screen.** Menu card, setup texts, 8x8 board path + cell-size function, seat card (points), result card, status variants, the online client (reducer, queue, game, spectator, Spectate list rows, echo check), annotation-lifecycle additions, the optional king-attacked pill (§9.4), source pins; web verification at 360x640 and 412x915 in both themes. | playable end to end | bots on screen | online screens | **L, ~2-3 d** | after W1-W2 |
| **W4** | **Real sockets.** e2e script scenarios (four sockets: king capture eliminates, promotion to boat, points, flag fall, takeover bot plays, spectator, lobbies never mix, persisted rejoin of a Chaturaji seat), the nightly fuzz section, CI / nightly wiring. | - | server bots over sockets | the whole protocol | **M, ~1-1.5 d** | after W1-W3 |
| **W5** | **Close-out.** Docs roll-up (both TESTING.md files, TODO.md), final mutation re-run on the final code, browser verification (two humans needed - a lone human never gets bots - backend started with `FOUR_FILL_MS` / `FOUR_GRACE_MS`; I will ask for the login hand-off up front). | browser pass | bot fill on screen | two-tab pass | **S, ~1 d** | last |

**Total: about 9-12 working days across six stop-and-review cycles** under the defaults (C1-A); about 12-15 with C1-B.

## 11. Test plan (CHECKLIST 2, 3, 4, 5)

**Edge cases, each with a named test (hand-built positions where the rule is the point):** the exact first-move list for each seat (W1 examples 1-2); pawn directions for all four seats incl. the perpendicular neighbours; pawn diagonal capture and no double step / no en passant; promotion by push and by capture to a **boat** on each seat's far edge and never to anything else; boat / bishop / knight / king move sets incl. blocked by dead pieces; **king capture eliminates** (by a pawn, a knight, a slider); capturing the king **of the seat that is next to move** and the king **of the seat that just moved**; dead pieces capturable for 0 points and block rays; elimination of 1, 2, 3 seats and rotation skipping them; a seat with no legal move passes (C7); resign / flag fall of the mover and off-turn resign; the ply cap and the hard ceiling with a tied top score (shared win); the no-captures-possible end; three-eliminated end decided **by points, not survival**; a points table where the survivor is *not* the winner; every result reason round-trips through `serialize` / the wire; snapshot codec round-trip (random seeded positions); Undo across a king capture (local); a premove cancelled by an elimination.
**Deterministic scripted games:** hand-built games that force each end reason and assert the exact events, results and scores (not only seeded random games).
**4 Player Chess and 4 Player Giveaway stay untouched - what proves it** (the L4 gate): (1) their **existing suites run unchanged and green after every workstream** - the 22 frontend test files that reference the 4-seat engine, and the backend's `sync:fourplayer --check`, `test:fourplayerSync`, `test:fourplayer` (parity), rooms, bots, matchmaking, handlers, online e2e and Giveaway scripts; (2) **recorded fixtures captured on master before W0**: seeded FFA and Giveaway games' snapshot text, events, legal-move lists and bot choices, required byte-equal; (3) the **table-builder identity test**: the extracted `buildTables` reproduces `VALID`, `PLAYABLE_SQUARES`, `RAYS`, `KNIGHT_TARGETS`, `KING_TARGETS` for the cross board byte for byte, and `toDisplay` / `fromDisplay` for `size = 14` equal today's; (4) the generated server copy of the *existing* files is **byte-identical** after W0 except for the intended seam (checked by the sync `--check` plus a diff review at the W0 stop); (5) no existing 4-seat file imports from `chaturaji/` (source scan), so a Chaturaji change can never reach them; (6) the cell-size pin `getFourPlayerCellSize(360, 640) === 21` and its siblings stay.
**Parity (CHECKLIST 4):** §8.5. **Performance (CHECKLIST 3):** `legalMoves` cost on the 64-cell board over seeded games; bot decision mean / p99 / max reported per tier (asserted structurally, not by wall-clock thresholds that flake under load - see TODO); a 1000-ply game's CPU; snapshot size. **Mutation checks:** on the new rules logic (pawn direction per seat, no double step, promotion line / piece, king capture = elimination, dead pieces 0 points, points table, end conditions and their order, winner-by-points, passing, lobby key, variant echo / validation, the bot's king-safety term) with the copy-based harness; survivors are test gaps unless shown equivalent. **Cross-feature (§12):** each checked, not assumed. **Docs:** doc comments on every new file; a "Chaturaji" section per repo's TESTING.md per workstream, then the roll-up; TODO.md.

## 12. Interactions (CHECKLIST §1, second box) - stated, not assumed

- **4 Player Chess and 4 Player Giveaway:** unchanged (§11 gate). One room has exactly one variant, fixed at creation; the lobby key `tc|variant` means three games can never share a lobby or a room.
- **2-player modes, tournaments, challenges, Setup Chess, ratings, achievements, history, PGN, analysis, puzzles:** unaffected, as for the other 4-seat games - 4-seat games are not saved, rated, analysable or PGN-exportable (v1), and Chaturaji adds none of that. (The info screen's "points do not directly affect rating changes, only final placement does" confirms chess.com rates by placement; this app has no 4-seat rating at all.)
- **Bots:** the 2-player bots and the two existing 4-seat bots are untouched; the Chaturaji bot is used only when the room / local game variant is Chaturaji; `chooseBotMoveFor` dispatches on the position, so a wrong bot cannot be attached.
- **Online mutual exclusivity:** Chaturaji is its own variant with no combining flags (unlike the 2-player flags, which need conflict checks); it cannot be combined with Giveaway, Chess960, Fog of War etc.
- **Persisted rejoin:** the saved `four_match_found` payload already carries `variant`; the restart path restores the right engine via `engineFor`; a dedicated e2e case in W4.
- **Premoves / arrows / Undo (local):** kept (the board and hooks are rules-agnostic); a premove invalidated by an elimination is cancelled with the existing notice.
- **The capture-hint feature:** not applicable (no mandatory capture); its patterns are reused optionally (§9.4).

## 13. Known limits (deliberate, v1)

No Teams / alliances (C11); no dice, no historical boat, no boat triumph, no sinhasana (none are in chess.com's version); no draws, claim win or autoclaim (C9); no "+3 per enemy king" bonus for the last player (C8); no walking dead king (C5); no deep bot tier; bots are a first-version heuristic; no ratings, history, saved games, PGN or analysis (same as the other 4-seat games); no private rooms; a lone human can wait in the queue indefinitely (a lobby needs two humans, like the other two games); web verification only (no React Native renderer or device here).

## 14. Please confirm (these must be answered before W0)

1. **C1 - check model (the big one).** A: no check, king is capturable, capturing it eliminates (default, matches the glossary). B: 4 Player-style check and checkmate (mate +3, multi-check +1 / +5), as the 2023 forum history ("3 pt mate", "capture-the-king") suggests the live game has. **Please look at the live game's "?" panel and tell me which.**
2. **C2 - start layout.** The rotational corner layout of §4.1 (anchored on "Red king d1, RNBK"), or the real one (the forum says it is not perfectly rotational; if you can read the setup picture on chess.com, send me the four back ranks and pawn squares).
3. **C3 - boat = rook** (glossary) rather than the historical 2-square diagonal jump.
4. **C4 - pawns:** one step, diagonal capture, no double step / en passant, promote to a boat only, on the far edge ("your 8th rank").
5. **C5 - dead pieces** capturable for 0 points, no walking dead king.
6. **C6 - points:** pawn 1, knight 3, king 3, bishop 5, boat 5; a promoted pawn counts as a boat (5); no check points under C1-A.
7. **C7 - a seat with no legal move passes** its turn (rather than being eliminated or scoring).
8. **C8 - end and winner:** three eliminated, ply cap (1000 / 5000) or no captures possible; **highest points wins, ties shared** (not "last survivor"); the "+3 per enemy king" last-player bonus is not modelled.
9. **C9 - no draws / claim win** in v1.
10. **C10 - resign / flag = eliminated, no points change, play continues.**
11. **C11 - FFA only; no Teams.**
12. **C12 - the normal 4-seat time-control list** (no Daily), not a special 1/4|0.
13. **C13 / C14 - a new bot heuristic (greedy + careful tiers) and a third Play-menu card "Chaturaji" with Local and Online.**
14. **The architecture (§8):** a **separate 8x8 engine behind a small seam** (Option S) rather than a geometry parameter through the existing engine (Option G), and the workstream split W0-W5 (§10) each across Local + Bots + Online.

**Needs your decision before W0 specifically:** items 1 and 2 (they change what W1 builds and its size), and item 14 (the shape of W0). Everything else has a default I will build unless you say otherwise.
