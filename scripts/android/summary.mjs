#!/usr/bin/env node
/**
 * The summary of an Android end-to-end run, in two parts (the aggregate job of .github/workflows/android-e2e.yml runs both):
 *
 *   node scripts/android/summary.mjs <output dir>             the DIGEST (Markdown): one line per slice (profile / phase / tag) with its counts, time and, when it failed, its label RUNNER or APP;
 *                                                             every failed check by name with its first problems; the notes of the checks that carry a finding even when they pass; the
 *                                                             accessibility dumps that failed; the runner's health readings. It is printed to the job's log (the one short log of the run)
 *                                                             and appended to $GITHUB_STEP_SUMMARY.
 *   node scripts/android/summary.mjs <output dir> --images    the FAILING SCREENSHOTS (command #32): on a failure only, every failing slice's downscaled PNGs (the `PNG64` lines the driver
 *                                                             logged for a failing screen / exception, and the `FAILED-*.png` snapshots) as base64 inside collapsed <details>, so a session
 *                                                             can read them from the job summary / the job log without downloading an artifact (`base64 -d`). Nothing is printed on a green run.
 *
 *   node scripts/android/summary.mjs <output dir> --informational   the INFORMATIONAL (not blocking) section (command #44): the full e2e per slice, passed / failed, first failing scenario, label.
 *
 * The attempts of a slice: a slice that failed on a slow runner is run once more by run-on-emulator.sh into `<slice>-retry`; the digest shows both and the slice's verdict is the LAST attempt.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodePng, encodePng, shrink } from './lib/png.mjs';

const NOTED = /^(touch|piece gallery|text-fit|offline)/;

/** The byte budget of the screenshots (GitHub caps one step summary at 1 MiB): at most this many base64 characters in all, and per image. */
export const IMAGE_BUDGET = { totalChars: 600_000, imageChars: 90_000, maxImages: 8 };

/** Every slice's attempts: [{ name, attempts: [{ dir, name, run }] }], the attempts in order (`-retry` last). */
export function readSlices(dir) {
  if (!existsSync(dir)) return null;
  const bySlice = new Map();
  for (const name of readdirSync(dir).sort()) {
    const file = join(dir, name, 'results.json');
    if (!existsSync(file)) continue;
    const slice = name.replace(/-retry$/, '');
    const run = JSON.parse(readFileSync(file, 'utf8'));
    if (!bySlice.has(slice)) bySlice.set(slice, []);
    bySlice.get(slice).push({ dir: join(dir, name), name, run });
  }
  return [...bySlice.entries()].map(([name, attempts]) => ({ name, attempts: attempts.sort((a, b) => (a.run.attempt ?? 1) - (b.run.attempt ?? 1)) }));
}

const healthText = (health) => {
  if (!health?.start) return 'health not measured';
  const end = health.end ? `, end input ${health.end.inputMs} ms` : '';
  return `health: input ${health.start.inputMs} ms, dump ${health.start.dumpMs} ms${end}`;
};

