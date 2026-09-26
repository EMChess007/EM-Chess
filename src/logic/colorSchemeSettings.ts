import AsyncStorage from '@react-native-async-storage/async-storage';

export type ColorSchemeMode = 'light' | 'dark';

const MODE_KEY = 'settings:colorSchemeMode';
const DEFAULT_MODE: ColorSchemeMode = 'light';

// In-memory cache + pub/sub, same pattern as themeSettings.ts/soundSettings.ts — every screen
// reads this synchronously on every render via useAppColors() (see colorSchemeHooks.ts), and
// MoreScreen's Dark/Light toggle needs every currently-mounted screen to re-render immediately.
let activeMode: ColorSchemeMode = DEFAULT_MODE;
const listeners = new Set<(mode: ColorSchemeMode) => void>();

export function getColorSchemeMode(): ColorSchemeMode {
  return activeMode;
}

export function subscribeColorSchemeMode(listener: (mode: ColorSchemeMode) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Call once at app startup (see App.tsx) — loads the persisted selection, if any. */
export async function restoreColorSchemeMode(): Promise<void> {
  try {
    const value = await AsyncStorage.getItem(MODE_KEY);
    if (value === 'light' || value === 'dark') {
      activeMode = value;
      listeners.forEach((listener) => listener(activeMode));
    }
  } catch {
    // Non-critical: keep the default.
  }
}

export async function setColorSchemeMode(mode: ColorSchemeMode): Promise<void> {
  activeMode = mode;
  listeners.forEach((listener) => listener(mode));
  try {
    await AsyncStorage.setItem(MODE_KEY, mode);
  } catch {
    // Non-critical: worst case the selection doesn't persist across restarts.
  }
}
