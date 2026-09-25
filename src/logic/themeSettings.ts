import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_BOARD_THEME_ID } from './boardThemes';
import { DEFAULT_PIECE_THEME_ID } from './pieceThemes';

const BOARD_KEY = 'settings:activeBoardTheme';
const PIECE_KEY = 'settings:activePieceTheme';

// In-memory cache + pub/sub, same pattern as soundSettings.ts — ChessBoard reads this
// synchronously on every render via a small hook (see themeHooks.ts), and any screen that changes
// it (ThemeSelectScreen) needs every currently-mounted ChessBoard to react immediately.
let activeBoardThemeId = DEFAULT_BOARD_THEME_ID;
let activePieceThemeId = DEFAULT_PIECE_THEME_ID;
const boardListeners = new Set<(id: string) => void>();
const pieceListeners = new Set<(id: string) => void>();

export function getActiveBoardThemeId(): string {
  return activeBoardThemeId;
}

export function getActivePieceThemeId(): string {
  return activePieceThemeId;
}

export function subscribeActiveBoardTheme(listener: (id: string) => void): () => void {
  boardListeners.add(listener);
  return () => {
    boardListeners.delete(listener);
  };
}

export function subscribeActivePieceTheme(listener: (id: string) => void): () => void {
  pieceListeners.add(listener);
  return () => {
    pieceListeners.delete(listener);
  };
}

/** Call once at app startup (see App.tsx) — loads the persisted selection, if any. */
export async function restoreActiveThemes(): Promise<void> {
  try {
    const [board, piece] = await AsyncStorage.multiGet([BOARD_KEY, PIECE_KEY]);
    if (board[1]) {
      activeBoardThemeId = board[1];
      boardListeners.forEach((listener) => listener(activeBoardThemeId));
    }
    if (piece[1]) {
      activePieceThemeId = piece[1];
      pieceListeners.forEach((listener) => listener(activePieceThemeId));
    }
  } catch {
    // Non-critical: keep the defaults.
  }
}

export async function setActiveBoardTheme(id: string): Promise<void> {
  activeBoardThemeId = id;
  boardListeners.forEach((listener) => listener(id));
  try {
    await AsyncStorage.setItem(BOARD_KEY, id);
  } catch {
    // Non-critical: worst case the selection doesn't persist across restarts.
  }
}

export async function setActivePieceTheme(id: string): Promise<void> {
  activePieceThemeId = id;
  pieceListeners.forEach((listener) => listener(id));
  try {
    await AsyncStorage.setItem(PIECE_KEY, id);
  } catch {
    // Non-critical: worst case the selection doesn't persist across restarts.
  }
}
