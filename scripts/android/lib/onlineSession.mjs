/**
 * EVERY ONLINE SCENARIO STARTS SIGNED IN (command #67d). PR #51 head acb44bb, job 136866180504 "emulator (online)": after "online: friend room" the harness's fresh signed-in app (force-stop,
 * `pm clear`, `am start -W`, keyboard sign-in) lost its `am start -W` to the 90 s adb limit ("spawnSync adb ETIMEDOUT": logcat shows `pm clear`'s own "remove task" killing the process the
 * launch had just started, 0.4 s after it started, so the launch never reported a drawn activity). The failure was only LOGGED; the app stayed cleared, i.e. signed out ("Startup session
 * check: no session found"), and the next two scenarios failed on what a signed-out app shows: "Login required" instead of the Quick Match picker, no "Create Challenge" - the long-open
 * "online flakes". Here (1) a fresh start that fails is a SETUP step retried a bounded number of times, each failed try printed as EVIDENCE; (2) before each online scenario the session is
 * READ from the More screen ("Log out" = signed in, "Log in / Sign up" = signed out) and a lost one is signed in again (EVIDENCE "session was lost: re-signed in"); only when that fails does the
 * scenario fail, and then with "harness could not sign in", not with a picker or button the signed-out app does not show.
 * Pure (the phone's verbs are passed in) so tests can drive it with a fake phone.
 */
import { findNodes } from './hierarchy.mjs';
import { onTabs } from './goHome.mjs';

/** How many tries a fresh signed-in start gets (bounded: a phone that never signs in fails the scenario, it does not hang the slice). */
export const SIGN_IN_TRIES = 3;

const SIGNED_IN_MARKERS = ['Log out', 'Log Out', 'Logout'];
const SIGNED_OUT_MARKER = 'Log in / Sign up';

/** The More screen's account row: 'in' ("Log out"), 'out' ("Log in / Sign up"), or 'unknown' (not the More screen, or an unreadable tree). */
export function sessionState(nodes) {
  if (!Array.isArray(nodes) || !onTabs(nodes)) return 'unknown';
  if (SIGNED_IN_MARKERS.some((text) => findNodes(nodes, { text }).length > 0)) return 'in';
  if (findNodes(nodes, { text: SIGNED_OUT_MARKER }).length > 0) return 'out';
  return 'unknown';
}

/**
 * Runs a SETUP step (`attempt(tryNumber)`, which throws on failure) up to `tries` times. Every failed try is printed as an EVIDENCE line, never swallowed.
 * @param {{ what: string, attempt: (n: number) => Promise<void>, tries?: number, log?: (m: string) => void, sleep?: (ms: number) => Promise<void>, gapMs?: number }} options
 * @returns {Promise<{ ok: boolean, tries: number, errors: string[] }>}
 */
export async function retrySetup({ what, attempt, tries = SIGN_IN_TRIES, log = () => {}, sleep = async () => {}, gapMs = 2000 }) {
  const errors = [];
  for (let n = 1; n <= tries; n++) {
    try {
      await attempt(n);
      if (n > 1) log(`  EVIDENCE setup: ${what} succeeded on try ${n} of ${tries}`);
      return { ok: true, tries: n, errors };
    } catch (e) {
      const message = String(e?.message ?? e).slice(0, 300);
      errors.push(message);
      log(`  EVIDENCE setup: ${what}: try ${n} of ${tries} failed: ${message}`);
      if (n < tries) await sleep(gapMs);
    }
  }
  log(`  EVIDENCE setup: ${what}: all ${tries} tries failed`);
  return { ok: false, tries, errors };
}

/**
 * Before an online scenario: reads the session (`readSession()` -> the More screen's tree; a throw counts as 'unknown') and, unless it is 'in', signs in again (`signIn(tryNumber)`, retried by
 * `retrySetup`). Throws "harness could not sign in ..." when every try fails, so the scenario fails with that message and its first step never runs.
 * @param {{ name: string, readSession: () => Promise<any[]>, signIn: (n: number) => Promise<void>, log?: (m: string) => void, sleep?: (ms: number) => Promise<void>, tries?: number, gapMs?: number }} options
 * @returns {Promise<{ state: 'in' | 'out' | 'unknown', reSignedIn: boolean, tries: number }>}
 */
export async function ensureSignedIn({ name, readSession, signIn, log = () => {}, sleep = async () => {}, tries = SIGN_IN_TRIES, gapMs = 2000 }) {
  const state = sessionState(await Promise.resolve().then(readSession).catch(() => null));
  if (state === 'in') return { state, reSignedIn: false, tries: 0 };
  log(`  EVIDENCE ${name}: the session before the scenario reads "${state}" (${state === 'out' ? 'the More screen offers "Log in / Sign up"' : 'no account row could be read'}): signing in again`);
  const out = await retrySetup({ what: `signing in again before "${name}"`, attempt: signIn, tries, log, sleep, gapMs });
  if (!out.ok) throw new Error(`harness could not sign in before the scenario (${out.tries} tries; last: ${out.errors[out.errors.length - 1] ?? '?'})`);
  log(`  EVIDENCE ${name}: session was lost: re-signed in (try ${out.tries})`);
  return { state, reSignedIn: true, tries: out.tries };
}
