import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { AuthResponse, AuthUser } from '../types/auth';

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

function resolveApiBaseUrl(): string {
  // A release build (TestFlight/Play Store/EAS production build) has no "your computer" on a
  // LAN to reach — it must always talk to the deployed backend, unconditionally.
  if (!__DEV__) return RENDER_BACKEND_URL;

  if (USE_ONLINE_BACKEND_IN_DEV) return RENDER_BACKEND_URL;

  if (Platform.OS === 'web') return `http://localhost:${LOCAL_API_PORT}`;

  const host = detectLanHost() ?? MANUAL_LAN_IP;
  if (!host) {
    console.warn(
      "[api/client] Could not auto-detect your computer's LAN IP. Set MANUAL_LAN_IP in src/api/client.ts."
    );
    return `http://localhost:${LOCAL_API_PORT}`;
  }
  return `http://${host}:${LOCAL_API_PORT}`;
}

export const API_BASE_URL = resolveApiBaseUrl();
// Always visible at startup (not just per-request) so a wrong address is obvious immediately,
// before the first screen that happens to call the API is even opened.
console.log(
  `[api/client] API_BASE_URL = ${API_BASE_URL} (${API_BASE_URL === RENDER_BACKEND_URL ? 'Render backend' : 'local backend'}${__DEV__ ? '' : ' — release build'})`
);

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
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
}

// A network that's up but whose backend never responds (host reachable, process hung/unreachable
// port with no RST) doesn't make fetch() reject on its own — without this, a caller's .catch()
// (Home's stats/recent games, GameHistoryScreen, ...) would simply never run and its loading
// spinner would spin forever. This aborts the request after a generous grace period so every
// caller's existing error handling kicks in instead. Deliberately NOT used to shorten the
// "genuinely no network" path below, which already rejects immediately on its own.
const REQUEST_TIMEOUT_MS = 12000;

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const url = `${API_BASE_URL}${path}`;
  const method = options.method ?? 'GET';
  console.log(`[api/client] ${method} ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError(0, 'Request timed out. The server took too long to respond.');
    }
    throw new ApiError(
      0,
      'Could not connect to the server. Make sure the backend is running and your phone is on the same network as your computer.'
    );
  } finally {
    clearTimeout(timeoutId);
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data: unknown = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `Request failed (${response.status})`;
    if (response.status === 401 && options.token) sessionExpiredHandler?.();
    throw new ApiError(response.status, message);
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

export const api = {
  register: (email: string, username: string, password: string) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: { email, username, password } }),

  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: { email, password } }),

  getMe: (token: string) => request<AuthUser>('/users/me', { token }),

  updateRating: (token: string, category: 'bullet' | 'blitz' | 'rapid', rating: number) =>
    request<{ ok: true }>('/users/me/rating', { method: 'POST', token, body: { category, rating } }),

  getLeaderboard: (token: string, category: 'bullet' | 'blitz' | 'rapid') =>
    request<LeaderboardResponse>(`/users/leaderboard?category=${category}`, { token }),

  createGame: (token: string, game: GamePayload) =>
    request<StoredGame>('/games', { method: 'POST', body: game, token }),

  listGames: (token: string) => request<StoredGame[]>('/games', { token }),

  getPuzzleProgress: (token: string, date?: string) =>
    request<PuzzleProgress>(`/puzzles/progress${date ? `?date=${date}` : ''}`, { token }),

  markPuzzleSolved: (token: string, date?: string) =>
    request<PuzzleProgress>('/puzzles/progress', {
      method: 'POST',
      token,
      body: { puzzleDate: date, solved: true },
    }),
};
