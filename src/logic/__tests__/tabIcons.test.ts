import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getColors } from '../colorPalette';

/**
 * The tab bar's icons (offline-states branch). On the Blackview the Home tab's black pawn was almost invisible in dark mode: it was a text glyph, and Android draws that one with
 * the emoji font in a fixed black that no text colour changes. The icons are now drawn paths in a theme colour; this pins that (a) no tab uses a text glyph again and (b) the two
 * inks (active, inactive) have at least 3:1 (WCAG non-text contrast) against the bar's background in BOTH themes. The Android device matrix measures the same on the rendered page
 * (`contrast` issues, android-matrix-checks.mjs).
 */
const root = path.resolve(__dirname, '..', '..', '..');
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8');

function channel(hex: string, from: number): number {
  const v = parseInt(hex.slice(from, from + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
/** WCAG relative luminance of '#rgb' / '#rrggbb'. */
function luminance(color: string): number {
  const hex = color.length === 4 ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}` : color;
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('contrast helper', () => {
  it('black on white is 21:1, a colour on itself 1:1', () => {
    expect(contrast('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777')).toBeCloseTo(1, 5);
  });
  it('the old Home pawn (black on the dark bar) failed, which is the bug', () => {
    expect(contrast('#000000', getColors('dark').background)).toBeLessThan(3);
  });
});

describe('tab bar icon inks', () => {
  for (const mode of ['light', 'dark'] as const) {
    it(`${mode}: the active ink (text) and the inactive ink (textSecondary) have >= 3:1 against the bar`, () => {
      const colors = getColors(mode);
      expect(contrast(colors.text, colors.background)).toBeGreaterThanOrEqual(3);
      expect(contrast(colors.textSecondary, colors.background)).toBeGreaterThanOrEqual(3);
    });
  }
});

describe('BottomTabBar source', () => {
  const source = read('src/components/BottomTabBar.tsx');
  it('draws every icon with TabIcon in a theme colour and keeps no text glyph icon', () => {
    expect(source).toContain('<TabIcon name={tab.id}');
    expect(source).toContain('color={isActive ? colors.text : colors.textSecondary}'); // active: the text colour, inactive: the secondary one - exactly
    expect(source).not.toMatch(/icon:\s*'/); // no `icon: '♟'` style entries
    expect(source).not.toMatch(/[☀-➿\u{1F300}-\u{1FAFF}⋯]/u); // no pictograph or ellipsis glyph in the file
    expect(source).not.toContain('opacity'); // opacity would lower the contrast the tokens were chosen for
  });
  it('TabIcon marks its glyph for the matrix check and draws all four tabs', () => {
    const icon = read('src/components/TabIcon.tsx');
    expect(icon).toContain("matrixGlyph: '1'");
    for (const name of ['home', 'puzzles', 'analysis', 'more']) expect(icon).toContain(`name === '${name}'`);
  });
});
