import { describe, expect, it } from 'vitest';
import { appPidsIn, classifyEvidence, filterFailureLogcat } from '../../../scripts/android/lib/failureEvidence.mjs';
import { locate, nodeAt, sameAround, screenText, tapAndVerify, waitBudgets, waitSettled } from '../../../scripts/android/lib/settledTap.mjs';

/** Command #61: settled taps and the app-pid evidence, driven with fake dumps and a fake logcat (no phone). */
type Box = [number, number, number, number];
const node = (text: string, [x1, y1, x2, y2]: Box) => ({ text, desc: '', id: '', cls: 'android.widget.TextView', pkg: 'com.emchess.app', bounds: { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1, cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) } });
/** The Play list with "Local" at `y` and "Classic" under it. */
const list = (y: number, extra = '') => [node('Local', [0, y, 400, y + 60]), node('Classic', [0, y + 80, 400, y + 160]), node(extra || 'footer', [0, 900, 400, 960])];
const CLASSIC = { text: 'Classic', below: 'Local' };

/** A fake clock that only moves when the code sleeps. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

describe('locate / sameAround', () => {
  it('finds the first match under the heading, and is null when the heading is gone', () => {
    expect(locate(list(100), CLASSIC)?.bounds.y1).toBe(180);
    expect(locate([node('Classic', [0, 10, 5, 20])], CLASSIC)).toBeNull();
  });
  it('same bounds and same words = still; a moved target or a changed word = moving', () => {
    expect(sameAround(list(100), list(100), CLASSIC)).toBe(true);
    expect(sameAround(list(100), list(140), CLASSIC)).toBe(false);
    expect(sameAround(list(100), list(100, 'other footer'), CLASSIC)).toBe(false);
    expect(sameAround(list(100), [node('Local', [0, 100, 400, 160])], CLASSIC)).toBe(false);
  });
});

describe('waitBudgets', () => {
  it('scales with the dump time, clamped; a failed or missing measurement counts as the 12 s limit', () => {
    expect(waitBudgets(1000)).toEqual({ settleMs: 8000, changeMs: 8000 });
    expect(waitBudgets(5989)).toEqual({ settleMs: 47_912, changeMs: 13_978 });
    expect(waitBudgets(60_000)).toEqual({ settleMs: 60_000, changeMs: 30_000 });
    expect(waitBudgets(-1)).toEqual({ settleMs: 60_000, changeMs: 26_000 });
    expect(waitBudgets(undefined)).toEqual({ settleMs: 60_000, changeMs: 26_000 });
  });
});

describe('waitSettled', () => {
  it('a screen that stands still is settled after two equal dumps', async () => {
    const c = clock();
    let n = 0;
    const r = await waitSettled({ dump: async () => (n++, list(100)), step: CLASSIC, budgetMs: 10_000, ...c });
    expect(r.settled).toBe(true);
    expect(n).toBe(2);
    expect(r.node.bounds.y1).toBe(180);
  });
  it('a fling (the list moves between dumps) is waited out, then settled', async () => {
    const c = clock();
    const ys = [100, 160, 190, 200, 200];
    let n = 0;
    const r = await waitSettled({ dump: async () => list(ys[n++]), step: CLASSIC, budgetMs: 10_000, ...c });
    expect(r.settled).toBe(true);
    expect(n).toBe(5);
    expect(r.node.bounds.y1).toBe(280);
  });
  it('a previous tree from before the touch counts as the first of the pair', async () => {
    const c = clock();
    let n = 0;
    const r = await waitSettled({ dump: async () => (n++, list(100)), step: CLASSIC, budgetMs: 10_000, previous: list(100), ...c });
    expect(r).toMatchObject({ settled: true });
    expect(n).toBe(1);
  });
  it('a screen that never stands still gives up at the budget, unsettled, with the newest target', async () => {
    const c = clock();
    let n = 0;
    const r = await waitSettled({ dump: async () => list(100 + 10 * n++), step: CLASSIC, budgetMs: 2000, ...c });
    expect(r.settled).toBe(false);
    expect(r.node).not.toBeNull();
    expect(c.now()).toBeLessThan(3000);
  });
  it('a dump that fails is not settled and not fatal', async () => {
    const c = clock();
    const r = await waitSettled({ dump: async () => { throw new Error('idle'); }, step: CLASSIC, budgetMs: 1000, ...c });
    expect(r).toEqual({ settled: false, node: null, nodes: null });
  });
});

describe('tapAndVerify', () => {
  const target = list(100)[1];
  const game = [node('Time control', [0, 0, 400, 60])];
  function run({ settled, afterTaps }: { settled: boolean; afterTaps: (taps: number) => ReturnType<typeof list> }) {
    const c = clock();
    const taps: Array<[number, number]> = [];
    const logs: string[] = [];
    const result = tapAndVerify({
      node: target,
      settled,
      before: list(100),
      tap: (x: number, y: number) => void taps.push([x, y]),
      dump: async () => afterTaps(taps.length),
      changeMs: 3000,
      log: (m: string) => void logs.push(m),
      ...c,
    });
    return { result, taps, logs };
  }

  it('the screen changed after the tap: one tap, not lost', async () => {
    const { result, taps, logs } = run({ settled: true, afterTaps: () => game });
    expect(await result).toEqual({ changed: true, lost: false, retapped: false });
    expect(taps).toEqual([[200, 220]]);
    expect(logs).toEqual([]);
  });
  it('settled and the screen did not change: logs "tap lost (settled before tap: yes)" and taps ONCE more', async () => {
    const { result, taps, logs } = run({ settled: true, afterTaps: () => list(100) });
    expect(await result).toEqual({ changed: false, lost: true, retapped: true });
    expect(taps).toHaveLength(2);
    expect(logs[0]).toBe('  EVIDENCE: tap lost (settled before tap: yes)');
  });
  it('settled, the first tap lost, the second one landed: changed, one repeat', async () => {
    const { result, taps } = run({ settled: true, afterTaps: (t) => (t >= 2 ? game : list(100)) });
    expect(await result).toEqual({ changed: true, lost: false, retapped: true });
    expect(taps).toHaveLength(2);
  });
  it('NOT settled and the screen did not change: logs "settled before tap: no" and does NOT tap again', async () => {
    const { result, taps, logs } = run({ settled: false, afterTaps: () => list(100) });
    expect(await result).toEqual({ changed: false, lost: true, retapped: false });
    expect(taps).toHaveLength(1);
    expect(logs).toEqual(['  EVIDENCE: tap lost (settled before tap: no)', '  EVIDENCE: on top at the tap point 200,220: TextView "Classic" 400x80 at 0,180']);
  });
  it('a screen whose bounds move but whose words stay the same is a lost tap, not a change', async () => {
    const { result } = run({ settled: false, afterTaps: () => list(140) });
    expect((await result).lost).toBe(true);
  });
  it('retap: false never repeats', async () => {
    const c = clock();
    let taps = 0;
    const r = await tapAndVerify({ node: target, settled: true, before: list(100), tap: () => void taps++, dump: async () => list(100), changeMs: 1000, retap: false, ...c });
    expect(r).toEqual({ changed: false, lost: true, retapped: false });
    expect(taps).toBe(1);
  });
  it('nudges the status bar once after 2.5 s when the tree stays stale', async () => {
    const c = clock();
    let nudges = 0;
    await tapAndVerify({ node: target, settled: false, before: list(100), tap: () => {}, dump: async () => list(100), changeMs: 6000, nudge: () => void nudges++, ...c });
    expect(nudges).toBe(1);
  });
});

describe('screenText', () => {
  it('is the words only, no bounds', () => {
    expect(screenText(list(100))).toBe(screenText(list(500)));
  });
});

/**
 * Command #62: PR #47's "tap lost" lines that were NOT lost taps (all from the job logs of run 44811511453):
 * - online: `tap {"label":"Chaturaji"}` -> "tap lost (settled before tap: yes)", and then "four friend buddy: joined the chaturaji room": the chip was chosen, no word changed;
 * - small-screens-1 / -2, large-screens-2: three "[dump failed] ERROR: could not get idle state." lines, then "tap lost", then "PASS screen bughouse-game-single (... 32 pieces judged)";
 * - small-screens-2 / large-screens-2: `tap {"id":"preset-solo"}` lost - "You + 3 bots" is the setup's default preset, choosing it again changes nothing.
 */
