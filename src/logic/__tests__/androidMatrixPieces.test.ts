import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import pieceSets from '../../data/pieceSets.json';
import {
  analyseCell,
  checkPieceColours,
  expectedCell,
  expectedInk,
  IMAGE_BLOCK,
  IMAGE_MAX_DISTANCE,
  imageDistance,
  imageDistances,
  INK,
  INK_TOLERANCE,
  inkMatches,
  judgeCell,
  judgeImageCell,
} from '../../../scripts/browser/android-matrix-pieces.mjs';

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

// --- an image theme (command #27c) -------------------------------------------------------------------------------------------------------------------------------------------------------------
type Image = { width: number; height: number; data: Uint8Array };
const { PNG } = createRequire(import.meta.url)('pngjs') as { PNG: { sync: { read(buffer: Buffer): Image } } };

/** The twelve decoded assets of a shipped theme: { wk: {width, height, data}, ... }. */
function assetsOf(theme: string): Record<string, Image> {
  const out: Record<string, Image> = {};
  for (const [key, uri] of Object.entries((pieceSets as Record<string, Record<string, string>>)[theme])) out[key] = PNG.sync.read(Buffer.from(uri.replace(/^data:image\/png;base64,/, ''), 'base64'));
  return out;
}

/** A PHOTOGRAPH of a piece, made without expectedCell (so the test does not grade the function with itself): the asset sampled by nearest neighbour into `rect` over a square colour. */
function photograph(asset: Image, square: Rgb, size: number, rect: { x: number; y: number; w: number; h: number }): Image {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      const u = Math.min(asset.width - 1, Math.floor(((x - rect.x) / rect.w) * asset.width));
      const v = Math.min(asset.height - 1, Math.floor(((y - rect.y) / rect.h) * asset.height));
      const i = (v * asset.width + u) * 4;
      const a = inside ? asset.data[i + 3] / 255 : 0;
      for (let c = 0; c < 3; c++) data[(y * size + x) * 4 + c] = Math.round((inside ? asset.data[i + c] : 0) * a + square[c] * (1 - a));
      data[(y * size + x) * 4 + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

const flat = (width: number, height: number, rgba: [number, number, number, number]): Image => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { width, height, data };
};

describe('the constants of the image judge, as literals', () => {
  it('blocks of 8 pixels (a 1 px shift of a piece is about 7 at 4 px blocks, which a fractional cell position produces), a limit of 15 (real photographs of a correct piece are 1 - 7 from their asset)', () => {
    expect(IMAGE_BLOCK).toBe(8);
    expect(IMAGE_MAX_DISTANCE).toBe(15);
  });
});

describe('expectedCell: an asset drawn into a rectangle over the square', () => {
  const asset = flat(2, 2, [200, 100, 50, 255]);

  it('inside the rectangle the asset, outside it the square, opaque everywhere', () => {
    const cellImage = expectedCell(asset, [10, 20, 30], 8, 8, { x: 2, y: 2, w: 4, h: 4 });
    expect(cellImage.width).toBe(8);
    expect(cellImage.height).toBe(8);
    const at = (x: number, y: number) => Array.from(cellImage.data.slice((y * 8 + x) * 4, (y * 8 + x) * 4 + 4));
    expect(at(3, 3)).toEqual([200, 100, 50, 255]);
    expect(at(5, 5)).toEqual([200, 100, 50, 255]);
    expect(at(0, 0)).toEqual([10, 20, 30, 255]);
    expect(at(6, 6)).toEqual([10, 20, 30, 255]);
    expect(at(1, 4)).toEqual([10, 20, 30, 255]);
  });

  it('a transparent asset shows only the square; a half-transparent one blends', () => {
    const clear = expectedCell(flat(2, 2, [0, 0, 0, 0]), [10, 20, 30], 8, 8, { x: 2, y: 2, w: 4, h: 4 });
    expect(Array.from(clear.data.slice((3 * 8 + 3) * 4, (3 * 8 + 3) * 4 + 4))).toEqual([10, 20, 30, 255]);
    const half = expectedCell(flat(2, 2, [0, 0, 0, 128]), [100, 100, 100, 255].slice(0, 3) as Rgb, 8, 8, { x: 2, y: 2, w: 4, h: 4 });
    expect(Array.from(half.data.slice((3 * 8 + 3) * 4, (3 * 8 + 3) * 4 + 3))).toEqual([50, 50, 50]);
  });

  it('the image is scaled into the rectangle: a left half and a right half of different colours stay in their halves', () => {
    const two: Image = { width: 2, height: 1, data: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) };
    const out = expectedCell(two, [0, 0, 0], 8, 4, { x: 0, y: 0, w: 8, h: 4 });
    const at = (x: number, y: number) => Array.from(out.data.slice((y * 8 + x) * 4, (y * 8 + x) * 4 + 3));
    expect(at(1, 2)).toEqual([255, 0, 0]);
    expect(at(2, 0)).toEqual([255, 0, 0]);
    expect(at(5, 2)).toEqual([0, 0, 255]);
    expect(at(7, 3)).toEqual([0, 0, 255]);
  });
});

