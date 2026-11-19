import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The result card must be on the visible screen when a game ends (command #33): on the phone "Team 2 wins" arrived BELOW the visible screen and the player had to scroll to find it. Every game
 * screen whose result card joins a scrolling body scrolls to its end as soon as the card is there; the 2-player screens show theirs in a Modal (PostGameSummaryModal) and need nothing. A source
 * pin like the others of this folder (the rendered screens have no layout in jsdom); the phone's check is in scripts/android/e2e.mjs ("the result card ... is cut off / not on the screen").
 */
const root = join(__dirname, '..', '..', '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

describe('the result card is brought into view', () => {
  it('GameScreenBody scrolls to its end when a result is shown and its content changes size', () => {
    const body = read('src/components/GameScreenBody.tsx');
    expect(body).toMatch(/resultShown\?: boolean/);
    expect(body).toMatch(/if \(resultShown\) scrollRef\.current\?\.scrollToEnd\(\{ animated: false \}\)/);
  });

  it.each([
    ['src/screens/FourPlayerGameScreen.tsx', /resultShown=\{!!game\.result\}/],
    ['src/screens/FourPlayerOnlineGameScreen.tsx', /resultShown=\{!!view\.gameOver\}/],
    ['src/screens/FourPlayerSpectatorScreen.tsx', /resultShown=\{!!view\.gameOver\}/],
  ])('%s tells the body when its result card is there (4 Player Chess, Giveaway and Chaturaji)', (file, pattern) => {
    expect(read(file)).toMatch(pattern);
  });

  it('the Bughouse screen (Local and Online, one component) scrolls to the card when the content grows with a result', () => {
    const screen = read('src/screens/BughouseGameScreen.tsx');
    expect(screen).toMatch(/ref=\{scrollRef\}/);
    expect(screen).toMatch(/if \(summary !== null\) scrollRef\.current\?\.scrollToEnd\(\{ animated: false \}\)/);
  });

  it('the Bughouse screen ALSO scrolls when the card appears, when it is laid out and on retries (command #47: the size event alone left it below the fold on a fast phone)', () => {
    const screen = read('src/screens/BughouseGameScreen.tsx');
    expect(screen).toMatch(/RESULT_SCROLL_RETRY_MS: readonly number\[\] = \[50, 250, 700, 1500\]/);
    expect(screen).toMatch(/testID="game-over" onLayout=\{\(\) => scrollRef\.current\?\.scrollToEnd\(\{ animated: false \}\)\}/);
  });

  it('the 2-player screens end a game with the summary Modal, not a card under the board', () => {
    for (const file of ['src/screens/BotGameScreen.tsx', 'src/screens/LocalGameScreen.tsx', 'src/screens/OnlineGameScreen.tsx']) expect(read(file), file).toContain('<PostGameSummaryModal');
  });
});
