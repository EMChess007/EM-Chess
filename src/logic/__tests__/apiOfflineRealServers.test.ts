import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAILURE_KINDS, GAMES_BODY, startFailing, type FailureKind, type TestServer } from '../../test/offlineServers';

// The client reads the platform and the Expo config to pick the server address; neither exists in node. A DEV build (so the explicit test address is honoured, see apiBaseUrl.ts).
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
});
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { hostUri: undefined }, expoGoConfig: undefined } }));
const { logDiagnostic } = vi.hoisted(() => ({ logDiagnostic: vi.fn() }));
vi.mock('../../logic/diagnosticLog', () => ({ logDiagnostic }));

/**
 * THE PHONE, NOT THE DOM (offline-states branch). On the Blackview the Home stats and the Analysis list spun for more than 20 s with the laptop's backend off; the earlier tests
 * (fake timers, a mocked fetch) passed because they skipped the retries' real waiting. These tests start REAL servers that fail the way a laptop that is off or firewalled
 * fails, point the real client at them and measure the real clock:
 *
 *   closed port | accepts and never answers | headers then stall | half a body then stall | non-routable address | a name that does not resolve
 *
 * Each must end as an ApiError with status 0 (the screens turn that into "Can't reach the server" + Retry) in under 8 s, and write ONE diagnostic line. The wall clock appears
 * only as the bound that turns a hang into a failure (CHECKLIST: a test asserts nothing about time except that a wait ends); the measured times are printed as a table.
 */
const BOUND_MS = 8000;
const servers: TestServer[] = [];

async function loadClient(origin: string) {
  vi.resetModules();
  process.env.EXPO_PUBLIC_API_URL = origin;
  return import('../../api/client');
}

beforeEach(() => {
  logDiagnostic.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.EXPO_PUBLIC_API_URL;
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function timed<T>(run: () => Promise<T>): Promise<{ ms: number; error: unknown; value: T | undefined }> {
  const startedAt = performance.now();
  try {
    const value = await run();
    return { ms: Math.round(performance.now() - startedAt), error: null, value };
  } catch (error) {
    return { ms: Math.round(performance.now() - startedAt), error, value: undefined };
  }
}

describe.each(FAILURE_KINDS)('the real client against: %s', (kind: FailureKind) => {
  it('fails as "unreachable" (ApiError 0) inside the bound, with one diagnostic line naming the host, the kind and the elapsed time', async () => {
    const server = await startFailing(kind);
    servers.push(server);
    const { api, ApiError } = await loadClient(server.origin);
    const { ms, error } = await timed(() => api.listGames('token'));
    console.info(`[offline-timing] ${kind}: ${ms} ms`);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as InstanceType<typeof ApiError>).status).toBe(0);
    expect(ms).toBeLessThan(BOUND_MS);
    expect(logDiagnostic).toHaveBeenCalledTimes(1);
    const line = logDiagnostic.mock.calls[0][0] as string;
    expect(line).toContain(new URL(server.origin).host);
    expect(line).toMatch(/ \d+ ms/);
  });

  it('a second try ends inside the bound as well, and succeeds once the server is back where the server can come back', async () => {
    const server = await startFailing(kind);
    servers.push(server);
    const { api } = await loadClient(server.origin);
    await timed(() => api.listGames('token'));
    await server.serving();
    const { ms, error, value } = await timed(() => api.listGames('token'));
    expect(ms).toBeLessThan(BOUND_MS);
    if (kind === 'nonRoutable' || kind === 'dns') {
      expect(error).not.toBeNull(); // nothing can come back at that address: Retry fails again, just as fast
    } else {
      expect(error).toBeNull();
      expect(value).toEqual(GAMES_BODY);
    }
  });
});
