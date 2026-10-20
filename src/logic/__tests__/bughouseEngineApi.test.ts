import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  boardCrazyhouse,
  clockOfSeat,
  createMatch,
  deserializeMatch,
  fenOf,
  isSeat,
  judgeBoard,
  legalActions,
  legalDropsOn,
  legalMovesOn,
  playDrop,
  pocketOfSeat,
  resolvePremove,
  serializeMatch,
  voidMatch,
  type BughouseMatch,
  type BughouseSeat,
} from '../bughouse';
import { drop, move, play, scene, START } from './bughouseScenes';
import { feed, mulberry32, newPair, nextStep } from './bughouseTestKit';

/**
 * The match API on its own: what creating a match refuses, what the lookups hand out (copies), what a finished match offers, the refusals of `applyAction` called directly (the funnel
 * `settle` checks some of them first, so these are the only tests that reach the engine's own), and the places where a hand-built state can differ from a reachable one. Every test here
 * exists because a mutant of the engine survived without it (scripts/mutation/configs/bughouse-w1-engine.config.cjs); constants are literals.
 */
const TC = { initialMs: 60000, incrementMs: 0 };

describe('createMatch refuses what is not a match', () => {
  it('an empty or fractional time control, a fractional or negative room number, a fractional or negative start', () => {
    const ok = { timeControl: TC, roomNumber: 3, startMs: 100 };
    expect(() => createMatch(ok)).not.toThrow();
    expect(() => createMatch({ ...ok, timeControl: { initialMs: 0, incrementMs: 0 } })).toThrow(RangeError);
    expect(() => createMatch({ ...ok, timeControl: { initialMs: 60000.5, incrementMs: 0 } })).toThrow(RangeError);
    expect(() => createMatch({ ...ok, timeControl: { initialMs: 60000, incrementMs: -1 } })).toThrow(RangeError);
    expect(() => createMatch({ ...ok, timeControl: { initialMs: 60000, incrementMs: 0.5 } })).toThrow(RangeError);
    expect(() => createMatch({ ...ok, roomNumber: 1.5 })).toThrow(RangeError);
    expect(() => createMatch({ ...ok, roomNumber: -1 })).toThrow(RangeError);
    expect(() => createMatch({ ...ok, startMs: -1 })).toThrow(RangeError);
    expect(() => createMatch({ ...ok, startMs: 0.5 })).toThrow(RangeError);
    expect(() => createMatch({ ...ok, roomNumber: 0, startMs: 0 })).not.toThrow();
  });

  it('copies the time control it is given, and starts at seq 0, the start instant, with nothing decided', () => {
    const tc = { initialMs: 60000, incrementMs: 1000 };
    const m = createMatch({ timeControl: tc, roomNumber: 0, startMs: 777 });
    tc.initialMs = 1;
    expect(m.timeControl).toEqual({ initialMs: 60000, incrementMs: 1000 });
    expect(m.seq).toBe(0);
    expect(m.nowMs).toBe(777);
    expect(m.result).toBeNull();
  });

  it('every clock starts with the full time and nothing extra', () => {
    const m = createMatch({ timeControl: { initialMs: 60000, incrementMs: 2000 }, roomNumber: 0, startMs: 0 });
    expect(m.clocks.map((c) => c.remainingMs)).toEqual([60000, 60000, 60000, 60000]);
  });
});

describe('the lookups hand out copies', () => {
  it('pocketOfSeat and clockOfSeat return objects the caller may change without changing the match', () => {
    const m = scene({ a: START, b: START, pockets: { 1: { n: 2 } } });
    const pocket = pocketOfSeat(m, 1);
    pocket.n = 9;
    expect(m.pockets[1].n).toBe(2);
    const clock = clockOfSeat(m, 0);
    clock.remainingMs = 1;
    expect(m.clocks[0].remainingMs).toBe(180000);
  });

  it('boardCrazyhouse copies the pockets and the marks it is given', () => {
    const white = { p: 1, n: 0, b: 0, r: 0, q: 0 };
    const black = { p: 0, n: 1, b: 0, r: 0, q: 0 };
    const marks = ['a8'];
    const cz = boardCrazyhouse(marks, white, black);
    cz.reserve.w.p = 5;
    cz.reserve.b.n = 5;
    cz.promoted.push('h8');
    expect(white.p).toBe(1);
    expect(black.n).toBe(1);
    expect(marks).toEqual(['a8']);
  });
});

