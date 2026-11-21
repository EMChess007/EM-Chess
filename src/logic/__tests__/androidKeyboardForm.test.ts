import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIELD_WAIT_MS, FORM_TRIES, describeField, fieldHolds, fillForm } from '../../../scripts/android/lib/keyboardForm.mjs';

/**
 * Command #67e (PR #51 head f84902c, job 136874638637 "emulator (online)", "online: sign in through the keyboard"): the email field held "e2e-small-78589a0c@examp" + "Pwcb8b06bbffae", the
 * password field was empty, the server answered 401. The harness touched the password field and typed while the email was still arriving. Driven here with a fake phone (no device).
 */
const EMAIL = 'e2e-small-78589a0c@example.test';
const PASSWORD = 'Pwcb8b06bbffae12';
const FIELDS = [
  { name: 'email', value: EMAIL },
  { name: 'password', value: PASSWORD, secret: true },
];

/**
 * A fake phone with the real keyboard's two faults: `input text` arrives in `chunks` pieces (one per tree read), a touch while text is still arriving is LOST (the focus stays), and new text
 * typed while old text is arriving replaces the old text's rest (that is how "...@examp" + "Pw..." came to be). `dropRestOnce`: the first email's rest never arrives at all.
 */
function phone({ chunks = 2, dropRestOnce = false }: { chunks?: number; dropRestOnce?: boolean } = {}) {
  const fields = [
    { text: '', hint: 'Email', secret: false },
    { text: '', hint: 'Password', secret: true },
  ];
  const events: string[] = [];
  const lines: string[] = [];
  let focused = -1;
  let pending: { i: number; rest: string[] } | null = null;
  let dropped = false;
  let clock = 0;
  const pump = () => {
    if (!pending) return;
    fields[pending.i].text += pending.rest.shift();
    if (pending.rest.length === 0) pending = null;
  };
  const shown = () => fields.map((f) => ({ text: f.text === '' ? f.hint : f.secret ? '•'.repeat(f.text.length) : f.text, bounds: { cx: 100, cy: 100 } }));
  return {
    events,
    lines,
    fields,
    read: async () => {
      pump();
      events.push(`read ${fields[0].text}|${fields[1].text.length}`);
      return shown();
    },
    focus: async (i: number) => {
      events.push(`focus ${i}${pending ? ' (lost)' : ''}`);
      if (!pending) focused = i;
    },
    clear: () => {
      events.push(`clear ${focused}`);
      fields[focused].text = '';
      pending = null;
    },
    type: (text: string) => {
      events.push(`type ${text === PASSWORD ? 'password' : text === EMAIL ? 'email' : text} into ${focused}`);
      const size = Math.ceil(text.length / chunks);
      const parts: string[] = [];
      for (let k = 0; k < text.length; k += size) parts.push(text.slice(k, k + size));
      fields[focused].text += parts.shift();
      pending = parts.length > 0 ? { i: focused, rest: parts } : null;
      if (dropRestOnce && !dropped && text === EMAIL) {
        dropped = true;
        pending = null;
      }
    },
    log: (m: string) => lines.push(m),
    sleep: async (ms: number) => {
      clock += ms;
    },
    now: () => clock,
  };
}

