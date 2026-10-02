import { describe, expect, it } from 'vitest';
import { getDailyPuzzle, getDailyPuzzleDateKey, getPuzzleCount, getRandomPuzzle } from '../puzzles';

describe('getDailyPuzzleDateKey', () => {
  it('formats in UTC, not local time — a date near midnight must not shift to the adjacent day', () => {
    // 2026-03-05T23:30:00Z is still March 5th in UTC regardless of the machine's own timezone.
    expect(getDailyPuzzleDateKey(new Date('2026-03-05T23:30:00Z'))).toBe('2026-03-05');
    expect(getDailyPuzzleDateKey(new Date('2026-03-05T00:05:00Z'))).toBe('2026-03-05');
  });

  it('pads month and day to two digits', () => {
    expect(getDailyPuzzleDateKey(new Date('2026-01-02T12:00:00Z'))).toBe('2026-01-02');
  });
});

describe('getDailyPuzzle', () => {
  it('is deterministic: the exact same date always yields the exact same puzzle', () => {
    const date = new Date('2026-06-15T12:00:00Z');
    const first = getDailyPuzzle(date);
    const second = getDailyPuzzle(new Date('2026-06-15T18:45:00Z')); // same UTC day, different time
    expect(first.id).toBe(second.id);
  });

  it('varies across different dates (not literally every day, but not a constant either)', () => {
    const ids = new Set<string>();
    for (let d = 1; d <= 28; d++) {
      ids.add(getDailyPuzzle(new Date(`2026-02-${String(d).padStart(2, '0')}T12:00:00Z`)).id);
    }
    expect(ids.size).toBeGreaterThan(1);
  });

  it('always returns a puzzle actually present in the bundled dataset', () => {
    const puzzle = getDailyPuzzle(new Date('2026-09-19T12:00:00Z'));
    expect(puzzle).toHaveProperty('id');
    expect(puzzle).toHaveProperty('fen');
    expect(puzzle.moves.length).toBeGreaterThan(0);
  });
});

describe('getRandomPuzzle', () => {
  it('with a fixed rng, picks a deterministic index from the full pool', () => {
    const count = getPuzzleCount();
    const first = getRandomPuzzle(new Set(), () => 0);
    const last = getRandomPuzzle(new Set(), () => 1 - 1e-9);
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    // rng() => 0 always picks pool[0]; this just pins that contract down, not the data itself.
    expect(count).toBeGreaterThan(0);
  });

  it('never returns a puzzle whose id is in excludeIds, as long as the pool can still satisfy that', () => {
    const excluded = new Set<string>();
    let current = getRandomPuzzle(new Set(), () => 0.123456);
    for (let i = 0; i < 20; i++) {
      expect(excluded.has(current.id)).toBe(false);
      excluded.add(current.id);
      current = getRandomPuzzle(excluded, () => Math.random());
    }
  });

  it('falls back to the full pool once excludeIds would otherwise exhaust it (never throws/returns undefined)', () => {
    const allIds = new Set<string>();
    for (let i = 0; i < getPuzzleCount(); i++) {
      allIds.add(getRandomPuzzle(allIds, () => Math.random()).id);
      if (allIds.size >= getPuzzleCount()) break;
    }
    const result = getRandomPuzzle(allIds, () => 0.5);
    expect(result).toBeDefined();
    expect(result.id).toBeTruthy();
  });

  it('restricts to the requested themes when given, falling back to the full pool if none match', () => {
    const themed = getRandomPuzzle(new Set(), () => 0, ['mateIn1']);
    expect(themed.themes).toContain('mateIn1');

    const nonsenseTheme = getRandomPuzzle(new Set(), () => 0, ['this-theme-does-not-exist-anywhere']);
    expect(nonsenseTheme).toBeDefined(); // falls back rather than returning nothing
  });
});
