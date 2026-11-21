/**
 * The accessibility tree of a screen, read from `uiautomator dump` (command #29): the Android end-to-end driver finds a button by its text / label / testID and taps the middle of its
 * bounds, reads a board's rectangle and a cell's label ("e2, board A, White Pawn, can move here"), and checks the text on the screen. Pure functions over the XML text, unit-tested.
 *
 * What React Native puts where (the driver relies on it, android-e2e prints the nodes it could not find when it does not hold):
 *   text         <Text> and the hint/value of a TextInput;       desc  `accessibilityLabel` (content-desc);        id  `testID` (resource-id, the package prefix removed).
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e]));

/** "[10,20][110,60]" -> { x1, y1, x2, y2, w, h, cx, cy }, or null. */
export function parseBounds(value) {
  const m = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(value ?? '');
  if (!m) return null;
  const [x1, y1, x2, y2] = m.slice(1).map(Number);
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1, cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) };
}

/** The XML of a dump out of whatever the shell printed around it (uiautomator appends "UI hierchary dumped to: /dev/tty"). Null when there is none. */
export function extractXml(output) {
  const start = output.indexOf('<?xml');
  const end = output.lastIndexOf('</hierarchy>');
  return start >= 0 && end > start ? output.slice(start, end + '</hierarchy>'.length) : null;
}

