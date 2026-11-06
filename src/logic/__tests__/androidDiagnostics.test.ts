import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT_RUNNER, HEALTH_LIMITS, exitStatus, judgeHealth, labelAttempt, measureDump, measureInput } from '../../../scripts/android/lib/health.mjs';
import { buildDigest, buildImages, fitPng, pngLines, readSlices } from '../../../scripts/android/summary.mjs';
import { encodePng, solid } from '../../../scripts/android/lib/png.mjs';

/**
 * THE DIAGNOSTICS OF THE ANDROID END-TO-END RUN (command #32): the runner health check and its one repeat, the RUNNER / APP label, and the failing screenshots in the job summary. The run itself
 * needs an emulator (CI only); the judgement, the labels, the exit status and the Markdown are pure and are pinned here, with the limits as LITERALS (a test that read them from the module under
 * mutation could never kill a mutant of them).
 */
const root = join(__dirname, '../../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('runner health', () => {
  it('pins the limits and the exit status as literals', () => {
    expect(HEALTH_LIMITS).toEqual({ inputMs: 2500, dumpMs: 12000 });
    expect(EXIT_RUNNER).toBe(3);
  });

  it('calls the runner slow only above a limit (the limit itself is healthy)', () => {
    expect(judgeHealth({ inputMs: 2500, dumpMs: 12000 }).slow).toBe(false);
    expect(judgeHealth({ inputMs: 2501, dumpMs: 100 }).slow).toBe(true);
    expect(judgeHealth({ inputMs: 100, dumpMs: 12001 }).slow).toBe(true);
    expect(judgeHealth({ inputMs: 300, dumpMs: 1800 })).toEqual({ slow: false, reasons: [] });
  });

  it('a dump that failed on the idle start screen is slow; a missing dump reading (the end reading) is not judged', () => {
    expect(judgeHealth({ inputMs: 300, dumpMs: -1 }).slow).toBe(true);
    expect(judgeHealth({ inputMs: 300 }).slow).toBe(false);
    expect(judgeHealth({ inputMs: 9000 }).reasons).toEqual(['input commands took 9000 ms (limit 2500)']);
  });

  it('labels a failure RUNNER when either reading was slow and APP otherwise, and nothing when it passed', () => {
    const fine = { start: { inputMs: 400, dumpMs: 2000 }, end: { inputMs: 500 } };
    expect(labelAttempt({ failed: false, health: fine })).toBe('');
    expect(labelAttempt({ failed: true, health: fine })).toBe('APP');
    expect(labelAttempt({ failed: true, health: { ...fine, start: { inputMs: 400, dumpMs: 30000 } } })).toBe('RUNNER');
    expect(labelAttempt({ failed: true, health: { ...fine, end: { inputMs: 6000 } } })).toBe('RUNNER');
    expect(labelAttempt({ failed: true, health: { start: null, end: null } })).toBe('APP'); // no reading = no excuse
    expect(labelAttempt({ failed: false, health: { ...fine, end: { inputMs: 6000 } } })).toBe(''); // a slow runner that passed is green
  });

  it('exits 0 / 3 / 1 for passed / failed on a slow runner (retried) / failed on a healthy runner (never retried)', () => {
    const fine = { start: { inputMs: 400, dumpMs: 2000 }, end: { inputMs: 500 } };
    const slow = { start: { inputMs: 9000, dumpMs: 2000 }, end: null };
    expect(exitStatus({ failed: false, health: slow })).toBe(0);
    expect(exitStatus({ failed: true, health: slow })).toBe(3);
    expect(exitStatus({ failed: true, health: fine })).toBe(1);
  });

  it('measures the median of the input commands with the clock it is given, and a failed dump as -1', async () => {
    const ticks = [0, 10, 10, 1010, 1010, 1030, 1030, 1040, 1040, 5040]; // durations 10, 1000, 20, 10, 4000 -> median 20
    let i = 0;
    let commands = 0;
    const dev = { sh: () => commands++, dump: async () => {} };
    expect(measureInput(dev, { now: () => ticks[i++] })).toBe(20);
    expect(commands).toBe(5);
    const clock = [100, 4100];
    let j = 0;
    expect(await measureDump(dev, { now: () => clock[j++] })).toBe(4000);
    expect(await measureDump({ dump: async () => { throw new Error('idle'); } })).toBe(-1);
  });
});

