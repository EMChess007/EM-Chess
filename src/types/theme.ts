export interface BoardTheme {
  id: string;
  name: string;
  lightColor: string;
  darkColor: string;
  /** True for a user-added theme (see ThemeSelectScreen) — lets the UI show a "remove"
   * affordance only for these, never for the built-in default. */
  isCustom?: boolean;
}

/** Keyed the same way `Piece.tsx`'s glyph map already is: `${color}${type}`, e.g. 'wp', 'bk'. */
export type PieceImageMap = Record<string, string>;

export interface PieceTheme {
  id: string;
  name: string;
  /** Omitted for the built-in theme, which renders the existing Unicode glyphs instead — see
   * Piece.tsx. Always present (all 12 keys) for a custom theme. */
  images?: PieceImageMap;
  isCustom?: boolean;
}
