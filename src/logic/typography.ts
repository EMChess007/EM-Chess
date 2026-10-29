/**
 * One place that decides how EVERY piece of text in the app is measured and drawn (Android text-fit fix, branch fix/android-text-fit).
 *
 * WHY THIS EXISTS. On a real Android phone (Blackview Fort 200, Expo Go) the last characters of nearly every label were cut off ("Hom", "Pla", "EM-Ches"), the
 * second line of a wrapped sentence was missing ("Fog of" for "Fog of War") and descenders were clipped ("Plav aaainst bots"). The text boxes were laid out for ONE set
 * of glyph metrics and the glyphs were then drawn with another (the OEM's system font, or a font scale the layout did not use): a word that no longer fits its box wraps
 * INSIDE it and the part that wrapped falls below the box and is clipped. None of this shows on web, where the browser measures and draws with the same font. The fix is
 * therefore not per screen: (1) every Text draws with ONE bundled font (so the metrics no longer depend on the OEM font), (2) every line has room above and below the
 * glyphs (an explicit line height of at least 1.25 x the font size), (3) text scaling is capped (`maxFontSizeMultiplier`), a little for body text and tightly for dense
 * controls, so no fixed-size container is ever asked to hold text it was not built for.
 *
 * This file is pure (no react-native import), so the rules are unit-tested and mutation-tested; `components/AppText.tsx` applies them to every `Text` / `TextInput`.
 */

/** Font families as registered with expo-font (src/components/appFontAssets.ts). Android cannot pick a weight inside a custom family, so each weight is its own family. */
export const APP_FONT = {
  regular: 'Inter-Regular',
  medium: 'Inter-Medium',
  semibold: 'Inter-SemiBold',
  bold: 'Inter-Bold',
  extrabold: 'Inter-ExtraBold',
  italic: 'Inter-Italic',
} as const;

export type AppFontFamily = (typeof APP_FONT)[keyof typeof APP_FONT];

/** RN's default font size, used when a style names none. */
export const DEFAULT_FONT_SIZE = 14;
/** A line is never shorter than this multiple of its font size (descenders and the second line of a wrap need the room). */
export const MIN_LINE_HEIGHT_RATIO = 1.25;
/** The line height given to text that names none. */
export const DEFAULT_LINE_HEIGHT_RATIO = 1.3;
/** Body text may grow to this multiple of the system font scale (Android allows up to 2.0). Accessibility sizes above it are not honoured for running text. */
export const BODY_MAX_FONT_SIZE_MULTIPLIER = 1.5;
/** Dense controls (tab bar, chips, clocks, board labels) may grow only this much: a fixed-size control cannot hold twice the text. */
export const DENSE_MAX_FONT_SIZE_MULTIPLIER = 1.2;

let fontsUsable = false;

/** Called once by App.tsx when the bundled fonts finished loading (true) or failed to (false: the system font is kept, nothing else changes). */
export function setBundledFontsUsable(usable: boolean): void {
  fontsUsable = usable;
}

export function areBundledFontsUsable(): boolean {
  return fontsUsable;
}

/** The family that draws a given weight / style, or undefined when the weight is the system font's business (no bundled font loaded). */
export function resolveFontFamily(fontWeight: unknown, fontStyle: unknown, usable: boolean): AppFontFamily | undefined {
  if (!usable) return undefined;
  if (fontStyle === 'italic') return APP_FONT.italic;
  const weight = fontWeight === 'bold' ? 700 : fontWeight === 'normal' || fontWeight === undefined ? 400 : Number(fontWeight);
  if (!Number.isFinite(weight)) return APP_FONT.regular;
  if (weight >= 800) return APP_FONT.extrabold;
  if (weight >= 700) return APP_FONT.bold;
  if (weight >= 600) return APP_FONT.semibold;
  if (weight >= 500) return APP_FONT.medium;
  return APP_FONT.regular;
}

/**
 * The line height a text gets. Text with no line height gets 1.3 x its font size; one that names a tighter value (the descenders are clipped below ~1.2) is raised to
 * 1.25 x; a roomier one is kept. Rounded UP to a whole dp: Android rounds a fractional line height down.
 */
export function resolveLineHeight(fontSize: number | undefined, lineHeight: number | undefined): number {
  const size = fontSize ?? DEFAULT_FONT_SIZE;
  if (lineHeight === undefined) return Math.ceil(size * DEFAULT_LINE_HEIGHT_RATIO);
  return Math.max(lineHeight, Math.ceil(size * MIN_LINE_HEIGHT_RATIO));
}

/** The multiplier text actually grows by: the system font scale, never above the cap. */
export function effectiveFontScale(systemScale: number, cap: number): number {
  return Math.min(systemScale, cap);
}

/**
 * Web has no system font scale, so the browser matrix (scripts/browser/android-matrix.mjs) sets `window.__EM_TEXT_SCALE__` to emulate Android's "Font size" setting.
 * A TEST-ONLY SWITCH (CHECKLIST 7): honoured only in a development build (`dev`), only on web, only for a finite value inside [0.5, 3]; anything else is 1.
 * A release build (`__DEV__` false) never reads it, so a page cannot change the size of the app's text.
 */
export const EMULATED_TEXT_SCALE_GLOBAL = '__EM_TEXT_SCALE__';
export function readEmulatedFontScale(dev: boolean, os: string, raw: unknown): number {
  if (!dev || os !== 'web') return 1;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0.5 || raw > 3) return 1;
  return raw;
}

export interface FitInput {
  fontSize?: number;
  lineHeight?: number;
  fontWeight?: unknown;
  fontStyle?: unknown;
  fontFamily?: string;
}

export interface FitOutput {
  fontSize?: number;
  lineHeight: number;
  fontFamily?: string;
  /** `'normal'` when a bundled family is chosen here (the weight is IN the family; a weight on top would be synthesised on web). */
  fontWeight?: 'normal';
  fontStyle?: 'normal';
}

/**
 * The text style a flattened style becomes. `scale` is the emulated web font scale already limited by the cap (1 on a device, where React Native scales by itself); it multiplies
 * the font size and the line height so the web matrix sees what a phone with that font setting would draw.
 */
export function fitTextStyle(style: FitInput, usable: boolean, scale: number): FitOutput {
  const family = style.fontFamily ?? resolveFontFamily(style.fontWeight, style.fontStyle, usable);
  const lineHeight = resolveLineHeight(style.fontSize, style.lineHeight);
  const out: FitOutput = {
    lineHeight: scale === 1 ? lineHeight : Math.ceil(lineHeight * scale),
  };
  if (scale !== 1) {
    out.fontSize = (style.fontSize ?? DEFAULT_FONT_SIZE) * scale;
  }
  if (family !== undefined) {
    out.fontFamily = family;
    if (style.fontFamily === undefined) {
      out.fontWeight = 'normal';
      out.fontStyle = 'normal';
    }
  }
  return out;
}
