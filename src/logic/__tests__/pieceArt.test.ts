import { describe, expect, it } from 'vitest';
import { BLACK_PIECE_INK, PIECE_OUTLINE_WIDTH, PIECE_PATHS, PIECE_SHAPE_TYPES, pieceInk, WHITE_PIECE_INK } from '../../components/pieceArt';

/**
 * The built-in pieces as data (command #27b). The ink of each colour is written here as literals: a white piece is light with a dark outline, a black piece dark with a light outline. The
 * rendered colour of all twelve kinds is read from the screen in pieceColours.dom.test.tsx, and from the PIXELS in the device matrix (android-matrix-pieces.mjs).
 */
describe('the ink of the two colours', () => {
  it('white: fill #fafafa, outline #1b1b1b', () => {
    expect(pieceInk('w')).toEqual({ fill: '#fafafa', outline: '#1b1b1b' });
    expect(WHITE_PIECE_INK).toEqual({ fill: '#fafafa', outline: '#1b1b1b' });
  });

  it('black: fill #1d1d1d, outline #f1f1f1', () => {
    expect(pieceInk('b')).toEqual({ fill: '#1d1d1d', outline: '#f1f1f1' });
    expect(BLACK_PIECE_INK).toEqual({ fill: '#1d1d1d', outline: '#f1f1f1' });
  });

  it('the two inks are as far apart as a fill can be: the black fill is dark, the white fill is light', () => {
    const luminance = (hex: string) => (parseInt(hex.slice(1, 3), 16) * 299 + parseInt(hex.slice(3, 5), 16) * 587 + parseInt(hex.slice(5, 7), 16) * 114) / 1000;
    expect(luminance(pieceInk('w').fill)).toBeGreaterThan(240);
    expect(luminance(pieceInk('b').fill)).toBeLessThan(40);
    expect(luminance(pieceInk('w').outline)).toBeLessThan(40);
    expect(luminance(pieceInk('b').outline)).toBeGreaterThan(230);
  });
});

describe('the six silhouettes', () => {
  it('king, queen, rook, bishop, knight, pawn, with 1, 4, 1, 2, 1 and 2 paths', () => {
    expect([...PIECE_SHAPE_TYPES]).toEqual(['k', 'q', 'r', 'b', 'n', 'p']);
    expect(PIECE_PATHS.k).toHaveLength(1);
    expect(PIECE_PATHS.q).toHaveLength(4);
    expect(PIECE_PATHS.r).toHaveLength(1);
    expect(PIECE_PATHS.b).toHaveLength(2);
    expect(PIECE_PATHS.n).toHaveLength(1);
    expect(PIECE_PATHS.p).toHaveLength(2);
  });

  it('every path is a closed outline in the 100 x 100 box, and no two kinds share a shape', () => {
    const seen = new Set<string>();
    for (const type of PIECE_SHAPE_TYPES) {
      for (const d of PIECE_PATHS[type]) {
        expect(d.startsWith('M'), `${type}: ${d}`).toBe(true);
        expect(d.trimEnd().endsWith('Z'), `${type}: ${d}`).toBe(true);
        for (const n of d.match(/-?\d+(\.\d+)?/g) ?? []) expect(Math.abs(Number(n)), `${type}: ${d}`).toBeLessThanOrEqual(100);
      }
      const joined = PIECE_PATHS[type].join('|');
      expect(seen.has(joined), type).toBe(false);
      seen.add(joined);
    }
  });

  it('the outline is 4 units wide', () => {
    expect(PIECE_OUTLINE_WIDTH).toBe(4);
  });
});
