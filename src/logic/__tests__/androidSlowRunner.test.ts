import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Device } from '../../../scripts/android/lib/device.mjs';
import { Beacon } from '../../../scripts/android/lib/beacon.mjs';
import { exitStatus, isWaitFailure, labelAttempt, retapDecision, sameBounds, stableDecision, timeoutScale } from '../../../scripts/android/lib/health.mjs';

/**
 * COMMAND #43: the Android end-to-end driver on a SLOW runner (the start dump of the failing slices took 5.2 - 12.7 s, of the passing ones 2.3 - 3.0 s). The decisions are pure functions
 * (health.mjs) and are tested with literals; the tap sequence itself (wait for a stable target, tap, check the screen moved, re-tap ONCE) runs against a scripted fake phone, with fake dumps.
 */

describe('timeout scaling (the start dump over the healthy 3000 ms, 1 .. 5)', () => {
  it('is 1 on a healthy runner and grows with the dump', () => {
    expect(timeoutScale(2300)).toBe(1);
    expect(timeoutScale(3000)).toBe(1);
    expect(timeoutScale(5300)).toBeCloseTo(1.7667, 3);
    expect(timeoutScale(6000)).toBe(2);
    expect(timeoutScale(12700)).toBeCloseTo(4.2333, 3);
  });
  it('is capped at 5, and a failed or missing dump counts as the cap', () => {
    expect(timeoutScale(40000)).toBe(5);
    expect(timeoutScale(-1)).toBe(5);
    expect(timeoutScale(undefined)).toBe(5);
  });
});

describe('stable bounds (two readings in a row)', () => {
  const a = { x1: 10, y1: 20, x2: 110, y2: 80 };
  it('compares all four edges', () => {
    expect(sameBounds(a, { ...a })).toBe(true);
    expect(sameBounds(a, { ...a, y2: 81 })).toBe(false);
    expect(sameBounds(a, { ...a, x1: 9 })).toBe(false);
    expect(sameBounds(a, null)).toBe(false);
    expect(sameBounds(null, null)).toBe(false);
  });
  it('taps only on two equal readings, otherwise waits', () => {
    expect(stableDecision(a, { ...a })).toBe('tap');
    expect(stableDecision(a, { ...a, y1: 30, y2: 90 })).toBe('wait');
    expect(stableDecision(null, a)).toBe('wait');
  });
});

describe('the re-tap decision (once, never blindly)', () => {
  it('leaves a screen that changed alone', () => {
    expect(retapDecision({ changed: true, expectedVisible: false, retapped: false })).toBe('ok');
    expect(retapDecision({ changed: true, expectedVisible: false, retapped: true })).toBe('ok');
  });
  it('leaves a screen alone that already shows the next step target', () => {
    expect(retapDecision({ changed: false, expectedVisible: true, retapped: false })).toBe('ok');
  });
  it('re-taps once when nothing changed, then gives up', () => {
    expect(retapDecision({ changed: false, expectedVisible: false, retapped: false })).toBe('retap');
    expect(retapDecision({ changed: false, expectedVisible: false, retapped: true })).toBe('give-up');
  });
});

