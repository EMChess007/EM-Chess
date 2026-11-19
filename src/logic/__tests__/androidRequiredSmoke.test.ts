import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildInformational, readMarkers } from '../../../scripts/android/summary.mjs';

/**
 * COMMAND #44: the required Android check is the SMOKE; the full e2e is informational (temporary). The real shell script is run with a fake `adb` and a fake `node` (their exit codes are
 * the "fake outputs"), the workflow's real verdict step is run with fake job results, and the informational digest is built from fake results.json files. Literals on purpose.
 */
const root = join(__dirname, '../../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** Runs scripts/android/run-on-emulator.sh <job> with a fake adb / node: `smoke` is the exit code of smoke.mjs, `e2e` the exit codes of the successive e2e.mjs runs. */
function runShell(job: string, smoke: number, e2e: number[], env: Record<string, string> = {}) {
  const work = mkdtempSync(join(tmpdir(), 'req-smoke-'));
  const bin = join(work, 'bin');
  mkdirSync(bin);
  const out = join(work, 'out');
  const counter = join(work, 'count');
  writeFileSync(join(bin, 'adb'), '#!/usr/bin/env bash\necho fake\nexit 0\n');
  writeFileSync(
    join(bin, 'node'),
    `#!/usr/bin/env bash
case "$1" in
  *smoke.mjs) exit ${smoke} ;;
  *e2e.mjs)
    n=$(cat "${counter}" 2>/dev/null || echo 0); n=$((n + 1)); echo $n > "${counter}"
    codes=(${e2e.join(' ')})
    exit "\${codes[$((n - 1))]:-0}" ;;
esac
exit 0
`,
  );
  chmodSync(join(bin, 'adb'), 0o755);
  chmodSync(join(bin, 'node'), 0o755);
  const r = spawnSync('bash', [join(root, 'scripts/android/run-on-emulator.sh'), 'fake.apk', out, job], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env }, encoding: 'utf8' });
  const marker = join(out, `e2e-informational-${job}.txt`);
  return { status: r.status, stdout: r.stdout, marker: existsSync(marker) ? readFileSync(marker, 'utf8') : null, e2eRuns: Number(existsSync(counter) ? readFileSync(counter, 'utf8') : 0) };
}

describe('run-on-emulator.sh: required = smoke, the full e2e is informational', () => {
  it('a failed smoke exits 1 and never starts the full e2e', () => {
    const r = runShell('small-gallery', 1, [0]);
    expect(r.status).toBe(1);
    expect(r.e2eRuns).toBe(0);
  });

  it('a green smoke and a green e2e exits 0 with no marker', () => {
    const r = runShell('small-gallery', 0, [0]);
    expect(r.status).toBe(0);
    expect(r.marker).toBeNull();
  });

  it('a green smoke and a FAILED e2e exits 0 and writes the marker with the phase and its exit code', () => {
    const r = runShell('small-gallery', 0, [1]);
    expect(r.status).toBe(0);
    expect(r.marker).toBe('FAILED small/static/gallery (exit 1, attempt 1)\n');
    expect(r.stdout).toContain('INFORMATIONAL (not blocking): small/static/gallery failed');
  });

  it('the RUNNER retry is kept: exit 3 runs the slice once more, a pass on the repeat leaves no marker, a second failure is recorded with attempt 2', () => {
    const passed = runShell('small-gallery', 0, [3, 0]);
    expect(passed.e2eRuns).toBe(2);
    expect(passed.status).toBe(0);
    expect(passed.marker).toBeNull();
    const failed = runShell('small-gallery', 0, [3, 3]);
    expect(failed.e2eRuns).toBe(2);
    expect(failed.status).toBe(0);
    expect(failed.marker).toBe('FAILED small/static/gallery (exit 3, attempt 2)\n');
  });

  it('an exit 1 (a failure on a healthy runner) is never repeated', () => {
    expect(runShell('small-gallery', 0, [1, 0]).e2eRuns).toBe(1);
  });

  it('ANDROID_E2E_STRICT=1 behaves as before: a failed e2e exits 1 and writes no marker; a failed smoke still exits 1', () => {
    const e2e = runShell('small-gallery', 0, [1], { ANDROID_E2E_STRICT: '1' });
    expect(e2e.status).toBe(1);
    expect(e2e.marker).toBeNull();
    expect(runShell('small-gallery', 1, [0], { ANDROID_E2E_STRICT: '1' }).status).toBe(1);
  });

  it('ANDROID_E2E_STRICT other than "1" does not make the e2e required', () => {
    expect(runShell('small-gallery', 0, [1], { ANDROID_E2E_STRICT: '0' }).status).toBe(0);
  });

  it('an unknown job still exits 2', () => {
    expect(runShell('nope', 0, [0]).status).toBe(2);
  });
});

