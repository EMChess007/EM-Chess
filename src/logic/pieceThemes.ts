import type { PieceTheme } from '../types/theme';

export const DEFAULT_PIECE_THEME_ID = 'default';

// No `images` — the built-in entry means "render Piece.tsx's existing Unicode glyphs", exactly
// what happens today, so switching to this registry-driven approach changes nothing visually
// until the user adds a custom theme.
export const AVAILABLE_PIECE_THEMES: PieceTheme[] = [{ id: DEFAULT_PIECE_THEME_ID, name: 'Classic' }];

export function getPieceTheme(id: string): PieceTheme {
  return AVAILABLE_PIECE_THEMES.find((theme) => theme.id === id) ?? AVAILABLE_PIECE_THEMES[0];
}

export function addCustomPieceThemeOption(theme: PieceTheme): void {
  AVAILABLE_PIECE_THEMES.push(theme);
}

export function removeCustomPieceThemeOption(id: string): void {
  const index = AVAILABLE_PIECE_THEMES.findIndex((theme) => theme.id === id);
  if (index !== -1) AVAILABLE_PIECE_THEMES.splice(index, 1);
}
