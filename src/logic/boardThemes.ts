import type { BoardTheme } from '../types/theme';

export const DEFAULT_BOARD_THEME_ID = 'default';

// The built-in entry mirrors today's actual hardcoded Square.tsx colors exactly, so switching to
// this registry-driven approach changes nothing visually until the user adds a custom theme.
export const AVAILABLE_BOARD_THEMES: BoardTheme[] = [
  { id: DEFAULT_BOARD_THEME_ID, name: 'Classic', lightColor: '#f0d9b5', darkColor: '#b58863' },
];

export function getBoardTheme(id: string): BoardTheme {
  return AVAILABLE_BOARD_THEMES.find((theme) => theme.id === id) ?? AVAILABLE_BOARD_THEMES[0];
}

// Same "mutate the shared array in place" pattern as engines.ts's addCustomEngineOption /
// removeCustomEngineOption — every screen reading AVAILABLE_BOARD_THEMES fresh on render picks
// up changes without any shared React state/context.
export function addCustomBoardThemeOption(theme: BoardTheme): void {
  AVAILABLE_BOARD_THEMES.push(theme);
}

export function removeCustomBoardThemeOption(id: string): void {
  const index = AVAILABLE_BOARD_THEMES.findIndex((theme) => theme.id === id);
  if (index !== -1) AVAILABLE_BOARD_THEMES.splice(index, 1);
}
