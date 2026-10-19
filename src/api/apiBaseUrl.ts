/**
 * Which backend the app talks to - the decision behind `API_BASE_URL` (src/api/client.ts), as a pure function so it can be tested without Expo.
 *
 * Order, first match wins:
 *   1. A RELEASE build always uses the deployed backend. Nothing below can change that, `apiUrlOverride` included.
 *   2. `apiUrlOverride` (the build-time env variable `EXPO_PUBLIC_API_URL`, dev only): an explicit server, e.g. a private test backend on another port. Added for the
 *      browser end-to-end tests (Chaturaji W4), which need the web build to reach THEIR backend and not port 3000 (the developer's own) or Render. Unset or invalid = ignored,
 *      so nothing changes for anyone who does not set it.
 *   3. `useOnlineBackend` (EXPO_PUBLIC_USE_ONLINE_BACKEND=true): the deployed backend, from a dev build.
 *   4. The web build: localhost on the local port. 5. Native dev: the computer's LAN address (auto-detected, or the manual one), else localhost.
 */

export interface ApiBaseUrlInputs {
  /** `__DEV__`: false in a release build. */
  dev: boolean;
  /** EXPO_PUBLIC_USE_ONLINE_BACKEND === 'true'. */
  useOnlineBackend: boolean;
  /** EXPO_PUBLIC_API_URL as given (may be undefined, empty or garbage). */
  apiUrlOverride: string | undefined;
  platform: string;
  /** The LAN host Expo Go was loaded from, if any. */
  lanHost: string | null;
  manualLanIp: string | null;
  localPort: number;
  renderUrl: string;
}

/**
 * A usable override: a plain `http://` or `https://` origin (host, optional port) and nothing else - no path, query, fragment or credentials (a URL with a password in it
 * must never be accepted, logged or sent anywhere). Returns the origin without a trailing slash, or null.
 */
export function parseApiUrlOverride(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // EQUIVALENT-MUTANT NOTE (W4 set): dropping the empty check changes nothing - `new URL('')` throws and the catch below answers null (pinned in apiBaseUrl.test.ts).
  if (trimmed === '') return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return null;
  // EQUIVALENT-MUTANT NOTE (W4 set): the `=== ''` half is unreachable for an http(s) URL - its pathname is never empty ("http://h" has "/", pinned in apiBaseUrl.test.ts).
  if (url.pathname !== '/' && url.pathname !== '') return null;
  return url.origin;
}

export function resolveApiBaseUrl(inputs: ApiBaseUrlInputs): string {
  if (!inputs.dev) return inputs.renderUrl;
  const override = parseApiUrlOverride(inputs.apiUrlOverride);
  if (override) return override;
  if (inputs.useOnlineBackend) return inputs.renderUrl;
  if (inputs.platform === 'web') return `http://localhost:${inputs.localPort}`;
  const host = inputs.lanHost ?? inputs.manualLanIp;
  return host ? `http://${host}:${inputs.localPort}` : `http://localhost:${inputs.localPort}`;
}
