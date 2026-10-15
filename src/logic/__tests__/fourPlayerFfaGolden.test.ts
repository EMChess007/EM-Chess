import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GOLDEN_SEEDS, SCENE_NAMES, recordFfaGame, recordFfaScene, sha256 } from './fourPlayerGoldenKit';

/**
 * 4 Player Giveaway W1 - THE FFA REGRESSION GATE (FOUR_PLAYER_GIVEAWAY_SPEC.md section 5).
 *
 * Giveaway lives inside the shared engine behind `rules.mode`, so 4 Player Chess must replay BYTE FOR BYTE as it did before: every position,
 * legal-move list, bot decision, action and engine event of 48 seeded games and 9 hand-built scenes hashes to what was recorded from the
 * engine BEFORE any Giveaway change (fixtures/fourPlayerFfaGolden.json). See fourPlayerGoldenKit.ts for what a transcript contains and
 * how to regenerate the fixture on a deliberate Chess rule change.
 */
const golden: Record<string, string> = JSON.parse(readFileSync(`${__dirname}/fixtures/fourPlayerFfaGolden.json`, 'utf8'));

describe('FFA golden transcripts (the regression gate for the Giveaway engine work)', () => {
  it('the fixture covers exactly the seeds and scenes the kit replays', () => {
    expect(Object.keys(golden).sort()).toEqual([...GOLDEN_SEEDS.map((s) => `game:${s}`), ...SCENE_NAMES.map((n) => `scene:${n}`)].sort());
  });

  it.each(SCENE_NAMES)('scene %s replays identically', (name) => {
    expect(sha256(recordFfaScene(name))).toBe(golden[`scene:${name}`]);
  });

  it('48 seeded full games replay identically (positions, legal-move lists, bot choices, actions, events)', { timeout: 240_000 }, () => {
    const moved = GOLDEN_SEEDS.filter((seed) => sha256(recordFfaGame(seed)) !== golden[`game:${seed}`]);
    expect(moved, `FFA transcripts that changed: seeds ${moved.join(', ')}`).toEqual([]);
  });
});
