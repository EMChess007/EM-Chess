import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureSignedIn, retrySetup, sessionState, SIGN_IN_TRIES } from '../../../scripts/android/lib/onlineSession.mjs';

/**
 * Command #67d (PR #51 head acb44bb, job 136866180504 "emulator (online)"): the fresh signed-in app after the friend room lost its `am start -W` to adb's limit ("spawnSync adb ETIMEDOUT"),
 * the failure was only logged, the app stayed cleared and signed out, and the next two scenarios failed on "Login required" / no "Create Challenge". Driven here with a fake phone (no device).
 */
type Box = [number, number, number, number];
const node = (text: string, [x1, y1, x2, y2]: Box) => ({ text, desc: '', id: '', cls: 'android.widget.TextView', pkg: 'com.emchess.app', bounds: { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1, cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) } });
const TAB_BAR = [node('Home', [54, 1209, 126, 1248]), node('Puzzles', [216, 1209, 324, 1248]), node('Analysis', [391, 1209, 509, 1248]), node('More', [594, 1209, 666, 1248])];
const MORE_SIGNED_IN = [node('View Achievements', [40, 100, 680, 160]), node('Log out', [40, 200, 680, 260]), node('Diagnostics', [272, 1003, 449, 1044]), ...TAB_BAR];
const MORE_SIGNED_OUT = [node('View Achievements', [40, 100, 680, 160]), node('Log in / Sign up', [40, 200, 680, 260]), node('Diagnostics', [272, 1003, 449, 1044]), ...TAB_BAR];
const LOGIN_REQUIRED = [node('Login required', [40, 500, 680, 560]), node('OK', [500, 700, 600, 760])];

/** A fake phone: signed in or not; a fresh signed-in start whose first `failFirst` tries throw what adb threw (ETIMEDOUT), every later one signs in. */
function phone({ signedIn, failFirst = 0, alwaysFail = false }: { signedIn: boolean; failFirst?: number; alwaysFail?: boolean }) {
  const events: string[] = [];
  const lines: string[] = [];
  let state = signedIn;
  let tries = 0;
  return {
    events,
    lines,
    get signedIn() {
      return state;
    },
    readSession: async () => {
      events.push('read session');
      return state ? MORE_SIGNED_IN : MORE_SIGNED_OUT;
    },
    signIn: async () => {
      tries++;
      events.push(`sign in #${tries}`);
      if (alwaysFail || tries <= failFirst) {
        state = false; // pm clear ran: the app is cleared, i.e. signed out
        throw new Error('spawnSync adb ETIMEDOUT');
      }
      state = true;
    },
    // the scenario's first step: the Quick Match picker is there only when signed in (signed out, the app shows "Login required")
    firstStep: async () => {
      events.push('first step');
      return state ? 'picker' : LOGIN_REQUIRED[0].text;
    },
    log: (m: string) => void lines.push(m),
    sleep: async () => {},
  };
}

describe('sessionState reads the More screen account row', () => {
  it('"Log out" = in, "Log in / Sign up" = out, anything else = unknown', () => {
    expect(sessionState(MORE_SIGNED_IN)).toBe('in');
    expect(sessionState(MORE_SIGNED_OUT)).toBe('out');
    expect(sessionState(LOGIN_REQUIRED)).toBe('unknown'); // no tab bar: not the More screen
    expect(sessionState([...TAB_BAR])).toBe('unknown');
    expect(sessionState(null)).toBe('unknown');
  });
});

describe('a fresh signed-in start is a retried SETUP step (retrySetup)', () => {
  it('an adb timeout on the first fresh start: the retry succeeds, and both tries are EVIDENCE lines', async () => {
    const p = phone({ signedIn: false, failFirst: 1 });
    const out = await retrySetup({ what: 'a fresh signed-in app after the friend room', attempt: p.signIn, log: p.log, sleep: p.sleep });
    expect(out).toEqual({ ok: true, tries: 2, errors: ['spawnSync adb ETIMEDOUT'] });
    expect(p.signedIn).toBe(true);
    expect(p.events).toEqual(['sign in #1', 'sign in #2']);
    expect(p.lines).toEqual([
      '  EVIDENCE setup: a fresh signed-in app after the friend room: try 1 of 3 failed: spawnSync adb ETIMEDOUT',
      '  EVIDENCE setup: a fresh signed-in app after the friend room succeeded on try 2 of 3',
    ]);
  });

  it('is bounded: three tries (a literal), then ok false with every error, never silent', async () => {
    expect(SIGN_IN_TRIES).toBe(3);
    const p = phone({ signedIn: false, alwaysFail: true });
    const out = await retrySetup({ what: 'x', attempt: p.signIn, log: p.log, sleep: p.sleep });
    expect(out.ok).toBe(false);
    expect(out.tries).toBe(3);
    expect(p.events).toEqual(['sign in #1', 'sign in #2', 'sign in #3']);
    expect(p.lines.filter((l) => l.startsWith('  EVIDENCE setup: x: try '))).toHaveLength(3);
    expect(p.lines[p.lines.length - 1]).toBe('  EVIDENCE setup: x: all 3 tries failed');
  });

  it('a first try that works prints nothing', async () => {
    const p = phone({ signedIn: false });
    const out = await retrySetup({ what: 'x', attempt: p.signIn, log: p.log, sleep: p.sleep });
    expect(out).toEqual({ ok: true, tries: 1, errors: [] });
    expect(p.lines).toEqual([]);
  });
});