/** Every node of the dump in document order: { index, parent, depth, text, desc, id, cls, pkg, bounds, clickable, enabled, scrollable, password }. */
export function parseHierarchy(xml) {
  const nodes = [];
  const stack = [];
  const tag = /<(\/?)node\b([^>]*?)(\/?)>/g;
  let m;
  while ((m = tag.exec(xml)) !== null) {
    const [, closing, attrs, selfClosing] = m;
    if (closing) {
      stack.pop();
      continue;
    }
    const a = {};
    for (const [, k, v] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) a[k] = unescapeXml(v);
    const node = {
      index: nodes.length,
      parent: stack.length ? stack[stack.length - 1] : -1,
      depth: stack.length,
      text: a.text ?? '',
      desc: a['content-desc'] ?? '',
      id: (a['resource-id'] ?? '').replace(/^[^:/]*:id\//, ''),
      cls: a.class ?? '',
      pkg: a.package ?? '',
      bounds: parseBounds(a.bounds),
      clickable: a.clickable === 'true',
      enabled: a.enabled !== 'false',
      scrollable: a.scrollable === 'true',
      password: a.password === 'true',
      // a chip / preset that is chosen (accessibilityState.selected or checked): a tap that only CHOOSES changes no words, and the settled-tap judge reads this (command #62)
      selected: a.selected === 'true',
      checked: a.checked === 'true',
    };
    nodes.push(node);
    if (!selfClosing) stack.push(node.index);
  }
  return nodes;
}

const sized = (n) => n.bounds !== null && n.bounds.w > 0 && n.bounds.h > 0;
const inside = (inner, outer) => inner.x1 >= outer.x1 && inner.y1 >= outer.y1 && inner.x2 <= outer.x2 && inner.y2 <= outer.y2;

/**
 * The nodes a test step names, top to bottom then left to right. `{ text }` matches the text or the label (a button's own label and the text inside it are one control: when two
 * matches are nested only the innermost counts), `{ label }` the label, `{ id }` the testID (or a label of the same words: a testID that the phone did not expose).
 */
export function findNodes(nodes, step) {
  // `ci`: ignore case (an Android dialog may print its buttons in capitals); `button`: only a class ending in Button (the dialog's button, not the control behind it)
  const norm = step.ci ? (s) => s.toLowerCase() : (s) => s;
  let found;
  if (step.id !== undefined) found = nodes.filter((n) => n.id === step.id || n.desc === step.id);
  else if (step.label !== undefined) found = nodes.filter((n) => n.desc === step.label || n.text === step.label);
  else if (step.startsWith !== undefined) found = nodes.filter((n) => n.text.startsWith(step.startsWith));
  else found = nodes.filter((n) => norm(n.text) === norm(step.text) || norm(n.desc) === norm(step.text));
  if (step.button) found = found.filter((n) => n.cls.endsWith('Button'));
  found = found.filter(sized);
  found = found.filter((a) => !found.some((b) => b !== a && inside(b.bounds, a.bounds) && (b.text === a.text || b.desc === a.desc || b.id === a.id)));
  return found.sort((a, b) => a.bounds.y1 - b.bounds.y1 || a.bounds.x1 - b.bounds.x1);
}

export const findOne = (nodes, step) => findNodes(nodes, step)[step.nth ?? 0] ?? null;

/** Every node whose class ends with `suffix` ("EditText"), top to bottom. */
export const byClass = (nodes, suffix) => nodes.filter((n) => n.cls.endsWith(suffix) && sized(n)).sort((a, b) => a.bounds.y1 - b.bounds.y1);

/** The words on the screen (text and labels), for a failure message that says what WAS there. */
export function visibleWords(nodes, limit = 60) {
  const words = [];
  for (const n of nodes) {
    for (const w of [n.text, n.desc]) if (w && sized(n) && !words.includes(w)) words.push(w.length > 50 ? `${w.slice(0, 50)}...` : w);
  }
  return words.slice(0, limit);
}

/**
 * Where a row that was found BEFORE a scroll stands AFTER it (command #45). A step like `{ text: 'Racing Kings', below: 'Local' }` needs the heading `Local` on screen, and after a swipe
 * the heading may have scrolled out of the window, so the row is re-found by its own text: how far the list moved is read from the words that are on screen exactly once in both trees
 * (the median of their shifts), and of the nodes with the row's text the one nearest to where the row must now be is the answer. Null when the row's text is not on screen any more, or when
 * the two trees share no word to measure the shift by. (`row` is the node found before the swipe, `step` the step that found it.)
 */
export function rowAfterScroll(before, after, row, step) {
  const once = (nodes, key) => {
    const counts = new Map();
    for (const n of nodes) if (n.bounds && sized(n) && n[key]) counts.set(n[key], [...(counts.get(n[key]) ?? []), n]);
    return new Map([...counts].filter(([, list]) => list.length === 1).map(([word, list]) => [word, list[0]]));
  };
  const shifts = [];
  for (const key of ['text', 'desc']) {
    const was = once(before, key);
    const now = once(after, key);
    for (const [word, node] of was) {
      const moved = now.get(word);
      if (moved && word !== step.text) shifts.push(node.bounds.cy - moved.bounds.cy);
    }
  }
  if (shifts.length === 0) return null;
  shifts.sort((a, b) => a - b);
  const shift = shifts[Math.floor(shifts.length / 2)];
  const expected = row.bounds.cy - shift;
  const candidates = findNodes(after, { text: step.text });
  if (candidates.length === 0) return null;
  return candidates.reduce((best, n) => (Math.abs(n.bounds.cy - expected) < Math.abs(best.bounds.cy - expected) ? n : best));
}

/**
 * Whether a control may be tapped now (command #54). The usual rule: it stands in the upper `upper` (0.7) of the window, above a soft keyboard. A control in the LAST card of a menu can
 * never get there (the list ends, so it stays in the lower part of the window: the run on 654c650 listed "From Position" on the screen and still died with "not reachable"), so with
 * `atEnd` (the caller saw that a swipe moved the entry by nothing: the list is at its end) it may stand anywhere above the lowest 3 % of the window (the gesture navigation bar; run
 * 44530171992 had a 2377 px window, where the first version's 90 % limit, y 2139, was above the last card's buttons). `hit` is a node of `findNodes`.
 */
export function tappableNow(hit, windowHeight, atEnd, upper = 0.7) {
  if (!hit || !hit.bounds) return false;
  if (hit.bounds.cy < windowHeight * upper) return true;
  return atEnd && hit.bounds.y2 <= windowHeight * 0.97;
}

/** True when the same control stands where it stood before a swipe (within 2 px): the list is at its end. `before` / `after` are nodes of `findNodes`, or null. */
export function stoodStill(before, after) {
  return Boolean(before && after && before.bounds && after.bounds && Math.abs(before.bounds.cy - after.bounds.cy) <= 2);
}

/**
 * ONE generic "scroll until the control can be tapped" (command #54b: the From Position scenario timed out waiting for the FEN field, which sits BELOW the board and the palette in the
 * Board Editor's ScrollView, and "Play from here" / the Local / vs Bot choice sit below that). `find(nodes)` returns the wanted node of a dump (or a falsy value while it is not on the
 * screen). Each round: dump, find, log the bounds, and when `tappableNow` accepts it (upper 70 % of the window, or - once a swipe left it where it was, `stoodStill`: the content is at its
 * end - anywhere above the lowest 3 %) return it; else swipe up from above a soft keyboard (the lowest 40 % of the window may be the keyboard) and look again. At most `maxSwipes` swipes;
 * then a clear error naming `label` and the words on screen. `dev` needs `dump()`, `swipe()` and `display`; `sleep` / `log` are injected so the helper runs on fake dumps in a unit test.
 */
export async function scrollUntilVisible(dev, label, find, options = {}) {
  /** @type {{ maxSwipes?: number, settleMs?: number, upper?: number, sleep?: (ms: number) => Promise<unknown>, log?: (line: string) => unknown }} */
  // maxSwipes is only a SAFETY cap (command #55c: the Play menu is longer at 360 dp than 8 swipes); the normal stop is the list standing still (the target's place, or - while the target is
  // not on the screen yet - the whole screen's fingerprint, unchanged by a swipe).
  const { maxSwipes = 20, settleMs = 700, upper = 0.7, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {} } = options;
  const h = dev.display.h;
  let previous = null;
  let previousPrint = null;
  for (let swipes = 0; ; swipes++) {
    const nodes = await dev.dump();
    const hit = find(nodes) || null;
    const atEnd = stoodStill(previous, hit);
    const print = fingerprint(nodes);
    log(`  ${label}: ${hit ? `y ${hit.bounds.y1}-${hit.bounds.y2} (centre ${hit.bounds.cy}) of ${h}` : 'not on the screen'}, content at its end: ${atEnd}, swipes so far ${swipes}/${maxSwipes}`);
    if (tappableNow(hit, h, atEnd, upper)) {
      log(`  ${label}: reached after ${swipes} swipes`);
      return hit;
    }
    if (!hit && swipes > 0 && print === previousPrint) {
      throw new Error(`"${label}" is not in the list: the list stood still after ${swipes} swipes (never on the screen); on screen: ${visibleWords(nodes, 40).join(' | ')}`);
    }
    if (swipes >= maxSwipes) {
      throw new Error(`"${label}" did not become tappable within ${maxSwipes} swipes (${hit ? `last seen at y ${hit.bounds.y1}-${hit.bounds.y2} of ${h}` : 'never on the screen'}); on screen: ${visibleWords(nodes, 40).join(' | ')}`);
    }
    previous = hit;
    previousPrint = print;
    dev.swipe(dev.display.w / 2, h * 0.55, dev.display.w / 2, h * 0.2, 600);
    await sleep(settleMs);
  }
}

/** A cheap fingerprint of what is on screen (to see whether a scroll moved anything). */
export const fingerprint = (nodes) => nodes.map((n) => `${n.text}|${n.desc}|${n.bounds ? `${n.bounds.x1},${n.bounds.y1}` : ''}`).join('\n');
