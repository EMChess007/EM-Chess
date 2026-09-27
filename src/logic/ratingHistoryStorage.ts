import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RATING_CATEGORIES, type RatingCategory } from './rating';

export interface RatingHistoryEntry {
  rating: number;
  timestamp: number;
}

const KEY_PREFIX = 'ratingHistory:';
// Bounds each category's persisted history — plenty for a "rating over time" graph on a casual
// internal rating (see rating.ts); old entries roll off the front rather than growing forever.
const MAX_ENTRIES = 200;

// In-memory cache + pub/sub, same pattern as ratingStorage.ts itself.
let history: Record<RatingCategory, RatingHistoryEntry[]> = { bullet: [], blitz: [], rapid: [] };
let restored = false;
const listeners = new Set<(history: Record<RatingCategory, RatingHistoryEntry[]>) => void>();

function notify() {
  listeners.forEach((listener) => listener(history));
}

/** Call once at app startup (see App.tsx), alongside restoreRatings(). */
export async function restoreRatingHistory(): Promise<void> {
  try {
    const entries = await AsyncStorage.multiGet(RATING_CATEGORIES.map((c) => KEY_PREFIX + c));
    const next = { ...history };
    for (const [key, value] of entries) {
      const category = key.slice(KEY_PREFIX.length) as RatingCategory;
      if (!value) continue;
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) next[category] = parsed;
      } catch {
        // Corrupt entry — ignore, this category just starts empty this session.
      }
    }
    history = next;
  } catch {
    // Non-critical: worst case history starts empty this session.
  } finally {
    restored = true;
    notify();
  }
}

export function getRatingHistory(category: RatingCategory): RatingHistoryEntry[] {
  return history[category];
}

export function subscribeRatingHistory(
  listener: (history: Record<RatingCategory, RatingHistoryEntry[]>) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Appends one {rating, timestamp} entry for `category` and persists it — called from
 * ratingStorage.ts's recordRatedGame every time a rated game changes the player's rating, so the
 * two stay in lockstep. Local-only, unlike the rating value itself: there's no backend table for
 * rating history (only the current value is a column on the User model), so each device's graph
 * only reflects games actually played on it — same as how a guest (no account at all) already
 * only ever sees this device's own data. */
export async function recordRatingHistoryEntry(category: RatingCategory, rating: number): Promise<void> {
  const next = [...history[category], { rating, timestamp: Date.now() }].slice(-MAX_ENTRIES);
  history = { ...history, [category]: next };
  notify();
  try {
    await AsyncStorage.setItem(KEY_PREFIX + category, JSON.stringify(next));
  } catch {
    // Non-critical: worst case this data point isn't remembered next launch.
  }
}

export function useRatingHistory(category: RatingCategory): RatingHistoryEntry[] {
  const [value, setValue] = useState(() => getRatingHistory(category));
  useEffect(() => {
    // useState's lazy initializer above only ever runs on the very first mount — when `category`
    // changes later (switching tabs), nothing else re-reads the new category's data, since
    // subscribeRatingHistory only calls its listener on a FUTURE notify(), never immediately with
    // what's current. Without this, every tab kept showing whichever category's data happened to
    // be loaded first, even though the tab highlight itself updated correctly.
    setValue(getRatingHistory(category));
    return subscribeRatingHistory((all) => setValue(all[category]));
  }, [category]);
  return value;
}

/** Whether restoreRatingHistory() has resolved at least once. */
export function ratingHistoryRestored(): boolean {
  return restored;
}
