import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backLink, goHome, homeTab, isHome, onTabs, readUntil } from '../../../scripts/android/lib/goHome.mjs';
import { jsThreadAtTap } from '../../../scripts/android/lib/settledTap.mjs';

/**
 * Command #66b (PR #50, slice small-screens-2; master run 44876385559, slice large-screens-1): toHome tapped the tab bar's "Home" and returned without looking; the tap did not take, and the
 * next scenarios failed with `cannot find {"text":"Play"}` on the More screen. Driven here with a fake phone (no device): every scenario starts from a VERIFIED Home.
 */
type Box = [number, number, number, number];
const node = (text: string, [x1, y1, x2, y2]: Box, id = '') => ({ text, desc: '', id, cls: 'android.widget.TextView', pkg: 'com.emchess.app', bounds: { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1, cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) } });
// the small profile's tab bar (720 x 1280 px): labels at y 1209 - 1248, as in the PR #50 log
const TAB_BAR = [node('Home', [54, 1209, 126, 1248]), node('Puzzles', [216, 1209, 324, 1248]), node('Analysis', [391, 1209, 509, 1248]), node('More', [594, 1209, 666, 1248])];
const HOME = [node('EM-Chess', [20, 60, 300, 120]), node('Play', [300, 288, 421, 362]), node('Daily Puzzle', [20, 420, 400, 480]), ...TAB_BAR];
const MORE = [node('View Achievements', [40, 100, 680, 160]), node('Dark mode', [40, 300, 680, 360]), node('Diagnostics', [272, 1003, 449, 1044]), ...TAB_BAR];
const ANALYSIS = [node('Analysis', [20, 60, 300, 120]), node('No games saved on this device yet.', [40, 600, 680, 660]), ...TAB_BAR];
const DIAGNOSTICS = [node('‹ Back', [20, 40, 140, 90]), node('Diagnostics', [200, 40, 520, 90]), node('[App] Startup session check: no session found', [20, 200, 700, 240])];
const PLAY_MENU = [node('‹ Menu', [20, 40, 140, 90]), node('Play', [200, 40, 520, 90]), node('Online', [20, 200, 700, 240])];
const SCREENS = { home: HOME, more: MORE, analysis: ANALYSIS, diagnostics: DIAGNOSTICS, playMenu: PLAY_MENU } as const;
type Screen = keyof typeof SCREENS;

/** A fake phone: the screen it shows, which taps it loses (by number, 1-based), what each control leads to. */
function phone(start: Screen, { lose = [] as number[], readable = true } = {}) {
  let t = 0;
  let screen: Screen = start;
  let taps = 0;
  let relaunches = 0;
  const tapped: string[] = [];
  const hit = (x: number, y: number) => SCREENS[screen].find((n) => x >= n.bounds.x1 && x < n.bounds.x2 && y >= n.bounds.y1 && y < n.bounds.y2) ?? null;
  const verbs = {
    current: async () => (readable ? SCREENS[screen] : Promise.reject(new Error('could not get idle state'))),
    read: async () => (readable ? SCREENS[screen] : Promise.reject(new Error('could not get idle state'))),
    tap: (x: number, y: number) => {
      taps++;
      const n = hit(x, y);
      tapped.push(n?.text ?? 'nothing');
      if (lose.includes(taps) || !n) return;
      if (n.text === 'Home' && n.bounds.y1 >= 1200) screen = 'home';
      else if (n.text === 'More' && n.bounds.y1 >= 1200) screen = 'more';
      else if (n.text === '‹ Back') screen = 'more';
      else if (n.text === '‹ Menu') screen = 'home';
    },
    relaunch: async () => {
      relaunches++;
      screen = 'home';
    },
    waitHome: async () => {
      if (!isHome(SCREENS[screen])) throw new Error('timed out waiting for the Home screen');
    },
    now: () => t,
    sleep: async (ms: number) => void (t += ms),
  };
  return { verbs, get screen() { return screen; }, get relaunches() { return relaunches; }, tapped, setReadable: (r: boolean) => void (readable = r) };
}

