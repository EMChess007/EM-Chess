import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BUGHOUSE_GOLDEN_SEEDS, BUGHOUSE_SCENE_NAMES, recordAllBughouseGames, recordBughouseGame, recordBughouseScene, sha256 } from './bughouseGoldenKit';

/**
 * Bughouse - THE BUGHOUSE GOLDEN TRANSCRIPTS (BUGHOUSE_SPEC.md W1 test 2f): 40 seeded full matches and 19 scripted scenes (the opening with captures crossing to the partner's pocket; a
 * stuck player rescued by the partner's capture; a stalemate decided by the clock; a smothered mate; a drop mate; a flag against a mate one millisecond before, at, and after its deadline;
 * the exact-millisecond tie at both levels of the tie-break; two flags one millisecond apart; a promoted queen returning as a pawn; a dropped pawn double-stepping and taken en passant; a
 * rook dropped back not restoring castling; a resignation off turn; a voided match; every kind of refusal; the increment) replay byte for byte as recorded when
 * the W1 rules were final (fixtures/bughouseGolden.json), every transcript carrying the COMPLETE match text after every input. See bughouseGoldenKit.ts.
 */
const golden: Record<string, string> = JSON.parse(readFileSync(`${__dirname}/fixtures/bughouseGolden.json`, 'utf8'));

describe('Bughouse golden transcripts', () => {
  it('the fixture covers exactly the seeds and scenes the kit replays', () => {
    expect(Object.keys(golden).sort()).toEqual([...BUGHOUSE_GOLDEN_SEEDS.map((s) => `game:${s}`), ...BUGHOUSE_SCENE_NAMES.map((n) => `scene:${n}`)].sort());
    expect(BUGHOUSE_SCENE_NAMES).toHaveLength(19);
  });

  it.each(BUGHOUSE_SCENE_NAMES)('scene %s replays identically', (name) => {
    expect(sha256(recordBughouseScene(name))).toBe(golden[`scene:${name}`]);
  });

  // one replay of the 40 games serves both the hashes and the coverage below
  let replay: ReturnType<typeof recordAllBughouseGames> | undefined;
  const games = () => (replay ??= recordAllBughouseGames());

  it('40 seeded full matches replay identically (every input, every outcome, every event, the whole match text after each)', { timeout: 240_000 }, () => {
    const moved = BUGHOUSE_GOLDEN_SEEDS.filter((seed) => games().hashes[`game:${seed}`] !== golden[`game:${seed}`]);
    expect(moved, `Bughouse transcripts that changed: seeds ${moved.join(', ')}`).toEqual([]);
  });

  it('a transcript is byte-identical on three runs in one process', () => {
    for (const seed of [BUGHOUSE_GOLDEN_SEEDS[0], BUGHOUSE_GOLDEN_SEEDS[23]]) {
      const first = recordBughouseGame(seed);
      expect(recordBughouseGame(seed)).toBe(first);
      expect(recordBughouseGame(seed)).toBe(first);
    }
    for (const name of BUGHOUSE_SCENE_NAMES) {
      const first = recordBughouseScene(name);
      expect(recordBughouseScene(name)).toBe(first);
      expect(recordBughouseScene(name)).toBe(first);
    }
  });

  it('the scenes really reach each rule (so the gate is not vacuous)', () => {
    expect(recordBughouseScene('opening')).toContain('"kind":"bank","seq":5,"seat":3,"piece":"p"');
    expect(recordBughouseScene('opening')).toContain('"kind":"bank","seq":6,"seat":1,"piece":"p"');
    expect(recordBughouseScene('stuckThenRescued')).toContain('"status":"stuck","turn":"w","inCheck":true,"stuck":"check"');
    expect(recordBughouseScene('stuckThenRescued')).toContain('"status":"check","turn":"w","inCheck":true,"stuck":null');
    expect(recordBughouseScene('stalemateByClock')).toContain('"stuck":"noAction"');
    expect(recordBughouseScene('stalemateByClock')).toContain('final {"winnerTeam":1,"reason":"flag","board":"A","loserSeat":1}');
    expect(recordBughouseScene('smotheredMate')).toContain('"san":"Nf2#"');
    expect(recordBughouseScene('dropMate')).toContain('"san":"Q@g8#"');
    expect(recordBughouseScene('flagVsMateBefore')).toContain('final {"winnerTeam":1,"reason":"checkmate","board":"A","loserSeat":1}');
    expect(recordBughouseScene('flagVsMateAt')).toContain('final {"winnerTeam":1,"reason":"flag","board":"B","loserSeat":2}');
    expect(recordBughouseScene('flagVsMateAfter')).toContain('final {"winnerTeam":1,"reason":"flag","board":"B","loserSeat":2}');
    expect(recordBughouseScene('tieLevelOneLowerSeqLoses')).toContain('"loserSeat":1');
    expect(recordBughouseScene('tieLevelTwoEvenRoom')).toContain('"board":"A","loserSeat":0');
    expect(recordBughouseScene('tieLevelTwoOddRoom')).toContain('"board":"B","loserSeat":2');
    expect(recordBughouseScene('twoFlagsOneMillisecondApart')).toContain('"loserSeat":0');
    expect(recordBughouseScene('counterfeit')).toContain('"kind":"bank","seq":2,"seat":2,"piece":"p"');
    expect(recordBughouseScene('droppedPawnEnPassant')).toContain('"san":"dxe3"');
    expect(recordBughouseScene('droppedRookNoCastling')).toContain('rejected illegalMove');
    expect(recordBughouseScene('resignOffTurn')).toContain('rejected over');
    expect(recordBughouseScene('voided')).toContain('final {"voided":true,"reason":"abandoned"}');
    expect(recordBughouseScene('refusals')).toMatch(/rejected illegalMove[\s\S]*rejected wrongBoard[\s\S]*rejected notYourTurn[\s\S]*rejected dropNotInPocket[\s\S]*rejected malformed[\s\S]*rejected time/);
    expect(recordBughouseScene('increment')).toContain('"remainingMs":118500');
  });

  it('the 40 seeded matches really reach captures, credits, drops, promotions, mates, resignations, stuck positions and refusals', { timeout: 240_000 }, () => {
    const c = games().coverage;
    expect(c.games).toBe(40);
    expect(c.commits).toBeGreaterThanOrEqual(3000);
    expect(c.captures).toBeGreaterThanOrEqual(1000);
    expect(c.banks).toBe(c.captures);
    expect(c.drops).toBeGreaterThanOrEqual(800);
    expect(c.promotions).toBeGreaterThanOrEqual(10);
    expect(c.mates).toBeGreaterThanOrEqual(2);
    expect(c.resigns).toBeGreaterThanOrEqual(2);
    expect(c.stuck).toBeGreaterThanOrEqual(1);
    expect(c.rejected).toBeGreaterThanOrEqual(100);
  });
});
