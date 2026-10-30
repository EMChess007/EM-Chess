import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { PIECE_PATHS, PIECE_SHAPE_TYPES, WHITE_PIECE_INK, BLACK_PIECE_INK, pieceInk } from '../../components/pieceArt';
import pieceSets from '../../data/pieceSets.json';
import { seatPieceImageKey } from '../fourPlayer/presentation';
import { addCustomPieceThemeOption, AVAILABLE_PIECE_THEMES, DEFAULT_PIECE_THEME_ID, getPieceTheme, removeCustomPieceThemeOption } from '../pieceThemes';
// The screen list of the device matrix names every theme; this test is what makes a new theme without a matrix line fail.
import { PIECE_THEME_IDS } from '../../../scripts/browser/android-matrix-screens.mjs';

/**
 * EVERY PIECE THEME x ALL TWELVE PIECES (command #27c). A real phone showed the black rook, queen and king in the white pieces' colours, and nothing in the repo could say which theme drew
 * what: the piece-colour tests only ever looked at the built-in vector set (pieceColours.dom.test.tsx), the three image sets were never inspected, and the device matrix could not even find an
 * image piece (it had no marker). This file is the table: for the built-in theme and every image theme, each of the twelve pieces maps to its own asset, the white and the black piece of a kind
 * are different images, the twelve are all different, and the PIXELS of every asset say the colour its name says. Every expectation is a LITERAL - the ids, the keys, the bounds - so that a
 * mutant of the mapping code (pieceThemes.ts, pieceArt.ts, presentation.ts) cannot move the expectation with it.
 */
const require = createRequire(import.meta.url);
const { PNG } = require('pngjs') as { PNG: { sync: { read(buffer: Buffer): { width: number; height: number; data: Uint8Array } } } };

const THEME_IDS = ['default', 'cburnett', 'merida', 'checkers'];
const IMAGE_THEME_IDS = ['cburnett', 'merida', 'checkers'];
const KEYS = ['wk', 'wq', 'wr', 'wb', 'wn', 'wp', 'bk', 'bq', 'br', 'bb', 'bn', 'bp'];
const KINDS = ['k', 'q', 'r', 'b', 'n', 'p'];

const imagesOf = (id: string): Record<string, string> => {
  const images = AVAILABLE_PIECE_THEMES.find((theme) => theme.id === id)?.images;
  if (!images) throw new Error(`${id} has no images`);
  return images;
};
const decode = (uri: string) => {
  const match = /^data:image\/png;base64,(.+)$/.exec(uri);
  if (!match) throw new Error('not a PNG data URI');
  return PNG.sync.read(Buffer.from(match[1], 'base64'));
};
const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The mean luminance of the opaque pixels (alpha >= 200) of an asset, and the share of the 120 x 120 box they cover. */
function tone(uri: string) {
  const png = decode(uri);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] < 200) continue;
    sum += luminance(png.data[i], png.data[i + 1], png.data[i + 2]);
    n++;
  }
  return { mean: sum / n, coverage: n / (png.width * png.height), width: png.width, height: png.height };
}

/** The mean absolute difference of the alpha-weighted luminance of two same-size assets. */
function toneDistance(a: string, b: string) {
  const x = decode(a);
  const y = decode(b);
  let sum = 0;
  for (let i = 0; i < x.data.length; i += 4) sum += Math.abs(luminance(x.data[i], x.data[i + 1], x.data[i + 2]) * (x.data[i + 3] / 255) - luminance(y.data[i], y.data[i + 1], y.data[i + 2]) * (y.data[i + 3] / 255));
  return sum / (x.data.length / 4);
}

afterEach(() => {
  removeCustomPieceThemeOption('custom-test');
});

describe('the themes the app ships', () => {
  it('are exactly four, in this order, with these names: the built-in vector set and three image sets', () => {
    expect(AVAILABLE_PIECE_THEMES.map((theme) => theme.id)).toEqual(['default', 'cburnett', 'merida', 'checkers']);
    expect(AVAILABLE_PIECE_THEMES.map((theme) => theme.name)).toEqual(['Classic', 'Cburnett', 'Merida', 'Chess with Checkers']);
    expect(DEFAULT_PIECE_THEME_ID).toBe('default');
  });

  it('are the themes the device matrix opens one screen of each for (a theme without a matrix line fails here)', () => {
    expect(PIECE_THEME_IDS).toEqual(THEME_IDS);
  });

  it('an unknown id (a removed custom theme) is the built-in theme, never a missing one', () => {
    expect(getPieceTheme('no-such-theme').id).toBe('default');
    expect(getPieceTheme('').id).toBe('default');
    for (const id of THEME_IDS) expect(getPieceTheme(id).id).toBe(id);
  });

  it('a custom theme can be added and removed, and removing it leaves the shipped four', () => {
    addCustomPieceThemeOption({ id: 'custom-test', name: 'Mine', images: {}, isCustom: true });
    expect(AVAILABLE_PIECE_THEMES.map((theme) => theme.id)).toEqual(['default', 'cburnett', 'merida', 'checkers', 'custom-test']);
    expect(getPieceTheme('custom-test').name).toBe('Mine');
    removeCustomPieceThemeOption('custom-test');
    expect(AVAILABLE_PIECE_THEMES.map((theme) => theme.id)).toEqual(['default', 'cburnett', 'merida', 'checkers']);
    // removing an id that is not there removes nothing (splice(-1, 1) would have taken the last shipped theme)
    removeCustomPieceThemeOption('custom-test');
    expect(AVAILABLE_PIECE_THEMES.map((theme) => theme.id)).toEqual(['default', 'cburnett', 'merida', 'checkers']);
  });
});

