#!/usr/bin/env node
/**
 * COPY-BASED mutation engine: it injects one bug at a time into a COPY of the source and runs a test command; a mutant is KILLED when the command fails (or hangs past
 * its time limit) and SURVIVES when it passes. The real repository is only ever READ. Normally you do not run this file directly: `npm run mutate -- <config>` (scripts/mutation/run.cjs)
 * slices a config into chunks of at most ~20 mutants / 20 minutes, one chunk at a time, and writes its results outside the repository. See scripts/mutation/README.md.
 *
 *   node scripts/mutation/mutate-generic.cjs <config.cjs> [--match text] [--from N] [--to M] [--out result.json] [--mutant-timeout ms] [--deadline epochMs] [--keep]
 *
 * (A bare second argument without "--" is the legacy name filter: `mutate-generic.cjs cfg.cjs const:`.)
 *
 * A config is a CommonJS module:
 *   root            the repository to mutate (read only); default: this repository
 *   work            the directory the copy is made in; default: <tmp>/em-chess-mutation/<config name>-<pid>. It must be OUTSIDE `root`.
 *   copy            paths (relative to root) copied into the work directory. Never `node_modules`.
 *   junction        paths (relative to root) LINKED into the work directory instead of copied (a junction on Windows, a directory symlink elsewhere) - normally ['node_modules'].
 *   cmd             the shell command run inside the work directory; exit code 0 = the tests pass.
 *   mutants         [[name, file, find, replace], ...]: `find` must occur EXACTLY ONCE in `file` (line endings are normalised; the file's own style is kept when it is written).
 *   mutantTimeoutMs time limit per run of `cmd` (default 20 minutes); a run that exceeds it is killed (with its whole process tree) and counts as killed ("timeout").
 *   baselineTimeoutMs  the same for the unmutated baseline run (default: mutantTimeoutMs).
 *
 * Safety, in the order it is enforced: the work directory may not be inside `root` (nor contain it); `node_modules` is never copied; links are removed with unlink / rmdir and
 * NEVER followed when the work directory is cleaned (a recursive delete that followed one would empty the real node_modules), and the real targets are checked to still exist
 * afterwards; a run that exceeds its time limit is killed together with every process it started.
 *
 * Exit code: 0 every mutant killed; 1 a mutant survived; 2 the baseline is red; 3 the deadline passed before every mutant ran; 4 a pattern did not match exactly once / bad config.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const OUTPUT_LIMIT = 8 * 1024 * 1024;

const norm = (text) => text.replace(/\r\n/g, '\n');

/** True when `child` is `parent` itself or lies below it (both resolved; path.relative is case-insensitive on Windows). */
function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false; // a different drive
  return rel !== '..' && !rel.startsWith(`..${path.sep}`);
}