describe('the RUNNER / APP label', () => {
  const slowStart = { start: { inputMs: 400, dumpMs: 5300 }, end: { inputMs: 500 } };
  const fineStart = { start: { inputMs: 400, dumpMs: 3000 }, end: { inputMs: 500 } };
  const cannotFind = 'exception: cannot find {"text":"5 min"}; on screen: ‹ Menu | Play';
  it('recognises only missing nodes and timeouts as wait failures', () => {
    expect(isWaitFailure(cannotFind)).toBe(true);
    expect(isWaitFailure('timed out after 20000 ms waiting for the board; on screen: Play')).toBe(true);
    expect(isWaitFailure('text is clipped')).toBe(false);
    expect(isWaitFailure('the app crashed (FATAL EXCEPTION)')).toBe(false);
  });
  it('labels a wait-only failure RUNNER when the start dump was over 4000 ms', () => {
    expect(labelAttempt({ failed: true, health: slowStart, issues: [cannotFind, 'timed out after 40000 ms waiting for x'] })).toBe('RUNNER');
    expect(exitStatus({ failed: true, health: slowStart, issues: [cannotFind] })).toBe(3);
  });
  it('keeps the 4000 ms boundary healthy (the dump must be OVER it)', () => {
    expect(labelAttempt({ failed: true, health: { ...slowStart, start: { inputMs: 400, dumpMs: 4000 } }, issues: [cannotFind] })).toBe('APP');
    expect(labelAttempt({ failed: true, health: { ...slowStart, start: { inputMs: 400, dumpMs: 4001 } }, issues: [cannotFind] })).toBe('RUNNER');
  });
  it('keeps APP for wrong text, wrong pixels, crashes and failed assertions on a slow runner', () => {
    expect(labelAttempt({ failed: true, health: slowStart, issues: [cannotFind, 'text is clipped'] })).toBe('APP');
    expect(labelAttempt({ failed: true, health: slowStart, issues: ['the app crashed'] })).toBe('APP');
    expect(exitStatus({ failed: true, health: slowStart, issues: ['wrong pixels: black king drawn white'] })).toBe(1);
  });
  it('keeps APP for a wait failure on a healthy runner, and for a failure without issues on a 4 - 12 s runner', () => {
    expect(labelAttempt({ failed: true, health: fineStart, issues: [cannotFind] })).toBe('APP');
    expect(labelAttempt({ failed: true, health: slowStart })).toBe('APP');
    expect(labelAttempt({ failed: true, health: slowStart, issues: [] })).toBe('APP');
  });
  it('still calls any failure RUNNER when a reading is over the old limits, and nothing when it passed', () => {
    expect(labelAttempt({ failed: true, health: { start: { inputMs: 400, dumpMs: 13000 }, end: null }, issues: ['text is clipped'] })).toBe('RUNNER');
    expect(labelAttempt({ failed: false, health: slowStart, issues: [] })).toBe('');
  });
});

// --- the tap sequence against a scripted fake phone -------------------------------------------------------------------------------------------------------------------------------

type Bounds = { x1: number; y1: number; x2: number; y2: number; w: number; h: number; cx: number; cy: number };
const bounds = (x1: number, y1: number, x2: number, y2: number): Bounds => ({ x1, y1, x2, y2, w: x2 - x1, h: y2 - y1, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 });
const node = (text: string, b: Bounds) => ({ index: 0, parent: -1, cls: 'android.widget.Button', text, desc: '', id: '', bounds: b });

/** A phone whose screens are lists of nodes; `tapsToChange` is how many taps it needs before it shows the next screen (a lost tap is one that does nothing). */
class FakePhone extends Device {
  taps: Array<[number, number]> = [];
  dumps = 0;
  nudges = 0;
  logs: string[] = [];
  screens: Array<ReturnType<typeof node>[]>;
  current_screen = 0;
  tapsToChange: number;
  /** extra readings for the first dumps (a target that is still sliding in) */
  firstBounds: Bounds[] = [];

  constructor(screens: Array<ReturnType<typeof node>[]>, tapsToChange = 1) {
    super({ outDir: mkdtempSync(join(tmpdir(), 'fake-phone-')), serial: 'fake', log: () => {} });
    this.log = (m: string) => this.logs.push(m);
    this.screens = screens;
    this.tapsToChange = tapsToChange;
    this.display = { w: 360, h: 640 } as never;
  }

  async dump() {
    this.dumps++;
    const nodes = this.screens[this.current_screen].map((n) => ({ ...n }));
    const moving = this.firstBounds.shift();
    if (moving) nodes[0] = { ...nodes[0], bounds: moving };
    this.last = { xml: '', nodes } as never;
    this.fresh = true;
    return nodes as never;
  }

  tap(x: number, y: number) {
    this.fresh = false;
    if (y <= 4) return void this.nudges++; // the status-bar nudge of waitChanged does nothing on the phone
    this.taps.push([x, y]);
    if (this.taps.length >= this.tapsToChange && this.current_screen < this.screens.length - 1) this.current_screen++;
  }
}

const playScreen = [node('Classic', bounds(0, 100, 200, 160))];
const timeScreen = [node('5 min', bounds(0, 200, 200, 260))];

