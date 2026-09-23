import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthResponse, AuthUser } from '../types/auth';

const TOKEN_KEY = 'auth:token';
const USER_KEY = 'auth:user';

export interface AuthSession {
  token: string;
  user: AuthUser;
}

export async function saveAuthSession(session: AuthResponse): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [TOKEN_KEY, session.token],
      [USER_KEY, JSON.stringify(session.user)],
    ]);
  } catch {
    // Non-critical: worst case the user just has to log in again next time.
  }
}

export async function loadAuthSession(): Promise<AuthSession | null> {
  try {
    const entries = await AsyncStorage.multiGet([TOKEN_KEY, USER_KEY]);
    const token = entries[0][1];
    const userJson = entries[1][1];
    if (!token || !userJson) return null;
    return { token, user: JSON.parse(userJson) as AuthUser };
  } catch {
    return null;
  }
}

export async function clearAuthSession(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
  } catch {
    // Non-critical.
  }
}