/** Kills a process and everything it started. */
function killTree(child) {
  if (!child || child.pid === undefined || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') cp.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

/** Runs a shell command with a hard time limit. Resolves { status, timedOut, output }; never rejects. The whole process tree is killed on timeout. */
function runCommand(command, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const child = cp.spawn(command, { cwd, shell: true, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    const take = (data) => {
      if (output.length < OUTPUT_LIMIT) output += data.toString();
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ status: 1, timedOut, output: `${output}\n${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ status: timedOut ? null : code, timedOut, output });
    });
  });
}

/** Removes a directory tree WITHOUT following a link: every symlink / junction in it is unlinked (or rmdir'd) itself, real directories are emptied, then removed. */
function removeTree(dir) {
  let stat;
  try {
    stat = fs.lstatSync(dir);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) {
    try {
      fs.unlinkSync(dir);
    } catch {
      fs.rmdirSync(dir); // a Windows directory junction is removed with rmdir, which removes the link and leaves its target
    }
    return;
  }
  if (!stat.isDirectory()) {
    fs.unlinkSync(dir);
    return;
  }
  for (const entry of fs.readdirSync(dir)) removeTree(path.join(dir, entry));
  fs.rmdirSync(dir);
}

/** The first line of a failing run that says why (for the log). */
function reasonOf(output) {
  const lines = output.split('\n').map((l) => l.trim()).filter(Boolean);
  const hit = lines.find((l) => /(^|\s)(FAIL|AssertionError|Error:|not ok|✗|×)/.test(l)) ?? lines[lines.length - 1] ?? '(no output)';
  return hit.slice(0, 150);
}

function parseArgs(argv) {
  const opts = { config: undefined, match: undefined, from: undefined, to: undefined, out: undefined, mutantTimeout: undefined, deadline: undefined, keep: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => argv[++i];
    if (a === '--match') opts.match = value();
    else if (a === '--from') opts.from = Number(value());
    else if (a === '--to') opts.to = Number(value());
    else if (a === '--out') opts.out = value();
    else if (a === '--mutant-timeout') opts.mutantTimeout = Number(value());
    else if (a === '--deadline') opts.deadline = Number(value());
    else if (a === '--keep') opts.keep = true;
    else rest.push(a);
  }
  opts.config = rest[0];
  if (rest[1] !== undefined && opts.match === undefined) opts.match = rest[1]; // the legacy positional filter
  return opts;
}

/** Validates a loaded config and fills the defaults. Throws a plain Error with a message that says what to fix. */
function resolveConfig(cfg, configPath) {
  const name = path.basename(configPath || 'config', path.extname(configPath || 'config'));
  const root = path.resolve(cfg.root ?? REPO_ROOT);
  const work = path.resolve(cfg.work ?? path.join(os.tmpdir(), 'em-chess-mutation', `${name}-${process.pid}`));
  if (isInside(work, root)) throw new Error(`the work directory ${work} is inside the repository ${root}: the copy must live outside it`);
  if (isInside(root, work)) throw new Error(`the work directory ${work} contains the repository ${root}: refusing (cleaning it would delete the repository)`);
  const copy = cfg.copy ?? [];
  const junction = cfg.junction ?? [];
  if (!Array.isArray(copy) || !Array.isArray(junction)) throw new Error('"copy" and "junction" must be arrays of paths relative to root');
  for (const p of [...copy, ...junction]) {
    if (typeof p !== 'string' || p === '' || path.isAbsolute(p) || p.split(/[\\/]/).includes('..')) throw new Error(`"${p}" is not a plain relative path`);
  }
  for (const p of copy) if (p.split(/[\\/]/).includes('node_modules')) throw new Error(`"${p}": node_modules is never copied - list it under "junction"`);
  if (typeof cfg.cmd !== 'string' || cfg.cmd.trim() === '') throw new Error('"cmd" is required');
  if (!Array.isArray(cfg.mutants) || cfg.mutants.length === 0) throw new Error('"mutants" must be a non-empty array of [name, file, find, replace]');
  for (const m of cfg.mutants) {
    if (!Array.isArray(m) || m.length !== 4 || m.some((x) => typeof x !== 'string') || m[2] === '') throw new Error(`a mutant must be [name, file, find, replace] (non-empty find): ${JSON.stringify(m).slice(0, 120)}`);
    if (isInside(path.resolve(work, m[1]), work) === false || path.isAbsolute(m[1])) throw new Error(`mutant "${m[0]}": file "${m[1]}" is outside the copy`);
  }
  const mutantTimeoutMs = cfg.mutantTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  return { name, root, work, copy, junction, cmd: cfg.cmd, mutants: cfg.mutants, mutantTimeoutMs, baselineTimeoutMs: cfg.baselineTimeoutMs ?? mutantTimeoutMs };
}

/** The mutants a run covers: the `match` filter first (stable numbering), then the 1-based inclusive [from, to] slice. */
function selectMutants(mutants, match, from, to) {
  const matching = mutants.map((m, index) => ({ m, index })).filter(({ m }) => !match || m[0].includes(match));
  const start = from !== undefined && !Number.isNaN(from) ? Math.max(1, from) : 1;
  const end = to !== undefined && !Number.isNaN(to) ? to : matching.length;
  return matching.slice(start - 1, end).map(({ m }) => m);
}

function makeCopy(c) {
  removeTree(c.work);
  fs.mkdirSync(c.work, { recursive: true });
  for (const p of c.copy) {
    const from = path.join(c.root, p);
    if (!fs.existsSync(from)) throw new Error(`copy: ${p} does not exist in ${c.root}`);
    const to = path.join(c.work, p);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true, dereference: false });
  }
  for (const p of c.junction) {
    const target = path.join(c.root, p);
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new Error(`junction: ${p} is not a directory in ${c.root}`);
    const link = path.join(c.work, p);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  }
}

function cleanCopy(c) {
  removeTree(c.work);
  for (const p of c.junction) {
    if (!fs.existsSync(path.join(c.root, p))) throw new Error(`SAFETY: ${path.join(c.root, p)} no longer exists after cleaning the copy - something followed a link`);
  }
}

async function runMutation(rawCfg, configPath, opts = {}) {
  const c = resolveConfig(rawCfg, configPath);
  const selected = selectMutants(c.mutants, opts.match, opts.from, opts.to);
  const timeoutMs = opts.mutantTimeout ?? c.mutantTimeoutMs;
  const log = opts.log ?? ((line) => console.log(line));
  const started = Date.now();
  const results = [];
  const finish = (exitCode, baseline) => {
    const killed = results.filter((r) => r.status === 'killed' || r.status === 'timeout').length;
    const survived = results.filter((r) => r.status === 'survived').length;
    const invalid = results.filter((r) => r.status === 'invalid').length;
    const notRun = results.filter((r) => r.status === 'not-run').length;
    const summary = { config: c.name, baseline, total: selected.length, killed, survived, invalid, notRun, timedOut: results.filter((r) => r.status === 'timeout').length, ms: Date.now() - started, exitCode, results };
    if (opts.out) {
      fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
      fs.writeFileSync(opts.out, JSON.stringify(summary, null, 1) + '\n');
    }
    return summary;
  };

  makeCopy(c);
  try {
    const base = await runCommand(c.cmd, c.work, c.baselineTimeoutMs);
    const green = base.status === 0 && !base.timedOut;
    log(`BASELINE (unmutated copy): ${green ? 'green' : base.timedOut ? 'RED (timed out)' : 'RED'}`);
    if (!green) {
      log(base.output.slice(-2500));
      return finish(2, 'red');
    }
    for (const [name, rel, find, replace] of selected) {
      if (opts.deadline && Date.now() > opts.deadline) {
        log(`NOT RUN   ${name} (deadline passed)`);
        results.push({ name, file: rel, status: 'not-run', reason: 'deadline', ms: 0 });
        continue;
      }
      const file = path.join(c.work, rel);
      if (!fs.existsSync(file)) {
        log(`PATTERN   no such file ${rel}: ${name}`);
        results.push({ name, file: rel, status: 'invalid', reason: 'file missing', ms: 0 });
        continue;
      }
      const original = fs.readFileSync(file, 'utf8');
      const crlf = original.includes('\r\n');
      const body = norm(original);
      const needle = norm(find);
      const count = body.split(needle).length - 1;
      if (count !== 1) {
        log(`PATTERN ${count}x: ${name}`);
        results.push({ name, file: rel, status: 'invalid', reason: `pattern matched ${count} times`, ms: 0 });
        continue;
      }
      let mutated = body.replace(needle, () => norm(replace));
      if (mutated === body) {
        log(`PATTERN   the replacement changes nothing: ${name}`);
        results.push({ name, file: rel, status: 'invalid', reason: 'no-op replacement', ms: 0 });
        continue;
      }
      if (crlf) mutated = mutated.replace(/\n/g, '\r\n');
      fs.writeFileSync(file, mutated);
      const t0 = Date.now();
      let run;
      try {
        run = await runCommand(c.cmd, c.work, timeoutMs);
      } finally {
        fs.writeFileSync(file, original);
      }
      const ms = Date.now() - t0;
      if (run.timedOut) {
        log(`killed    ${name}   <- TIMEOUT after ${Math.round(timeoutMs / 1000)} s`);
        results.push({ name, file: rel, status: 'timeout', reason: 'timeout', ms });
      } else if (run.status !== 0) {
        const reason = reasonOf(run.output);
        log(`killed    ${name}   <- ${reason}`);
        results.push({ name, file: rel, status: 'killed', reason, ms });
      } else {
        log(`SURVIVED  ${name}`);
        results.push({ name, file: rel, status: 'survived', reason: '', ms });
      }
    }
    const summary = finish(0, 'green');
    summary.exitCode = summary.invalid > 0 ? 4 : summary.notRun > 0 ? 3 : summary.survived > 0 ? 1 : 0;
    if (opts.out) fs.writeFileSync(opts.out, JSON.stringify(summary, null, 1) + '\n');
    log('');
    for (const r of results.filter((x) => x.status === 'survived' || x.status === 'invalid' || x.status === 'not-run')) log(`  ${r.status.toUpperCase()}: ${r.name}${r.reason ? ` (${r.reason})` : ''}`);
    log(`${summary.killed} killed, ${summary.survived} survived${summary.invalid ? `, ${summary.invalid} INVALID` : ''}${summary.notRun ? `, ${summary.notRun} NOT RUN` : ''}`);
    return summary;
  } finally {
    if (!opts.keep) cleanCopy(c);
  }
}

module.exports = { runMutation, resolveConfig, selectMutants, isInside, removeTree, runCommand, killTree, parseArgs, REPO_ROOT };

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.config) {
    console.error('usage: node scripts/mutation/mutate-generic.cjs <config.cjs> [--match text] [--from N] [--to M] [--out result.json] [--mutant-timeout ms] [--deadline epochMs] [--keep]');
    process.exit(4);
  }
  const configPath = path.resolve(opts.config);
  runMutation(require(configPath), configPath, opts).then(
    (summary) => process.exit(summary.exitCode),
    (err) => {
      console.error(`mutate-generic: ${err.message}`);
      process.exit(4);
    },
  );
}