describe('imageDistance', () => {
  it('is 0 for the same picture and 255 for black against white', () => {
    expect(imageDistance(flat(8, 8, [10, 20, 30, 255]), flat(8, 8, [10, 20, 30, 255]))).toBe(0);
    expect(imageDistance(flat(8, 8, [0, 0, 0, 255]), flat(8, 8, [255, 255, 255, 255]))).toBe(255);
  });

  it('is the mean over the blocks: one block of 8 x 8 pixels (a quarter of a 16 x 16 picture) differing by 40 makes 10', () => {
    const a = flat(16, 16, [100, 100, 100, 255]);
    const b = flat(16, 16, [100, 100, 100, 255]);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) b.data.set([140, 140, 140, 255], (y * 16 + x) * 4);
    expect(imageDistance(a, b)).toBe(10);
  });

  it('blocks are 8 x 8: a single pixel of difference 255 in a 16 x 16 picture is 255 / 64 in its block, over 4 blocks', () => {
    const a = flat(16, 16, [0, 0, 0, 255]);
    const b = flat(16, 16, [0, 0, 0, 255]);
    b.data.set([255, 255, 255, 255], 0);
    expect(imageDistance(a, b)).toBeCloseTo(255 / 64 / 4, 10);
  });

  it('an edge block that is smaller than 8 x 8 is its own mean (a 12 x 8 picture: blocks of 8 and 4 columns)', () => {
    const a = flat(12, 8, [0, 0, 0, 255]);
    const b = flat(12, 8, [0, 0, 0, 255]);
    for (let y = 0; y < 8; y++) for (let x = 8; x < 12; x++) b.data.set([80, 80, 80, 255], (y * 12 + x) * 4);
    // two blocks: the left one identical, the right one (4 columns wide) differing by 80 on every pixel: its mean is 80, not 80 * 4 / 8
    expect(imageDistance(a, b)).toBe(40);
  });
});

describe.each(['cburnett', 'merida', 'checkers'])('judgeImageCell on %s, photographed without expectedCell', (theme) => {
  const assets = assetsOf(theme);
  const RECT = { x: 3, y: 3, w: 34, h: 34 };

  it.each(['wk', 'wq', 'wr', 'wb', 'wn', 'wp', 'bk', 'bq', 'br', 'bb', 'bn', 'bp'])('%s drawn right is clean on a light and on a dark square', (marker) => {
    for (const square of [LIGHT, DARK]) expect(judgeImageCell(marker, photograph(assets[marker], square, 40, RECT), assets, RECT), `${marker} on ${square}`).toBeNull();
  });

  it.each(['k', 'q', 'r', 'b', 'n', 'p'])('THE BUG: a black %s drawn as a white piece is reported, on both squares, saying it looks white', (kind) => {
    for (const square of [LIGHT, DARK]) {
      const problem = judgeImageCell('b' + kind, photograph(assets['w' + kind], square, 40, RECT), assets, RECT);
      expect(problem, `b${kind}`).toMatch(new RegExp(`^b${kind}: drawn like w[pnbrqk] \\(distance [0-9.]+\\), not like its own image \\([0-9.]+\\); the other colour's ${kind} is at [0-9.]+$`));
    }
  });

  it.each(['k', 'q', 'r', 'b', 'n', 'p'])('a white %s drawn as a black piece is reported', (kind) => {
    const problem = judgeImageCell('w' + kind, photograph(assets['b' + kind], LIGHT, 40, RECT), assets, RECT);
    expect(problem, `w${kind}`).toMatch(new RegExp(`^w${kind}: drawn like b[pnbrqk] \\(distance [0-9.]+\\), not like its own image \\([0-9.]+\\); the other colour's ${kind} is at [0-9.]+$`));
  });

  it('the verdict text carries the three distances it judged by: what it looks like, its own image, and the other colour of the same kind (read back and compared with imageDistances)', () => {
    const photo = photograph(assets.wq, DARK, 40, RECT);
    const distances = imageDistances(photo, assets, RECT) as Record<string, number>;
    const problem = String(judgeImageCell('bq', photo, assets, RECT));
    const parsed = /^bq: drawn like (\w\w) \(distance ([0-9.]+)\), not like its own image \(([0-9.]+)\); the other colour's q is at ([0-9.]+)$/.exec(problem);
    expect(parsed, problem).not.toBeNull();
    expect(Number(parsed?.[2])).toBeCloseTo(distances[parsed?.[1] as string], 1);
    expect(Number(parsed?.[3])).toBeCloseTo(distances.bq, 1);
    expect(Number(parsed?.[4])).toBeCloseTo(distances.wq, 1);
    expect(distances.wq).toBeLessThan(distances.bq);
  });

  it('distances: its own asset is within 8 of the photograph, the other colour of the kind at least 10 away', () => {
    const distances = imageDistances(photograph(assets.bk, DARK, 40, RECT), assets, RECT) as Record<string, number>;
    expect(distances.bk).toBeLessThan(8);
    expect(distances.wk).toBeGreaterThanOrEqual(10);
    expect(Object.keys(distances).sort()).toEqual(['bb', 'bk', 'bn', 'bp', 'bq', 'br', 'wb', 'wk', 'wn', 'wp', 'wq', 'wr']);
  });

  it('the square is read from the photograph\'s own corner: a piece on a highlighted (yellow) square is still judged right', () => {
    const yellow: Rgb = [0xf7, 0xec, 0x74];
    expect(judgeImageCell('bq', photograph(assets.bq, yellow, 40, RECT), assets, RECT)).toBeNull();
    expect(judgeImageCell('wq', photograph(assets.wq, yellow, 40, RECT), assets, RECT)).toBeNull();
  });

  it('the square is read from the photograph\'s TOP-LEFT corner, not another: a team badge or a mark in the bottom-right corner does not change the verdict', () => {
    const photo = photograph(assets.bk, LIGHT, 40, RECT);
    for (let y = 38; y < 40; y++) for (let x = 38; x < 40; x++) photo.data.set([0xe5, 0x39, 0x35, 255], (y * 40 + x) * 4);
    expect(judgeImageCell('bk', photo, assets, RECT)).toBeNull();
    // and the corner that IS read decides: a different colour at (1, 1) is the square the piece is judged over
    const odd = photograph(assets.bk, LIGHT, 40, RECT);
    odd.data.set([0x00, 0x80, 0x00, 255], (1 * 40 + 1) * 4);
    const distancesOf = (image: Image) => imageDistances(image, assets, RECT) as Record<string, number>;
    expect(distancesOf(odd).bk).not.toBe(distancesOf(photograph(assets.bk, LIGHT, 40, RECT)).bk);
  });

  it('a piece in a rectangle that is not square (wider than tall) is scaled into it on both axes', () => {
    const wide = { x: 2, y: 8, w: 36, h: 24 };
    for (const marker of ['bk', 'wq']) expect(judgeImageCell(marker, photograph(assets[marker], LIGHT, 40, wide), assets, wide), marker).toBeNull();
    const tall = { x: 8, y: 2, w: 24, h: 36 };
    for (const marker of ['bq', 'wk']) expect(judgeImageCell(marker, photograph(assets[marker], DARK, 40, tall), assets, tall), marker).toBeNull();
  });

  it('an empty cell is reported', () => {
    expect(judgeImageCell('bk', flat(40, 40, [LIGHT[0], LIGHT[1], LIGHT[2], 255]), assets, RECT)).not.toBeNull();
  });

  it('a piece drawn in the wrong place (the rectangle the page reported is not where it is) is reported', () => {
    expect(judgeImageCell('bk', photograph(assets.bk, LIGHT, 40, RECT), assets, { x: 15, y: 15, w: 34, h: 34 })).not.toBeNull();
  });
});

