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
