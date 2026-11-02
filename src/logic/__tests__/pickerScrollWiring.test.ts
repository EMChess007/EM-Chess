import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * THE GAME CHIPS SCROLL WITH THE TIME CONTROLS (command #35b). The first android-e2e run after the 4 Player Variations were added to the online pickers failed on four steps: the chips (13 games + 4
 * seat games + Crazy Bughouse) sat ABOVE the picker's ScrollView, took two thirds of a 360 x 640 phone at font scale 1.3, left a sliver for the time controls, and a swipe that began on the
 * chips moved nothing - "Blitz 5 min" and "Daily 1 day" could not be reached. A screen that draws a chip row, a name field and a long list of controls puts ALL of it inside ONE scroll view.
 */
const ROOT = join(__dirname, '../../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');

/** The JSX between the first `<ScrollView` and the LAST `</ScrollView>` of a screen's source. */
function insideScrollView(source: string): string {
  const start = source.indexOf('<ScrollView');
  const end = source.lastIndexOf('</ScrollView>');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('the pickers that draw a chip row scroll as one page', () => {
  for (const path of ['src/screens/OnlineTimeControlSelectScreen.tsx', 'src/screens/ChallengeScreen.tsx', 'src/screens/TournamentScreen.tsx']) {
    it(`${path}: the variant chips and the time controls are inside the same scroll view`, () => {
      const source = read(path);
      const inside = insideScrollView(source);
      expect(inside).toContain('<VariantSelector');
      expect(inside).toContain('<TimeControlSections');
    });
  }

  it('the Tournament create form scrolls whole: its name field is inside the scroll view too', () => {
    const inside = insideScrollView(read('src/screens/TournamentScreen.tsx'));
    expect(inside).toContain('Tournament name');
    expect(inside).toContain('<TextInput');
  });
});
