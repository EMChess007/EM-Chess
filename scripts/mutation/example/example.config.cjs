// An example mutation config - run it with:  npm run mutate -- scripts/mutation/example/example.config.cjs
// It mutates a tiny module with its own check; every mutant below is killed except the last one, which is EQUIVALENT (see its name) and is the example of what a survivor
// looks like. A real config copies `src` (and the files the test command needs), links `node_modules`, and names the test command of the area it covers.
const path = require('path');

module.exports = {
  // The repository to mutate (read only). Real configs omit this: it defaults to the repository root.
  root: path.resolve(__dirname),
  // `work` is omitted: the copy is made in <tmp>/em-chess-mutation/<config name>-<pid>, which is always outside the repository, and removed afterwards.
  copy: ['lib.js', 'check.js'],
  junction: [], // real configs: ['node_modules']
  cmd: 'node check.js',
  mutantTimeoutMs: 60 * 1000,
  mutants: [
    ['clamp: the lower bound is ignored', 'lib.js', 'if (value < low) return low;', 'if (value < low) return value;'],
    ['clamp: the upper bound is ignored', 'lib.js', 'if (value > high) return high;', 'if (value > high) return value;'],
    ['clamp: the upper bound returns the lower one', 'lib.js', 'if (value > high) return high;', 'if (value > high) return low;'],
    ['limit: 8 instead of 7', 'lib.js', 'const LIMIT = 7;', 'const LIMIT = 8;'],
    ['limit: the comparison is >=', 'lib.js', 'return count > LIMIT;', 'return count >= LIMIT;'],
    ['clamp (EQUIVALENT): <= on the lower bound returns low, which is the value itself when value === low', 'lib.js', 'if (value < low) return low;', 'if (value <= low) return low;'],
  ],
};
