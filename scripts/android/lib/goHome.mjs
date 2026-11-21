/**
 * BACK TO A VERIFIED HOME SCREEN (command #66b). PR #50, slice small-screens-2, and master run 44876385559, slice large-screens-1: `toHome` tapped the tab bar's "Home", slept 700 ms and
 * RETURNED without looking. The tap did not take (the screen stayed on More / Analysis), so the next scenario's first step, `tap {"text":"Play"}`, failed with "cannot find Play" while the
 * More screen was shown, and one failing scenario failed the next two. Here a scenario starts only from a screen that IS Home (the tab bar and the Home screen's Play), checked on a tree
 * read AFTER the touch; a tab tap that did not take is tried again, a screen that never becomes Home is left by starting the app afresh, and that start is itself waited for.
 * Pure (the phone's verbs are passed in) so tests can drive it with fake trees.
 */
import { findNodes } from './hierarchy.mjs';

export const TABS = ['Home', 'Puzzles', 'Analysis', 'More'];
/** The four tabs of the tab bar are on the screen. */
export const onTabs = (nodes) => TABS.every((t) => findNodes(nodes, { text: t }).length > 0);
/** An Android dialog (its first button) sits over the app. */
const dialogOpen = (nodes) => findNodes(nodes, { id: 'button1' }).length > 0;
/** The Home tab is the one shown: the tab bar AND the Home screen's Play button (no other tab screen says "Play"), and no dialog over it. The same test as `Device.waitHome`. */
export const isHome = (nodes) => Array.isArray(nodes) && onTabs(nodes) && !dialogOpen(nodes) && findNodes(nodes, { text: 'Play' }).length > 0;

/** The tab bar's "Home" (the LOWEST node that says Home: the tab, not a heading), or null. */
export function homeTab(nodes) {
  return findNodes(nodes, { text: 'Home' }).sort((a, b) => b.bounds.y1 - a.bounds.y1)[0] ?? null;
}

/** The app's own back link ("‹ Back" / "‹ Menu"): the highest node whose text starts with ‹, or null. */
export function backLink(nodes) {
  return nodes.filter((n) => typeof n.text === 'string' && n.text.startsWith('‹') && n.bounds).sort((a, b) => a.bounds.y1 - b.bounds.y1)[0] ?? null;
}

/**
 * Reads trees until `test(tree)` holds or `budgetMs` is spent (a condition, never a fixed sleep: the bound only turns a hang into a "no"). An unreadable tree (`read` throws) counts as "not yet".
 * @returns {Promise<any[] | null>} the tree that passed, or null.
 */
export async function readUntil({ read, test, budgetMs, gapMs = 400, now = Date.now, sleep }) {
  const t0 = now();
  for (;;) {
    const nodes = await read().catch(() => null);
    if (nodes !== null && test(nodes)) return nodes;
    if (now() - t0 >= budgetMs) return null;
    await sleep(gapMs);
  }
}

/**
 * Goes to the Home tab and PROVES it: returns only when a tree read after the last touch is Home (`isHome`). In order: already Home -> done; tab bar shown -> tap Home and wait for Home
 * (at most `tabTries` taps); the app's back link -> tap it and look again (at most `backTries`); anything else (a game, a dialog, an unreadable screen, a tab tap that never took) ->
 * `relaunch()` then `waitHome()` (which throws when Home never comes: the scenario fails with that message, it does not run on the wrong screen).
 * @param {{ current: () => Promise<any[]>, read: () => Promise<any[]>, tap: (x: number, y: number) => void, relaunch: () => Promise<void>, waitHome: () => Promise<any>,
 *   sleep: (ms: number) => Promise<void>, now?: () => number, log?: (m: string) => void, onTabLost?: (lost: { node: any, tapAt: number }) => any, tabTries?: number, backTries?: number,
 *   tabBudgetMs?: number, backSettleMs?: number }} verbs (`onTabLost`: called for each Home tab tap that did not show Home, to print the lost-tap evidence)
 * @returns {Promise<{ how: 'already' | 'tab' | 'back' | 'relaunch', tabTaps: number, backTaps: number }>}
 */
export async function goHome({ current, read, tap, relaunch, waitHome, sleep, now = Date.now, log = () => {}, onTabLost = () => {}, tabTries = 3, backTries = 3, tabBudgetMs = 10_000, backSettleMs = 800 }) {
  let tabTaps = 0;
  let backTaps = 0;
  let nodes = await current().catch(() => null);
  for (;;) {
    if (nodes === null) break;
    if (isHome(nodes)) return { how: tabTaps > 0 ? 'tab' : backTaps > 0 ? 'back' : 'already', tabTaps, backTaps };
    if (onTabs(nodes) && !dialogOpen(nodes)) {
      if (tabTaps >= tabTries) break;
      const home = homeTab(nodes);
      if (!home) break;
      const tapAt = now();
      tap(home.bounds.cx, home.bounds.cy);
      tabTaps++;
      const landed = await readUntil({ read, test: isHome, budgetMs: tabBudgetMs, now, sleep });
      if (landed) return { how: 'tab', tabTaps, backTaps };
      log(`  toHome: the Home tab tap #${tabTaps} at ${home.bounds.cx},${home.bounds.cy} did not show Home within ${tabBudgetMs} ms`);
      await Promise.resolve(onTabLost({ node: home, tapAt })).catch(() => {});
      nodes = await read().catch(() => null);
      continue;
    }
    const back = backLink(nodes);
    if (!back || backTaps >= backTries) break;
    tap(back.bounds.cx, back.bounds.cy);
    backTaps++;
    await sleep(backSettleMs);
    nodes = await read().catch(() => null);
  }
  log(`  toHome: starting the app afresh (tab taps ${tabTaps}, back taps ${backTaps})`);
  await relaunch();
  await waitHome();
  return { how: 'relaunch', tabTaps, backTaps };
}
