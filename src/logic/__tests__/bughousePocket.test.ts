import { describe, expect, it } from 'vitest';
import {
  NAME_MIN_STRIP_WIDTH,
  pocketChipHeight,
  pocketChipWidth,
  pocketMinWidth,
  pocketPieceSize,
  POCKET_CHIP_HEIGHT,
  POCKET_CHIP_HEIGHT_COMPACT,
  POCKET_CHIP_MAX_WIDTH,
  POCKET_CHIP_MIN_WIDTH,
  POCKET_GAP,
  POCKET_MAX_CHIPS,
  POCKET_PADDING,
  showSeatName,
  STRIP_CLOCK_MIN_WIDTH,
  STRIP_DOT,
  STRIP_FIXED_WIDTH,
  STRIP_GAP,
  STRIP_NAME_MIN_WIDTH,
  STRIP_PADDING,
  STRIP_SHAPE,
} from '../bughousePocket';

/**
 * The geometry of a Bughouse pocket as numbers (command #27b). Literals on purpose: a test that read these from the module could never fail when they change.
 *
 *   a pocket is ONE row of at most five chips, each 24..40 dp wide and 26 dp tall (24 in the compact bars), 2 dp apart, with 2 dp of padding at each end;
 *   the strip around it needs 92 dp for its padding, colour dot, team shape, clock and gaps; the seat's name is shown from a strip of 280 dp, which keeps room for a FULL pocket (132 dp)
 *   and 56 dp of name - below that the name is left out and the pocket still fits.
 */
describe('the numbers', () => {
  it('chips: five at most, 24..40 wide, 26 tall (24 compact), 2 apart, 2 of padding', () => {
    expect(POCKET_MAX_CHIPS).toBe(5);
    expect(POCKET_CHIP_MIN_WIDTH).toBe(24);
    expect(POCKET_CHIP_MAX_WIDTH).toBe(40);
    expect(POCKET_CHIP_HEIGHT).toBe(26);
    expect(POCKET_CHIP_HEIGHT_COMPACT).toBe(24);
    expect(POCKET_GAP).toBe(2);
    expect(POCKET_PADDING).toBe(2);
    expect(pocketChipHeight(false)).toBe(26);
    expect(pocketChipHeight(true)).toBe(24);
    expect(pocketPieceSize(false)).toBe(20);
    expect(pocketPieceSize(true)).toBe(18);
  });

  it('the strip: padding 4, gap 4, dot 10, shape 12, clock 46, name 56 -> 92 fixed, 280 for the name beside a full pocket', () => {
    expect(STRIP_PADDING).toBe(4);
    expect(STRIP_GAP).toBe(4);
    expect(STRIP_DOT).toBe(10);
    expect(STRIP_SHAPE).toBe(12);
    expect(STRIP_CLOCK_MIN_WIDTH).toBe(46);
    expect(STRIP_NAME_MIN_WIDTH).toBe(56);
    expect(STRIP_FIXED_WIDTH).toBe(92);
    expect(NAME_MIN_STRIP_WIDTH).toBe(280);
  });
});

describe('pocketMinWidth: what a pocket needs at the smallest chip', () => {
  it.each([
    [0, 0],
    [1, 28],
    [2, 54],
    [3, 80],
    [4, 106],
    [5, 132],
  ])('%i chips need %i dp', (chips, width) => {
    expect(pocketMinWidth(chips)).toBe(width);
  });
});

describe('pocketChipWidth: as wide as the room allows, between 24 and 40', () => {
  it('not measured yet: the smallest, which always fits', () => {
    expect(pocketChipWidth(null, 5)).toBe(24);
    expect(pocketChipWidth(null, 1)).toBe(24);
  });

  it('no chips: the smallest', () => {
    expect(pocketChipWidth(300, 0)).toBe(24);
  });

  it.each([
    [132, 5, 24], // exactly the minimum
    [131, 5, 24], // 119 / 5 = 23 -> raised to 24
    [100, 5, 24], // far too little: the floor, never a wrap
    [137, 5, 25], // (137 - 4 - 8) / 5
    [200, 5, 37], // (200 - 4 - 8) / 5 = 37.6
    [300, 5, 40], // capped
    [300, 2, 40], // two chips in a wide row do not stretch
    [100, 2, 40], // (100 - 4 - 2) / 2 = 47 -> 40
    [80, 2, 37], // (80 - 4 - 2) / 2 = 37
    [60, 1, 40], // one chip
    [29, 1, 25], // (29 - 4) = 25
  ])('a row of %i dp with %i chips: %i dp each', (row, chips, width) => {
    expect(pocketChipWidth(row, chips)).toBe(width);
  });

  it('the chips of every pocket together never need more than the row when the row is at least the pocket\'s minimum', () => {
    for (let row = 132; row <= 400; row++) {
      for (let chips = 1; chips <= 5; chips++) {
        const width = pocketChipWidth(row, chips);
        expect(2 * 2 + chips * width + (chips - 1) * 2, `${row} dp, ${chips} chips`).toBeLessThanOrEqual(row);
      }
    }
  });
});

describe('showSeatName: decided by the strip\'s width alone', () => {
  it('shown before the first measurement', () => {
    expect(showSeatName(null)).toBe(true);
  });

  it('279 dp: left out; 280 dp: shown', () => {
    expect(showSeatName(279)).toBe(false);
    expect(showSeatName(280)).toBe(true);
    expect(showSeatName(0)).toBe(false);
  });

  it('whatever the strip, a FULL pocket (132 dp) fits beside the fixed parts and the name when it is shown (92 + 132 + 56 = 280)', () => {
    for (let strip = 224; strip <= 900; strip++) {
      const nameRoom = showSeatName(strip) ? 56 : 0;
      expect(strip - 92 - nameRoom, `${strip} dp`).toBeGreaterThanOrEqual(132);
    }
  });

  it('the narrowest strips the layouts allow: 224 dp (a stacked board at the 28 dp minimum cell) has the exact room, nothing less', () => {
    expect(8 * 28).toBe(224);
    expect(224 - 92).toBe(132);
    expect(pocketMinWidth(5)).toBe(132);
  });
});
