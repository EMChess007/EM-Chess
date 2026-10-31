/**
 * DEV ONLY, and only for the Android end-to-end run (command #30, TESTING.md section 45): the app tells the driver its own state, so the run no longer has to read it from a screen it
 * cannot trust. Why: on the game screens the accessibility tree that `uiautomator dump` returns was the PREVIOUS screen's (the dump waits for an idle UI, fails on a screen that keeps
 * repainting, and the file it leaves behind is the old one), and the photograph fallback could not find the board. The position, the side to move, the selected square, the board's
 * rectangle on the screen and the touch counters of the gesture layer come from here instead.
 *
 * CHECKLIST section 7 (a knob that exists for tests must not exist in production):
 *   - ONE reader (`readE2eBeaconUrl`), an opt-in name that says what it does (EXPO_PUBLIC_E2E_BEACON), set only on Metro's own process by scripts/android/metro.sh;
 *   - ignored unless `__DEV__` (a release bundle contains none of it: callers guard with `__DEV__`, a literal false there), with ONE warning that does not print the value;
 *   - the value must be a plain http origin on a loopback or emulator-host address with a port, nothing else (no path, no credentials): the app cannot be pointed at an arbitrary server;
 *   - nothing is read from the user, the account or the backend; the payload is the position and the geometry of a board.
 */

/** The hosts the driver can be reached at from an emulator (10.0.2.2) or through `adb reverse` (localhost). */
const ALLOWED_HOSTS = new Set(['10.0.2.2', 'localhost', '127.0.0.1']);

let warned = false;

/** `__DEV__`, read defensively (a test runner without the React Native global is not a development build either). */
function isDevBuild(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

/** The beacon's origin, or null when the switch is off, invalid, or this is not a development build. */
export function readE2eBeaconUrl(value: string | undefined = process.env.EXPO_PUBLIC_E2E_BEACON, dev: boolean = isDevBuild()): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  if (!dev) {
    if (!warned) {
      warned = true;
      console.warn('EXPO_PUBLIC_E2E_BEACON is ignored outside a development build.');
    }
    return null;
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:') return null;
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || url.pathname !== '/') return null;
  if (!ALLOWED_HOSTS.has(url.hostname)) return null;
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  return url.origin;
}

/** Whether this build is the Android end-to-end build (it also draws the invisible state probes). */
export function isE2eBuild(env: string | undefined = process.env.EXPO_PUBLIC_E2E, dev: boolean = isDevBuild()): boolean {
  return dev && env === '1';
}

const lastSent = new Map<string, string>();
const counters = new Map<string, Record<string, number>>();

/** Sends the latest state of one channel ("board-2p", "board-A", ...) to the driver. Identical consecutive states are not sent twice; a failed send is forgotten (the next state replaces it). */
export function e2eReport(channel: string, state: Record<string, unknown>, fetchImpl: typeof fetch = fetch, url: string | null = readE2eBeaconUrl()): void {
  if (url === null) return;
  const body = JSON.stringify({ channel, state });
  if (lastSent.get(channel) === body) return;
  lastSent.set(channel, body);
  try {
    void fetchImpl(`${url}/state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }).catch(() => lastSent.delete(channel));
  } catch {
    lastSent.delete(channel);
  }
}

/** Counts an event of a gesture layer ("grant", "release", "tap") and reports the counts of the channel. */
export function e2eCount(channel: string, event: string, extra: Record<string, unknown> = {}): void {
  if (readE2eBeaconUrl() === null) return;
  const now = { ...(counters.get(channel) ?? {}), [event]: (counters.get(channel)?.[event] ?? 0) + 1 };
  counters.set(channel, now);
  e2eReport(`gestures-${channel}`, { ...now, ...extra });
}

/** Forgets what was sent (tests). */
export function resetE2eBeacon(): void {
  lastSent.clear();
  counters.clear();
  warned = false;
}