describe('nodeAt: what is on top at the tap point (command #62, hypothesis a)', () => {
  it('the last node in document order that holds the point; an overlay drawn later covers the target', () => {
    const overlay = { ...node('', [0, 0, 1080, 2400]), cls: 'android.view.ViewGroup', id: 'sheet-backdrop' };
    expect(nodeAt(list(100), 200, 220)?.text).toBe('Classic');
    expect(nodeAt([...list(100), overlay], 200, 220)?.id).toBe('sheet-backdrop');
    expect(nodeAt(list(100), 500, 50)).toBeNull();
  });
});

describe('tapAndVerify: taps that are NOT lost (command #62)', () => {
  const chip = (label: string, selected: boolean, x = 0) => ({ ...node('', [x, 1100, x + 200, 1220]), desc: label, cls: 'android.view.ViewGroup', selected });
  const createChallenge = (chosen: string) => [node('Create Challenge', [0, 0, 400, 60]), chip('Classic', chosen === 'Classic', 0), chip('Chaturaji', chosen === 'Chaturaji', 220), node('Blitz 5 min', [0, 1300, 400, 1400])];

  it('a chip that becomes chosen is a change (its words are the same): one tap, no repeat', async () => {
    const c = clock();
    let taps = 0;
    const logs: string[] = [];
    const r = await tapAndVerify({ node: createChallenge('Classic')[2], settled: true, before: createChallenge('Classic'), tap: () => void taps++, dump: async () => createChallenge('Chaturaji'), changeMs: 3000, log: (m: string) => void logs.push(m), ...c });
    expect(r).toEqual({ changed: true, lost: false, retapped: false });
    expect(taps).toBe(1);
    expect(logs).toEqual([]);
  });
  it('the chosen state is part of the screen text', () => {
    expect(screenText(createChallenge('Classic'))).not.toBe(screenText(createChallenge('Chaturaji')));
  });
  it('no tree can be read after the tap (a game that never idles): unverified, NOT lost, never repeated', async () => {
    const c = clock();
    let taps = 0;
    const logs: string[] = [];
    const r = await tapAndVerify({
      node: list(100)[1],
      settled: true,
      before: list(100),
      tap: () => void taps++,
      dump: async () => {
        throw new Error('ERROR: could not get idle state.');
      },
      changeMs: 3000,
      log: (m: string) => void logs.push(m),
      ...c,
    });
    expect(r).toEqual({ changed: false, lost: false, unverified: true, retapped: false });
    expect(taps).toBe(1);
    expect(logs).toEqual(['  EVIDENCE: tap unverified (no tree could be read after the tap: the screen it opened never stands still)']);
  });
  it('one readable tree that is the same is still a lost tap (a failed dump among them does not hide it)', async () => {
    const c = clock();
    let calls = 0;
    const r = await tapAndVerify({
      node: list(100)[1],
      settled: false,
      before: list(100),
      tap: () => {},
      dump: async () => {
        calls++;
        if (calls % 2 === 0) throw new Error('ERROR: could not get idle state.');
        return list(100);
      },
      changeMs: 3000,
      ...c,
    });
    expect(r).toEqual({ changed: false, lost: true, retapped: false });
  });
  it('a target that was ALREADY chosen (the default preset): a no-op by design, not lost, not repeated', async () => {
    const c = clock();
    let taps = 0;
    const logs: string[] = [];
    const before = createChallenge('Chaturaji');
    const r = await tapAndVerify({ node: before[2], settled: true, before, tap: () => void taps++, dump: async () => createChallenge('Chaturaji'), changeMs: 3000, log: (m: string) => void logs.push(m), ...c });
    expect(r).toEqual({ changed: false, lost: false, noop: true, retapped: false });
    expect(taps).toBe(1);
    expect(logs).toEqual(['  (the target was already chosen: the tap changes nothing, by design)']);
  });
});