describe('isHome / onTabs / homeTab / backLink', () => {
  it('Home = the tab bar AND the Home screen Play button, no dialog; More, Analysis and the Play menu are not Home', () => {
    expect(isHome(HOME)).toBe(true);
    expect(isHome(MORE)).toBe(false);
    expect(isHome(ANALYSIS)).toBe(false);
    expect(isHome(PLAY_MENU)).toBe(false); // says "Play" but has no tab bar
    expect(isHome([...HOME, node('OK', [500, 700, 600, 760], 'button1')])).toBe(false);
    expect(isHome(null as unknown as never[])).toBe(false);
    expect(onTabs(MORE)).toBe(true);
    expect(onTabs(DIAGNOSTICS)).toBe(false);
  });
  it('the Home TAB is the lowest "Home"; the back link is the highest ‹ node', () => {
    expect(homeTab([node('Home', [0, 100, 50, 140]), ...TAB_BAR])?.bounds.y1).toBe(1209);
    expect(backLink(DIAGNOSTICS)?.text).toBe('‹ Back');
    expect(backLink(MORE)).toBeNull();
  });
});

describe('readUntil', () => {
  it('ends on the condition, and gives up after the budget with null (an unreadable tree is "not yet")', async () => {
    let t = 0;
    let n = 0;
    const sleep = async (ms: number) => void (t += ms);
    const read = async () => (++n < 3 ? Promise.reject(new Error('x')) : HOME);
    expect(await readUntil({ read, test: isHome, budgetMs: 10_000, now: () => t, sleep })).toBe(HOME);
    expect(await readUntil({ read: async () => MORE, test: isHome, budgetMs: 2000, now: () => t, sleep })).toBeNull();
  });
});

describe('goHome: a scenario starts only from a verified Home (command #66b)', () => {
  it('already Home: no touch at all', async () => {
    const p = phone('home');
    expect(await goHome(p.verbs)).toEqual({ how: 'already', tabTaps: 0, backTaps: 0 });
    expect(p.tapped).toEqual([]);
  });

  it('master run 44876385559: on More the first Home tab tap is lost - it is tapped again, and the call returns only on Home', async () => {
    const p = phone('more', { lose: [1] });
    const lost: number[] = [];
    const out = await goHome({ ...p.verbs, onTabLost: ({ node: n }) => void lost.push(n.bounds.cx) });
    expect(out).toEqual({ how: 'tab', tabTaps: 2, backTaps: 0 });
    expect(p.screen).toBe('home');
    expect(lost).toEqual([90]); // the evidence hook ran once, for the lost tap
    expect(p.relaunches).toBe(0);
  });

  it('PR #50: the evidence collector left the app on More -> Diagnostics; the next scenario start lands on Home (back, then the Home tab, the first one lost)', async () => {
    const p = phone('diagnostics', { lose: [2] });
    const out = await goHome(p.verbs);
    expect(p.tapped).toEqual(['‹ Back', 'Home', 'Home']);
    expect(out).toEqual({ how: 'tab', tabTaps: 2, backTaps: 1 });
    expect(p.screen).toBe('home');
    // what the next scenario's first step looks for is on the screen
    expect(isHome(await p.verbs.read())).toBe(true);
  });

  it('Analysis with every tab tap lost (PR #50, more-diagnostics): three tab taps, then the app is started afresh and Home is waited for', async () => {
    const p = phone('analysis', { lose: [1, 2, 3] });
    const out = await goHome(p.verbs);
    expect(out).toEqual({ how: 'relaunch', tabTaps: 3, backTaps: 0 });
    expect(p.relaunches).toBe(1);
    expect(p.screen).toBe('home');
  });

  it('never returns on the wrong screen: when Home does not come even after a fresh start, it THROWS', async () => {
    const p = phone('analysis', { lose: [1, 2, 3] });
    await expect(goHome({ ...p.verbs, relaunch: async () => {}, waitHome: async () => Promise.reject(new Error('timed out waiting for the Home screen')) })).rejects.toThrow('Home');
  });

  it('an unreadable screen (a game that keeps repainting) is left by a fresh start', async () => {
    const p = phone('more');
    p.setReadable(false);
    const out = await goHome({ ...p.verbs, waitHome: async () => {} });
    expect(out.how).toBe('relaunch');
    expect(p.tapped).toEqual([]);
  });

  it('a stack screen goes back with its own link (Play menu -> Home)', async () => {
    const p = phone('playMenu');
    expect(await goHome(p.verbs)).toEqual({ how: 'back', tabTaps: 0, backTaps: 1 });
  });
});

