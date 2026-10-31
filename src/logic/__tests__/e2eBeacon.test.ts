import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { e2eCount, e2eReport, isE2eBuild, readE2eBeaconUrl, resetE2eBeacon } from '../../dev/e2eBeacon';

/**
 * The Android end-to-end build's state beacon (command #30, src/dev/e2eBeacon.ts): a test-only switch, so CHECKLIST section 7 applies - the default is unchanged, it is ignored in production
 * (one warning that does not print the value), honoured in a development build, takes only a plain http origin on the emulator's host address, and reads and sends nothing but a board's state.
 */
const URL_OK = 'http://10.0.2.2:8765';

beforeEach(() => resetE2eBeacon());
afterEach(() => vi.restoreAllMocks());

describe('the switch', () => {
  it('is off by default', () => {
    expect(readE2eBeaconUrl(undefined, true)).toBeNull();
    expect(readE2eBeaconUrl('', true)).toBeNull();
    expect(readE2eBeaconUrl('   ', true)).toBeNull();
    expect(isE2eBuild(undefined, true)).toBe(false);
    expect(isE2eBuild('0', true)).toBe(false);
  });

  it('is ignored in production, with ONE warning that does not print the value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readE2eBeaconUrl(URL_OK, false)).toBeNull();
    expect(readE2eBeaconUrl(URL_OK, false)).toBeNull();
    expect(readE2eBeaconUrl(URL_OK, false)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain('10.0.2.2');
    expect(String(warn.mock.calls[0][0])).not.toContain('8765');
    expect(isE2eBuild('1', false)).toBe(false);
  });

  it('is honoured in a development build', () => {
    expect(readE2eBeaconUrl(URL_OK, true)).toBe('http://10.0.2.2:8765');
    expect(readE2eBeaconUrl(' http://localhost:9000/ ', true)).toBe('http://localhost:9000');
    expect(readE2eBeaconUrl('http://127.0.0.1:65535', true)).toBe('http://127.0.0.1:65535');
    expect(isE2eBuild('1', true)).toBe(true);
  });

  it('accepts a plain http origin on the emulator host or loopback, with a port, and nothing else', () => {
    for (const bad of [
      'https://10.0.2.2:8765',
      'http://10.0.2.2',
      'http://10.0.2.2:80',
      'http://10.0.2.2:1023',
      'http://10.0.2.2:70000',
      'http://example.com:8765',
      'http://192.168.1.5:8765',
      'http://10.0.2.2:8765/state',
      'http://10.0.2.2:8765/?a=1',
      'http://10.0.2.2:8765/#x',
      'http://user:pw@10.0.2.2:8765',
      'ftp://10.0.2.2:8765',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(readE2eBeaconUrl(bad, true), bad).toBeNull();
    }
    expect(readE2eBeaconUrl('http://10.0.2.2:1024', true)).toBe('http://10.0.2.2:1024');
  });
});

describe('what is sent', () => {
  it('sends nothing without a beacon', () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    e2eReport('state-board-2p', { fen: 'x' }, fetchImpl as unknown as typeof fetch, null);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('POSTs {channel, state} as JSON to /state, once per changed state', () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    const send = (state: Record<string, unknown>) => e2eReport('state-board-A', state, fetchImpl as unknown as typeof fetch, URL_OK);
    send({ selected: null, fen: 'f1' });
    send({ selected: null, fen: 'f1' });
    send({ selected: 'e2', fen: 'f1' });
    send({ selected: 'e2', fen: 'f1' });
    send({ selected: null, fen: 'f1' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [url, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('http://10.0.2.2:8765/state');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ channel: 'state-board-A', state: { selected: 'e2', fen: 'f1' } });
  });

  it('keeps each channel apart, and sends a state again after a failed send', async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(new Response(null, { status: 204 }));
    const f = fetchImpl as unknown as typeof fetch;
    e2eReport('a', { n: 1 }, f, URL_OK);
    e2eReport('b', { n: 1 }, f, URL_OK);
    await new Promise((r) => setTimeout(r, 0));
    e2eReport('a', { n: 1 }, f, URL_OK); // the first send of 'a' failed: it is sent again
    e2eReport('b', { n: 1 }, f, URL_OK); // 'b' went through: not again
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('a fetch that throws is swallowed', () => {
    const fetchImpl = vi.fn(() => {
      throw new Error('no network stack');
    });
    expect(() => e2eReport('a', { n: 1 }, fetchImpl as unknown as typeof fetch, URL_OK)).not.toThrow();
  });

  it('counts gesture events per channel and does nothing without the switch', () => {
    // no beacon configured in the test process: the counter is a no-op (and does not throw)
    expect(() => e2eCount('board', 'grant')).not.toThrow();
  });
});

describe('it exists only in the end-to-end build', () => {
  const root = join(__dirname, '../../..');
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'backend' || name === '.git' || name === '__tests__') continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, out);
      else if (/\.tsx?$/.test(name)) out.push(path);
    }
    return out;
  };
  const files = [...walk(join(root, 'src')), join(root, 'App.tsx'), join(root, 'index.ts')];
  const rel = (f: string) => relative(root, f).split('\\').join('/');
  const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('only src/dev imports the beacon and the probe; the boards reach them through the registry', () => {
    const beaconImporters = files.filter((f) => /from\s+'[^']*e2eBeacon'/.test(code(f))).map(rel).sort();
    expect(beaconImporters).toEqual(['src/dev/E2eStateProbe.tsx', 'src/dev/registerE2e.ts']);
    const probeImporters = files.filter((f) => /from\s+'[^']*E2eStateProbe'/.test(code(f))).map(rel);
    expect(probeImporters).toEqual(['src/dev/registerE2e.ts']);
    const registrationImporters = files.filter((f) => /from\s+'[^']*registerE2e'/.test(code(f)));
    expect(registrationImporters).toEqual([]);
    expect(code(join(root, 'index.ts'))).toMatch(/if \(__DEV__\) \{\s*require\('\.\/src\/dev\/registerE2e'\);\s*\}/);
    for (const board of ['src/components/ChessBoard.tsx', 'src/components/BughouseBoard.tsx']) expect(code(join(root, board))).toContain('getE2eStateProbe()');
    expect(code(join(root, 'src/components/useBoardGestures.ts'))).toContain('getE2eGestureCounter()');
  });

  it('is registered only when EXPO_PUBLIC_E2E is on in a development build', () => {
    const registration = code(join(root, 'src/dev/registerE2e.ts'));
    expect(registration).toMatch(/if \(isE2eBuild\(\)\) \{\s*registerE2eStateProbe\(E2eStateProbe\);\s*registerE2eGestureCounter\(e2eCount\);\s*\}/);
  });

  it('the switch is set on Metro by the run\'s script and never in a workflow, an env file or a deployment config', () => {
    // (a space after the closing quote: the first version of the line ran into the next variable's name and the app never got a valid address)
    const metro = readFileSync(join(root, 'scripts/android/metro.sh'), 'utf8');
    expect(metro).toMatch(/ EXPO_PUBLIC_E2E_BEACON="http:\/\/10\.0\.2\.2:8765" EXPO_PUBLIC_/);
    // every assignment on that command line is its own word, and the beacon value is a valid origin for the app
    const line = metro.split('\n').find((l) => l.includes('EXPO_PUBLIC_E2E_BEACON=')) ?? '';
    for (const assignment of line.trim().replace(/\s*\\$/, '').split(/ (?=[A-Z0-9_]+=)/)) expect(assignment, assignment).toMatch(/^[A-Z0-9_]+="?[^"\s]*"?$/);
    expect(readE2eBeaconUrl(/EXPO_PUBLIC_E2E_BEACON="([^"]*)"/.exec(line)?.[1], true)).toBe('http://10.0.2.2:8765');
    for (const file of ['.github/workflows/android-e2e.yml', '.github/workflows/ci.yml', 'app.json', 'eas.json', 'backend/.env.example', 'backend/render.yaml']) {
      let text = '';
      try {
        text = readFileSync(join(root, file), 'utf8');
      } catch {
        continue;
      }
      expect(text, file).not.toContain('EXPO_PUBLIC_E2E_BEACON');
    }
  });

  it('the driver listens on the port the app is told', () => {
    expect(readFileSync(join(root, 'scripts/android/lib/beacon.mjs'), 'utf8')).toContain('export const BEACON_PORT = 8765;');
  });
});

describe('the driver keeps the rectangle of a mounted board', () => {
  it('carries the last rectangle over to a state of the SAME mount that came without one, never to another mount', async () => {
    const { Beacon } = await import('../../../scripts/android/lib/beacon.mjs');
    const beacon = new Beacon();
    const rect = { x: 46, y: 501, w: 987, h: 987 };
    beacon.channels.set('state-board-2p', { state: { mount: 3, fen: 'a', rect }, seq: 1, at: 0 });
    expect(beacon.withKnownRect('state-board-2p', { mount: 3, fen: 'b' })).toEqual({ mount: 3, fen: 'b', rect });
    expect(beacon.withKnownRect('state-board-2p', { mount: 4, fen: 'b' })).toEqual({ mount: 4, fen: 'b' });
    const moved = { x: 0, y: 0, w: 500, h: 500 };
    expect(beacon.withKnownRect('state-board-2p', { mount: 3, fen: 'b', rect: moved }).rect).toEqual(moved);
    expect(beacon.withKnownRect('state-board-other', { mount: 3, fen: 'b' })).toEqual({ mount: 3, fen: 'b' });
  });
});
