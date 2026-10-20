import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sha256 } from './fourPlayerGoldenKit';
import { GIVEAWAY_GOLDEN_SEEDS, GIVEAWAY_SCENE_NAMES, recordGiveawayGame, recordGiveawayScene } from './fourPlayerGiveawayGoldenKit';

/**
 * 4 Player Giveaway - THE GIVEAWAY REGRESSION GATE (CHATURAJI_SPEC.md section 11), the twin of fourPlayerFfaGolden.test.ts.
 *
 * Chaturaji W0 rewires the shared engine (the board geometry and the rule options are read from the rules object), and Giveaway lives in that
 * engine behind `rules.mode`, so it must replay BYTE FOR BYTE as it did before: every position, legal-move list, bot decision, action and engine
 * event of 40 seeded games and 13 hand-built scenes hashes to what was recorded from the engine BEFORE any Chaturaji change
 * (fixtures/fourPlayerGiveawayGolden.json). See fourPlayerGiveawayGoldenKit.ts for what a transcript contains and how to regenerate the fixture.
 */
const golden: Record<string, string> = JSON.parse(readFileSync(`${__dirname}/fixtures/fourPlayerGiveawayGolden.json`, 'utf8'));

describe('Giveaway golden transcripts (the regression gate for the Chaturaji engine work)', () => {
  it('the fixture covers exactly the seeds and scenes the kit replays', () => {
    expect(Object.keys(golden).sort()).toEqual([...GIVEAWAY_GOLDEN_SEEDS.map((s) => `game:${s}`), ...GIVEAWAY_SCENE_NAMES.map((n) => `scene:${n}`)].sort());
  });

  it.each(GIVEAWAY_SCENE_NAMES)('scene %s replays identically', (name) => {
    expect(sha256(recordGiveawayScene(name))).toBe(golden[`scene:${name}`]);
  });

  it('40 seeded full games replay identically (positions, legal-move lists, bot choices, actions, events)', { timeout: 240_000 }, () => {
    const moved = GIVEAWAY_GOLDEN_SEEDS.filter((seed) => sha256(recordGiveawayGame(seed)) !== golden[`game:${seed}`]);
    expect(moved, `Giveaway transcripts that changed: seeds ${moved.join(', ')}`).toEqual([]);
  });

  it('the scenes really reach each ending (so the gate is not vacuous): outOfPieces, stuck, lastStanding, cap, en passant, capture-promotion', () => {
    const text = (names: string[]) => names.map(recordGiveawayScene).join('\n');
    expect(text(['lastPieceKing', 'outOfPieces'])).toContain('"reason":"outOfPieces"');
    expect(recordGiveawayScene('stuck')).toContain('"reason":"stuck"');
    expect(recordGiveawayScene('lastStanding')).toContain('"reason":"lastStanding"');
    expect(recordGiveawayScene('capTie')).toContain('"reason":"cap"');
    expect(recordGiveawayScene('enPassant')).toContain('e.p.');
    expect(recordGiveawayScene('promotionByCapture')).toMatch(/xf8=[QRBN]/);
  });
});