describe('jsThreadAtTap: was the JS thread busy when a tap was lost (command #66b evidence)', () => {
  const report = (now: number, lateMs: number, stalls: [number, number][] = []) => ({ state: { now, lateMs, stalls }, at: now });
  it('no monitor -> NO REPORTS; no report for more than 2 s -> JS SILENT', () => {
    expect(jsThreadAtTap({ before: null, after: null, tapAt: 0, nowMs: 0 }).verdict).toBe('NO REPORTS');
    expect(jsThreadAtTap({ before: null, after: report(1000, 0), tapAt: 1000, nowMs: 3001 }).verdict).toBe('JS SILENT');
    expect(jsThreadAtTap({ before: null, after: report(1000, 0), tapAt: 1000, nowMs: 3000 }).verdict).toBe('JS FREE');
  });
  it('more than half the span late, or a 1 s stall since the tap -> JS BUSY; otherwise JS FREE', () => {
    expect(jsThreadAtTap({ before: report(10_000, 100), after: report(12_000, 1101), tapAt: 10_500, nowMs: 12_000 }).verdict).toBe('JS BUSY');
    expect(jsThreadAtTap({ before: report(10_000, 100), after: report(12_000, 1100), tapAt: 10_500, nowMs: 12_000 }).verdict).toBe('JS FREE');
    expect(jsThreadAtTap({ before: null, after: report(12_000, 0, [[10_700, 1000]]), tapAt: 10_500, nowMs: 12_000 }).verdict).toBe('JS BUSY');
    expect(jsThreadAtTap({ before: null, after: report(12_000, 0, [[10_700, 999]]), tapAt: 10_500, nowMs: 12_000 }).verdict).toBe('JS FREE');
    // a stall long before the tap does not count
    expect(jsThreadAtTap({ before: null, after: report(12_000, 0, [[9_000, 5000]]), tapAt: 10_500, nowMs: 12_000 }).verdict).toBe('JS FREE');
  });
  it('says what it read', () => {
    const { text } = jsThreadAtTap({ before: report(10_000, 0), after: report(12_000, 200, [[10_600, 80]]), tapAt: 10_500, nowMs: 12_250 });
    expect(text).toBe('JS FREE: last perf report 250 ms ago, busy 10% of the 2000 ms around the tap, stalls >= 50 ms since the tap: 80 ms at +100 ms');
  });
});

describe('the driver is wired to it (source pins)', () => {
  const e2e = readFileSync(join(__dirname, '../../../scripts/android/e2e.mjs'), 'utf8');
  const device = readFileSync(join(__dirname, '../../../scripts/android/lib/device.mjs'), 'utf8');
  const body = (name: string) => e2e.slice(e2e.indexOf(`async function ${name}(`), e2e.indexOf('\n}\n', e2e.indexOf(`async function ${name}(`)));
  it('toHome goes through goHome (verified), not a tap-and-sleep return', () => {
    expect(body('toHome')).toContain('await goHome(');
    expect(body('toHome')).not.toMatch(/sleep\(700\);\s*return;/);
  });
  it('a failed scenario, the bot-silence and the Diagnostics-check evidence all return the app to a verified Home', () => {
    expect(body('scenario')).toMatch(/some\(\(r\) => !r\.ok\)\) await backHomeAfterFailure\(dev, name\)/);
    expect(body('botSilenceEvidence')).toContain('await backHomeAfterFailure(dev,');
    expect(body('diagnosticsCheckEvidence')).toContain('await backHomeAfterFailure(dev, what)');
    expect(body('backHomeAfterFailure')).toContain('await toHome(dev)');
  });
  it('a lost tap prints the JS-thread and window evidence', () => {
    expect(e2e).toContain('dev.onLostTap = (lost) => lostTapEvidence(dev, lost);');
    expect(body('lostTapEvidence')).toContain('jsThreadAtTap(');
    expect(device).toMatch(/if \(this\.onLostTap\) await Promise\.resolve\(this\.onLostTap\(\{ step, node, tapAt, perfBefore \}\)\)/);
  });
});
