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

## Spell Chess: rules engine done, UI/bots/Online not wired in yet

**What's done, on the `spell-chess` branch.** The rules themselves — confirmed directly against
chess.com's own Help Center, screenshotted 2026-10-04, not inferred from third-party summaries —
live in `src/logic/spellChess.ts`: Freeze (3x3 zone, one-ply window, defensive check-escape),
Jump (transparent square, 2-ply window, augmented captures including the king), charges/cooldowns.
Wired into `ChessEngine` (`spellChess`/`frozenSquares`/`jumpSquare`/`freezeEscapeActive` options,
`moveSpellChess`/`applyRawSpellMove`), `gameResult.ts` (`spellChessWinner`, checked before
`chessStatus` for the same reason `duckChessWinner`/`atomicWinner` are), `gameOutcomeText.ts`,
`gamePayload.ts` (PGN `[Variant "Spell Chess"]`), `onlineVariants.ts` (`isSpellChess` wire flag,
ready for when Online exists), `VariantSelector.tsx` (picker chip), `types/chess.ts`
(`Move.spell`/`SpellCast`), `types/history.ts` (`GameHistoryEntry.spellState`), and a first bot
heuristic (`chooseSpellChessBotCast` in `bots.ts` — the spell-cast decision only; the move itself is
plain legal chess, so Stockfish is NOT replaced here the way Giveaway/Atomic/Duck Chess replace it).
Tests: `spellChess.test.ts` (zone geometry, cooldown timing, the a-file rook/pawn/queen jump trap,
rook-vs-bishop geometry, double-check `checkIsWaivedByFreeze`) and `spellChessBot.test.ts`.

`ChessBoard.tsx` now has the UI too: `spellChess`/`spellState` props feed `frozenSquares`/
`jumpSquare`/`freezeEscapeActive` into the `ChessEngine` it builds (and into the scratch engine
`tryMove` uses for a real human move, and the animation effect's own scratch engine's
`skipValidation`, since a Jump-captured king leaves a kingless fen the same way Duck Chess/Fog of
War/Giveaway do). A spell bar renders under the board (Freeze/Jump buttons showing that side's own
charges, disabled by charges/cooldown/gameOver/disabled and mutually while the other is mid-pick);
tapping one enters `castMode`, and the next square tap commits a `pendingCast` (any square for
Freeze's center, only an occupied one for Jump) — intercepted at the very top of
`handleSquarePress`, before normal piece-selection even runs. `pendingCast` rides along as
`move.spell` once a real move actually lands (`finishRegularMove`), mirroring Duck Chess's own
`duck` field the other way round in turn order; `castMode`/`pendingCast` reset on `fen` change same
as `selectedSquare`/`pendingPromotion`/`pendingDuck`. `Square.tsx` already had `isFrozen`/
`isJumpSquare` wired through to render them (icy/purple tint).

**Not done — still not a playable feature end-to-end:**
- **No screen wiring yet.** `LocalGameScreen`/`BotGameScreen` don't own a `SpellChessState`, pass
  `spellChess`/`spellState` into `ChessBoard`, call `afterSpellChessMove`, or pass
  `spellChessWinner` into `getGameOutcome`/`buildGamePayload`. `chooseSpellChessBotCast` is written
  but nothing calls it. `ChessBoard` itself never calls `castFreeze`/`castJump` — it only builds the
  `SpellCast` object attached to `move.spell`; the caller is the one expected to actually spend the
  charge via `castFreeze`/`castJump` once it sees that field (see the `spellState` prop doc comment)
  — not yet exercised by any screen.
- **Not reachable from the picker's actual game-start flow** even though `VariantSelector` lists
  it — picking it today would hit a screen with no spell-chess plumbing behind it.
- **Online/backend untouched.** No `backend/src/game/spellChess.ts` mirror, no `RoomChessEngine`/
  `rooms.ts`/`socketHandlers.ts`/`types.ts`/`matchmaking.ts`/`challenges.ts` wiring,
  `SpectatorGameScreen`/`OnlineGameScreen` untouched, no `scripts/test-spell.mjs` parity check.
- **No CHECKLIST.md "new variant" extras yet**: no explicit mutual-exclusivity declaration checked
  against the other variants' own UI gating (chess960/Fog of War/Giveaway/Atomic/Duck Chess/Setup
  Chess each have their own exclusion lists somewhere — Spell Chess isn't in any of them), no
  mutation-testing pass actually run against `spellChess.ts` (designed for it — see the doc
  comments — but not executed), and `tsc`/`vitest` still haven't been run for real with the
  project's own toolchain: this environment's `npm install` 403s on a transitive `zod` tarball
  (registry/security-policy block, not a project problem), so the `ChessBoard.tsx` changes above
  were instead checked with a type-stripping `esbuild` parse (catches syntax/JSX-nesting mistakes,
  not type errors) plus a manual line-by-line check against `ChessEngineOptions`/`SpellCast`/
  `SpellChessState`'s actual field names and shapes.

**Suggested next step.** Run `npm test -- spellChess` and `npx tsc --noEmit` for real somewhere
with working registry access first — if anything fails, it's most likely a small mismatch with the
real chess.js version's internals (`_makeMove`/`_moves` — see `ChessEngine.ts`'s own
`ChessInternals` comment) or a genuine type slip in the new `ChessBoard.tsx` code, not a design
error. Once green, the natural next slice is `LocalGameScreen.tsx` (own a `SpellChessState`, pass
`spellChess`/`spellState` into `ChessBoard`, call `afterSpellChessMove` + the matching
`castFreeze`/`castJump` when `move.spell` comes back from `onMove`) to get a genuinely playable
Local game, THEN `BotGameScreen.tsx` (wire `chooseSpellChessBotCast`), THEN Online.

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
