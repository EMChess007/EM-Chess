import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { logDiagnostic } from '../logic/diagnosticLog';
import type { AuthResponse, AuthUser } from '../types/auth';
import { parseApiUrlOverride, resolveApiBaseUrl } from './apiBaseUrl';
import { setOnlineBackend } from './onlineBackend';

const LOCAL_API_PORT = 3000;

// The deployed backend (Render). A full origin, HTTPS, no port suffix — Render terminates TLS
// and routes to the service internally, so appending a port here would break it. Both the
// plain HTTP client below and the Socket.IO connection (src/api/socket.ts, which imports
// API_BASE_URL from here) use this same value, so passing an "https://" URL through to
// socket.io-client automatically makes it speak "wss://" instead of "ws://" — no separate
// secure-vs-insecure switch needed for sockets.
const RENDER_BACKEND_URL = 'https://chess-app-backend-hjik.onrender.com';

/**
 * Dev-time opt-in to talk to the deployed Render backend instead of your local one — e.g. to
 * test against the real production deployment without spinning up `npm run dev` yourself.
 * Set in a .env.local file at the project root (sibling to package.json):
 *
 *   EXPO_PUBLIC_USE_ONLINE_BACKEND=true
 *
 * then restart `npx expo start` (env vars are only read at bundle time, not live-reloaded).
 * .env.local is already covered by this project's .gitignore (".env*.local"), so this is a
 * per-developer, per-machine toggle — it never gets committed or affects anyone else.
 * Ignored entirely in a release build (see resolveApiBaseUrl) — those always use Render.
 */
const USE_ONLINE_BACKEND_IN_DEV = process.env.EXPO_PUBLIC_USE_ONLINE_BACKEND === 'true';

/**
 * If auto-detection below doesn't find your computer's LAN IP (e.g. on some emulator/web
 * setups), set it here manually. Windows: open a terminal and run `ipconfig`, then use the
 * "IPv4 Address" listed under your active Wi-Fi or Ethernet adapter (e.g. "192.168.1.42").
 * Don't use "localhost" for a physical phone — that points the phone at itself, not at your
 * computer. Both devices must be on the same network.
 */
const MANUAL_LAN_IP: string | null = null;

/**
 * Expo Go sets `hostUri` to "<dev-machine-lan-ip>:<metro-port>" when the bundler was started
 * for LAN access (the normal `expo start` / `npm start` flow) — the same address the phone
 * already uses to load the JS bundle, so reusing its host here needs no manual configuration.
 */
function detectLanHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri;
  if (!hostUri) return null;
  const host = hostUri.split(':')[0];
  return host || null;
}

/**
 * EXPO_PUBLIC_API_URL (dev builds only): an explicit backend origin, e.g. `http://localhost:3191` for a private test backend (the Chaturaji browser end-to-end tests). Read at
 * bundle time like every EXPO_PUBLIC_ variable; unset = no change. The decision itself is `resolveApiBaseUrl` in apiBaseUrl.ts (pure, tested), where a release build still
 * always wins.
 */
const API_URL_OVERRIDE = process.env.EXPO_PUBLIC_API_URL;

function resolveBaseUrl(): string {
  const lanHost = Platform.OS === 'web' ? null : detectLanHost();
  if (__DEV__ && Platform.OS !== 'web' && !lanHost && !MANUAL_LAN_IP && !USE_ONLINE_BACKEND_IN_DEV && !parseApiUrlOverride(API_URL_OVERRIDE)) {
    console.warn(
      "[api/client] Could not auto-detect your computer's LAN IP. Set MANUAL_LAN_IP in src/api/client.ts."
    );
  }
  return resolveApiBaseUrl({
    dev: __DEV__,
    useOnlineBackend: USE_ONLINE_BACKEND_IN_DEV,
    apiUrlOverride: API_URL_OVERRIDE,
    platform: Platform.OS,
    lanHost,
    manualLanIp: MANUAL_LAN_IP,
    localPort: LOCAL_API_PORT,
    renderUrl: RENDER_BACKEND_URL,
  });
}