describe('the built-in theme: a vector set with one ink per colour', () => {
  it('has no images (Piece.tsx draws it), and the six kinds are six different shapes', () => {
    expect(getPieceTheme('default').images).toBeUndefined();
    expect([...PIECE_SHAPE_TYPES].sort()).toEqual(['b', 'k', 'n', 'p', 'q', 'r']);
    const shapes = KINDS.map((kind) => (PIECE_PATHS[kind as 'k'] as readonly string[]).join('|'));
    expect(new Set(shapes).size).toBe(6);
  });

  it('white is light with a dark outline and black is dark with a light outline: four literal colours, and they differ', () => {
    expect(WHITE_PIECE_INK).toEqual({ fill: '#fafafa', outline: '#1b1b1b' });
    expect(BLACK_PIECE_INK).toEqual({ fill: '#1d1d1d', outline: '#f1f1f1' });
    expect(pieceInk('w')).toEqual({ fill: '#fafafa', outline: '#1b1b1b' });
    expect(pieceInk('b')).toEqual({ fill: '#1d1d1d', outline: '#f1f1f1' });
    expect(pieceInk('w').fill).not.toBe(pieceInk('b').fill);
    expect(pieceInk('w').outline).not.toBe(pieceInk('b').outline);
  });
});

describe.each(IMAGE_THEME_IDS)('image theme %s: all twelve pieces', (id) => {
  it('has exactly the twelve keys wk wq wr wb wn wp bk bq br bb bn bp, each a PNG data URI', () => {
    const images = imagesOf(id);
    expect(Object.keys(images).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) expect(images[key].startsWith('data:image/png;base64,'), key).toBe(true);
  });

  it('is the set of pieceSets.json, key for key (the registry does not shuffle them)', () => {
    const shipped = (pieceSets as Record<string, Record<string, string>>)[id];
    const images = imagesOf(id);
    for (const key of KEYS) expect(images[key], key).toBe(shipped[key]);
  });

  it('the white and the black piece of a kind are different images, and all twelve are different', () => {
    const images = imagesOf(id);
    for (const kind of KINDS) expect(images['w' + kind], kind).not.toBe(images['b' + kind]);
    expect(new Set(KEYS.map((key) => images[key])).size).toBe(12);
  });

  it('no two pieces look alike: every pair of the twelve differs in tone by at least 5 (of 255) on average', () => {
    const images = imagesOf(id);
    for (let a = 0; a < KEYS.length; a++) {
      for (let b = a + 1; b < KEYS.length; b++) expect(toneDistance(images[KEYS[a]], images[KEYS[b]]), `${KEYS[a]} / ${KEYS[b]}`).toBeGreaterThanOrEqual(5);
    }
  });

  it('every asset is a 120 x 120 picture with a piece in it (at least 15 % of the box is opaque)', () => {
    const images = imagesOf(id);
    for (const key of KEYS) {
      const t = tone(images[key]);
      expect([t.width, t.height], key).toEqual([120, 120]);
      expect(t.coverage, key).toBeGreaterThanOrEqual(0.15);
    }
  });

  it('the PIXELS say the colour: a white piece\'s mean tone is at least 100, a black one\'s at most 100, and a black piece is at least 25 darker than the white piece of its kind', () => {
    const images = imagesOf(id);
    for (const kind of KINDS) {
      const white = tone(images['w' + kind]).mean;
      const black = tone(images['b' + kind]).mean;
      expect(white, 'w' + kind).toBeGreaterThanOrEqual(100);
      expect(black, 'b' + kind).toBeLessThanOrEqual(100);
      expect(white - black, kind).toBeGreaterThanOrEqual(25);
    }
  });

  it('the black rook, queen and king - the pieces the phone drew white - are each darker than every white piece of the set', () => {
    const images = imagesOf(id);
    const lightestBlack = Math.max(...['br', 'bq', 'bk'].map((key) => tone(images[key]).mean));
    const darkestWhite = Math.min(...['wk', 'wq', 'wr', 'wb', 'wn', 'wp'].map((key) => tone(images[key]).mean));
    expect(lightestBlack).toBeLessThan(darkestWhite);
  });
});

describe('the 4-seat boards pick their piece from the same twelve (seatPieceImageKey)', () => {
  // Red, Blue and Green draw the theme's WHITE piece on their disc, Yellow the BLACK one; a promoted piece is the piece it became (7 queen, 8 knight, 9 bishop, 10 rook).
  const SEAT_SET = ['w', 'w', 'b', 'w'];
  const LETTER = ['', 'p', 'n', 'b', 'r', 'q', 'k', 'q', 'n', 'b', 'r'];

  it('every seat x every engine piece type maps to the literal key', () => {
    for (let seat = 0; seat < 4; seat++) {
      for (let type = 1; type <= 10; type++) expect(seatPieceImageKey(seat, type), `seat ${seat} type ${type}`).toBe(SEAT_SET[seat] + LETTER[type]);
    }
  });

  it.each(IMAGE_THEME_IDS)('under %s every one of those keys has an image, and Yellow\'s are the black set', (id) => {
    const images = imagesOf(id);
    for (let seat = 0; seat < 4; seat++) {
      for (let type = 1; type <= 10; type++) expect(images[seatPieceImageKey(seat, type)], `seat ${seat} type ${type}`).toBeDefined();
    }
    expect(images[seatPieceImageKey(2, 6)]).toBe(images.bk);
    expect(images[seatPieceImageKey(0, 6)]).toBe(images.wk);
  });
});
