import { describe, expect, it } from 'vitest';
import { knightmateLegend, knightmateRulesSheet } from '../knightmateRules';

describe('Knightmate rules sheet', () => {
  it('has the same sections in English and Greek, each with text', () => {
    const en = knightmateRulesSheet('en');
    const el = knightmateRulesSheet('el');
    expect(en.length).toBe(5);
    expect(el.length).toBe(en.length);
    for (let i = 0; i < en.length; i++) expect(el[i].lines.length).toBe(en[i].lines.length);
    for (const section of [...en, ...el]) {
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.lines.length).toBeGreaterThan(0);
    }
  });

  it('Greek sections are really Greek, English ones are not', () => {
    const greek = /[Ͱ-Ͽ]/;
    for (const s of knightmateRulesSheet('el')) expect(greek.test(s.title + s.lines.join(' '))).toBe(true);
    for (const s of knightmateRulesSheet('en')) expect(greek.test(s.title + s.lines.join(' '))).toBe(false);
  });

  it('states the rules: the knight is royal, the Commoner is not, castling, promotion q/r/b/Commoner (never a knight), the bare-royal-knight draw and the clock exception', () => {
    const en = knightmateRulesSheet('en').flatMap((s) => s.lines).join(' ');
    expect(en).toContain('The KNIGHT is the royal piece');
    expect(en).toContain('two Commoners, on b1 / g1');
    expect(en).toContain('it is NOT royal');
    expect(en).toContain('a queen, a rook, a bishop or a Commoner — never to a knight');
    expect(en).toContain('onto the c- or g-file');
    expect(en).toContain('only becomes possible once they have moved away');
    expect(en).toContain('only when both sides have nothing left but their royal knight');
    expect(en).toContain('unless your opponent has only a royal knight left');
    const el = knightmateRulesSheet('el').flatMap((s) => s.lines).join(' ');
    expect(el).toContain('Το ΑΛΟΓΟ είναι το βασιλικό κομμάτι');
    expect(el).toContain('ΔΕΝ είναι βασιλικός');
    expect(el).toContain('ποτέ σε άλογο');
    expect(el).toContain('μόνο όταν και οι δύο πλευρές έχουν μόνο το βασιλικό τους άλογο');
  });

  it('the legend explains the crown (royal knight), the "M" (Commoner) and the notation K / M / =M, in both languages', () => {
    for (const lang of ['en', 'el'] as const) {
      const legend = knightmateLegend(lang);
      expect(legend.map((e) => e.kind)).toEqual(['royal', 'commoner', 'notation']);
      for (const entry of legend) {
        expect(entry.title.length).toBeGreaterThan(0);
        expect(entry.text.length).toBeGreaterThan(0);
      }
    }
    const en = knightmateLegend('en');
    expect(en[0].title).toBe('Crown = royal knight');
    expect(en[0].text).toContain('Notation: K (for example Kf3)');
    expect(en[1].title).toBe('“M” = Commoner');
    expect(en[1].text).toContain('Notation: M (for example Mb2)');
    expect(en[2].title).toBe('Notation: K / M / =M');
    expect(en[2].text).toContain('=M when a pawn promotes to a Commoner (for example axb8=M)');
    expect(en[2].text).toContain('N never appears');
    const el = knightmateLegend('el');
    expect(el[0].title).toBe('Στέμμα = βασιλικό άλογο');
    expect(el[1].title).toBe('«M» = Commoner');
    expect(el[2].title).toBe('Σημειογραφία: K / M / =M');
    expect(el[2].text).toContain('=M όταν ένα πιόνι προάγεται σε Commoner (π.χ. axb8=M)');
  });
});
