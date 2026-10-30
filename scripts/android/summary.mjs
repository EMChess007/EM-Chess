#!/usr/bin/env node
/**
 * Prints the Markdown summary of an Android end-to-end run (the workflow appends it to the job summary): one line per profile / phase with its counts and time, and every failed check by
 * name with its first problems.   node scripts/android/summary.mjs <output dir>
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'android-e2e-out';
const lines = ['### android-e2e'];
if (!existsSync(dir)) {
  lines.push('No results were written (the run did not reach the emulator).');
} else {
  for (const name of readdirSync(dir).sort()) {
    const file = join(dir, name, 'results.json');
    if (!existsSync(file)) continue;
    const run = JSON.parse(readFileSync(file, 'utf8'));
    const bad = run.results.filter((r) => !r.ok);
    lines.push(`- **${run.profile}/${run.phase}**: ${run.results.length - bad.length} passed, ${bad.length} failed, ${run.seconds} s, ${run.relaunches} relaunches`);
    for (const r of bad) lines.push(`  - FAILED \`${r.name}\`: ${r.issues.slice(0, 2).join(' | ').slice(0, 300)}`);
  }
}
console.log(lines.join('\n'));