/** The scenario wrapper's order, as `scenario` in e2e.mjs runs it: the session check, then the body's first step. */
async function onlineScenario(p: ReturnType<typeof phone>, name: string) {
  await ensureSignedIn({ name, readSession: p.readSession, signIn: p.signIn, log: p.log, sleep: p.sleep });
  return p.firstStep();
}

describe('every online scenario starts signed in (ensureSignedIn)', () => {
  it('a signed-out app before an online scenario: re-signed in BEFORE the first step, with the EVIDENCE line', async () => {
    const p = phone({ signedIn: false });
    const shown = await onlineScenario(p, 'online: Quick Match chips and controls');
    expect(p.events).toEqual(['read session', 'sign in #1', 'first step']);
    expect(shown).toBe('picker');
    expect(p.lines).toContain('  EVIDENCE online: Quick Match chips and controls: session was lost: re-signed in (try 1)');
  });

  it('a signed-out app whose first re-sign-in times out: retried, still before the first step', async () => {
    const p = phone({ signedIn: false, failFirst: 1 });
    const shown = await onlineScenario(p, 'online: 4-seat friend room');
    expect(p.events).toEqual(['read session', 'sign in #1', 'sign in #2', 'first step']);
    expect(shown).toBe('picker');
    expect(p.lines).toContain('  EVIDENCE online: 4-seat friend room: session was lost: re-signed in (try 2)');
  });

  it('signed in: no sign-in, no EVIDENCE, straight to the first step', async () => {
    const p = phone({ signedIn: true });
    await onlineScenario(p, 'online: friend room');
    expect(p.events).toEqual(['read session', 'first step']);
    expect(p.lines).toEqual([]);
  });

  it('an unreadable session (readSession throws) is signed in again too', async () => {
    const p = phone({ signedIn: false });
    await ensureSignedIn({ name: 'online: x', readSession: async () => Promise.reject(new Error('null root node returned by UiTestAutomationBridge')), signIn: p.signIn, log: p.log, sleep: p.sleep });
    expect(p.signedIn).toBe(true);
    expect(p.lines[0]).toContain('reads "unknown"');
  });

  it('re-sign-in failing every try: the scenario fails with "harness could not sign in" and its first step never runs', async () => {
    const p = phone({ signedIn: false, alwaysFail: true });
    await expect(onlineScenario(p, 'online: Quick Match chips and controls')).rejects.toThrow(/^harness could not sign in .*3 tries; last: spawnSync adb ETIMEDOUT/);
    expect(p.events).not.toContain('first step');
  });
});

describe('e2e.mjs wires it (source pins)', () => {
  const src = readFileSync(join(__dirname, '../../../scripts/android/e2e.mjs'), 'utf8');
  const fn = (name: string) => src.slice(src.indexOf(`async function ${name}(`), src.indexOf('\n}\n', src.indexOf(`async function ${name}(`)));

  it('scenario() checks the session of an online scenario BEFORE its body', () => {
    const body = fn('scenario');
    const check = body.indexOf("if (onlineAccount && name.startsWith('online: ')) await ensureOnlineSession(dev, name);");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(body.indexOf('await body();'));
    expect(body.indexOf('try {')).toBeLessThan(check); // inside the try: a failed sign-in is the scenario's recorded failure
  });

  it("toHome's afresh start is the signed-in fresh start while the online slice runs", () => {
    const body = fn('toHome');
    expect(body).toMatch(/if \(onlineAccount\) \{\s*if \(!\(await freshSignedIn\(dev, onlineAccount, 'for toHome', \{ endOnHome: true \}\)\)\) throw new Error\('harness could not sign in/);
  });

  it('freshSignedIn is a retried setup step, and online() sets the account for its scenarios and clears it after', () => {
    expect(fn('freshSignedIn')).toContain('await retrySetup({');
    const online = fn('online');
    expect(online).toContain('onlineAccount = account;');
    expect(online).toMatch(/finally \{\s*onlineAccount = null;/);
    expect(fn('ensureOnlineSession')).toContain('await ensureSignedIn({');
  });
});
