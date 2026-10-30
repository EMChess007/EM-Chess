/**
 * The Piece gallery's data (command #27d): what the screen lists and how big a cell is. Pure, so a test can pin it; the screen (src/screens/PieceGalleryScreen.tsx) only draws it.
 */
export const GALLERY_KINDS = ['k', 'q', 'r', 'b', 'n', 'p'] as const;
export const GALLERY_COLORS = ['w', 'b'] as const;
export const GALLERY_SQUARES = ['light', 'dark'] as const;

export type GalleryKind = (typeof GALLERY_KINDS)[number];
export type GalleryColor = (typeof GALLERY_COLORS)[number];
export type GallerySquare = (typeof GALLERY_SQUARES)[number];

export interface GalleryRow {
  color: GalleryColor;
  square: GallerySquare;
  /** "White on light": what the row is called on the screen. */
  label: string;
}

/** The four rows of a theme's grid, in the order they are drawn: each colour on a light square and then on a dark one. */
export const GALLERY_ROWS: readonly GalleryRow[] = GALLERY_COLORS.flatMap((color) =>
  GALLERY_SQUARES.map((square) => ({ color, square, label: `${color === 'w' ? 'White' : 'Black'} on ${square}` }))
);

export const KIND_LETTERS: Record<GalleryKind, string> = { k: 'K', q: 'Q', r: 'R', b: 'B', n: 'N', p: 'P' };
export const KIND_WORDS: Record<GalleryKind, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

/** The twelve pieces of a theme, as the image map keys them (`${color}${kind}`): white first, then black, each king to pawn. */
export const GALLERY_PIECE_KEYS: readonly string[] = GALLERY_COLORS.flatMap((color) => GALLERY_KINDS.map((kind) => `${color}${kind}`));

/** The width of the row-label column and of the screen's side gutters, in dp. */
export const GALLERY_LABEL_WIDTH = 64;
export const GALLERY_GUTTER = 16;
export const GALLERY_MAX_CELL = 56;
export const GALLERY_MIN_CELL = 28;

/** The side of a grid cell: six columns share what is left of the window after the gutters and the label column, never more than 56 and never less than 28 (the grid then scrolls sideways-free: the labels shrink first). */
export function galleryCellSize(windowWidth: number): number {
  const room = windowWidth - 2 * GALLERY_GUTTER - GALLERY_LABEL_WIDTH;
  return Math.max(GALLERY_MIN_CELL, Math.min(GALLERY_MAX_CELL, Math.floor(room / GALLERY_KINDS.length)));
}

/** "Merida: black king on a dark square": the accessibility label of one cell. */
export function galleryCellLabel(themeName: string, color: GalleryColor, kind: GalleryKind, square: GallerySquare): string {
  return `${themeName}: ${color === 'w' ? 'white' : 'black'} ${KIND_WORDS[kind]} on a ${square} square`;
}
