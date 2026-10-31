import { createContext, forwardRef, useContext } from 'react';
import { Platform, StyleSheet, Text as RNText, TextInput as RNTextInput, type TextInputInstance, type TextInputProps, type TextInstance, type TextProps, type TextStyle } from 'react-native';
import {
  areBundledFontsUsable,
  BODY_MAX_FONT_SIZE_MULTIPLIER,
  DENSE_MAX_FONT_SIZE_MULTIPLIER,
  effectiveFontScale,
  EMULATED_TEXT_SCALE_GLOBAL,
  fitTextStyle,
  readEmulatedFontScale,
  resolveFontFamily,
} from '../logic/typography';

/**
 * The app's `Text` and `TextInput` (Android text-fit fix, see logic/typography.ts for the WHY). EVERY screen imports these instead of react-native's: a scan test
 * (`textFit.test.ts`) fails if a file outside this one imports `Text` / `TextInput` from 'react-native'. They differ from the originals in exactly three ways:
 *   1. the font: the bundled Inter family for the weight / style the style asks for (the weight is part of the family, `fontWeight` is reset), so glyph metrics no longer
 *      depend on the phone's system font;
 *   2. the line height: never tighter than 1.25 x the font size, 1.3 x when none is given (not applied to text nested inside another Text, which inherits its parent's);
 *   3. `maxFontSizeMultiplier`: 1.5 unless the caller sets it (dense controls pass DENSE_MAX_FONT_SIZE_MULTIPLIER), so text cannot outgrow the box built for it.
 * On web, in a development build only, `window.__EM_TEXT_SCALE__` emulates Android's font-size setting for the browser device matrix.
 */

const InsideText = createContext(false);

/**
 * Web only: a word wider than its box breaks inside the word instead of overflowing it (and, unlike `overflow-wrap: break-word`, counts as breakable when a flex item's minimum
 * width is worked out, so a label can shrink to its column). The native text engines (Android's StaticLayout) already break a word that does not fit its line.
 */
const WEB_BREAK_LONG_WORDS = { overflowWrap: 'anywhere' } as TextStyle;

/** The platform, read defensively: a test that replaces 'react-native' with a partial mock has no `Platform`, and that is not a reason for a Text to throw. */
function platformOS(): string {
  try {
    return Platform.OS;
  } catch {
    return 'unknown';
  }
}

function emulatedScale(): number {
  const dev = typeof __DEV__ !== 'undefined' && __DEV__;
  return readEmulatedFontScale(dev, platformOS(), (globalThis as Record<string, unknown>)[EMULATED_TEXT_SCALE_GLOBAL]);
}

/**
 * The Android end-to-end build only (command #30; `__DEV__` and EXPO_PUBLIC_E2E, both folded to false in a release bundle): a running clock rewrites its text every second (Bughouse every 200 ms),
 * and every rewrite is an accessibility event. `uiautomator dump` waits for a quiet stream of those events and gives up with "could not get idle state" on a screen that never has one, which
 * is why the driver kept reading the previous screen's tree on the game screens. A text that is only a clock reading is marked not important for accessibility in that build, so the dump
 * can run; nothing else about the text changes.
 */
const E2E_QUIET_CLOCKS = typeof __DEV__ !== 'undefined' && __DEV__ && process.env.EXPO_PUBLIC_E2E === '1';
// a reading alone ("4:59", "0:05.3", "59.9") or at the END of a label ("White: 4:59", "Black - 1:00:00"): the local screens write the name and the clock in ONE Text
const CLOCK_READING = /(?:^|[\s:])(?:\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d)?\s*$|^\s*\d{1,2}\.\d\s*$/;
export function isClockReading(children: unknown): boolean {
  const text = Array.isArray(children) ? children.map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : '\u0000')).join('') : typeof children === 'string' || typeof children === 'number' ? String(children) : '';
  return CLOCK_READING.test(text);
}

export const Text = forwardRef<TextInstance, TextProps>(function Text({ style, maxFontSizeMultiplier, children, ...rest }, ref) {
  const nested = useContext(InsideText);
  const quiet = E2E_QUIET_CLOCKS && isClockReading(children) ? ({ importantForAccessibility: 'no' } as const) : null;
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const cap = maxFontSizeMultiplier ?? BODY_MAX_FONT_SIZE_MULTIPLIER;
  const fit = fitTextStyle(
    { fontSize: flat.fontSize, lineHeight: flat.lineHeight, fontWeight: flat.fontWeight, fontStyle: flat.fontStyle, fontFamily: flat.fontFamily },
    areBundledFontsUsable(),
    effectiveFontScale(emulatedScale(), cap),
  );
  // Nested text inherits the line height and (unless it names one) the size of the Text around it.
  if (nested) {
    if (flat.lineHeight === undefined) delete (fit as { lineHeight?: number }).lineHeight;
    if (flat.fontSize === undefined) delete fit.fontSize;
  }
  return (
    <RNText ref={ref} {...rest} {...quiet} maxFontSizeMultiplier={cap} style={[platformOS() === 'web' ? WEB_BREAK_LONG_WORDS : null, style, fit as TextStyle]}>
      <InsideText.Provider value>{children}</InsideText.Provider>
    </RNText>
  );
});

/** `Text` for dense controls (a seat strip, a clock row, a chip): grows at most DENSE_MAX_FONT_SIZE_MULTIPLIER x with the system font scale. A caller's own `maxFontSizeMultiplier` wins. */
export const DenseText = forwardRef<TextInstance, TextProps>(function DenseText({ maxFontSizeMultiplier, ...rest }, ref) {
  return <Text ref={ref} maxFontSizeMultiplier={maxFontSizeMultiplier ?? DENSE_MAX_FONT_SIZE_MULTIPLIER} {...rest} />;
});

/** Input text takes the bundled font and the cap; its line height is left to the platform (a fixed line height shifts the text inside an Android TextInput). */
export const TextInput = forwardRef<TextInputInstance, TextInputProps>(function TextInput({ style, maxFontSizeMultiplier, ...rest }, ref) {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const family = flat.fontFamily ?? resolveFontFamily(flat.fontWeight, flat.fontStyle, areBundledFontsUsable());
  const fit: TextStyle = family && flat.fontFamily === undefined ? { fontFamily: family, fontWeight: 'normal', fontStyle: 'normal' } : {};
  return <RNTextInput ref={ref} {...rest} maxFontSizeMultiplier={maxFontSizeMultiplier ?? BODY_MAX_FONT_SIZE_MULTIPLIER} style={[style, fit]} />;
});

export type { TextProps, TextInputProps };
