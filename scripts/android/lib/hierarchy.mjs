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

/** A cheap fingerprint of what is on screen (to see whether a scroll moved anything). */
export const fingerprint = (nodes) => nodes.map((n) => `${n.text}|${n.desc}|${n.bounds ? `${n.bounds.x1},${n.bounds.y1}` : ''}`).join('\n');
