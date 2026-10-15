# 4 Player Giveaway (4-seat Antichess) — spec (v1)

Status: **approved (all [confirm] items); W1 (rules + wire core) committed, W2 (bot + server variant plumbing) committed, W3 (every screen) committed, W4 (real sockets, nightly fuzz, CI wiring) committed, W5 (close-out: roll-up docs, final mutation re-run, online browser pass, Resign-wording fix) built and awaiting review.** Written per CHECKLIST.md ("spec before code"). Covers both repos: frontend `EM-Chess` (this one) and backend `chess-app-backend` (`backend/`).
Same process as 4 Player Chess Online: after each workstream I stop, send the diffs (logic first) and wait for an explicit "go"; nothing is pushed or merged unless asked. The one difference you asked for:
**every workstream builds Local, Bots and Online together for its slice** (§9) - there is no "local first, online later" stage. Items marked **[confirm]** are details I chose and want a yes/no on (collected in §13).

## 0. Summary (the 3-5 sentences)

4 Player Giveaway is Antichess on the 4 Player board: **captures are mandatory**, a **king is an ordinary piece** (capturable, no check, no castling), and the goal is to **lose your pieces** - the first seat that has no legal
move on its turn (no pieces left, or every remaining piece blocked) **wins the whole game at once**. It is a second *variant* of the existing 4-seat game, not a new mode: one rules object (`variant: 'ffa' | 'giveaway'`) selects the move-legality and
turn-passing rules inside the **same** engine, so the board, seat setup, clocks, premoves, arrows, queue, rooms, takeover/retake, chat, spectating and every `four_*` event are reused unchanged, and 4 Player Chess (FFA) is guaranteed byte-for-byte unaffected by
a regression gate. What is genuinely new: the Giveaway rules inside the engine (and its generated server copy), a Giveaway bot (the existing 4-seat bot is built around mating and cannot play it), a `variant` field on the wire and in the matchmaker's lobby key, and
the handful of screens/texts that say "check", "score" or "checkmate". Not new: Stockfish (it cannot play 4-seat games and the 2-player Giveaway bot does not use it either).

**Interactions (stated, not assumed):** see §11. In short: 2-player Giveaway/Antichess, every other 2-player variant, tournaments, challenges, history, ratings, analysis, PGN and puzzles are untouched (4 Player games have no persistence, rating, PGN or analysis in v1, and this
variant adds none); 4 Player Chess (FFA) Local and Online keep their exact behaviour and are protected by tests that must stay green unchanged; variants can never share a lobby or a room.

## 1. Premises in the brief, checked against the code (three corrections)

| The brief says | The code says | Consequence |
|---|---|---|
| The "existing Stockfish-based bot" - does it play forced capture out of the box? | **There is no Stockfish bot to reuse.** Stockfish cannot play a 4-seat position; the 4-seat bot is a custom heuristic (`src/logic/fourPlayer/bot.ts`), and the 2-player Giveaway bot is *also* a custom heuristic (`chooseGiveawayBotMove` in `bots.ts`: "Deliberately NOT Stockfish"). | Giveaway needs its own 4-seat heuristic (§6). The 4-seat bot's ELO dial (`botStrength`) is reusable; its evaluation (mating, check, points) is not. |
| "Stalemate-as-loss (the 2-player Giveaway stalemate win condition)" | In this project, **being stuck WINS**, never loses: "You WIN the instant it is your turn and you have no legal move" (`giveaway.ts`; `getGiveawayWinner`). | There is no "stalemate loss" to generalise. §4 defines the 4-seat equivalent of *stuck wins* (and why a bot must avoid stalemating the next seat). |
| Eliminated-player precedent: "mirroring how 4 Player Chess's all-gone/stalemate precedent already handles a seat dropping" | Two different things. *All-gone* (`FOUR_ALL_GONE_MS`) is about **humans leaving a room** (the game ends with no result) and is rules-agnostic - it applies unchanged. *Stalemate* in 4 Player Chess **eliminates the stalemated seat with points and the game continues** - the opposite of Giveaway, where being stuck ends the game with that seat as the winner. The precedent that carries over is **resign / flag-fall elimination** (a seat goes inert, the others continue). | §4 decisions D3-D5. |

