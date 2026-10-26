import { describe, expect, it, vi } from 'vitest';

const engineCalls = vi.hoisted(() => ({ applyAction: 0, bySeat: [0, 0, 0, 0] as number[] }));
vi.mock('../bughouse/match', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../bughouse/match')>();
  return {
    ...actual,
    // every call is counted (in all, and per seat that acts) and passed straight through: the bot's WORK is measured in engine calls (a count, never a clock)
    applyAction: (...args: Parameters<typeof actual.applyAction>) => {
      engineCalls.applyAction++;
      engineCalls.bySeat[args[1]]++;
      return actual.applyAction(...args);
    },
  };
});

import { Chess } from 'chess.js';
import {
  applyAction,
  chooseBughouseAction,
  firstLegalAction,
  nearestDrops,
  crazyhouseOfBoard,
  legalDropOptions,
  openBoard,
  replyDanger,
  scoreCandidates,
  voidMatch,
  type BotCandidate,
  type BughouseAction,
  type BughouseMatch,
} from '../bughouse';
import { runArena } from './bughouseBotKit';
import { move, scene, START } from './bughouseScenes';

/**
 * The NUMBERS of the Bughouse bot (src/logic/bughouse/bot.ts), pinned as literals: the strength dial at its exact thresholds, the scripted random branch, every term of the pass-1 score,
 * the drop filters and the cap, the reply evaluation, the look-ahead batches counted in engine calls, and the properties that make the remaining guards unreachable. The quick half of the
 * bot's tests (bughouseBot.test.ts) pins what the bot DOES; this file pins WHY it does it.
 */
const label = (c: BotCandidate): string => c.san ?? (c.action.kind === 'drop' ? `${c.action.piece}@${c.action.square}` : '?');
const scores = (candidates: BotCandidate[]): Record<string, number> => Object.fromEntries(candidates.map((c) => [label(c), Math.round(c.score * 1000) / 1000]));
const ZERO = () => 0;
/** A random stream that returns the given values in order, then the last one for ever. */
const script = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};
const keyOf = (a: BughouseAction | null): string => (a === null ? 'null' : a.kind === 'move' ? `${a.from}${a.to}${a.promotion ?? ''}` : a.kind === 'drop' ? `${a.piece}@${a.square}` : a.kind);
const isMateAction = (m: BughouseMatch, seat: 0 | 1 | 2 | 3, a: BughouseAction | null): boolean => {
  if (a === null) return false;
  const o = applyAction(m, seat, a, m.nowMs);
  return o.ok && o.match.result !== null && 'winnerTeam' in o.match.result && o.match.result.reason === 'checkmate';
};
const afterMove = (m: BughouseMatch, seat: 0 | 1 | 2 | 3, a: BughouseAction): BughouseMatch => {
  const o = applyAction(m, seat, a, m.nowMs);
  if (!o.ok) throw new Error(`refused: ${o.reason}`);
  return o.match;
};

describe('the strength dial: exact thresholds', () => {
  // seat 2 mates in one on board B (Qg7# or Qh7#); the last move in chess.js's list is not a mate, so the random branch with a high draw plays something else
  const m = scene({ a: START, b: '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1' });
  const THRESHOLDS: [number, number][] = [
    [400, 0.2],
    [1000, 0.3615384615384615],
    [1700, 0.55],
    [3000, 0.2 + 0.7],
    [5000, 0.2 + 0.7], // above the top of the scale the chance stays at its ceiling
    [0, 0.2], // below the bottom it stays at its floor
    [-100, 0.2],
  ];
  it('the scored choice is played for a draw just below the chance and a random move for a draw just above it, at every tier (and the scale is clamped at both ends)', () => {
    for (const [elo, chance] of THRESHOLDS) {
      const below = chooseBughouseAction(m, 2, elo, script(chance - 1e-6, 0.999));
      const above = chooseBughouseAction(m, 2, elo, script(chance + 1e-6, 0.999));
      expect(isMateAction(m, 2, below), `elo ${elo} just below ${chance}`).toBe(true);
      expect(isMateAction(m, 2, above), `elo ${elo} just above ${chance}`).toBe(false);
    }
  });

  it('a draw EXACTLY equal to the chance is the random branch (the comparison is >=)', () => {
    expect(isMateAction(m, 2, chooseBughouseAction(m, 2, 400, script(0.2, 0.999)))).toBe(false);
    expect(isMateAction(m, 2, chooseBughouseAction(m, 2, 3000, script(0.2 + 0.7, 0.999)))).toBe(false);
  });
});