/** The workflow's "The verdict" step, run for real with fake job results. */
function verdict(env: { CODE: string; CHANGES: string; APK: string; EMULATOR: string }) {
  const wf = read('.github/workflows/android-e2e.yml');
  const start = wf.indexOf('- name: The verdict');
  const body = wf.slice(start).split('run: |\n')[1]!;
  const script = body
    .split('\n')
    .map((l) => l.replace(/^ {10}/, ''))
    .join('\n');
  const r = spawnSync('bash', ['-c', script], { env: { ...process.env, ...env }, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout };
}

describe('the aggregate job: red only when the smoke failed or a slice did not run', () => {
  const ok = { CODE: 'true', CHANGES: 'success', APK: 'success', EMULATOR: 'success' };
  it('is green when every slice passed its smoke (a failed full e2e does not reach the verdict at all: the emulator job succeeded)', () => {
    const r = verdict(ok);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('android-e2e is green');
  });
  it('is red when the emulator job failed (a smoke failed), was cancelled or was skipped (a slice did not run)', () => {
    for (const EMULATOR of ['failure', 'cancelled', 'skipped']) expect(verdict({ ...ok, EMULATOR }).status).toBe(1);
  });
  it('is red when the APK build failed or the change detection failed, and green for documentation only', () => {
    expect(verdict({ ...ok, APK: 'failure' }).status).toBe(1);
    expect(verdict({ ...ok, CHANGES: 'failure' }).status).toBe(1);
    expect(verdict({ CODE: 'false', CHANGES: 'success', APK: 'skipped', EMULATOR: 'skipped' }).status).toBe(0);
  });
  it('sets ANDROID_E2E_STRICT=1 for every CI run (command #49: the full e2e is required again)', () => {
    const wf = read('.github/workflows/android-e2e.yml');
    expect(wf).toContain("\n  ANDROID_E2E_STRICT: '1'\n");
  });
  it('prints the full e2e results section in the summary step and runs the screenshots step on every code change', () => {
    const wf = read('.github/workflows/android-e2e.yml');
    expect(wf).toContain('node scripts/android/summary.mjs android-e2e-all --informational | tee -a "$GITHUB_STEP_SUMMARY"');
    const shots = wf.slice(wf.indexOf('- name: The failing screenshots'), wf.indexOf('- name: The verdict'));
    expect(shots).toContain("if: needs.changes.outputs.code == 'true'\n");
    expect(shots).not.toContain('needs.emulator.result');
  });
});

const results = (ok: boolean, label = '') => ({
  profile: 'small',
  phase: 'static',
  attempt: 1,
  label,
  seconds: 60,
  relaunches: 0,
  dumpFailures: {},
  health: { start: { inputMs: 400, dumpMs: 2000 } },
  results: ok
    ? [{ name: 'screen: home', ok: true, issues: [], note: '' }]
    : [
        { name: 'screen: home', ok: true, issues: [], note: '' },
        { name: 'Racing Kings game', ok: false, issues: ['no board after 40 s', 'second'], note: '' },
        { name: 'screen: more', ok: false, issues: ['x'], note: '' },
      ],
});
function put(dir: string, name: string, body: unknown) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, 'results.json'), JSON.stringify(body));
}

describe('the INFORMATIONAL digest', () => {
  it('says passed / failed per slice with the first failing scenario and the label, under the heading', () => {
    const dir = mkdtempSync(join(tmpdir(), 'info-'));
    put(dir, 'small-static-screens1', results(true));
    put(dir, 'small-online-online', results(false, 'APP'));
    const { text, failed } = buildInformational(dir);
    expect(failed).toBe(1);
    expect(text).toContain('### Full e2e results');
    expect(text).not.toContain('INFORMATIONAL');
    expect(text).toContain('- **small-static-screens1**: passed (1 checks)');
    expect(text).toContain('- **small-online-online**: FAILED [APP]: 2 of 3 checks failed; first failing scenario `Racing Kings game`: no board after 40 s');
    expect(text).not.toContain('second');
  });

  it('uses the LAST attempt: a slice that passed on its repeat is passed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'info-'));
    put(dir, 'small-static-gallery', { ...results(false, 'RUNNER'), attempt: 1 });
    put(dir, 'small-static-gallery-retry', { ...results(true), attempt: 2 });
    const { text, failed } = buildInformational(dir);
    expect(failed).toBe(0);
    expect(text).toContain('- **small-static-gallery**: passed (1 checks)');
  });

  it('lists the marker lines, and counts a run that wrote only markers (no results.json) as failed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'info-'));
    writeFileSync(join(dir, 'e2e-informational-online.txt'), 'FAILED small/online/online (exit 1, attempt 1)\n');
    expect(readMarkers(dir)).toEqual({ online: ['FAILED small/online/online (exit 1, attempt 1)'] });
    const { text, failed } = buildInformational(dir);
    expect(failed).toBe(1);
    expect(text).toContain('marker of **online**: FAILED small/online/online (exit 1, attempt 1)');
  });

  it('says so when nothing was written, and ignores unrelated files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'info-'));
    writeFileSync(join(dir, 'run.log'), 'x');
    expect(readMarkers(dir)).toEqual({});
    const { text, failed } = buildInformational(dir);
    expect(failed).toBe(0);
    expect(text).toContain('No full end-to-end results were written.');
  });
});
