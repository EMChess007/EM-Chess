import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Command #64: AppPressable floors every button at 44 x 44 dp. The Crazyhouse pocket chips were designed 32 dp tall (and 30 wide), so on a phone they
// were 44 tall inside a 32 row (poking out) and ~39 wide (a touch target under 44). The row now has the room, and the Spell Chess Freeze/Jump row
// (whose buttons are not chips in a row of their own: they are padded text) stays 32 dp and fits at 320 dp (browser device matrix, game-spell-bar).
describe('Crazyhouse pocket chips are 44 dp targets that fit their row', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '../../', rel), 'utf8').replace(/\r\n/g, '\n');

  it('the row height, the chip height and the chip minimum width are literal 44 (the touch floor)', () => {
    const tray = read('components/ReserveTray.tsx');
    expect(tray).toContain('export const RESERVE_TRAY_HEIGHT = 44;');
    expect(tray).toMatch(/chip: \{\s*height: RESERVE_TRAY_HEIGHT,\s*minWidth: 44,/);
    expect(read('components/AppPressable.tsx')).toContain('export const MIN_TOUCH_TARGET = 44;');
  });

  it('the row never wraps and keeps its fixed height (the layout around the board stays deterministic)', () => {
    expect(read('components/ReserveTray.tsx')).toMatch(/row: \{\s*marginTop: RESERVE_TRAY_MARGIN_TOP,\s*height: RESERVE_TRAY_HEIGHT,\s*flexDirection: 'row',\s*flexWrap: 'nowrap',/);
  });
});
