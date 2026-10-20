import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The mutation harness's own tests (scripts/mutation/README.md): chunk planning, the safety refusals, an end-to-end run of the example config with a survivor, the cleaning of a
 * work directory that holds a link (the real target must survive it), a hanging test run killed together with its children, the deadline, a red baseline, an invalid pattern,
 * and the runner's limits. Everything is made in a throw-away directory under the temp folder; nothing here touches node_modules or a real source file.
 */
const load = createRequire(path.join(__dirname, 'x.js'));
const engine = load('./mutate-generic.cjs') as {
  runMutation: (cfg: object, configPath: string, opts?: Record<string, unknown>) => Promise<{ exitCode: number; killed: number; survived: number; invalid: number; notRun: number; timedOut: number; results: { name: string; status: string }[] }>;
  resolveConfig: (cfg: object, configPath: string) => { name: string; work: string; root: string };
  selectMutants: (mutants: string[][], match?: string, from?: number, to?: number) => string[][];
  isInside: (child: string, parent: string) => boolean;
  removeTree: (dir: string) => void;
  REPO_ROOT: string;
};
const runner = load('./run.cjs') as { planChunks: (count: number, size: number) => { n: number; from: number; to: number }[]; MAX_CHUNK_SIZE: number; MAX_CHUNK_MINUTES: number };
const exampleConfigPath = path.join(__dirname, 'example', 'example.config.cjs');
const example = load(exampleConfigPath) as { mutants: string[][] };

const made: string[] = [];
const temp = (label: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `em-mut-test-${label}-`));
  made.push(dir);
  return dir;
};
// the throw-away directories are removed with the harness's own link-safe removal
afterAll(() => {
  for (const dir of made) engine.removeTree(dir);
});
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const linkType = process.platform === 'win32' ? 'junction' : 'dir';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A one-file project whose "tests" are `node check.js`: LIMIT must be 5 and `hang` must be false. */
function tinyProject(root: string, extra = '') {
  write(path.join(root, 'lib.js'), `const LIMIT = 5;\nconst hang = false;\nmodule.exports = { LIMIT, hang };\n${extra}`);
  write(path.join(root, 'check.js'), "const { LIMIT, hang } = require('./lib.js');\nif (LIMIT !== 5) throw new Error('LIMIT moved');\nif (hang) { require('./hang.js'); }\n");
}

describe('chunk planning', () => {
  it('splits into chunks of at most the size, with 1-based inclusive bounds', () => {
    expect(runner.planChunks(45, 20)).toEqual([{ n: 1, from: 1, to: 20 }, { n: 2, from: 21, to: 40 }, { n: 3, from: 41, to: 45 }]);
    expect(runner.planChunks(20, 20)).toEqual([{ n: 1, from: 1, to: 20 }]);
    expect(runner.planChunks(1, 20)).toEqual([{ n: 1, from: 1, to: 1 }]);
    expect(runner.planChunks(0, 20)).toEqual([]);
    expect(runner.planChunks(7, 3).map((c) => c.to - c.from + 1)).toEqual([3, 3, 1]);
  });

  it('the limits are the AGENTS.md ones, as literals', () => {
    expect(runner.MAX_CHUNK_SIZE).toBe(20);
    expect(runner.MAX_CHUNK_MINUTES).toBe(20);
  });

  it('a name filter is applied first and the slice numbers the matching list', () => {
    const m = [['a: one'], ['b: two'], ['a: three'], ['b: four'], ['a: five']];
    expect(engine.selectMutants(m, 'a:').map((x) => x[0])).toEqual(['a: one', 'a: three', 'a: five']);
    expect(engine.selectMutants(m, 'a:', 2, 3).map((x) => x[0])).toEqual(['a: three', 'a: five']);
    expect(engine.selectMutants(m, undefined, 4, 4).map((x) => x[0])).toEqual(['b: four']);
    expect(engine.selectMutants(m).length).toBe(5);
  });
});

