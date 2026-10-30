#!/usr/bin/env node
/**
 * The pre-push gate (command #29; run by .githooks/pre-push, installed by `npm install` through scripts/install-hooks.mjs - no extra dependency): in order, the workflow-file check, `tsc`,
 * and the FAST vitest suites - the `logic` project's tests that are related to what changed since the branch's upstream (`vitest --changed`). The slow rendered (`dom`) project and the
 * Android run stay in CI.
 *
 * A WIP push may skip it, and only deliberately:   SKIP_PREPUSH=wip git push      (git push --no-verify skips every hook, this one included)
 * A skip is printed and appended to .git/pre-push-skips.log, because a report must say that a pushed commit was not checked.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const run = (title, command, args) => {
  const started = Date.now();
  process.stdout.write(`pre-push: ${title} ... `);
  const result = spawnSync(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.status === 0) {
    process.stdout.write(`ok (${Math.round((Date.now() - started) / 1000)} s)\n`);
    return true;
  }
  process.stdout.write('FAILED\n');
  process.stderr.write(`${(result.stdout ?? '').split('\n').slice(-40).join('\n')}\n${result.stderr ?? ''}\n`);
  return false;
};

const skip = process.env.SKIP_PREPUSH;
if (skip) {
  const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const note = `${new Date().toISOString()} pre-push SKIPPED (SKIP_PREPUSH=${skip.replace(/[^\w.-]/g, '')}) at ${head}\n`;
  process.stdout.write(`pre-push: ${note}`);
  if (existsSync(join(root, '.git'))) appendFileSync(join(root, '.git', 'pre-push-skips.log'), note);
  process.exit(0);
}

const upstream = spawnSync('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { cwd: root, encoding: 'utf8' });
const base = upstream.status === 0 ? upstream.stdout.trim() : 'origin/master';
const hasBase = spawnSync('git', ['rev-parse', '--verify', '--quiet', base], { cwd: root }).status === 0;

const ok =
  run('workflow files', 'npm', ['run', '--silent', 'check:workflows']) &&
  run('tsc', 'npx', ['tsc', '--noEmit']) &&
  (hasBase ? run(`fast tests related to the changes since ${base}`, 'npx', ['vitest', 'run', '--project', 'logic', '--changed', base, '--passWithNoTests']) : run('fast tests (no upstream to compare with: the android and workflow pins only)', 'npx', ['vitest', 'run', '--project', 'logic', 'src/logic/__tests__/androidE2e.test.ts']));
if (!ok) {
  process.stderr.write('pre-push: blocked. Fix it, or for a WIP push on purpose:  SKIP_PREPUSH=wip git push\n');
  process.exit(1);
}
