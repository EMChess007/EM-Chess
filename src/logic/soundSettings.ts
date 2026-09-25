import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'settings:soundEnabled';

// In-memory cache so playMoveSound (moveSounds.ts) can check this synchronously on every move
// without an AsyncStorage round-trip — same pub-sub pattern as AppAlert, so the Settings toggle
// (MoreScreen) re-renders immediately when this changes from anywhere.
let soundEnabled = true;
const listeners = new Set<(enabled: boolean) => void>();

export function isSoundEnabled(): boolean {
  return soundEnabled;
}

export function subscribeSoundEnabled(listener: (enabled: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Call once at app startup (see App.tsx) — loads the persisted preference, if any; the default
 * (sound on) is kept as-is when nothing has been saved yet. */
export async function restoreSoundSetting(): Promise<void> {
  try {
    const value = await AsyncStorage.getItem(STORAGE_KEY);
    if (value !== null) {
      soundEnabled = value === '1';
      listeners.forEach((listener) => listener(soundEnabled));
    }
  } catch {
    // Non-critical: keep the default (sound on).
  }
}

export async function setSoundEnabled(enabled: boolean): Promise<void> {
  soundEnabled = enabled;
  listeners.forEach((listener) => listener(enabled));
  try {
    await AsyncStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Non-critical: worst case the preference doesn't persist across restarts.
  }
}
