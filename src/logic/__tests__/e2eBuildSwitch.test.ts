import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { patch as patchCleartext } from '../../../scripts/android/patch-cleartext.mjs';
import { isE2eBuild, readE2eBeaconUrl, resetE2eBeacon } from '../../dev/e2eBeacon';

/**
 * THE ONE BUILD-TIME TEST SWITCH OF THE RELEASE-MODE ANDROID RUN (command #46, CHECKLIST section 7): EXPO_PUBLIC_E2E_BUILD === '1' opens the gate (`__DEV__` || the switch) of the e2e helpers in a
 * release bundle (no Metro, `__DEV__` false). It must never reach production: opt-in name, exactly the value "1" (a finite value; anything else is off), set only by scripts/android/build-apk.sh on the
 * Gradle process, never in eas.json / app.json / app.config.js / .env* / package.json / any workflow, and a production bundle (switch absent) contains none of the helpers and none of the test URLs.
 */
const root = join(__dirname, '../../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const NAME = 'EXPO_PUBLIC_E2E_BUILD';
const GATE = "process.env.EXPO_PUBLIC_E2E_BUILD === '1'";

describe('the switch is read in four places, always as the literal comparison with "1"', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (name === '__tests__' || name === 'node_modules') return [];
      return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx|js|mjs|cjs)$/.test(name) ? [full] : [];
    });
  const rel = (f: string) => relative(root, f).split('\\').join('/');

  it('only index.ts, api/client.ts, AppText.tsx and dev/e2eBeacon.ts mention it, each with the exact comparison', () => {
    const files = [...walk(join(root, 'src')), join(root, 'App.tsx'), join(root, 'index.ts')];
    const mentions = files.filter((f) => readFileSync(f, 'utf8').includes(NAME)).map(rel).sort();
    expect(mentions).toEqual(['index.ts', 'src/api/client.ts', 'src/components/AppText.tsx', 'src/dev/e2eBeacon.ts']);
    for (const f of mentions) {
      const uses = readFileSync(join(root, f), 'utf8')
        .split('\n')
        .filter((l) => l.includes(NAME) && !/^\s*(\/\/|\*|\/\*)/.test(l));
      expect(uses.length, f).toBeGreaterThan(0);
      for (const line of uses) expect(line, `${f}: ${line}`).toContain(GATE);
    }
  });

  it('index.ts loads registerE2e only under the gate, and the gate is written out there (an imported constant is not folded, the require would stay in a production bundle)', () => {
    expect(read('index.ts')).toContain(`if (__DEV__ || ${GATE}) {\n  require('./src/dev/registerE2e');\n}`);
  });

  it('the API URL override and the "dev" decision of the API client use the gate; the override is not even read without it', () => {
    const client = read('src/api/client.ts');
    expect(client).toContain(`const E2E_RELEASE_BUILD = ${GATE};`);
    expect(client).toContain('const API_URL_OVERRIDE = __DEV__ || E2E_RELEASE_BUILD ? process.env.EXPO_PUBLIC_API_URL : undefined;');
    expect(client).toContain('dev: __DEV__ || E2E_RELEASE_BUILD,');
  });
});

