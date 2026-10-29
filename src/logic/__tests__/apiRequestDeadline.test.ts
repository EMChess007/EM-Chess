import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../api/client';

// The client reads the platform and the Expo config to pick the server address; neither exists in node (a release build: __DEV__ false).
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { hostUri: undefined }, expoGoConfig: undefined } }));

/**
 * The request deadline covers the BODY (Android text-fit branch, "infinite spinner" bug): the timer used to stop when the response HEADERS arrived, so a server that sent the
 * headers and then stalled left `response.json()` pending for ever, and the caller's spinner (Home's stats, the Analysis list) never ended. Fake timers: no test waits.
 */
const realFetch = globalThis.fetch;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** A response whose headers arrive at once and whose body never does. */
function stalledBodyResponse(): Response {
  const stream = new ReadableStream({ start() {} });
  return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
});

describe('api requests give up in finite time', () => {
  it('a body that never arrives ends in "timed out" after the retries, as an ApiError with status 0', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return stalledBodyResponse();
    }) as typeof fetch;
    const outcome = api.listGames('token').then(
      () => 'resolved',
      (error) => error,
    );
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    const error = await outcome;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.message).toBe('Request timed out. The server took too long to respond.');
    expect(calls).toBe(3); // the first try and the two retries
  });

  it('a request that never answers at all ends the same way', async () => {
    globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;
    const outcome = api.listGames('token').then(
      () => 'resolved',
      (error) => error,
    );
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    const error = await outcome;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
  });

  it('a normal answer still comes back (the deadline does not break the happy path)', async () => {
    globalThis.fetch = (async () => jsonResponse([{ id: 'g1' }])) as typeof fetch;
    await expect(api.listGames('token')).resolves.toEqual([{ id: 'g1' }]);
  });

  it('a server error keeps its status and its own words (not turned into a timeout)', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'Database is down' }), { status: 500, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const error = await api.listGames('token').then(
      () => null,
      (e) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
    expect(error.message).toBe('Database is down');
  });
});