export const API_BASE_URL = resolveBaseUrl();
// The read screens wait for a sleeping server only when it is the deployed one (api/onlineBackend.ts, logic/serverStartup.ts).
setOnlineBackend(API_BASE_URL === RENDER_BACKEND_URL);
// Always visible at startup (not just per-request) so a wrong address is obvious immediately,
// before the first screen that happens to call the API is even opened.
console.log(
  `[api/client] API_BASE_URL = ${API_BASE_URL} (${API_BASE_URL === RENDER_BACKEND_URL ? 'Render backend' : 'local backend'}${__DEV__ ? '' : ' — release build'})`
);

export class ApiError extends Error {
  status: number;
  /** The server's answer came after an EARLIER try of the same request had failed without an answer (the try may have reached the app): see `registerOnce`. */
  earlierTryFailed = false;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The person pressed Cancel on a sign-in that was waiting for a sleeping server. Status 0 like every request that got no answer; screens test it with `isCancelled`, not by its words. */
export class CancelledError extends ApiError {
  constructor() {
    super(0, 'Cancelled.');
    this.name = 'CancelledError';
  }
}

export function isCancelled(err: unknown): boolean {
  return err instanceof CancelledError;
}

/**
 * Fires when an authenticated request (one that sent a token) comes back 401 — i.e. the stored
 * JWT is invalid or expired (wrong JWT_SECRET after switching local/online backend, or the token
 * simply aged out), not a login/register attempt rejected for wrong credentials (those send no
 * token and are left for the caller to handle as before). Registered once by App.tsx so every
 * screen/hook that calls `api.*` gets the same "log the user out and send them to Login" behavior
 * for free, without each call site handling it individually.
 */
let sessionExpiredHandler: (() => void) | null = null;
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  token?: string;
  /**
   * A write nobody is waiting for on screen (the game save at the end of a game, the rating sync, the puzzle-solved mark): it keeps the patient policy below, so a cold Render
   * backend still gets the result. Every load a person waits for uses the short policy; log in, register and the session check use the sign-in policy (AUTH_POLICY, 60 s).
   */
  background?: boolean;
  /** Log in, register, session check: the sign-in policy (AUTH_POLICY below), one at a time. Set only by `authRequest`. */
  auth?: boolean;
  /** Auth only: Cancel. The request in flight is aborted and the call rejects with a CancelledError. */
  signal?: AbortSignal;
  /** Auth only: called once when the request has been waiting AUTH_WAKING_NOTICE_MS - the screen then says the server is waking up. */
  onWaking?: () => void;
}

/**
 * How long a request may take, as ONE budget (offline-states branch). A screen that loads from the server shows "Can't reach the server" + Retry, so a request must END, whatever
 * is wrong: a refused connection, a firewall that drops the packets (the connection attempt just hangs), an address that does not exist, a host name that does not resolve, a
 * server that accepts and never answers, one that sends the headers and stalls, one that stalls halfway through the body.
 *
 * It used to be 12 s per attempt with two retries after 3 s and 6 s: 45 s for any hang and 9 s even for a plain refusal (measured with real servers, see
 * apiOfflineRealServers.test.ts). On the Blackview the screens spun for more than 20 s and the person gave up before they ever showed the error. The tests that passed
 * used fake timers, which skipped all of that waiting.
 *
 * `totalMs` is the hard limit for the WHOLE request including the retries and the body, `attemptMs` the limit of one try, `retryDelaysMs` the wait before each retry. A retry
 * only follows a try that FAILED (fetch rejected: refused, unreachable, DNS) and only while budget is left; a try that ran out its attempt time is the end of a short budget.
 */
