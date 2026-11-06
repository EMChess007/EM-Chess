import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CRAZYHOUSE_GOLDEN_SEEDS, CRAZYHOUSE_SCENE_NAMES, recordAllCrazyhouseGames, recordCrazyhouseGame, recordCrazyhouseScene, sha256 } from './crazyhouseGoldenKit';

/**
 * Crazyhouse - THE CRAZYHOUSE GOLDEN TRANSCRIPTS (BUGHOUSE_SPEC.md section 7, W0): 40 seeded games and 16 hand-built scenes (a capture then drops, a drop that gives
 * check, a drop that blocks a check, a drop mate, a "mate" a drop answers, a promoted piece captured returning as a pawn, castling and a rook re-dropped on h1 that does
 * not restore the right, en passant after a pawn dropped on its second rank double-stepped, a drop clearing the en passant square, pawn drops on the first / eighth rank,
 * no drop against a knight check or a double check, stalemate that a drop refutes, king against king with a reserve) replay byte for byte as recorded on master BEFORE
 * crazyhouse.ts was touched for Bughouse (fixtures/crazyhouseGolden.json). See crazyhouseGoldenKit.ts.
 */
const golden: Record<string, string> = JSON.parse(readFileSync(`${__dirname}/fixtures/crazyhouseGolden.json`, 'utf8'));

describe('Crazyhouse golden transcripts', () => {
  it('the fixture covers exactly the seeds and scenes the kit replays', () => {
    expect(Object.keys(golden).sort()).toEqual([...CRAZYHOUSE_GOLDEN_SEEDS.map((s) => `game:${s}`), ...CRAZYHOUSE_SCENE_NAMES.map((n) => `scene:${n}`)].sort());
  });

  it.each(CRAZYHOUSE_SCENE_NAMES)('scene %s replays identically', (name) => {
    expect(sha256(recordCrazyhouseScene(name))).toBe(golden[`scene:${name}`]);
  });

  // one replay of the 40 games serves both the hashes and the coverage below
  let replay: ReturnType<typeof recordAllCrazyhouseGames> | undefined;
  const games = () => (replay ??= recordAllCrazyhouseGames());

  it('40 seeded full games replay identically (positions, reserves, legal-move and legal-drop lists, turns, SAN, status)', { timeout: 240_000 }, () => {
    const moved = CRAZYHOUSE_GOLDEN_SEEDS.filter((seed) => games().hashes[`game:${seed}`] !== golden[`game:${seed}`]);
    expect(moved, `Crazyhouse transcripts that changed: seeds ${moved.join(', ')}`).toEqual([]);
  });

  it('a transcript is byte-identical on three runs in one process', () => {
    for (const seed of [CRAZYHOUSE_GOLDEN_SEEDS[0], CRAZYHOUSE_GOLDEN_SEEDS[17]]) {
      const first = recordCrazyhouseGame(seed);
      expect(recordCrazyhouseGame(seed)).toBe(first);
      expect(recordCrazyhouseGame(seed)).toBe(first);
    }
    for (const name of CRAZYHOUSE_SCENE_NAMES) {
      const first = recordCrazyhouseScene(name);
      expect(recordCrazyhouseScene(name)).toBe(first);
      expect(recordCrazyhouseScene(name)).toBe(first);
    }
  });

  it('the scenes really reach each rule (so the gate is not vacuous)', () => {
    expect(recordCrazyhouseScene('dropMate')).toMatch(/play Q@e8 san Q@e8#\nafter .* status checkmate/);
    expect(recordCrazyhouseScene('mateAnsweredByDrop')).toMatch(/play Q@e8 san Q@e8\+\nafter .* status check\nstep 1 turn b/);
    expect(recordCrazyhouseScene('mateAnsweredByDrop')).toMatch(/play e8f8 san Qxf8#/);
    expect(recordCrazyhouseScene('dropCheck')).toContain('san N@b6+');
    expect(recordCrazyhouseScene('dropBlocksCheck')).toMatch(/refused P@c1\n/);
    expect(recordCrazyhouseScene('promotionCapture')).toMatch(/play h8a8 san Rxa8\nafter \{"w":\{[^}]*\},"b":\{"p":1,"n":0,"b":0,"r":0,"q":0\},"promoted":\[\]\}/);
    expect(recordCrazyhouseScene('queenCaptureKeepsType')).toMatch(/play a1a8 san Qxa8\+?\nafter \{"w":\{"p":0,"n":0,"b":0,"r":0,"q":1\}/);
    expect(recordCrazyhouseScene('castling')).toMatch(/san O-O\n[\s\S]*san O-O-O/);
    expect(recordCrazyhouseScene('castlingRightsNotRestored')).toMatch(/refused e1g1/);
    expect(recordCrazyhouseScene('enPassantAfterDrop')).toMatch(/play e2e4 san e4\n[\s\S]*fen [^\n]* e3 0 \d\n[\s\S]*play d4e3 san dxe3/);
    expect(recordCrazyhouseScene('dropClearsEnPassant')).toMatch(/refused e5d6/);
    expect(recordCrazyhouseScene('pawnDropRanks')).toMatch(/refused P@a1\n[\s\S]*refused P@a8/);
    expect(recordCrazyhouseScene('knightCheckNoDrop')).toMatch(/drops \n/);
    expect(recordCrazyhouseScene('doubleCheckNoDrop')).toMatch(/drops \n/);
    expect(recordCrazyhouseScene('stalemateButDrop')).toMatch(/step 0 turn b\nfen 7k\/5Q2\/6K1\/8\/8\/8\/8\/8 b - - 0 1\nstate [^\n]*\nstatus playing over false count 46\nmoves \n/);
    expect(recordCrazyhouseScene('stalemateButDrop')).toMatch(/play f7f8 san Qf8#\nafter .* status checkmate/);
    expect(recordCrazyhouseScene('kingVsKingWithReserve')).toMatch(/step 0 turn w\nfen 8\/8\/8\/4k3\/8\/8\/8\/4K3 w - - 0 1\nstate [^\n]*\nstatus playing over false/);
  });

  it('the 40 seeded games really reach captures, drops, drop checks, drop mates, promotions, captured promoted pieces, castling, en passant and a dropped pawn taken en passant', { timeout: 240_000 }, () => {
    const c = games().coverage;
    expect(c.games).toBe(40);
    expect(c.captures).toBeGreaterThanOrEqual(500);
    expect(c.drops).toBeGreaterThanOrEqual(500);
    expect(c.dropChecks).toBeGreaterThanOrEqual(50);
    expect(c.dropMates).toBeGreaterThanOrEqual(1);
    expect(c.promotions).toBeGreaterThanOrEqual(20);
    expect(c.promotedCaptured).toBeGreaterThanOrEqual(10);
    expect(c.castles).toBeGreaterThanOrEqual(5);
    expect(c.enPassants).toBeGreaterThanOrEqual(3);
    expect(c.enPassantAfterDroppedPawn).toBeGreaterThanOrEqual(1);
    expect(c.mates).toBeGreaterThanOrEqual(1);
  });
});
