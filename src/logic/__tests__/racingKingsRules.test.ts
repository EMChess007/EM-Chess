import { describe, expect, it } from 'vitest';
import { racingKingsRulesSheet } from '../racingKingsRules';

describe('Racing Kings rules sheet', () => {
  it('has the same sections in English and Greek, each with text', () => {
    const en = racingKingsRulesSheet('en');
    const el = racingKingsRulesSheet('el');
    expect(en.length).toBe(5);
    expect(el.length).toBe(en.length);
    for (const section of [...en, ...el]) {
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.lines.length).toBeGreaterThan(0);
    }
  });

  it('Greek sections are really Greek, English ones are not', () => {
    const greek = /[Ͱ-Ͽ]/;
    for (const s of racingKingsRulesSheet('el')) expect(greek.test(s.title + s.lines.join(' '))).toBe(true);
    for (const s of racingKingsRulesSheet('en')) expect(greek.test(s.title + s.lines.join(' '))).toBe(false);
  });

  it('says there is no insufficient-material draw, and that checks are illegal', () => {
    const en = racingKingsRulesSheet('en').flatMap((s) => s.lines).join(' ');
    expect(en).toContain('NO draw for insufficient material');
    expect(en).toContain('Giving check is ILLEGAL');
    const el = racingKingsRulesSheet('el').flatMap((s) => s.lines).join(' ');
    expect(el).toContain('ΔΕΝ υπάρχει ισοπαλία λόγω ανεπαρκούς υλικού');
  });
});
