import { describe, expect, it } from 'vitest';
import {
  BUGHOUSE_BOT_DROP_PROBES,
  BUGHOUSE_BOT_LOOKAHEAD,
  BUGHOUSE_BOT_MAX_DROP_CANDIDATES,
  BUGHOUSE_BOT_RESCUE_BATCHES,
  applyAction,
  chooseBughouseAction,
  firstLegalAction,
  legalActions,
  settle,
  type BughouseAction,
  type BughouseMatch,
} from '../bughouse';
import { runArena } from './bughouseBotKit';
import { mulberry32 } from './bughouseTestKit';
import { move, play, scene, START } from './bughouseScenes';

/**
 * The Bughouse bot (BUGHOUSE_SPEC.md HP4, W2) - the QUICK half (bughouseBotBudget.test.ts holds the thousands of decisions, the whole self-play matches and the latency per tier): legal
 * only, drops included; deterministic for a seed; finds a mate in one by a move and by a drop (also a drop fed by the partner's capture); takes the free queen, does not hang its own, does
 * not walk into a mate by a dropped piece; promotes to a queen; uses what is in its pocket; never under-promotes by choice. The caps are literals here, not read from the module under test.
 */
const BEST = () => 0; // every random draw is 0: the "use the scored choice" branch, and ties go to the first
const TIERS = [400, 800, 1200, 1700, 2000, 2400, 3000];
const keyOf = (a: BughouseAction): string => (a.kind === 'move' ? `m:${a.board}:${a.from}${a.to}${a.promotion ?? ''}` : a.kind === 'drop' ? `d:${a.board}:${a.piece}@${a.square}` : a.kind);
const isMate = (outcome: ReturnType<typeof applyAction>): boolean => outcome.ok && outcome.match.result !== null && 'winnerTeam' in outcome.match.result && outcome.match.result.reason === 'checkmate';

describe('the caps are the ones the budget was measured with', () => {
  it('lookahead 5, 12 drop candidates, 3 drop probes per candidate, 2 rescue batches (at most 15 candidates played out)', () => {
    expect(BUGHOUSE_BOT_LOOKAHEAD).toBe(5);
    expect(BUGHOUSE_BOT_MAX_DROP_CANDIDATES).toBe(12);
    expect(BUGHOUSE_BOT_DROP_PROBES).toBe(3);
    expect(BUGHOUSE_BOT_RESCUE_BATCHES).toBe(2);
  });
});

describe('legal only', () => {
  it('360 seeded decisions at three tiers, drops included, are all in the engine\'s own legal lists (and the match never refuses one)', { timeout: 120_000 }, () => {
    let decisions = 0;
    let drops = 0;
    let refused = 0;
    for (const [i, elo] of [400, 1200, 3000].entries()) {
      for (let seed = 1; seed <= 3; seed++) {
        const result = runArena({
          seed: 100 * (i + 1) + seed,
          elos: [elo, elo, elo, elo],
          maxCommits: 45,
          onDecision: (match, seat, action) => {
            decisions++;
            const legal = legalActions(match, seat);
            if (action === null) {
              expect(legal.moves.length + legal.drops.length).toBe(0);
              return;
            }
            const keys = new Set([...legal.moves.map((m) => `m:${action.kind === 'move' ? action.board : '?'}:${m.from}${m.to}${m.promotion ?? ''}`), ...legal.drops.map((d) => `d:${action.kind === 'drop' ? action.board : '?'}:${d.piece}@${d.square}`)]);
            expect(keys.has(keyOf(action)), `illegal bot action ${keyOf(action)} for seat ${seat} at seq ${match.seq}`).toBe(true);
            if (action.kind === 'drop') drops++;
          },
        });
        refused += result.refused.length;
        expect(result.conservation).toEqual([]);
      }
    }
    expect(refused).toBe(0);
    expect(decisions).toBeGreaterThanOrEqual(300);
    expect(drops).toBeGreaterThanOrEqual(10);
  });

  it('returns null when it is not the seat\'s turn, when the match is over, and when the seat is stuck', () => {
    const m = scene({ a: START, b: START });
    expect(chooseBughouseAction(m, 1, 3000, BEST)).toBeNull(); // black on board A, white to move
    expect(chooseBughouseAction(m, 3, 3000, BEST)).toBeNull();
    const over = play(m, 0, { kind: 'resign' }, 1500);
    expect(chooseBughouseAction(over, 2, 3000, BEST)).toBeNull();
    const stuck = scene({ a: 'R6k/6pp/8/8/8/8/8/K7 b - - 0 1', b: START });
    expect(stuck.verdicts.A.status).toBe('stuck');
    expect(chooseBughouseAction(stuck, 1, 3000, BEST)).toBeNull();
    expect(firstLegalAction(stuck, 1)).toBeNull();
    expect(firstLegalAction(over, 0)).toBeNull();
    expect(firstLegalAction(m, 1)).toBeNull(); // not its turn
  });

  it('firstLegalAction is a legal move in chess.js\'s order, or the first drop when there is no move', () => {
    const m = scene({ a: START, b: START });
    const first = firstLegalAction(m, 0) as BughouseAction;
    expect(first.kind).toBe('move');
    expect(applyAction(m, 0, first, m.nowMs).ok).toBe(true);
    const inCheck = scene({ a: 'R6k/6pp/8/8/8/8/8/K7 b - - 0 1', b: START, pockets: { 1: { r: 1 } } });
    const drop = firstLegalAction(inCheck, 1) as BughouseAction;
    expect(drop.kind).toBe('drop');
    expect(applyAction(inCheck, 1, drop, inCheck.nowMs).ok).toBe(true);
  });
});