describe('the default is unchanged, and only the exact value "1" opens the gate in a build that is not a development build', () => {
  const g = globalThis as unknown as { __DEV__?: boolean };
  const before = g.__DEV__;
  afterEach(() => {
    vi.unstubAllEnvs();
    if (before === undefined) delete g.__DEV__;
    else g.__DEV__ = before;
    resetE2eBeacon();
  });
  const releaseWith = (value: string | undefined) => {
    g.__DEV__ = false;
    if (value === undefined) vi.stubEnv(NAME, undefined as unknown as string);
    else vi.stubEnv(NAME, value);
    vi.stubEnv('EXPO_PUBLIC_E2E', '1');
  };

  it('switch absent, empty or any other value: a release bundle ignores the beacon URL and the e2e build flag, with ONE warning that does not print the value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const value of [undefined, '', '0', 'true', 'TRUE', 'yes', '2', ' 1', '1 ', '01', 'on']) {
      releaseWith(value);
      expect(readE2eBeaconUrl('http://10.0.2.2:8765'), String(value)).toBeNull();
      expect(isE2eBuild('1'), String(value)).toBe(false);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain('10.0.2.2');
    warn.mockRestore();
  });

  it('switch "1": a release bundle (`__DEV__` false) honours the beacon URL and the e2e build flag - nothing else about the validation changes', () => {
    releaseWith('1');
    expect(readE2eBeaconUrl('http://10.0.2.2:8765')).toBe('http://10.0.2.2:8765');
    expect(readE2eBeaconUrl('http://example.com:8765')).toBeNull(); // still only the emulator host / loopback
    expect(readE2eBeaconUrl('http://10.0.2.2:8765/state')).toBeNull();
    expect(isE2eBuild('1')).toBe(true);
    expect(isE2eBuild('0')).toBe(false); // EXPO_PUBLIC_E2E === '1' is still needed for the probes
  });

  it('a development build is unchanged by the switch', () => {
    g.__DEV__ = true;
    vi.stubEnv(NAME, undefined as unknown as string);
    expect(readE2eBeaconUrl('http://10.0.2.2:8765')).toBe('http://10.0.2.2:8765');
  });
});

describe('the switch is set by exactly one build step and by no deployment config', () => {
  it('build-apk.sh sets it, in release mode only, together with the test URL and on the Gradle process only', () => {
    const script = read('scripts/android/build-apk.sh')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    const lines = script.split('\n').filter((l) => l.includes(`${NAME}=`));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`env ${NAME}=1 `);
    expect(lines[0]).toContain('EXPO_PUBLIC_API_URL="http://10.0.2.2:3000"');
    expect(lines[0]).toContain('EXPO_PUBLIC_E2E_BEACON="http://10.0.2.2:8765"');
    expect(script).not.toMatch(new RegExp(`export\\s+${NAME}`));
    // the debug branch (and the prebuild before both) never sees it: the only assignment sits between `if [ "$mode" = "release" ]` and `else`
    const releaseBranch = script.slice(script.indexOf('if [ "$mode" = "release" ]'), script.indexOf('\nelse\n'));
    expect(releaseBranch).toContain(`${NAME}=1`);
    expect(script.slice(0, script.indexOf('if [ "$mode" = "release" ]'))).not.toMatch(new RegExp(`${NAME}=`));
    expect(script.slice(script.indexOf('\nelse\n'))).not.toContain(NAME);
  });

  it('no workflow, eas.json, app.json, app.config.js, package.json, .env* or backend config names it', () => {
    const files = readdirSync(join(root, '.github/workflows')).map((f) => `.github/workflows/${f}`);
    files.push('eas.json', 'app.json', 'app.config.js', 'package.json', 'scripts/android/metro.sh', 'scripts/android/run-on-emulator.sh', 'backend/.env.example', 'backend/render.yaml');
    for (const name of readdirSync(root)) if (/^\.env/.test(name)) files.push(name);
    for (const file of files) {
      let text = '';
      try {
        text = read(file);
      } catch {
        continue;
      }
      // (a workflow may NAME the variable in a comment that says it is not set there: only an assignment or a value counts)
      const assigned = text.split('\n').filter((l) => l.includes(NAME) && !/^\s*#/.test(l));
      expect(assigned, file).toEqual([]);
    }
  });

  it('the workflow names the build MODE only, keeps Metro to the debug mode, and puts the mode in the APK cache key with the sources', () => {
    const wf = read('.github/workflows/android-e2e.yml');
    expect(wf).toContain("E2E_APK_MODE: ${{ github.event.inputs.debug_build == 'true' && 'debug' || 'release' }}");
    expect(wf).toMatch(/key: apk-\$\{\{ env\.E2E_APK_MODE \}\}-e2ebuild1-v\d+-\$\{\{ hashFiles\([^)]*'src\/\*\*'[^)]*'scripts\/android\/build-apk\.sh'[^)]*\) \}\}/);
    expect(wf).toMatch(/name: Start Metro[^\n]*\n\s*if: env\.E2E_APK_MODE == 'debug'/);
    expect(wf).toMatch(/name: Stop Metro\n\s*if: always\(\) && env\.E2E_APK_MODE == 'debug'/);
    expect(wf).toContain('bash scripts/android/build-apk.sh apk-cache');
    expect(wf).not.toContain('app-debug.apk');
  });

  it('the run still uses the debug-signed, x86_64 APK: release mode adds cleartext http to the GENERATED manifest only', () => {
    const script = read('scripts/android/build-apk.sh');
    expect(script).toContain('assembleRelease -PreactNativeArchitectures=x86_64');
    expect(script).toContain('node scripts/android/patch-cleartext.mjs android/app/src/main/AndroidManifest.xml');
    const manifest = '<manifest><application android:name=".MainApplication" android:label="x"></application></manifest>';
    const once = patchCleartext(manifest);
    expect(once).toContain('<application android:usesCleartextTraffic="true" android:name=".MainApplication"');
    expect(patchCleartext(once)).toBe(once); // idempotent
    expect(() => patchCleartext('<manifest/>')).toThrow(/template changed/);
    for (const f of ['app.json', 'eas.json']) expect(read(f)).not.toMatch(/usesCleartextTraffic/i);
  });
});

