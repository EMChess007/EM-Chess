// Mutation set for the CONSTANTS of the Chaturaji bot (src/logic/fourPlayer/chaturajiBot.ts): every weight set to 0 or to an extreme, 9 mutants, all expected KILLED.
//   npm run mutate -- scripts/mutation/configs/chaturaji-bot-constants.config.cjs
//
// Why it is in the repo: the Chaturaji W2 mutation run (TESTING.md section 30, "constants 9/9") used a scratch config that was never committed. Cloud setup (scripts/cloud-setup.sh)
// needs one small, quick, real set to prove the harness works on Linux - the same constants, the same kind of mutant, the same expected result. The mutants' `find` text is the
// declaration line, so it matches exactly once; the suite is the bot's own test file, which pins each weight by outcome (hand-built positions where the weight decides the move).
//
// KNOWN GAP (found when this set was rebuilt on the cloud VM, not fixed here; TODO.md): `KING_LOSS` RAISED to 28, 100 or 1000 survives `fourPlayerChaturajiBot.test.ts` - the tests pin that a
// king is worth protecting (14 -> 0 and 14 -> 7 are killed) but not an upper bound. It is not proven equivalent, so it is not in this set (a set with a known survivor cannot be a smoke test).
const F = 'src/logic/fourPlayer/chaturajiBot.ts';
const m = (name, find, replace) => [name, F, find, replace];

module.exports = {
  copy: ['src', 'package.json', 'tsconfig.json', 'vitest.config.mts'],
  junction: ['node_modules'],
  cmd: 'npx vitest run src/logic/__tests__/fourPlayerChaturajiBot.test.ts --reporter=dot --bail=1',
  mutantTimeoutMs: 4 * 60 * 1000,
  mutants: [
    m('constants: losing a king costs nothing', 'export const KING_LOSS = 14;', 'export const KING_LOSS = 0;'),
    m('constants: losing a king costs half', 'export const KING_LOSS = 14;', 'export const KING_LOSS = 7;'),
    m('constants: capturing a king is worth no extra', 'export const KING_CAPTURE_BONUS = 2;', 'export const KING_CAPTURE_BONUS = 0;'),
    m('constants: the next seat never replies', 'export const REPLY_WEIGHT = 0.85;', 'export const REPLY_WEIGHT = 0;'),
    m('constants: the next seat replies twice over', 'export const REPLY_WEIGHT = 0.85;', 'export const REPLY_WEIGHT = 2;'),
    m('constants: ending the game as a winner is worth nothing', 'export const END_WIN = 25;', 'export const END_WIN = 0;'),
    m('constants: ending the game as a loser costs nothing', 'export const END_LOSS = 25;', 'export const END_LOSS = 0;'),
    m('constants: a king threat is worth nothing', 'export const KING_THREAT = 0.3;', 'export const KING_THREAT = 0;'),
    m('constants: promoting is worth nothing', 'export const PROMOTION_BONUS = 0.5;', 'export const PROMOTION_BONUS = 0;'),
  ],
};
