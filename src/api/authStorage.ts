import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { AuthResponse, AuthUser } from '../types/auth';

const TOKEN_KEY = 'auth:token';
const USER_KEY = 'auth:user';

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
// AsyncStorage there, same as before. The user profile (id/email/username/createdAt) is far less
// sensitive than the token itself, so it stays in plain AsyncStorage on every platform.
async function setToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } else {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  }
}

async function getToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(TOKEN_KEY);
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

async function removeToken(): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(TOKEN_KEY);
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

export async function saveAuthSession(session: AuthResponse): Promise<void> {
  try {
    await Promise.all([setToken(session.token), AsyncStorage.setItem(USER_KEY, JSON.stringify(session.user))]);
  } catch {
    // Non-critical: worst case the user just has to log in again next time.
  }
}

export async function loadAuthSession(): Promise<AuthSession | null> {
  try {
    const [token, userJson] = await Promise.all([getToken(), AsyncStorage.getItem(USER_KEY)]);
    if (!token || !userJson) return null;
    return { token, user: JSON.parse(userJson) as AuthUser };
  } catch {
    return null;
  }
}

export async function clearAuthSession(): Promise<void> {
  try {
    await Promise.all([removeToken(), AsyncStorage.removeItem(USER_KEY)]);
  } catch {
    // Non-critical.
  }
}