describe('tapStep on a scripted phone (fake dumps, fake timers)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const run = async (phone: FakePhone, step: Record<string, unknown>, next: Record<string, unknown> | null = null) => {
    const done = phone.tapStep(step as never, next as never);
    await vi.runAllTimersAsync();
    await done;
  };

  it('taps once when the screen moves on, and does not log a re-tap', async () => {
    const phone = new FakePhone([playScreen, timeScreen]);
    await run(phone, { text: 'Classic' }, { text: '5 min' });
    expect(phone.taps).toEqual([[100, 130]]);
    expect(phone.logs.some((l) => l.includes('re-tap'))).toBe(false);
  });

  it('re-taps ONCE when the first tap was lost (the screen did not change) and logs "re-tap"', async () => {
    const phone = new FakePhone([playScreen, timeScreen], 2);
    await run(phone, { text: 'Classic' }, { text: '5 min' });
    expect(phone.taps).toEqual([[100, 130], [100, 130]]);
    expect(phone.logs.filter((l) => l.includes('re-tap'))).toHaveLength(1);
    expect(phone.current_screen).toBe(1);
  });

  it('never taps a third time: two lost taps end the step (the next step then fails with its own message)', async () => {
    const phone = new FakePhone([playScreen, timeScreen], 99);
    await run(phone, { text: 'Classic' }, { text: '5 min' });
    expect(phone.taps).toHaveLength(2);
    expect(phone.logs.some((l) => l.includes('did not change after the re-tap'))).toBe(true);
  });

  it('does not re-tap a step marked noRetap, nor when the next step target is already on screen', async () => {
    const toggle = new FakePhone([playScreen, timeScreen], 99);
    await run(toggle, { text: 'Classic', noRetap: true }, { text: '5 min' });
    expect(toggle.taps).toHaveLength(1);
    const both = new FakePhone([[node('Classic', bounds(0, 100, 200, 160)), node('Start', bounds(0, 300, 200, 360))]], 99);
    await run(both, { text: 'Classic' }, { text: 'Start' });
    expect(both.taps).toHaveLength(1);
  });

  it('waits for the target to stand still: the tap goes to the bounds of two equal dumps, not to the sliding ones', async () => {
    const phone = new FakePhone([playScreen, timeScreen]);
    phone.firstBounds = [bounds(0, 400, 200, 460), bounds(0, 250, 200, 310)]; // the first two dumps catch the target while it slides in
    await run(phone, { text: 'Classic' }, { text: '5 min' });
    // dump 1 (find): y 400-460; dump 2 (check): y 250-310 differs -> wait; dump 3: y 100-160 (the screen's own) differs from 250-310 -> wait; dump 4 equals dump 3 -> tap at y 130
    expect(phone.taps).toEqual([[100, 130]]);
    expect(phone.logs.filter((l) => l.includes('moved between two dumps'))).toHaveLength(2);
  });

  it('a wait step is scaled by the timeout scale and taps nothing', async () => {
    const phone = new FakePhone([playScreen]);
    phone.timeScale = 2;
    const t0 = Date.now();
    await run(phone, { wait: 1000 });
    expect(Date.now() - t0).toBe(2000);
    expect(phone.taps).toHaveLength(0);
  });

  it('waitFor multiplies its timeout by the timeout scale (the message names the scaled bound)', async () => {
    const phone = new FakePhone([playScreen]);
    phone.timeScale = 2;
    const failing = phone.waitFor('the board', () => false, 20_000, 600).catch((e: Error) => e.message);
    await vi.runAllTimersAsync();
    expect(await failing).toContain('timed out after 40000 ms waiting for the board');
  });

  it('the beacon multiplies its timeout too and answers null at the scaled bound', async () => {
    const beacon = new Beacon();
    beacon.timeScale = 3;
    const t0 = Date.now();
    const waited = beacon.waitFor('state-board-2p', () => true, 1000);
    await vi.runAllTimersAsync();
    expect(await waited).toBeNull();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(3000);
    expect(Date.now() - t0).toBeLessThan(3300);
  });
});
