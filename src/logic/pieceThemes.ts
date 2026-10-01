import pieceSets from '../data/pieceSets.json';
import type { PieceImageMap, PieceTheme } from '../types/theme';

export const DEFAULT_PIECE_THEME_ID = 'default';

// Two curated, ready-to-use piece sets sourced from Lichess's open-source `lila` repository
// (public/piece/cburnett and public/piece/merida), both GPLv2-or-later:
//   - cburnett: Colin M. L. Burnett — https://en.wikipedia.org/wiki/User:Cburnett (Lichess's own
//     default set, also the one used on Wikipedia's chess articles).
//   - merida: Armando Hernandez Marroquin.
//   - checkers: this app's own set — the "Chess with Checkers" look (see PlayModeSelectScreen's
//     original ask). Purely cosmetic, same as the two above: every square of the board still
//     plays 100% ordinary chess underneath, this just swaps how pieces are drawn. Generated
//     programmatically (Canvas 2D: a checkers-style disk per color + the piece's own Unicode
//     glyph on top), not sourced from an external set — deliberately a normal theme entry rather
//     than a separate "mode", since (unlike King of the Hill/Three-Check/Setup Chess) it changes
//     no shared game state at all, so it doesn't need per-game selection, matchmaking
//     partitioning, or any of this app's variant plumbing — picking it in Theme Select is enough
//     to apply it everywhere, in every mode, exactly like Cburnett/Merida already do.
// src/data/pieceSets.json holds each set's 12 piece images pre-rasterized to PNG and base64-
// encoded (rasterized once from the original SVGs — see PieceImageMap's data-URI contract, which
// Piece.tsx feeds straight into an <Image>; RN's Image doesn't reliably rasterize SVG data URIs
// itself, which is also why the custom-upload flow below only accepts PNG/WebP).
const pieceSetImages = pieceSets as Record<string, PieceImageMap>;

// No `images` — the built-in entry means "render Piece.tsx's existing Unicode glyphs", exactly
// what happens today, so switching to this registry-driven approach changes nothing visually
// until the user adds a custom theme.
export const AVAILABLE_PIECE_THEMES: PieceTheme[] = [
  { id: DEFAULT_PIECE_THEME_ID, name: 'Classic' },
  { id: 'cburnett', name: 'Cburnett', images: pieceSetImages.cburnett },
  { id: 'merida', name: 'Merida', images: pieceSetImages.merida },
  { id: 'checkers', name: 'Chess with Checkers', images: pieceSetImages.checkers },
];

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
