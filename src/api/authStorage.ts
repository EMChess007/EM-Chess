import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { AuthResponse, AuthUser } from '../types/auth';

// A single combined key/blob, not two separate ones — see saveAuthSession/loadAuthSession below
// for why: storing the token and the user object as two independent reads/writes meant either one
// could succeed while the other failed (a transient SecureStore/AsyncStorage hiccup, or the app
// being killed between the two), silently corrupting the session so the user got logged out on
// next launch with no error ever surfaced. One atomic value removes that failure mode entirely.
const SESSION_KEY = 'auth:session';

export interface AuthSession {
  token: string;
  user: AuthUser;
}

// The JWT is the actual bearer credential — anyone who reads it can act as this user against the
// backend. On native platforms it's kept in the OS-level secure enclave (iOS Keychain / Android
// Keystore) via expo-secure-store instead of AsyncStorage's plain on-disk file, so a compromised
// device, a device backup, or an unrelated local-file-read bug elsewhere in the app can't just
// read it out. expo-secure-store has no web implementation, so web (which has no equivalent
// secure enclave anyway — the same trust model as any other browser-based app) keeps using
// AsyncStorage there, same as before. The user profile (id/email/username/createdAt) is stored
// alongside the token in the same entry — see the SESSION_KEY comment above.
async function setSession(raw: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(SESSION_KEY, raw);
  } else {
    await SecureStore.setItemAsync(SESSION_KEY, raw);
  }
}

async function getSession(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(SESSION_KEY);
  }
  return SecureStore.getItemAsync(SESSION_KEY);
}

async function removeSession(): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(SESSION_KEY);
  } else {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  }
}

export async function saveAuthSession(session: AuthResponse): Promise<void> {
  try {
    await setSession(JSON.stringify({ token: session.token, user: session.user }));
  } catch (err) {
    // Not silently swallowed anymore (see SESSION_KEY comment) — a failure here means the user
    // will be asked to log in again next launch, which is worth being able to actually diagnose.
    console.warn('[authStorage] Failed to save session:', err instanceof Error ? err.message : err);
  }
}

export async function loadAuthSession(): Promise<AuthSession | null> {
  try {
    const raw = await getSession();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed.token || !parsed.user) return null;
    return parsed;
  } catch (err) {
    console.warn('[authStorage] Failed to load session:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function clearAuthSession(): Promise<void> {
  try {
    await removeSession();
  } catch (err) {
    console.warn('[authStorage] Failed to clear session:', err instanceof Error ? err.message : err);
  }
}
