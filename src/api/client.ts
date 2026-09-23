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

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  token?: string;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const url = `${API_BASE_URL}${path}`;
  const method = options.method ?? 'GET';
  console.log(`[api/client] ${method} ${url}`);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(
      0,
      'Could not connect to the server. Make sure the backend is running and your phone is on the same network as your computer.'
    );
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data: unknown = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `Request failed (${response.status})`;
    throw new ApiError(response.status, message);
  }

  return data as T;
}

export interface GamePayload {
  opponentType: 'bot' | 'human';
  opponentElo?: number | null;
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
