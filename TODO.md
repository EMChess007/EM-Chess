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

## Threefold repetition never ends a game (any mode except Atomic)

**What's wrong.** Draw by threefold repetition is never detected anywhere in the app. Every game
screen builds its `ChessEngine` from the current FEN (`useMemo(() => new ChessEngine(fen, …), [fen, …])`
in `LocalGameScreen`, `BotGameScreen`, `ChessBoard`, `EngineVsEngineGameScreen`, …). chess.js only
counts repetitions from the moves it was actually *played through*, so a freshly-loaded engine has
no history and `isThreefoldRepetition()` / `isDraw()` can never fire. The 50-move rule (read from the
FEN's halfmove clock), stalemate and insufficient material still work, since they are functions of the
position alone.

The comment in `src/logic/gameOutcomeText.ts` (`case 'draw'`) claims `isDraw()` covers repetition — true
of chess.js in principle, false as the app uses it.

**How it was verified.** Playing 1.Nf3 Nf6 2.Ng1 Ng8 3.Nf3 Nf6 4.Ng1 Ng8 on one live `Chess` instance
gives `isThreefoldRepetition() === true`; a new `Chess(live.fen())` gives `false` (probe run during the
Atomic work; the same position, same code path every screen uses).

**Not fixed in the Atomic branch.** Atomic implements its own history-based repetition
(`isAtomicThreefoldRepetition` in `src/logic/atomic.ts`, fed `[initialFen, ...history.map(h => h.fenAfter)]`,
so it is correct after Undo). The other modes keep the old behaviour so nothing existing changes
unannounced.

**Suggested fix.** Generalise that helper to ordinary chess: key each position by FEN fields 1–4
(placement, side to move, castling, en passant — en passant only when a capture is actually legal, as
`atomicPositionKey` does) and treat the third occurrence of the latest position as a draw with reason
`'draw'`, computed in the screens from `history` the way `threeCheck`'s winner is. Needs: tests next to
`gameModes.test.ts`, a check of what the backend's `RoomChessEngine` does for Online games (not
verified whether the server tracks repetition itself), and a decision on whether Fog of War / Giveaway /
King of the Hill / Three-Check also want it (Fog of War and Giveaway probably not).

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

## 4 Player Chess: what it still leaves out

The engine (`src/logic/fourPlayer/`) is built so the rest slots in without rework, but none of these exist yet:

- **Teams and Solo modes.** `FourPlayerRules` already carries the knobs that differ (`promotionCoord` — Teams promotes on the 11th
  rank — and the point values); what is missing is the notion of allies (`attackers()` treats every other seat as an enemy) and the
  team/solo scoring and end conditions in `elimination.ts`.
- **Online.** The engine is pure TypeScript with no React/chess.js imports and a serialisable state (the clock model included), ready to be
  mirrored verbatim into `backend/src/game/` behind the same no-drift test the 2-player variants use. Needs 4-seat rooms, matchmaking for
  four, server-side per-seat clocks and a 4-player wire format. Nothing in the backend knows about it today.
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
