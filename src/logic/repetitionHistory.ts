import type { GameHistoryEntry } from '../types/history';
import { initialCrazyhouseState } from './crazyhouse';
import { isThreefoldRepetition, repetitionKey, type RepetitionExtra } from './repetition';
import { initialSpellChessState } from './spellChess';

/** Which hidden state a mode adds to a position (see repetition.ts). Every flag is false for the plain modes. */
export interface RepetitionVariant {
  threeCheck?: boolean;
  crazyhouse?: boolean;
  duckChess?: boolean;
  spellChess?: boolean;
}

/**
 * The repetition keys of a game so far - the initial position first, then one per ply - for the local screens (Local, Bot, Engine vs
 * Engine), built from the `history` the screen already keeps. Deriving them (instead of tracking a counter) makes the answer right
 * after Undo, after position review and after any FEN rebuild by construction. The server keeps the same list in the room
 * (backend rooms.ts), built with the same repetitionKey / RepetitionExtra, so both ends agree (backend/scripts/test-repetition.mjs).
 *
 * Fog of War uses the TRUE position (the screens hold the whole board; the server its own engine) - see TESTING.md.
 */
export function historyRepetitionKeys(initialFen: string, history: readonly GameHistoryEntry[], variant: RepetitionVariant = {}): string[] {
  const checks = { w: 0, b: 0 };
  const extraFor = (entry?: GameHistoryEntry): RepetitionExtra | undefined => {
    if (!variant.threeCheck && !variant.crazyhouse && !variant.duckChess && !variant.spellChess) return undefined;
    return {
      ...(variant.threeCheck ? { checks: { ...checks } } : {}),
      ...(variant.crazyhouse ? { crazyhouse: entry ? entry.crazyhouse : initialCrazyhouseState() } : {}),
      ...(variant.duckChess ? { duck: entry ? (entry.duckSquare ?? null) : null } : {}),
      ...(variant.spellChess ? { spell: entry ? entry.spellState : initialSpellChessState() } : {}),
    };
  };
  const keys = [repetitionKey(initialFen, extraFor())];
  history.forEach((entry, i) => {
    // Three-Check: chess.js marks a checking move with '+' (or '#'); even plies are White's.
    if (variant.threeCheck && /[+#]$/.test(entry.move.san)) checks[i % 2 === 0 ? 'w' : 'b'] += 1;
    keys.push(repetitionKey(entry.fenAfter, extraFor(entry)));
  });
  return keys;
}

/** Whether the position the game is in now has occurred three times (an automatic draw, in every two-player mode). */
export function isRepetitionDraw(initialFen: string, history: readonly GameHistoryEntry[], variant: RepetitionVariant = {}): boolean {
  if (history.length < 8) return false; // the earliest a position can occur three times is ply 8
  return isThreefoldRepetition(historyRepetitionKeys(initialFen, history, variant));
}
