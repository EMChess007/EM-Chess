import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startAuthServer, startRefusedThenServing, type AuthServer } from '../../../scripts/browser/auth-servers.mjs';

// The client reads the platform and the Expo config to pick the server address; neither exists in node. A DEV build (so the explicit test address is honoured, see apiBaseUrl.ts).
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
});
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { hostUri: undefined }, expoGoConfig: undefined } }));
const { logDiagnostic } = vi.hoisted(() => ({ logDiagnostic: vi.fn() }));
vi.mock('../../logic/diagnosticLog', () => ({ logDiagnostic }));

/**
 * LOG IN / SIGN UP AGAINST A SLEEPING SERVER, WITH REAL SERVERS AND THE REAL CLOCK (command #27b). The free-tier backend on Render is asleep after a quiet period and the first
 * request waits "50 seconds or more": the sign-in used to share the 6 s budget of a load and always failed there. Real local servers (scripts/browser/auth-servers.mjs) wake up
 * after 40 s, never wake, answer 503 while booting, or create the account and lose the answer; the real client is pointed at each.
 *
 * The wall clock appears in two kinds of place only: as the bound that turns a hang into a failure, and in the printed table of measured times. The one lower bound asserted is the
 * server's own: nothing can be answered before the server wakes. Waits for "the server has seen the request" end on that condition.
 */
let servers: Array<{ close(): Promise<void> }> = [];

async function loadClient(origin: string) {
  vi.resetModules();
  process.env.EXPO_PUBLIC_API_URL = origin;
  return import('../../api/client');
}

