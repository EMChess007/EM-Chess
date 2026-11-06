/**
 * The BUILD IDENTIFIER (command #27d): the git short hash of the checkout and the time the bundle was configured, so that a screenshot of More > Diagnostics (or the Piece gallery) says which commit
 * the phone runs. app.config.js calls this when Metro / `expo start` / an EAS build reads the app's configuration, i.e. at BUNDLE time, and puts the result into `extra.buildInfo`;
 * src/logic/buildInfo.ts reads it back. A checkout with uncommitted changes is marked "-dirty" (the hash then names the commit the changes sit on, not the code that runs).
 *
 * `exec` is injected so that the tests need no git; it never throws out of here: any failure (no git, not a repository, a build container without .git) is "unknown", never a crash of the bundler.
 */
const { execFileSync } = require('node:child_process');

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
}

function getBuildInfo(options = {}) {
  const exec = options.exec ?? git;
  const now = options.now ?? (() => new Date());
  let commit = 'unknown';
  try {
    const hash = exec(['rev-parse', '--short=7', 'HEAD']);
    if (/^[0-9a-f]{7,40}$/.test(hash)) {
      commit = hash;
      if (exec(['status', '--porcelain']).length > 0) commit += '-dirty';
    }
  } catch {
    // no git: "unknown"
  }
  return { commit, builtAt: now().toISOString() };
}

module.exports = { getBuildInfo };
