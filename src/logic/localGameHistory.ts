import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GamePayload, StoredGame } from '../api/client';

const STORAGE_KEY = 'localGameHistory:v1';

// Capped so the persisted list never grows unbounded for a long-lived guest install — same
// reasoning as streakStorage's MAX_STORED_DATES, just a generous window for "recent games".
const MAX_STORED_GAMES = 200;

function makeLocalId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Saves a completed game to on-device storage — the guest/offline equivalent of `api.createGame`,
 * used by useSaveGameOnEnd whenever there's no auth token to save to the backend with. Games saved
 * this way are visible only on this device and are never synced to an account.
 */
export async function saveLocalGame(payload: GamePayload): Promise<void> {
  try {
    const games = await listLocalGames();
    const entry: StoredGame = {
      ...payload,
      id: makeLocalId(),
      userId: 'local',
      playedAt: payload.playedAt ?? new Date().toISOString(),
    };
    const next = [entry, ...games].slice(0, MAX_STORED_GAMES);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Non-critical: worst case this one game isn't in local history.
  }
}

/** Most recent first, same ordering the backend's GET /games returns. */
export async function listLocalGames(): Promise<StoredGame[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredGame[]) : [];
  } catch {
    return [];
  }
}
