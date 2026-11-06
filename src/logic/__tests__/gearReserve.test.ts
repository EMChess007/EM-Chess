import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GEAR_RESERVE } from '../../components/gearReserve';
import * as def from '../../../scripts/browser/android-matrix-def.mjs';

/** Command #34: the floating gear button's corner. The reserve is a literal here and at least the checks' zone plus the row's 8 dp gutter. */
describe('the floating gear button reserve', () => {
  it('is 80 dp: the zone the checks use (72) plus an 8 dp gutter', () => {
    expect(GEAR_RESERVE).toBe(80);
    expect(def.GEAR_ZONE.width + 8).toBeLessThanOrEqual(GEAR_RESERVE);
  });

  it('the Home title row and the Bughouse bar and first controls row use it', () => {
    const root = path.resolve(__dirname, '../../..');
    const home = readFileSync(path.join(root, 'src/screens/HomeScreen.tsx'), 'utf8');
    const bughouse = readFileSync(path.join(root, 'src/screens/BughouseGameScreen.tsx'), 'utf8');
    expect(home).toMatch(/paddingRight: GEAR_RESERVE/);
    expect(bughouse).toMatch(/compactBar:[^\n]*paddingRight: GEAR_RESERVE/);
    expect(bughouse).toMatch(/controlsUnderBar: [^\n]*paddingRight: GEAR_RESERVE - 8/);
  });
});
