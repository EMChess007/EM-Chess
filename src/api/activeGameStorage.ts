import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { activeGameRoomId, isResumable, parseActiveGame, serializeActiveGame, type ActiveOnlineGame } from '../logic/activeGame';
import { logDiagnostic } from '../logic/diagnosticLog';

// Persists the online game the player is in (see logic/activeGame.ts for what and why). Same storage pattern as authStorage.ts:
//  - the record holds the rejoin token, a bearer secret for a seat, so on native it lives in expo-secure-store (Keychain / Keystore);
//    web has no secure enclave and keeps it in AsyncStorage (localStorage), exactly like the auth session;
//  - no ':' (or anything outside [A-Za-z0-9._-]) in a key - SecureStore on Android throws on it (the root cause of an earlier auto-logout bug);
//  - the "last seen" heartbeat is a separate, secret-free number in AsyncStorage, so refreshing it every few seconds never rewrites the secret.
// NOTHING here logs the record or the token: log lines carry the room id and the outcome only.
const GAME_KEY = 'active_online_game';
const SEEN_KEY = 'active_online_game_seen';

/** The record this process is saving / heartbeating for - lets a heartbeat for a game that was already cleared be a no-op. */
let currentRoomId: string | null = null;

async function setGame(raw: string): Promise<void> {
  if (Platform.OS === 'web') await AsyncStorage.setItem(GAME_KEY, raw);
  else await SecureStore.setItemAsync(GAME_KEY, raw);
}
async function getGame(): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(GAME_KEY);
  return SecureStore.getItemAsync(GAME_KEY);
}
async function removeGame(): Promise<void> {
  if (Platform.OS === 'web') await AsyncStorage.removeItem(GAME_KEY);
  else await SecureStore.deleteItemAsync(GAME_KEY);
}

/** Remembers `game` (replacing any earlier one) and stamps it as just seen. Never throws. */
export async function saveActiveGame(game: ActiveOnlineGame, now: number = Date.now()): Promise<void> {
  try {
    currentRoomId = activeGameRoomId(game);
    await setGame(serializeActiveGame(game));
    await AsyncStorage.setItem(SEEN_KEY, String(now));
    logDiagnostic(`[activeGame] Saved ${game.kind} game (room ${currentRoomId}).`);
  } catch (err) {
    logDiagnostic(`[activeGame] Failed to save: ${err instanceof Error ? err.message : err}`);
  }
}

/** The heartbeat: the app is still in this game. A no-op unless it is the game this process saved (so a cleared game is never "revived"). */
export async function touchActiveGame(roomId: string, now: number = Date.now()): Promise<void> {
  if (currentRoomId !== roomId) return;
  try {
    await AsyncStorage.setItem(SEEN_KEY, String(now));
  } catch {
    // Non-critical: a missed heartbeat only shortens the window a restart can still resume.
  }
}

/** The game to walk back into for `userId`, or null (nothing saved, someone else's, too old, unreadable). Never throws. */
export async function loadResumableGame(userId: string | null, now: number = Date.now()): Promise<ActiveOnlineGame | null> {
  try {
    const game = parseActiveGame(await getGame());
    const seenRaw = await AsyncStorage.getItem(SEEN_KEY);
    const seenAt = seenRaw === null ? null : Number(seenRaw);
    if (isResumable(game, seenAt, userId, now)) {
      currentRoomId = activeGameRoomId(game);
      return game;
    }
    if (game) await clearActiveGame(); // stale or another account's: drop it rather than keep a dead secret around
    return null;
  } catch (err) {
    logDiagnostic(`[activeGame] Failed to load: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/** Forgets the saved game (game over, resign, leave, expiry, logout). Never throws. */
export async function clearActiveGame(): Promise<void> {
  const roomId = currentRoomId;
  currentRoomId = null;
  try {
    await removeGame();
    await AsyncStorage.removeItem(SEEN_KEY);
    if (roomId) logDiagnostic(`[activeGame] Cleared (room ${roomId}).`);
  } catch (err) {
    logDiagnostic(`[activeGame] Failed to clear: ${err instanceof Error ? err.message : err}`);
  }
}