describe('the random branch, scripted', () => {
  const pocket = scene({ a: START, b: START, pockets: { 0: { n: 1 } } });
  it('a draw below 0.3 after the dial draw plays a drop, one above plays a move; the index draw picks the first or the last', () => {
    const drop = chooseBughouseAction(pocket, 0, 400, script(0.99, 0.1, 0)) as BughouseAction;
    expect(drop.kind).toBe('drop');
    const lastDrop = chooseBughouseAction(pocket, 0, 400, script(0.99, 0.1, 0.9999)) as BughouseAction;
    expect(lastDrop.kind).toBe('drop');
    expect(keyOf(drop)).not.toBe(keyOf(lastDrop));
    const firstMove = chooseBughouseAction(pocket, 0, 400, script(0.99, 0.5, 0)) as BughouseAction;
    expect(firstMove.kind).toBe('move');
    const lastMove = chooseBughouseAction(pocket, 0, 400, script(0.99, 0.5, 0.9999)) as BughouseAction;
    expect(lastMove.kind).toBe('move');
    expect(keyOf(firstMove)).not.toBe(keyOf(lastMove));
    expect(keyOf(firstMove)).toBe('a2a3'); // the first of chess.js's list for the start position
    expect(keyOf(lastMove)).toBe('g1h3'); // ... and the last
  });

  it('without anything in the pocket the random branch never drops, whatever the draw', () => {
    const plain = scene({ a: START, b: START });
    for (const d of [0, 0.1, 0.29, 0.5, 0.99]) expect((chooseBughouseAction(plain, 0, 400, script(0.99, d, 0.5)) as BughouseAction).kind).toBe('move');
  });

  it('the pool of the random branch leaves out the rook and bishop promotions', () => {
    const promo = scene({ a: '7k/P7/8/8/8/8/8/K7 w - - 0 1', b: START });
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(keyOf(chooseBughouseAction(promo, 0, 400, script(0.99, i / 40)) as BughouseAction));
    expect(seen.has('a7a8q')).toBe(true);
    expect([...seen].some((k) => /a7a8[rbn]/.test(k))).toBe(false);
    expect(seen.has('a1a2') || seen.has('a1b1') || seen.has('a1b2')).toBe(true);
  });
});

