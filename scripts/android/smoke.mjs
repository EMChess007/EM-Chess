#!/usr/bin/env node
/**
 * The first thing the Android run does (command #29): start the app on the emulator and wait for its Home screen. If the driver cannot read the screen or the app never gets there (Metro not
 * reachable, a crash on start, a red screen), the whole run stops here, in about five minutes, with a screenshot, the tree, the words on screen and the app's logcat - instead of failing
 * the same way in every one of the six phases that follow.   node scripts/android/smoke.mjs <output dir>
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Device, PROFILES } from './lib/device.mjs';
import { visibleWords } from './lib/hierarchy.mjs';
import { crashIssues, squareRect } from './lib/checks.mjs';

const out = join(process.argv[2] ?? 'android-e2e-out', 'smoke');
const dev = new Device({ outDir: out });
let ok = false;
try {
  dev.applyProfile(PROFILES.large);
  dev.clearData();
  const t0 = Date.now();
  // Up to three starts, 150 s each: a start that ends on the launcher (the run of command #30 that sat 6 minutes on "Wallpaper & style | Widgets | Home settings": the app process was gone and
  // nothing started it again) is a failed start, not a slow one - the second one finds the bundle already built by the first.
  let nodes = null;
  let lastError = null;
  for (let start = 1; start <= 3 && nodes === null; start++) {
    if (start > 1) {
      console.error(`smoke: start ${start - 1} did not reach Home (${lastError.message.slice(0, 160)}): starting the app again`);
      dev.stop();
      await new Promise((r) => setTimeout(r, 1500));
    }
    dev.launch();
    try {
      nodes = await dev.waitHome(150_000);
    } catch (e) {
      lastError = e;
    }
  }
  if (nodes === null) throw lastError;
  console.log(`smoke: Home is up after ${Math.round((Date.now() - t0) / 1000)} s with ${nodes.length} nodes: ${visibleWords(nodes, 25).join(' | ')}`);
  const issues = crashIssues(nodes);
  if (issues.length > 0) throw new Error(issues.join('; '));
  await dev.snapshot('home');

  // Racing Kings (one short step): open a Local game, check the board renders, play 1.Ng3 (e2 -> g3, a legal non-checking move from the start position) with two real touches
  // and see the app say so ("Last move: Ng3"). Everything else about the variant is covered by the logic / dom tests and the server scripts.
  await dev.runSteps([{ text: 'Play' }, { text: 'Racing Kings', below: 'Local' }, { text: '5 min' }]);
  const boardNodes = await dev.waitFor('the Racing Kings board', (list) => list.some((n) => (n.id === 'chess-board' || n.desc === 'chess-board') && n.bounds && n.bounds.w > 50), 40_000);
  const board = boardNodes.find((n) => (n.id === 'chess-board' || n.desc === 'chess-board') && n.bounds && n.bounds.w > 50).bounds;
  if (Math.abs(board.w - board.h) > 2) throw new Error(`the Racing Kings board is not square: ${board.w}x${board.h}`);
  await dev.snapshot('racing-kings-start');
  const from = squareRect(board, 'w', 'e2');
  dev.press(from.cx, from.cy, 90);
  await new Promise((r) => setTimeout(r, 500));
  const to = squareRect(board, 'w', 'g3');
  dev.press(to.cx, to.cy, 90);
  const afterMove = await dev.waitFor('"Last move: Ng3" after 1.Ng3', (list) => list.some((n) => /Last move: Ng3/.test(n.text)), 15_000);
  const rkIssues = crashIssues(afterMove);
  if (rkIssues.length > 0) throw new Error(`Racing Kings: ${rkIssues.join('; ')}`);
  await dev.snapshot('racing-kings-after-ng3');
  console.log('smoke: Racing Kings (Local) board rendered and 1.Ng3 was played');
  ok = true;
} catch (e) {
  console.error(`smoke: FAILED - ${e.message}`);
  await dev.dump().then((nodes) => console.error(`smoke: on screen: ${visibleWords(nodes, 40).join(' | ')}`)).catch(() => {});
  await dev.snapshot('FAILED').catch(() => {});
}
const logcat = dev.logcat(1500);
writeFileSync(join(out, 'logcat.txt'), logcat);
if (!ok) console.error(`smoke: the last lines of the app's log:\n${logcat.split('\n').slice(-60).join('\n')}`);
process.exit(ok ? 0 : 1);
