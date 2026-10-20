#!/usr/bin/env node
/**
 * The mutation RUNNER: slices a config into chunks and runs them one at a time, each in a child process with a hard time limit, writing every result OUTSIDE the repository.
 *
 *   npm run mutate -- <config.cjs> [--chunk-size 20] [--chunk N] [--match text] [--chunk-minutes 20] [--mutant-timeout ms] [--out dir] [--keep] [--dry-run]
 *
 *   --chunk-size     mutants per chunk (default 20, the AGENTS.md ceiling; larger values are refused)
 *   --chunk N        run only chunk N (1-based) instead of all of them in order
 *   --match text     only mutants whose name contains the text (numbering of chunks is over the matching list, so it is stable)
 *   --chunk-minutes  hard limit of one chunk, baseline included (default 20, the AGENTS.md ceiling; larger values are refused). When it passes, the chunk's process tree is killed
 *                    and the chunk is reported as TIMED OUT; the mutants it did not reach are "not run" - slice the config smaller, never raise the limit.
 *   --mutant-timeout the limit of one test run in ms (default: the config's mutantTimeoutMs, else 20 minutes)
 *   --out            the results directory (default <tmp>/em-chess-mutation-results/<config>-<timestamp>); refused when it is inside this repository
 *   --dry-run        print the plan (which mutants fall in which chunk) and run nothing
 *
 * One chunk at a time AND one runner at a time: a lock file in the temp directory names the running runner's PID; a second runner refuses to start while that process is alive
 * (a chunk next to another test run slows both and turns timing-sensitive tests into false kills). Results per chunk: <out>/chunk-<n>.json and chunk-<n>.log, and a running
 * <out>/summary.txt. Exit code: the worst chunk's (0 all killed, 1 a survivor, 2 red baseline, 3 timed out / not run, 4 invalid pattern or config).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { REPO_ROOT, isInside, killTree, resolveConfig, selectMutants } = require('./mutate-generic.cjs');

const MAX_CHUNK_SIZE = 20;
const MAX_CHUNK_MINUTES = 20;
const GRACE_MS = 60 * 1000;
const LOCK = path.join(os.tmpdir(), 'em-chess-mutation.lock');

function parse(argv) {
  const o = { config: undefined, chunkSize: MAX_CHUNK_SIZE, chunk: undefined, match: undefined, chunkMinutes: MAX_CHUNK_MINUTES, mutantTimeout: undefined, out: undefined, keep: false, dryRun: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => argv[++i];
    if (a === '--chunk-size') o.chunkSize = Number(value());
    else if (a === '--chunk') o.chunk = Number(value());
    else if (a === '--match') o.match = value();
    else if (a === '--chunk-minutes') o.chunkMinutes = Number(value());
    else if (a === '--mutant-timeout') o.mutantTimeout = Number(value());
    else if (a === '--out') o.out = value();
    else if (a === '--keep') o.keep = true;
    else if (a === '--dry-run') o.dryRun = true;
    else rest.push(a);
  }
  o.config = rest[0];
  return o;
}

/** Splits `count` mutants into chunks of at most `size`: [{ n, from, to }] with 1-based inclusive bounds. */
function planChunks(count, size) {
  const chunks = [];
  for (let from = 1, n = 1; from <= count; from += size, n++) chunks.push({ n, from, to: Math.min(count, from + size - 1) });
  return chunks;
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function acquireLock() {
  let existing = 0;
  try {
    existing = Number(fs.readFileSync(LOCK, 'utf8'));
  } catch {
    /* no lock file: nobody is running */
  }
  if (existing && existing !== process.pid && processAlive(existing)) {
    throw new Error(`another mutation runner is running (PID ${existing}); one at a time - wait for it, or remove ${LOCK} if that process is not a mutation runner`);
  }
  fs.writeFileSync(LOCK, String(process.pid));
}

function releaseLock() {
  try {
    if (Number(fs.readFileSync(LOCK, 'utf8')) === process.pid) fs.unlinkSync(LOCK);
  } catch {
    /* gone already */
  }
}

/** Runs one chunk in a child process; resolves { code, timedOut }. */
function runChunk(configPath, chunk, o, outDir, deadlineMs) {
  return new Promise((resolve) => {
    const args = [path.join(__dirname, 'mutate-generic.cjs'), configPath, '--from', String(chunk.from), '--to', String(chunk.to), '--out', path.join(outDir, `chunk-${chunk.n}.json`), '--deadline', String(Date.now() + deadlineMs)];
    if (o.match) args.push('--match', o.match);
    if (o.mutantTimeout) args.push('--mutant-timeout', String(o.mutantTimeout));
    if (o.keep) args.push('--keep');
    const logFd = fs.openSync(path.join(outDir, `chunk-${chunk.n}.log`), 'w');
    const child = cp.spawn(process.execPath, args, { stdio: ['ignore', logFd, logFd], windowsHide: true, detached: process.platform !== 'win32' });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, deadlineMs + GRACE_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      fs.closeSync(logFd);
      resolve({ code: timedOut ? 3 : code, timedOut });
    });
  });
}

