/**
 * The resumable progress file of the Android device matrix (command #27d): a full run is about an hour and a container can restart in the middle of it.
 *
 *   node scripts/browser/android-matrix.mjs --profile full --progress /path/progress.jsonl
 *
 * One JSON object per line. The first line is the HEADER (`{ header: { profile, screens } }`: what this file is a run of); then one line per FINISHED screen of a page group
 * (`{ done: "<scale>|<theme>|<screen id>", results: [...] }`), appended the moment the screen's combinations are all checked. On a restart the finished screens are skipped and their
 * results are read back, so the report at the end is the report of the whole run. A file whose header names another profile or another list of screens is refused (never silently
 * mixed in), and a last line cut short by a kill is ignored (the screen it belonged to simply runs again). A screen that was unreachable is never marked done.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

export function openProgress(file, header) {
  const done = new Set();
  const results = [];
  if (existsSync(file) && readFileSync(file, 'utf8').trim() !== '') {
    const lines = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '');
    let first;
    try {
      first = JSON.parse(lines[0]);
    } catch {
      throw new Error(`progress file ${file} has no readable header: delete it to start the run again`);
    }
    if (JSON.stringify(first.header) !== JSON.stringify(header)) throw new Error(`progress file ${file} is a run of ${JSON.stringify(first.header)}, not of ${JSON.stringify(header)}: delete it to start the run again`);
    for (const line of lines.slice(1)) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // a line cut short by a kill: its screen runs again
      }
      if (typeof entry.done !== 'string' || !Array.isArray(entry.results)) continue;
      done.add(entry.done);
      results.push(...entry.results);
    }
  } else {
    writeFileSync(file, `${JSON.stringify({ header })}\n`);
  }
  return {
    done,
    results,
    /** Writes one finished screen of a page group; from then on a restart skips it. */
    save(key, screenResults) {
      appendFileSync(file, `${JSON.stringify({ done: key, results: screenResults })}\n`);
      done.add(key);
    },
  };
}

/** The key of one screen of one page group. */
export const progressKey = (group, screenId) => `${group.scale}|${group.theme}|${screenId}`;