async function until(condition: () => boolean, boundMs = 10000): Promise<void> {
  const end = performance.now() + boundMs;
  while (!condition()) {
    if (performance.now() > end) throw new Error('the condition never came true');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function timed<T>(run: () => Promise<T>): Promise<{ ms: number; error: unknown; value: T | undefined }> {
  const startedAt = performance.now();
  try {
    const value = await run();
    return { ms: Math.round(performance.now() - startedAt), error: null, value };
  } catch (error) {
    return { ms: Math.round(performance.now() - startedAt), error, value: undefined };
  }
}

const track = <T extends { close(): Promise<void> }>(server: T): T => {
  servers.push(server);
  return server;
};

beforeEach(() => {
  logDiagnostic.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.EXPO_PUBLIC_API_URL;
  await Promise.all(servers.map((server) => server.close()));
  servers = [];
});

const lines = (): string[] => logDiagnostic.mock.calls.map((call) => String(call[0]));

describe('a server that is asleep', () => {
  it('starts answering only after 40 s: log in succeeds on the first try, the waking notice comes once, nothing else is in flight', async () => {
    const server = track(await startAuthServer({ answerAfterMs: 40000 })) as AuthServer;
    const { api } = await loadClient(server.origin);
    const wakingAt: number[] = [];
    const startedAt = performance.now();
    const { ms, error, value } = await timed(() => api.login('known@example.com', 'password-1', { onWaking: () => wakingAt.push(Math.round(performance.now() - startedAt)) }));
    console.info(`[auth-timing] hold 40 s: logged in after ${ms} ms, waking notice at ${wakingAt.join(',')} ms, requests ${server.requests.length}`);
    expect(error).toBeNull();
    expect(value?.user.username).toBe('known');
    expect(wakingAt).toHaveLength(1);
    expect(wakingAt[0]).toBeGreaterThanOrEqual(4900); // a timer cannot fire early: the notice is not before the fifth second
    expect(wakingAt[0]).toBeLessThan(20000); // hang detector
    expect(ms).toBeGreaterThanOrEqual(39000); // nothing could be answered before the server woke up
    expect(ms).toBeLessThan(60000);
    expect(server.requests).toHaveLength(1); // one patient try, not a pile of short ones
    expect(server.maxConcurrent).toBe(1);
    expect(logDiagnostic).not.toHaveBeenCalled(); // a wait that ends in an answer is not a failure
  }, 100000);

  it('a port that REFUSES for 40 s and then starts: log in succeeds, one diagnostic line per failed try, never two requests open at once', async () => {
    const sleeping = track(await startRefusedThenServing(40000));
    const { api } = await loadClient(sleeping.origin);
    const { ms, error, value } = await timed(() => api.login('known@example.com', 'password-1'));
    console.info(`[auth-timing] refused 40 s: logged in after ${ms} ms with ${lines().length} failed tries`);
    expect(error).toBeNull();
    expect(value?.user.username).toBe('known');
    expect(ms).toBeGreaterThanOrEqual(39000);
    expect(ms).toBeLessThan(60000);
    expect(lines().length).toBeGreaterThanOrEqual(4);
    for (const line of lines()) {
      expect(line).toContain(new URL(sleeping.origin).host);
      expect(line).toContain('/auth/login failed: network error');
      expect(line).not.toContain('password');
      expect(line).not.toContain('known@example.com');
    }
    expect(sleeping.server?.maxConcurrent).toBe(1);
  }, 100000);

  it('that NEVER answers: a clear error at one minute, one waking notice, one try, one diagnostic line', async () => {
    const server = track(await startAuthServer({ neverAnswer: true })) as AuthServer;
    const { api, ApiError } = await loadClient(server.origin);
    let notices = 0;
    const { ms, error } = await timed(() => api.login('known@example.com', 'password-1', { onWaking: () => notices++ }));
    console.info(`[auth-timing] never answers: error after ${ms} ms`);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as InstanceType<typeof ApiError>).status).toBe(0);
    expect((error as Error).message).toBe('The server did not answer in a minute. It may still be starting up - please try again.');
    expect(ms).toBeGreaterThanOrEqual(59000);
    expect(ms).toBeLessThan(75000); // hang detector
    expect(notices).toBe(1);
    expect(server.requests).toHaveLength(1);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toContain('/auth/login failed: no response');
    expect(lines()[0]).toContain('1 try');
  }, 100000);

  it('that answers 503 for 6 s (the gateway while the service boots): log in succeeds, one diagnostic line per 503, the tries never overlap', async () => {
    const server = track(await startAuthServer({ gateway503ForMs: 6000 })) as AuthServer;
    const { api } = await loadClient(server.origin);
    const { ms, error, value } = await timed(() => api.login('known@example.com', 'password-1'));
    console.info(`[auth-timing] 503 for 6 s: logged in after ${ms} ms, ${lines().length} failed tries`);
    expect(error).toBeNull();
    expect(value?.user.username).toBe('known');
    expect(lines().length).toBeGreaterThanOrEqual(2);
    for (const line of lines()) expect(line).toContain('failed: HTTP 503');
    expect(server.requests).toHaveLength(lines().length + 1);
    expect(server.maxConcurrent).toBe(1);
  }, 60000);
});

describe('Cancel and the one request in flight', () => {
  it('Cancel aborts the request the server is holding, ends the call at once as a cancellation, and frees the slot for the next sign-in', async () => {
    const server = track(await startAuthServer({ neverAnswer: true })) as AuthServer;
    const { api, isCancelled } = await loadClient(server.origin);
    const controller = new AbortController();
    let notices = 0;
    const first = timed(() => api.login('known@example.com', 'password-1', { signal: controller.signal, onWaking: () => notices++ }));
    await until(() => server.requests.length === 1);
    controller.abort();
    const { error } = await first;
    expect(isCancelled(error)).toBe(true);
    await until(() => server.abandoned === 1); // the socket really closed: the client is not still waiting on it
    expect(lines().some((line) => line.includes('cancelled by the person'))).toBe(true);
    expect(lines().filter((line) => line.includes('failed:'))).toHaveLength(0);

    server.set({});
    const again = await timed(() => api.login('known@example.com', 'password-1'));
    expect(again.error).toBeNull(); // the slot was free
    expect(server.requests).toHaveLength(2);
    expect(server.maxConcurrent).toBe(1);
    expect(notices).toBe(0);
  }, 30000);

  it('a second sign-in while one is running is refused at once and never reaches the server; the first is untouched', async () => {
    const server = track(await startAuthServer({ answerAfterMs: 4000 })) as AuthServer;
    const { api, ApiError } = await loadClient(server.origin);
    const first = timed(() => api.login('known@example.com', 'password-1'));
    await until(() => server.requests.length === 1);
    const second = await timed(() => api.login('known@example.com', 'password-1'));
    expect(second.error).toBeInstanceOf(ApiError);
    expect((second.error as Error).message).toContain('already in progress');
    const third = await timed(() => api.register('new@example.com', 'newbie', 'password-2'));
    expect(third.error).toBeInstanceOf(ApiError);
    expect(server.requests).toHaveLength(1);
    const done = await first;
    expect(done.error).toBeNull();
    expect(server.maxConcurrent).toBe(1);
    // and the slot is free again afterwards
    const after = await timed(() => api.login('known@example.com', 'password-1'));
    expect(after.error).toBeNull();
  }, 30000);
});