describe('determinism', () => {
  it('the same match, seat, strength and seed give the same action, run after run', () => {
    const m = scene({ a: START, b: START });
    for (const elo of TIERS) {
      for (let seed = 1; seed <= 5; seed++) {
        const first = chooseBughouseAction(m, 0, elo, mulberry32(seed));
        expect(chooseBughouseAction(m, 0, elo, mulberry32(seed))).toEqual(first);
        expect(chooseBughouseAction(m, 2, elo, mulberry32(seed))).toEqual(chooseBughouseAction(m, 2, elo, mulberry32(seed)));
      }
    }
  });

  it('a whole bot match is a function of its seed: two runs give the same final match text', () => {
    const a = runArena({ seed: 4242, elos: [1700, 1200, 2400, 3000], maxCommits: 120 });
    const b = runArena({ seed: 4242, elos: [1700, 1200, 2400, 3000], maxCommits: 120 });
    expect(a.match).toEqual(b.match);
    expect(a.commits).toBe(b.commits);
    expect(a.commits).toBeGreaterThan(40);
    const c = runArena({ seed: 4243, elos: [1700, 1200, 2400, 3000], maxCommits: 120 });
    expect(c.match).not.toEqual(a.match);
  });

  it('the strength is the chance of using the scored choice: a bot at 3000 follows it more often than one at 400', () => {
    // one position, 200 seeds: the free queen (Rxd7) is the scored choice; the strong bot plays it much more often than the weak one
    const m = scene({ a: '4k3/3q4/7p/8/8/8/8/2BRK3 w - - 0 1', b: START });
    const rate = (elo: number): number => {
      let hits = 0;
      for (let seed = 1; seed <= 200; seed++) if (keyOf(chooseBughouseAction(m, 0, elo, mulberry32(seed)) as BughouseAction) === 'm:A:d1d7') hits++;
      return hits / 200;
    };
    expect(rate(3000)).toBeGreaterThan(0.8);
    expect(rate(400)).toBeLessThan(0.45);
    expect(rate(400)).toBeGreaterThan(0.1);
  });
});

