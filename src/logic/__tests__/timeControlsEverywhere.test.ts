import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUGHOUSE_TIME_CONTROLS, bughouseControlLabel, validateBugTimeControl } from '../bughouse';
import { bughouseTimeControlOf } from '../bughouseLayout';
import { validateFourTimeControl } from '../fourPlayerWire';
import { ONLINE_DAILY_NOTE, TIME_CONTROLS, TIME_CONTROL_CATEGORIES } from '../timeControls';

/**
 * EVERY TIME CONTROL IN EVERY MODE (command #35, PART B). The canonical set is the one of the Bots "Select Time Control" screen; there is ONE definition (`TIME_CONTROLS`, logic/timeControls.ts) and ONE
 * component that draws it (`TimeControlSections`). This file pins the set as literals and scans every screen that picks a control: none has a list, a filter or an exclusion of its own, and every
 * validator that a server shares with the app accepts every control of the list (the backend's own validators are tested in its suites: `npm run test:unlimited`, `test:fourplayerMatchmaking`,
 * `test:bughouseMatchmaking`, `test:bughouseFriendRooms` and the real-socket cases of `test:timeControlsEverywhere`).
 */
const ROOT = join(__dirname, '../../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');

const CANONICAL: Array<[id: string, label: string, initialSeconds: number, incrementSeconds: number, category: string]> = [
  ['unlimited', 'No time limit', 0, 0, 'unlimited'],
  ['bullet-1', '1 min', 60, 0, 'bullet'],
  ['bullet-1-1', '1 | 1', 60, 1, 'bullet'],
  ['bullet-2-1', '2 | 1', 120, 1, 'bullet'],
  ['blitz-3', '3 min', 180, 0, 'blitz'],
  ['blitz-3-2', '3 | 2', 180, 2, 'blitz'],
  ['blitz-5', '5 min', 300, 0, 'blitz'],
  ['blitz-5-5', '5 | 5', 300, 5, 'blitz'],
  ['blitz-5-2', '5 | 2', 300, 2, 'blitz'],
  ['rapid-10', '10 min', 600, 0, 'rapid'],
  ['rapid-15-10', '15 | 10', 900, 10, 'rapid'],
  ['rapid-30', '30 min', 1800, 0, 'rapid'],
  ['rapid-10-5', '10 | 5', 600, 5, 'rapid'],
  ['rapid-20', '20 min', 1200, 0, 'rapid'],
  ['rapid-60', '60 min', 3600, 0, 'rapid'],
  ['daily-1', '1 day', 86400, 0, 'daily'],
  ['daily-2', '2 days', 172800, 0, 'daily'],
  ['daily-3', '3 days', 259200, 0, 'daily'],
  ['daily-5', '5 days', 432000, 0, 'daily'],
  ['daily-7', '7 days', 604800, 0, 'daily'],
  ['daily-14', '14 days', 1209600, 0, 'daily'],
];

describe('the one list', () => {
  it('is the Bots screen\'s: Bullet 1, 1 | 1, 2 | 1; Blitz 3, 3 | 2, 5, 5 | 5, 5 | 2; Rapid 10, 15 | 10, 30, 10 | 5, 20, 60; Daily 1, 2, 3, 5, 7, 14 days; No time limit (21 presets)', () => {
    expect(TIME_CONTROLS.map((tc) => [tc.id, tc.label, tc.initialSeconds, tc.incrementSeconds, tc.category])).toEqual(CANONICAL);
    expect(TIME_CONTROL_CATEGORIES.map((c) => c.label)).toEqual(['Bullet', 'Blitz', 'Rapid', 'Daily', 'No time limit']);
  });

  it('the online Daily note says how a Daily game is kept', () => {
    expect(ONLINE_DAILY_NOTE).toBe('A Daily game is kept while the server runs; an app update on the server can end it.');
  });
});

