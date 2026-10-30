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
import { crashIssues } from './lib/checks.mjs';

const out = join(process.argv[2] ?? 'android-e2e-out', 'smoke');
const dev = new Device({ outDir: out });
let ok = false;
try {
  dev.applyProfile(PROFILES.large);
  dev.clearData();
  dev.launch();
  const t0 = Date.now();
  const nodes = await dev.waitHome(360_000);
  console.log(`smoke: Home is up after ${Math.round((Date.now() - t0) / 1000)} s with ${nodes.length} nodes: ${visibleWords(nodes, 25).join(' | ')}`);
  const issues = crashIssues(nodes);
  if (issues.length > 0) throw new Error(issues.join('; '));
  await dev.snapshot('home');
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
