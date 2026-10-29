import { describe, expect, it } from 'vitest';
import { isMismatch, PROBE_TEXTS, summarizeProbe, type ProbeEnvironment, type ProbeSample } from '../textFitProbe';

const sample = (over: Partial<ProbeSample> = {}): ProbeSample => ({ font: 'app', text: 'Home', boxWidth: 40, boxHeight: 20, lineCount: 1, textWidth: 40, textHeight: 20, ...over });
const env: ProbeEnvironment = { os: 'android', osVersion: 34, pixelRatio: 2.75, fontScale: 1.3, windowWidth: 412, windowHeight: 892, screenWidth: 412, screenHeight: 915, bundledFonts: true };

describe('isMismatch', () => {
  it('is false when the text fits its box', () => {
    expect(isMismatch(sample())).toBe(false);
    expect(isMismatch(sample({ textWidth: 40.5 }))).toBe(false); // rounding
    expect(isMismatch(sample({ textHeight: 20.5 }))).toBe(false);
  });

  it('is true when the text is wider than its box (the "Hom" of the device report)', () => {
    expect(isMismatch(sample({ textWidth: 40.6 }))).toBe(true);
    expect(isMismatch(sample({ boxWidth: 30, textWidth: 40 }))).toBe(true);
  });

  it('is true when the text wrapped although nothing limits its width (the "Fog of" / "War" of the report)', () => {
    expect(isMismatch(sample({ lineCount: 2, textHeight: 40, boxHeight: 40 }))).toBe(true);
  });

  it('is true when the lines are taller than the box (the clipped descenders)', () => {
    expect(isMismatch(sample({ textHeight: 20.6 }))).toBe(true);
  });
});

describe('summarizeProbe', () => {
  it('probes the strings of the report', () => {
    expect(PROBE_TEXTS).toEqual(['EM-Chess', 'Home', 'Play', 'Chess960', 'Fog of War', 'Play against bots']);
  });

  it('writes the environment and one line per font', () => {
    const lines = summarizeProbe(env, [sample(), sample({ font: 'system', text: 'Play' })]);
    expect(lines).toEqual([
      '[TextFit] android 34, pixel ratio 2.8, font scale 1.3, window 412x892, screen 412x915, bundled font loaded',
      '[TextFit] app font: 1 of 1 strings fit their box',
      '[TextFit] system font: 1 of 1 strings fit their box',
    ]);
  });

  it('names every mismatch, with the box and the text it measured', () => {
    const lines = summarizeProbe({ ...env, bundledFonts: false }, [sample({ font: 'system', text: 'Chess960', boxWidth: 64, textWidth: 75, textHeight: 20, boxHeight: 20 }), sample()]);
    expect(lines[0]).toContain('bundled font NOT loaded');
    expect(lines[1]).toBe('[TextFit] app font: 1 of 1 strings fit their box');
    expect(lines[2]).toBe('[TextFit] system font: 0 of 1 strings fit their box - MISMATCH: "Chess960" box 64x20, text 75x20 in 1 line(s)');
  });
});