describe('pass 1: the score of a move, term by term (rng = 0, so no jitter)', () => {
  it('a capture is worth the victim plus half of what the partner receives; the destination being attacked costs 0.4 of the mover; a quiet central move +0.04', () => {
    const s = scores(scoreCandidates(scene({ a: '4k3/3q4/7p/8/8/8/8/2BRK3 w - - 0 1', b: START }), 0, ZERO));
    expect(s['Rxd7']).toBe(11.5); // 9 + 0.5 x 9 - 0.4 x 5
    expect(s['Bxh6']).toBe(1.5); // 1 + 0.5 x 1
    expect(s['Be3']).toBe(0.04);
    expect(s['Bb2']).toBe(0);
    expect(s['Rd3']).toBe(-1.96); // 0.04 - 0.4 x 5
    expect(s['Rd2']).toBe(-2); // 0 - 0.4 x 5
    expect(s['Ke2']).toBe(0);
    expect(s['Bd2']).toBe(-1.2); // 0 - 0.4 x 3
  });

  it('an en passant capture takes a pawn; a promoted victim banks only a pawn for the partner', () => {
    expect(scores(scoreCandidates(scene({ a: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', b: START }), 0, ZERO))['exd6']).toBe(1.5);
    const promoted = scores(scoreCandidates(scene({ a: '4k3/3q4/7p/8/8/8/8/2BRK3 w - - 0 1', b: START, promotedA: ['d7'] }), 0, ZERO));
    expect(promoted['Rxd7']).toBe(7.5); // 9 + 0.5 x 1 - 2
  });

  it('a promotion adds the new piece\'s worth minus the pawn; only queen and knight promotions are candidates', () => {
    const s = scores(scoreCandidates(scene({ a: '8/P6k/8/8/8/8/8/K7 w - - 0 1', b: START }), 0, ZERO));
    expect(s['a8=Q']).toBe(8);
    expect(s['a8=N']).toBe(2);
    expect(Object.keys(s).some((k) => k.includes('=R') || k.includes('=B'))).toBe(false);
    const capture = scores(scoreCandidates(scene({ a: '1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1', b: START }), 0, ZERO));
    expect(capture['axb8=Q+']).toBe(16); // 5 + 2.5 captured, +8 promotion, +0.5 check
    expect(capture['axb8=N']).toBe(9.5);
  });

  it('a check earns 0.5; a mate in the notation earns a ticket of 100 on top; a move to an attacked square costs 0.4 of the piece that moves (a promotion counts as the new piece, the king is never charged)', () => {
    expect(scores(scoreCandidates(scene({ a: 'k7/8/8/8/8/8/8/K6R w - - 0 1', b: START }), 0, ZERO))['Rh8+']).toBe(0.5);
    const mate = scores(scoreCandidates(scene({ a: '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1', b: START }), 0, ZERO));
    expect(mate['Qg7#']).toBe(96.9); // 0.5 + 100 - 0.4 x 9 (the king covers g7)
    const hang = scores(scoreCandidates(scene({ a: '4k3/8/8/8/2p5/8/8/3QK3 w - - 0 1', b: START }), 0, ZERO));
    expect(hang['Qd3']).toBe(-3.56);
    expect(hang['Qb3']).toBe(-3.6);
    expect(hang['Qd7+']).toBe(-3.1);
    expect(hang['Qd4']).toBe(0.04);
    const guarded = scores(scoreCandidates(scene({ a: '8/P6k/1p6/8/8/8/8/K7 w - - 0 1', b: START }), 0, ZERO)); // nothing attacks a8 here
    expect(guarded['a8=Q']).toBe(8);
    const attacked = scores(scoreCandidates(scene({ a: '1r5k/P7/8/8/8/8/8/K7 w - - 0 1', b: START }), 0, ZERO)); // the rook on b8 covers a8
    expect(attacked['a8=Q']).toBe(4.4); // 8 - 0.4 x 9
    expect(attacked['a8=N']).toBe(0.8); // 2 - 0.4 x 3
  });

  it('castling scores 0.3 whatever the notation says (a castle that gives check is still 0.3)', () => {
    const s = scores(scoreCandidates(scene({ a: '8/8/8/3k4/8/8/8/R3K2R w KQ - 0 1', b: START }), 0, ZERO));
    expect(s['O-O']).toBe(0.3);
    expect(s['O-O-O+']).toBe(0.3);
  });

  it('the candidates come best first and ties keep the list order', () => {
    const c = scoreCandidates(scene({ a: '4k3/3q4/7p/8/8/8/8/2BRK3 w - - 0 1', b: START }), 0, ZERO);
    expect(c.map((x) => x.score)).toEqual([...c.map((x) => x.score)].sort((a, b) => b - a));
    expect(label(c[0])).toBe('Rxd7');
  });

  it('the jitter is small and comes from the random stream: with a high draw the scores move by less than 0.02', () => {
    const raw = (rng: () => number) => Object.fromEntries(scoreCandidates(scene({ a: '4k3/3q4/7p/8/8/8/8/2BRK3 w - - 0 1', b: START }), 0, rng).map((c) => [label(c), c.score]));
    const calm = raw(ZERO);
    const noisy = raw(() => 0.99);
    for (const k of Object.keys(calm)) {
      expect(noisy[k] - calm[k]).toBeGreaterThan(0.0197);
      expect(noisy[k] - calm[k]).toBeLessThan(0.0199);
    }
  });
});

describe('pass 1: the drops', () => {
  it('a safe drop is worth 0.3 of the piece, +0.15 per ring of nearness to the enemy king within two squares, -0.3 for a pawn; an unsafe one -0.5 of it', () => {
    const s = scores(scoreCandidates(scene({ a: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', b: START, pockets: { 0: { q: 1, p: 1 } } }), 0, ZERO, 1000));
    expect(s['q@c6']).toBe(2.85); // 2.7 + (3 - 2) x 0.15
    expect(s['q@b5']).toBe(2.7); // three away: no nearness bonus
    expect(s['p@c6']).toBe(0.15); // 0.3 + 0.15 - 0.3
    expect(s['p@b5']).toBe(0); // 0.3 - 0.3
    // beside the king a square is safe only if it is defended: the bishop on g5 defends d8 and e7 (the king attacks both)
    const near = scores(scoreCandidates(scene({ a: '4k3/8/8/6B1/8/8/8/4K3 w - - 0 1', b: START, pockets: { 0: { q: 1 } } }), 0, ZERO, 1000));
    expect(near['q@d8']).toBe(3); // 2.7 + (3 - 1) x 0.15
    expect(near['q@e7']).toBe(3);
    expect(near['q@f7']).toBe(-4.2); // attacked by the king, defended by nobody
    expect(near['q@f8']).toBe(-4.2);
  });

  it('unsafe squares near the king are scored (-4.5 + nearness), unsafe squares far from it are not candidates at all, a defended square counts as safe', () => {
    const s = scores(scoreCandidates(scene({ a: '4k3/3p4/3p4/8/1p6/8/8/4K3 w - - 0 1', b: START, pockets: { 0: { q: 1 } } }), 0, ZERO, 1000));
    expect(s['q@c6']).toBe(-4.35); // attacked by the pawn on d7, two from the king
    expect(s['q@e6']).toBe(-4.35);
    expect(s['q@e7']).toBe(-4.2); // attacked by the king, one away
    expect('q@c5' in s || 'q@e5' in s).toBe(false); // attacked by the pawn on d6 and three from the king: not scored
    expect('q@a3' in s || 'q@c3' in s).toBe(false); // attacked by the pawn on b4 and far away
    expect(s['q@f6']).toBe(2.85);
    const defended = scores(scoreCandidates(scene({ a: '4k3/3p4/8/8/1p4B1/8/8/4K3 w - - 0 1', b: START, pockets: { 0: { q: 1 } } }), 0, ZERO, 1000));
    expect(defended['q@e6']).toBe(2.85); // the pawn attacks e6 but the bishop on g4 defends it
    expect(defended['q@c6']).toBe(-4.35); // nobody defends c6
  });

  it('the cap: twelve drops at most, the most valuable pieces and the squares nearest the enemy king first', () => {
    const m = scene({ a: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', b: START, pockets: { 0: { q: 1, r: 1, n: 1, p: 1 } } });
    const drops = scoreCandidates(m, 0, ZERO).filter((c) => c.san === null);
    expect(drops).toHaveLength(12);
    expect(drops.filter((c) => label(c).startsWith('q@'))).toHaveLength(9);
    expect(drops.filter((c) => label(c).startsWith('r@'))).toHaveLength(3);
    expect(drops.every((c) => !label(c).startsWith('n@') && !label(c).startsWith('p@'))).toBe(true);
    const nearest = ['c6', 'd6', 'e6', 'f6', 'g6', 'c7', 'g7', 'c8', 'g8'];
    expect(drops.filter((c) => label(c).startsWith('q@')).map((c) => label(c).slice(2)).sort()).toEqual([...nearest].sort());
    const all = scoreCandidates(m, 0, ZERO, 1000).filter((c) => c.san === null);
    expect(all.length).toBeGreaterThan(200);
    expect(scoreCandidates(m, 0, ZERO, 3).filter((c) => c.san === null)).toHaveLength(3);
  });

  it('a drop candidate names its piece and its square', () => {
    const c = scoreCandidates(scene({ a: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', b: START, pockets: { 0: { r: 1 } } }), 0, ZERO).find((x) => label(x) === 'r@c6') as BotCandidate;
    expect(c.action).toEqual({ kind: 'drop', board: 'A', piece: 'r', square: 'c6' });
    expect(c.san).toBeNull();
  });
});

describe('the probe squares of a mating drop', () => {
  it('queens: those on a line with the king from any distance and any square within two, the touching ones first, nearest first, ties in the given order, at most `limit`', () => {
    const drops = ['a1', 'e6', 'c6', 'e7', 'd7', 'g8', 'h3', 'b3'].map((square) => ({ piece: 'q' as const, square }));
    expect(nearestDrops(drops, 'e8', 3).map((d) => d.square)).toEqual(['e7', 'd7', 'e6']);
    expect(nearestDrops(drops, 'e8', 1).map((d) => d.square)).toEqual(['e7']);
    // a1 and b3 are not on a line with e8 (a1 is 4 files and 7 ranks away); h3 is on the diagonal e8-h5-... no: h3 is 3 files, 5 ranks away
    expect(nearestDrops(drops, 'e8', 10).map((d) => d.square)).toEqual(['e7', 'd7', 'e6', 'c6', 'g8']);
    expect(nearestDrops(drops, 'h1', 10).map((d) => d.square)).toEqual(['h3', 'c6', 'a1']); // h3 on h1's file (2 away), c6 on its diagonal (5), a1 on its rank (7): touching, nearest first; the rest are far and not touching
    expect(nearestDrops([], 'e8', 3)).toEqual([]);
  });

  it('knights, bishops, rooks and pawns touch the king their own way; a drop that touches from far away is still probed, one that does not touch and is far is not', () => {
    const at = (piece: 'n' | 'b' | 'r' | 'q' | 'p', squares: string[]) => squares.map((square) => ({ piece, square }));
    // king on h8: a knight touches from f7 and g6, not from f6 (two squares away but no jump)
    expect(nearestDrops(at('n', ['f6', 'g6', 'f7', 'a1']), 'h8', 2).map((d) => d.square)).toEqual(['g6', 'f7']);
    expect(nearestDrops(at('n', ['f6', 'g6', 'f7', 'a1']), 'h8', 10).map((d) => d.square)).toEqual(['g6', 'f7', 'f6']);
    // a rook touches along the rank or file from afar (a8, h1), not on a diagonal (g7 is within two: probed after the touching ones)
    expect(nearestDrops(at('r', ['g7', 'a8', 'h1', 'c3']), 'h8', 10).map((d) => d.square)).toEqual(['a8', 'h1', 'g7']); // (a8 and h1 are both 7 away: the given order breaks the tie)
    // a bishop touches on a diagonal from afar (a1), not along a rank (a8)
    expect(nearestDrops(at('b', ['a8', 'a1', 'g6']), 'h8', 10).map((d) => d.square)).toEqual(['a1', 'g6']); // a8 is 7 away on a rank: neither touching nor near
    // a pawn touches diagonally beside the king only
    expect(nearestDrops(at('p', ['g7', 'h7', 'f6']), 'h8', 10).map((d) => d.square)).toEqual(['g7', 'h7', 'f6']);
    expect(nearestDrops(at('p', ['g7', 'a1']), 'h8', 10).map((d) => d.square)).toEqual(['g7']);
  });

  it('"near" is two squares, not three: a pawn three squares straight from the king is not probed', () => {
    expect(nearestDrops([{ piece: 'p', square: 'd7' }], 'd4', 5)).toEqual([]);
    expect(nearestDrops([{ piece: 'p', square: 'd6' }], 'd4', 5).map((d) => d.square)).toEqual(['d6']);
  });

  it('a drop on the king\'s own square (never offered in play, it is occupied) touches nothing: the touching drops stay ahead of it', () => {
    expect(nearestDrops([{ piece: 'b', square: 'e4' }, { piece: 'q', square: 'a8' }], 'e4', 1).map((d) => d.square)).toEqual(['a8']);
    expect(nearestDrops([{ piece: 'r', square: 'e4' }, { piece: 'q', square: 'a8' }], 'e4', 1).map((d) => d.square)).toEqual(['a8']);
  });
});

describe('the reply: what the side that just moved is up against', () => {
  it('the loss is the BEST capture (not the sum, not the least)', () => {
    // Black's queen on d4 can take the rook on a4 (5), the knight on d7 (3) or the pawn on f2 (1): the sum would be 9, the least 1
    const m = scene({ a: '4k3/3N4/8/8/R2q4/8/5P2/4K3 b - - 0 1', b: START });
    expect(replyDanger(m, 'A', 0, false)).toEqual({ loss: 5, mated: false });
  });

  it('an en passant capture is a pawn\'s worth', () => {
    expect(replyDanger(scene({ a: '4k3/8/8/8/3Pp3/8/8/4K3 b - d3 0 1', b: START }), 'A', 0, false)).toEqual({ loss: 1, mated: false });
  });

  it('a mate in one by a move is seen, with or without the drop probe', () => {
    const m = scene({ a: '6k1/8/8/8/8/5q1p/8/7K b - - 0 1', b: START });
    expect(replyDanger(m, 'A', 0, false).mated).toBe(true);
    expect(replyDanger(m, 'A', 0, true).mated).toBe(true);
  });

  it('a mating DROP beside the king is found only when the probe is asked for, and only for the replier\'s own pocket', () => {
    const trap = scene({ a: 'k7/7p/8/8/4B3/8/6PP/6RK w - - 0 1', b: START, pockets: { 1: { n: 1 } } });
    const after = afterMove(trap, 0, move('A', 'e4', 'h7'));
    expect(replyDanger(after, 'A', 0, true)).toEqual({ loss: 0, mated: true });
    expect(replyDanger(after, 'A', 0, false)).toEqual({ loss: 0, mated: false });
    // the same drop in the MOVER's own pocket is no danger (the replier is the opponent of the mover)
    const mine = scene({ a: 'k7/7p/8/8/4B3/8/6PP/6RK w - - 0 1', b: START, pockets: { 0: { n: 1 } } });
    expect(replyDanger(afterMove(mine, 0, move('A', 'e4', 'h7')), 'A', 0, true).mated).toBe(false);
    // a drop that gives check but is not mate (the king can step away) is no danger
    const loose = scene({ a: 'k7/7p/8/8/4B3/8/8/6RK w - - 0 1', b: START, pockets: { 1: { n: 1 } } });
    expect(replyDanger(afterMove(loose, 0, move('A', 'e4', 'h7')), 'A', 0, true).mated).toBe(false);
  });

  it('from the other side: when seat 1 moved, the replier is seat 0 and the king probed is Black\'s', () => {
    // Black's king a8 boxed in by its own pieces (a7 b7 b8), White holds a knight: N@c7 is mate
    const m = scene({ a: 'kr6/pp6/8/8/8/8/8/4K3 b - - 0 1', b: START, pockets: { 0: { n: 1 } } });
    // it is Black to move in this scene; give White the move by playing a Black move first
    const after = afterMove(m, 1, move('A', 'a7', 'a6'));
    void after;
    const white = scene({ a: 'kr6/pp6/8/8/8/8/8/4K3 w - - 0 1', b: START, pockets: { 0: { n: 1 } } });
    expect(replyDanger(white, 'A', 1, true).mated).toBe(true);
    expect(replyDanger(white, 'A', 1, false).mated).toBe(false);
  });
});

describe('the look-ahead in engine calls (the work is bounded by counts)', () => {
  const smother = 'k7/8/8/8/8/1p1p4/P1P1P1PP/6RK w - - 0 1';
  // the engine calls made on behalf of the seat that is choosing (the opponent's mating-drop probes are counted apart)
  const callsOf = (m: BughouseMatch, seat: 0 | 1 | 2 | 3): { calls: number; probes: number; action: BughouseAction | null } => {
    engineCalls.applyAction = 0;
    engineCalls.bySeat = [0, 0, 0, 0];
    const action = chooseBughouseAction(m, seat, 3000, ZERO);
    return { calls: engineCalls.bySeat[seat], probes: engineCalls.applyAction - engineCalls.bySeat[seat], action };
  };
  const matedByDrop = (m: BughouseMatch, action: BughouseAction | null): boolean => {
    if (action === null) return false;
    const after = afterMove(m, 0, action);
    return ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].some((f) =>
      ['1', '2', '3', '4', '5', '6', '7', '8'].some((r) => {
        const reply = applyAction(after, 1, { kind: 'drop', board: 'A', piece: 'n', square: `${f}${r}` }, after.nowMs);
        return reply.ok && reply.match.result !== null && 'winnerTeam' in reply.match.result;
      }),
    );
  };

  it('a quiet position plays out exactly five candidates (no rescue batch when the first batch is fine)', () => {
    const { calls } = callsOf(scene({ a: START, b: START }), 0);
    expect(calls).toBe(5);
  });

  it('when the whole first batch loses to a mate, the next batches are tried: ten candidates when the second batch is not fatal', () => {
    // ten fatal moves first (four captures, four central pushes, two more), then moves that are safe: batches of five -> three batches, the third finds a safe move
    const m = scene({ a: smother, b: START, pockets: { 1: { n: 1 } } });
    const { calls, action } = callsOf(m, 0);
    expect(calls).toBe(15);
    expect(matedByDrop(m, action)).toBe(false);
  });

  it('a rescue stops after two more batches: fifteen fatal moves first and the bot has played out all it is allowed to (fifteen) and plays a fatal one', () => {
    const m = scene({ a: '7k/8/8/B7/PPPPPPPP/1p1p4/2P1P1PP/6RK w - - 0 1', b: START, pockets: { 1: { n: 1 } } });
    const { calls, action } = callsOf(m, 0);
    expect(calls).toBe(15);
    expect(matedByDrop(m, action)).toBe(true);
  });

  it('thirteen fatal moves first: the third batch reaches a safe move', () => {
    const m = scene({ a: '7k/8/8/B7/PPPPPP2/1p1p4/2P1P1PP/6RK w - - 0 1', b: START, pockets: { 1: { n: 1 } } });
    const { calls, action } = callsOf(m, 0);
    expect(calls).toBe(15);
    expect(matedByDrop(m, action)).toBe(false);
  });

  it('a first batch that is merely bad (not mated) is not rescued: five candidates, the least bad of them', () => {
    // every one of the five best-looking moves hangs the knight for a pawn (loss 3), none is mate: the bot does not look further
    const m = scene({ a: '4k3/3p4/4p3/8/3N4/8/8/4K3 w - - 0 1', b: START });
    const { calls, action } = callsOf(m, 0);
    expect(calls).toBe(5);
    expect(keyOf(action)).not.toBe('d4e6'); // Nxe6 is the best-looking (0.3) but dxe6 wins the knight: 0.3 - 3
  });

  it('a first batch whose best final score is below zero but nowhere near a mate (-WIN / 2) is not rescued either: five candidates, whatever the later moves would score', () => {
    // (found by a differential search: in this position the best final score of the first batch is not above zero, and a threshold of zero instead of -WIN / 2 would go on to a second batch)
    const m = scene({ a: 'r1bqkbnr/pppp1ppp/n7/4p3/8/P1N5/1PPPPPPP/R1BQKBNR w KQkq - 0 3', b: START });
    const { calls } = callsOf(m, 0);
    expect(calls).toBe(5);
  });

  it('every candidate refused by the engine (a flag is due) falls back to the first legal action instead of crashing', () => {
    const m = scene({ a: START, b: START, clocks: { 0: { remainingMs: 0 } } }); // seat 0's deadline is the match\'s own instant: flagDue for every action
    const { calls, action } = callsOf(m, 0);
    expect(calls).toBe(15); // nothing scored, so the rescue batches run too: three batches of five, all refused
    expect(keyOf(action)).toBe(keyOf(firstLegalAction(m, 0)));
    expect(action).not.toBeNull();
  });

  it('the cap of twelve drops holds in the bot\'s own decision: one king move and twelve drops are thirteen candidates, all played out when the engine refuses them all', () => {
    const m = scene({ a: 'k7/8/8/8/8/8/7r/K7 w - - 0 1', b: START, pockets: { 0: { q: 1 } }, clocks: { 0: { remainingMs: 0 } } });
    expect(callsOf(m, 0).calls).toBe(13);
  });

  it('equal finalists are told apart by the random stream: a constant stream picks the finalist at its own fraction of the tied list', () => {
    const m = scene({ a: START, b: START });
    const pick = (draw: number): string => keyOf(chooseBughouseAction(m, 0, 3000, () => draw));
    // (a constant stream gives every quiet central move the same score, so the finalists tie; the draws stay under the 0.9 of the dial so the scored branch is the one taken)
    expect([pick(0), pick(0.5), pick(0.89)]).toEqual(['c2c3', 'd2d3', 'e2e3']);
  });

  it('with the pocket of the OPPONENT empty the mating-drop probe costs nothing; with a piece in it every finalist is probed (and a bait is not taken)', () => {
    const quiet = callsOf(scene({ a: START, b: START }), 0);
    expect([quiet.calls, quiet.probes]).toEqual([5, 0]);
    const withPocket = callsOf(scene({ a: START, b: START, pockets: { 1: { n: 1 } } }), 0);
    expect(withPocket.calls).toBe(5);
    expect(withPocket.probes).toBeGreaterThan(0);
    expect(withPocket.probes).toBeLessThanOrEqual(5 * 3); // at most three probes for each of the five finalists
    // the pocket that counts is the opponent's: a knight in the MOVER's own pocket makes no probe
    const own = callsOf(scene({ a: START, b: START, pockets: { 0: { n: 1 } } }), 0);
    expect(own.probes).toBe(0);
  });
});

describe('the weight of a mate, of a recapture and of a bait', () => {
  it('a queen is not worth a mate: the bait (Bxh7 wins a queen) is refused when it allows N@f2#', () => {
    const fen = 'k7/7q/8/8/4B3/8/6PP/6RK w - - 0 1'; // Bxh7 takes an undefended queen
    const trapped = scene({ a: fen, b: START, pockets: { 1: { n: 1 } } });
    expect(scores(scoreCandidates(trapped, 0, ZERO))['Bxh7']).toBeGreaterThan(13);
    expect(keyOf(chooseBughouseAction(trapped, 0, 3000, ZERO))).not.toBe('e4h7');
    const free = scene({ a: fen, b: START });
    expect(keyOf(chooseBughouseAction(free, 0, 3000, ZERO))).toBe('e4h7');
  });

  it('a capture that loses the capturer to a recapture is not played: Nxe6 (a defended pawn) for the knight', () => {
    const m = scene({ a: '4k3/3p4/4p3/8/3N4/8/8/4K3 w - - 0 1', b: START });
    expect(scores(scoreCandidates(m, 0, ZERO))['Nxe6']).toBe(0.3);
    expect(keyOf(chooseBughouseAction(m, 0, 3000, ZERO))).toBe('d4f3'); // the best of the harmless moves
  });

  it('a mate in the notation that the engine does not confirm earns nothing from its ticket', () => {
    const m = scene({ a: '6k1/5ppp/8/8/8/8/q7/R2QK3 w - - 0 1', b: START });
    expect(scores(scoreCandidates(m, 0, ZERO))['Qd8#']).toBeGreaterThan(90);
    expect(keyOf(chooseBughouseAction(m, 0, 3000, ZERO))).toBe('a1a2'); // taking the queen wins more than a "mate" that is only check
  });
});

describe('the guards that no reachable position can trigger (each pinned as a property over real positions)', () => {
  it('every notation chess.js lists matches the pattern or is a castle; every one resolves to an action; a legal king move never lands on an attacked square; no move or drop changes the OPPONENT\'s pocket; a move or drop ends the match only by mate', { timeout: 120_000 }, () => {
    let positions = 0;
    let kingMoves = 0;
    let drops = 0;
    for (let seed = 1; seed <= 4; seed++) {
      runArena({
        seed: 8100 + seed,
        elos: [1200, 2400, 1700, 3000],
        maxCommits: 60,
        onDecision: (match, seat) => {
          const place = seat < 2 ? 'A' : 'B';
          const chess = openBoard(match.boards[place].fen) as Chess;
          if (match.verdicts[place].turn !== (seat % 2 === 0 ? 'w' : 'b')) return;
          positions++;
          const opponentColor = seat % 2 === 0 ? 'b' : 'w';
          const opponentSeat = (seat ^ 1) as 0 | 1 | 2 | 3;
          for (const san of chess.moves()) {
            if (!san.startsWith('O-O')) expect(/^([NBRQK])?[a-h]?[1-8]?(x)?([a-h][1-8])(?:=([QRBN]))?[+#]?$/.test(san), san).toBe(true);
            const played = chess.move(san);
            expect(played, san).toBeTruthy();
            if (played.piece === 'k' && !san.startsWith('O-O')) {
              kingMoves++;
              chess.undo();
              expect(chess.isAttacked(played.to, opponentColor), `king move ${san}`).toBe(false);
            } else chess.undo();
            const out = applyAction(match, seat, { kind: 'move', board: place, from: played.from, to: played.to, ...(played.promotion ? { promotion: played.promotion as 'q' } : {}) }, match.nowMs);
            if (out.ok) {
              expect(out.match.pockets[opponentSeat]).toEqual(match.pockets[opponentSeat]);
              if (out.match.result !== null) expect('winnerTeam' in out.match.result && out.match.result.reason === 'checkmate').toBe(true);
            }
          }
          // the same for every drop of the seat: it spends the seat's OWN pocket only and ends the match only by mate
          for (const option of legalDropOptions(chess, crazyhouseOfBoard(match, place))) {
            drops++;
            const out = applyAction(match, seat, { kind: 'drop', board: place, piece: option.piece, square: option.square }, match.nowMs);
            if (!out.ok) continue;
            expect(out.match.pockets[opponentSeat]).toEqual(match.pockets[opponentSeat]);
            if (out.match.result !== null) expect('winnerTeam' in out.match.result && out.match.result.reason === 'checkmate').toBe(true);
          }
        },
      });
    }
    expect(positions).toBeGreaterThan(100);
    expect(kingMoves).toBeGreaterThan(100);
    expect(drops).toBeGreaterThan(100);
  });

  it('a position always has both kings (the bot\'s "no king" branches are for a position chess.js refuses)', () => {
    expect(openBoard('8/8/8/8/8/8/8/4K3 w - - 0 1')).toBeNull();
    expect(openBoard('4k3/8/8/8/8/8/8/8 w - - 0 1')).toBeNull();
  });

  it('a seat for which the engine says it cannot act has no first legal action either, and a seat that can act has one', () => {
    const stuck = scene({ a: 'R6k/6pp/8/8/8/8/8/K7 b - - 0 1', b: START });
    expect(firstLegalAction(stuck, 1)).toBeNull();
    expect(chooseBughouseAction(stuck, 1, 3000, ZERO)).toBeNull();
    expect(firstLegalAction(scene({ a: START, b: START }), 0)).not.toBeNull();
  });

  it('a seat that is not on move, or in a finished match, chooses nothing - in the random branch too, which does not go through the engine', () => {
    const m = scene({ a: START, b: START });
    for (const elo of [400, 3000]) {
      expect(chooseBughouseAction(m, 1, elo, () => 0.999), `seat 1 is not on move at elo ${elo}`).toBeNull();
      expect(chooseBughouseAction(m, 3, elo, () => 0.999), `seat 3 is not on move at elo ${elo}`).toBeNull();
    }
    const over = voidMatch(m, m.nowMs) as BughouseMatch;
    expect(over.result).not.toBeNull();
    for (const elo of [400, 3000]) expect(chooseBughouseAction(over, 0, elo, () => 0.999), `a finished match at elo ${elo}`).toBeNull();
  });

  it('a seat with moves but no drops, and one with drops but no moves, both choose (the random branch has a pool whenever the seat can act)', () => {
    const stalemate = scene({ a: START, b: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', pockets: { 3: { n: 1 } } });
    const drop = chooseBughouseAction(stalemate, 3, 400, () => 0.999);
    expect(drop?.kind).toBe('drop');
    expect(chooseBughouseAction(scene({ a: START, b: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' }), 3, 400, () => 0.999)).toBeNull();
  });

  it('a promotion on board B is played on board B', () => {
    const m = scene({ a: START, b: '7k/P7/8/8/8/8/8/K7 w - - 0 1' });
    expect(chooseBughouseAction(m, 2, 3000, ZERO)).toEqual({ kind: 'move', board: 'B', from: 'a7', to: 'a8', promotion: 'q' });
    expect(firstLegalAction(m, 2)).toEqual({ kind: 'move', board: 'B', from: 'a7', to: 'a8', promotion: 'n' });
  });

  it('the action of a seat on board B names board B', () => {
    const m = scene({ a: START, b: START });
    expect((chooseBughouseAction(m, 2, 3000, ZERO) as BughouseAction & { board: string }).board).toBe('B');
    expect((firstLegalAction(m, 2) as BughouseAction & { board: string }).board).toBe('B');
    expect((chooseBughouseAction(m, 2, 400, script(0.99, 0.5, 0.5)) as BughouseAction & { board: string }).board).toBe('B');
  });

  it('a promotion survives the notation round trip', () => {
    const m = scene({ a: '7k/P7/8/8/8/8/8/K7 w - - 0 1', b: START });
    expect(keyOf(chooseBughouseAction(m, 0, 3000, ZERO))).toBe('a7a8q');
    expect(keyOf(firstLegalAction(m, 0))).toBe('a7a8n'); // (the first of chess.js's list: its promotions come knight first) - the piece survives the round trip
  });
});
