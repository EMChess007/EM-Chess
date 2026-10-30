import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, AUTH_DEADLINE_MS, AUTH_WAKING_NOTICE_MS, CancelledError, isCancelled, setSessionExpiredHandler } from '../../api/client';

// The client reads the platform and the Expo config to pick the server address; neither exists in node (a release build: __DEV__ false).
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { hostUri: undefined }, expoGoConfig: undefined } }));
const { logDiagnostic } = vi.hoisted(() => ({ logDiagnostic: vi.fn() }));
vi.mock('../../logic/diagnosticLog', () => ({ logDiagnostic }));

/**
 * The sign-in policy, to the millisecond, with fake timers and a scripted fetch (command #27b; the REAL clock against real servers is apiAuthRealServers.test.ts). The numbers are
 * literals on purpose: a test that read them from the client could never fail when they change.
 *
 *   one sign-in budget of 60000 ms for the whole request, tries included; the waking notice at 5000 ms;
 *   a try that FAILED (a rejected fetch, a 502/503/504) is retried after 1000, 2000, 4000, 8000, 8000 ... ms; a 4xx or a 500 is an answer and is not retried;
 *   one diagnostic line per failed try; Cancel aborts the try in flight at once; never two sign-ins in flight.
 */
const realFetch = globalThis.fetch;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const SESSION = { token: 'tok', user: { id: 'u1', email: 'a@b.co', username: 'abc', createdAt: '2026-10-01T00:00:00Z' } };

interface Scripted {
  calls: Array<{ at: number; url: string; method: string; signal: AbortSignal | null }>;
}

/** Installs a fetch that answers by call number (1-based) and records when each try started (ms since this call). */
function script(handler: (n: number, init: RequestInit, url: string) => Promise<Response> | Response): Scripted {
  const startedAt = Date.now();
  const scripted: Scripted = { calls: [] };
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    scripted.calls.push({ at: Date.now() - startedAt, url: String(input), method: init?.method ?? 'GET', signal: init?.signal ?? null });
    return handler(scripted.calls.length, init ?? {}, String(input));
  }) as typeof fetch;
  return scripted;
}

/** A try that never gets an answer, but ends when its signal is aborted (as a real fetch does). */
function hanging(init: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
}

async function settledAfter(ms: number, start: () => Promise<unknown>): Promise<{ settled: boolean; value: unknown; error: unknown }> {
  const state = { settled: false, value: undefined as unknown, error: null as unknown };
  void start().then(
    (value) => {
      state.settled = true;
      state.value = value;
    },
    (error) => {
      state.settled = true;
      state.error = error;
    },
  );
  await vi.advanceTimersByTimeAsync(ms);
  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  logDiagnostic.mockReset();
});
afterEach(async () => {
  await vi.advanceTimersByTimeAsync(5 * 60 * 1000); // whatever is still pending runs out: the slot of one test never leaks into the next
  vi.useRealTimers();
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
  setSessionExpiredHandler(null);
});

const lines = (): string[] => logDiagnostic.mock.calls.map((call) => String(call[0]));

describe('the numbers', () => {
  it('a sign-in has 60000 ms and the waking notice comes at 5000 ms', () => {
    expect(AUTH_DEADLINE_MS).toBe(60000);
    expect(AUTH_WAKING_NOTICE_MS).toBe(5000);
  });
});

describe('a server that does not answer', () => {
  it('a try waits the whole minute: pending at 59999 ms, an ApiError 0 with the clear message at 60000 ms, ONE try', async () => {
    const seen = script((_n, init) => hanging(init));
    const before = await settledAfter(59999, () => api.login('a@b.co', 'password-1'));
    expect(before.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    // the same again, reading the outcome at exactly the deadline
    script((_n, init) => hanging(init));
    const at = await settledAfter(60000, () => api.login('a@b.co', 'password-1'));
    expect(at.settled).toBe(true);
    expect(at.error).toBeInstanceOf(ApiError);
    expect((at.error as ApiError).status).toBe(0);
    expect((at.error as ApiError).message).toBe('The server did not answer in a minute. It may still be starting up - please try again.');
  });

  it('says so once, at 5000 ms and not at 4999 ms', async () => {
    script((_n, init) => hanging(init));
    const onWaking = vi.fn();
    void api.login('a@b.co', 'password-1', { onWaking }).catch(() => {});
    await vi.advanceTimersByTimeAsync(4999);
    expect(onWaking).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onWaking).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(55000);
    expect(onWaking).toHaveBeenCalledTimes(1);
  });

  it('is silent when the answer comes before 5000 ms, even long after', async () => {
    script(async () => {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      return json(200, SESSION);
    });
    const onWaking = vi.fn();
    const done = await settledAfter(4000, () => api.login('a@b.co', 'password-1', { onWaking }));
    expect(done.settled).toBe(true);
    await vi.advanceTimersByTimeAsync(20000);
    expect(onWaking).not.toHaveBeenCalled();
  });
});

