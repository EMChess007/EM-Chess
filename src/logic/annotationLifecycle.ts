/**
 * THE ANNOTATION INVARIANT — one rule for every board in the app (classic and its variants, 4 Player Chess and its variants, Online).
 *
 *   Arrows and highlights persist across turns — the player's own and every opponent's / other seat's — and are cleared at exactly one
 *   moment: when a MOVE is played, by anyone (the position changed). They are NOT tied to whose turn it is: the turn starting, the turn
 *   passing, a seat being skipped or eliminated without a move, a clock flag falling, a rotation of the view — none of these clear them.
 *   (Same as chess.com and Lichess.)
 *
 * HOW A BOARD GETS IT RIGHT: it does not decide anything itself. It names a POSITION EPOCH — a value that changes if and only if the
 * position on the board changed — and hands it to `useClearAnnotationsOnMove` (components/useClearAnnotationsOnMove.ts), which clears
 * when `annotationsSurvive(previous, next)` is false. The epoch must therefore:
 *   - change for EVERY move played (including one an engine plays by itself, e.g. 4 Player Chess's eliminated kings' random walks),
 *   - NOT change for any turn advance that plays no move (a seat skipped, eliminated at its turn, resigned, timed out),
 *   - change if the position is REPLACED (Undo, stepping through history, a new game, an Online resync/rollback), because arrows drawn
 *     on the old position would then point at a different one. (That is a deliberate superset of "a move was played".)
 * Classic chess: the FEN (it has no pass or skip, so FEN changes exactly when a move is played or the position is replaced).
 * 4 Player Chess: `state.ply` (incremented only where a move is applied; turns advance without it on several paths).
 * A new mode must pick its epoch the same way and add the matching test (see annotationLifecycle.test.ts) — never key annotations to
 * the turn, the seat to move, or "is it my turn".
 */

/** Any value that changes iff the board position changed (see above). Compared with ===. */
export type PositionEpoch = string | number;

/** Whether annotations survive going from `previous` to `next`: they do exactly when the position did not change. */
export function annotationsSurvive(previous: PositionEpoch, next: PositionEpoch): boolean {
  return previous === next;
}
