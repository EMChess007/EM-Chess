import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * THE PERMANENT DEPENDENCY GUARD (command #31, CHECKLIST.md section 19): `npm audit` must report ZERO vulnerabilities, any severity, dev included, and a red `security-audit` check
 * is the only way a new advisory shows up without a commit of ours. These tests pin the SHAPE of the guard, so that it cannot be weakened quietly (a `--omit=dev`, an `--audit-level`,
 * a `continue-on-error`, a dropped schedule) and so that the two settings the fix relies on (the overrides and the Sentry install-script decision) stay in place.
 * They do not call the registry (a test never depends on the network or on today's advisories): the audit itself is the CI job.
 * Literals on purpose: a test that reads these from the file it checks could not fail.
 */
const root = join(__dirname, '../../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const workflow = parse(read('.github/workflows/security-audit.yml')) as {
  on: { push?: { branches: string[] }; pull_request?: { branches: string[] }; schedule?: { cron: string }[]; workflow_dispatch?: unknown };
  jobs: Record<string, { 'continue-on-error'?: unknown; 'runs-on': string; steps: { name?: string; run?: string; uses?: string; 'continue-on-error'?: unknown; if?: unknown }[] }>;
};
const pkg = JSON.parse(read('package.json')) as { overrides?: Record<string, string>; allowScripts?: Record<string, boolean>; dependencies: Record<string, string>; devDependencies: Record<string, string> };
const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { version?: string }> };

describe('the security-audit workflow', () => {
  const job = workflow.jobs['security-audit'];
  const runs = job.steps.filter((s) => s.run).map((s) => s.run as string);

  it('is one job called security-audit (the required status check keeps its name)', () => {
    expect(Object.keys(workflow.jobs)).toEqual(['security-audit']);
    expect(job['runs-on']).toBe('ubuntu-latest');
  });

  it('installs with npm ci and then runs a bare "npm audit": every severity, production and development', () => {
    expect(runs).toEqual(['npm ci', 'npm audit']);
  });

  it('cannot be turned into a warning: no continue-on-error, no condition on a step, no flag that narrows the audit', () => {
    expect(job['continue-on-error']).toBeUndefined();
    for (const step of job.steps) {
      expect(step['continue-on-error']).toBeUndefined();
      expect(step.if).toBeUndefined();
    }
    const text = read('.github/workflows/security-audit.yml')
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    for (const forbidden of ['--omit', '--audit-level', '--production', '--only=prod', '|| true', 'continue-on-error', 'audit fix']) expect(text).not.toContain(forbidden);
  });

  it('runs on every push, on pull requests to master, by hand, and WEEKLY (a new advisory needs no commit)', () => {
    expect(workflow.on.push?.branches).toEqual(['**']);
    expect(workflow.on.pull_request?.branches).toEqual(['master']);
    expect(workflow.on.workflow_dispatch).toBeDefined();
    expect(workflow.on.schedule).toHaveLength(1);
    const fields = (workflow.on.schedule?.[0].cron ?? '').split(' ');
    expect(fields).toHaveLength(5);
    expect(fields.slice(2, 4)).toEqual(['*', '*']); // every day-of-month and month ...
    expect(fields[4]).toMatch(/^[0-6]$/); // ... on ONE weekday: weekly
  });
});

describe('Dependabot', () => {
  const config = parse(read('.github/dependabot.yml')) as {
    version: number;
    updates: { 'package-ecosystem': string; directory: string; 'open-pull-requests-limit': number; groups: Record<string, { 'applies-to': string; patterns: string[] }> }[];
  };

  it('groups the security updates of npm and of the actions into one pull request each, and has version updates off', () => {
    expect(config.version).toBe(2);
    expect(config.updates.map((u) => u['package-ecosystem']).sort()).toEqual(['github-actions', 'npm']);
    for (const update of config.updates) {
      expect(update.directory).toBe('/');
      expect(update['open-pull-requests-limit']).toBe(0); // version updates off; security updates have their own limit
      const groups = Object.values(update.groups);
      expect(groups).toHaveLength(1);
      expect(groups[0]['applies-to']).toBe('security-updates');
      expect(groups[0].patterns).toEqual(['*']);
    }
  });
});

describe('what the zero depends on', () => {
  it('pins the transitive packages whose fixed versions the parents do not ask for yet (glob, minimatch), at a fixed major', () => {
    expect(pkg.overrides?.glob).toBe('^14.0.3');
    expect(pkg.overrides?.minimatch).toBe('^11.0.3');
    // the lock really holds them, and no vulnerable copy of either remains next to them
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (/(^|\/)node_modules\/glob$/.test(path)) expect(entry.version, path).toMatch(/^14\.(0\.[3-9]|0\.\d\d+|[1-9]\d*\.\d+)/);
      if (/(^|\/)node_modules\/minimatch$/.test(path)) expect(entry.version, path).toMatch(/^11\.(0\.[3-9]|0\.\d\d+|[1-9]\d*\.\d+)/);
    }
  });

  it('has ONE @sentry/cli in the lock, and its install script is denied on purpose (the binary comes from the platform package)', () => {
    expect(pkg.overrides?.['@sentry/cli']).toBe('3.8.0');
    const copies = Object.entries(lock.packages).filter(([path]) => /(^|\/)node_modules\/@sentry\/cli$/.test(path));
    expect(copies.map(([path]) => path)).toEqual(['node_modules/@sentry/cli']);
    expect(copies[0][1].version).toBe('3.8.0');
    expect(pkg.allowScripts).toEqual({ '@sentry/cli': false });
    // the denial is only safe while @sentry/cli ships its binary as optional platform packages (3.x does); a downgrade to 2.x would need the postinstall
    const cli = JSON.parse(read('node_modules/@sentry/cli/package.json')) as { optionalDependencies?: Record<string, string> };
    expect(Object.keys(cli.optionalDependencies ?? {})).toContain('@sentry/cli-win32-x64');
    expect(Object.keys(cli.optionalDependencies ?? {})).toContain('@sentry/cli-linux-x64');
    expect(Object.keys(cli.optionalDependencies ?? {})).toContain('@sentry/cli-darwin');
  });

  it('no manifest or script of the repo runs "audit fix --force" (it would upgrade across majors behind our back)', () => {
    const files = ['package.json', 'scripts/cloud-setup.sh', ...readdirSync(join(root, '.github/workflows')).map((f) => `.github/workflows/${f}`)].filter((f) => existsSync(join(root, f)));
    const noComments = (text: string) => text.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n'); // the workflow's own comment says what it forbids
    for (const file of files) expect(noComments(read(file)), file).not.toMatch(/audit\s+fix\s+--force|audit\s+--force/);
  });

  it('CHECKLIST.md carries the rule: no report says "done" unless security-audit is green', () => {
    const checklist = read('CHECKLIST.md');
    expect(checklist).toContain('security-audit');
    expect(checklist).toMatch(/## 19\. Zero known vulnerabilities/);
  });
});