describe('judgeImageCell: the limit and the other verdicts', () => {
  const assets = assetsOf('cburnett');
  const RECT = { x: 3, y: 3, w: 34, h: 34 };

  it('an unknown marker and a missing asset are reported', () => {
    expect(judgeImageCell('zz', flat(40, 40, [0, 0, 0, 255]), assets, RECT)).toBe('unknown piece marker "zz"');
    expect(judgeImageCell('2:p', flat(40, 40, [0, 0, 0, 255]), assets, RECT)).toBe('unknown piece marker "2:p"');
    const partial = { ...assets } as Record<string, Image>;
    delete partial.bk;
    expect(judgeImageCell('bk', photograph(assets.bk, LIGHT, 40, RECT), partial, RECT)).toBe('bk: the theme has no image for it');
  });

  it('the right colour but too far from its own image (the piece is 4 px from where the page said) is reported with its distance and the limit of 15', () => {
    const shifted = photograph(assets.bk, LIGHT, 40, { ...RECT, x: RECT.x + 4 });
    expect(String(judgeImageCell('bk', shifted, assets, RECT))).toMatch(/^bk: [0-9.]+ away from its own image \(limit 15\)$/);
  });

  it('the same piece 1 px from where the page said is still judged right (a fractional cell position moves a piece by that much)', () => {
    expect(judgeImageCell('bk', photograph(assets.bk, LIGHT, 40, { ...RECT, x: RECT.x + 1 }), assets, RECT)).toBeNull();
  });
});

describe('checkPieceColours on a page that drew fewer pieces than it listed', () => {
  // The full matrix once died here (TypeError: Cannot read properties of undefined (reading 'evaluateHandle')): the page listed two pieces, then a reflow left no handle for the second.
  it('judges nothing for a piece without a handle and does not throw', async () => {
    const listed = [
      { index: 0, marker: 'bk', parity: 0, visible: true, board: 'A', rect: { x: 0, y: 0, w: 10, h: 10 } },
      { index: 1, marker: 'br', parity: 1, visible: true, board: 'A', rect: { x: 0, y: 0, w: 10, h: 10 } },
    ];
    const page = {
      locator: () => ({ count: async () => 0 }),
      $$eval: async () => listed,
      $$: async () => [],
    };
    await expect(checkPieceColours(page as never, { sync: { read: () => ({}) } } as never, { mode: 'bw' })).resolves.toEqual([]);
  });
});