/** A results.json like the driver writes. */
const run = (over: Record<string, unknown>) => ({ profile: 'small', phase: 'static', attempt: 1, label: '', seconds: 120, relaunches: 0, dumpFailures: {}, health: { start: { inputMs: 400, dumpMs: 2000 }, end: { inputMs: 500 } }, results: [{ name: 'screen: home', ok: true, issues: [], note: '' }], ...over });
const failing = [{ name: 'screen: home', ok: false, issues: ['text is clipped'], note: '' }];
function slice(dir: string, name: string, results: unknown, extra: Record<string, string | Buffer> = {}) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, 'results.json'), JSON.stringify(results));
  for (const [file, body] of Object.entries(extra)) writeFileSync(join(dir, name, file), body);
}
const shot = (w: number, h: number) => encodePng(solid(w, h, [10, 120, 200]));

describe('the digest', () => {
  it('shows a slice that failed on a healthy runner as APP and counts it red', () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-'));
    slice(dir, 'small-static-screens1', run({ label: 'APP', results: failing }));
    const { text, red } = buildDigest(dir);
    expect(red).toBe(1);
    expect(text).toContain('[APP]');
    expect(text).toContain('**APP**: small-static-screens1 failed on a healthy runner');
    expect(text).toContain('FAILED `screen: home`: text is clipped');
    expect(text).toContain('health: input 400 ms, dump 2000 ms, end input 500 ms');
  });

  it('a slice that failed on a slow runner and passed on its repeat is green, with attempt 1 kept as evidence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-'));
    slice(dir, 'small-online-online', run({ label: 'RUNNER', results: failing, health: { start: { inputMs: 9000, dumpMs: 40000 }, end: null } }));
    slice(dir, 'small-online-online-retry', run({ attempt: 2 }));
    const { text, red } = buildDigest(dir);
    expect(red).toBe(0);
    expect(text).toContain('(attempt 1, repeated: the runner was slow) [RUNNER]');
    expect(text).toContain('(attempt 2, the verdict)');
    expect(text).toContain('passed on its repeat after a slow-runner failure');
    expect(text).toContain('health: input 9000 ms, dump 40000 ms');
  });

  it('a slice that fails twice on a slow runner is red and labelled RUNNER', () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-'));
    slice(dir, 'small-static-gallery', run({ label: 'RUNNER', results: failing }));
    slice(dir, 'small-static-gallery-retry', run({ attempt: 2, label: 'RUNNER', results: failing }));
    const { text, red } = buildDigest(dir);
    expect(red).toBe(1);
    expect(text).toContain('**RUNNER**: small-static-gallery failed on a slow runner even after its repeat');
    expect(readSlices(dir)![0].attempts.map((a: { name: string }) => a.name)).toEqual(['small-static-gallery', 'small-static-gallery-retry']);
  });

  it('says so when no result was written', () => {
    expect(buildDigest(join(tmpdir(), 'e2e-does-not-exist')).text).toContain('No results were written');
  });
});

describe('the failing screenshots', () => {
  it('prints nothing on a green run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-'));
    slice(dir, 'small-static-screens1', run({}), { 'run.log': `PNG64 screen-home ${shot(8, 8).toString('base64')}` });
    expect(buildImages(dir)).toBe('');
  });

  it('reads the PNG64 lines of the log and the FAILED snapshots of a failing slice, once per name, as collapsed base64', () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-'));
    const small = shot(8, 8).toString('base64');
    slice(dir, 'small-static-screens1', run({ label: 'APP', results: failing }), {
      'run.log': `[12:00:01] PNG64 screen-home ${small}\n[12:00:02] unrelated line\n[12:00:03] PNG64 screen-home ${small}`,
      'FAILED-touch.png': shot(16, 16),
    });
    expect(pngLines(readFileSync(join(dir, 'small-static-screens1', 'run.log'), 'utf8')).map((p: { name: string }) => p.name)).toEqual(['screen-home', 'screen-home']);
    const text = buildImages(dir);
    expect(text).toContain('### android-e2e: the failing screenshots');
    expect(text.match(/<details>/g)).toHaveLength(2); // screen-home once, FAILED-touch once
    expect(text).toContain('small-static-screens1: screen-home');
    expect(text).toContain('small-static-screens1: FAILED-touch');
    expect(text).toContain(small);
  });

  it('uses the LAST attempt: a slice that passed on its repeat shows no screenshots', () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-'));
    slice(dir, 'small-online-online', run({ label: 'RUNNER', results: failing }), { 'run.log': `PNG64 screen-x ${shot(8, 8).toString('base64')}` });
    slice(dir, 'small-online-online-retry', run({ attempt: 2 }));
    expect(buildImages(dir)).toBe('');
  });

  it('stays inside the budget: an image that cannot be made small enough, and images past the count, are left out and said so', () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-'));
    const lines = Array.from({ length: 4 }, (_, i) => `PNG64 shot-${i} ${shot(8 + i, 8).toString('base64')}`).join('\n');
    slice(dir, 'a-static-x', run({ label: 'APP', results: failing }), { 'run.log': lines });
    const text = buildImages(dir, { totalChars: 600000, imageChars: 90000, maxImages: 2 });
    expect(text.match(/<details>/g)).toHaveLength(2);
    expect(text).toContain('2 more screenshot(s) were left out');
    expect(buildImages(dir, { totalChars: 10, imageChars: 90000, maxImages: 8 })).toContain('4 more screenshot(s) were left out');
  });

  it('shrinks a large screenshot by half until it fits, and gives up (null) when it cannot', () => {
    const big = encodePng(solid(400, 400, [1, 2, 3]));
    expect(fitPng(big, 1_000_000)).toBe(big.toString('base64'));
    const fitted = fitPng(big, big.toString('base64').length - 1);
    expect(fitted === null || fitted.length < big.toString('base64').length).toBe(true);
    expect(fitPng(big, 5)).toBeNull();
  });
});

