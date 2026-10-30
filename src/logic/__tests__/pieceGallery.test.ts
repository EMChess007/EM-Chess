import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { GALLERY_PIECE_KEYS, GALLERY_ROWS, KIND_LETTERS, galleryCellLabel, galleryCellSize } from '../pieceGallery';
import { readBuildInfo } from '../buildInfo';

/**
 * THE PIECE GALLERY'S DATA and THE BUILD IDENTIFIER (command #27d). Literals only: a cell's size at four window widths, the four rows in order, the twelve keys, the build label's format and what
 * scripts/build-info.cjs does with a git that works, a dirty tree and no git at all.
 */
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const require = createRequire(import.meta.url);
const { getBuildInfo } = require('../../../scripts/build-info.cjs') as { getBuildInfo: (options?: { exec?: (args: string[]) => string; now?: () => Date }) => { commit: string; builtAt: string } };

describe('the gallery grid', () => {
  it('has four rows: white on light, white on dark, black on light, black on dark', () => {
    expect(GALLERY_ROWS.map((row) => `${row.color}/${row.square}/${row.label}`)).toEqual([
      'w/light/White on light',
      'w/dark/White on dark',
      'b/light/Black on light',
      'b/dark/Black on dark',
    ]);
  });

  it('lists the twelve pieces of a theme, white first, each king to pawn', () => {
    expect(GALLERY_PIECE_KEYS).toEqual(['wk', 'wq', 'wr', 'wb', 'wn', 'wp', 'bk', 'bq', 'br', 'bb', 'bn', 'bp']);
    expect(KIND_LETTERS).toEqual({ k: 'K', q: 'Q', r: 'R', b: 'B', n: 'N', p: 'P' });
  });

  it('a cell is what six columns share after the gutters and the label column: 56 at most, 28 at least', () => {
    expect(galleryCellSize(412)).toBe(52);
    expect(galleryCellSize(360)).toBe(44);
    expect(galleryCellSize(800)).toBe(56);
    expect(galleryCellSize(200)).toBe(28);
  });

  it('a cell is labelled with the theme, the colour, the piece and the square', () => {
    expect(galleryCellLabel('Merida', 'b', 'k', 'dark')).toBe('Merida: black king on a dark square');
    expect(galleryCellLabel('Classic', 'w', 'p', 'light')).toBe('Classic: white pawn on a light square');
  });
});

describe('readBuildInfo (the app side)', () => {
  it('reads the commit and the time and says both on one line', () => {
    expect(readBuildInfo({ buildInfo: { commit: '803288a', builtAt: '2026-10-30T14:45:12.000Z' } })).toEqual({
      commit: '803288a',
      builtAt: '2026-10-30T14:45:12.000Z',
      label: 'build 803288a · 2026-10-30 14:45 UTC',
    });
    expect(readBuildInfo({ buildInfo: { commit: '803288a-dirty', builtAt: '2026-10-30T14:45:12Z' } }).label).toBe('build 803288a-dirty · 2026-10-30 14:45 UTC');
  });

  it('anything else is "unknown" and never throws', () => {
    const unknown = { commit: 'unknown', builtAt: 'unknown', label: 'build unknown · time unknown' };
    expect(readBuildInfo(undefined)).toEqual(unknown);
    expect(readBuildInfo(null)).toEqual(unknown);
    expect(readBuildInfo({})).toEqual(unknown);
    expect(readBuildInfo({ buildInfo: { commit: 'not a hash', builtAt: 'yesterday' } })).toEqual(unknown);
    expect(readBuildInfo({ buildInfo: { commit: 7, builtAt: 8 } })).toEqual(unknown);
    expect(readBuildInfo({ buildInfo: { commit: 'ABCDEF1', builtAt: '2026-10-30T14:45:12Z' } }).commit).toBe('unknown');
  });
});

describe('getBuildInfo (the bundler side, scripts/build-info.cjs)', () => {
  const now = () => new Date('2026-10-30T14:45:12.000Z');

  it('is the short hash and the ISO time of a clean checkout', () => {
    const calls: string[][] = [];
    const exec = (args: string[]) => {
      calls.push(args);
      return args[0] === 'rev-parse' ? '803288a' : '';
    };
    expect(getBuildInfo({ exec, now })).toEqual({ commit: '803288a', builtAt: '2026-10-30T14:45:12.000Z' });
    expect(calls).toEqual([['rev-parse', '--short=7', 'HEAD'], ['status', '--porcelain']]);
  });

  it('marks a checkout with uncommitted changes "-dirty"', () => {
    const exec = (args: string[]) => (args[0] === 'rev-parse' ? '803288a' : ' M src/a.ts');
    expect(getBuildInfo({ exec, now }).commit).toBe('803288a-dirty');
  });

  it('is "unknown" when git fails or answers nonsense, and still has the time', () => {
    expect(getBuildInfo({ exec: () => { throw new Error('no git'); }, now })).toEqual({ commit: 'unknown', builtAt: '2026-10-30T14:45:12.000Z' });
    expect(getBuildInfo({ exec: () => 'fatal: not a git repository', now }).commit).toBe('unknown');
  });

  it('the real git of this checkout gives a hash the app side accepts', () => {
    const info = getBuildInfo();
    expect(readBuildInfo({ buildInfo: info }).commit).toBe(info.commit);
  });
});
