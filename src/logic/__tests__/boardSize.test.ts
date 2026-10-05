import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SPELL_BAR_HEIGHT, SPELL_BAR_MARGIN_TOP, SPELL_BAR_RESERVED_HEIGHT, getBoardSize } from '../../components/boardSize';

describe('getBoardSize', () => {
  it('is height-bound on a short phone, and the Spell Chess row makes the board smaller there', () => {
    // 390x760: the layout where the Spell Chess bottom player row was clipped (measured in the browser).
    const plain = getBoardSize(390, 760);
    const spell = getBoardSize(390, 760, SPELL_BAR_RESERVED_HEIGHT);
    expect(plain).toBe(304);
    expect(spell).toBeLessThan(plain);
    // The board gives up at least the row's height (rounded to whole squares), so the row fits where the board was.
    expect(plain - spell).toBeGreaterThanOrEqual(SPELL_BAR_RESERVED_HEIGHT - 8);
  });

  it('leaves a width-bound (tall) phone alone — there is room for the row already', () => {
    expect(getBoardSize(412, 915, SPELL_BAR_RESERVED_HEIGHT)).toBe(getBoardSize(412, 915));
  });

  it('never goes below the minimum square size, and the default reserves nothing extra', () => {
    expect(getBoardSize(360, 300, SPELL_BAR_RESERVED_HEIGHT)).toBe(24 * 8);
    expect(getBoardSize(390, 760, 0)).toBe(getBoardSize(390, 760));
    expect(getBoardSize(390)).toBe(getBoardSize(390, undefined, SPELL_BAR_RESERVED_HEIGHT));
  });

  it('the reserved height is exactly the row\'s margin plus its fixed height', () => {
    expect(SPELL_BAR_RESERVED_HEIGHT).toBe(SPELL_BAR_MARGIN_TOP + SPELL_BAR_HEIGHT);
  });
});

describe('Spell Chess layout wiring (no React Native renderer available)', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '../../', rel), 'utf8').replace(/\r\n/g, '\n');

  it('ChessBoard reserves the row when it renders it, and the row cannot grow past what was reserved', () => {
    const board = read('components/ChessBoard.tsx');
    expect(board).toContain('getBoardSize(width, height, spellChess && spellState ? SPELL_BAR_RESERVED_HEIGHT : 0)');
    expect(board).toContain('height: SPELL_BAR_HEIGHT,');
    expect(board).toContain("flexWrap: 'nowrap',");
    expect(board).toContain('marginTop: SPELL_BAR_MARGIN_TOP,');
    expect(board).toContain('<Text style={styles.spellHint} numberOfLines={1}>');
  });

  it('every screen that shows an opening name hides it for Spell Chess (opening names do not apply with spells)', () => {
    for (const screen of ['BotGameScreen', 'LocalGameScreen']) {
      const src = read(`screens/${screen}.tsx`);
      expect(src, screen).toContain('!duckChess && !spellChess && openingName');
      expect(src, screen).toContain('duckChess || spellChess) return;');
    }
    expect(read('screens/OnlineGameScreen.tsx')).toContain('!duckChess && !spellChess && openingName');
  });
});
