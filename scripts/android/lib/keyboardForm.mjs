/**
 * A KEYBOARD FORM IS FILLED ON A CONDITION, NOT ON A TIMER (command #67e). PR #51 head f84902c, job 136874638637 "emulator (online)", 14:28:44 "online: sign in through the keyboard": the
 * email field held "e2e-small-78589a0c@examp" + "Pwcb8b06bbffae" and the Password field was empty - the harness tapped the password field and typed the password while the email's text
 * was still arriving, the tap was lost and the password went into the SAME field; the server answered 401 "Invalid email or password". Here each field is typed and then the tree is
 * READ again until the field holds the whole value (a password field: the right number of characters, not its hint) and every earlier field still holds its own; only then is the next
 * field touched. A field that does not (bounded wait) is cleared and the form typed again (bounded tries, each failed try an EVIDENCE line); every try failing throws.
 * Pure (the phone's verbs are passed in) so tests can drive it with a fake phone. A secret's text is never printed: only its length.
 */

/** How many times the whole form is typed before the sign-in fails (bounded: a phone that never takes the text fails the step, it does not hang the slice). */
export const FORM_TRIES = 3;
/** How long a typed field may take to show its whole value (the condition ends the wait; the bound only turns a hang into a failure). */
export const FIELD_WAIT_MS = 12_000;

/** What the field shows when it is empty: '' or its hint (uiautomator reports an empty EditText's hint as its text: "Password"). */
const isEmptyText = (text, hint) => text === '' || (hint !== undefined && text === hint);

/** Does the field's node hold the whole value? A secret field shows bullets: the length must match and the text must not be the hint. */
export function fieldHolds(node, field, hint) {
  if (!node) return false;
  const text = node.text ?? '';
  if (field.secret) return !isEmptyText(text, hint) && text.length === field.value.length;
  return text === field.value;
}

/** The field as the EVIDENCE line shows it: a secret only by its length. */
export function describeField(node, field, hint) {
  if (!node) return 'no such field on the screen';
  const text = node.text ?? '';
  if (isEmptyText(text, hint)) return 'empty';
  return field.secret ? `${text.length} characters (${field.value.length} expected)` : `"${text}" (${text.length} of ${field.value.length} characters)`;
}

/**
 * Types `fields` in order. `read()` returns the field nodes in the form's order (or null when the tree could not be read); `focus(i, nodes)` touches field i (`nodes` = the last read);
 * `clear()` empties the focused field; `type(text)` types into the focused field.
 * @param {{ fields: { name: string, value: string, secret?: boolean }[], read: () => Promise<any[] | null>, focus: (i: number, nodes: any[]) => Promise<void>, clear: () => void | Promise<void>,
 *   type: (text: string) => void | Promise<void>, log?: (m: string) => void, sleep?: (ms: number) => Promise<void>, now?: () => number, tries?: number, waitMs?: number, stepMs?: number, focusMs?: number }} o
 * @returns {Promise<{ tries: number }>}
 */
export async function fillForm({ fields, read, focus, clear, type, log = () => {}, sleep = async () => {}, now = Date.now, tries = FORM_TRIES, waitMs = FIELD_WAIT_MS, stepMs = 400, focusMs = 300 }) {
  const safeRead = async () => {
    try {
      const nodes = await read();
      return Array.isArray(nodes) ? nodes : null;
    } catch {
      return null;
    }
  };
  let nodes = await safeRead();
  if (!nodes || nodes.length < fields.length) throw new Error(`the form shows ${nodes ? nodes.length : 'no'} fields, ${fields.length} expected`);
  // the hints are what the EMPTY form shows (read before anything is typed)
  const hints = fields.map((_, i) => nodes[i]?.text ?? '');
  const holdsUpTo = (list, i) => Array.isArray(list) && fields.slice(0, i + 1).every((f, j) => fieldHolds(list[j], f, hints[j]));
  let lastProblem = '';
  for (let t = 1; t <= tries; t++) {
    let problem = null;
    for (let i = 0; i < fields.length && problem === null; i++) {
      const field = fields[i];
      await focus(i, nodes);
      await sleep(focusMs);
      const before = await safeRead();
      if (before) nodes = before;
      // a field that is not empty (an earlier try, a field the previous value ran into) is cleared first
      if (!before || !isEmptyText(before[i]?.text ?? '', hints[i])) await clear();
      await type(field.value);
      const t0 = now();
      let list = await safeRead();
      while (!holdsUpTo(list, i) && now() - t0 < waitMs) {
        await sleep(stepMs);
        list = await safeRead();
      }
      if (list) nodes = list;
      if (!holdsUpTo(list, i)) {
        const broken = fields.slice(0, i + 1).map((f, j) => ({ f, j })).filter(({ f, j }) => !fieldHolds(list?.[j], f, hints[j]));
        problem = broken.map(({ f, j }) => `the ${f.name} field reads ${describeField(list?.[j], f, hints[j])}`).join('; ') + ` ${waitMs} ms after the ${field.name} was typed`;
      }
    }
    if (problem === null) {
      if (t > 1) log(`  EVIDENCE keyboard: the form holds every field on try ${t} of ${tries}`);
      return { tries: t };
    }
    lastProblem = problem;
    log(`  EVIDENCE keyboard: ${problem} (try ${t} of ${tries})${t < tries ? ': clearing the fields and typing them again' : ''}`);
  }
  throw new Error(`the keyboard never filled the form (${tries} tries; last: ${lastProblem})`);
}
