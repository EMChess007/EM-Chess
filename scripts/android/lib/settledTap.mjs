/**
 * SETTLED TAPS (command #61). PR #46, slice large-screens-1: `tap {"text":"Classic","below":"Local"}` was made while the Play list was still moving, the touch landed on nothing and the
 * screen kept showing the list. The driver now (1) waits until the target's bounds AND the screen's text are the same in two consecutive dumps, (2) taps, (3) checks that the screen's text
 * changed, and (4) when it did not and the screen WAS settled before the tap, taps once more. A tap on a screen that was still moving is never repeated (the screen may have moved under
 * the first one, and a second touch could hit something else). Pure (the phone's verbs are passed in) so tests can drive it with fake dumps.
 */
import { findNodes, findOne } from './hierarchy.mjs';

/** The words of the screen (text and labels, in document order): what "the screen is the same" means for a navigation tap. */
export const screenText = (nodes) => nodes.map((n) => `${n.text}|${n.desc}`).join('\n');

const boxKey = (n) => (n?.bounds ? `${n.bounds.x1},${n.bounds.y1},${n.bounds.x2},${n.bounds.y2}` : '');

/** The node a step names in THIS tree (`below`: the first match under that heading, as `Device.find` reads it), or null. */
export function locate(nodes, step) {
  if (step.below !== undefined) {
    const heading = findOne(nodes, { text: step.below });
    return heading ? (findNodes(nodes, { text: step.text }).find((n) => n.bounds.y1 >= heading.bounds.y2 - 2) ?? null) : null;
  }
  return findOne(nodes, step);
}

/** Two trees in a row show a screen that stands still around the target: the target is in both, at the same bounds, and every word of the screen is the same. */
export function sameAround(previous, current, step) {
  const a = locate(previous, step);
  const b = locate(current, step);
  return a !== null && b !== null && boxKey(a) === boxKey(b) && screenText(previous) === screenText(current);
}

/** The waits, scaled by the runner's own dump time (a slow runner takes seconds for one dump): { settleMs, changeMs }. An unknown or failed measurement counts as the health limit. */
export function waitBudgets(dumpMs) {
  const dump = typeof dumpMs === 'number' && dumpMs > 0 ? dumpMs : 12_000;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  return { settleMs: clamp(8 * dump, 8000, 60_000), changeMs: clamp(2 * dump + 2000, 8000, 30_000) };
}

/**
 * Dumps until two consecutive trees are the same around the target (`sameAround`) or the budget is spent. `previous` may be a tree taken since the last touch.
 * @returns {Promise<{ settled: boolean, node: any, nodes: any[] | null }>} `node` is the target in the newest tree that has it (null when none had it).
 */
export async function waitSettled({ dump, step, budgetMs, previous = /** @type {any} */ (null), gapMs = 250, now = Date.now, sleep }) {
  const t0 = now();
  let before = previous;
  let node = null;
  let nodes = previous;
  for (;;) {
    const current = await dump().catch(() => null);
    if (current !== null) {
      nodes = current;
      node = locate(current, step) ?? node;
      if (before !== null && sameAround(before, current, step)) return { settled: true, node: locate(current, step), nodes: current };
      before = current;
    }
    if (now() - t0 >= budgetMs) return { settled: false, node, nodes };
    await sleep(gapMs);
  }
}

/**
 * Taps the node, waits until the screen's words differ from `before`; when they do not within `changeMs` the tap was LOST. A lost tap is repeated once when `settled` (never otherwise).
 * `nudge` is called once per wait after 2.5 s (the status-bar touch that makes uiautomator refresh a stale tree). Returns { changed, lost, retapped }.
 */
export async function tapAndVerify({ node, settled, before, tap, dump, changeMs, settleMs = 700, now = Date.now, sleep, nudge = () => {}, log = /** @type {(message: string) => void} */ (() => {}), retap = true }) {
  const beforeText = screenText(before);
  const attempt = async () => {
    tap(node.bounds.cx, node.bounds.cy);
    await sleep(settleMs);
    const t0 = now();
    let nudged = false;
    for (;;) {
      const nodes = await dump().catch(() => null);
      if (nodes !== null && screenText(nodes) !== beforeText) return true;
      if (now() - t0 > changeMs) return false;
      if (!nudged && now() - t0 > 2500) {
        nudged = true;
        nudge();
      }
      await sleep(500);
    }
  };
  if (await attempt()) return { changed: true, lost: false, retapped: false };
  log(`  EVIDENCE: tap lost (settled before tap: ${settled ? 'yes' : 'no'})`);
  if (!settled || !retap) return { changed: false, lost: true, retapped: false };
  const changed = await attempt();
  log(`  tap repeated once (the screen was settled before the first tap): ${changed ? 'the screen changed' : 'still unchanged'}`);
  return { changed, lost: !changed, retapped: true };
}
