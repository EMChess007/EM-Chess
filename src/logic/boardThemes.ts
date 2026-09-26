import type { BoardTheme } from '../types/theme';

export const DEFAULT_BOARD_THEME_ID = 'default';

// The built-in "Classic" entry mirrors today's actual hardcoded Square.tsx colors exactly, so
// switching to this registry-driven approach changed nothing visually on its own. The rest below
// are curated flat two-tone presets (no textures/images — BoardTheme is colors-only) so a player
// gets real variety without having to build a custom theme from scratch first.
export const AVAILABLE_BOARD_THEMES: BoardTheme[] = [
  { id: DEFAULT_BOARD_THEME_ID, name: 'Classic', lightColor: '#f0d9b5', darkColor: '#b58863' },
  { id: 'wood', name: 'Wood', lightColor: '#e8ca9a', darkColor: '#a5682a' },
  { id: 'green', name: 'Green', lightColor: '#eeeed2', darkColor: '#769656' },
  { id: 'ocean', name: 'Ocean', lightColor: '#dee3e6', darkColor: '#4b7399' },
  { id: 'marble', name: 'Marble', lightColor: '#e8e8e8', darkColor: '#8a8a8a' },
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
