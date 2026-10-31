#!/usr/bin/env node
/**
 * Prints the Markdown summary of an Android end-to-end run (the aggregate job appends it to the job summary AND prints it to its log, which is the one short log of the run): one line per
 * slice (profile / phase / tag) with its counts and time, every failed check by name with its first problems, the notes of the checks that carry a finding even when they pass (the touch
 * checks: which touch the 2-player board understood, the frame the run was in; the gallery: the measured light share), and the accessibility dumps that failed.
 *   node scripts/android/summary.mjs <output dir>
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'android-e2e-out';
const lines = ['### android-e2e'];
const NOTED = /^(touch|piece gallery|text-fit|offline)/;
let slowest = 0;
let total = 0;
if (!existsSync(dir)) {
  lines.push('No results were written (the run did not reach the emulator).');
} else {
  for (const name of readdirSync(dir).sort()) {
    const file = join(dir, name, 'results.json');
    if (!existsSync(file)) continue;
    const run = JSON.parse(readFileSync(file, 'utf8'));
    const bad = run.results.filter((r) => !r.ok);
    slowest = Math.max(slowest, run.seconds);
    total += run.seconds;
    lines.push(`- **${name}** (${run.profile}/${run.phase}): ${run.results.length - bad.length} passed, ${bad.length} failed, ${(run.seconds / 60).toFixed(1)} min, ${run.relaunches} relaunches`);
    for (const r of bad) lines.push(`  - FAILED \`${r.name}\`: ${r.issues.slice(0, 3).join(' | ').slice(0, 700)}${r.note && NOTED.test(r.name) ? ` || note: ${r.note.slice(0, 500)}` : ''}`);
    for (const r of run.results.filter((x) => x.ok && NOTED.test(x.name) && x.note)) lines.push(`  - ok \`${r.name}\`: ${r.note.slice(0, 400)}`);
    if (run.dumpFailures && Object.keys(run.dumpFailures).length > 0) lines.push(`  - accessibility dumps that failed: ${JSON.stringify(run.dumpFailures).slice(0, 300)}`);
  }
  lines.push('', `Slowest slice ${(slowest / 60).toFixed(1)} min; all slices together ${(total / 60).toFixed(1)} min of emulator time.`);
}
console.log(lines.join('\n'));
