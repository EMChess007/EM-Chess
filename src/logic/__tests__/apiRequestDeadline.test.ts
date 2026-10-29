import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, hostOf, REQUEST_DEADLINE_MS } from '../../api/client';

// The client reads the platform and the Expo config to pick the server address; neither exists in node (a release build: __DEV__ false).
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { hostUri: undefined }, expoGoConfig: undefined } }));
const { logDiagnostic } = vi.hoisted(() => ({ logDiagnostic: vi.fn() }));
vi.mock('../../logic/diagnosticLog', () => ({ logDiagnostic }));

/**
 * The request budget, to the millisecond, with fake timers (offline-states branch; the REAL clock against real servers is apiOfflineRealServers.test.ts). The numbers are literals
 * on purpose: a test that read them from the client could never fail when they change.
 *
 *   a load (everything a person waits for): ONE budget of 6000 ms for the whole request, body included; one quick retry (after 1000 ms) only for a try that FAILED, never for one
 *   that hung;
 *   a background write (game save, rating sync, puzzle mark): the patient policy a cold Render backend needs - 12 s tries, retried after 3 s and 6 s, 45 s in all.
 */
const realFetch = globalThis.fetch;
const TOKEN = 'secret-token-value';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** A response whose headers arrive at once and whose body never does. */
function stalledBodyResponse(): Response {
  const stream = new ReadableStream({ start() {} });
  return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
}

/** Runs `start`, advances the fake clock `ms`, and says whether the call had settled by then. */
async function settledAfter(ms: number, start: () => Promise<unknown>): Promise<{ settled: boolean; error: unknown }> {
  let settled = false;
  let error: unknown = null;
  const outcome = start().then(
    () => {
      settled = true;
    },
    (e) => {
      settled = true;
      error = e;
    },
  );
  await vi.advanceTimersByTimeAsync(ms);
  const result = { settled, error };
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
  await outcome;
  return result;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  logDiagnostic.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
});

describe('a load ends inside one budget of 6000 ms', () => {
  it('the budget is 6000 ms', () => {
    expect(REQUEST_DEADLINE_MS).toBe(6000);
  });

  it('a body that never arrives: still pending at 5999 ms, an ApiError 0 at 6000 ms, one try only', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return stalledBodyResponse();
    }) as typeof fetch;
    const before = await settledAfter(5999, () => api.listGames(TOKEN));
    expect(before.settled).toBe(false);
    calls = 0;
    const at = await settledAfter(6000, () => api.listGames(TOKEN));
    expect(at.settled).toBe(true);
    expect(at.error).toBeInstanceOf(ApiError);
    expect((at.error as ApiError).status).toBe(0);
    expect((at.error as ApiError).message).toBe('Request timed out. The server took too long to respond.');
    expect(calls).toBe(1);
  });

  it('a request that never answers at all ends the same way, with one try', async () => {
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      return new Promise(() => {});
    }) as typeof fetch;
    const at = await settledAfter(6000, () => api.listGames(TOKEN));
    expect(at.settled).toBe(true);
    expect((at.error as ApiError).status).toBe(0);
    expect(calls).toBe(1);
  });

  it('a refused connection retries once after 1000 ms and ends at about 1000 ms, not 9000', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new TypeError('Network request failed');
    }) as typeof fetch;
    const early = await settledAfter(999, () => api.listGames(TOKEN));
    expect(early.settled).toBe(false);
    calls = 0;
    const at = await settledAfter(1000, () => api.listGames(TOKEN));
    expect(at.settled).toBe(true);
    expect((at.error as ApiError).status).toBe(0);
    expect((at.error as ApiError).message).toBe('Could not connect to the server. It may still be waking up after being idle — please try again in a moment.'); // this is a release build (Render)
    expect(calls).toBe(2);
  });

  it('a refusal followed by a hang: the retry gets only what is left of the 6000 ms', async () => {
    let calls = 0;
    globalThis.fetch = ((): Promise<Response> => {
      calls++;
      if (calls === 1) return Promise.reject(new TypeError('Network request failed'));
      return new Promise(() => {});
    }) as typeof fetch;
    const early = await settledAfter(5999, () => api.listGames(TOKEN));
    expect(early.settled).toBe(false);
    calls = 0;
    const at = await settledAfter(6000, () => api.listGames(TOKEN));
    expect(at.settled).toBe(true);
    expect(calls).toBe(2);
  });

  it('a retry that works returns the data', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) throw new TypeError('Network request failed');
      return jsonResponse([{ id: 'g1' }]);
    }) as typeof fetch;
    const outcome = api.listGames(TOKEN);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(outcome).resolves.toEqual([{ id: 'g1' }]);
    expect(logDiagnostic).not.toHaveBeenCalled(); // it did not fail
  });

  it('a normal answer still comes back (the deadline does not break the happy path)', async () => {
    globalThis.fetch = (async () => jsonResponse([{ id: 'g1' }])) as typeof fetch;
    await expect(api.listGames(TOKEN)).resolves.toEqual([{ id: 'g1' }]);
    expect(vi.getTimerCount()).toBe(0); // no timer is left running behind a finished request
  });

  it('a server error keeps its status and its own words (not turned into a timeout), and is logged', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'Database is down' }), { status: 500, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const error = await api.listGames(TOKEN).then(
      () => null,
      (e) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
    expect(error.message).toBe('Database is down');
    expect(logDiagnostic).toHaveBeenCalledTimes(1);
    expect(logDiagnostic.mock.calls[0][0]).toBe('[api] GET chess-app-backend-hjik.onrender.com/games failed: HTTP 500, 0 ms, 1 try');
  });
});