interface RequestPolicy {
  totalMs: number;
  attemptMs: number;
  retryDelaysMs: readonly number[];
  /** HTTP statuses that come from the gateway in front of a sleeping service (Render answers 502/503/504 while it boots), not from the app: another try, like a failed connection. */
  retryStatuses?: readonly number[];
  /** One Diagnostic Log line for EVERY failed try, not one for the whole request (the sign-in waits for a minute: the person screenshots what happened in it). */
  logEachAttempt?: boolean;
}

/** Whole requests must be over in this time: with the screen drawing its error this is far under the 8 s the app promises. */
export const REQUEST_DEADLINE_MS = 6000;
/** One quick retry for a connection that failed at once (a server that was just restarting), not a new wait. */
const INTERACTIVE_POLICY: RequestPolicy = { totalMs: REQUEST_DEADLINE_MS, attemptMs: REQUEST_DEADLINE_MS, retryDelaysMs: [1000] };

// The Render free tier spins the whole backend down after a period of inactivity and takes up to "50 seconds or more" (Render's own wording) to wake back up on the next request,
// long enough that a request made right after can fail outright. A background write (see RequestOptions.background) rides that window out across several attempts: 12 s each,
// retried after 3 s and 6 s - the behaviour every request used to have.
const BACKGROUND_POLICY: RequestPolicy = { totalMs: 45000, attemptMs: 12000, retryDelaysMs: [3000, 6000] };

/**
 * Sign-in (log in, register, the session check): the PATIENT policy, on every backend (command #27b). The Render free tier is asleep after a quiet period and the first request takes
 * "50 seconds or more" to be answered: with the 6 s budget of a load, a person who logged in after a quiet period always saw an error. One try may wait the whole minute (Render holds
 * the connection until the service is up); a try that FAILED (reset, refused, a 502/503/504 from the gateway) is retried after 1, 2, 4, 8, 8 ... s while budget is left. Nothing
 * outlives AUTH_DEADLINE_MS, and the screen shows "Waking up the server" after AUTH_WAKING_NOTICE_MS with a Cancel.
 */
export const AUTH_DEADLINE_MS = 60000;
export const AUTH_WAKING_NOTICE_MS = 5000;
const AUTH_POLICY: RequestPolicy = {
  totalMs: AUTH_DEADLINE_MS,
  attemptMs: AUTH_DEADLINE_MS,
  retryDelaysMs: [1000, 2000, 4000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000],
  retryStatuses: [502, 503, 504],
  logEachAttempt: true,
};

function isRenderBackend(): boolean {
  return API_BASE_URL === RENDER_BACKEND_URL;
}

/** The attempt's own time ran out. `phase` says where it was stuck: still waiting for the response, or inside its body. Named AbortError like the signal's own rejection. */
class AttemptTimeout extends Error {
  readonly phase: 'headers' | 'body';
  constructor(phase: 'headers' | 'body') {
    super('Request timed out');
    this.name = 'AbortError';
    this.phase = phase;
  }
}

/**
 * One attempt, INCLUDING reading the body: the timer keeps running until the JSON is read. It used to stop at the response headers, so a server that sent the headers and
 * then stalled left `response.json()` pending for ever - the caller's spinner (Home's stats, the Analysis list) never ended and its error state never showed.
 */
async function fetchOnce(url: string, init: RequestInit, attemptMs: number, cancel?: AbortSignal): Promise<{ response: Response; data: unknown }> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let gotHeaders = false;
  // Cancel (sign-in only): aborts THIS try at once and ends the race, so nothing of it is left in flight.
  let onCancel: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    if (!cancel) return;
    onCancel = () => {
      controller.abort();
      reject(new CancelledError());
    };
    if (cancel.aborted) onCancel();
    else cancel.addEventListener('abort', onCancel, { once: true });
  });
  // Racing the timer as well as aborting: not every fetch implementation rejects a pending connect or body read when the signal fires (React Native's does not reliably).
  const timedOut = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new AttemptTimeout(gotHeaders ? 'body' : 'headers'));
    }, attemptMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...init, signal: controller.signal });
        gotHeaders = true;
        const isJson = response.headers.get('content-type')?.includes('application/json');
        const data: unknown = isJson ? await response.json().catch(() => null) : null;
        return { response, data };
      })(),
      timedOut,
      cancelled,
    ]);
  } finally {
    clearTimeout(timeoutId);
    if (cancel && onCancel) cancel.removeEventListener('abort', onCancel);
  }
}

