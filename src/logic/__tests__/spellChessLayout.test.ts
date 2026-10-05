import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getBoardSize } from '../../components/boardSize';

// Spell Chess draws a Freeze/Jump row under the board (inside ChessBoard). It used to overflow GameScreenBody's
// non-scrolling, overflow-hidden content area and clip the bottom clock row. The fix must NOT shrink the board — the
// board is the same size in every variant — so the room comes from tighter spacing (GameScreenBody's `compact`).
describe('the board is the same size in Spell Chess as in Classic', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '../../', rel), 'utf8').replace(/\r\n/g, '\n');

  it('getBoardSize still depends on the viewport alone (checked at the sizes the layout was measured at)', () => {
    expect(getBoardSize(390, 760)).toBe(304);
    expect(getBoardSize(412, 915)).toBe(376);
    expect(getBoardSize(360, 640)).toBe(24 * 8); // the minimum square size
    expect(getBoardSize(390)).toBe(getBoardSize(390, undefined));
  });

  it('boardSize.ts knows nothing about Spell Chess, and ChessBoard sizes itself with the plain two-argument call', () => {
    expect(read('components/boardSize.ts')).not.toMatch(/spell/i);
    const board = read('components/ChessBoard.tsx');
    expect(board).toContain('const boardSize = getBoardSize(width, height);');
    expect(board).not.toMatch(/getBoardSize\([^)]*spell/i);
  });
});

describe('the room for the Freeze/Jump row comes from tighter spacing, not from the board', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '../../', rel), 'utf8').replace(/\r\n/g, '\n');

  it('GameScreenBody has a compact mode with tighter gaps, and its content area stays non-scrolling', () => {
    const body = read('components/GameScreenBody.tsx');
    expect(body).toContain('compact?: boolean;');
    expect(body).toContain('compact && styles.contentCompact');
    expect(body).toMatch(/contentCompact: \{\s*gap: 3,\s*paddingVertical: 3,/);
    expect(body).toContain("overflow: 'hidden'"); // still clipped, never a ScrollView (it would fight the board's drag gestures)
    expect(body).not.toMatch(/<ScrollView|import[^;]*ScrollView/);
  });

  it('every screen that can show a Spell Chess board passes compact for it', () => {
    expect(read('screens/BotGameScreen.tsx')).toContain('compact={spellChess}');
    expect(read('screens/LocalGameScreen.tsx')).toContain('compact={spellChess}');
    expect(read('screens/OnlineGameScreen.tsx')).toContain('compact={spellChess}');
    expect(read('screens/SpectatorGameScreen.tsx')).toContain('compact={state.isSpellChess}');
  });

  it('the Freeze/Jump row has a fixed height and never wraps, so the layout around it is deterministic', () => {
    const board = read('components/ChessBoard.tsx');
    expect(board).toContain('const SPELL_BAR_HEIGHT = 32;');
    expect(board).toMatch(/spellBar: \{[^}]*height: SPELL_BAR_HEIGHT,[^}]*flexWrap: 'nowrap',/);
    expect(board).toContain('<Text style={styles.spellHint} numberOfLines={1}>');
  });

  it('Bot and Local hide the opening name for Spell Chess, as Online does (opening names do not apply with spells)', () => {
    for (const screen of ['BotGameScreen', 'LocalGameScreen']) {
      const src = read(`screens/${screen}.tsx`);
      expect(src, screen).toContain('!duckChess && !spellChess && !horde && openingName');
      expect(src, screen).toContain('duckChess || spellChess || horde) return;');
    }
    expect(read('screens/OnlineGameScreen.tsx')).toContain('!duckChess && !spellChess && !horde && openingName');
  });
});

describe('Freeze zone preview while picking the center (no React Native renderer available)', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '../../', rel), 'utf8').replace(/\r\n/g, '\n');

  it('ChessBoard highlights the pending cast\'s zone — and only while a Freeze is pending, so cancelling or playing the move clears it', () => {
    const board = read('components/ChessBoard.tsx');
    // pendingFreezeZone is null unless pendingCast is a freeze; both finishRegularMove and the cancel chip reset pendingCast.
    expect(board).toContain("const pendingFreezeZone = pendingCast?.type === 'freeze' ? pendingCast.squares : null;");
    expect(board).toContain('isPendingFreeze={spellChess && pendingFreezeZone !== null && pendingFreezeZone.includes(square.square)}');
    expect(board).toMatch(/finishRegularMove[\s\S]*?setPendingCast\(null\)/);
    expect(board).toContain('onPress={() => setPendingCast(null)}');
  });

  it('"about to freeze" is drawn differently from "frozen now" (an outline + tint, composing with the solid fill)', () => {
    const square = read('components/Square.tsx');
    expect(square).toContain('isPendingFreeze && styles.pendingFreeze');
    expect(square).toMatch(/pendingFreeze: \{[^}]*borderWidth: 2,[^}]*borderColor: '#0288d1'/);
    expect(square.indexOf('isPendingFreeze && styles.pendingFreeze')).toBeLessThan(square.indexOf('isFrozen && styles.frozen')); // the frozen fill wins on overlap, the outline stays
  });
});

describe('Bot rating guard documentation', () => {
  it('records that Spell Chess was deliberately left OUT of the rating exclusion, so it is not "fixed" again as an oversight', () => {
    const bot = readFileSync(join(__dirname, '../../screens/BotGameScreen.tsx'), 'utf8').replace(/\r\n/g, '\n');
    expect(bot).toContain('Spell Chess was deliberately');
    expect(bot).toContain('do not add !spellChess here');
    // ...and the guard itself is unchanged.
    expect(bot).toContain('if (ratingCategory && !giveaway && !atomic && !duckChess && !horde) recordRatedGame(');
  });
});