describe('a finished match offers nothing', () => {
  it('no moves, no drops, no actions after a resignation - and before it, a seat that is not on the move is offered nothing', () => {
    const m = scene({ a: START, b: START, pockets: { 0: { n: 1 } } });
    expect(legalMovesOn(m, 'A').length).toBe(20);
    expect(legalDropsOn(m, 'A').length).toBeGreaterThan(30);
    expect(legalActions(m, 0).moves.length).toBe(20);
    expect(legalActions(m, 1)).toEqual({ moves: [], drops: [] }); // Black waits on board A
    expect(legalActions(m, 3)).toEqual({ moves: [], drops: [] }); // and on board B
    const over = play(m, 2, { kind: 'resign' }, 2000);
    for (const board of ['A', 'B'] as const) {
      expect(legalMovesOn(over, board)).toEqual([]);
      expect(legalDropsOn(over, board)).toEqual([]);
    }
    for (const seat of [0, 1, 2, 3] as const) expect(legalActions(over, seat)).toEqual({ moves: [], drops: [] });
  });

  it('legalActions of a seat lists ITS board, not the other (a position that differs on the two boards)', () => {
    const m = scene({ a: START, b: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' });
    expect(legalActions(m, 0).moves.length).toBe(20);
    expect(legalActions(m, 2).moves.length).toBe(5);
  });
});

describe('applyAction called directly (the engine\'s own checks)', () => {
  const m = scene({ a: START, b: START, timeControl: TC, startMs: 1000 });
  const e4 = move('A', 'e2', 'e4');

  it('after the end: "over"', () => {
    const over = play(m, 0, { kind: 'resign' }, 2000);
    expect(applyAction(over, 1, move('A', 'e7', 'e5'), 3000)).toEqual({ ok: false, reason: 'over' });
    expect(applyAction(over, 1, { kind: 'resign' }, 3000)).toEqual({ ok: false, reason: 'over' });
  });

  it('an instant that is fractional, negative, NaN or earlier than the last one: "time"', () => {
    for (const now of [1500.5, -1, Number.NaN, 999]) expect(applyAction(m, 0, e4, now), String(now)).toEqual({ ok: false, reason: 'time' });
    expect(applyAction(m, 0, e4, 1000).ok).toBe(true); // the same instant is fine
  });

  it('a seat that does not exist: "malformed" - 4, -1, 1.5, NaN, a string, undefined', () => {
    for (const seat of [4, -1, 1.5, Number.NaN, '0', undefined, null]) expect(applyAction(m, seat as any, { kind: 'resign' }, 2000), String(seat)).toEqual({ ok: false, reason: 'malformed' });
    expect(isSeat(0) && isSeat(3)).toBe(true);
    expect([4, -1, 1.5, '1', null].some((v) => isSeat(v))).toBe(false);
  });

  it('a piece type the pocket has no slot for, or a drop square that is not a square: "malformed"', () => {
    for (const piece of ['k', 'x', '', 'Q', undefined]) expect(applyAction(m, 0, { kind: 'drop', board: 'A', piece: piece as any, square: 'e4' }, 2000), String(piece)).toEqual({ ok: false, reason: 'malformed' });
    for (const square of ['z9', 'e0', 'e9', 'i1', 'E4', '', 'e44']) expect(applyAction(m, 0, { kind: 'drop', board: 'A', piece: 'n', square }, 2000), square).toEqual({ ok: false, reason: 'malformed' });
    for (const [from, to] of [['e2', 'e9'], ['E2', 'e4'], ['e2', ''], ['', 'e4'], ['e22', 'e4']]) expect(applyAction(m, 0, { kind: 'move', board: 'A', from, to }, 2000), `${from}${to}`).toEqual({ ok: false, reason: 'malformed' });
  });

  it('a promotion field that is not q, r, b or n: "malformed" (a king, a pawn, two letters, an empty string)', () => {
    const p = scene({ a: '4k3/1P6/8/8/8/8/8/4K3 w - - 0 1', b: START });
    for (const promotion of ['k', 'p', 'qq', '', 'Q']) expect(applyAction(p, 0, { kind: 'move', board: 'A', from: 'b7', to: 'b8', promotion: promotion as any }, 2000), promotion).toEqual({ ok: false, reason: 'malformed' });
    expect(applyAction(p, 0, { kind: 'move', board: 'A', from: 'b7', to: 'b8', promotion: 'n' }, 2000).ok).toBe(true);
  });

  it('a board that is not A or B: "malformed", not "wrongBoard"', () => {
    expect(applyAction(m, 0, { kind: 'move', board: 'C' as any, from: 'e2', to: 'e4' }, 2000)).toEqual({ ok: false, reason: 'malformed' });
    expect(applyAction(m, 0, { kind: 'drop', board: undefined as any, piece: 'n', square: 'e4' }, 2000)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('voidMatch refuses an earlier instant, a fractional one, and a match that is already over', () => {
    const later = play(m, 0, e4, 5000);
    expect(voidMatch(later, 4999)).toBeNull();
    expect(voidMatch(later, 5000.5)).toBeNull();
    expect(voidMatch(later, 5000)?.result).toEqual({ voided: true, reason: 'abandoned' });
    expect(voidMatch(later, 5000)?.seq).toBe(2);
    expect(voidMatch(play(later, 1, { kind: 'resign' }, 6000), 7000)).toBeNull();
  });
});

describe('a premove is matched by its origin AND its target', () => {
  it('a premove whose target is a legal destination of another piece is not legal', () => {
    const m = scene({ a: START, b: START });
    expect(resolvePremove(m, 0, { kind: 'move', from: 'd3', to: 'e4' })).toEqual({ ok: false, reason: 'noLongerLegal' }); // nothing on d3; e4 is reachable by the e-pawn
    expect(resolvePremove(m, 0, { kind: 'move', from: 'e2', to: 'e4' }).ok).toBe(true);
    expect(resolvePremove(m, 0, { kind: 'move', from: 'e2', to: 'e6' })).toEqual({ ok: false, reason: 'noLongerLegal' });
  });
});

describe('castling carries a promoted mark with its rook; the board keeps the en passant square', () => {
  // hand-built states that no game reaches (a marked rook still holding a castling right) - the engine\'s carry rule is what is tested
  it('king-side: a marked rook on h1 goes to f1, not g1, and the mark on h8 (a promoted queen on the OTHER rank) stays put', () => {
    const m = scene({ a: '4k2Q/8/8/8/8/8/8/4K2R w K - 0 1', b: START, promotedA: ['h1', 'h8'] });
    const next = play(m, 0, move('A', 'e1', 'g1'), 2000);
    expect(next.boards.A.promoted).toEqual(['f1', 'h8']);
  });

  it('queen-side: a marked rook on a1 goes to d1, not c1; and Black, castling on the 8th rank, carries its own a8 mark to d8', () => {
    const white = play(scene({ a: '4k3/8/8/8/8/8/8/R3K3 w Q - 0 1', b: START, promotedA: ['a1', 'a8'] }), 0, move('A', 'e1', 'c1'), 2000);
    expect(white.boards.A.promoted).toEqual(['a8', 'd1']);
    const black = play(scene({ a: 'r3k3/8/8/8/8/8/8/4K3 b q - 0 1', b: START, promotedA: ['a1', 'a8'] }), 1, move('A', 'e8', 'c8'), 2100);
    expect(black.boards.A.promoted).toEqual(['a1', 'd8']);
  });

  it('the stored FEN keeps the en passant square chess.js printed only because the capture is possible: a PINNED capturer leaves chess.js\'s own text without it, the engine\'s keeps it', () => {
    // White Ka5 and Pe5 on the 5th rank with Black\'s Rh5: after ...d7-d5, e5xd6 e.p. would take BOTH pawns off the rank and expose the king - pseudo-legal, not legal
    const m0 = scene({ a: '8/3p4/8/K3P2r/8/8/8/7k b - - 0 1', b: START });
    const m1 = play(m0, 1, move('A', 'd7', 'd5'), 2000);
    expect(m1.boards.A.fen.split(' ')[3]).toBe('d6');
    expect(new Chess(m1.boards.A.fen).fen().split(' ')[3]).toBe('-');
    expect(legalMovesOn(m1, 'A').map((x) => x.from + x.to)).not.toContain('e5d6');
    expect(fenOf(new Chess(m1.boards.A.fen))).toBe(m1.boards.A.fen);
  });

  it('an ordinary double step with nobody beside it writes no en passant square (chess.js records one only when a capture is geometrically possible)', () => {
    const m = play(scene({ a: START, b: START }), 0, move('A', 'e2', 'e4'), 2000);
    expect(m.boards.A.fen.split(' ')[3]).toBe('-');
  });

  it('a drop after a double step leaves no en passant square in the position', () => {
    const m0 = scene({ a: '4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1', b: START, pockets: { 0: { n: 1 } } });
    const m1 = play(m0, 1, move('A', 'd7', 'd5'), 2000);
    expect(m1.boards.A.fen.split(' ')[3]).toBe('d6');
    const m2 = play(m1, 0, drop('A', 'n', 'a2'), 2100);
    expect(m2.boards.A.fen.split(' ')[3]).toBe('-');
    expect(legalMovesOn(m2, 'A').map((x) => x.from + x.to)).not.toContain('e5d6');
  });
});

describe('playDrop', () => {
  it('turns a legal drop into the next position: the turn passes, the halfmove clock is 0, the fullmove number moves after Black only', () => {
    const white = new Chess('4k3/8/8/8/8/8/8/4K3 w - - 7 12');
    expect(playDrop(white, 'n', 'c3')).toBe(true);
    expect(white.fen()).toBe('4k3/8/8/8/8/2N5/8/4K3 b - - 0 12');
    const black = new Chess('4k3/8/8/8/8/8/8/4K3 b - - 7 12');
    expect(playDrop(black, 'n', 'c6')).toBe(true);
    expect(black.fen()).toBe('4k3/8/2n5/8/8/8/8/4K3 w - - 0 13');
  });

  it('a double-stepped pawn\'s en passant square is gone after a drop', () => {
    const c = new Chess('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2');
    expect(c.fen().split(' ')[3]).toBe('d6');
    expect(playDrop(c, 'n', 'a1')).toBe(true);
    expect(c.fen().split(' ')[3]).toBe('-');
  });

  // THE PROOFS THAT KEEP THREE MUTANTS EQUIVALENT (bughouse-w1-engine.config.cjs):
  //  - "a drop keeps the en passant square": chess.js's own put() already clears the en passant square, so playDrop's explicit '-' is redundant. This test pins the fact the line relies on:
  //    if a chess.js upgrade stopped clearing it, this fails and the explicit line starts to matter.
  it('chess.js clears the en passant square when a piece is put on the board (the explicit "-" in playDrop is belt and braces)', () => {
    for (const [fen, piece, square] of [['4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2', 'n', 'a1'], ['4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 2', 'n', 'a8']] as const) {
      const c = new Chess(fen);
      expect(c.fen().split(' ')[3]).not.toBe('-');
      expect(c.put({ type: piece, color: c.turn() }, square)).toBe(true);
      expect(c.fen().split(' ')[3], fen).toBe('-');
    }
  });

  //  - "a rejected FEN after a drop is treated as played": chess.js never refuses the position a LEGAL drop produces. Pinned over the legal drops of the positions of seeded matches.
  it('playDrop accepts every legal drop of every position of 40 seeded matches (so its two refusals are unreachable for a legal drop)', () => {
    let tried = 0;
    for (let i = 0; i < 40; i++) {
      const seed = 52000 + i * 29;
      const pair = newPair(seed);
      const rng = mulberry32(seed);
      for (let step = 0; step < 60 && pair.engine.result === null; step++) {
        feed(pair, nextStep(rng, pair.engine, pair.model));
        if (step % 6 !== 0) continue;
        for (const board of ['A', 'B'] as const) {
          for (const d of legalDropsOn(pair.engine, board)) {
            const c = new Chess(pair.engine.boards[board].fen);
            expect(playDrop(c, d.piece, d.square), `${pair.engine.boards[board].fen} ${d.piece}@${d.square}`).toBe(true);
            tried++;
          }
        }
      }
    }
    expect(tried).toBeGreaterThan(2000);
  });

  it('refuses a placement chess.js refuses: a second king cannot be put (a piece type outside the pocket\'s five never reaches here)', () => {
    const c = new Chess('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    expect(playDrop(c, 'k' as any, 'a1')).toBe(false);
    expect(c.fen()).toBe('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  });

  it('judgeBoard of the side to move does not depend on the OTHER side\'s pocket (why recomputing a verdict with last turn\'s pockets changes nothing)', () => {
    const fens = ['4k3/8/8/8/8/8/8/r3K3 w - - 0 1', 'k7/8/8/8/8/8/6PP/r6K w - - 0 1', '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', START, '4k3/8/8/8/8/3n4/8/4K3 w - - 0 1'];
    const stocks = [{ p: 0, n: 0, b: 0, r: 0, q: 0 }, { p: 1, n: 1, b: 1, r: 1, q: 1 }, { p: 3, n: 0, b: 2, r: 0, q: 1 }];
    for (const fen of fens) {
      const turn = new Chess(fen).turn();
      for (const mine of stocks) {
        const reference = judgeBoard(new Chess(fen), turn === 'w' ? boardCrazyhouse([], mine, stocks[0]) : boardCrazyhouse([], stocks[0], mine));
        for (const theirs of stocks) {
          const other = judgeBoard(new Chess(fen), turn === 'w' ? boardCrazyhouse([], mine, theirs) : boardCrazyhouse([], theirs, mine));
          expect(other, `${fen} ${JSON.stringify([mine, theirs])}`).toEqual(reference);
        }
      }
    }
  });
});

describe('snapshot details the hostile-text tests could not reach', () => {
  const good = JSON.parse(serializeMatch(play(scene({ a: START, b: START }), 0, move('A', 'e2', 'e4'), 2000)));
  // scenes hold the right number of pieces here (the standard position), so this one is a reachable match
  it('a pocket count that is not a whole number is refused', () => {
    const copy = JSON.parse(JSON.stringify(good));
    copy.pockets[0].p = 1.5;
    expect(deserializeMatch(JSON.stringify(copy))).toEqual({ ok: false, error: 'bad pocket or clock' });
  });

  it('the order of the keys inside a pocket does not matter on the way in, and the text that comes out is the canonical one (so a parsed pocket is never the input\'s own object)', () => {
    const shuffled = JSON.parse(JSON.stringify(good));
    shuffled.pockets = shuffled.pockets.map((p: any) => ({ q: p.q, r: p.r, b: p.b, n: p.n, p: p.p }));
    const back = deserializeMatch(JSON.stringify(shuffled));
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(Object.keys(back.match.pockets[0])).toEqual(['p', 'n', 'b', 'r', 'q']);
      expect(serializeMatch(back.match)).toBe(serializeMatch(play(scene({ a: START, b: START }), 0, move('A', 'e2', 'e4'), 2000)));
    }
  });
});

describe('a hand-built state is the only way to see these (documented)', () => {
  it('createMatch + seq is the number of commits: a scene with seq set keeps it', () => {
    const m: BughouseMatch = scene({ a: START, b: START, seq: 9 });
    expect(m.seq).toBe(9);
    expect(play(m, 0, move('A', 'e2', 'e4'), 2000).seq).toBe(10);
    const seat: BughouseSeat = 0;
    expect(seat).toBe(0);
  });
});