describe('path safety', () => {
  it('isInside', () => {
    const base = path.resolve(os.tmpdir(), 'em-inside');
    expect(engine.isInside(path.join(base, 'a', 'b'), base)).toBe(true);
    expect(engine.isInside(base, base)).toBe(true);
    expect(engine.isInside(path.join(base, '..', 'em-inside-other'), base)).toBe(false);
    expect(engine.isInside(path.resolve(base, '..'), base)).toBe(false);
  });

  const base = { cmd: 'node check.js', mutants: [['n', 'lib.js', 'LIMIT = 5', 'LIMIT = 6']] };
  it('refuses a work directory inside the repository, or containing it, or the repository itself', () => {
    const root = temp('root');
    expect(() => engine.resolveConfig({ ...base, root, work: path.join(root, 'work') }, 'c.cjs')).toThrow(/inside the repository/);
    expect(() => engine.resolveConfig({ ...base, root, work: root }, 'c.cjs')).toThrow(/inside the repository/);
    expect(() => engine.resolveConfig({ ...base, root, work: path.dirname(root) }, 'c.cjs')).toThrow(/contains the repository/);
    expect(() => engine.resolveConfig({ ...base, root, work: path.join(temp('elsewhere'), 'w') }, 'c.cjs')).not.toThrow();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('the default work directory is under the temp folder, outside the repository', () => {
    const c = engine.resolveConfig({ ...base }, '/some/where/my-config.cjs');
    expect(c.work.startsWith(path.join(os.tmpdir(), 'em-chess-mutation'))).toBe(true);
    expect(engine.isInside(c.work, engine.REPO_ROOT)).toBe(false);
    expect(path.basename(c.work)).toBe(`my-config-${process.pid}`);
  });

  it('refuses node_modules in "copy", absolute and ".." paths, an empty command, no mutants, an empty find', () => {
    const root = temp('cfg');
    const ok = { ...base, root, work: path.join(temp('w'), 'w') };
    expect(() => engine.resolveConfig({ ...ok, copy: ['node_modules'] }, 'c.cjs')).toThrow(/node_modules is never copied/);
    expect(() => engine.resolveConfig({ ...ok, copy: ['a/node_modules/b'] }, 'c.cjs')).toThrow(/node_modules is never copied/);
    expect(() => engine.resolveConfig({ ...ok, copy: [path.resolve('/abs')] }, 'c.cjs')).toThrow(/plain relative path/);
    expect(() => engine.resolveConfig({ ...ok, copy: ['../up'] }, 'c.cjs')).toThrow(/plain relative path/);
    expect(() => engine.resolveConfig({ ...ok, junction: ['..\\up'] }, 'c.cjs')).toThrow(/plain relative path/);
    expect(() => engine.resolveConfig({ ...ok, cmd: ' ' }, 'c.cjs')).toThrow(/"cmd" is required/);
    expect(() => engine.resolveConfig({ ...ok, mutants: [] }, 'c.cjs')).toThrow(/non-empty array/);
    expect(() => engine.resolveConfig({ ...ok, mutants: [['n', 'lib.js', '', 'x']] }, 'c.cjs')).toThrow(/non-empty find/);
    expect(() => engine.resolveConfig({ ...ok, mutants: [['n', '../lib.js', 'a', 'b']] }, 'c.cjs')).toThrow(/outside the copy/);
    expect(() => engine.resolveConfig({ ...ok, junction: ['node_modules'], copy: ['lib.js'] }, 'c.cjs')).not.toThrow();
  });
});

describe('removeTree never follows a link', () => {
  it('unlinks a junction / directory symlink and leaves its target untouched', () => {
    const real = temp('real');
    write(path.join(real, 'sentinel.txt'), 'keep me');
    write(path.join(real, 'deep', 'sentinel2.txt'), 'keep me too');
    const dir = temp('dir');
    write(path.join(dir, 'src', 'a.js'), 'x');
    fs.symlinkSync(real, path.join(dir, 'node_modules'), linkType);
    engine.removeTree(dir);
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.readFileSync(path.join(real, 'sentinel.txt'), 'utf8')).toBe('keep me');
    expect(fs.readFileSync(path.join(real, 'deep', 'sentinel2.txt'), 'utf8')).toBe('keep me too');
    fs.rmSync(real, { recursive: true, force: true });
  });

  it('removing something that is not there is not an error', () => {
    expect(() => engine.removeTree(path.join(os.tmpdir(), 'em-mut-test-does-not-exist-xyz'))).not.toThrow();
  });
});

describe('the example config, end to end', () => {
  it('kills the five real mutants, lets the equivalent one survive, leaves no work directory and writes its result', async () => {
    const out = path.join(temp('out'), 'result.json');
    const lines: string[] = [];
    const cfg = { ...(load(exampleConfigPath) as object), work: path.join(temp('work'), 'w') };
    const summary = await engine.runMutation(cfg, exampleConfigPath, { out, log: (l: string) => lines.push(l) });
    const status = Object.fromEntries(summary.results.map((r) => [r.name, r.status]));
    expect(summary.killed).toBe(5);
    expect(summary.survived).toBe(1);
    expect(summary.exitCode).toBe(1);
    expect(status[example.mutants[5][0]]).toBe('survived');
    for (const m of example.mutants.slice(0, 5)) expect(status[m[0]], m[0]).toBe('killed');
    expect(lines[0]).toBe('BASELINE (unmutated copy): green');
    expect(lines.some((l) => l.startsWith('SURVIVED  clamp (EQUIVALENT)'))).toBe(true);
    expect(fs.existsSync((cfg as { work: string }).work)).toBe(false);
    const saved = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(saved.killed).toBe(5);
    expect(saved.exitCode).toBe(1);
    // the example's source is only ever read
    expect(fs.readFileSync(path.join(__dirname, 'example', 'lib.js'), 'utf8')).toContain('const LIMIT = 7;');
  });

  it('with no survivor the exit code is 0', async () => {
    const cfg = { ...(load(exampleConfigPath) as { mutants: string[][] }), work: path.join(temp('work'), 'w'), mutants: example.mutants.slice(0, 5) };
    const summary = await engine.runMutation(cfg, exampleConfigPath, { log: () => {} });
    expect(summary.exitCode).toBe(0);
    expect(summary.survived).toBe(0);
  });
});

describe('a work copy with a linked node_modules', () => {
  it('shares the real folder read-only: after the run (and the cleaning) the real files are all still there', async () => {
    const root = temp('proj');
    tinyProject(root);
    write(path.join(root, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1;');
    const cfg = { root, work: path.join(temp('w'), 'w'), copy: ['lib.js', 'check.js'], junction: ['node_modules'], cmd: 'node check.js', mutants: [['limit', 'lib.js', 'LIMIT = 5', 'LIMIT = 6']] };
    const summary = await engine.runMutation(cfg, 'proj.config.cjs', { log: () => {} });
    expect(summary.killed).toBe(1);
    expect(fs.readFileSync(path.join(root, 'node_modules', 'pkg', 'index.js'), 'utf8')).toBe('module.exports = 1;');
    expect(fs.existsSync(cfg.work)).toBe(false);
  });

  it('refuses to link a folder that does not exist', async () => {
    const root = temp('proj2');
    tinyProject(root);
    const cfg = { root, work: path.join(temp('w'), 'w'), copy: ['lib.js', 'check.js'], junction: ['node_modules'], cmd: 'node check.js', mutants: [['limit', 'lib.js', 'LIMIT = 5', 'LIMIT = 6']] };
    await expect(engine.runMutation(cfg, 'p.config.cjs', { log: () => {} })).rejects.toThrow(/junction: node_modules is not a directory/);
  });
});

describe('failures are reported, not hidden', () => {
  it('a red baseline stops the run with exit 2 and runs no mutant', async () => {
    const root = temp('red');
    tinyProject(root);
    write(path.join(root, 'check.js'), "throw new Error('already broken');\n");
    const cfg = { root, work: path.join(temp('w'), 'w'), copy: ['lib.js', 'check.js'], cmd: 'node check.js', mutants: [['limit', 'lib.js', 'LIMIT = 5', 'LIMIT = 6']] };
    const lines: string[] = [];
    const summary = await engine.runMutation(cfg, 'red.config.cjs', { log: (l: string) => lines.push(l) });
    expect(summary.exitCode).toBe(2);
    expect(summary.results).toEqual([]);
    expect(lines[0]).toBe('BASELINE (unmutated copy): RED');
  });

  it('a pattern that matches zero or two times, or changes nothing, is INVALID (exit 4), never a silent skip', async () => {
    const root = temp('pat');
    tinyProject(root, 'const LIMIT_AGAIN = 5; const x = 5; const y = 5;\n');
    const cfg = {
      root,
      work: path.join(temp('w'), 'w'),
      copy: ['lib.js', 'check.js'],
      cmd: 'node check.js',
      mutants: [
        ['none', 'lib.js', 'NOT THERE', 'x'],
        ['twice', 'lib.js', '= 5;', '= 6;'],
        ['no-op', 'lib.js', 'const hang = false;', 'const hang = false;'],
        ['missing file', 'nofile.js', 'a', 'b'],
        ['real', 'lib.js', 'LIMIT = 5;\nconst hang', 'LIMIT = 6;\nconst hang'],
      ],
    };
    const summary = await engine.runMutation(cfg, 'pat.config.cjs', { log: () => {} });
    const status = Object.fromEntries(summary.results.map((r) => [r.name, r.status]));
    expect(status).toEqual({ none: 'invalid', twice: 'invalid', 'no-op': 'invalid', 'missing file': 'invalid', real: 'killed' });
    expect(summary.invalid).toBe(4);
    expect(summary.exitCode).toBe(4);
  });

  it('mutants after the deadline are "not run" (exit 3)', async () => {
    const root = temp('dl');
    tinyProject(root);
    const cfg = { root, work: path.join(temp('w'), 'w'), copy: ['lib.js', 'check.js'], cmd: 'node check.js', mutants: [['a', 'lib.js', 'LIMIT = 5', 'LIMIT = 6'], ['b', 'lib.js', 'LIMIT = 5', 'LIMIT = 7']] };
    const summary = await engine.runMutation(cfg, 'dl.config.cjs', { log: () => {}, deadline: 1 });
    expect(summary.results.map((r) => r.status)).toEqual(['not-run', 'not-run']);
    expect(summary.exitCode).toBe(3);
  });
});

describe('a hanging test run', () => {
  it('is killed at its time limit WITH the processes it started, and counts as killed', { timeout: 60_000 }, async () => {
    const root = temp('hang');
    tinyProject(root);
    const beats = path.join(root, 'beats.txt').replace(/\\/g, '/');
    // The hang: a child process that appends a heartbeat every 50 ms, while the parent waits for it forever.
    write(path.join(root, 'child.js'), `const fs = require('fs');\nsetInterval(() => fs.appendFileSync(${JSON.stringify(beats)}, 'x'), 50);\n`);
    write(path.join(root, 'hang.js'), "require('child_process').spawn(process.execPath, [require('path').join(__dirname, 'child.js')], { stdio: 'ignore' });\nsetInterval(() => {}, 1000);\n");
    const cfg = {
      root,
      work: path.join(temp('w'), 'w'),
      copy: ['lib.js', 'check.js', 'child.js', 'hang.js'],
      cmd: 'node check.js',
      mutantTimeoutMs: 3000,
      mutants: [['hang', 'lib.js', 'const hang = false;', 'const hang = true;']],
    };
    const summary = await engine.runMutation(cfg, 'hang.config.cjs', { log: () => {} });
    expect(summary.results[0].status).toBe('timeout');
    expect(summary.timedOut).toBe(1);
    expect(summary.killed).toBe(1);
    // the heartbeat child must be dead too: the count stops growing
    const count = () => (fs.existsSync(beats) ? fs.readFileSync(beats, 'utf8').length : 0);
    const first = count();
    expect(first).toBeGreaterThan(0);
    await sleep(700);
    expect(count()).toBe(first);
  });
});

describe('the runner', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [path.join(__dirname, 'run.cjs'), ...args], { encoding: 'utf8', timeout: 120_000 });

  it('--dry-run prints the plan and runs nothing', () => {
    const r = run(exampleConfigPath, '--dry-run', '--chunk-size', '4');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('6 mutants in 2 chunk(s) of at most 4');
    expect(r.stdout).toContain('chunk 1: mutants 1-4');
    expect(r.stdout).toContain('chunk 2: mutants 5-6');
  });

  it('refuses a chunk larger than 20 mutants or 20 minutes, a results folder inside the repository, and a filter that matches nothing', () => {
    expect(run(exampleConfigPath, '--chunk-size', '21').stderr).toMatch(/--chunk-size must be 1\.\.20/);
    expect(run(exampleConfigPath, '--chunk-minutes', '21').stderr).toMatch(/--chunk-minutes must be in \(0, 20\]/);
    expect(run(exampleConfigPath, '--out', path.join(__dirname, 'results-here')).stderr).toMatch(/inside the repository/);
    expect(run(exampleConfigPath, '--match', 'no such mutant').stderr).toMatch(/no mutant matches/);
    expect(run(exampleConfigPath, '--chunk', '9').stderr).toMatch(/there is no chunk 9; the plan has 1/);
    expect(fs.existsSync(path.join(__dirname, 'results-here'))).toBe(false);
  });

  it('runs one chunk of a filtered list and writes its results outside the repository', { timeout: 120_000 }, () => {
    const out = path.join(temp('runout'), 'results');
    const r = run(exampleConfigPath, '--chunk-size', '3', '--chunk', '2', '--out', out);
    expect(r.stdout).toContain('chunk 2 (mutants 4-6): exit 1, 2 killed, 1 survived');
    expect(fs.existsSync(path.join(out, 'chunk-2.json'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'chunk-1.json'))).toBe(false);
    expect(fs.readFileSync(path.join(out, 'summary.txt'), 'utf8')).toContain('chunk 2 (mutants 4-6)');
    expect(r.status).toBe(1);
    const filtered = run(exampleConfigPath, '--match', 'limit:', '--out', path.join(temp('runout2'), 'results'));
    expect(filtered.stdout).toContain('2 mutants matching "limit:" in 1 chunk(s)');
    expect(filtered.stdout).toContain('ALL KILLED');
    expect(filtered.status).toBe(0);
  });
});
