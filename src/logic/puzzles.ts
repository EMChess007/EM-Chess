import puzzlesData from '../data/puzzles.json';
import type { PuzzleData } from '../types/puzzle';

const PUZZLES = puzzlesData as PuzzleData[];

/** "YYYY-MM-DD" in UTC, so every user gets the same puzzle on the same calendar day
 * regardless of local timezone (matching how Lichess rotates its own daily puzzle). */
export function getDailyPuzzleDateKey(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// A small, fast, well-distributed string hash (djb2-ish) — doesn't need to be
// cryptographically strong, just stable and evenly spread across the puzzle list.
function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return hash >>> 0;
}

/**
 * Deterministically picks "today's" puzzle from the bundled local dataset, seeded by the
 * current UTC date — no network or server needed, and every user sees the same puzzle on the
 * same day, with a different one each day.
 */
export function getDailyPuzzle(date: Date = new Date()): PuzzleData {
  const key = getDailyPuzzleDateKey(date);
  const index = hashString(key) % PUZZLES.length;
  return PUZZLES[index];
}

export function getPuzzleCount(): number {
  return PUZZLES.length;
}

/**
 * Picks a random puzzle from the same bundled dataset the Daily Puzzle uses, for modes (Puzzle
 * Rush) that need a fresh one each time rather than one fixed puzzle per day. Avoids repeating any
 * id in `excludeIds` (the puzzles already seen this run) when the dataset is large enough to make
 * that possible, so a single run doesn't loop back onto a puzzle the player just solved.
 *
 * `themes`, when non-empty, restricts the pool to puzzles tagged with at least one of them (see
 * puzzleThemes.ts) — used by Puzzle Training. Falls back to the full dataset if that filter
 * somehow matches nothing (shouldn't happen for the curated theme list, but a themed run should
 * never simply have no puzzle to show).
 */
export function getRandomPuzzle(
  excludeIds: ReadonlySet<string> = new Set(),
  rng: () => number = Math.random,
  themes?: readonly string[]
): PuzzleData {
  const themed = themes && themes.length > 0 ? PUZZLES.filter((p) => p.themes.some((t) => themes.includes(t))) : PUZZLES;
  const base = themed.length > 0 ? themed : PUZZLES;
  const pool = excludeIds.size < base.length ? base.filter((p) => !excludeIds.has(p.id)) : base;
  return pool[Math.floor(rng() * pool.length)];
}