/** The digest (Markdown) and the number of slices whose LAST attempt failed. */
export function buildDigest(dir) {
  const lines = ['### android-e2e'];
  const slices = readSlices(dir);
  let slowest = 0;
  let total = 0;
  let red = 0;
  if (slices === null) {
    lines.push('No results were written (the run did not reach the emulator).');
    return { text: lines.join('\n'), red: 1 };
  }
  for (const slice of slices) {
    const last = slice.attempts[slice.attempts.length - 1];
    for (const attempt of slice.attempts) {
      const run = attempt.run;
      const bad = run.results.filter((r) => !r.ok);
      slowest = Math.max(slowest, run.seconds);
      total += run.seconds;
      const isLast = attempt === last;
      const retried = !isLast;
      if (isLast && bad.length > 0) red++;
      const label = run.label ? ` [${run.label}]` : '';
      const tag = retried ? ' (attempt 1, repeated: the runner was slow)' : slice.attempts.length > 1 ? ' (attempt 2, the verdict)' : '';
      lines.push(`- **${attempt.name}** (${run.profile}/${run.phase})${tag}${label}: ${run.results.length - bad.length} passed, ${bad.length} failed, ${(run.seconds / 60).toFixed(1)} min, ${run.relaunches} relaunches; ${healthText(run.health)}`);
      for (const r of bad) lines.push(`  - FAILED \`${r.name}\`: ${r.issues.slice(0, 3).join(' | ').slice(0, 700)}${r.note && NOTED.test(r.name) ? ` || note: ${r.note.slice(0, 500)}` : ''}`);
      for (const r of run.results.filter((x) => x.ok && NOTED.test(x.name) && x.note)) lines.push(`  - ok \`${r.name}\`: ${r.note.slice(0, 400)}`);
      if (run.dumpFailures && Object.keys(run.dumpFailures).length > 0) lines.push(`  - accessibility dumps that failed: ${JSON.stringify(run.dumpFailures).slice(0, 300)}`);
    }
    if (last.run.label === 'RUNNER') lines.push(`  - **RUNNER**: ${slice.name} failed on a slow runner even after its repeat - a suspected runner problem, not proved an app bug (TESTING.md section 48); read the health numbers above before reading the failures.`);
    else if (last.run.label === 'APP') lines.push(`  - **APP**: ${slice.name} failed on a healthy runner (never repeated): read the failures above as findings.`);
    else if (slice.attempts.length > 1) lines.push(`  - ${slice.name} passed on its repeat after a slow-runner failure (attempt 1 is kept above as evidence).`);
  }
  lines.push('', `Slowest slice ${(slowest / 60).toFixed(1)} min; all slices together ${(total / 60).toFixed(1)} min of emulator time.`);
  return { text: lines.join('\n'), red };
}

/** Command #52: slices / jobs whose full-e2e failure does not block (large-perf: board taps lost at the start of a bot game, cause unproven; TODO.md). */
const INFORMATIONAL_SLICES = ['large-static-perf'];
const INFORMATIONAL_JOBS = ['large-perf'];

/** The marker lines run-on-emulator.sh wrote for failed full-e2e phases (`e2e-informational-<job>.txt`): { job: [lines] }. */
export function readMarkers(dir) {
  const out = {};
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir).sort()) {
    const m = /^e2e-informational-(.+)\.txt$/.exec(file);
    if (!m) continue;
    out[m[1]] = readFileSync(join(dir, file), 'utf8').split('\n').filter((l) => l.trim() !== '');
  }
  return out;
}

/**
 * The FULL e2e results as the INFORMATIONAL (not blocking) section of the job summary (command #44): per slice passed / failed, the first failing scenario and the label (RUNNER / APP).
 * Only the smoke is required; this never decides the verdict. `failed` counts the slices whose last attempt failed or whose phase left a marker line (a crash with no results.json).
 */
export function buildInformational(dir) {
  const lines = ['### Full e2e results', '', 'The required check is the smoke plus the full end-to-end run (release-mode APK, ANDROID_E2E_STRICT=1; TESTING.md section 45). The results per slice:', ''];
  const slices = readSlices(dir) ?? [];
  const markers = readMarkers(dir);
  let failed = 0;
  const info = [];
  for (const slice of slices) {
    const last = slice.attempts[slice.attempts.length - 1];
    const bad = last.run.results.filter((r) => !r.ok);
    if (bad.length === 0) {
      lines.push(`- **${slice.name}**: passed (${last.run.results.length} checks)`);
      continue;
    }
    const label = last.run.label ? ` [${last.run.label}]` : '';
    const text = `- **${slice.name}**: FAILED${label}: ${bad.length} of ${last.run.results.length} checks failed; first failing scenario \`${bad[0].name}\`: ${(bad[0].issues ?? []).slice(0, 1).join('').slice(0, 300)}`;
    // Command #52: the large-perf slice is not required (TODO.md).
    if (INFORMATIONAL_SLICES.includes(slice.name)) info.push(text);
    else {
      failed++;
      lines.push(text);
    }
  }
  // The marker lines (one per failed phase, also a phase that crashed before writing results.json) are listed as they are.
  for (const [job, entries] of Object.entries(markers)) {
    if (INFORMATIONAL_JOBS.includes(job)) info.push(`- run-on-emulator.sh marker of **${job}**: ${entries.join(' | ').slice(0, 500)}`);
    else lines.push(`- run-on-emulator.sh marker of **${job}**: ${entries.join(' | ').slice(0, 500)}`);
  }
  if (info.length > 0) lines.push('', '#### Informational (not blocking)', '', ...info);
  const blockingMarkers = Object.keys(markers).filter((j) => !INFORMATIONAL_JOBS.includes(j)).length;
  if (slices.length === 0 && blockingMarkers > 0) failed = blockingMarkers;
  if (slices.length === 0 && Object.keys(markers).length === 0) lines.push('No full end-to-end results were written.');
  lines.push('', `${failed} slice(s) failed the full e2e run.`);
  return { text: lines.join('\n'), failed };
}