async function main(argv) {
  const o = parse(argv);
  if (!o.config) {
    console.error('usage: npm run mutate -- <config.cjs> [--chunk-size 20] [--chunk N] [--match text] [--chunk-minutes 20] [--mutant-timeout ms] [--out dir] [--keep] [--dry-run]');
    return 4;
  }
  if (!(o.chunkSize >= 1 && o.chunkSize <= MAX_CHUNK_SIZE)) throw new Error(`--chunk-size must be 1..${MAX_CHUNK_SIZE} (AGENTS.md: chunks of at most ~20 mutants)`);
  if (!(o.chunkMinutes > 0 && o.chunkMinutes <= MAX_CHUNK_MINUTES)) throw new Error(`--chunk-minutes must be in (0, ${MAX_CHUNK_MINUTES}] (AGENTS.md: chunks of at most ~20 minutes)`);
  const configPath = path.resolve(o.config);
  const c = resolveConfig(require(configPath), configPath);
  const selected = selectMutants(c.mutants, o.match);
  if (selected.length === 0) throw new Error(`no mutant matches "${o.match}"`);
  const chunks = planChunks(selected.length, o.chunkSize);
  const wanted = o.chunk === undefined ? chunks : chunks.filter((ch) => ch.n === o.chunk);
  if (wanted.length === 0) throw new Error(`there is no chunk ${o.chunk}; the plan has ${chunks.length}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(o.out ?? path.join(os.tmpdir(), 'em-chess-mutation-results', `${c.name}-${stamp}`));
  if (isInside(outDir, REPO_ROOT)) throw new Error(`the results directory ${outDir} is inside the repository: results are written outside it`);

  console.log(`${c.name}: ${selected.length} mutants${o.match ? ` matching "${o.match}"` : ''} in ${chunks.length} chunk(s) of at most ${o.chunkSize}; running ${wanted.map((w) => w.n).join(', ')}; results in ${outDir}`);
  if (o.dryRun) {
    for (const ch of chunks) console.log(`  chunk ${ch.n}: mutants ${ch.from}-${ch.to}  (${selected.slice(ch.from - 1, ch.to).map((m) => m[0]).join(' | ').slice(0, 200)})`);
    return 0;
  }
  fs.mkdirSync(outDir, { recursive: true });
  acquireLock();
  let worst = 0;
  try {
    for (const ch of wanted) {
      const started = Date.now();
      const { code, timedOut } = await runChunk(configPath, ch, o, outDir, o.chunkMinutes * 60 * 1000);
      let killed = '?';
      let survived = '?';
      try {
        const r = JSON.parse(fs.readFileSync(path.join(outDir, `chunk-${ch.n}.json`), 'utf8'));
        killed = r.killed;
        survived = r.survived;
      } catch {
        /* the chunk died before it wrote a result */
      }
      const line = `chunk ${ch.n} (mutants ${ch.from}-${ch.to}): exit ${code}${timedOut ? ' TIMED OUT' : ''}, ${killed} killed, ${survived} survived, ${Math.round((Date.now() - started) / 1000)} s`;
      console.log(line);
      fs.appendFileSync(path.join(outDir, 'summary.txt'), line + '\n');
      worst = Math.max(worst, code ?? 4);
    }
  } finally {
    releaseLock();
  }
  console.log(worst === 0 ? 'ALL KILLED' : `NOT CLEAN (exit ${worst}); see ${outDir}`);
  return worst;
}

module.exports = { planChunks, parse, MAX_CHUNK_SIZE, MAX_CHUNK_MINUTES };

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      releaseLock();
      console.error(`mutate: ${err.message}`);
      process.exit(4);
    },
  );
}
