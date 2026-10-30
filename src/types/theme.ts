export interface BoardTheme {
  id: string;
  name: string;
  lightColor: string;
  darkColor: string;
  /** True for a user-added theme (see ThemeSelectScreen) — lets the UI show a "remove"
   * affordance only for these, never for the built-in default. */
  isCustom?: boolean;
}

/**
 * One piece image: a bundled asset (a built-in theme, `import x from '...png'`: an asset id on a phone, `{ uri, width, height }` in the Expo web build) or a file URI (a custom theme's file in the app's own folder, `file://...`).
 * Never a `data:` URI (command #27d: a phone showed two Merida pieces wrong while every data URI was right in a browser).
 */
export type PieceImageSource = string | number | { uri: string; width?: number; height?: number };

/** Keyed the same way `Piece.tsx`'s glyph map already is: `${color}${type}`, e.g. 'wp', 'bk'. */
export type PieceImageMap = Record<string, PieceImageSource>;

export interface PieceTheme {
  id: string;
  name: string;
  /** Omitted for the built-in theme, which renders the existing Unicode glyphs instead — see
   * Piece.tsx. Always present (all 12 keys) for a custom theme. */
  images?: PieceImageMap;
  isCustom?: boolean;
}
