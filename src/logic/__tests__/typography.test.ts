import { afterEach, describe, expect, it } from 'vitest';
import {
  APP_FONT,
  areBundledFontsUsable,
  effectiveFontScale,
  fitTextStyle,
  readEmulatedFontScale,
  resolveFontFamily,
  resolveLineHeight,
  setBundledFontsUsable,
} from '../typography';

// Every constant below is a LITERAL on purpose: a test that reads a number from the module under mutation can never kill a mutant of it (AGENTS.md).

describe('the bundled font families', () => {
  it('are named as expo-font registers them', () => {
    expect(APP_FONT).toEqual({
      regular: 'Inter-Regular',
      medium: 'Inter-Medium',
      semibold: 'Inter-SemiBold',
      bold: 'Inter-Bold',
      extrabold: 'Inter-ExtraBold',
      italic: 'Inter-Italic',
    });
  });
});

describe('resolveFontFamily', () => {
  it('maps every weight the app uses to its own family', () => {
    expect(resolveFontFamily(undefined, undefined, true)).toBe('Inter-Regular');
    expect(resolveFontFamily('normal', undefined, true)).toBe('Inter-Regular');
    expect(resolveFontFamily('400', undefined, true)).toBe('Inter-Regular');
    expect(resolveFontFamily('500', undefined, true)).toBe('Inter-Medium');
    expect(resolveFontFamily('600', undefined, true)).toBe('Inter-SemiBold');
    expect(resolveFontFamily('700', undefined, true)).toBe('Inter-Bold');
    expect(resolveFontFamily('bold', undefined, true)).toBe('Inter-Bold');
    expect(resolveFontFamily('800', undefined, true)).toBe('Inter-ExtraBold');
    expect(resolveFontFamily('900', undefined, true)).toBe('Inter-ExtraBold');
  });

  it('puts the boundaries between weights where CSS puts them', () => {
    expect(resolveFontFamily('499', undefined, true)).toBe('Inter-Regular');
    expect(resolveFontFamily('599', undefined, true)).toBe('Inter-Medium');
    expect(resolveFontFamily('699', undefined, true)).toBe('Inter-SemiBold');
    expect(resolveFontFamily('799', undefined, true)).toBe('Inter-Bold');
    expect(resolveFontFamily(300, undefined, true)).toBe('Inter-Regular');
    expect(resolveFontFamily(700, undefined, true)).toBe('Inter-Bold');
  });

  it('draws italic with the italic family whatever the weight', () => {
    expect(resolveFontFamily('700', 'italic', true)).toBe('Inter-Italic');
    expect(resolveFontFamily(undefined, 'italic', true)).toBe('Inter-Italic');
  });

  it('keeps the system font when the bundled fonts are not usable', () => {
    expect(resolveFontFamily('700', undefined, false)).toBeUndefined();
    expect(resolveFontFamily('700', 'italic', false)).toBeUndefined();
  });

  it('treats a weight it does not understand as regular', () => {
    expect(resolveFontFamily('heavy', undefined, true)).toBe('Inter-Regular');
  });
});

describe('resolveLineHeight', () => {
  it('gives text with no line height 1.3 x its size, rounded up', () => {
    expect(resolveLineHeight(10, undefined)).toBe(13);
    expect(resolveLineHeight(11, undefined)).toBe(15); // 14.3 -> 15
    expect(resolveLineHeight(20, undefined)).toBe(26);
    expect(resolveLineHeight(15, undefined)).toBe(20); // 19.5 -> 20
  });

  it('uses 14 as the size when the style names none', () => {
    expect(resolveLineHeight(undefined, undefined)).toBe(19); // 18.2 -> 19
  });

  it('raises a line height tighter than 1.25 x the size, to 1.25 x rounded up', () => {
    expect(resolveLineHeight(16, 16)).toBe(20);
    expect(resolveLineHeight(10, 11)).toBe(13); // 12.5 -> 13
    expect(resolveLineHeight(28, 32)).toBe(35);
  });

  it('keeps a roomier line height', () => {
    expect(resolveLineHeight(14, 20)).toBe(20);
    expect(resolveLineHeight(14, 18)).toBe(18); // exactly 1.25 x 14 = 17.5 -> 18
  });
});