describe('a try that fails is tried again while the minute lasts', () => {
  it('after 1000, 2000, 4000, 8000 and 8000 ms, then succeeds', async () => {
    const seen = script((n) => (n < 6 ? Promise.reject(new TypeError('Network request failed')) : json(200, SESSION)));
    const done = await settledAfter(23000, () => api.login('a@b.co', 'password-1'));
    expect(done.settled).toBe(true);
    expect(done.value).toEqual(SESSION);
    expect(seen.calls.map((call) => call.at)).toEqual([0, 1000, 3000, 7000, 15000, 23000]);
  });

  it('gives up when the minute is spent: ten tries, the last at 55000 ms, the error at exactly 60000 ms', async () => {
    const seen = script(() => Promise.reject(new TypeError('Network request failed')));
    const before = await settledAfter(59999, () => api.login('a@b.co', 'password-1'));
    expect(before.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen.calls.map((call) => call.at)).toEqual([0, 1000, 3000, 7000, 15000, 23000, 31000, 39000, 47000, 55000]);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    script(() => Promise.reject(new TypeError('Network request failed')));
    const end = await settledAfter(60000, () => api.login('a@b.co', 'password-1'));
    expect(end.settled).toBe(true);
    expect((end.error as ApiError).status).toBe(0);
    expect((end.error as ApiError).message).toContain('Could not connect to the server');
  });

  it('writes ONE diagnostic line per failed try, with the host, the kind of failure and the running total, and never the credentials', async () => {
    script((n) => (n < 4 ? Promise.reject(new TypeError('Network request failed')) : json(200, SESSION)));
    await settledAfter(7000, () => api.login('secret.person@example.com', 'hunter2-password'));
    expect(lines()).toHaveLength(3);
    expect(lines()[0]).toMatch(/^\[api\] POST .+\/auth\/login failed: network error "Network request failed", 0 ms, 1 try$/);
    expect(lines()[1]).toMatch(/failed: network error "Network request failed", 1000 ms, 2 tries$/);
    expect(lines()[2]).toMatch(/failed: network error "Network request failed", 3000 ms, 3 tries$/);
    for (const line of lines()) {
      expect(line).not.toContain('hunter2');
      expect(line).not.toContain('secret.person');
    }
  });

  it.each([502, 503, 504])('a %i from the gateway is a failed try, not an answer', async (status) => {
    const seen = script((n) => (n < 3 ? new Response('<html>starting</html>', { status, headers: { 'content-type': 'text/html' } }) : json(200, SESSION)));
    const done = await settledAfter(3000, () => api.login('a@b.co', 'password-1'));
    expect(done.value).toEqual(SESSION);
    expect(seen.calls.map((call) => call.at)).toEqual([0, 1000, 3000]);
    expect(lines()).toHaveLength(2);
    expect(lines()[0]).toContain(`failed: HTTP ${status}, 0 ms, 1 try`);
  });

  it('a gateway that never recovers ends as an ApiError with its status and a "starting up" message at 60000 ms', async () => {
    script(() => new Response('<html>starting</html>', { status: 503, headers: { 'content-type': 'text/html' } }));
    const end = await settledAfter(60000, () => api.login('a@b.co', 'password-1'));
    expect(end.settled).toBe(true);
    expect((end.error as ApiError).status).toBe(503);
    expect((end.error as ApiError).message).toBe('The server is still starting up. Please try again in a moment.');
  });

  it.each([
    [400, 'Email and password are required'],
    [401, 'Invalid email or password'],
    [409, 'Email or username already in use'],
    [500, 'boom'],
    [404, 'not found'],
    [408, 'request timeout'],
    [429, 'slow down'],
  ])('a %i is an answer: one try, its own message, no retry', async (status, message) => {
    const seen = script(() => json(status, { error: message }));
    const end = await settledAfter(0, () => api.login('a@b.co', 'password-1'));
    expect(end.settled).toBe(true);
    expect((end.error as ApiError).status).toBe(status);
    expect((end.error as ApiError).message).toBe(message);
    expect(seen.calls).toHaveLength(1);
    expect(lines()).toEqual([expect.stringContaining(`failed: HTTP ${status}, 0 ms, 1 try`)]);
  });
});

