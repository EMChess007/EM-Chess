/**
 * The on-device text-fit check (More > Diagnostics > "Run text-fit check"; Android text-fit branch).
 *
 * The clipping seen on a real phone ("Hom", "Pla", "EM-Ches") is a text box laid out for other glyph metrics than the ones it is drawn with. A browser cannot show that, a phone can:
 * the check renders a few of the strings that were cut, once with the app's bundled font and once with the phone's system font, with no width constraint at all, and compares the width
 * the layout gave each box (`onLayout`) with the width of the text actually laid out in it (`onTextLayout`). A box narrower than its own text, or text that wrapped with nothing to
 * wrap against, is the mismatch. The result goes into the diagnostic log with the font scale and the screen, so one screenshot says which fonts and which settings are affected.
 */

export interface ProbeSample {
  /** 'app' = the bundled Inter through AppText; 'system' = the phone's own font through react-native's Text. */
  font: 'app' | 'system';
  text: string;
  /** What `onLayout` reported for the text's box. */
  boxWidth: number;
  boxHeight: number;
  /** What `onTextLayout` reported for the lines. */
  lineCount: number;
  textWidth: number;
  textHeight: number;
}

export interface ProbeEnvironment {
  os: string;
  osVersion: string | number;
  pixelRatio: number;
  fontScale: number;
  windowWidth: number;
  windowHeight: number;
  screenWidth: number;
  screenHeight: number;
  bundledFonts: boolean;
}

/** The strings the device report showed cut, plus a wide one and one with descenders. */
export const PROBE_TEXTS = ['EM-Chess', 'Home', 'Play', 'Chess960', 'Fog of War', 'Play against bots'] as const;

/** The text is wider than its box by more than rounding, or it wrapped although nothing limits its width. */
export function isMismatch(sample: ProbeSample): boolean {
  return sample.textWidth > sample.boxWidth + 0.5 || sample.lineCount > 1 || sample.textHeight > sample.boxHeight + 0.5;
}

const r = (n: number) => Math.round(n * 10) / 10;

/** The lines written to the diagnostic log. */
export function summarizeProbe(env: ProbeEnvironment, samples: readonly ProbeSample[]): string[] {
  const lines = [
    `[TextFit] ${env.os} ${env.osVersion}, pixel ratio ${r(env.pixelRatio)}, font scale ${r(env.fontScale)}, window ${r(env.windowWidth)}x${r(env.windowHeight)}, screen ${r(env.screenWidth)}x${r(env.screenHeight)}, bundled font ${env.bundledFonts ? 'loaded' : 'NOT loaded'}`,
  ];
  for (const font of ['app', 'system'] as const) {
    const mine = samples.filter((s) => s.font === font);
    const bad = mine.filter(isMismatch);
    lines.push(`[TextFit] ${font} font: ${mine.length - bad.length} of ${mine.length} strings fit their box${bad.length ? ` - MISMATCH: ${bad.map((s) => `"${s.text}" box ${r(s.boxWidth)}x${r(s.boxHeight)}, text ${r(s.textWidth)}x${r(s.textHeight)} in ${s.lineCount} line(s)`).join('; ')}` : ''}`);
  }
  return lines;
}