describe('what the bot finds', () => {
  it('a mate in one by a MOVE', () => {
    const m = scene({ a: START, b: '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1' });
    const action = chooseBughouseAction(m, 2, 3000, BEST) as BughouseAction;
    expect(isMate(applyAction(m, 2, action, m.nowMs))).toBe(true);
  });

  it('a mate in one by a DROP: the queen the human partner just captured on the other board', () => {
    // seat 3 (the bot's partner, board B Black) takes White's queen with the rook: the queen lands in seat 0's pocket - and seat 0 drops it for mate on board A
    const m0 = scene({ a: '7k/8/6K1/8/8/8/8/8 w - - 0 1', b: 'r3k3/8/8/8/8/8/8/Q3K3 b - - 0 1' });
    const m1 = play(m0, 3, move('B', 'a8', 'a1'), 1500);
    expect(m1.pockets[0].q).toBe(1);
    const action = chooseBughouseAction(m1, 0, 3000, BEST) as BughouseAction;
    expect(action.kind).toBe('drop');
    expect(isMate(applyAction(m1, 0, action, m1.nowMs))).toBe(true);
  });

  it('a back-rank "mate" in chess.js\'s notation is not a Bughouse mate (a piece could be dropped to block it): it does not outrank winning a queen', () => {
    // Qd8 is "Qd8#" to chess.js (Black's king is boxed in by f7 g7 h7), but a piece arriving in Black's pocket could block on e8 or f8, so the engine calls it check, not mate (rule 18).
    // Rxa2 wins Black's undefended queen. The notation mate earns a place among the finalists - and nothing more once the engine has judged it.
    const m = scene({ a: '6k1/5ppp/8/8/8/8/q7/R2QK3 w - - 0 1', b: START });
    const mated = applyAction(m, 0, { kind: 'move', board: 'A', from: 'd1', to: 'd8' }, m.nowMs);
    expect(isMate(mated)).toBe(false);
    expect(mated.ok && mated.match.verdicts.A.status).toBe('stuck');
    expect(keyOf(chooseBughouseAction(m, 0, 3000, BEST) as BughouseAction)).toBe('m:A:a1a2');
  });

  it('takes the free queen rather than the free pawn', () => {
    // Rd1 takes the undefended queen on d7 (the king recaptures: 9 for 5); Bc1 takes the pawn on h6 for nothing
    const m = scene({ a: '4k3/3q4/7p/8/8/8/8/2BRK3 w - - 0 1', b: START });
    expect(keyOf(chooseBughouseAction(m, 0, 3000, BEST) as BughouseAction)).toBe('m:A:d1d7');
  });

  it('does not hang its queen for a pawn that is defended', () => {
    // Qxd5 wins a pawn and loses the queen to exd5
    const m = scene({ a: '6k1/8/4p3/3p4/8/8/8/3QK3 w - - 0 1', b: START });
    for (const elo of [1200, 3000]) expect(keyOf(chooseBughouseAction(m, 0, elo, BEST) as BughouseAction)).not.toBe('m:A:d1d5');
  });

  it('back-rank / smothered safety: it does not take a free pawn that allows a MATING DROP, and it does when the opponent has nothing to drop', () => {
    // White Kh1 Rg1 pawns g2 h2 (a smothered king), Be4 can take the pawn on h7. If Black holds a knight in its pocket, Bxh7 (or any move that leaves the setup) allows N@f2#.
    const fen = 'k7/7p/8/8/4B3/8/6PP/6RK w - - 0 1';
    const trapped = scene({ a: fen, b: START, pockets: { 1: { n: 1 } } });
    const trap = play(play(trapped, 0, move('A', 'e4', 'h7'), 1500), 1, { kind: 'drop', board: 'A', piece: 'n', square: 'f2' }, 1600);
    expect(trap.result !== null && 'winnerTeam' in trap.result && trap.result.reason === 'checkmate').toBe(true); // the trap is real
    for (const elo of [1200, 3000]) {
      const action = chooseBughouseAction(trapped, 0, elo, BEST) as BughouseAction;
      expect(keyOf(action)).not.toBe('m:A:e4h7');
      const outcome = applyAction(trapped, 0, action, trapped.nowMs);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        // whatever it chose, Black has no mating drop afterwards
        const mated = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].some((f) =>
          ['1', '2', '3', '4', '5', '6', '7', '8'].some((r) => {
            const reply = applyAction(outcome.match, 1, { kind: 'drop', board: 'A', piece: 'n', square: `${f}${r}` }, outcome.match.nowMs);
            return reply.ok && reply.match.result !== null && 'winnerTeam' in reply.match.result;
          }),
        );
        expect(mated).toBe(false);
      }
    }
    const free = scene({ a: fen, b: START });
    expect(keyOf(chooseBughouseAction(free, 0, 3000, BEST) as BughouseAction)).toBe('m:A:e4h7');
  });

  it('when every move that looks good loses to a mate in one, the rescue batches still find a move that does not', () => {
    // White has four free captures (a2xb3, c2xb3, c2xd3, e2xd3) and four central pawn pushes - eight moves that all look better than a quiet rook or g/h-pawn move, and every one of them leaves
    // the smothered king (Kh1, Rg1, pawns g2 h2) to N@f2#. The five best-looking moves are all fatal, so only the rescue batches reach a move that is not.
    const fen = 'k7/8/8/8/8/1p1p4/P1P1P1PP/6RK w - - 0 1';
    const m = scene({ a: fen, b: START, pockets: { 1: { n: 1 } } });
    const trap = play(play(m, 0, move('A', 'e2', 'd3'), 1500), 1, { kind: 'drop', board: 'A', piece: 'n', square: 'f2' }, 1600);
    expect(trap.result !== null && 'winnerTeam' in trap.result && trap.result.reason === 'checkmate').toBe(true); // the trap is real
    const action = chooseBughouseAction(m, 0, 3000, BEST) as BughouseAction;
    const outcome = applyAction(m, 0, action, m.nowMs);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const squares = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].flatMap((f) => ['1', '2', '3', '4', '5', '6', '7', '8'].map((r) => `${f}${r}`));
    const mated = squares.some((square) => {
      const reply = applyAction(outcome.match, 1, { kind: 'drop', board: 'A', piece: 'n', square }, outcome.match.nowMs);
      return reply.ok && reply.match.result !== null && 'winnerTeam' in reply.match.result;
    });
    expect(mated, `the bot chose ${keyOf(action)}, which allows a mating drop`).toBe(false);
  });

  it('promotes to a queen when it can; never under-promotes by choice (the random branch plays a queen too)', () => {
    const m = scene({ a: '8/P6k/8/8/8/8/8/K7 w - - 0 1', b: START });
    expect(keyOf(chooseBughouseAction(m, 0, 3000, BEST) as BughouseAction)).toBe('m:A:a7a8q');
    for (let seed = 1; seed <= 40; seed++) {
      const random = chooseBughouseAction(m, 0, 400, mulberry32(seed)) as Extract<BughouseAction, { kind: 'move' }>;
      if (random.from === 'a7') expect(random.promotion).toBe('q');
    }
  });

  it('a piece in the pocket gets used: with a queen to drop and nothing to take, the scored choice is a drop', () => {
    const m = scene({ a: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', b: START, pockets: { 0: { q: 1 } } });
    const action = chooseBughouseAction(m, 0, 3000, BEST) as BughouseAction;
    expect(action.kind).toBe('drop');
    expect(applyAction(m, 0, action, m.nowMs).ok).toBe(true);
  });

  it('drops go to safe squares: a queen is not dropped where it is simply taken', () => {
    // Black's rook on a8 covers the whole a-file and rank 8; Black's king is on e8. Squares the queen could be taken on for nothing are not where it goes.
    const m = scene({ a: 'r3k3/8/8/8/8/8/8/4K3 w - - 0 1', b: START, pockets: { 0: { q: 1 } } });
    for (let seed = 1; seed <= 10; seed++) {
      const action = chooseBughouseAction(m, 0, 3000, mulberry32(seed * 7919)) as Extract<BughouseAction, { kind: 'drop' }> | Extract<BughouseAction, { kind: 'move' }>;
      if (action.kind === 'drop') {
        const after = applyAction(m, 0, action, m.nowMs);
        expect(after.ok).toBe(true);
        if (after.ok) {
          const taken = ['a8', 'e8'].some((from) => {
            const reply = applyAction(after.match, 1, { kind: 'move', board: 'A', from, to: action.square }, after.match.nowMs);
            return reply.ok && after.match.boards.A.fen.split(' ')[0] !== reply.match.boards.A.fen.split(' ')[0] && reply.match.pockets[2].q === 1;
          });
          expect(taken, `the queen was dropped on ${action.square}, where it is taken for nothing`).toBe(false);
        }
      }
    }
  });
});

describe('the funnel is the judge: nothing the bot says is played unchecked', () => {
  it('an action the engine refuses is refused (the bot module has no way around settle)', () => {
    const m = scene({ a: START, b: START });
    const outcome = settle(m, { seat: 0, action: { kind: 'move', board: 'A', from: 'e2', to: 'e5' } }, 1500);
    expect(outcome.kind).toBe('rejected');
  });
});

describe('typing', () => {
  it('chooseBughouseAction takes the match, the seat, the strength and the random stream and nothing else (no board default)', () => {
    expect(chooseBughouseAction.length).toBe(4);
    const m: BughouseMatch = scene({ a: START, b: START });
    expect(typeof chooseBughouseAction(m, 0, 1200, BEST)).toBe('object');
  });
});
