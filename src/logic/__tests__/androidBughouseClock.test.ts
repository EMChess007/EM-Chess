import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXTRA_SCREENS, BUGHOUSE_GAME_CLOCK } from '../../../scripts/browser/android-matrix-screens-extra.mjs';
import { gameAgeS } from '../../../scripts/android/lib/checks.mjs';
import { TIME_CONTROLS } from '../timeControls';

/**
 * Command #67c (PR #51 head 051bad8, job 136831520378, "screen bughouse-game-passplay"): "3 min" was tapped at 11:43:15 and the screen judged at 11:46:30 = 195 s later; the 3-minute game had
 * ended (board B's bots had played 193 moves, "Rematch" on the screen) and the message said "13 s after the game started". The judged Bughouse games now start on the LONGEST clock the picker
 * offers, their pieces are judged first, and the age is counted from the time-control tap.
 */
const JUDGED = ['bughouse-game-single', 'bughouse-game-passplay', 'bughouse-game-dual'];
const e2e = readFileSync(join(__dirname, '../../../scripts/android/e2e.mjs'), 'utf8');

describe('the judged Bughouse games never race their clock', () => {
  it('start on "14 days", the longest clock the picker offers (literal, then compared with the one list)', () => {
    expect(BUGHOUSE_GAME_CLOCK).toBe('14 days');
    const timed = TIME_CONTROLS.filter((tc) => tc.initialSeconds > 0);
    const longest = timed.reduce((a, b) => (b.initialSeconds > a.initialSeconds ? b : a));
    expect(longest.label).toBe(BUGHOUSE_GAME_CLOCK);
    for (const id of JUDGED) {
      const s = EXTRA_SCREENS.find((x: { id: string }) => x.id === id);
      if (!s) throw new Error(`${id} is not in EXTRA_SCREENS`);
      expect(s.steps[s.steps.length - 1], id).toEqual({ text: '14 days' });
      expect(JSON.stringify(s.steps), id).not.toContain('3 min');
    }
  });
  it('the game age counts from the time-control tap: 195 s, not the 13 s since the steps returned', () => {
    const tap = 1_000_000;
    expect(gameAgeS({ tappedAt: tap, fallbackAt: tap + 182_000, now: tap + 195_000 })).toBe(195);
    expect(gameAgeS({ tappedAt: null, fallbackAt: tap + 182_000, now: tap + 195_000 })).toBe(13); // no tap recorded: the old measure, never NaN
    expect(gameAgeS({ tappedAt: tap, fallbackAt: tap, now: tap - 5 })).toBe(0);
  });
  it('wiring: the screen check takes the age from dev.lastAppTapAt and judges the pieces BEFORE it reads the tree for the text checks', () => {
    const screens = e2e.slice(e2e.indexOf('async function screens(dev)'), e2e.indexOf('// --- the text-fit probe'));
    expect(screens).toContain('dev.lastAppTapAt = null;');
    expect(screens).toContain('const tappedAt = dev.lastAppTapAt;');
    expect(screens).toContain('gameAgeS({ tappedAt, fallbackAt: stepsDoneAt, now: judgedAt })');
    const judge = screens.indexOf('verdict = await judgeGamePieces(dev, s);');
    const dump = screens.indexOf('await dev.dump()');
    expect(judge).toBeGreaterThan(0);
    expect(dump).toBeGreaterThan(judge);
    const device = readFileSync(join(__dirname, '../../../scripts/android/lib/device.mjs'), 'utf8');
    expect(device).toMatch(/this\.tap\(x, y\);\s*\n\s*this\.lastAppTapAt = Date\.now\(\);/);
  });
});
