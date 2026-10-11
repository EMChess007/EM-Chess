# 4 Player Chess Online — spec (v1)

Status: **approved; in progress** — W0 (2-player late-rejoin fix) and W1 (engine mirror + wire contract) are built and reviewed; W2 (room manager) is built and reviewed; W3 (bots, takeover, abandonment) is built, awaiting review; W4-W7 are not started. Written per CHECKLIST.md ("spec before code"). Covers both repos: frontend `EM-Chess` (this one)
and backend `chess-app-backend` (`backend/`). Decisions A/B/C below are the owner's; items marked **[confirm]** are details I chose
while writing this and want a yes/no on.

## 0. Summary (the 3-5 sentences)

Online 4 Player Chess is a new, parallel flow: a per-time-control queue that forms a Free-for-All room of 2-4 humans plus Amateur (1200)
bots after a ~30 s wait, played over a new `four_*` Socket.IO protocol whose unit of sync is a **serialized engine snapshot** (the same
`serialize()` string the engine already round-trips), with every action (human move, bot move, flag fall, resign) funnelled through one
server-side `commit()`. The server mirrors the existing pure 4-player engine (board/state/moves/elimination/bot/clock) as **generated,
CI-checked copies** (not hand-mirrored), and runs server-side bots — capped at the "careful" tier so no decision can block the event loop —
both to fill seats and to take over a seat 45 s after a disconnect, which the human can retake by rejoining until the game ends. Reused:
the whole frontend engine, `FourPlayerBoard`, `FourPlayerSeatStrip`, `usePremove`/premove, arrows, `PromotionPicker`, the socket singleton,
and the 2-player server's patterns (token rejoin, grace timers, spectator set, stub-socket test scripts, nightly fuzz). New: the
`four_*` protocol and room state machine, the 4-seat matchmaker, the mirror generator, the bot driver, and the client online screens.
Unchanged: every 2-player event and screen, **except** one deliberate fix to the 2-player "rejoin after game ended" gap (workstream W0).

**Interactions (stated, not assumed):** 2-player Online, tournaments, Setup Chess pairing, challenges, history, ratings, analysis, PGN and
puzzles are untouched (4 Player has no persistence/rating in v1). The new mode is structurally exclusive with every 2-player variant:
its own `four_*` event names mean a 2-player payload can never carry it, so the existing variant-conflict checks need no change. Local 4 Player (hotseat/bots)
is unchanged; Online 4 Player is entered from the Online menu and, like every Online entry today, requires a logged-in session on the client.

## 1. Decisions locked in

| | Decision |
|---|---|
| A1 | Queue per time control; after ~30 s fill empty seats with bots; **minimum 2 humans** to start. 4 humans start immediately. |
| A2 | A 3-human lobby that does not fill gets 1 bot, same rule. |
| A3 | Fill bots: fixed Amateur (ELO 1200). No scaling in v1. |
| A4 | Private/challenge-code 4-player rooms: **v2, out of scope.** |
| A5 | Online 4 Player forbids "No time limit" (and Daily). Live categories only. |
| B1 | Server-side bots are built in v1 and serve BOTH: filling seats at match start and taking over a seat 45 s after a mid-game disconnect; the human can retake the seat by rejoining at any point until the game ends. |
| B2 | Latency mitigation: **cap the server bot tier** (worker thread not needed — see §6.3). |
| B3 | If every human leaves, the game ends with **no result**. |
| C1 | No persistence / saved history in v1. |
| C2 | Chat and spectating included. |
| C3 | Random seat assignment; each client views from its own seat. |
| C4 | Fix the "stuck reconnecting after game ended" gap; keep finished results briefly. |

## 2. Configuration (one file, `fourPlayerConfig.ts`, backend)

