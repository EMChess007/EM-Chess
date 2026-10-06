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

## Spell Chess: Local + Bot + Online/backend wired, tsc-clean on both projects

**What's done, on the `spell-chess` branch.** The rules engine, `ChessEngine` wiring,
`gameResult.ts`/`gameOutcomeText.ts`/`gamePayload.ts`, `onlineVariants.ts`'s wire flag,
`VariantSelector.tsx`, the `chess.ts`/`history.ts` types, the bot heuristic
(`chooseSpellChessBotCast`), and `ChessBoard.tsx`/`Square.tsx`'s UI (spell bar, cast-then-move,
frozen/jump-square rendering) were all already in place before this pass — see this file's git
history for the detailed breakdown. `LocalGameScreen.tsx`/`BotGameScreen.tsx` (own a
`SpellChessState`, apply `castFreeze`/`castJump` then `afterSpellChessMove`, disable Hint/premoves,
short-circuit `chessStatus` around the kingless-FEN stalemate misreport) were wired in the previous
pass on this branch.

**This pass: Online/backend.** Mirrored the existing "Duck Chess wiring" shape (identified as the
closest template — the only other variant with genuine extra per-turn client input validated
together with the move, plus genuine extra persistent room state echoed on every payload) rather
than Giveaway/Atomic/Fog of War's (all stateless or purely-derived):

- `backend/src/game/spellChess.ts` (new) — the rules engine's server-side twin.
  `FREEZE_INITIAL_CHARGES`/`JUMP_INITIAL_CHARGES`/`SPELL_COOLDOWN_TURNS` through
  `activeJumpSquare` are a byte-identical "Shared rules block" with the mobile
  `src/logic/spellChess.ts` (same markers Duck Chess's two files already use — add this project's
  own `scripts/test-spell.mjs` later to enforce it automatically, same as `test-duck.mjs` does).
  `getJumpAugmentedCaptures`/`getCheckingPieceSquares`/`checkIsWaivedByFreeze`/
  `getSpellChessWinner`/`spellMoveNotation` are the server-only, engine-dependent twins — adapted
  to `RoomChessEngine` (which has no `getBoard()`, so `getCheckingPieceSquares` scans all 64
  squares via the new `getPieceAt` instead).