describe('Cancel', () => {
  it('aborts the try in flight and ends the call at once as a cancellation, with one line that says so', async () => {
    const seen = script((_n, init) => hanging(init));
    const controller = new AbortController();
    const end: { error: unknown } = { error: null };
    void api.login('a@b.co', 'password-1', { signal: controller.signal }).catch((error) => {
      end.error = error;
    });
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(end.error).toBeInstanceOf(CancelledError);
    expect(isCancelled(end.error)).toBe(true);
    expect((end.error as ApiError).status).toBe(0);
    expect((end.error as ApiError).name).toBe('CancelledError');
    expect((end.error as ApiError).message).toBe('Cancelled.');
    expect(isCancelled(new ApiError(0, 'Cancelled.'))).toBe(false); // a lookalike is not a cancellation
    expect(seen.calls[0].signal?.aborted).toBe(true);
    expect(lines()).toEqual([expect.stringMatching(/\/auth\/login cancelled by the person, 1000 ms, 1 try$/)]);
  });

  it('during the wait between two tries: no second try, a cancellation', async () => {
    const seen = script(() => Promise.reject(new TypeError('Network request failed')));
    const controller = new AbortController();
    const outcome: { error: unknown } = { error: null };
    void api.login('a@b.co', 'password-1', { signal: controller.signal }).catch((error) => {
      outcome.error = error;
    });
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0); // at once: the call does not sit out the rest of its 1000 ms wait
    expect(isCancelled(outcome.error)).toBe(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(seen.calls).toHaveLength(1);
  });

  it('already cancelled before the call: nothing is sent', async () => {
    const seen = script(() => json(200, SESSION));
    const controller = new AbortController();
    controller.abort();
    const end = await settledAfter(0, () => api.login('a@b.co', 'password-1', { signal: controller.signal }));
    expect(isCancelled(end.error)).toBe(true);
    expect(seen.calls).toHaveLength(0);
  });

  it('stops the waking notice: it never comes after Cancel', async () => {
    script((_n, init) => hanging(init));
    const controller = new AbortController();
    const onWaking = vi.fn();
    void api.login('a@b.co', 'password-1', { signal: controller.signal, onWaking }).catch(() => {});
    await vi.advanceTimersByTimeAsync(2000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(20000);
    expect(onWaking).not.toHaveBeenCalled();
  });
});

describe('a finished sign-in leaves nothing listening on the Cancel signal', () => {
  /** Every 'abort' listener added to the signal minus every one removed, over a whole sign-in (a listener that fired with `once` removes itself and is not counted either way). */
  async function leftOver(handler: (n: number, init: RequestInit) => Promise<Response> | Response, ms: number): Promise<number> {
    script(handler);
    const controller = new AbortController();
    let open = 0;
    const add = controller.signal.addEventListener.bind(controller.signal);
    const remove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.addEventListener = ((type: string, listener: EventListener, options?: unknown) => {
      if (type === 'abort') open++;
      return add(type, listener, options as AddEventListenerOptions);
    }) as typeof add;
    controller.signal.removeEventListener = ((type: string, listener: EventListener, options?: unknown) => {
      if (type === 'abort') open--;
      return remove(type, listener, options as EventListenerOptions);
    }) as typeof remove;
    await settledAfter(ms, () => api.login('a@b.co', 'password-1', { signal: controller.signal }));
    return open;
  }

  it('after an answer on the first try', async () => {
    expect(await leftOver(() => json(200, SESSION), 0)).toBe(0);
  });

  it('after tries that failed, a wait between them, and an answer', async () => {
    expect(await leftOver((n) => (n < 3 ? Promise.reject(new TypeError('Network request failed')) : json(200, SESSION)), 3000)).toBe(0);
  });

  it('after the minute ran out', async () => {
    expect(await leftOver((_n, init) => hanging(init), 60000)).toBe(0);
  });
});

describe('never more than one sign-in in flight', () => {
  it('a second log in or register while one runs is refused without a request; the first is untouched; the slot is free afterwards', async () => {
    const seen = script(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return json(200, SESSION);
    });
    const first = settledAfter(0, () => api.login('a@b.co', 'password-1'));
    await vi.advanceTimersByTimeAsync(10);
    const second = await settledAfter(0, () => api.login('a@b.co', 'password-1'));
    expect(second.error).toBeInstanceOf(ApiError);
    expect((second.error as ApiError).message).toBe('A sign-in is already in progress. Please wait for it, or cancel it first.');
    const third = await settledAfter(0, () => api.register('n@b.co', 'newbie', 'password-1'));
    expect((third.error as ApiError).status).toBe(0);
    expect(seen.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect((await first).settled).toBe(true);
    const after = await settledAfter(3000, () => api.login('a@b.co', 'password-1'));
    expect(after.value).toEqual(SESSION);
  });

  it('Cancel frees the slot in the same instant: the next sign-in is sent, not refused', async () => {
    const seen = script((n, init) => (n === 1 ? hanging(init) : json(200, SESSION)));
    const controller = new AbortController();
    void api.login('a@b.co', 'password-1', { signal: controller.signal }).catch(() => {});
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    const next = await settledAfter(0, () => api.login('a@b.co', 'password-1'));
    expect(next.value).toEqual(SESSION);
    expect(seen.calls).toHaveLength(2);
  });

  it('the session check (getMe) goes through the same patient path and the same slot', async () => {
    const seen = script((n) => (n === 1 ? Promise.reject(new TypeError('Network request failed')) : json(200, SESSION.user)));
    const done = await settledAfter(1000, () => api.getMe('the-token'));
    expect(done.value).toEqual(SESSION.user);
    expect(seen.calls.map((call) => call.at)).toEqual([0, 1000]);
    expect(seen.calls[0].method).toBe('GET');
  });

  it('a 401 from the session check still ends the session', async () => {
    script(() => json(401, { error: 'expired' }));
    const handler = vi.fn();
    setSessionExpiredHandler(handler);
    await settledAfter(0, () => api.getMe('the-token'));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('the guard of a register that may have created the account is exact', () => {
  /** A register that is cancelled while the server holds it: the pair (email, username) is now "maybe created". */
  async function lose(email: string, username: string) {
    script((_n, init) => hanging(init));
    const controller = new AbortController();
    void api.register(email, username, 'password-1', { signal: controller.signal }).catch(() => {});
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
  }
  const kinds = (seen: Scripted) => seen.calls.map((call) => call.url.split('/auth/')[1]);
  const conflict = () => json(409, { error: 'Email or username already in use' });

  it('the log in it tries carries the EMAIL (and the password) - not the username', async () => {
    await lose('Mia@B.co', 'mia-the-user');
    let body = '';
    const seen = script((_n, init, url) => {
      if (url.endsWith('/auth/login')) body = String(init.body);
      return url.endsWith('/auth/register') ? conflict() : json(200, SESSION);
    });
    await settledAfter(0, () => api.register('Mia@B.co', 'mia-the-user', 'password-9'));
    expect(kinds(seen)).toEqual(['register', 'login']);
    expect(JSON.parse(body)).toEqual({ email: 'Mia@B.co', password: 'password-9' });
  });

  it('the pair is compared without regard to case: the same email in another spelling is the same account', async () => {
    await lose('Nina@B.co', 'nina');
    const seen = script((_n, _init, url) => (url.endsWith('/auth/register') ? conflict() : json(200, SESSION)));
    const end = await settledAfter(0, () => api.register('nina@b.co', 'NINA', 'password-1'));
    expect(kinds(seen)).toEqual(['register', 'login']);
    expect(end.value).toEqual(SESSION);
  });

  it('another username for the same email is another pair: a 409 stays a 409', async () => {
    await lose('pair@b.co', 'first');
    const seen = script(() => conflict());
    const end = await settledAfter(0, () => api.register('pair@b.co', 'second', 'password-1'));
    expect((end.error as ApiError).status).toBe(409);
    expect(kinds(seen)).toEqual(['register']);
  });

  it('another email for the same username is another pair: a 409 stays a 409', async () => {
    await lose('one@b.co', 'shared');
    const seen = script(() => conflict());
    const end = await settledAfter(0, () => api.register('two@b.co', 'shared', 'password-1'));
    expect((end.error as ApiError).status).toBe(409);
    expect(kinds(seen)).toEqual(['register']);
  });

  it('an ANSWER of the server (a 400) after the lost try clears it: the next 409 for the pair stays a 409', async () => {
    await lose('clear@b.co', 'clear');
    script(() => json(400, { error: 'Invalid email' }));
    await settledAfter(0, () => api.register('clear@b.co', 'clear', 'short'));
    const seen = script(() => conflict());
    const end = await settledAfter(0, () => api.register('clear@b.co', 'clear', 'password-1'));
    expect((end.error as ApiError).status).toBe(409);
    expect(kinds(seen)).toEqual(['register']);
  });

  it('a SUCCESS after the lost try clears it too', async () => {
    await lose('won@b.co', 'won');
    script(() => json(201, SESSION));
    await settledAfter(0, () => api.register('won@b.co', 'won', 'password-1'));
    const seen = script(() => conflict());
    const end = await settledAfter(0, () => api.register('won@b.co', 'won', 'password-1'));
    expect((end.error as ApiError).status).toBe(409);
    expect(kinds(seen)).toEqual(['register']);
  });
});

describe('the waking notice belongs to the sign-in alone', () => {
  it('a load cannot be given one: `onWaking` is handed to a request in exactly one place, authRequest, and only the three sign-in calls reach it', () => {
    const source = readFileSync(path.resolve(__dirname, '../../api/client.ts'), 'utf8');
    expect(source.match(/onWaking: call\?\.onWaking/g)).toHaveLength(1);
    expect(source.match(/authRequest[<(]/g)?.length).toBe(5); // its definition, register, the guard's log in, log in and the session check
  });
});

describe('the one slot, in detail', () => {
  it('a cancelled sign-in that finishes late does not free the slot of the sign-in that replaced it', async () => {
    script((n, init) => (n <= 2 ? hanging(init) : json(200, SESSION)));
    const first = new AbortController();
    void api.login('a@b.co', 'password-1', { signal: first.signal }).catch(() => {});
    await vi.advanceTimersByTimeAsync(10);
    first.abort(); // frees the slot at once
    const second = new AbortController();
    void api.login('a@b.co', 'password-1', { signal: second.signal }).catch(() => {}); // takes it
    await vi.advanceTimersByTimeAsync(10); // the first call's own cleanup has run by now
    const third = await settledAfter(0, () => api.login('a@b.co', 'password-1'));
    expect((third.error as ApiError).message).toBe('A sign-in is already in progress. Please wait for it, or cancel it first.');
    second.abort();
  });

  it('the session check holds the slot like any sign-in, and is refused while one runs', async () => {
    script((_n, init) => hanging(init));
    const running = new AbortController();
    void api.login('a@b.co', 'password-1', { signal: running.signal }).catch(() => {});
    await vi.advanceTimersByTimeAsync(10);
    const check = await settledAfter(0, () => api.getMe('the-token'));
    expect((check.error as ApiError).message).toContain('already in progress');
    running.abort();
    await vi.advanceTimersByTimeAsync(0);
    const checking = new AbortController();
    void api.getMe('the-token', { signal: checking.signal }).catch(() => {});
    await vi.advanceTimersByTimeAsync(10);
    const login = await settledAfter(0, () => api.login('a@b.co', 'password-1'));
    expect((login.error as ApiError).message).toContain('already in progress');
    checking.abort();
  });

  it('a Cancel during the wait between two tries leaves no timer running', async () => {
    script(() => Promise.reject(new TypeError('Network request failed')));
    const controller = new AbortController();
    void api.login('a@b.co', 'password-1', { signal: controller.signal }).catch(() => {});
    await vi.advanceTimersByTimeAsync(500);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('register after a try whose answer was lost', () => {
  it('the retry inside the same call gets the 409 and signs in with the same password; the account exists once', async () => {
    const seen = script((n, _init, url) => {
      if (n === 1) return Promise.reject(new TypeError('Network request failed'));
      if (url.endsWith('/auth/register')) return json(409, { error: 'Email or username already in use' });
      return json(200, SESSION);
    });
    const done = await settledAfter(1000, () => api.register('a@b.co', 'abc', 'password-1'));
    expect(done.value).toEqual(SESSION);
    expect(seen.calls.map((call) => call.url.split('/auth/')[1])).toEqual(['register', 'register', 'login']);
    expect(lines().some((line) => line.includes('the account from the earlier try already exists'))).toBe(true);
  });

  it('a 409 with no failed try before it stays a 409 and no log in is tried', async () => {
    const seen = script(() => json(409, { error: 'Email or username already in use' }));
    const end = await settledAfter(0, () => api.register('plain@b.co', 'plain', 'password-1'));
    expect((end.error as ApiError).status).toBe(409);
    expect(seen.calls).toHaveLength(1);
  });

  it('the log in of the guard fails (another password): the plain 409 is reported, and the guard is forgotten', async () => {
    let n = 0;
    const seen = script((_k, init, url) => {
      n++;
      if (n === 1) return hanging(init);
      if (url.endsWith('/auth/register')) return json(409, { error: 'Email or username already in use' });
      return json(401, { error: 'Invalid email or password' });
    });
    const controller = new AbortController();
    void api.register('guard@b.co', 'guard', 'password-1', { signal: controller.signal }).catch(() => {});
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    const end = await settledAfter(0, () => api.register('guard@b.co', 'guard', 'password-2'));
    expect((end.error as ApiError).status).toBe(409);
    expect(seen.calls.map((call) => call.url.split('/auth/')[1])).toEqual(['register', 'register', 'login']);
    // forgotten: the same 409 again does not try another log in
    const again = await settledAfter(0, () => api.register('guard@b.co', 'guard', 'password-2'));
    expect((again.error as ApiError).status).toBe(409);
    expect(seen.calls).toHaveLength(4);
  });

  it('Cancel during the guard\'s own log in is a cancellation, not a 409', async () => {
    let n = 0;
    script((_k, init, url) => {
      n++;
      if (n === 1) return hanging(init);
      if (url.endsWith('/auth/register')) return json(409, { error: 'Email or username already in use' });
      return hanging(init);
    });
    const first = new AbortController();
    void api.register('stop@b.co', 'stop', 'password-1', { signal: first.signal }).catch(() => {});
    await vi.advanceTimersByTimeAsync(10);
    first.abort();
    await vi.advanceTimersByTimeAsync(0);
    const second = new AbortController();
    const outcome: { error: unknown } = { error: null };
    void api.register('stop@b.co', 'stop', 'password-1', { signal: second.signal }).catch((error) => {
      outcome.error = error;
    });
    await vi.advanceTimersByTimeAsync(50);
    second.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(isCancelled(outcome.error)).toBe(true);
  });

  it('a server error (500) or a gateway 504 may have created the account too: the next 409 for the pair signs in; a 400 created nothing and the next 409 stays', async () => {
    for (const [first, signsIn] of [[500, true], [504, true], [400, false], [422, false], [499, false]] as const) {
      const email = `status-${first}@b.co`;
      script(() => json(first, { error: 'x' }));
      // (a 504 is retried inside the minute: let the whole call run out)
      await settledAfter(first === 504 ? 60000 : 0, () => api.register(email, `user${first}`, 'password-1'));
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      const seen = script((_n, _init, url) => (url.endsWith('/auth/register') ? json(409, { error: 'Email or username already in use' }) : json(200, SESSION)));
      const end = await settledAfter(0, () => api.register(email, `user${first}`, 'password-1'));
      expect(seen.calls.map((call) => call.url.split('/auth/')[1]), `after a ${first}`).toEqual(signsIn ? ['register', 'login'] : ['register']);
      expect(signsIn ? end.value : (end.error as ApiError).status, `after a ${first}`).toEqual(signsIn ? SESSION : 409);
    }
  });

  it('a register that was ANSWERED (success) leaves nothing behind: a later 409 for the pair is a plain 409', async () => {
    script(() => json(201, SESSION));
    await settledAfter(0, () => api.register('once@b.co', 'once', 'password-1'));
    const seen = script(() => json(409, { error: 'Email or username already in use' }));
    const end = await settledAfter(0, () => api.register('once@b.co', 'once', 'password-1'));
    expect((end.error as ApiError).status).toBe(409);
    expect(seen.calls).toHaveLength(1);
  });
});

describe('everything else keeps its own policy', () => {
  it('a load is still one 6000 ms budget and does not use the sign-in slot or notice', async () => {
    const seen = script((_n, init) => hanging(init));
    const hangingLogin = new AbortController();
    void api.login('a@b.co', 'password-1', { signal: hangingLogin.signal }).catch(() => {});
    await vi.advanceTimersByTimeAsync(10);
    const load = await settledAfter(6000, () => api.listGames('token'));
    expect(load.settled).toBe(true);
    expect((load.error as ApiError).status).toBe(0);
    expect((load.error as ApiError).message).toBe('Request timed out. The server took too long to respond.');
    expect(seen.calls.length).toBeGreaterThanOrEqual(2);
    hangingLogin.abort();
  });
});