| Constant | v1 | Note |
|---|---|---|
| `FILL_WAIT_MS` | 30 000 | Env override `FOUR_FILL_MS` honoured **only when `NODE_ENV !== 'production'`** (tests/dev). |
| `MIN_HUMANS` | 2 | |
| `TAKEOVER_GRACE_MS` | 45 000 | Same as the 2-player abandonment grace. |
| `ALL_GONE_MS` | 45 000 | Time with zero connected humans before the game ends with no result. |
| `FINISHED_RETENTION_MS` | 300 000 | How long a finished room's result is kept for late rejoins (4P and 2P). |
| `BOT_ELO` | 1200 | Fill and takeover. |
| `SERVER_BOT_MAX_ELO` | 1700 | Hard clamp: top of the "careful" tier (deep starts at 1800). |
| `BOT_THINK_MS` | 450 (200 in bullet) | Pacing, same as the local game. |
| `FOUR_TC_MIN_INITIAL_SECONDS` / `FOUR_TC_MAX_INITIAL_SECONDS` / `FOUR_TC_MAX_INCREMENT_SECONDS` | 60 / 3600 / 30 | Live Bullet/Blitz/Rapid only. **Lives in the shared wire file** (`src/logic/fourPlayerWire.ts`), not in `fourPlayerConfig.ts`: the client needs the same numbers for its time-control picker, and one definition cannot drift. `fourPlayerConfig.ts` imports them. |
| `FOUR_CHAT_MAX_LENGTH` | 500 | Same: shared, in the wire file. Longer text is cut (not refused), exactly like 2-player. |
| `FOUR_ID_MAX_LENGTH` | 64 | Shared. Upper bound for a roomId / playerToken (UUIDs are 36). |
| `CHAT_MIN_INTERVAL_MS` | 1000 | Server-only (stays in `fourPlayerConfig.ts`): the 2-player server has no chat rate limit; 4 recipients make one worthwhile. |

*(W1 note: the wire file also owns the validators that enforce these — see §3 — so the server and a client that pre-checks use the same code.)*

## 3. The `four_*` protocol

> **As built in W1** (`src/logic/fourPlayerWire.ts`; the tables below are the design, the file is the truth): types carry a `Four` prefix
> (`FourSeatInfo`, `FourStatePayload`, `FourRejoinAck`, ...); `FourClientToServerEvents` / `FourServerToClientEvents` type the events for
> Socket.IO generics; `four_rejoin` and `four_spectate_game` return a `FourRoomState` that includes the move log (`{ seat, text }[]`).
> Client input is validated by shared pure validators: `validateFourTimeControl`, `validateFourJoinQueue`, `validateFourMovePayload`,
> `normalizeFourChatText`, `validateFourId`. **Squares must be in canonical spelling** (`e2`, never `e02`: `squareName(parseSquare(x)) === x`),
> because the engine's `parseSquare` is lenient about leading zeros and this is client input at the server boundary. Validators never throw.

