import { describe, expect, it } from 'vitest';
import { conservationProblems, createMatch, serializeMatch, BUGHOUSE_TIME_CONTROLS, type BughouseMatch } from '../bughouse';
import { feed, mulberry32, newPair, nextStep } from './bughouseTestKit';
import { scene } from './bughouseScenes';

/**
 * THE CONSERVATION INVARIANT (BUGHOUSE_SPEC.md HP1, W1 test 2c). With two boards and four pockets nothing is created or destroyed: counting a piece that carries a promoted mark as the pawn
 * it started as, each colour always owns exactly 16 pawns, 4 knights, 4 bishops, 4 rooks, 2 queens and 2 kings - 64 pieces in all - on the boards and in the pockets of that colour's two
 * seats; no pocket is negative; every promoted mark sits on a piece that is neither a pawn nor a king; no pawn stands on rank 1 or 8. It is checked after EVERY commit of 520 seeded
 * matches (random arrival order of the four players' legal actions, hostile requests mixed in), together with: seq grows by exactly one per commit and never otherwise; a bank event
 * credits exactly the capturer's PARTNER with exactly one piece (and only then); a drop takes exactly one piece from the dropper's own pocket; and replaying the accepted stream from
 * the start rebuilds the identical final state.
 */
describe('the conservation invariant over seeded interleavings', () => {
  it('520 matches: the invariant after every commit, every capture credited exactly once to the partner, seq +1 per commit, replay rebuilds the state', { timeout: 300_000 }, () => {
    let commits = 0;
    let banks = 0;
    let drops = 0;
    for (let i = 0; i < 520; i++) {
      const seed = 9000 + i * 131;
      const pair = newPair(seed);
      const rng = mulberry32(seed ^ 0x27d4eb2f);
      const accepted: { input: any; now: number }[] = [];
      for (let step = 0; step < 70 && pair.engine.result === null; step++) {
        const before = pair.engine;
        const driver = nextStep(rng, before, pair.model);
        const { engine } = feed(pair, driver);
        if (engine.kind === 'rejected') {
          expect(pair.engine).toBe(before);
          continue;
        }
        if (engine.kind === 'idle') continue;
        commits++;
        accepted.push({ input: driver.input, now: driver.now });
        const after = pair.engine;
        expect(after.seq, `match ${seed} step ${step}`).toBe(before.seq + 1);
        const problems = conservationProblems(after);
        if (problems.length > 0) expect(problems, `match ${seed} step ${step}: ${JSON.stringify(driver)}`).toEqual([]);
        if (engine.kind === 'applied') {
          const total = (m: BughouseMatch) => m.pockets.map((p) => p.p + p.n + p.b + p.r + p.q);
          const t0 = total(before);
          const t1 = total(after);
          const bank = engine.events.find((e) => e.kind === 'bank');
          const played = engine.events[0];
          const deltas = t1.map((n, seat) => n - t0[seat]);
          if (played.kind === 'move') {
            // a move: only a capture changes any pocket, and it changes exactly one - the partner's - by +1
            if (bank && bank.kind === 'bank') {
              banks++;
              expect(bank.seat, `match ${seed} step ${step}`).toBe(3 - played.seat);
              expect(deltas[bank.seat]).toBe(1);
              expect(deltas.reduce((a, b) => a + b, 0)).toBe(1);
            } else {
              expect(deltas.every((d) => d === 0)).toBe(true);
            }
          } else if (played.kind === 'drop') {
            drops++;
            expect(bank).toBeUndefined();
            expect(deltas[played.seat]).toBe(-1);
            expect(deltas.reduce((a, b) => a + b, 0)).toBe(-1);
          } else {
            expect(deltas.every((d) => d === 0)).toBe(true); // a resignation moves no piece
          }
        }
        expect(after.nowMs).toBeGreaterThanOrEqual(before.nowMs);
      }
      const replay = newPair(seed);
      for (const a of accepted) feed(replay, { input: a.input, now: a.now });
      expect(serializeMatch(replay.engine), `replay of ${seed}`).toBe(serializeMatch(pair.engine));
    }
    console.log(`bughouseInvariant: ${commits} commits, ${banks} credits, ${drops} drops`);
    expect(commits).toBeGreaterThan(20_000);
    expect(banks).toBeGreaterThan(5000);
    expect(drops).toBeGreaterThan(3000);
  });

  it('the invariant notices damage: a duplicated piece, a lost piece, a negative pocket, a fake promoted mark, a pawn on the last rank, a second king, a stale mark', () => {
    const base = createMatch({ timeControl: BUGHOUSE_TIME_CONTROLS[0], roomNumber: 0, startMs: 0 });
    expect(conservationProblems(base)).toEqual([]);
    const withPocket = (seat: number, patch: Partial<Record<'p' | 'n' | 'b' | 'r' | 'q', number>>): BughouseMatch => ({ ...base, pockets: base.pockets.map((p, i) => (i === seat ? { ...p, ...patch } : p)) });
    expect(conservationProblems(withPocket(0, { q: 1 }))).toContain('White owns 3 of q, expected 2');
    expect(conservationProblems(withPocket(1, { p: 1 }))).toContain('Black owns 17 of p, expected 16');
    expect(conservationProblems(withPocket(2, { n: -1 })).some((s) => s.includes('the pocket holds -1 of n'))).toBe(true);
    expect(conservationProblems(withPocket(3, { r: 0.5 })).some((s) => s.includes('the pocket holds 0.5 of r'))).toBe(true);
    const lost = { ...base, boards: { ...base.boards, A: { ...base.boards.A, fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPP1/RNBQKBNR w KQkq - 0 1' } } };
    expect(conservationProblems(lost)).toContain('White owns 15 of p, expected 16');
    expect(conservationProblems(lost)).toContain('63 pieces in all, expected 64');
    const marked = { ...base, boards: { ...base.boards, A: { ...base.boards.A, promoted: ['e2'] } } };
    expect(conservationProblems(marked)).toContain('board A: e2 is marked promoted but holds a p');
    const stale = { ...base, boards: { ...base.boards, B: { ...base.boards.B, promoted: ['e4'] } } };
    expect(conservationProblems(stale)).toContain('board B: e4 is marked promoted but is empty');
    // a pawn on the last rank, a second king, a missing king, garbage: chess.js refuses the position, and that is reported
    for (const fen of ['4k3/8/8/8/8/8/8/P3K3 w - - 0 1', 'k3k3/8/8/8/8/8/8/4K3 b - - 0 1', '4k3/8/8/8/8/8/8/8 w - - 0 1', 'not a fen']) {
      const broken = { ...base, boards: { ...base.boards, A: { ...base.boards.A, fen } } };
      expect(conservationProblems(broken), fen).toContain('board A: the position is not a valid FEN');
    }
    // a promoted mark listed twice, and a mark on a king
    const twice = { ...base, boards: { ...base.boards, A: { ...base.boards.A, promoted: ['a1', 'a1'] } } };
    expect(conservationProblems(twice)).toContain('board A: a promoted square is listed twice');
    const onKing = { ...base, boards: { ...base.boards, A: { ...base.boards.A, promoted: ['e1'] } } };
    expect(conservationProblems(onKing)).toContain('board A: e1 is marked promoted but holds a k');
  });
});