describe('the wiring', () => {
  it('the workflow prints the screenshots on a failure only, to the summary and to the log, before the verdict', () => {
    const wf = read('.github/workflows/android-e2e.yml');
    const step = wf.indexOf('- name: The failing screenshots');
    expect(step).toBeGreaterThan(wf.indexOf('- name: Summary'));
    expect(step).toBeLessThan(wf.indexOf('- name: The verdict'));
    const body = wf.slice(step, wf.indexOf('- name: The verdict'));
    expect(body).toContain("needs.emulator.result != 'success'");
    expect(body).toContain('summary.mjs android-e2e-all --images');
    expect(body).toContain('>> "$GITHUB_STEP_SUMMARY"');
    expect(body).toContain('::group::');
  });

  it('the shell repeats a slice once, only on exit status 3, runs the repeat into its own folder, and the last attempt is the verdict', () => {
    const sh = read('scripts/android/run-on-emulator.sh');
    expect(sh).toContain('EXIT_RUNNER=3');
    expect(sh).toContain('for attempt in 1 2; do');
    expect(sh).toContain('--attempt "$attempt"');
    expect(sh).toContain('[ "$code" -eq "$EXIT_RUNNER" ] && [ "$attempt" -eq 1 ]');
    expect(sh).toContain('[ "$code" -eq 0 ] || rc=1');
    const e2e = read('scripts/android/e2e.mjs');
    expect(e2e).toContain("ATTEMPT === 2 ? '-retry' : ''");
    expect(e2e).toContain('process.exit(exitStatus({ failed: failed.length > 0, health, issues: failureIssues }))');
    expect(e2e).toContain('health.start = {');
    expect(e2e).toContain('health.end = {');
  });

  it('the emulator-only "destination not highlighted" reading is no longer printed as a finding', () => {
    const e2e = read('scripts/android/e2e.mjs');
    expect(e2e).not.toContain('FINDING');
    expect(e2e).toContain('the phone shows both squares');
  });

  it('the phone run draws arrows with a HELD finger on the 2-player board and on a Bughouse board and reads the count from the app (command #32)', () => {
    const e2e = read('scripts/android/e2e.mjs');
    expect(e2e).toContain('async function arrows2p(dev)');
    expect(e2e).toContain('await arrows2p(dev);');
    expect(e2e).toContain('s.arrows === 2');
    expect(e2e).toContain('s.arrows === 0 && s.fen !== fen');
    expect(e2e).toContain("arrows: after a move on board A its arrows were not cleared");
    const device = read('scripts/android/lib/device.mjs');
    expect(device).toContain('drawArrow(x1, y1, x2, y2, holdMs = 700)');
    expect(device).toContain('input motionevent DOWN'); // a held finger: `input swipe` would start moving at once, which is a slide
    expect(read('src/components/BughouseBoard.tsx')).toContain('arrows: markState ? markState.arrows.length : 0');
    expect(read('src/components/ChessBoard.tsx')).toContain('arrows: arrows.length');
  });

  it('EXIT_RUNNER in the shell and in the module are the same number', () => {
    expect(Number(/EXIT_RUNNER=(\d+)/.exec(read('scripts/android/run-on-emulator.sh'))![1])).toBe(EXIT_RUNNER);
  });
});
