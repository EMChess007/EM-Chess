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

## Spell Chess: Local + Bot wired and tsc-clean; Online/backend still not wired in

**What's done, on the `spell-chess` branch.** The rules engine, `ChessEngine` wiring,
`gameResult.ts`/`gameOutcomeText.ts`/`gamePayload.ts`, `onlineVariants.ts`'s wire flag,
`VariantSelector.tsx`, the `chess.ts`/`history.ts` types, the bot heuristic
(`chooseSpellChessBotCast`), and `ChessBoard.tsx`/`Square.tsx`'s UI (spell bar, cast-then-move,
frozen/jump-square rendering) were all already in place — see this file's git history for the
detailed breakdown.

`LocalGameScreen.tsx` and `BotGameScreen.tsx` now both own a `SpellChessState` (derived from
`history[-1].spellState`, same pattern as `duckSquare`), pass `spellChess`/`spellState` into
`ChessBoard`, apply `castFreeze`/`castJump` then `afterSpellChessMove` when a move's `.spell` field
(human) or `chooseSpellChessBotCast`'s own pick (bot) says to, and pass `spellChessWinner` into
`getGameOutcome`/`buildGamePayload`. `BotGameScreen`'s bot-move effect now calls
`chooseSpellChessBotCast` before building its move engine, so the bot can actually cast — the move
itself stays plain legal chess via real Stockfish (not replaced the way Giveaway/Atomic/Duck Chess
replace it), with `frozenSquares`/`jumpSquare`/`freezeEscapeActive` passed into that move engine so
the engine itself enforces the cast's effect. Both screens explicitly short-circuit `chessStatus`
to `'playing'` once `spellChessWinner` is set, rather than trusting chess.js's own
`isStalemate()`/`isDraw()` on the kingless fen a Jump-king-capture leaves behind — empirically
verified on this project's own chess.js that both return `true` there, which would otherwise
misreport the win as a draw (it does NOT crash — `skipValidation` already covers that — this is a
correctness fix, not a crash fix). Hint is disabled for Spell Chess (Stockfish doesn't know about
frozen squares) and so are premoves in `BotGameScreen` (a queued move can't carry a cast).

Reachable from the picker now too: `PlayModeSelectScreen.tsx` has Bot/Local buttons
(`onBotSpellChess`/`onLocalSpellChess`), `App.tsx` threads a `spellChess: boolean` through
`TimeControlFlowMode`/`Screen`'s `botSelect`/`game`/`botGame` variants (mechanically, the same
discrete-boolean-prop pattern Duck Chess already established — 30 sites), `BotSelectScreen.tsx`
shows "Spell Chess" as the subtitle (no special bot-engine label needed — Spell Chess bots use real
Stockfish, unlike Giveaway/Atomic/Duck Chess), and `PostGameSummaryModal.tsx` disables Game Review
for it (Stockfish can't analyze frozen-square/jump positions), same as the other non-standard
variants.

**Verified for real this time** (see TESTING.md/AGENTS.md's general note on this environment vs. a
real toolchain): `npx tsc --noEmit` run directly on this project's own `node_modules`/tsconfig —
exit 0, zero errors, log empty — covering the rules engine, `ChessBoard.tsx`, and all of
`LocalGameScreen.tsx`/`BotGameScreen.tsx`/`App.tsx`/`BotSelectScreen.tsx`/
`PlayModeSelectScreen.tsx`/`PostGameSummaryModal.tsx` together. `vitest` still could not be run in
the sandboxed environment this was authored in (a `rolldown` native-binding mismatch between the
Windows-installed `node_modules` and the Linux shell used to run it — an environment/tooling gap,
not evidence of a code defect) — run `npm test -- spellChess` yourself to cover that gap.

**Not done — still not playable Online:**
- **Online/backend untouched.** No `backend/src/game/spellChess.ts` mirror, no `RoomChessEngine`/
  `rooms.ts`/`socketHandlers.ts`/`types.ts`/`matchmaking.ts`/`challenges.ts` wiring,
  `SpectatorGameScreen`/`OnlineGameScreen` untouched, no `scripts/test-spell.mjs` parity check.
- **No CHECKLIST.md "new variant" extras yet**: no explicit mutual-exclusivity declaration checked
  against the other variants' own UI gating (chess960/Fog of War/Giveaway/Atomic/Duck Chess/Setup
  Chess each have their own exclusion lists somewhere — Spell Chess isn't formally in any of them,
  though every site that gates on them was in fact updated to gate on `spellChess` too), and no
  mutation-testing pass actually run against `spellChess.ts` (designed for it — see the doc
  comments — but not executed).

**Suggested next step.** Run `npm test -- spellChess` for real to close the one remaining
verification gap, then take the same "mirror the existing variant's backend wiring" approach already
used for Duck Chess/Atomic/Giveaway to bring Spell Chess Online.

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