describe('register never makes a second account', () => {
  it('Cancel after the server created the account: the next register for the same pair signs in with it instead of failing with "already in use"', async () => {
    const server = track(await startAuthServer({ registerAnswerDelayMs: 30000 })) as AuthServer;
    const { api, isCancelled } = await loadClient(server.origin);
    const controller = new AbortController();
    const first = timed(() => api.register('Nina@Example.com', 'nina', 'password-9', { signal: controller.signal }));
    await until(() => server.accounts.size === 1); // the account exists, the answer never reached the phone
    controller.abort();
    expect(isCancelled((await first).error)).toBe(true);

    server.set({});
    const { error, value } = await timed(() => api.register('Nina@Example.com', 'nina', 'password-9'));
    expect(error).toBeNull();
    expect(value?.user.username).toBe('nina');
    expect(server.accounts.size).toBe(1);
    expect(server.requests.map((request) => request.url)).toEqual(['/auth/register', '/auth/register', '/auth/login']);
    expect(lines().some((line) => line.includes('the account from the earlier try already exists'))).toBe(true);
  }, 30000);

  it('a connection reset after the server created the account: the retry inside the same call gets the 409 and signs in with the same password', async () => {
    const server = track(await startAuthServer({ dropFirstRegisterAnswer: true })) as AuthServer;
    const { api } = await loadClient(server.origin);
    const { ms, error, value } = await timed(() => api.register('olga@example.com', 'olga', 'password-9'));
    console.info(`[auth-timing] register, answer dropped once: signed in after ${ms} ms`);
    expect(error).toBeNull();
    expect(value?.user.email).toBe('olga@example.com');
    expect(server.accounts.size).toBe(1);
    expect(server.requests.map((request) => request.url)).toEqual(['/auth/register', '/auth/register', '/auth/login']);
    // one line for the lost answer (the failed try) and one for the 409 the retry got; the sign-in that followed failed nowhere
    expect(lines().filter((line) => line.includes('failed: network error'))).toHaveLength(1);
    expect(lines().filter((line) => line.includes('failed: HTTP 409'))).toHaveLength(1);
  }, 30000);

  it('an account somebody else made stays a plain 409: no sign-in is tried when no earlier try of ours failed, and none succeeds with another password', async () => {
    const server = track(await startAuthServer({})) as AuthServer;
    const { api, ApiError } = await loadClient(server.origin);
    await api.register('pat@example.com', 'pat', 'password-A');
    const plain = await timed(() => api.register('pat@example.com', 'pat', 'password-B'));
    expect(plain.error).toBeInstanceOf(ApiError);
    expect((plain.error as InstanceType<typeof ApiError>).status).toBe(409);
    expect(server.requests.some((request, index) => index > 0 && request.url === '/auth/login')).toBe(false);

    // after an earlier try of ours that may have created it, a DIFFERENT password still ends in the 409
    server.set({ registerAnswerDelayMs: 30000 });
    const controller = new AbortController();
    const hanging = timed(() => api.register('quinn@example.com', 'quinn', 'password-C', { signal: controller.signal }));
    await until(() => server.accounts.has('quinn@example.com'));
    controller.abort();
    await hanging;
    server.set({});
    const wrong = await timed(() => api.register('quinn@example.com', 'quinn', 'password-D'));
    expect((wrong.error as InstanceType<typeof ApiError>).status).toBe(409);
    expect(server.accounts.size).toBe(2);
  }, 30000);
});
