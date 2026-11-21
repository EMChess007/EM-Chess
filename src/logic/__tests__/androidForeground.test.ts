import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bringToFrontCommand, foregroundState, resumedPackages } from '../../../scripts/android/lib/foreground.mjs';
import { goHome, isHome } from '../../../scripts/android/lib/goHome.mjs';
import { gameOverShown } from '../../../scripts/android/lib/checks.mjs';

/**
 * Command #67b (PR #51 head 6e6980f, job 136821419780, slice small-screens-2). (1) After "screen more-diagnostics" the launcher held the focus (mCurrentFocus = NexusLauncherActivity) and the three
 * toHome "Home" tab taps went to the Android home screen; the driver now asks which activity is RESUMED and brings the app's own task back first. (2) "bughouse-game-single" was photographed
 * 196 s into a 3-minute game: a FINISHED game (result card, "Rematch") is never judged as a piece check.
 */
const PKG = 'com.emchess.app';
// the lines as the run printed them
const APP_RESUMED = '  topResumedActivity=ActivityRecord{c7899bc u0 com.emchess.app/.MainActivity t10}\n    mResumedActivity: ActivityRecord{c7899bc u0 com.emchess.app/.MainActivity t10}';
const LAUNCHER_RESUMED = '  topResumedActivity=ActivityRecord{4498c3c u0 com.google.android.apps.nexuslauncher/.NexusLauncherActivity t7}';
const DIALOG_RESUMED = '  topResumedActivity=ActivityRecord{1a2b3c u0 com.google.android.permissioncontroller/.GrantPermissionsActivity t12}';

describe('foregroundState', () => {
  it('reads the resumed package from the dumpsys lines of the run', () => {
    expect(resumedPackages(APP_RESUMED)).toEqual(['com.emchess.app', 'com.emchess.app']);
    expect(resumedPackages(LAUNCHER_RESUMED)).toEqual(['com.google.android.apps.nexuslauncher']);
  });
  it('the app resumed = front; the launcher resumed = background; a system permission prompt = front; nothing readable = unknown (never acted on)', () => {
    expect(foregroundState(APP_RESUMED, PKG)).toEqual({ state: 'front', resumed: 'com.emchess.app' });
    expect(foregroundState(LAUNCHER_RESUMED, PKG)).toEqual({ state: 'background', resumed: 'com.google.android.apps.nexuslauncher' });
    expect(foregroundState(DIALOG_RESUMED, PKG).state).toBe('front');
    expect(foregroundState('', PKG)).toEqual({ state: 'unknown', resumed: null });
    expect(foregroundState(undefined, PKG).state).toBe('unknown');
  });
  it('brings the EXISTING task to the front with the launcher intent (no force-stop, no new process)', () => {
    expect(bringToFrontCommand(PKG)).toBe('am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n com.emchess.app/.MainActivity');
    expect(bringToFrontCommand(PKG)).not.toMatch(/force-stop|pm clear/);
  });
});

type Box = [number, number, number, number];
const node = (text: string, [x1, y1, x2, y2]: Box, id = '') => ({ text, desc: '', id, cls: 'android.widget.TextView', pkg: PKG, bounds: { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1, cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) } });
const TAB_BAR = [node('Home', [54, 1209, 126, 1248]), node('Puzzles', [216, 1209, 324, 1248]), node('Analysis', [391, 1209, 509, 1248]), node('More', [594, 1209, 666, 1248])];
const HOME = [node('EM-Chess', [20, 60, 300, 120]), node('Play', [300, 288, 421, 362]), ...TAB_BAR];
const MORE = [node('View Achievements', [40, 100, 680, 160]), node('Diagnostics', [272, 1003, 449, 1044]), ...TAB_BAR];
const DIAGNOSTICS = [node('‹ Back', [42, 108, 162, 150]), node('Diagnostic Log', [200, 108, 520, 150])];

describe('goHome with the app in the background (the launcher focused)', () => {
  it('brings the app back WITHOUT tab taps when its task was on Home, and says so', async () => {
    let t = 0;
    let front = false;
    const taps: string[] = [];
    const logs: string[] = [];
    const out = await goHome({
      current: async () => HOME, // uiautomator still showed the app's last frame while the launcher had the focus (the run's trees had the tab bar)
      read: async () => HOME,
      tap: (x: number, y: number) => void taps.push(`${x},${y}`),
      ensureApp: async () => {
        if (front) return false;
        front = true;
        return true;
      },
      relaunch: async () => {
        throw new Error('no relaunch expected');
      },
      waitHome: async () => {},
      now: () => t,
      sleep: async (ms: number) => void (t += ms),
      log: (m: string) => void logs.push(m),
    });
    expect(out).toEqual({ how: 'front', tabTaps: 0, backTaps: 0, broughtBack: 1 });
    expect(taps).toEqual([]);
    expect(logs.some((l) => l.includes('the app was in the background'))).toBe(true);
  });
  it('brought back onto More, it then taps the Home tab ONCE (the tap reaches the app, not the launcher)', async () => {
    let t = 0;
    let screen = MORE;
    let front = false;
    const taps: string[] = [];
    const out = await goHome({
      current: async () => screen,
      read: async () => screen,
      tap: (x: number, y: number) => {
        taps.push(`${x},${y}`);
        if (!front) return; // a tab tap with the launcher focused is lost (the run)
        if (y >= 1200 && x < 130) screen = HOME;
      },
      ensureApp: async () => (front ? false : ((front = true), true)),
      relaunch: async () => {
        throw new Error('no relaunch expected');
      },
      waitHome: async () => {},
      now: () => t,
      sleep: async (ms: number) => void (t += ms),
    });
    expect(out).toEqual({ how: 'tab', tabTaps: 1, backTaps: 0, broughtBack: 1 });
    expect(taps).toEqual(['90,1229']);
    expect(isHome(screen)).toBe(true);
  });
  it('a bring-to-front that never holds is bounded: after frontTries it falls back to starting the app afresh', async () => {
    let t = 0;
    let relaunched = 0;
    const out = await goHome({
      current: async () => MORE,
      read: async () => MORE,
      tap: () => {},
      ensureApp: async () => true,
      relaunch: async () => void relaunched++,
      waitHome: async () => {},
      now: () => t,
      sleep: async (ms: number) => void (t += ms),
      tabTries: 1,
      tabBudgetMs: 1000,
    });
    expect(out.broughtBack).toBe(2);
    expect(out.how).toBe('relaunch');
    expect(relaunched).toBe(1);
  });
});

