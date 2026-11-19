import { describe, expect, it } from 'vitest';
import { torpedoRulesSheet } from '../torpedoRules';

describe('Torpedo rules sheet', () => {
  it('has the same sections in English and Greek, each with text', () => {
    const en = torpedoRulesSheet('en');
    const el = torpedoRulesSheet('el');
    expect(en.length).toBe(4);
    expect(el.length).toBe(en.length);
    for (let i = 0; i < en.length; i++) expect(el[i].lines.length).toBe(en[i].lines.length);
    for (const section of [...en, ...el]) {
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.lines.length).toBeGreaterThan(0);
    }
  });

  it('Greek sections are really Greek, English ones are not', () => {
    const greek = /[Ͱ-Ͽ]/;
    for (const s of torpedoRulesSheet('el')) expect(greek.test(s.title + s.lines.join(' '))).toBe(true);
    for (const s of torpedoRulesSheet('en')) expect(greek.test(s.title + s.lines.join(' '))).toBe(false);
  });

  it('states the rule: one or two squares from any rank, en passant on every rank, a double step can promote, no jumping', () => {
    const en = torpedoRulesSheet('en').flatMap((s) => s.lines).join(' ');
    expect(en).toContain('ALWAYS move one or two squares');
    expect(en).toContain('from any rank');
    expect(en).toContain('never jumps over a piece');
    expect(en).toContain('en passant, on any rank');
    expect(en).toContain('4th or 5th rank');
    expect(en).toContain('reaches the last rank and promotes');
    const el = torpedoRulesSheet('el').flatMap((s) => s.lines).join(' ');
    expect(el).toContain('ΠΑΝΤΑ να προχωρήσει ένα ή δύο τετράγωνα');
    expect(el).toContain('δεν πηδάει ποτέ');
    expect(el).toContain('4η ή στην 5η σειρά');
  });
});