describe('keyboard form (command #67e)', () => {
  it('the fake phone reproduces the CI failure when the form is typed on a timer (no read in between)', async () => {
    const p = phone();
    await p.focus(0);
    p.type(EMAIL);
    await p.focus(1); // lost: the email is still arriving
    p.type(PASSWORD);
    for (let i = 0; i < 4; i++) await p.read();
    // the email cut after its first chunk, the password in the same field: what job 136874638637 showed
    expect(p.fields[0].text).toBe('e2e-small-78589a' + PASSWORD);
    expect(p.fields[1].text).toBe('');
  });

  it('an email that arrives in two chunks: the password is typed only after the email field holds the whole email', async () => {
    const p = phone({ chunks: 2 });
    const out = await fillForm({ fields: FIELDS, read: p.read, focus: p.focus, clear: p.clear, type: p.type, log: p.log, sleep: p.sleep, now: p.now });
    expect(out.tries).toBe(1);
    expect(p.fields[0].text).toBe(EMAIL);
    expect(p.fields[1].text).toBe(PASSWORD);
    const typedPassword = p.events.indexOf('type password into 1');
    const emailComplete = p.events.indexOf(`read ${EMAIL}|0`);
    expect(emailComplete).toBeGreaterThan(-1);
    expect(typedPassword).toBeGreaterThan(emailComplete);
    expect(p.events).not.toContain('focus 1 (lost)');
    expect(p.lines).toEqual([]);
  });

  it('also with the text arriving in many chunks', async () => {
    const p = phone({ chunks: 5 });
    await fillForm({ fields: FIELDS, read: p.read, focus: p.focus, clear: p.clear, type: p.type, log: p.log, sleep: p.sleep, now: p.now });
    expect(p.fields.map((f) => f.text)).toEqual([EMAIL, PASSWORD]);
  });

  it('an email whose rest never arrives is cleared and typed again, with an EVIDENCE line; the password is never printed', async () => {
    const p = phone({ dropRestOnce: true });
    const out = await fillForm({ fields: FIELDS, read: p.read, focus: p.focus, clear: p.clear, type: p.type, log: p.log, sleep: p.sleep, now: p.now });
    expect(out.tries).toBe(2);
    expect(p.fields.map((f) => f.text)).toEqual([EMAIL, PASSWORD]);
    expect(p.events).toContain('clear 0');
    expect(p.lines[0]).toMatch(/^ {2}EVIDENCE keyboard: the email field reads "e2e-small-78589a" \(16 of 31 characters\) 12000 ms after the email was typed \(try 1 of 3\): clearing/);
    expect(p.lines[1]).toBe('  EVIDENCE keyboard: the form holds every field on try 2 of 3');
    expect(p.lines.join('\n')).not.toContain(PASSWORD);
  });

  it('a field that never fills: bounded tries, then a throw that says so', async () => {
    const p = phone();
    const stuck = { ...p, type: () => {} };
    await expect(fillForm({ fields: FIELDS, read: p.read, focus: p.focus, clear: p.clear, type: stuck.type, log: p.log, sleep: p.sleep, now: p.now })).rejects.toThrow(/the keyboard never filled the form \(3 tries; last: the email field reads empty/);
    expect(p.lines.filter((l) => l.includes('EVIDENCE keyboard')).length).toBe(3);
  });

  it('a password field is judged by its length, never by its hint', () => {
    const f = { name: 'password', value: 'Pw12345678', secret: true };
    expect(fieldHolds({ text: 'Password' }, f, 'Password')).toBe(false);
    expect(fieldHolds({ text: '••••••••••' }, f, 'Password')).toBe(true);
    expect(fieldHolds({ text: '•••••' }, f, 'Password')).toBe(false);
    expect(describeField({ text: '•••••' }, f, 'Password')).toBe('5 characters (10 expected)');
    expect(fieldHolds({ text: 'e2e@exa' }, { name: 'email', value: 'e2e@example.test' }, 'Email')).toBe(false);
  });

  it('the limits are the literals the fix was written with', () => {
    expect(FORM_TRIES).toBe(3);
    expect(FIELD_WAIT_MS).toBe(12000);
  });

  it('every keyboard sign-in of the driver goes through fillForm (login is the only place that types into the form)', () => {
    const e2e = readFileSync(join(__dirname, '../../../scripts/android/e2e.mjs'), 'utf8');
    const login = e2e.slice(e2e.indexOf('async function login('), e2e.indexOf('async function online('));
    expect(login).toContain('await fillForm({');
    expect(login).toContain("{ name: 'password', value: account.password, secret: true }");
    expect(login).not.toMatch(/dev\.type\(account\./);
    // the scenario, toHome's fresh start and the re-sign-in before a scenario all call login(); nothing else types an account
    expect(e2e.match(/dev\.type\(account\./g)).toBeNull();
    expect(e2e.match(/await login\(dev, /g)?.length).toBeGreaterThanOrEqual(4);
  });
});