/**
 * THE PRODUCTION BUNDLE (the proof): `expo export` for Android - the same Metro + Babel + minifier a release build and EAS use (`--no-bytecode` only so the text can be searched; Hermes compiles THIS
 * text) - with the test values in the environment but the switch OFF must contain none of the helpers and none of the test URLs; with the switch ON the same markers must be there, so a marker that
 * simply stopped existing cannot make the absence check pass for nothing.
 */
describe('a bundle built without the switch contains none of the e2e helpers and none of the test URLs', () => {
  const MARKERS = {
    'the test API URL': 'http://10.0.2.2:3000',
    'the beacon origin': '10.0.2.2:8765',
    "the beacon's warning text": 'ignored outside a development build',
    "the state probe's accessibility label": 'e2e-state-',
  };

  const exportBundle = (outDir: string, switchOn: boolean): Promise<string> =>
    new Promise((resolve, reject) => {
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const key of Object.keys(env)) if (/^EXPO_PUBLIC_(E2E|API_URL|USE_ONLINE_BACKEND)/.test(key)) delete env[key];
      Object.assign(env, { EXPO_PUBLIC_API_URL: 'http://10.0.2.2:3000', EXPO_PUBLIC_E2E_BEACON: 'http://10.0.2.2:8765', EXPO_PUBLIC_E2E: '1', EXPO_NO_TELEMETRY: '1', EXPO_OFFLINE: '1', CI: '1' });
      if (switchOn) env[NAME] = '1';
      const child = spawn('npx', ['expo', 'export', '--platform', 'android', '--no-bytecode', '--output-dir', outDir], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let log = '';
      child.stdout.on('data', (d) => (log += d));
      child.stderr.on('data', (d) => (log += d));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(`expo export failed (${code}): ${log.slice(-1500)}`));
        const dir = join(outDir, '_expo/static/js/android');
        const bundles = readdirSync(dir).filter((f) => f.endsWith('.js'));
        if (bundles.length !== 1) return reject(new Error(`expected one bundle in ${dir}, found ${bundles.join(', ')}`));
        resolve(readFileSync(join(dir, bundles[0]), 'utf8'));
      });
    });

  it('switch OFF: no marker; switch ON: every marker', async () => {
    const work = mkdtempSync(join(tmpdir(), 'e2e-switch-'));
    try {
      const off = await exportBundle(join(work, 'off'), false);
      const on = await exportBundle(join(work, 'on'), true);
      // the control first: the markers exist when the switch is on
      for (const [what, marker] of Object.entries(MARKERS)) expect(on.includes(marker), `switch ON should contain ${what}`).toBe(true);
      for (const [what, marker] of Object.entries(MARKERS)) expect(off.includes(marker), `switch OFF must not contain ${what}`).toBe(false);
      // and the switch's own name never ends up in a bundle as a value to read at run time
      expect(off).not.toContain(NAME);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 480_000);
});
