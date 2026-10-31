/**
 * The built-in chess pieces as DATA: six original silhouettes in a 100 x 100 box and the ink of each colour. Drawn by PieceIcon (react-native-svg) on every board.
 *
 * WHY NOT A FONT GLYPH (command #27b, found on a real phone: the black king was drawn white). The pieces used to be Unicode chess glyphs: a white piece was the OUTLINE glyph (U+2654..2659)
 * and a black piece the SOLID one (U+265A..265F), both in the default text colour. The bundled Inter has no chess glyphs at all, so every one of them came from whatever font the phone
 * falls back to - a different font per glyph (an emoji font draws U+265F in its own fixed colour), with its own idea of what "black" looks like. The colour of a piece depended on the
 * phone. A vector piece has exactly the fill and the outline written below, on every phone, on both square colours.
 */
export type PieceShapeType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export const PIECE_SHAPE_TYPES: readonly PieceShapeType[] = ['k', 'q', 'r', 'b', 'n', 'p'];

/** Each piece is one or more paths (a pawn is a head and a body), all filled and outlined with the same ink. */
export const PIECE_PATHS: Readonly<Record<PieceShapeType, readonly string[]>> = {
  p: ['M50 14 a13 13 0 1 1 -0.01 0 Z', 'M38 48 L62 48 C60 56 58 60 62 66 C70 70 72 78 72 86 L28 86 C28 78 30 70 38 66 C42 60 40 56 38 48 Z'],
  n: ['M26 86 C26 70 32 58 42 50 C36 48 30 50 26 54 C22 50 22 44 26 38 L40 16 L42 26 C48 18 56 18 62 24 C74 34 78 56 76 86 Z'],
  b: ['M50 10 a5 5 0 1 1 -0.01 0 Z', 'M50 20 C64 30 68 44 58 56 C62 60 62 64 58 68 L70 76 L70 86 L30 86 L30 76 L42 68 C38 64 38 60 42 56 C32 44 36 30 50 20 Z'],
  r: ['M26 86 L26 76 L32 70 L32 40 L26 34 L26 18 L38 18 L38 26 L45 26 L45 18 L55 18 L55 26 L62 26 L62 18 L74 18 L74 34 L68 40 L68 70 L74 76 L74 86 Z'],
  q: ['M24 86 L18 34 L36 52 L50 22 L64 52 L82 34 L76 86 Z', 'M18 30 a6 6 0 1 1 -0.01 0 Z', 'M50 16 a6 6 0 1 1 -0.01 0 Z', 'M82 30 a6 6 0 1 1 -0.01 0 Z'],
  k: ['M46 8 L54 8 L54 16 L62 16 L62 24 L54 24 L54 32 C70 38 78 52 74 70 L78 86 L22 86 L26 70 C22 52 30 38 46 32 L46 24 L38 24 L38 16 L46 16 Z'],
};

export interface PieceInk {
  fill: string;
  outline: string;
}

/** A white piece is light with a dark outline, a black piece dark with a light outline: both read on a light and on a dark square. */
export const WHITE_PIECE_INK: PieceInk = { fill: '#fafafa', outline: '#1b1b1b' };
export const BLACK_PIECE_INK: PieceInk = { fill: '#1d1d1d', outline: '#f1f1f1' };

export function pieceInk(color: 'w' | 'b'): PieceInk {
  return color === 'w' ? WHITE_PIECE_INK : BLACK_PIECE_INK;
}

/** Stroke width in the 100-unit box. */
export const PIECE_OUTLINE_WIDTH = 4;

/**
 * EVERY paint property of a piece's path, written out (command #27d: a phone drew black Classic pieces with a light fill on the dark squares only). Nothing is left to a default or to inheritance
 * (`currentColor`, a parent's `color`, an unset opacity or fill rule): the props are a function of the piece's COLOUR alone - the square the piece stands on is not an input, and no module that
 * draws a piece imports a square colour (pieceIcon.test.ts pins both).
 */
export interface PiecePathPaint {
  fill: string;
  fillOpacity: 1;
  fillRule: 'nonzero';
  stroke: string;
  strokeOpacity: 1;
  strokeWidth: number;
  strokeLinejoin: 'round';
  strokeLinecap: 'round';
}

export function piecePathPaint(ink: PieceInk): PiecePathPaint {
  return {
    fill: ink.fill,
    fillOpacity: 1,
    fillRule: 'nonzero',
    stroke: ink.outline,
    strokeOpacity: 1,
    strokeWidth: PIECE_OUTLINE_WIDTH,
    strokeLinejoin: 'round',
    strokeLinecap: 'round',
  };
}
