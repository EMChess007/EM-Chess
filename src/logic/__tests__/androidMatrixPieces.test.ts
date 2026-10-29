import { describe, expect, it } from 'vitest';
import { analyseCell, expectedInk, INK, INK_TOLERANCE, inkMatches, judgeCell } from '../../../scripts/browser/android-matrix-pieces.mjs';

/**
 * The analysis behind the device matrix's piece-colour check (command #27b), on SYNTHETIC cells: a square of one colour with a disc of the piece's colour in the middle. The browser run
 * photographs real cells; this proves the judgement itself - that a black king drawn white is reported, whatever the square, and a correct piece never is.
 */
type Rgb = [number, number, number];
const LIGHT: Rgb = [0xf0, 0xd9, 0xb5];
const DARK: Rgb = [0xb5, 0x88, 0x63];

/** A 40 x 40 cell of `square` with a filled disc of `ink` and a thin ring of `outline` around it. */
function cell(square: Rgb, ink: Rgb, outline: Rgb = ink, radius = 14) {
  const size = 40;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 19.5, y - 19.5);
      const colour = d <= radius ? ink : d <= radius + 1.5 ? outline : square;
      data.set([colour[0], colour[1], colour[2], 255], (y * size + x) * 4);
    }
  }
  return { width: size, height: size, data };
}

describe('the ink of every piece, as literals', () => {
  it('white #fafafa, black #1d1d1d, the four seats red, blue, yellow, green', () => {
    expect(INK.w).toEqual([0xfa, 0xfa, 0xfa]);
    expect(INK.b).toEqual([0x1d, 0x1d, 0x1d]);
    expect(INK.seat).toEqual([
      [0xd3, 0x2f, 0x2f],
      [0x19, 0x76, 0xd2],
      [0xf9, 0xa8, 0x25],
      [0x2e, 0x7d, 0x32],
    ]);
    expect(INK_TOLERANCE).toBe(40);
  });

  it('a marker says its ink: all twelve colour + type markers and the seat markers', () => {
    for (const type of ['p', 'n', 'b', 'r', 'q', 'k']) {
      expect(expectedInk(`w${type}`)).toEqual([0xfa, 0xfa, 0xfa]);
      expect(expectedInk(`b${type}`)).toEqual([0x1d, 0x1d, 0x1d]);
      for (const seat of [0, 1, 2, 3]) expect(expectedInk(`${seat}:${type}`)).toEqual(INK.seat[seat]);
    }
    for (const bad of ['', 'x', 'wx', 'kw', '4:p', '0:x', 'w', 'wkk']) expect(expectedInk(bad), bad).toBeNull();
  });

  it('inkMatches allows 40 and not 41 on the largest channel', () => {
    expect(inkMatches([0xfa - 40, 0xfa, 0xfa], INK.w)).toBe(true);
    expect(inkMatches([0xfa - 41, 0xfa, 0xfa], INK.w)).toBe(false);
    expect(inkMatches(null, INK.w)).toBe(false);
  });
});

describe('analyseCell', () => {
  it('reads the square from the corner and the piece from the commonest colour that is not the square', () => {
    const result = analyseCell(cell(LIGHT, [0x1d, 0x1d, 0x1d], [0xf1, 0xf1, 0xf1]));
    expect(result.background).toEqual(LIGHT);
    expect(result.piece).toEqual([0x1d, 0x1d, 0x1d]);
    expect(result.fraction).toBeGreaterThan(0.3);
  });

  it('an empty cell has no piece', () => {
    const result = analyseCell(cell(DARK, DARK, DARK));
    expect(result.piece).toBeNull();
    expect(result.fraction).toBe(0);
  });
});

describe('judgeCell: the verdict on a photographed piece', () => {
  it.each([
    ['wk', [0xfa, 0xfa, 0xfa], [0x1b, 0x1b, 0x1b]],
    ['bk', [0x1d, 0x1d, 0x1d], [0xf1, 0xf1, 0xf1]],
    ['bq', [0x1d, 0x1d, 0x1d], [0xf1, 0xf1, 0xf1]],
    ['wp', [0xfa, 0xfa, 0xfa], [0x1b, 0x1b, 0x1b]],
    ['0:p', [0xd3, 0x2f, 0x2f], [0, 0, 0]],
    ['2:n', [0xf9, 0xa8, 0x25], [0, 0, 0]],
  ] as Array<[string, Rgb, Rgb]>)('%s drawn right is clean on a light square and on a dark one', (marker, ink, outline) => {
    expect(judgeCell(marker, cell(LIGHT, ink, outline))).toBeNull();
    expect(judgeCell(marker, cell(DARK, ink, outline))).toBeNull();
  });

  it('THE BUG: a black king drawn white is reported, on both square colours', () => {
    for (const square of [LIGHT, DARK]) {
      const problem = judgeCell('bk', cell(square, [0xfa, 0xfa, 0xfa], [0x1b, 0x1b, 0x1b]));
      expect(problem).toContain('bk: drawn rgb(250,250,250)');
      expect(problem).toContain('expected rgb(29,29,29)');
    }
  });

  it('a white piece drawn black is reported', () => {
    expect(judgeCell('wq', cell(LIGHT, [0x1d, 0x1d, 0x1d], [0xf1, 0xf1, 0xf1]))).toContain('wq: drawn rgb(29,29,29)');
  });

  it('a grey (a glyph in the wrong colour) is reported for both colours', () => {
    expect(judgeCell('wk', cell(LIGHT, [0x80, 0x80, 0x80]))).not.toBeNull();
    expect(judgeCell('bk', cell(LIGHT, [0x80, 0x80, 0x80]))).not.toBeNull();
  });

  it('a seat piece in another seat\'s colour is reported', () => {
    expect(judgeCell('1:b', cell(DARK, INK.seat[0] as Rgb))).toContain('1:b: drawn rgb(211,47,47)');
  });

  it('no piece at all (an empty cell, a piece too small) is reported', () => {
    expect(judgeCell('bk', cell(LIGHT, LIGHT, LIGHT))).toContain('no piece found');
    expect(judgeCell('bk', cell(LIGHT, [0x1d, 0x1d, 0x1d], [0x1d, 0x1d, 0x1d], 3))).toContain('no piece found');
  });

  it('an unknown marker is reported', () => {
    expect(judgeCell('zz', cell(LIGHT, INK.b as Rgb))).toContain('unknown piece marker');
  });
});
