import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api/client';
import { DEFAULT_RATING, RATING_CATEGORIES, updateRating, type GameResult, type RatingCategory } from './rating';
import { recordRatingHistoryEntry } from './ratingHistoryStorage';

const KEY_PREFIX = 'rating:';

// In-memory cache + pub/sub, same pattern as streakStorage.ts/soundSettings.ts.
let ratings: Record<RatingCategory, number> = {
  bullet: DEFAULT_RATING,
  blitz: DEFAULT_RATING,
  rapid: DEFAULT_RATING,
};
let restored = false;
const listeners = new Set<(ratings: Record<RatingCategory, number>) => void>();

function notify() {
  listeners.forEach((listener) => listener(ratings));
}

/** Call once at app startup (see App.tsx) — loads every category's persisted rating, if any. */
export async function restoreRatings(): Promise<void> {
  try {
    const entries = await AsyncStorage.multiGet(RATING_CATEGORIES.map((c) => KEY_PREFIX + c));
    const next = { ...ratings };
    for (const [key, value] of entries) {
      const category = key.slice(KEY_PREFIX.length) as RatingCategory;
      if (value) next[category] = parseInt(value, 10) || DEFAULT_RATING;
    }
    ratings = next;
  } catch {
    // Non-critical: worst case ratings start fresh at DEFAULT_RATING this session.
  } finally {
    restored = true;
    notify();
  }
}

export function getRatings(): Record<RatingCategory, number> {
  return ratings;
}

export function subscribeRatings(listener: (ratings: Record<RatingCategory, number>) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Applies one game's result to `category`'s rating and persists the new value — locally always,
 * and (when `authToken` is given, i.e. the player is logged in) synced to the backend too, so it
 * can appear on the global leaderboard. The client remains the sole source of truth for the Elo
 * math itself (see rating.ts) — this just mirrors the resulting number. Safe to call before
 * `restoreRatings()` resolves (falls back to DEFAULT_RATING, same as a fresh install) — only
 * relevant if a game somehow finishes within the first instant of app launch. */
export async function recordRatedGame(
  category: RatingCategory,
  opponentRating: number,
  result: GameResult,
  authToken?: string | null
): Promise<number> {
  const next = updateRating(ratings[category], opponentRating, result);
  ratings = { ...ratings, [category]: next };
  notify();
  try {
    await AsyncStorage.setItem(KEY_PREFIX + category, String(next));
  } catch {
    // Non-critical: worst case this update isn't remembered next launch.
  }
  await recordRatingHistoryEntry(category, next);
  if (authToken) {
    api.updateRating(authToken, category, next).catch((err) => {
      console.warn('[ratingStorage] Failed to sync rating to backend:', err instanceof Error ? err.message : err);
    });
  }
  return next;
}

export function useRatings(): Record<RatingCategory, number> {
  const [value, setValue] = useState(getRatings);
  useEffect(() => subscribeRatings(setValue), []);
  return value;
}

/** Whether restoreRatings() has resolved at least once — lets a screen avoid flashing
 * DEFAULT_RATING for a returning player before the real persisted values load in. */
export function ratingsRestored(): boolean {
  return restored;
}
