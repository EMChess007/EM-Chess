/**
 * Variants that need state which is NOT in the FEN (Duck Chess's duck, Spell Chess's charges, Crazyhouse's reserves) all
 * carry it the same way: one value per ply on the history entry, so Undo, position review and analysis restore it for
 * free. Reading it back is always the same two questions, answered here once instead of re-derived (and re-argued) in
 * every screen:
 *
 *  - what is it NOW — the value on the last ply, or `initial` before any move; and
 *  - what was it in the position currently being DISPLAYED — `viewIndex` null is the live position, 0 the start (before any
 *    ply, so `initial`), k the position after ply k (the value on entry k-1).
 *
 * Crazyhouse uses these directly. Duck Chess and Spell Chess still carry their own copies of this logic inline (see
 * BotGameScreen/LocalGameScreen's displayDuck/displaySpellState); they behave identically and could migrate to this.
 */

/** The state after the last ply, or `initial` when nothing has been played (or no entry carries it). */
export function latestPlyState<E, T>(history: readonly E[], pick: (entry: E) => T | undefined, initial: T): T {
  for (let i = history.length - 1; i >= 0; i--) {
    const value = pick(history[i]);
    if (value !== undefined) return value;
  }
  return initial;
}

/** The state belonging to the position being displayed: live (viewIndex null), the start (0), or after ply `viewIndex`. */
export function plyStateAtView<E, T>(history: readonly E[], viewIndex: number | null, pick: (entry: E) => T | undefined, initial: T): T {
  if (viewIndex === null) return latestPlyState(history, pick, initial);
  if (viewIndex <= 0) return initial;
  return latestPlyState(history.slice(0, viewIndex), pick, initial);
}
