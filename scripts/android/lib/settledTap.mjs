/**
 * SETTLED TAPS (command #61). PR #46, slice large-screens-1: `tap {"text":"Classic","below":"Local"}` was made while the Play list was still moving, the touch landed on nothing and the
 * screen kept showing the list. The driver now (1) waits until the target's bounds AND the screen's text are the same in two consecutive dumps, (2) taps, (3) checks that the screen's text
 * changed, and (4) when it did not and the screen WAS settled before the tap, taps once more. A tap on a screen that was still moving is never repeated (the screen may have moved under
 * the first one, and a second touch could hit something else). Pure (the phone's verbs are passed in) so tests can drive it with fake dumps.
 */
import { findNodes, findOne } from './hierarchy.mjs';

/**
 * The words of the screen (text and labels, in document order) and which controls are chosen (selected / checked): what "the screen is the same" means after a tap. The chosen state is part of
 * it since command #62: PR #47's online slice judged `tap {"label":"Chaturaji"}` LOST (a variant chip changes no words) and the friend buddy then "joined the chaturaji room" - the tap had landed.
 */
export const screenText = (nodes) => nodes.map((n) => `${n.text}|${n.desc}${n.selected ? '|selected' : ''}${n.checked ? '|checked' : ''}`).join('\n');

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

/**
 * The node drawn on top at (x, y): the LAST node in document order whose bounds hold the point (a later sibling is drawn over an earlier one). Command #62 hypothesis (a), an invisible view that
 * covers the screen and takes the touch: a lost tap prints this, so the next run shows whether the target itself, or something over it, was under the finger.
 */
export function nodeAt(nodes, x, y) {
  let top = null;
  for (const n of nodes) if (n.bounds && x >= n.bounds.x1 && x < n.bounds.x2 && y >= n.bounds.y1 && y < n.bounds.y2) top = n;
  return top;
}
const describeTop = (nodes, x, y) => {
  const n = nodeAt(nodes, x, y);
  return n ? `${n.cls.split('.').pop()} "${(n.text || n.desc || n.id).slice(0, 30)}" ${n.bounds.w}x${n.bounds.h} at ${n.bounds.x1},${n.bounds.y1}` : 'nothing';
};

/**
 * WAS THE APP'S JAVASCRIPT THREAD BUSY WHEN A TAP WAS LOST? (command #66b, PR #50 small-screens-2: the tab bar's "More" was lost twice on the Analysis screen, the runner was healthy and the
 * screen had nothing over the label). The e2e build's perf monitor (`src/dev/e2ePerf.ts`, beacon channel `perf`) reports every 500 ms: the cumulative lateness of a 20 ms interval (`lateMs`,
 * the thread's busy time), the last stalls of >= 50 ms with their wall-clock instant, and `now`. `before` is the last report before the tap, `after` the newest one; entries are the beacon's
 * `{ state, at }` (`at` = when the driver received it). Verdict: NO REPORTS (the monitor is not there), JS SILENT (no report for 2 s: the thread is blocked or the app is gone), JS BUSY (more than
 * half of the span late, or a stall of 1 s or more since the tap) or JS FREE (the touch was not lost because the thread was busy: look at the windows / the input lines).
 */
export function jsThreadAtTap({ before, after, tapAt, nowMs }) {
  if (!after?.state) return { verdict: 'NO REPORTS', text: 'the app sent no perf report (no e2e perf monitor in this build)' };
  const ageMs = Math.round(nowMs - after.at);
  const s = after.state;
  const stalls = (Array.isArray(s.stalls) ? s.stalls : []).filter(([t]) => t >= tapAt - 1000);
  const longest = stalls.reduce((m, [, gap]) => Math.max(m, gap), 0);
  let busyShare = null;
  let spanMs = null;
  if (before?.state && typeof before.state.lateMs === 'number' && typeof s.lateMs === 'number' && s.now > before.state.now) {
    spanMs = s.now - before.state.now;
    busyShare = Math.max(0, s.lateMs - before.state.lateMs) / spanMs;
  }
  const verdict = ageMs > 2000 ? 'JS SILENT' : (busyShare !== null && busyShare > 0.5) || longest >= 1000 ? 'JS BUSY' : 'JS FREE';
  const share = busyShare === null ? 'busy share unknown (no report before the tap)' : `busy ${Math.round(busyShare * 100)}% of the ${spanMs} ms around the tap`;
  const list = stalls.length ? stalls.slice(-8).map(([t, gap]) => `${gap} ms at ${t - tapAt >= 0 ? '+' : ''}${t - tapAt} ms`).join(', ') : 'none';
  return { verdict, text: `${verdict}: last perf report ${ageMs} ms ago, ${share}, stalls >= 50 ms since the tap: ${list}` };
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
  /** 'changed' | 'unchanged' (a tree was read and it is the same) | 'unreadable' (no tree could be read after the tap: nothing is known about the screen). */
  const attempt = async () => {
    await tap(node.bounds.cx, node.bounds.cy); // (may be async: the driver first brings a backgrounded app to the front, command #67b)
    await sleep(settleMs);
    const t0 = now();
    let nudged = false;
    let readOne = false;
    for (;;) {
      const nodes = await dump().catch(() => null);
      if (nodes !== null) {
        readOne = true;
        if (screenText(nodes) !== beforeText) return 'changed';
      }
      if (now() - t0 > changeMs) return readOne ? 'unchanged' : 'unreadable';
      if (!nudged && now() - t0 > 2500) {
        nudged = true;
        nudge();
      }
      await sleep(500);
    }
  };
  const first = await attempt();
  if (first === 'changed') return { changed: true, lost: false, retapped: false };
  // A failed dump is NOT a screen that stayed the same (command #62): PR #47's Bughouse taps were judged lost while every dump after them said "could not get idle state" - the game screen the
  // tap had opened (bots playing, never idle), which the next step then judged with 32 pieces. Unknown is reported as unknown, and never repeated (a second touch would land on that game).
  if (first === 'unreadable') {
    log('  EVIDENCE: tap unverified (no tree could be read after the tap: the screen it opened never stands still)');
    return { changed: false, lost: false, unverified: true, retapped: false };
  }
  // A control that was ALREADY chosen: choosing it again changes nothing, by design (PR #47: `preset-solo`, the setup's default preset). Not lost, and not repeated.
  if (node.selected || node.checked) {
    log('  (the target was already chosen: the tap changes nothing, by design)');
    return { changed: false, lost: false, noop: true, retapped: false };
  }
  log(`  EVIDENCE: tap lost (settled before tap: ${settled ? 'yes' : 'no'})`);
  log(`  EVIDENCE: on top at the tap point ${node.bounds.cx},${node.bounds.cy}: ${describeTop(before, node.bounds.cx, node.bounds.cy)}`);
  if (!settled || !retap) return { changed: false, lost: true, retapped: false };
  const second = await attempt();
  const changed = second === 'changed';
  log(`  tap repeated once (the screen was settled before the first tap): ${changed ? 'the screen changed' : second === 'unreadable' ? 'no tree could be read' : 'still unchanged'}`);
  return { changed, lost: !changed, retapped: true };
}