- `RoomChessEngine.ts` — added `getPieceAt`; `RoomChessEngineOptions.spellChess`/`frozenSquares`/
  `jumpSquare`/`freezeEscapeActive`; `skipValidation` extended with `|| this.spellChess`;
  `move()` dispatches to a new `moveSpellChess`/`applyRawSpellMove` pair (ported from mobile
  `ChessEngine.ts`'s identical methods) that are normal validated chess.js moves except for a
  Jump-augmented capture (force-applied via the same unvalidated `_makeMove` giveaway/duck already
  use) or a move played during a waived check (falls back to `movePseudoLegal`). `AppliedMove`
  gained an optional `spell` field (mirrors `duck`).
- `rooms.ts` — `Room`/`CreateRoomParams` gained `spellChess`/`spellState`; `applyMove` gained a
  scratch-engine two-part-turn block (cast validated against `room.spellState` first, then the
  move probed on a scratch `RoomChessEngine` built with the resulting frozenSquares/jumpSquare/
  freezeEscapeActive) — "cast is optional, move is mandatory", the mirror image of Duck Chess's
  "move is mandatory, placement is mandatory unless king capture"; a king-capture-via-Jump checked
  *before* `isGameOver()`/`getStatus()` (so the kingless resulting position is never asked, which
  would otherwise misreport it as a stalemate draw — the backend's version of the mobile
  `chessStatus` short-circuit); `rejoin`/`spectate`/the move-opponent/spectator payloads/the PGN
  variant tag all thread `isSpellChess`/`spellState`/`spell` through, same sites Duck Chess's
  `isDuckChess`/`duckSquare`/`duck` already use.
- `types.ts`, mobile `src/types/multiplayer.ts` — `MakeMovePayload.spell` (client sends only
  `{type, center|square}` — the server recomputes Freeze's `squares` itself, never trusting the
  client's), `OpponentMovePayload`/`RejoinStatePayload`/`SpectateStatePayload`/`MatchFoundPayload`
  gained `isSpellChess`/`spellState`/`spell` (the server echoes the *whole* `SpellChessState` back,
  unlike Duck Chess's single `duckSquare`, since there's materially more of it — charges,
  cooldowns, pending effects).
- `socketHandlers.ts`, `matchmaking.ts`, `challenges.ts`, `setupChessPairing.ts`, `tournaments.ts` —
  `isSpellChess` added everywhere `isDuckChess` already was (queue/challenge entry shapes, the
  matcher's exact-match predicate, `conflictingVariantError`'s mutual-exclusivity set, and
  `spellChess: false`/`isSpellChess: false` on the Setup-Chess/tournament paths that can never be
  it). `pgn.ts` gained a `{F@e4}`/`{J@d5}` move-comment prefix (mirrors Duck Chess's trailing
  `{@g6}`, just positioned before the SAN like the mobile app's own `spellMoveNotation`).
- Mobile `OnlineGameScreen.tsx` — a `spellState` + `spellRef` pair (mirrors `duckSquare`/`duckRef`);
  `handleOpponentMove`'s classification replay now constructs its throwaway engine with the correct
  `frozenSquares`/`jumpSquare`/`freezeEscapeActive` (derived from the state *after* applying the
  payload's own cast, exactly like the server) so a Jump-augmented or freeze-escape opponent move
  still classifies correctly instead of silently failing to replay; the rejoin resync rebuilds the
  move list the same "fresh engine per ply from a running state" way Duck Chess's replay already
  does, just carrying a whole `SpellChessState` forward instead of one square; `handleMove` applies
  `castFreeze`/`castJump`+`afterSpellChessMove` optimistically and sends `spell` alongside the move;
  header subtitle, move list, `ChessBoard`/`PostGameSummaryModal` props, premove disabling, and the
  rated-game/achievement exclusions all gained the same `spellChess` branch Duck Chess already has.
- Mobile `SpectatorGameScreen.tsx` — simpler, purely read-only: merges `spellState` off
  `spectator_move` the same way it already merges `duckSquare`, and passes `spellChess`/`spellState`
  straight into `<ChessBoard disabled>`.
- `TournamentScreen.tsx`'s `VariantSelector` `excludeVariants` gained `'spellChess'` (tournaments
  hardcode `spellChess: false`, same as every other non-classical variant there).
- Fixed a real, pre-existing bug surfaced by this pass: `src/logic/__tests__/duckOnline.test.ts`'s
  `variantWireFlags('duckChess')` `toEqual` assertion didn't include `isSpellChess` — now does.

**Verified for real this time**: `npx tsc --noEmit` run directly against *both* projects' own
`node_modules`/tsconfig — `backend/` (covering every backend file above) and the mobile app's root
(covering every mobile file above, plus `TournamentStandingsScreen.tsx`'s two `MatchFoundPayload`
literals, which needed `isSpellChess: false` too) — exit 0, zero errors, logs empty, on both.
`npx tsx scripts/test-duck.mjs` (and every other existing `backend/scripts/test-*.mjs`) could not be
run to regression-check this pass against: this sandboxed environment's `backend/node_modules` has
`@esbuild/win32-x64` installed (not `@esbuild/linux-x64`), so `tsx` itself fails before any of this
project's own code runs — a pre-existing environment/tooling gap unrelated to Spell Chess (confirmed
by `test-unlimited.mjs` failing identically), the same class of gap as this file's existing `vitest`
note below. Run the backend test scripts yourself on a real Linux `node_modules` install to cover
this gap, ideally after writing `scripts/test-spell.mjs` (see below). `vitest` for the Local/Bot
pieces still has the same pre-existing `rolldown` native-binding gap noted below.

**Not done:**
- **No `backend/scripts/test-spell.mjs`** (the NO-DRIFT / THE AUTHORITY / PARITY harness
  `test-duck.mjs` already has for Duck Chess) — couldn't be authored *and run* in one pass given
  the `tsx`/esbuild gap above; the mobile/backend files are already set up for the NO-DRIFT layer
  (matching "Shared rules block" markers in both `spellChess.ts` files) once it's written.
- **No CHECKLIST.md "new variant" extras yet**: no explicit mutual-exclusivity declaration checked
  against the other variants' own UI gating list (every site that gates on `giveaway`/`atomic`/
  `duckChess` was in fact updated to gate on `spellChess` too, across both passes on this branch,
  but there's no single canonical list it was checked against), and no mutation-testing pass
  actually run against `spellChess.ts` (designed for it — see the doc comments — but not executed).

**Suggested next step.** Write and run `backend/scripts/test-spell.mjs` on a working Linux
`node_modules` install (closes both the NO-DRIFT and PARITY verification gaps at once), then a real
end-to-end two-client online Spell Chess game to exercise the one path no automated test here
covers: an actual Jump-augmented king capture ending an Online game with reason `'spellChess'`.

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

## Crazyhouse: no analysis / Game Review, and per-ply state helpers could be shared

**What's missing.** A saved Crazyhouse game cannot be opened for analysis or Game Review: Stockfish cannot read a reserve or
play a drop, and `replayPgn` / `parsePgn` refuse `[Variant "Crazyhouse"]` (the `P@e5` drops are not moves, and the reserves and
promoted pieces are not in a PGN). Supporting it would need a Crazyhouse-capable engine (e.g. Fairy-Stockfish via UCI_Variant) plus a
PGN/FEN dialect that carries the pockets and the `~` promoted marks (the same dialect lichess/chess.com use).

**Small follow-up.** `src/logic/perPlyState.ts` (`latestPlyState` / `plyStateAtView`) is the shared way to read per-ply side-channel state.
Crazyhouse uses it; Duck Chess (`displayDuck`) and Spell Chess (`displaySpellState`) still carry equivalent inline copies in each game screen and
could migrate to it without any behaviour change.