// A threadtime line: date time pid tid level tag: message
const T = (pid: number, tag: string, message: string, level = 'I') => `11-19 10:07:12.345  ${pid}  ${pid + 1} ${level} ${tag.padEnd(14)}: ${message}`;
const APP = 4524;
const UIA = 9001;
const uiautomatorNoise = (pid: number) => [
  T(pid, 'AndroidRuntime', '>>>>>> START com.android.internal.os.RuntimeInit uid 2000 <<<<<<'),
  T(pid, 'AndroidRuntime', 'Calling main entry com.android.commands.uiautomator.Launcher'),
  T(pid, 'AndroidRuntime', 'Shutting down VM'),
];

describe('failure logcat is the APP\'s own', () => {
  const noise64 = Array.from({ length: 22 }, (_, i) => uiautomatorNoise(UIA + i * 10)).flat();

  it('uiautomator / shell AndroidRuntime lines (uid 2000) are dropped, with the app pid known and unknown', () => {
    const log = [...noise64, T(APP, 'ReactNativeJS', 'Running "main"')].join('\n');
    expect(filterFailureLogcat(log, 80, [APP, APP])).toEqual([T(APP, 'ReactNativeJS', 'Running "main"')]);
    expect(filterFailureLogcat(log)).toEqual([T(APP, 'ReactNativeJS', 'Running "main"')]);
    expect(filterFailureLogcat(noise64.join('\n'), 80, [APP])).toEqual([]);
  });
  it('the app\'s own FATAL block is kept (its pid comes from the caller or from "Process: com.emchess.app, PID: n")', () => {
    const fatal = [T(APP, 'AndroidRuntime', 'FATAL EXCEPTION: main', 'E'), T(APP, 'AndroidRuntime', 'Process: com.emchess.app, PID: 4524', 'E'), T(APP, 'AndroidRuntime', 'java.lang.RuntimeException: boom', 'E')];
    const log = [...noise64, ...fatal].join('\n');
    expect(filterFailureLogcat(log, 80, [])).toEqual(fatal);
    expect(filterFailureLogcat(log, 80, [APP])).toEqual(fatal);
    expect(appPidsIn(log, [7]) as Set<number>).toEqual(new Set([7, APP]));
  });
  it('another process\'s FATAL EXCEPTION is not the app\'s', () => {
    const other = T(UIA, 'AndroidRuntime', 'FATAL EXCEPTION: main', 'E');
    expect(filterFailureLogcat([other, T(APP, 'ReactNativeJS', 'x')].join('\n'), 80, [APP])).toEqual([T(APP, 'ReactNativeJS', 'x')]);
  });
  it('keeps ActivityManager ANR and "Process com.emchess.app ... has died" lines, and the engine WebView\'s chromium lines of any pid', () => {
    const died = T(1000, 'ActivityManager', 'Process com.emchess.app (pid 4524) has died: fg  TOP', 'I');
    const anr = T(1000, 'ActivityManager', 'ANR in com.emchess.app', 'E');
    const other = T(1000, 'ActivityManager', 'Process com.other (pid 5) has died', 'I');
    const chromium = T(5555, 'chromium', 'renderer gone', 'E');
    expect(filterFailureLogcat([died, anr, other, chromium].join('\n'), 80, [APP])).toEqual([died, anr, chromium]);
  });
});