Squares travel as names (`"e2"`, files a-n, ranks 1-14; the engine's `parseSquare`/`squareName`). Seats are `0|1|2|3` =
Red, Blue, Yellow, Green (clockwise, the engine's order). All payload types live in **one** file, `src/logic/fourPlayerWire.ts`
(frontend, source of truth), and are copied to the backend by the same generator as the engine (§5), so client and server cannot disagree
on a field. Every client->server event takes an `Ack` (`{ok:true,…} | {ok:false,error}`) exactly like the 2-player ones.

```ts
type Seat = 0 | 1 | 2 | 3;
interface SeatInfo {
  seat: Seat;
  kind: 'human' | 'bot';
  /** Why a bot holds the seat: filled at match start, or taking over for a human who left. */
  botReason?: 'fill' | 'takeover';
  /** Display name: username, "Guest", or "Bot". No userIds on the wire. */
  name: string;
  elo?: number;             // bots only
  connected: boolean;       // humans only; a bot is always "connected"
  /** For a disconnected human still inside the 45 s grace. */
  graceMsLeft?: number;
}
type FourReason = 'elimination' | 'cap' | 'deadPosition' | 'abandoned';
```

**Client -> server**

| Event | Payload | Ack | Notes |
|---|---|---|---|
| `four_join_queue` | `{ timeControl, timeControlLabel? }` | `{ok}` | Validated: live range (§2). One queue entry per socket. |
| `four_leave_queue` | `{}` | `{ok}` | Also implicit on `disconnect`. |
| `four_make_move` | `{ roomId, from, to, promotion?: 'q'\|'r'\|'b'\|'n' }` | `{ok, seq}` | Server resolves it with `findLegalMove(state, seat, from, to, promotion)` for the **socket's own seat**. Illegal / not your turn / wrong room -> `{ok:false}`, room untouched. |
| `four_resign` | `{ roomId }` | `{ok}` | Eliminates the seat (`resign(…,'resign')`); the game continues. |
| `four_rejoin` | `{ roomId, playerToken }` | `{ok, state: FourRejoinState}` or `{ok, finished:true, gameOver}` | See §4.4. |
| `four_send_chat` | `{ roomId, text }` | `{ok}` | Humans in the room only; rate limited. |
| `four_list_active_games` | `{}` | `{ok, games: FourActiveGameSummary[]}` | `{roomId, timeControlLabel, seats: {name,kind}[4]}`. |
| `four_spectate_game` | `{ roomId }` | `{ok, state: FourSpectateState}` | Read only. |
| `four_stop_spectating` | `{}` | `{ok}` | |

There is **no** `offer_draw`/`respond_draw`: the engine models no draws.

**Server -> client**

| Event | Payload | To |
|---|---|---|
| `four_queue_update` | `{ queued: number, fillInMs: number \| null }` | queued sockets of that time control; `fillInMs` counts down to the bot fill, `null` while < 2 humans |
| `four_match_found` | `{ roomId, seat, playerToken, seats: SeatInfo[4], timeControl, state: string, clocksMs: number[4], seq: 0 }` | each human, with **their own** seat/token |
| `four_state` | `{ roomId, seq, actor: 'human'\|'bot'\|'clock'\|'resign', move: {seat,from,to,promotion?,label} \| null, events: WireEvent[], state: string, clocksMs: number[4] }` | every seat + spectators after **every** state change |
| `four_seat_update` | `{ roomId, seats: SeatInfo[4] }` | every seat + spectators (connect, disconnect, takeover, retake) |
| `four_game_over` | `{ roomId, reason: FourReason, winners: Seat[], scores: number[4], state: string }` | seats + spectators. `abandoned` -> `winners: []`, scores omitted from the UI ("no result") |
| `four_chat_message` | `{ fromSeat, name, text, sentAt }` | other human seats + spectators |

`state` is `serialize(FourPlayerState)` (about 420 chars: cells, turn, statuses, scores, castling bits, en passant, ply, result).
`WireEvent` is the engine's `GameEvent` list as plain JSON (`move`, `deadKingMove`, `eliminated`, `frozen`, `gameOver`), used for
move log, sounds and "Blue was checkmated by Red (+20)" notices; the **snapshot is the authority**, events are presentation.
Dead-king walks are random, so clients never replay moves to derive a position — they adopt `state`.

**Ordering and loss.** `seq` starts at 0 and increases by exactly 1 per `four_state`. A client ignores `seq <= current`, and on a gap
(`seq > current + 1`) it calls `four_rejoin` to resync. Socket.IO already delivers in order per connection; `seq` covers reconnects.

**Optimistic own move (client).** On a tap-move the client shows the moved piece immediately via `applyMoveRaw` (deterministic, no RNG)
and marks the turn pending; the following `four_state` replaces it with the authoritative snapshot (which may include eliminations and
dead-king walks the client cannot predict). A rejected ack rolls back to the last authoritative snapshot. The 8 s ack timeout and revert
mirror the 2-player screen.

## 4. Server design (`backend/src/game/fourPlayerRooms.ts` + `fourPlayerMatchmaking.ts`)

> **As built in W2** (`backend/src/game/fourPlayerRooms.ts`, `fourPlayerConfig.ts`; the text below is the design, the code is the truth):
> - `commit()` takes an already-computed step (`state`, `clock`, `events`, `move`, `log`) instead of an action: **clock charging is a PURE
>   computation (`charge()`) whose result is fed into a commit**, so `commit()` is literally the only assigner of `state`/`clock`/`seq`/`turnStartedAt`
>   (pinned by a source-level test). A flag that falls before a move or a resignation is committed as its own `four_state` (actor `clock`), so such a
>   call can publish two states (`seq` +2).
> - Seats carry no `userId` (nothing reads it with no persistence in v1; add it with v2 history). `createRoom` sends each human its own
>   `four_match_found` itself. Every inbound method takes `unknown` and validates with the shared wire validators; the seat always comes from the socket.
> - `emit()` is the only send; it catches and logs, so a failing socket cannot abort a commit. `endGame` records the finished result before sending.
> - Finished-result retention equals the 2-player server's (pinned by a test); a seated socket cannot spectate; a spectator watches one game at a
>   time; `four_resign` after the seat's own flag fall is simply `ok` (one state published).
> - Config holds only constants a workstream uses: W2's are `FOUR_FINISHED_RETENTION_MS`, `FOUR_FINISHED_SWEEP_INTERVAL_MS`, `FOUR_CHAT_MIN_INTERVAL_MS`,
>   `FOUR_MOVE_RATE_LIMIT`, `FOUR_NAME_MAX_LENGTH`; the bot/takeover constants arrive with W3, fill-wait and minimum humans with W4.
> - **Seams for W3:** `commit()`'s tail (end the game or re-arm the clock timer) is where the bot driver is scheduled; seat runtime already has
>   `controller`, `botReason`, `elo`, `originalHuman`, `disconnectedAt`; `handleDisconnect` is where the grace timer starts; `rejoin` is where a
>   taken-over seat is retaken. **Open for W4:** a per-room spectator cap (W2 has none).

> **As built in W3** (same files; backend TESTING.md §12): **bots** run on their own random stream (`botRng`, so a bot's decision never shifts the
> engine's stream and a game with bots can be replayed on an independent engine), through the same funnel (actor `bot`), clamped to
> `min(elo, FOUR_SERVER_BOT_MAX_ELO = 1700)`; the chosen move is checked against the engine's legal moves and a bot that returns nothing, an illegal
> move or THROWS gets the first legal move (an exception in a timer callback would kill every game on the process). Bot pacing is the local game's rule
> (450 ms, Bullet <= 120 s: 200 ms). **Takeover** only if the seat is still active, still disconnected and some ORIGINAL human is still connected;
> an eliminated human's disconnect starts no grace; SeatInfo carries `graceMsLeft`. **Retake** cancels the seat's grace countdown, a pending bot move
> and the all-gone countdown. **All-gone** counts original humans with a live socket (a bot-held seat and spectators do not count) and ends with reason
> `abandoned`, no winners; at a seat's grace expiry with nobody connected there is no takeover (the all-gone countdown decides). **Fast-forward**: no
> human-CONTROLLED seat is still active (an away active human still counts as playing) and a human is connected -> bots play with delay 0, one ply per
> timer. `finish()` is the one way a game ends (engine result or abandonment): record first, clear every timer, then `four_game_over` (sent from
> nowhere else). Config additions: `FOUR_TAKEOVER_GRACE_MS`, `FOUR_ALL_GONE_MS`, `FOUR_BOT_ELO`, `FOUR_SERVER_BOT_MAX_ELO`, `FOUR_BOT_THINK_MS`,
> `FOUR_BOT_THINK_BULLET_MS`, `FOUR_BULLET_MAX_INITIAL_SECONDS`, `FOUR_FAST_FORWARD_DELAY_MS`, `fourBotThinkMs()`. Open for W4: the fill timer and
> `FOUR_FILL_MS` override, minimum humans, the queue, the per-room spectator cap, registering the events.

### 4.1 Room model
`FourRoom { id, state, clock, turnStartedAt, seq, seats[4], moves[], spectators:Set, status, timers… }` with
`seats[i] = { controller:'human'|'bot', botReason?, elo?, originalHuman:boolean, socketId|null, userId|null, name, playerToken|null,
connected, disconnectedAt, graceTimer }`. Clock = the engine's `FourPlayerClock` (seconds); the wire carries ms.

### 4.2 One funnel: `commit(room, actor, action)`
Every state change — human move, bot move, flag fall, resign — goes through this single function, which:
1. **charges elapsed time** to the seat on move with the engine's own `clockTick(state, clock, elapsed, rng)`; if that flags the mover, their
   move is refused ("your flag fell") and the timeout elimination is what gets broadcast (the server decides, not the client);
2. applies the action (`playMove` / `resign`), then `addIncrement` for the mover of a move;
3. `seq++`, appends to the move log, broadcasts `four_state` to seats and spectators;
4. if `state.result`, `endGame(room)`; otherwise reschedules the clock timer for the new seat on move and the bot driver (§6).
Nothing else mutates `room.state`. This is the property the tests and mutation checks target.

### 4.3 Clock
Only the seat on move runs (an engine invariant). One timer per room, set to that seat's remaining ms; when it fires it calls
`commit(room,'clock', clockTick…)`. Bot seats are charged like anyone (they move in ~0.5 s). Eliminated seats are never charged.

### 4.4 Disconnect, takeover, rejoin, end of game
- **Disconnect:** seat `connected=false`, `four_seat_update` (with `graceMsLeft`), start `graceTimer` (45 s). The seat's clock keeps
  running; if it flags during the grace it is eliminated by timeout as usual.
- **Takeover (B1):** at grace expiry, if the seat is still active and the room is alive, `controller='bot'`, `botReason='takeover'`
  (elo 1200), broadcast `four_seat_update`, and the bot driver plays the seat if it is its turn.
- **Retake (B1):** `four_rejoin` with the seat's `playerToken` at **any** time while the room is active: reattach the socket, clear the
  grace timer, `controller='human'`, cancel the seat's pending bot timer (the bot callback also re-checks `controller` and `seq` when it
  fires, so a stale callback is harmless), cancel the all-gone timer, broadcast `four_seat_update`, return the full state. A newer
  connection for the same seat silently replaces the older (as in 2-player).
- **Every human leaves (B3):** `connectedHumans` = original-human seats with a live socket. When it hits 0 an `ALL_GONE_MS` timer starts
  (cancelled by any rejoin); at expiry the room ends with `reason:'abandoned'`, `winners:[]`, nothing persisted. At a seat's grace expiry the
  all-gone check runs **first** (so the last leaver ends the game rather than handing a bot an empty room).
- **Humans eliminated but still connected [confirm]:** if no *active* human remains but some human is still watching, remaining bots
  **fast-forward** (no think delay, `setImmediate` between plies so the event loop is never held) to the natural end, because an
  eliminated human's final placement depends on the scores. If those watchers disconnect too, the all-gone rule above ends it.
- **Resign:** eliminates the seat; the human stays attached as a watcher until `game_over`.
- **endGame:** clear every timer (clock, bot, graces, all-gone), send `four_game_over` to seats and spectators, and move the room to
  `finishedRooms` (token -> seat, final payload) for `FINISHED_RETENTION_MS` (swept by an `unref`'d interval) before deleting it.
- **Late rejoin (C4):** `four_rejoin` on a finished room returns `{ok:true, finished:true, gameOver}` instead of "not found".

### 4.5 Chat and spectating (C2)
Chat is relayed to the other human seats and to spectators (spectators cannot send). Spectators receive `four_state`, `four_seat_update`,
`four_game_over`, `four_chat_message`; they see the whole position (there is no hidden information) and cannot move (they own no seat).

### 4.6 Limits
Payload validation on every event; `four_make_move` rate-limited per socket (10/s, excess ignored with an error ack); chat limits above;
one queue entry and one seat per socket; tokens are `randomUUID()`.

## 5. Parity: generated mirror + import-suffix fix (CHECKLIST 4)

**Problem.** The backend is `module: NodeNext`, which requires explicit `.js` suffixes in relative imports; the frontend engine uses
extensionless imports (`'./board'`) for Metro/vitest. Byte-identical hand mirroring (the existing practice) is therefore impossible, and
hand mirroring is exactly how drift happens.

**Solution: generate, don't mirror by hand.**
- Source of truth stays in the frontend: `src/logic/fourPlayer/{board,state,moves,elimination,bot,clock}.ts` and `src/logic/fourPlayerWire.ts`.
  (The engine's import graph is closed over exactly these six; `setup`, `presentation`, `premove`, `annotations` are client-only and are **not** mirrored.)
  **As built:** the list lives in `src/logic/fourPlayer/MIRRORED_TO_BACKEND.json` (the owner of the source owns it); the app repo's
  `fourPlayerMirrorSet.test.ts` enforces the closure rule and that the list equals the closure of `bot`, `clock` and the wire file, so a
  client-only import fails in the app repo, not only later in the backend CI.
- `backend/scripts/sync-fourplayer.mjs` writes `backend/src/game/fourPlayer/*.ts` and `fourPlayerWire.ts` with **exactly one transform**:
  `from './x'` / `export * from './x'` -> `…'./x.js'`, plus a generated-file banner. It also emits the backend `index.ts` for the six
  modules, and **fails** if a mirrored file imports anything outside the mirrored set.
- `npm run sync:fourplayer -- --check` regenerates in memory and exits non-zero on any difference; CI runs it right after the existing
  frontend checkout (the paired-branch checkout in `ci.yml` already recreates the layout). Generated files are **committed** so the
  backend builds and deploys standalone, never needing the frontend repo at runtime.
- `scripts/test-fourplayer.mjs` is the behavioural net behind the mechanical one: seeded random full games (promotions, castling, en
  passant, resigns, timeouts, dead-king walks) run through the frontend engine and the backend mirror with identical RNG; every ply must
  produce the same `serialize()`, the same event JSON and the same legal-move list, and the bots (1200 and 1700) must choose the same move.
- **Client/server contract:** the client deserializes the server snapshot with its own copy of the same engine and uses that engine for
  legal-move highlighting, premove resolution and optimistic moves; the server re-validates everything.
- Wire types come from the same single file (above), so a protocol change is one edit plus a regenerate.

## 6. Server bots (B1/B2)

### 6.1 Driver
After every `commit`, if the seat on move is bot-controlled and the game is live, schedule **one** bot timer (`BOT_THINK_MS`, or
immediately in fast-forward). On fire it re-checks: room active, same `seq`, seat still bot-controlled. Then
`chooseBotMove(state, min(elo, SERVER_BOT_MAX_ELO), rng)` -> `commit(room,'bot', playMove)`. If the bot ever returned `null` or an
illegal move (it must not), the driver plays the first legal move so a room can never stall; the event is logged.

### 6.2 Identity and pacing
`SeatInfo{kind:'bot', botReason, name:'Bot (Amateur)'}` for fills; takeover seats keep the human's name with a "bot playing" badge client-side.
Both use ELO 1200. Bots never premove.

### 6.3 Latency mitigation: tier cap, no worker thread
Measured today on this machine (14 full self-play games per ELO, 4-seat rules, ~4 000-7 000 decisions each):

| ELO | tier | mean | p99 | p99.9 | max |
|---|---|---|---|---|---|
| 1200 | careful | 0.9 ms | 7.3 | 11.2 | **20.8 ms** |
| 1700 | careful | 1.1 ms | 7.9 | 11.8 | **18.1 ms** |
| 1800 | deep | 4.6 ms | 38.7 | 102 | 191 ms |
| 3000 | deep | 15.1 ms | 110 | 170 | 210 ms |

The careful tier tops out around 20 ms per synchronous call; the deep tier is what could hold the loop for ~200 ms. So the server clamps every
bot to `SERVER_BOT_MAX_ELO = 1700` (a unit test asserts the clamp and that the tier is not `deep`), which gives the same safety with no
worker-thread plumbing (serialization, lifecycle, crash handling). A worker is the documented upgrade path if stronger server bots are
ever wanted: `chooseBotMove` is pure, so it moves unchanged, and the server would still validate the result with `findLegalMove`.
Fast-forward yields between plies, so one room never starves the others by more than one decision.

## 7. Matchmaking (A1-A5) — `FourPlayerMatchmaker`

Separate class from the 2-player `Matchmaker` (which stays untouched). Queues keyed by `initialSeconds|incrementSeconds`.
- The 4th human arriving starts the room immediately (first four, FIFO).
- With **>= 2** humans queued, a `FILL_WAIT_MS` timer starts **[confirm]** (measured from the moment the lobby first reaches 2, not from each
  player's own join, so a player who waited alone is not penalised and a late second player does not trigger an instant 1-human-plus-bots
  start). At expiry: all queued humans (2 or 3) + bots to four seats.
- Dropping below 2 cancels the timer; re-reaching 2 restarts it. A lone human waits indefinitely (UI offers cancel).
- `four_queue_update` is pushed to the lobby on every change, with `fillInMs`.
- Leave/disconnect removes the entry. Seats are assigned by a random shuffle (crypto RNG); Red moves first.
- Names: usernames resolved once at room creation (one DB query, like `listActiveGames`); guests become "Guest".
- Time control must satisfy `TC_MIN/MAX` and increment bounds (A5): `initialSeconds` 60-3600, so unlimited and Daily are rejected with an error.

## 8. Frontend

- **Entry:** Online card on the Play menu -> `TimeControlSelectScreen` with `excludeCategories: ['daily','unlimited']` -> `FourPlayerMatchmakingScreen`
  (lobby count, fill countdown, cancel) -> `FourPlayerOnlineGameScreen`; plus a spectator screen reached from the existing list (which gains
  a 4 Player section). Login required, as for every Online entry.
- **State:** `useFourPlayerOnlineGame(match)` owns the socket listeners and a **pure reducer** (`applyFourState`) for `seq` ordering,
  snapshot adoption, optimistic move and rollback — the part that is unit-tested, since the project has no RN renderer.
- **Reuse (props already generic):** `FourPlayerBoard` (`viewSeat=mySeat`, `interactive = turn===mySeat && connected && active`,
  `premoveSeat=mySeat`, `enableAnnotations`), `FourPlayerSeatStrip` (gains an optional per-seat `names` and a connection/bot badge),
  `usePremove` + `resolvePremove`, `PromotionPicker`, `formatSeatClock`. New: a cosmetic remote clock ticker (authoritative `clocksMs`,
  local countdown for the seat on move), chat panel, disconnect/bot-held badges, result card.
- **Reconnect:** Socket.IO `reconnect` -> `four_rejoin`; `finished` -> show the result (the gap fix); failure leaves a clear
  "game not found" state instead of hanging.
- **Premove online:** `premoveSeat = mySeat` always (no hotseat ambiguity). Safe because the client holds the full engine state from the
  snapshot, fires the premove through the same send path as a manual move, and the server re-validates. Annotation invariant works unchanged
  (`state.ply` comes in the snapshot; bot and server moves advance it).
- **Local 4 Player is untouched.**

## 9. Workstreams and order (branch `fourPlayerOnline` in both repos; frontend from `fourPlayerChess`, backend from `main`)

| | Work | Independent? |
|---|---|---|
| W0 | **2-player late-rejoin fix:** `RoomManager.finishedRooms` (both tokens), `rejoin` returns `{ok, finished, gameOver}`, `OnlineGameScreen` handles it (extract the game-over side effects once). Touches live 2-player server + client, so it ships first as its own commit/PR with its own test. | yes |
| W1 | Generator, generated mirror, wire types, CI `--check`, `test-fourplayer.mjs` parity | yes — **done** (backend TESTING.md §10, frontend §11) |
| W2 | `FourRoomManager`: commit funnel, clocks, resign, endGame, finished retention, chat, spectate (no bots yet); stub-socket + fake-timer script | after W1 — **done** (backend TESTING.md §11) |
| W3 | Bot driver, takeover/retake, all-gone, fast-forward, tier clamp | after W2 — **done** (backend TESTING.md §12) |
| W4 | `FourPlayerMatchmaker`, handler registration, validation/rate limits, disconnect hook, active-games list | after W2 |
| W5 | Client: wire use, reducer/hook, screens, nav, chat, spectator, SeatStrip props, tests | after W2/W4 contract |
| W6 | `test-fourplayer-online.mjs` (real server, socket.io-client), nightly fuzz section, CI/nightly wiring | after W3-W5 |
| W7 | Docs (backend TESTING.md §12, frontend TESTING.md §9, TODO), mutation checks, browser verification with two tabs + bot fill (`FOUR_FILL_MS=3000`) | last |

## 10. Test plan (CHECKLIST 2, 3, 4, 5)

**Edge cases, each with a test** (server unless noted): illegal move; move out of turn; move for another seat's pieces; move in a finished
room; promotion choices (q/r/b/n) and an invalid promotion piece; castling; en passant across axes; resign on and off turn; flag fall on
the seat to move (move arriving after its flag); timeout elimination continuing the game; third elimination ends the game; dead position
and cap endings; dead-king walk is a move (`seq`/`ply`); disconnect -> grace -> takeover -> bot plays at its turn; retake at every stage
(during grace, after takeover, while a bot timer is pending, while it is the seat's turn); stale bot callback after retake; all humans
gone (grace race ordering: last leaver ends the game, no takeover); eliminated-but-watching humans trigger fast-forward and end; double
connection for one seat; rejoin with a bad token / wrong room / finished room (4P and 2P); chat limits and rate; spectator cannot move and
sees every state; queue: 2 humans wait the full fill time, 3 humans get 1 bot, 4 start at once, leaving below 2 cancels the timer, time
controls never mix, unlimited/Daily rejected, one entry per socket; seat randomisation covers all permutations over many runs; no timers
remain after `endGame` (fake-timer count); `commit` is the only mutator (source pin); client reducer: out-of-order and duplicate `seq`,
gap -> resync, optimistic move + rollback, premove fired on the turn snapshot, eliminated while waiting.
**Performance:** a 1 000-ply server game (bots + humans) stays within a CPU budget; per-decision bot time asserted below a generous
bound at 1200/1700 and the `deep`-tier clamp asserted structurally; payload size per `four_state` measured and logged.
**Parity:** §5 (mechanical `--check` + behavioural script + nightly fuzz with 4 real socket clients: identical snapshots to every seat for
every `seq`, `seq` contiguous, every client move legal in its own engine, final result consistent with `game_over`, random
disconnects/rejoins).
**Mutation checks:** on the new orchestration logic (`commit`, takeover/retake, all-gone ordering, fill-timer rules, clamp, seq handling),
with the hardened per-mutant-timeout harness; survivors are test gaps unless shown equivalent.
**Cross-feature:** 2-player Online suite and nightly stay green (W0 is the only change to its behaviour); bots = the existing 4-player
heuristic bot, tier-capped (no Stockfish); analysis/PGN/history/puzzles unaffected (no persistence).
**Docs:** doc comments on every new file (why, gotchas); backend TESTING.md gets a "4 Player Chess Online (server side)" section; frontend
TESTING.md §9 and TODO.md updated (Online done; private rooms, history/ratings, Teams/Solo online remain).

## 11. Known limits (deliberate, v1)

In-memory rooms (a server restart ends every game, as for 2-player); single process; no persistence, ratings or history; no private rooms;
no draws; bots capped at 1700 and fixed at 1200; no team/collusion detection in FFA (unrated, so low stakes); a lone human can wait
indefinitely in the queue.

## 12. Please confirm (details I chose)

1. Fill timer starts when the lobby first has **2 humans** (not each player's own join time), 30 s, restarting if it drops below 2.
2. Eliminated-but-connected humans -> remaining bots **fast-forward** to a natural end (rather than ending at once).
3. Time control range 60-3600 s initial, 0-30 s increment (= Bullet/Blitz/Rapid presets).
4. Chat is also shown to spectators (they cannot send).
5. W0 (the 2-player late-rejoin fix) ships first, separately, since it changes live 2-player server and client behaviour.
6. Client keeps the existing login gate for Online entry (the server itself would accept guests).
