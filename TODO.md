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

## 4 Player Giveaway: what it still leaves out

Built on the `fourPlayerGiveaway` branches (workstreams W1-W5; roll-up at the top of TESTING.md). Local, Bots and Online all exist; these are the deliberate v1 limits:

- **No king promotion.** Promotion is Q/R/B/N only (kings are ordinary pieces that can be captured, but a pawn cannot become one) - the spec's decision, not a sourced rule.
- **No history, ratings, saved games or analysis** for Giveaway games (same reason as 4 Player Chess: the saved-game payload and PGN are 2-player shaped).
- **The bot is a v1 heuristic.** Same ELO dial as 4 Player Chess, no deep tier. It does not plan to get stuck on purpose (being stuck WINS) and looks only at the move and the NEXT seat, so it rarely engineers a win by running out of moves.
- **"Return to your game" shares one resume slot** on the 4 Player card, so a player in a Chess game and a Giveaway game at once is only offered one of them.
- **The setup screen says the rule twice** (the hint line and the intro paragraph): a copy tidy-up.
- **The 1000-ply cap is unreachable by random or bot play.** It is pinned by hand-built positions in the engine and parity tests, but no real-socket game has ever ended by it.
- **Not seen in a browser:** the D15 refusal screen (a server that does not echo the requested variant), a bot taking over a seat on screen, and the 4 Player Chess online screens after the variant changes (covered by the golden gate and pure tests only).
- **Everything else under "4 Player Chess: what it still leaves out"** that is not about points or check (private rooms, a persisted rejoin token, chat history after a reconnect, small cells on phones) applies unchanged.

## 4 Player Chess: what it still leaves out

The engine (`src/logic/fourPlayer/`) is built so the rest slots in without rework, but none of these exist yet:

- **Teams and Solo modes.** `FourPlayerRules` already carries the knobs that differ (`promotionCoord` — Teams promotes on the 11th
  rank — and the point values); what is missing is the notion of allies (`attackers()` treats every other seat as an enemy) and the
  team/solo scoring and end conditions in `elimination.ts`.
- **Online — done, except the browser pass below: built and tested on the `fourPlayerOnline` branch (workstreams W0-W7).** Live Free-for-All with a queue per time control, bots filling to four,
  server bots taking over for a dropped player (retake until the game ends), spectating, chat, premoves, a real-socket end-to-end test and a nightly fuzz section. See
  `FOUR_PLAYER_ONLINE_SPEC.md` and the "4 Player Chess Online" roll-up at the top of TESTING.md. What is still out, by design (v1): private rooms / invite links, saved games / history /
  ratings / analysis of online games, Teams and Solo online, a persisted rejoin token (an app restart or web refresh forfeits the seat to a bot), chat history after a reconnect, and the bot
  promotion-nudge parity follow-up (the one server-bot behaviour only covered by the random parity games). **Partly open, found by the W7 close-out:** the 4 Player Chess player screens were never looked at
  rendered. The 4 Player Giveaway browser pass (its W5) covered the screens both variants share - queue, game, leave and "Return to your game", spectate list, resign, result card - so what is still unseen for CHESS is the variant-specific wording there and a bot takeover in the browser; do it with two humans (a lone human never gets bots) and
  the backend started with `FOUR_FILL_MS=3000 FOUR_GRACE_MS=3000` (a scripted guest socket works as the second human).
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