describe('every screen that picks a control renders the one list', () => {
  const pickers = ['src/screens/TimeControlSelectScreen.tsx', 'src/screens/OnlineTimeControlSelectScreen.tsx', 'src/screens/ChallengeScreen.tsx', 'src/screens/TournamentScreen.tsx'];

  it.each(pickers)('%s renders <TimeControlSections> and has no list or filter of its own', (file) => {
    const source = read(file);
    expect(source).toContain('<TimeControlSections');
    for (const forbidden of ['excludeCategories', 'onlyIds', 'getTimeControlsByCategory', "category: 'bullet'", "category: 'blitz'", "category: 'rapid'", 'TIME_CONTROLS']) {
      expect(source, `${file} must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('only the shared component reads the list of categories; no other screen or component does', () => {
    const files = [...readdirSync(join(ROOT, 'src/screens')).map((f) => `src/screens/${f}`), ...readdirSync(join(ROOT, 'src/components')).map((f) => `src/components/${f}`), 'App.tsx'].filter((f) => /\.tsx$/.test(f));
    const readers = files.filter((f) => /TIME_CONTROL_CATEGORIES|getTimeControlsByCategory/.test(read(f)));
    expect(readers).toEqual(['src/components/TimeControlSections.tsx']);
  });

  it('App.tsx leaves nothing out for any mode: no exclusion, no id filter, every step is a TimeControlSelectScreen', () => {
    const app = read('App.tsx');
    expect(app).not.toContain('excludeCategories');
    expect(app).not.toContain('onlyIds');
    expect(app).not.toContain('BUGHOUSE_TIME_CONTROL_IDS');
    // Bots + Local + Engine vs Engine (one step), 4-seat local and Crazy Bughouse local: three LOCAL steps in App. Everything online picks its control on the Online card's own screens: Quick Match
    // (every game, the 4 Player Variations too), Challenge a Friend, Tournaments - the old per-game online steps are gone (command #35).
    expect((app.match(/<TimeControlSelectScreen/g) ?? []).length).toBe(3);
    for (const gone of ['fourPlayerOnlineTimeControl', 'bughouseOnlineTimeControl', 'bughouseRoomTimeControl']) expect(app, gone).not.toContain(gone);
  });

  it('the online pickers show the Daily note, the local ones do not', () => {
    for (const screen of ['OnlineTimeControlSelectScreen', 'ChallengeScreen', 'TournamentScreen']) expect(read(`src/screens/${screen}.tsx`)).toContain('ONLINE_DAILY_NOTE');
    expect(read('App.tsx')).not.toContain('dailyNote');
  });
});

describe('the validators the app shares with the servers accept every control of the list', () => {
  it('the 4-seat wire validator (4 Player Chess, 4 Player Giveaway, Chaturaji)', () => {
    for (const tc of TIME_CONTROLS) expect(validateFourTimeControl({ initialSeconds: tc.initialSeconds, incrementSeconds: tc.incrementSeconds }).ok, tc.id).toBe(true);
  });

  it('the Crazy Bughouse wire validator, through the app\'s own conversion to milliseconds', () => {
    for (const tc of TIME_CONTROLS) {
      const ms = bughouseTimeControlOf(tc);
      expect(validateBugTimeControl(ms), tc.id).toEqual({ ok: true, value: ms });
    }
  });

  it('the engine\'s list is exactly the app\'s list in milliseconds (as sets), and its labels are the app\'s labels', () => {
    const key = (initial: number, increment: number) => `${initial}|${increment}`;
    expect(new Set(BUGHOUSE_TIME_CONTROLS.map((tc) => key(tc.initialMs, tc.incrementMs)))).toEqual(new Set(TIME_CONTROLS.map((tc) => key(tc.initialSeconds * 1000, tc.incrementSeconds * 1000))));
    expect(BUGHOUSE_TIME_CONTROLS).toHaveLength(TIME_CONTROLS.length);
    for (const tc of TIME_CONTROLS) expect(bughouseControlLabel(bughouseTimeControlOf(tc)), tc.id).toBe(tc.label);
  });
});
