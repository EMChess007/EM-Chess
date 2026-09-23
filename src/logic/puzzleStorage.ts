import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDailyPuzzleDateKey } from './puzzles';

const STORAGE_KEY_PREFIX = 'dailyPuzzle:solved:';

/**
 * Local-only "have I solved today's puzzle" tracking (AsyncStorage, no account/backend yet).
 * Keyed by date so old entries just become irrelevant rather than needing cleanup, and a solve
 * from a previous day never affects today's status.
 */
export async function isTodayPuzzleSolved(date: Date = new Date()): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(STORAGE_KEY_PREFIX + getDailyPuzzleDateKey(date));
    return value === '1';
  } catch {
    return false;
  }
}

export async function markTodayPuzzleSolved(date: Date = new Date()): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_PREFIX + getDailyPuzzleDateKey(date), '1');
  } catch {
    // Non-critical: worst case the user just gets asked to solve it again.
  }
}