describe('effectiveFontScale', () => {
  it('is the system scale, never above the cap', () => {
    expect(effectiveFontScale(1, 1.5)).toBe(1);
    expect(effectiveFontScale(1.3, 1.5)).toBe(1.3);
    expect(effectiveFontScale(2, 1.5)).toBe(1.5);
    expect(effectiveFontScale(2, 1.2)).toBe(1.2);
    expect(effectiveFontScale(0.85, 1.2)).toBe(0.85);
  });
});

describe('readEmulatedFontScale (a test-only switch, CHECKLIST 7)', () => {
  it('is 1 by default', () => {
    expect(readEmulatedFontScale(true, 'web', undefined)).toBe(1);
  });

  it('is honoured in a development build on web', () => {
    expect(readEmulatedFontScale(true, 'web', 1.3)).toBe(1.3);
    expect(readEmulatedFontScale(true, 'web', 2)).toBe(2);
    expect(readEmulatedFontScale(true, 'web', 0.85)).toBe(0.85);
  });

  it('is ignored in a release build', () => {
    expect(readEmulatedFontScale(false, 'web', 2)).toBe(1);
  });

  it('is ignored on a device (the system scale is the real one there)', () => {
    expect(readEmulatedFontScale(true, 'android', 2)).toBe(1);
    expect(readEmulatedFontScale(true, 'ios', 2)).toBe(1);
  });

  it('only accepts a finite value inside [0.5, 3]', () => {
    expect(readEmulatedFontScale(true, 'web', 0.5)).toBe(0.5);
    expect(readEmulatedFontScale(true, 'web', 3)).toBe(3);
    expect(readEmulatedFontScale(true, 'web', 0.49)).toBe(1);
    expect(readEmulatedFontScale(true, 'web', 3.01)).toBe(1);
    expect(readEmulatedFontScale(true, 'web', Infinity)).toBe(1);
    expect(readEmulatedFontScale(true, 'web', NaN)).toBe(1);
    expect(readEmulatedFontScale(true, 'web', '2')).toBe(1);
    expect(readEmulatedFontScale(true, 'web', null)).toBe(1);
  });
});

describe('fitTextStyle', () => {
  it('gives a plain style the right family and a roomy line height, and resets the weight', () => {
    expect(fitTextStyle({ fontSize: 16, fontWeight: '700' }, true, 1)).toEqual({
      lineHeight: 21,
      fontFamily: 'Inter-Bold',
      fontWeight: 'normal',
      fontStyle: 'normal',
    });
  });

  it('leaves the system font alone when the bundled fonts are not usable (the line height is still fixed)', () => {
    expect(fitTextStyle({ fontSize: 16, fontWeight: '700' }, false, 1)).toEqual({ lineHeight: 21 });
  });

  it('respects a font family the style names itself, and leaves its weight alone', () => {
    expect(fitTextStyle({ fontSize: 12, fontFamily: 'Courier', fontWeight: '700' }, true, 1)).toEqual({ lineHeight: 16, fontFamily: 'Courier' });
  });

  it('multiplies size and line height by the emulated scale', () => {
    expect(fitTextStyle({ fontSize: 10, lineHeight: 14 }, false, 2)).toEqual({ fontSize: 20, lineHeight: 28 });
    expect(fitTextStyle({ fontSize: 10 }, false, 1.3)).toEqual({ fontSize: 13, lineHeight: 17 }); // 13 x 1.3 = 16.9 -> 17
    expect(fitTextStyle({}, false, 2)).toEqual({ fontSize: 28, lineHeight: 38 }); // 14 x 2 and 19 x 2
  });

  it('does not touch the size at scale 1', () => {
    expect(fitTextStyle({ fontSize: 10 }, false, 1).fontSize).toBeUndefined();
  });
});

describe('the bundled-fonts switch', () => {
  afterEach(() => setBundledFontsUsable(false));

  it('starts off and follows the app', () => {
    expect(areBundledFontsUsable()).toBe(false);
    setBundledFontsUsable(true);
    expect(areBundledFontsUsable()).toBe(true);
    setBundledFontsUsable(false);
    expect(areBundledFontsUsable()).toBe(false);
  });
});
