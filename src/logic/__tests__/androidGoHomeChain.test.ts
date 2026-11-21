import { describe, expect, it } from 'vitest';
import { goHome, isHome } from '../../../scripts/android/lib/goHome.mjs';

/**
 * Command #67c (PR #51 head 051bad8, job 136831520378 "emulator (small-screens-1)"): toHome from every "‹ Back" screen reached through the scrolled Play menu (Select Time Control, the
 * 4 Player / Giveaway / Chaturaji / Bughouse setups) ended in "toHome: starting the app afresh (tab taps 0, back taps 3, brought to the front 0)", about 28 s each: 5 harness relaunches in one
 * slice. The chain is two screens (‹ Back -> the Play menu, ‹ Menu -> Home), but on that emulator each screen answered its back tap after the 6 s wait: the link was pressed again and the
 * third tap (one shared cap for the whole chain) ended the walk on the Play menu. Driven here with a fake phone whose screens answer late; a tap while an answer is pending is absorbed
 * (the app is busy rendering the next screen: the second press of the same link changes nothing).
 */
type Box = [number, number, number, number];
const node = (text: string, [x1, y1, x2, y2]: Box) => ({ text, desc: '', id: '', cls: 'android.widget.TextView', pkg: 'com.emchess.app', bounds: { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1, cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) } });
const TAB_BAR = [node('Home', [54, 1209, 126, 1248]), node('Puzzles', [216, 1209, 324, 1248]), node('Analysis', [391, 1209, 509, 1248]), node('More', [594, 1209, 666, 1248])];
const HOME = [node('EM-Chess', [20, 160, 300, 220]), node('Play', [300, 288, 421, 362]), ...TAB_BAR];
// the two headers put their link in the SAME place (ScreenHeader): only the text differs
const TIME_CONTROL = [node('‹ Back', [20, 40, 140, 90]), node('Select Time Control', [200, 40, 620, 90]), node('Bullet', [20, 200, 300, 240]), node('3 min', [20, 260, 200, 300])];
const PLAY_MENU = [node('‹ Menu', [20, 40, 140, 90]), node('Play', [200, 40, 520, 90]), node('Local', [20, 200, 700, 240]), node('Classic', [20, 260, 300, 330])];
const SCREENS = { home: HOME, timeControl: TIME_CONTROL, playMenu: PLAY_MENU } as const;
type Screen = keyof typeof SCREENS;
const BACK_OF: Partial<Record<Screen, Screen>> = { timeControl: 'playMenu', playMenu: 'home' };

/** A phone whose screens answer a back tap `answerMs` later; every tree read costs `readMs` (uiautomator on a loaded emulator). */
function slowPhone(start: Screen, { answerMs, readMs }: { answerMs: number; readMs: number }) {
  let t = 0;
  let screen: Screen = start;
  let pending: { to: Screen; at: number } | null = null;
  let relaunches = 0;
  const tapped: string[] = [];
  const settle = () => {
    if (pending && t >= pending.at) {
      screen = pending.to;
      pending = null;
    }
  };
  const read = async () => {
    t += readMs;
    settle();
    return SCREENS[screen];
  };
  const verbs = {
    current: async () => SCREENS[screen],
    read,
    tap: (x: number, y: number) => {
      settle();
      const hit = SCREENS[screen].find((n) => x >= n.bounds.x1 && x < n.bounds.x2 && y >= n.bounds.y1 && y < n.bounds.y2);
      tapped.push(hit?.text ?? 'nothing');
      if (pending) return; // busy with the last answer: the press is absorbed
      const to = hit?.text.startsWith('‹') ? BACK_OF[screen] : hit?.text === 'Home' && hit.bounds.y1 >= 1200 ? 'home' : undefined;
      if (to) pending = { to, at: t + answerMs };
    },
    relaunch: async () => {
      relaunches++;
      screen = 'home';
    },
    waitHome: async () => {
      if (!isHome(SCREENS[screen])) throw new Error('timed out waiting for the Home screen');
    },
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
      settle();
    },
  };
  return { verbs, tapped, get screen() { return screen; }, get relaunches() { return relaunches; } };
}

describe('goHome walks a normal ‹ Back chain to Home without starting the app afresh (command #67c)', () => {
  it('Select Time Control -> Play menu -> Home, each screen answering 12 s after its tap (051bad8: 3 taps, then a relaunch)', async () => {
    const p = slowPhone('timeControl', { answerMs: 12_000, readMs: 2_000 });
    const out = await goHome(p.verbs);
    expect(p.relaunches).toBe(0);
    expect(out.how).toBe('back');
    expect(p.tapped).toEqual(['‹ Back', '‹ Menu']);
    expect(out).toEqual({ how: 'back', tabTaps: 0, backTaps: 2, broughtBack: 0 });
    expect(p.screen).toBe('home');
  });
  it('a fast phone takes the same two taps', async () => {
    const p = slowPhone('timeControl', { answerMs: 300, readMs: 500 });
    const out = await goHome(p.verbs);
    expect(p.tapped).toEqual(['‹ Back', '‹ Menu']);
    expect(out).toEqual({ how: 'back', tabTaps: 0, backTaps: 2, broughtBack: 0 });
  });
  it('a screen slower than the wait is pressed once more and the chain still reaches Home (taps are counted per screen, not for the whole chain)', async () => {
    const p = slowPhone('timeControl', { answerMs: 20_000, readMs: 2_000 });
    const out = await goHome(p.verbs);
    expect(p.relaunches).toBe(0);
    expect(out.how).toBe('back');
    expect(p.screen).toBe('home');
    expect(out.backTaps).toBeGreaterThanOrEqual(3); // 2 taps on "‹ Back" + at least 1 on "‹ Menu": more than #67b's shared cap of 3 allowed for a chain that needs a re-press
  });
  it('a screen that never answers is still bounded: 2 taps on its link, then the app is started afresh', async () => {
    const p = slowPhone('timeControl', { answerMs: 10_000_000, readMs: 2_000 });
    const out = await goHome(p.verbs);
    expect(p.tapped).toEqual(['‹ Back', '‹ Back']);
    expect(out.how).toBe('relaunch');
    expect(p.relaunches).toBe(1);
  });
});
