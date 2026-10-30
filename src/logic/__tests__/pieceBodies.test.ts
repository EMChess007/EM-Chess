import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PIECE_CHIP_BACKGROUND, PIECE_OUTLINE_WIDTH, WHITE_PIECE_INK, BLACK_PIECE_INK } from '../../components/pieceArt';
import { AVAILABLE_BOARD_THEMES } from '../boardThemes';
import { AVAILABLE_PIECE_THEMES } from '../pieceThemes';
import { BLACK_BODY_MAX, analyseCell, bodyLuminance, expectedCell } from '../../../scripts/browser/android-matrix-pieces.mjs';
import { BOARD_THEME_IDS } from '../../../scripts/browser/android-matrix-screens.mjs';

/**
 * THE BODY OF EVERY PIECE, NOT ITS MEAN (command #28). Two Android screenshots showed what a mean cannot: Merida's black king had a white body (the crown's rim and bands were half of what the
 * eye sees, yet its mean tone passed the "at most 100" bound) and Classic's black pieces had a thick light outline that, at game size on the blue squares, made them read as white.
 *
 * 1. every black / white IMAGE asset: the pixels of its BODY - the opaque pixels left after eroding the shape by 4 px, so the outline is out - are judged by their median and by the share of
 *    light and of dark pixels. A black piece whose body is half light fails here even if its mean is fine.
 * 2. every black piece of every image theme, scaled to the 27 dp a 32 dp cell draws it at, on the light AND the dark square of EVERY board theme: the median luminance of what the piece covers
 *    is dark (the matrix's `bodyLuminance`, which is the same judgement the browser applies to the photograph).
 * 3. the built-in vector set: its black fill is dark and keeps 3:1 against every square and the pocket chip; its outline is thin (at most 1 dp at 32 dp) and not light; the white outline has
 *    3:1 against every square and the chip, since a white fill alone does not stand out on a light square.
 * Every expectation is a LITERAL (colours, bounds, ids), so a mutant of the module under test cannot move it.
 */
const require = createRequire(import.meta.url);
const { PNG } = require('pngjs') as { PNG: { sync: { read(buffer: Buffer): { width: number; height: number; data: Uint8Array } } } };

const IMAGE_THEME_IDS = ['cburnett', 'merida', 'checkers'];
const KINDS = ['k', 'q', 'r', 'b', 'n', 'p'];
/** Literal board colours (the five built-in board themes) and the pocket chip's. */
const BOARDS: Record<string, [string, string]> = {
  default: ['#f0d9b5', '#b58863'],
  wood: ['#e8ca9a', '#a5682a'],
  green: ['#eeeed2', '#769656'],
  ocean: ['#dee3e6', '#4b7399'],
  marble: ['#e8e8e8', '#8a8a8a'],
};
const CHIP = '#b58863';

const hex = (value: string): [number, number, number] => [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];
const lum255 = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const relative = (value: string) => {
  const f = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : Math.pow((v / 255 + 0.055) / 1.055, 2.4));
  const [r, g, b] = hex(value);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [relative(a), relative(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const assetOf = (theme: string, key: string) => PNG.sync.read(readFileSync(path.join(process.cwd(), 'assets', 'pieces', theme, `${key}.png`)));

/** The opaque pixels (alpha >= 200) whose whole 9 x 9 neighbourhood is opaque: the shape minus a 4 px rim. */
function bodyLuminances(theme: string, key: string): number[] {
  const png = assetOf(theme, key);
  const { width, height, data } = png;
  const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3] >= 200;
  const out: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let inside = true;
      for (let dy = -4; dy <= 4 && inside; dy++) for (let dx = -4; dx <= 4; dx++) if (!opaque(x + dx, y + dy)) { inside = false; break; }
      if (inside) out.push(lum255([data[(y * width + x) * 4], data[(y * width + x) * 4 + 1], data[(y * width + x) * 4 + 2]]));
    }
  }
  return out.sort((a, b) => a - b);
}
const median = (sorted: number[]) => sorted[Math.floor(sorted.length / 2)];
const share = (values: number[], test: (v: number) => boolean) => values.filter(test).length / values.length;

describe.each(IMAGE_THEME_IDS)('%s: the BODY region of every asset', (theme) => {
  it.each(KINDS)('black %s: the body is dark (median <= 60 of 255, >= 70 % of it below 77, <= 30 % above 153)', (kind) => {
    const body = bodyLuminances(theme, 'b' + kind);
    expect(body.length, 'the body is not empty').toBeGreaterThan(500);
    expect(median(body)).toBeLessThanOrEqual(60);
    expect(share(body, (v) => v < 77)).toBeGreaterThanOrEqual(0.7);
    expect(share(body, (v) => v > 153)).toBeLessThanOrEqual(0.3);
  });

  it.each(KINDS)('white %s: the body is light (median >= 200, >= 55 % of it above 153)', (kind) => {
    const body = bodyLuminances(theme, 'w' + kind);
    expect(body.length).toBeGreaterThan(500);
    expect(median(body)).toBeGreaterThanOrEqual(200);
    expect(share(body, (v) => v > 153)).toBeGreaterThanOrEqual(0.55);
  });
});

