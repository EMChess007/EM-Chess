import openingsData from '../data/openings.json';

// [eco, name] tuples keyed by EPD (FEN without the halfmove/fullmove counters) — see
// scripts/generate-openings-data.mjs for how this is derived from the Lichess opening book
// (https://github.com/lichess-org/chess-openings, CC0/public domain). Keying by position rather
// than by move-sequence-so-far means a transposition (reaching a named position via a different
// move order) is still recognized, the same way lichess's own opening explorer works against
// this exact dataset.
const OPENINGS_BY_EPD = openingsData as unknown as Record<string, [eco: string, name: string]>;

export interface OpeningMatch {
  eco: string;
  name: string;
}

function toEpd(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

/**
 * Looks up the named opening/variation for a position's FEN, or null if this exact position
 * isn't one of the book's named checkpoints. Not every ply along a known line has its own name
 * (the book only names specific checkpoints), so a null here doesn't mean the game has left the
 * book — callers should keep showing whatever name they last matched rather than clearing it,
 * only actually "leaving the book" once a move is played that can never lead to another named
 * checkpoint again (which this same "no match yet -> keep the last one" behavior already
 * produces for free, since no later position can match once an early one no longer does).
 */
export function lookupOpening(fen: string): OpeningMatch | null {
  const hit = OPENINGS_BY_EPD[toEpd(fen)];
  return hit ? { eco: hit[0], name: hit[1] } : null;
}
