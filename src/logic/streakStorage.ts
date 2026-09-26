import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STREAK_KEY = 'streak:currentStreak';
const LAST_OPEN_KEY = 'streak:lastOpenDate';
const ACTIVE_DATES_KEY = 'streak:activeDates';

// Capped so the persisted list never grows unbounded — a rolling few weeks is plenty for the
// weekly view (StreakScreen only ever looks at the current calendar week, 7 entries).
const MAX_STORED_DATES = 30;

// In-memory cache + pub/sub, same pattern as themeSettings.ts/colorSchemeSettings.ts.
let currentStreak = 0;
let activeDates: string[] = []; // 'YYYY-MM-DD', ascending, capped to MAX_STORED_DATES
const listeners = new Set<(streak: number) => void>();

/** Local-calendar-day key (not UTC) — a login streak is a personal daily habit tied to the
 * user's own day/night cycle, unlike the Daily Puzzle's deliberately UTC-anchored "same puzzle
 * for everyone" key (see getDailyPuzzleDateKey in logic/puzzles.ts). */
function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysBetween(aKey: string, bKey: string): number {
  const a = new Date(`${aKey}T00:00:00`);
  const b = new Date(`${bKey}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function getCurrentStreak(): number {
  return currentStreak;
}

/** The dates (see dateKey) the app has been opened on, most recent last. */
export function getActiveDates(): string[] {
  return activeDates;
}

export function subscribeStreak(listener: (streak: number) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Call once at app startup (see App.tsx) — loads the persisted streak, then records today as an
 * active day if it isn't already: continues the streak if the last recorded day was yesterday,
 * resets it to 1 if there was a gap (or this is the very first launch ever), and leaves
 * everything alone if today was already recorded (e.g. a second launch the same day).
 */
export async function recordAppOpen(date: Date = new Date()): Promise<void> {
  try {
    const [storedStreak, storedLastOpen, storedDates] = await AsyncStorage.multiGet([
      STREAK_KEY,
      LAST_OPEN_KEY,
      ACTIVE_DATES_KEY,
    ]);
    currentStreak = storedStreak[1] ? parseInt(storedStreak[1], 10) || 0 : 0;
    activeDates = storedDates[1] ? (JSON.parse(storedDates[1]) as string[]) : [];

    const today = dateKey(date);
    if (storedLastOpen[1] === today) {
      listeners.forEach((listener) => listener(currentStreak));
      return;
    }

    const gap = storedLastOpen[1] ? daysBetween(storedLastOpen[1], today) : null;
    currentStreak = gap === 1 ? currentStreak + 1 : 1;
    activeDates = [...activeDates, today].slice(-MAX_STORED_DATES);

    await AsyncStorage.multiSet([
      [STREAK_KEY, String(currentStreak)],
      [LAST_OPEN_KEY, today],
      [ACTIVE_DATES_KEY, JSON.stringify(activeDates)],
    ]);
    listeners.forEach((listener) => listener(currentStreak));
  } catch {
    // Non-critical: worst case the streak doesn't update this session.
  }
}

export function useStreak(): number {
  const [streak, setStreak] = useState(getCurrentStreak);
  useEffect(() => subscribeStreak(setStreak), []);
  return streak;
}
