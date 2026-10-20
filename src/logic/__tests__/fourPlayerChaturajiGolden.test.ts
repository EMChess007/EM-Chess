import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sha256 } from './fourPlayerGoldenKit';
import { CHATURAJI_GOLDEN_SEEDS, CHATURAJI_SCENE_NAMES, recordChaturajiGame, recordChaturajiScene } from './fourPlayerChaturajiGoldenKit';

/**
 * Chaturaji - THE CHATURAJI GOLDEN TRANSCRIPTS (CHATURAJI_SPEC.md section 11), the third engine gate beside fourPlayerFfaGolden and fourPlayerGiveawayGolden.
 * 40 seeded games and 19 hand-built scenes (king capture, ignored check, forks of 2 / 3 kings, fork then king capture, discovered attack, promotion by capture,
 * dead pieces, stalemate elimination, resigned walking king, capture of a walking king, the three end rules, the ply cap, bare kings) replay byte for byte
 * as recorded when the W1 rules were final (fixtures/fourPlayerChaturajiGolden.json). See fourPlayerChaturajiGoldenKit.ts.
 */
const golden: Record<string, string> = JSON.parse(readFileSync(`${__dirname}/fixtures/fourPlayerChaturajiGolden.json`, 'utf8'));

describe('Chaturaji golden transcripts', () => {
  it('the fixture covers exactly the seeds and scenes the kit replays', () => {
    expect(Object.keys(golden).sort()).toEqual([...CHATURAJI_GOLDEN_SEEDS.map((s) => `game:${s}`), ...CHATURAJI_SCENE_NAMES.map((n) => `scene:${n}`)].sort());
  });

  it.each(CHATURAJI_SCENE_NAMES)('scene %s replays identically', (name) => {
    expect(sha256(recordChaturajiScene(name))).toBe(golden[`scene:${name}`]);
  });

  it('40 seeded full games replay identically (positions, legal-move lists, actions, events)', { timeout: 240_000 }, () => {
    const moved = CHATURAJI_GOLDEN_SEEDS.filter((seed) => sha256(recordChaturajiGame(seed)) !== golden[`game:${seed}`]);
    expect(moved, `Chaturaji transcripts that changed: seeds ${moved.join(', ')}`).toEqual([]);
  });

  it('the scenes really reach each rule (so the gate is not vacuous)', () => {
    expect(recordChaturajiScene('kingCapture')).toContain('"reason":"kingCaptured"');
    expect(recordChaturajiScene('forkThree')).toContain('"kind":"fork","seat":0,"kings":3,"points":5');
    expect(recordChaturajiScene('forkTwo')).toContain('"kings":2,"points":1');
    expect(recordChaturajiScene('forkThenCapture')).toMatch(/"kind":"fork".*"reason":"kingCaptured"/s);
    expect(recordChaturajiScene('stalemateElimination')).toContain('"reason":"stalemate"');
    expect(recordChaturajiScene('captureWalkingKing')).toContain('"kind":"frozen"');
    expect(recordChaturajiScene('resignWalkingKing')).toContain('"kind":"deadKingMove"');
    expect(recordChaturajiScene('endNotTheSurvivor')).toContain('"winners":[2],"reason":"elimination"');
    expect(recordChaturajiScene('endTie')).toContain('"winners":[0,2]');
    expect(recordChaturajiScene('capTie')).toContain('"winners":[1,3],"reason":"cap"');
    expect(recordChaturajiScene('promotionByCapture')).toContain('=R');
  });
});