## 2. Decisions

**Locked in by your brief**

| | Decision |
|---|---|
| L1 | Local + Bots + Online are built **together**, every workstream a vertical slice across all three (§9). |
| L2 | Reuse the proven 4-seat infrastructure (engine, room manager, matchmaker, bot driver, wire contract, queue/game/spectator screens, local board and seat setup) rather than fork it. |
| L3 | Same quality gates as 4 Player Chess Online: spec first, hand-built deterministic scripted tests for the rules that are easiest to get wrong, mutation checks on a copy of the repos, performance numbers, an explicit cross-feature check, generated (not hand-mirrored) server engine with a CI drift check and a parity script, nightly fuzz, docs. |

**Rule decisions - each with my proposed answer, all [confirm]** (reasons in §4)

| | Question | Proposed answer **[confirm]** |
|---|---|---|
| D1 | Forced capture when captures exist against several seats: priority order? | **No priority.** If the mover has *any* capture of *any* other seat's piece, every non-capturing move is illegal; among the captures the mover chooses freely (which seat to feed is the strategy). |
| D2 | Pieces of an eliminated seat (resigned / flagged)? | They become **inert walls: not capturable, not attackable, not forcing.** (4 Player Chess lets you capture dead pieces for 0 points; here that would force players to capture corpses.) |
| D3 | A seat that loses its last piece, or is stuck on its turn: does that end the game? | **Yes - immediately, and that seat wins.** (a) The moment a move captures a seat's last piece, that seat wins - checked right after the move, not when its turn comes round. (b) A seat that is to move and has no legal move (all pieces blocked) wins. Exactly like 2-player ("you win the instant..."), and the result stays "one winner". The other three seats do **not** play on for 2nd-4th place. |
| D4 | Who is "stuck" with four seats? | Only the **seat whose turn it is** can be stuck; it is checked when the turn reaches it (the same moment 4 Player Chess already evaluates a seat). A seat that is blocked while it is *not* its turn is not stuck yet - it may be un-blocked before its turn. Inert (eliminated) seats are skipped and are never "stuck". |
| D5 | Resignation / flag fall? | The seat is **eliminated** (pieces become walls, D2), the turn passes on, and it cannot win. If only one seat remains active, **that seat wins** (last standing). A resigned seat that already "won" is impossible (D3 ends the game first). |
| D6 | Ply cap (guards endless games)? | Same cap as 4 Player Chess (1000 plies, hard ceiling 5000). At the cap the seat(s) with the **fewest pieces left win** (ties shared). |
| D7 | King? | An ordinary piece: capturable, may stand next to another king, no check highlight, **no castling**. |
| D8 | Promotion? | Queen, rook, bishop or knight on the same promotion line as 4 Player Chess. **No promotion to king in v1** (2-player Giveaway has it). Reason: the promotion piece is 2 bits of `Move.flags`, a king option widens an encoding that is mirrored, parity-tested and part of the wire's `q r b n` validator; cheap to add later. |
| D9 | En passant? | Allowed, and it is a capture (so it is forcing), as in standard Antichess. |
| D10 | Points / score? | **None.** The seat card shows **pieces left** instead of the score; the result table ranks by fewest pieces (winner first). (`state.score` stays in the snapshot, all zeros, so the snapshot text format is identical to 4 Player Chess.) |
| D11 | Premoves, arrows, Undo (local)? | **All kept** - the board code is rules-agnostic. A premove that a forced capture has made illegal is cancelled with the existing "no longer legal" notice (2-player Giveaway has no premoves; here the shared hook already handles it). |
| D12 | Bots? | A new Giveaway heuristic (§6), same ELO dial and roster; **no deep tier in v1** (so the server bot clamp is moot for this variant but kept). |
| D13 | Where does it appear in the app? | A new **"4 Player Giveaway" card** on the Play menu, under the 4 Player Chess card, with the same two buttons: **Local** (seat setup, then time control) and **Online** (behind the login gate, like every Online entry). |
| D14 | Online lobbies? | Keyed by **time control + variant**: a Giveaway player and a Chess player can never be matched. Same fill rule (>= 2 humans, 30 s, Amateur bots), same takeover/retake, chat, spectating. The active-games list tags each row with its variant. |
| D15 | Rollout safety (old server, new client)? | The client sends `variant` **only for Giveaway** and refuses to play unless `four_match_found` echoes `variant: 'giveaway'` - an older server would silently ignore the field and queue the player into a Chess game. Deploy order: backend first, then the app. Old clients on the new server are unaffected (no `variant` = FFA). |
| D16 | Mechanism: rules inside the shared engine, or a forked engine? | **Dispatch inside the shared engine on `state.rules.mode`** (a handful of well-defined points, §5), with Giveaway-only logic in one new module. A fork would duplicate board/state/clock/serialize/premove/annotations and double the generated mirror. FFA is protected by a regression gate (§10). |