describe('classifyEvidence: PR #46 (uiautomator noise, app pid unchanged, a lost tap)', () => {
  const noise = filterFailureLogcat(Array.from({ length: 22 }, (_, i) => uiautomatorNoise(UIA + i)).flat().join('\n'));
  it('64 lines of uiautomator\'s own AndroidRuntime START / Shutting down VM are NOT a crash', () => {
    // even handed to the classifier unfiltered
    const raw = Array.from({ length: 22 }, (_, i) => uiautomatorNoise(UIA + i)).flat();
    expect(raw).toHaveLength(66);
    expect(classifyEvidence({ startPid: APP, pid: APP, logcat: raw, issues: ['screen game-2p: tap {"text":"Classic"} did not change the screen'] })).toBe('screen unchanged after tap');
    expect(classifyEvidence({ startPid: APP, pid: APP, logcat: noise })).toBe('unknown');
  });
  it('an app FATAL EXCEPTION is a crash; so is a process that is gone', () => {
    const fatal = filterFailureLogcat([T(APP, 'AndroidRuntime', 'FATAL EXCEPTION: main', 'E'), T(APP, 'AndroidRuntime', 'Process: com.emchess.app, PID: 4524', 'E')].join('\n'));
    expect(classifyEvidence({ startPid: APP, pid: APP, logcat: fatal })).toBe('crash');
    expect(classifyEvidence({ startPid: APP, pid: null })).toBe('crash');
  });
  it('a pid that changed is "app restarted"; a lost tap with an unchanged pid is "tap lost"', () => {
    expect(classifyEvidence({ startPid: APP, pid: APP + 1 })).toBe('app restarted');
    expect(classifyEvidence({ startPid: APP, pid: APP, logcat: noise, tapsLost: [{ settled: true }] })).toBe('tap lost');
    expect(classifyEvidence({ startPid: APP, pid: APP, tapsLost: [{ settled: false }], issues: ['something else'] })).toBe('tap lost');
  });
  it('a crash still beats a lost tap', () => {
    expect(classifyEvidence({ startPid: APP, pid: null, tapsLost: [{}] })).toBe('crash');
  });
});