/** The `PNG64 <name> <base64>` lines of a run.log: [{ name, base64 }]. */
export function pngLines(logText) {
  const out = [];
  for (const line of logText.split('\n')) {
    const m = /\bPNG64 (\S+) ([A-Za-z0-9+/=]+)\s*$/.exec(line);
    if (m) out.push({ name: m[1], base64: m[2] });
  }
  return out;
}

/** A PNG as base64 within `limit` characters: shrunk by 2 (up to three times) while it is larger; null when it cannot be made small enough. */
export function fitPng(buffer, limit = IMAGE_BUDGET.imageChars) {
  let base64 = buffer.toString('base64');
  if (base64.length <= limit) return base64;
  let png = decodePng(buffer);
  for (let i = 0; i < 3 && png.width >= 160; i++) {
    png = shrink(png, 2);
    base64 = encodePng(png).toString('base64');
    if (base64.length <= limit) return base64;
  }
  return null;
}

/** The failing screenshots of the slices whose LAST attempt failed, as collapsed Markdown, within IMAGE_BUDGET. '' when nothing failed. */
export function buildImages(dir, budget = IMAGE_BUDGET) {
  const slices = readSlices(dir);
  if (slices === null) return '';
  const blocks = [];
  let chars = 0;
  let skipped = 0;
  for (const slice of slices) {
    const last = slice.attempts[slice.attempts.length - 1];
    if (last.run.results.every((r) => r.ok)) continue;
    const candidates = [];
    const logFile = join(last.dir, 'run.log');
    if (existsSync(logFile)) for (const p of pngLines(readFileSync(logFile, 'utf8'))) candidates.push({ name: p.name, buffer: Buffer.from(p.base64, 'base64') });
    for (const file of readdirSync(last.dir).filter((f) => /^FAILED-.*\.png$/.test(f)).sort()) candidates.push({ name: file.replace(/\.png$/, ''), buffer: readFileSync(join(last.dir, file)) });
    const seen = new Set();
    for (const c of candidates) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      if (blocks.length >= budget.maxImages) {
        skipped++;
        continue;
      }
      let base64;
      try {
        base64 = fitPng(c.buffer, budget.imageChars);
      } catch {
        base64 = null;
      }
      if (base64 === null || chars + base64.length > budget.totalChars) {
        skipped++;
        continue;
      }
      chars += base64.length;
      blocks.push(`<details><summary>${last.name}: ${c.name} (${Math.round(base64.length / 1024)} KiB base64)</summary>\n\n\`\`\`text\n${base64}\n\`\`\`\n\n</details>`);
    }
  }
  if (blocks.length === 0 && skipped === 0) return '';
  const head = ['### android-e2e: the failing screenshots', '', 'Downscaled PNGs, base64 (`echo <text> | base64 -d > shot.png`). The full-size screenshots and trees are in the `android-e2e-<slice>` artifacts.', ''];
  if (skipped > 0) head.push(`(${skipped} more screenshot(s) were left out to stay inside the summary's size limit.)`, '');
  return [...head, ...blocks].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] ?? 'android-e2e-out';
  console.log(process.argv.includes('--images') ? buildImages(dir) : process.argv.includes('--informational') ? buildInformational(dir).text : buildDigest(dir).text);
}