## 3. What is reused as-is and what is genuinely new

### 3.1 The rules engine (`src/logic/fourPlayer/`, mirrored to `backend/src/game/fourPlayer/`)
| Piece | Verdict | Why |
|---|---|---|
| `board.ts` (geometry, rays, targets, seats, promotion line), `clock.ts` (four clocks, increment, `clockTick`) | **as-is** | Pure geometry/time; a flag fall already means "eliminate the seat". |
| `state.ts` (`FourPlayerState`, `serialize` / `deserialize`) | **as-is format**, one extension | The text has no rules in it; `deserialize(text, rules)` already takes them. `kings[]` and `castling` are meaningless in Giveaway and are simply not read. |
| `moves.ts` `pseudoMoves` / `applyMoveRaw` | **small swaps** | `isCapturable` hard-codes "a king can never be captured" and "dead pieces can be captured"; castling is generated unconditionally; king squares are tracked. |
| `moves.ts` `legalMoves` / `findLegalMove` | **swap** | Legality is "does not leave my king attacked" (check). Giveaway legality is "if any capture exists, only captures". Everything downstream (`findLegalMove`, the board's legal-move dots, `resolvePremove`, the server's move validation) calls `legalMoves`, so swapping it swaps them all. |
| `elimination.ts` `advance` / `eliminateSeat` / `endGame` / `isDeadPosition` / `mateCredit` | **swap** | Built around "a seat with no legal move is mated or stalemated, eliminated with points, and becomes a walking dead king". Giveaway: no points, no dead kings, "no legal move" = **win**. `resign` and `playMove`'s outer shape stay. |
| `bot.ts` | **swap** (new bot, same dial) | See §6. |
| `premove.ts`, `annotations.ts`, `presentation.ts` (cell size, clock text, piece art) | **as-is** | Legality comes from `findLegalMove`; annotations key on `state.ply`. `describeEvents` / `describeResultReason` need Giveaway wording. |
| `setup.ts` (`SeatConfig`, seat helpers) | **as-is** | Who controls a seat is rules-agnostic. |

### 3.2 What generalises from 2-player Giveaway, and what is inherently 2-player
| Generalises | Inherently 2-player (does not carry over) |
|---|---|
| Mandatory capture, **globally** (not per piece): if any capture exists, non-captures are illegal, *before* any per-square filtering (`getGiveawayMoves`). | There is **one opponent**: "who gets the capture" never arises; 4 seats need D1/D2. |
| King is an ordinary piece; no check/checkmate; no castling. | Winner is a colour (`winner: 'w' \| 'b'`), `getGameOutcome` priority slot, PGN `[Variant "Antichess"]`, SAN, `chess.js` - none exist in the 4-seat engine. |
| **Stuck wins** (no legal move on your turn). | King promotion (D8), the `RoomChessEngine` / `giveaway` option and `isLegalGiveawayMove` on the 2-player server. |
| The bot's idea: *score a move by the material it hands away, and never leave the next mover with no legal move* (that wins them the game). | Heuristic is 1-v-1; with three opponents only the **next active seat** answers (as in the existing 4-seat bot). |