/** The gateway in front of a sleeping service answered (502/503/504) instead of the app: a failed try, not an answer. */
class GatewayStatus extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

/** Waits `ms`, or throws a CancelledError the moment Cancel is pressed. */
function pause(ms: number, cancel?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (cancel?.aborted) return reject(new CancelledError());
    const onCancel = () => {
      clearTimeout(id);
      reject(new CancelledError());
    };
    const id = setTimeout(() => {
      cancel?.removeEventListener('abort', onCancel);
      resolve();
    }, ms);
    cancel?.addEventListener('abort', onCancel, { once: true });
  });
}

/** What a failed try looked like, for its Diagnostic Log line. */
function describeFailure(err: unknown): string {
  if (err instanceof AttemptTimeout) return err.phase === 'headers' ? 'no response' : 'the body stalled';
  if (err instanceof GatewayStatus) return `HTTP ${err.status}`;
  return `network error "${err instanceof Error ? err.message.slice(0, 60) : 'unknown'}"`;
}

/** The tries of one request inside its policy. Throws the last try's error when every one failed (an AttemptTimeout, or whatever fetch rejected with). */
async function fetchWithPolicy(
  url: string,
  init: RequestInit,
  policy: RequestPolicy,
  startedAt: number,
  tally: { tries: number },
  cancel?: AbortSignal,
  logAttempt?: (failure: string) => void,
): Promise<{ response: Response; data: unknown }> {
  let lastError: unknown = new AttemptTimeout('headers');
  for (let attempt = 0; attempt <= policy.retryDelaysMs.length; attempt++) {
    const remaining = policy.totalMs - (Date.now() - startedAt);
    if (remaining <= 0) break;
    if (cancel?.aborted) throw new CancelledError();
    console.log(`[api/client] ${init.method} ${url}${attempt > 0 ? ` (retry ${attempt})` : ''}`);
    tally.tries++;
    try {
      const result = await fetchOnce(url, init, Math.min(policy.attemptMs, remaining), cancel);
      if (policy.retryStatuses?.includes(result.response.status)) throw new GatewayStatus(result.response.status);
      return result;
    } catch (err) {
      if (err instanceof CancelledError) throw err;
      lastError = err;
      logAttempt?.(describeFailure(err));
      if (attempt < policy.retryDelaysMs.length) {
        const wait = Math.min(policy.retryDelaysMs[attempt], policy.totalMs - (Date.now() - startedAt));
        if (wait > 0) await pause(wait, cancel);
      }
    }
  }
  throw lastError;
}