describe('goHome taps a back link ONCE while its screen is still leaving (the run tapped "‹ Back" twice, 10:59:53 and 10:59:59)', () => {
  it('Diagnostics answers its "‹ Back" late (two more reads of its last frame): one back tap, then the Home tab', async () => {
    let t = 0;
    let screen = DIAGNOSTICS;
    let staleReads = 0;
    const taps: string[] = [];
    const read = async () => {
      if (staleReads > 0) {
        staleReads--;
        return DIAGNOSTICS;
      }
      return screen;
    };
    const out = await goHome({
      current: read,
      read,
      tap: (x: number, y: number) => {
        taps.push(`${x},${y}`);
        if (screen === DIAGNOSTICS && y < 200) {
          screen = MORE;
          staleReads = 2;
        } else if (y >= 1200 && x < 130) screen = HOME;
      },
      relaunch: async () => {
        throw new Error('no relaunch expected');
      },
      waitHome: async () => {},
      now: () => t,
      sleep: async (ms: number) => void (t += ms),
    });
    expect(taps).toEqual(['102,129', '90,1229']);
    expect(out).toEqual({ how: 'tab', tabTaps: 1, backTaps: 1, broughtBack: 0 });
  });
  it('a back link that never answers is tapped again only after the budget (at most backTries), then the app is started afresh', async () => {
    let t = 0;
    const taps: number[] = [];
    let relaunched = 0;
    const out = await goHome({
      current: async () => DIAGNOSTICS,
      read: async () => DIAGNOSTICS,
      tap: () => void taps.push(t),
      relaunch: async () => void relaunched++,
      waitHome: async () => {},
      now: () => t,
      sleep: async (ms: number) => void (t += ms),
    });
    // (command #67c) at most 2 taps on ONE link (backTries), each re-press after the settle (800 ms) + the 15000 ms wait for the screen to leave
    expect(out).toEqual({ how: 'relaunch', tabTaps: 0, backTaps: 2, broughtBack: 0 });
    expect(relaunched).toBe(1);
    for (let i = 1; i < taps.length; i++) expect(taps[i] - taps[i - 1]).toBeGreaterThanOrEqual(15800);
  });
});

describe('gameOverShown: a finished game is never a piece check', () => {
  it('the result card, its Rematch button or a "Play again" button = finished; a live game, an empty or unreadable tree = not', () => {
    expect(gameOverShown([node('Board A, deciding board', [0, 200, 720, 900]), node('Rematch', [100, 1000, 300, 1060], 'bughouse-rematch')])).toBe(true);
    expect(gameOverShown([node('', [0, 900, 720, 1100], 'game-over')])).toBe(true);
    expect(gameOverShown([node('Play again', [100, 1000, 300, 1060])])).toBe(true);
    expect(gameOverShown([node('Board A, deciding board', [0, 200, 720, 900]), node('Resign', [100, 1000, 300, 1060], 'bughouse-resign')])).toBe(false);
    expect(gameOverShown([])).toBe(false);
    expect(gameOverShown(null)).toBe(false);
  });
});

describe('wiring (source scans)', () => {
  const e2e = readFileSync(join(__dirname, '../../../scripts/android/e2e.mjs'), 'utf8');
  const device = readFileSync(join(__dirname, '../../../scripts/android/lib/device.mjs'), 'utf8');
  it('toHome passes the foreground check to goHome; navigation taps go through tapApp', () => {
    expect(e2e).toMatch(/ensureApp: \(\) => dev\.ensureForeground\('toHome'\)/);
    expect(device).toMatch(/tap: \(x, y\) => this\.tapApp\(x, y,/);
  });
  it('the screen check never judges a finished game and reads a live-bots tree once per try', () => {
    // (command #67e) a game judged at its start (`verdict.early`) was judged before it could end; any other screen still never judges a finished game
    expect(e2e).toMatch(/if \(verdict\.gameOver \|\| \(!verdict\.early && gameOverShown\(nodes\)\)\)/);
    expect(e2e).toMatch(/if \(live\) dev\.dumpAttempts = 1;/);
  });
});