### 3.3 Local UI (frontend)
| Piece | Verdict |
|---|---|
| `FourPlayerBoard` (rotation, taps, legal-move dots from `currentMoves`, last-move, premove, arrows, promotion picker) | **as-is**, except one line: the **"king in check" highlight** (`isInCheck`) must not draw in Giveaway. |
| `FourPlayerSetupScreen` (seat setup, bot roster picker) | **as-is** + variant-aware title/intro (the text says "Checkmate players to eliminate them and score points"). |
| `FourPlayerGameScreen` (local game: turn rotation, bots on a timer, Undo, Resign, Rotate, clocks, premove) | **as-is** + a `variant` prop that picks the start state (`initialState(rulesFor(variant))`), the bot chooser, the status line (no "in check!"), the result table (pieces left, not score). Turn rotation is the engine's. |
| `FourPlayerSeatStrip` | **as-is** + pieces-left instead of score in Giveaway. |
| `TimeControlSelectScreen`, `PlayModeSelectScreen`, `App.tsx` routing | new card + `variant` carried through the screen state (the same way the 2-player variant flags are threaded). |

### 3.4 Server (backend) - rules-agnostic vs needs a swap
| Piece | Verdict |
|---|---|
| `fourPlayerRooms.ts`: the commit funnel, lazy clocks, grace/takeover/retake, all-gone, fast-forward, chat, spectating, rate limits, rejoin, finished-room retention, `finish()` | **as-is** - none of it knows a rule; it calls the engine. |
| `fourPlayerRooms.ts`: start state (`initialState()`), bot chooser (one injected default), the game-over payload (`scores: room.state.score`), the active-games summary | **small swaps**: the room gets a `variant`; the start state, bot and `scores` (= pieces left) follow it. |
| `fourPlayerMatchmaking.ts` | **swap** one function: the lobby key (`tc|variant`), and `startGame` receives the variant. |
| `fourPlayerHandlers.ts` | **swap** the join validation (accepts an optional `variant`); the other eight events are unchanged. |
| `fourPlayerConfig.ts` | **as-is** (all tunables are variant-agnostic). |
| `fourPlayerWire.ts` (generated from the app's) | **extended**: `FourVariant`, `variant` on join / match-found / room state / active-game summary, the new result reasons (§7). Event names unchanged. |
| The mirror generator, `sync:fourplayer --check`, `test:fourplayer` parity | **as-is machinery**, new content: a Giveaway module in the mirrored set, Giveaway seeded games in the parity script. |

### 3.5 Online client (frontend)
| Piece | Verdict |
|---|---|
| The socket session class, reconnect/rejoin/resync, optimistic move + rollback, `seq` ordering, chat panel, queue screen, spectator screen, hook | **as-is** (the reducer's rules are about messages, not chess). |
| `readSnapshot` (`deserialize(text)` with the default rules) | **swap**: the view carries `variant` and reads snapshots with that variant's rules. |
| `describeStatus` ("in check!"), `resultRows` (sorted by score descending), `describeFourResultNote`, the game-over payload validator's reason list, `FourPlayerResultCard`, seat card score | **swap** (variant-aware wording and ordering). |
| Queue screen title, game/spectator headers, Spectate list rows, the Online entry | **swap**: show the variant; queue with the variant; verify the echoed variant (D15). |

## 4. The rules, precisely

**Setup.** Identical to 4 Player Chess: the same cross-shaped 14x14 board, the same four armies and seat order (Red, Blue, Yellow, Green, clockwise), the same pawn start and promotion line, the same clocks and increments, no draws.

**A turn.** The seat to move has the *pseudo-legal* moves of its pieces (every piece moves as in 4 Player Chess: pawns forward/diagonal capture/double step/en passant, knights, sliders, king one step) with these differences: (1) a **king may be captured** and may stand adjacent to another king - nothing is ever "attacked into"; (2) **no castling**; (3) the pieces of an **eliminated** seat are walls (D2): they block squares and slide-rays and are neither capturable nor forcing; (4) a pawn reaching the promotion line promotes to Q/R/B/N (D8). **Then the capture rule:** if *any* of those moves captures a piece of any other active seat (en passant included, D9), the legal moves are exactly the captures; otherwise they are all the moves. (D1: no priority between victims.)

**Passing the turn.** After a move the turn goes clockwise to the next non-eliminated seat. Before that seat moves the engine checks, in order: (a) was a seat's **last piece** just captured? that seat **wins** (D3a); (b) is the seat to move **stuck** (no legal move)? it **wins** (D3b, D4). Otherwise it moves. Eliminated seats are skipped; they never move, never win and are never stuck.

**End of the game** (a `result` with `winners` and a `reason`; reasons are new, §7):
| Reason | When | Winners |
|---|---|---|
| `outOfPieces` | a move captured a seat's last piece | that seat |
| `stuck` | the seat to move has pieces but no legal move | that seat |
| `lastStanding` | resign / flag falls leave one active seat | that seat |
| `cap` | the ply cap is reached (D6) | the seat(s) with the fewest pieces |
| `abandoned` (server) | every human left (unchanged) | none |

**Worked examples** (each becomes a hand-built scripted test, §10):
1. *Several victims.* Blue to move; Blue's knight can take a Yellow pawn and a Green rook; Blue's other 30 moves are quiet. Legal moves = exactly those two captures; Blue chooses either (D1).
2. *Last piece.* Green has one pawn left; Red's rook captures it. The game ends **at that move** with `winners: [Green]`, reason `outOfPieces`, even though Blue and Yellow have not moved since (D3a).
3. *Stuck.* Yellow's only remaining pieces are pawns facing Green's and Blue's pawns, nothing capturable: when the turn reaches Yellow it has no legal move, so Yellow wins (`stuck`). A bot that blocks the seat before Yellow *hands it the game* (§6).
4. *Walls.* Blue resigns. Its pieces stay on the board; Red's rook can neither capture them nor be forced to; a Red pawn blocked by a Blue wall counts as blocked.
5. *Flag fall.* Green's clock runs out while Green is to move: Green is eliminated (walls), the turn passes to Red, and the game continues; if Red, Blue and Yellow had already been eliminated the game ends `lastStanding` for Green's survivor.

## 5. Engine design (no code until the spec is approved)

- `FourPlayerRules` becomes a discriminated shape on `mode: 'ffa' | 'giveaway'`; `FFA_RULES` is unchanged and `GIVEAWAY_RULES` is new (`promotionCoord`, `maxPlies` shared; the four points knobs do not apply). `initialState(rules)` already accepts rules.
- **Touch points** (all inside the mirrored engine; every other function is untouched): `isCapturable` (kings, walls), `pseudoMoves` (castling off), the promotion set (D8: unchanged), `legalMoves` (the capture filter replaces the king-safety filter), `advance` / `eliminateSeat` / `endGame` / the cap and dead-position checks (the Giveaway turn rules above), `applyMoveRaw` (no king-square bookkeeping). The Giveaway-only pieces - the capture filter, the stuck / last-piece checks, the end conditions, the result reasons - live in **one new module** (`giveaway.ts`, in the mirrored set), imported by the files above; it imports only types back (no cycle).
- **Regression gate (the guarantee that FFA is untouched):** the existing 4 Player Chess suites run **unchanged and green** after every workstream - the frontend's engine/bot/clock/premove/annotation/online suites, and the backend's sync, parity (`test:fourplayer`), rooms, bots, matchmaking, handlers and e2e scripts - and a new lockstep test replays seeded FFA games through the *old* behaviour recorded before the change (snapshot text, events, legal-move lists) and requires byte equality.
- The snapshot text format is **unchanged** (`score` stays, all zeros; `castling` and `kings` are ignored by Giveaway). The variant travels beside the snapshot, never inside it, so a Chess snapshot is byte-identical before and after.

## 6. Bots

Needs its own heuristic (§1): `chooseGiveawayFourBotMove(state, elo, rng)` in the same file family as `bot.ts`, same signature and **same ELO dial** (`botStrength`: `bestChance`, `noise`, tiers), so the roster bots (Kiddo 400 ... The Unbeatable 3000), the setup screen's picker and the online "Bot (Amateur)" all work unchanged. Evaluation: the aim is to lose material, so a move scores by **the own material it makes capturable by the next active seat**, minus a penalty for **handing any seat the win** (leaving the next seat with no pieces or no legal move, or capturing the next seat's last piece), plus the usual forced-capture constraint (the candidate list is already the capture set). Tiers: **greedy** (1 ply, material only) and **careful** (adds "don't hand the next seat the win"); no deep tier in v1 (D12), so one decision stays a few milliseconds and the server clamp (`FOUR_SERVER_BOT_MAX_ELO`, 1700) remains but never binds. The server picks the chooser by room variant through the **already injectable** `chooseBotMove` seam; fill bots stay Amateur 1200; takeover bots keep the human's name. Performance is measured the way W3 did (mean / p99 / max per decision over many seeded games, asserted structurally) - forced captures shrink the candidate list, so I expect it to be cheaper than the chess bot, but the number is reported, not assumed. Whether Giveaway bots are *good* is a product question (the 2-player ones are "a first version to be tuned later"); v1 is deliberately that too.

## 7. Wire and server changes (backward compatible)

- Types in the single wire file `src/logic/fourPlayerWire.ts` (generated to the backend, as before): `export type FourVariant = 'ffa' | 'giveaway'`; `FourJoinQueuePayload.variant?` (omitted = `'ffa'`); `FourMatchFoundPayload.variant`, `FourRoomState.variant` (so spectate / rejoin carry it), `FourActiveGameSummary.variant`; `validateFourVariant` (strict: unknown strings refused with an error ack, `undefined` = ffa); `FourReason` gains `outOfPieces | stuck | lastStanding`; `FourGameOverPayload.scores` means **points** in FFA and **pieces left** in Giveaway (the client knows the variant).
- **Event names do not change.** No new event; no old payload field changes meaning for FFA.
- Matchmaker: `keyOf(tc, variant)`; `four_queue_update` is per lobby as before. Room manager: `createRoom({ variant })`; the room's state, bot chooser and `scores` follow it; `four_game_over` for `abandoned` is unchanged.
- Compatibility matrix (each cell becomes a test): new client + new server (Giveaway works); new client Chess + new server (identical to today); **old client + new server** (no `variant` -> FFA, unchanged); **new client Giveaway + old server** (the client sees no / wrong `variant` in `four_match_found` and refuses to proceed with a clear message, D15).

## 8. Frontend

- **Entry:** Play menu -> new **4 Player Giveaway** card -> **Local** (-> `FourPlayerSetupScreen` -> `TimeControlSelectScreen` excluding Daily, as 4 Player Chess does -> `FourPlayerGameScreen variant="giveaway"`) or **Online** (login gate -> `TimeControlSelectScreen` excluding Daily and "No time limit" -> `FourPlayerMatchmakingScreen` -> `FourPlayerOnlineGameScreen`). `variant` rides in the screen state; the existing 4 Player Chess entries pass `'ffa'` and are byte-for-byte unchanged.
- **Presentation (all pure and unit-tested, since there is no renderer):** the status line ("Red to move" / "Blue (bot) is thinking..." / the result; no "in check"), seat cards (pieces left), result card (winner first, then ascending pieces, with the reason: "Green lost its last piece", "Yellow had no legal move", "Everyone else resigned", "Move limit reached - fewest pieces wins"), `describeEvents` (resign / flag text only), the Giveaway rule hint on the setup and queue screens ("Captures are mandatory - lose all your pieces to win").
- **Online client:** the reducer's view carries `variant` (from `four_match_found` / rejoin / spectate) and reads snapshots with that variant's rules (`readSnapshot(text, rules)`); the game-over payload validator accepts the new reasons; the Spectate list tags rows ("4 Player Giveaway"); the queue verifies the echoed variant (D15).
- **Board annotations (CHECKLIST "Extra" box):** the mode's position epoch is `state.ply` (unchanged); Giveaway's no-move turn advances (a skipped eliminated seat, a flag-fall elimination, a seat won/ended by `outOfPieces`) are added to `annotationLifecycle.test.ts` so arrows still clear only when a *move* is played.

## 9. Workstreams and order (branch `fourPlayerGiveaway` in both repos, from `master` / `main`)

Each row is a vertical slice that touches **Local, Bots and Online** where the slice has anything to say about them; each ends with the stop-and-review rule above. Mutation checks use the copy-based harness (never the real files), equivalents are documented inline, performance numbers are reported per slice.

| | Slice | Local | Bots | Online | Independent? |
|---|---|---|---|---|---|
| W1 | **Rules + wire core.** `giveaway.ts` and the engine touch points; `GIVEAWAY_RULES`; the wire's `variant` / reasons / validators; mirror manifest + generated server copy; hand-built deterministic scripted tests (§10); parity script extended with seeded Giveaway games in lockstep (app engine vs generated copy); the FFA regression gate. | the engine every local game runs | - (the move set bots choose from) | the engine and contract the server runs | yes - changes no behaviour a player can see |
| W2 | **Bots + the whole game loop in-process.** `chooseGiveawayFourBotMove`; the room manager, matchmaker and handlers take a `variant`; a complete Giveaway game (bots, takeover, retake, fast-forward, resign, flag fall) runs through the server on stub sockets and through the local game logic on seeded replays; compatibility matrix tests. | local game logic with bots (no screens yet) | the heuristic, its dial, perf numbers | server variant plumbing | after W1 |
| W3 | **Every screen.** Menu card, setup/title texts, `FourPlayerGameScreen` / board / seat card / result card / status variants, the online client (reducer, queue, game, spectator, Spectate list, echo check), annotation-lifecycle additions, source pins. | playable end to end | local bots on screen | online screens | after W1-W2 |
| W4 | **Real sockets.** The e2e script's Giveaway scenarios (four sockets: forced capture refused for a quiet move, last-piece win, stuck win, takeover bot plays a forced capture, spectator, listing shows the variant, lobbies never mix), the Giveaway section of the nightly fuzz (independent clients on the app's engine), CI/nightly wiring. | - | server bots over sockets | the whole protocol | after W1-W3 |
| W5 | **Close-out.** Docs roll-up in both TESTING.md files and TODO.md, the last mutation re-run of every workstream's set on the final code, and the browser verification (two humans needed - a lone human never gets bots - and the backend started with `FOUR_FILL_MS` / `FOUR_GRACE_MS`; I will ask for the login hand-off up front this time). | browser pass | bot fill on screen | two-tab pass | last |

