import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'achievements:unlocked';

// In-memory cache + pub/sub, same pattern as streakStorage.ts/ratingStorage.ts.
let unlocked = new Set<string>();
const listeners = new Set<(unlocked: Set<string>) => void>();

function notify() {
  listeners.forEach((listener) => listener(unlocked));
}

/** Call once at app startup (see App.tsx). */
export async function restoreAchievements(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    unlocked = raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    // Non-critical: worst case achievements start fresh (re-earnable) this session.
  } finally {
    notify();
  }
}

export function getUnlockedAchievements(): Set<string> {
  return unlocked;
}

export function subscribeAchievements(listener: (unlocked: Set<string>) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Unlocks `id` if it isn't already — returns true only the first time (so callers can show a
 * "new achievement" moment), false on every later call for the same id. */
export async function unlockAchievement(id: string): Promise<boolean> {
  if (unlocked.has(id)) return false;
  unlocked = new Set(unlocked).add(id);
  notify();
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...unlocked]));
  } catch {
    // Non-critical: worst case this unlock isn't remembered next launch.
  }
  return true;
}

export function useUnlockedAchievements(): Set<string> {
  const [value, setValue] = useState(getUnlockedAchievements);
  useEffect(() => subscribeAchievements(setValue), []);
  return value;
}