describe('the diagnostic line: one per failed request, host + kind + elapsed, no secret', () => {
  it('no response: "no response", 6000 ms, 1 try', async () => {
    globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;
    await settledAfter(6000, () => api.listGames(TOKEN));
    expect(logDiagnostic).toHaveBeenCalledTimes(1);
    expect(logDiagnostic.mock.calls[0][0]).toBe('[api] GET chess-app-backend-hjik.onrender.com/games failed: no response, 6000 ms, 1 try');
  });

  it('a stalled body says so', async () => {
    globalThis.fetch = (async () => stalledBodyResponse()) as typeof fetch;
    await settledAfter(6000, () => api.listGames(TOKEN));
    expect(logDiagnostic.mock.calls[0][0]).toBe('[api] GET chess-app-backend-hjik.onrender.com/games failed: the body stalled, 6000 ms, 1 try');
  });

  it('a network error names the error and counts both tries', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Network request failed');
    }) as typeof fetch;
    await settledAfter(1000, () => api.listGames(TOKEN));
    expect(logDiagnostic).toHaveBeenCalledTimes(1);
    expect(logDiagnostic.mock.calls[0][0]).toBe('[api] GET chess-app-backend-hjik.onrender.com/games failed: network error "Network request failed", 1000 ms, 2 tries');
  });

  it('a long error message is cut at 60 characters', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('x'.repeat(100));
    }) as typeof fetch;
    await settledAfter(1000, () => api.listGames(TOKEN));
    expect(logDiagnostic.mock.calls[0][0]).toContain(`network error "${'x'.repeat(60)}"`);
  });

  it('never carries the token, and drops the query string', async () => {
    globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;
    await settledAfter(6000, () => api.getPuzzleProgress(TOKEN, '2026-10-01'));
    const line = logDiagnostic.mock.calls[0][0] as string;
    expect(line).not.toContain(TOKEN);
    expect(line).not.toContain('2026-10-01');
    expect(line).toContain('/puzzles/progress failed');
  });
});

describe('the request is really aborted when its budget ends', () => {
  it('fetch gets an AbortSignal, and it is aborted at 6000 ms (not before)', async () => {
    let signal: AbortSignal | undefined;
    globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => {});
    }) as typeof fetch;
    const outcome = api.listGames(TOKEN).catch(() => null);
    await vi.advanceTimersByTimeAsync(5999);
    expect(signal).toBeDefined();
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    await outcome;
  });
});

describe('hostOf (the host in the diagnostic line)', () => {
  it('is the host and port of the base URL, without scheme, path or query', () => {
    expect(hostOf('http://192.168.1.5:3000')).toBe('192.168.1.5:3000');
    expect(hostOf('https://chess-app-backend-hjik.onrender.com')).toBe('chess-app-backend-hjik.onrender.com');
    expect(hostOf('http://localhost:3000/some/path')).toBe('localhost:3000');
    expect(hostOf('http://host.example?x=1')).toBe('host.example');
    expect(hostOf('http://host.example#frag')).toBe('host.example');
  });
  it('is "unknown" for something that is not an http(s) URL', () => {
    expect(hostOf('not a url')).toBe('unknown');
    expect(hostOf('')).toBe('unknown');
  });
});

describe('a background write keeps the patient policy (a cold Render backend still gets the game save)', () => {
  it('createGame: three tries of 12 s, retried after 3 s and 6 s, over at 45000 ms', async () => {
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      return new Promise(() => {});
    }) as typeof fetch;
    const game = { opponentType: 'bot', result: '1-0', pgn: '1. e4', timeControl: '5+0', isChess960: false } as const;
    const early = await settledAfter(44999, () => api.createGame(TOKEN, game));
    expect(early.settled).toBe(false);
    calls = 0;
    const at = await settledAfter(45000, () => api.createGame(TOKEN, game));
    expect(at.settled).toBe(true);
    expect((at.error as ApiError).status).toBe(0);
    expect(calls).toBe(3);
  });

  it('updateRating and markPuzzleSolved are background writes too', async () => {
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      return new Promise(() => {});
    }) as typeof fetch;
    await settledAfter(45000, () => api.updateRating(TOKEN, 'blitz', 1500));
    expect(calls).toBe(3);
    calls = 0;
    await settledAfter(45000, () => api.markPuzzleSolved(TOKEN, '2026-10-01'));
    expect(calls).toBe(3);
  });

  it('log in is NOT patient: it ends at 6000 ms like a load', async () => {
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      return new Promise(() => {});
    }) as typeof fetch;
    const at = await settledAfter(6000, () => api.login('a@b.c', 'pw'));
    expect(at.settled).toBe(true);
    expect(calls).toBe(1);
  });
});