## 10. Test plan (CHECKLIST 2, 3, 4, 5)

**Edge cases, each with a named test** (hand-built positions where the rule is the point): forced capture with captures against 1 / 2 / 3 different seats; a capture available only to a piece *other* than the one the player tapped (global, not per piece); a quiet move refused while a capture exists; en passant as the only capture; a king captured (and a king capturing a king); two kings adjacent; no castling even with the classic rights and a clear path; promotion on the line with each of Q/R/B/N and a refused king letter; a pawn promoting *by* capturing; walls (resigned seat's pieces) neither capturable nor forcing, and blocking; last piece captured -> immediate win for that seat (including when the capturer's turn order would have let others move); the capture that takes a seat's last piece *and* promotes; stuck win (all pieces blocked) on the seat's own turn; a seat blocked off-turn then freed before its turn (no win); an eliminated seat skipped in rotation (1, 2 and 3 eliminated); flag fall of the mover; resign off-turn; last standing; ply cap with a tie; hard ceiling; premove cancelled by a forced capture; Undo across a forced capture (local); every result reason round-trips through `serialize` / the wire; FFA unchanged (the gate).
**Deterministic scripted games** (as for W1 of Online): hand-built games that force a `stuck` win, an `outOfPieces` win and a `lastStanding` win and assert the exact events and result - not only seeded random games.
**Parity (CHECKLIST 4):** generated server copy + `sync:fourplayer --check` (CI), behavioural parity script with seeded Giveaway games (identical snapshot, events, legal-move list and bot choice at every ply, app engine vs mirror), nightly fuzz with four real clients on the app's engine ("identical snapshots to every seat at every seq, every client move legal in its own engine, final result consistent with `four_game_over`").
**Performance (CHECKLIST 3):** `legalMoves` cost in Giveaway (cheaper than chess: no king-safety scratch moves) over seeded games; bot decision mean / p99 / max; a 1000-ply game's CPU; `four_state` payload size unchanged (snapshot format unchanged) and measured.
**Mutation checks:** on the new orchestration and rules logic (capture filter, wall rule, win checks and their order, elimination and last-standing, cap tie-break, lobby key, variant echo / validation, bot's "don't hand the win" term), with the copy-based harness; survivors are test gaps unless shown equivalent and documented inline.
**Cross-feature (explicit, §11):** bots, analysis, PGN, history, puzzles, the other variants - each checked, not assumed.
**Docs:** doc comments on every new file (why, gotchas); a "4 Player Giveaway" section per repo's TESTING.md per workstream, then the roll-up; TODO.md.

## 11. Interactions (CHECKLIST §1, second box) - stated, not assumed

- **Analysis mode:** unaffected. 4-seat games of any variant are not analysable today (Stockfish cannot play them, no 4-seat record format); this adds none. The Analysis tab, `AnalysisScreen` and `pgnReplay` never see a 4-seat game.
- **PGN export/import, game history, ratings, achievements:** unaffected - 4-seat games are not saved, recorded or rated (v1), Giveaway included; the 2-player Giveaway PGN tag `[Variant "Antichess"]` and its history behaviour are untouched.
- **Puzzles:** unaffected (2-player, chess.js-based).
- **Bots:** the 2-player bots (`bots.ts`, including `chooseGiveawayBotMove`) are untouched; the 4 Player Chess bot is untouched; the Giveaway 4-seat bot is new and used only when the room/local game variant is Giveaway.
- **2-player Giveaway and every 2-player variant:** untouched; the 2-player `isGiveaway` flag and the 2-player `socketHandlers` never mention `variant`; the two protocols stay disjoint (`four_*` vs the 2-player events).
- **The other four-player modes** (4 Player Chess FFA now; Teams / Solo / further variants later): the room infra stays shared. The variant is a single value on the room and in the lobby key, so two variants can never share a lobby or a room, and a future variant is "a rules object, a bot, a label". 4 Player Chess keeps its exact behaviour by the regression gate (§5).
- **Online mutual exclusivity:** a room has exactly one variant, fixed at creation; there is no variant-combining flag (unlike the 2-player flags, which need conflict checks).
- **Tournaments / challenges / Setup Chess:** 2-player only; not offered for 4 Player in either variant.

## 12. Known limits (deliberate, v1)

No king promotion (D8); no private rooms, history, ratings, saved games or analysis (same as 4 Player Chess Online); bots are a first-version heuristic with no deep tier; the first seat to be out of moves wins and ends the game, so there is no 2nd-4th place; no draws; a lone human can wait in the queue indefinitely (a Giveaway lobby needs two humans, like Chess); walls rather than capturable dead pieces (D2) is a choice that differs from 4 Player Chess; the 2-player Giveaway rule "promote to king" and "SAN" have no 4-seat equivalent.

## 13. Please confirm (details I chose)

1. **D1** - no capture-priority between seats; the mover picks any capture.
2. **D2** - eliminated seats' pieces are inert walls (not capturable, not forcing).
3. **D3 / D4** - the first seat to lose its last piece (checked right after the move) or to be stuck on its own turn wins, and the game ends at once (no 2nd-4th place).
4. **D5** - resign / flag = eliminated and out of contention; the last active seat wins.
5. **D6** - ply cap 1000: fewest pieces wins, ties shared.
6. **D7 / D8 / D9** - king ordinary; **no king promotion in v1**; en passant allowed and forcing.
7. **D10 / D11** - no points (seat card shows pieces left); premoves, arrows, Undo kept.
8. **D12** - new Giveaway bot heuristic, greedy + careful tiers only.
9. **D13** - a separate "4 Player Giveaway" card with Local and Online buttons.
10. **D14 / D15** - lobbies keyed by time control + variant; the client refuses a server that does not echo the variant; deploy backend first.
11. **D16** - rules dispatched inside the shared engine (not a forked engine), FFA protected by a regression gate.
12. The workstream split in §9 (W1 core -> W2 bots + in-process server -> W3 all screens -> W4 real sockets -> W5 close-out), each across Local + Bots + Online.