/** "192.168.1.5:3000" out of "http://192.168.1.5:3000": the host the request went to, for the diagnostic line (no path, no query, no credentials). */
export function hostOf(baseUrl: string): string {
  // A base URL never carries credentials (apiBaseUrl.ts rejects them), so there is nothing to strip.
  return /^https?:\/\/([^/?#]+)/.exec(baseUrl)?.[1] ?? 'unknown';
}

/**
 * ONE line per failed request in More > Diagnostics (the person screenshots it): the host, what kind of failure, how long it took. Never the token, a body or a query.
 *   [api] GET 192.168.1.5:3000/games failed: no response, 6004 ms, 1 try
 */
function logFailure(method: string, path: string, failure: string, startedAt: number, attempts: number): void {
  logDiagnostic(`[api] ${method} ${hostOf(API_BASE_URL)}${path.split('?')[0]} failed: ${failure}, ${Date.now() - startedAt} ms, ${attempts} ${attempts === 1 ? 'try' : 'tries'}`);
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const url = `${API_BASE_URL}${path}`;
  const method = options.method ?? 'GET';
  const init: RequestInit = {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  };

  const startedAt = Date.now();
  const tally = { tries: 0 };
  let response: Response;
  let data: unknown;
  const policy = options.auth ? AUTH_POLICY : options.background ? BACKGROUND_POLICY : INTERACTIVE_POLICY;
  // The sign-in waits long enough to need a word on screen: once, after AUTH_WAKING_NOTICE_MS, if it is still waiting.
  const wakingTimer = options.auth && options.onWaking ? setTimeout(options.onWaking, AUTH_WAKING_NOTICE_MS) : undefined;
  try {
    ({ response, data } = await fetchWithPolicy(url, init, policy, startedAt, tally, options.auth ? options.signal : undefined, policy.logEachAttempt ? (failure) => logFailure(method, path, failure, startedAt, tally.tries) : undefined));
  } catch (err) {
    if (err instanceof CancelledError) {
      logDiagnostic(`[api] ${method} ${hostOf(API_BASE_URL)}${path.split('?')[0]} cancelled by the person, ${Date.now() - startedAt} ms, ${tally.tries} ${tally.tries === 1 ? 'try' : 'tries'}`);
      throw err;
    }
    if (err instanceof GatewayStatus) {
      throw new ApiError(err.status, 'The server is still starting up. Please try again in a moment.');
    }
    if (err instanceof AttemptTimeout) {
      if (!policy.logEachAttempt) logFailure(method, path, describeFailure(err), startedAt, tally.tries);
      throw new ApiError(
        0,
        options.auth ? 'The server did not answer in a minute. It may still be starting up - please try again.' : 'Request timed out. The server took too long to respond.',
      );
    }
    if (!policy.logEachAttempt) logFailure(method, path, describeFailure(err), startedAt, tally.tries);
    throw new ApiError(
      0,
      isRenderBackend()
        ? "Could not connect to the server. It may still be waking up after being idle — please try again in a moment."
        : 'Could not connect to the server. Make sure the backend is running and your phone is on the same network as your computer.'
    );
  } finally {
    clearTimeout(wakingTimer);
  }

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `Request failed (${response.status})`;
    logFailure(method, path, `HTTP ${response.status}`, startedAt, tally.tries);
    if (response.status === 401 && options.token) sessionExpiredHandler?.();
    const failed = new ApiError(response.status, message);
    failed.earlierTryFailed = tally.tries > 1;
    throw failed;
  }

  return data as T;
}

export interface GamePayload {
  opponentType: 'bot' | 'human' | 'online';
  opponentElo?: number | null;
  /** Online games only — the other player's username at the time the game was saved. */
  opponentUsername?: string | null;
  /** Online games only — which color this row's own user played, so history can say "You won"
   * instead of an ambiguous absolute "White won" (local/bot games have no fixed "you"). */
  color?: 'w' | 'b' | null;
  result: string;
  pgn: string;
  timeControl: string;
  isChess960: boolean;
  playedAt?: string;
}

export interface StoredGame extends GamePayload {
  id: string;
  userId: string;
  playedAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  rating: number;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  me: { rating: number; rank: number } | null;
}

export interface PuzzleProgress {
  userId: string;
  puzzleDate: string;
  solved: boolean;
  completedAt: string | null;
}

/** What a sign-in screen passes: Cancel, and the one-time "the server is waking up" word. */
export interface AuthCallOptions {
  signal?: AbortSignal;
  onWaking?: () => void;
}

/**
 * The slot of the ONE sign-in request that may be in flight (log in, register, session check). A second call while it is running is refused at once with a plain message rather
 * than queued or sent: two sign-ins racing each other against a server that is still booting could create two accounts (register) or leave the screen with the wrong answer.
 * Cancel frees the slot in the same instant it aborts the request, so "Cancel, then try again" is never refused.
 */
let authSlot: object | null = null;

async function authRequest<T>(method: 'GET' | 'POST', path: string, body: unknown, token: string | undefined, call: AuthCallOptions | undefined): Promise<T> {
  if (authSlot !== null) throw new ApiError(0, 'A sign-in is already in progress. Please wait for it, or cancel it first.');
  const slot = {};
  authSlot = slot;
  const release = () => {
    if (authSlot === slot) authSlot = null;
  };
  call?.signal?.addEventListener('abort', release, { once: true });
  try {
    return await request<T>(path, { method, body, token, auth: true, signal: call?.signal, onWaking: call?.onWaking });
  } finally {
    call?.signal?.removeEventListener('abort', release);
    release();
  }
}

/**
 * A register that may have created the account although the person never saw the answer (the minute ran out, Cancel, the gateway answered 504 after the app had already inserted
 * the row). The server is NOT idempotent: a second register for the same email/username is a plain 409 "already in use". So the next register for the same pair that gets that 409
 * tries a log in with the SAME password first - it succeeds only for the account this person just made - and only otherwise reports the 409. Keys are email|username, lower case; no
 * password is kept. In memory only: an app restart forgets it, and then the person simply logs in.
 */
const registerMayHaveCreated = new Set<string>();

function registerKey(email: string, username: string): string {
  return `${email.trim().toLowerCase()}|${username.trim().toLowerCase()}`;
}

async function registerOnce(email: string, username: string, password: string, call?: AuthCallOptions): Promise<AuthResponse> {
  const key = registerKey(email, username);
  try {
    const response = await authRequest<AuthResponse>('POST', '/auth/register', { email, username, password }, undefined, call);
    registerMayHaveCreated.delete(key);
    return response;
  } catch (err) {
    // A real answer from the app (a 4xx: invalid input, already in use) means this try created nothing; anything else may have.
    const answered = err instanceof ApiError && err.status >= 400 && err.status < 500;
    if (err instanceof ApiError && err.status === 409 && (registerMayHaveCreated.has(key) || err.earlierTryFailed)) {
      try {
        const existing = await authRequest<AuthResponse>('POST', '/auth/login', { email, password }, undefined, call);
        registerMayHaveCreated.delete(key);
        logDiagnostic('[api] register: the account from the earlier try already exists, signed in with it instead');
        return existing;
      } catch (loginErr) {
        if (isCancelled(loginErr)) throw loginErr;
        registerMayHaveCreated.delete(key);
        throw err; // not the account this person made: the plain "already in use" stands
      }
    }
    if (!answered) registerMayHaveCreated.add(key);
    else registerMayHaveCreated.delete(key);
    throw err;
  }
}

export const api = {
  register: registerOnce,

  login: (email: string, password: string, call?: AuthCallOptions) => authRequest<AuthResponse>('POST', '/auth/login', { email, password }, undefined, call),

  getMe: (token: string, call?: AuthCallOptions) => authRequest<AuthUser>('GET', '/users/me', undefined, token, call),

  updateRating: (token: string, category: 'bullet' | 'blitz' | 'rapid', rating: number) =>
    request<{ ok: true }>('/users/me/rating', { method: 'POST', token, body: { category, rating }, background: true }),

  getLeaderboard: (token: string, category: 'bullet' | 'blitz' | 'rapid') =>
    request<LeaderboardResponse>(`/users/leaderboard?category=${category}`, { token }),

  createGame: (token: string, game: GamePayload) =>
    request<StoredGame>('/games', { method: 'POST', body: game, token, background: true }),

  listGames: (token: string) => request<StoredGame[]>('/games', { token }),

  getPuzzleProgress: (token: string, date?: string) =>
    request<PuzzleProgress>(`/puzzles/progress${date ? `?date=${date}` : ''}`, { token }),

  markPuzzleSolved: (token: string, date?: string) =>
    request<PuzzleProgress>('/puzzles/progress', {
      method: 'POST',
      token,
      body: { puzzleDate: date, solved: true },
      background: true,
    }),
};