describe('Merida: no black piece has a light band (the king had a white crown rim, command #28)', () => {
  it.each(KINDS)('black %s: not one body pixel is lighter than 90 of 255', (kind) => {
    const body = bodyLuminances('merida', 'b' + kind);
    expect(body[body.length - 1]).toBeLessThanOrEqual(90);
  });
});

describe('every black image piece at 32 dp reads dark on every board theme and on the chip', () => {
  const themes = AVAILABLE_PIECE_THEMES.filter((t) => t.images);
  it('the themes are the three image themes and the board themes are the five literal ones', () => {
    expect(themes.map((t) => t.id)).toEqual(IMAGE_THEME_IDS);
    expect(Object.keys(BOARDS)).toEqual(BOARD_THEME_IDS);
    expect(AVAILABLE_BOARD_THEMES.map((b) => [b.lightColor, b.darkColor])).toEqual(Object.values(BOARDS));
  });

  for (const theme of IMAGE_THEME_IDS) {
    for (const [boardId, squares] of Object.entries(BOARDS)) {
      for (const [index, square] of [...squares, CHIP].entries()) {
        const where = index === 2 ? 'the pocket chip' : `${boardId} ${index === 0 ? 'light' : 'dark'} square`;
        it(`${theme}: all six black pieces on ${where}: dominant colour and median are dark`, () => {
          // a 32 dp cell draws an image piece in its 85 % box: 27 px
          const cellSize = 32;
          const box = Math.round(cellSize * 0.85);
          const rect = { x: (cellSize - box) / 2, y: (cellSize - box) / 2, w: box, h: box };
          for (const kind of KINDS) {
            const photo = expectedCell(assetOf(theme, 'b' + kind), hex(square), cellSize, cellSize, rect);
            const body = bodyLuminance(photo);
            expect(body, `b${kind} body`).not.toBeNull();
            expect(body as number, `b${kind} on ${where}`).toBeLessThanOrEqual(BLACK_BODY_MAX);
            const { piece } = analyseCell(photo);
            expect(piece, `b${kind} dominant`).not.toBeNull();
            expect(lum255(piece as number[]), `b${kind} dominant colour on ${where}`).toBeLessThanOrEqual(BLACK_BODY_MAX);
          }
        });
      }
    }
  }

  it('the judgement is not blind: a black piece whose body is mostly light bands is reported', () => {
    // a synthetic king: a 27 px square, two thirds of it light bands (luminance 230) and the rest dark (29)
    const size = 32;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const inside = x >= 3 && x < 30 && y >= 3 && y < 30;
        const light = inside && y >= 12;
        const c = light ? 230 : inside ? 29 : 140;
        data.set([c, c, c, 255], (y * size + x) * 4);
      }
    }
    expect(bodyLuminance({ width: size, height: size, data })).toBeGreaterThan(BLACK_BODY_MAX);
  });
});

describe('Classic (vector): the ink on every square and on the chip', () => {
  const squares = [...Object.values(BOARDS).flat(), CHIP];

  it('the inks are the literals of command #28', () => {
    expect(WHITE_PIECE_INK).toEqual({ fill: '#fafafa', outline: '#1b1b1b' });
    expect(BLACK_PIECE_INK).toEqual({ fill: '#1d1d1d', outline: '#666666' });
  });

  it('the pocket chip, reserve chip and promotion button share ONE mid-tone background, the literal #b58863', () => {
    expect(PIECE_CHIP_BACKGROUND).toBe(CHIP);
    expect(PIECE_CHIP_BACKGROUND).toBe('#b58863');
    // mid-tone: darker than every light square and lighter than the black fill, so both inks stand out
    expect(relative(CHIP)).toBeGreaterThan(relative('#1d1d1d'));
    expect(relative(CHIP)).toBeLessThan(relative('#e8e8e8'));
  });

  it('a black piece is solid dark: its fill keeps 3:1 against all eleven squares and the chip', () => {
    for (const square of squares) expect(contrast('#1d1d1d', square), square).toBeGreaterThanOrEqual(3);
  });

  it('a white piece keeps 3:1 between its outline and every square (its fill alone does not stand out on a light one)', () => {
    for (const square of squares) expect(contrast('#1b1b1b', square), square).toBeGreaterThanOrEqual(3);
  });

  it('the outline is thin and never light: at most 1 dp at 32 dp (a 28 dp drawing), and the black outline is nowhere near white', () => {
    expect((PIECE_OUTLINE_WIDTH / 100) * Math.floor(32 * 0.9)).toBeLessThanOrEqual(1);
    expect(lum255(hex('#666666'))).toBeLessThan(120);
    expect(contrast('#1d1d1d', '#666666')).toBeLessThan(3);
  });
});
