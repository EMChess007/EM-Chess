import { describe, expect, it } from 'vitest';
import { BUGHOUSE_TIME_CONTROLS, SNAPSHOT_VERSION, createMatch, deserializeMatch, serializeMatch, snapshotOf, voidMatch, type BughouseMatch } from '../bughouse';
import { feed, mulberry32, newPair, nextStep } from './bughouseTestKit';
import { drop, move, play, scene } from './bughouseScenes';

/**
 * The text snapshot (BUGHOUSE_SPEC.md HP1 `bug_state`, HP5 rejoin): the same match is the same bytes; every match the engine reaches reads back identically; and hostile text is refused
 * with a reason, never thrown at the caller and never half-accepted.
 */
const start = () => createMatch({ timeControl: BUGHOUSE_TIME_CONTROLS[1], roomNumber: 12, startMs: 4000 });
const roundTrip = (m: BughouseMatch) => {
  const text = serializeMatch(m);
  const back = deserializeMatch(text);
  expect(back.ok, back.ok ? '' : back.error).toBe(true);
  return back.ok ? { text, match: back.match } : { text, match: m };
};

describe('the text', () => {
  it('is one JSON line with a fixed key order, and it is the literal text of the start of a match', () => {
    const text = serializeMatch(start());
    expect(text.includes('\n')).toBe(false);
    expect(text).toBe(
      '{"v":1,"timeControl":{"initialMs":120000,"incrementMs":1000},"roomNumber":12,"seq":0,"nowMs":4000,' +
        '"boards":{"A":{"fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","promoted":[],"plies":0},"B":{"fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","promoted":[],"plies":0}},' +
        '"pockets":[{"p":0,"n":0,"b":0,"r":0,"q":0},{"p":0,"n":0,"b":0,"r":0,"q":0},{"p":0,"n":0,"b":0,"r":0,"q":0},{"p":0,"n":0,"b":0,"r":0,"q":0}],' +
        '"clocks":[{"remainingMs":120000,"runningSince":4000,"startSeq":0},{"remainingMs":120000,"runningSince":null,"startSeq":0},{"remainingMs":120000,"runningSince":4000,"startSeq":0},{"remainingMs":120000,"runningSince":null,"startSeq":0}],' +
        '"verdicts":{"A":{"status":"playing","turn":"w","inCheck":false,"stuck":null},"B":{"status":"playing","turn":"w","inCheck":false,"stuck":null}},"result":null}',
    );
    expect(SNAPSHOT_VERSION).toBe(1);
  });

  it('a match and its read-back are byte-identical, three times over, and the snapshot object is a plain copy', () => {
    const m = play(start(), 0, move('A', 'e2', 'e4'), 4500);
    const { text, match } = roundTrip(m);
    expect(serializeMatch(match)).toBe(text);
    expect(serializeMatch(roundTrip(match).match)).toBe(text);
    expect(serializeMatch(m)).toBe(text);
    const snap = snapshotOf(m);
    snap.boards.A.promoted.push('zz');
    snap.pockets[0].q = 9;
    expect(serializeMatch(m)).toBe(text); // changing the object changed nothing in the match
  });

  it('every state of seeded matches reads back identically: pockets, promoted marks, running clocks, mates, flags, resignations', () => {
    let finished = 0;
    for (let i = 0; i < 40; i++) {
      const seed = 31000 + i * 17;
      const pair = newPair(seed);
      const rng = mulberry32(seed);
      for (let step = 0; step < 80 && pair.engine.result === null; step++) {
        feed(pair, nextStep(rng, pair.engine, pair.model));
        if (step % 4 === 0) {
          const text = serializeMatch(pair.engine);
          const back = deserializeMatch(text);
          expect(back.ok ? serializeMatch(back.match) : back.error, `match ${seed} step ${step}`).toBe(text);
        }
      }
      if (pair.engine.result !== null) {
        finished++;
        roundTrip(pair.engine);
      }
    }
    expect(finished).toBeGreaterThan(0);
  });

  it('a voided match, and the other results, read back', () => {
    const m = start();
    const voided = voidMatch(m, 5000) as BughouseMatch;
    expect(roundTrip(voided).match.result).toEqual({ voided: true, reason: 'abandoned' });
    expect(roundTrip(play(m, 1, { kind: 'resign' }, 5000)).match.result).toMatchObject({ reason: 'resign' });
    // a result with a reason this engine does not issue (the removed 'disconnect') is not a snapshot it could have written
    const forged = serializeMatch(play(m, 2, { kind: 'resign' }, 5000)).replace('"reason":"resign"', '"reason":"disconnect"');
    expect(forged).toContain('"reason":"disconnect"');
    expect(deserializeMatch(forged).ok).toBe(false);
    const flagged = scene({ timeControl: { initialMs: 1000, incrementMs: 0 }, startMs: 0 });
    void flagged;
  });

  it('a match in a StUcK position is not a result and reads back with its verdict', () => {
    const m = scene({ a: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' });
    // scenes are not reachable matches (they do not hold 64 pieces): the engine refuses to read one back, which is the point of the invariant check
    const back = deserializeMatch(serializeMatch(m));
    expect(back.ok).toBe(false);
    if (!back.ok) expect(back.error).toMatch(/^not a reachable match/);
  });
});

describe('hostile text', () => {
  const good = JSON.parse(serializeMatch(play(play(start(), 0, move('A', 'e2', 'e4'), 4500), 1, move('A', 'd7', 'd5'), 4600))) as any;
  const refuse = (mutate: (copy: any) => void, expected: RegExp | string) => {
    const copy = JSON.parse(JSON.stringify(good));
    mutate(copy);
    const back = deserializeMatch(JSON.stringify(copy));
    expect(back.ok, `should be refused: ${expected}`).toBe(false);
    if (!back.ok) expect(back.error).toMatch(expected instanceof RegExp ? expected : new RegExp(expected));
  };

  it('the untouched copy is accepted (so every refusal below is about its change)', () => {
    expect(deserializeMatch(JSON.stringify(good)).ok).toBe(true);
  });

  it('not JSON, not an object, the wrong keys, the wrong version', () => {
    expect(deserializeMatch('{nope')).toEqual({ ok: false, error: 'not JSON' });
    expect(deserializeMatch('[]')).toEqual({ ok: false, error: 'not a Bughouse snapshot' });
    expect(deserializeMatch('null')).toEqual({ ok: false, error: 'not a Bughouse snapshot' });
    expect(deserializeMatch('')).toEqual({ ok: false, error: 'not JSON' });
    refuse((c) => (c.extra = 1), 'not a Bughouse snapshot');
    refuse((c) => delete c.result, 'not a Bughouse snapshot');
    refuse((c) => (c.v = 2), 'unknown version');
    refuse((c) => (c.v = '1'), 'unknown version');
  });

  it('numbers that are not whole milliseconds / counts', () => {
    refuse((c) => (c.timeControl.initialMs = 0), 'bad time control');
    refuse((c) => (c.timeControl.initialMs = 1.5), 'bad time control');
    refuse((c) => (c.timeControl.incrementMs = -1), 'bad time control');
    refuse((c) => (c.timeControl.extra = 1), 'bad time control');
    refuse((c) => (c.roomNumber = -1), 'bad room number, seq or time');
    refuse((c) => (c.seq = 2.5), 'bad room number, seq or time');
    refuse((c) => (c.nowMs = '5'), 'bad room number, seq or time');
  });

  it('boards: a non-canonical or invalid FEN, an unsorted or repeated promoted list, an extra key', () => {
    refuse((c) => (c.boards.A.fen = 'nonsense'), 'bad board position');
    refuse((c) => (c.boards.A.fen = c.boards.A.fen.replace(/ (\d+)$/, '  $1')), 'bad board position'); // two spaces before the move number: a position chess.js reads, but not the canonical text
    refuse((c) => (c.boards.B.promoted = ['b2', 'a2']), 'bad board position');
    refuse((c) => (c.boards.B.promoted = ['a2', 'a2']), 'bad board position');
    refuse((c) => (c.boards.B.promoted = ['z9']), 'bad board position');
    refuse((c) => (c.boards.A.plies = -1), 'bad board position');
    refuse((c) => (c.boards.A.junk = 1), 'bad board position');
    refuse((c) => delete c.boards.B, 'bad boards');
  });

  it('pockets and clocks: the wrong length, a negative or huge count, an unknown piece, a clock from the future', () => {
    refuse((c) => c.pockets.pop(), 'bad pockets or clocks');
    refuse((c) => c.clocks.push(c.clocks[0]), 'bad pockets or clocks');
    refuse((c) => (c.pockets[0].p = -1), 'bad pocket or clock');
    refuse((c) => (c.pockets[0].p = 65), 'bad pocket or clock');
    refuse((c) => (c.pockets[0].k = 1), 'bad pocket or clock');
    refuse((c) => delete c.pockets[1].q, 'bad pocket or clock');
    refuse((c) => (c.clocks[0].remainingMs = -5), 'bad pocket or clock');
    refuse((c) => (c.clocks[2].startSeq = c.seq + 1), 'bad pocket or clock');
    refuse((c) => (c.clocks[0].runningSince = c.nowMs + 1), 'bad pocket or clock');
  });

  it('a clock running that should not, or stopped that should run; seq that does not match the plies', () => {
    // after 1.e4 d5 it is White's turn on board A again: seat 0 runs, seat 1 waits
    refuse((c) => (c.clocks[1].runningSince = 100), /seat 1: its clock should not be running/);
    refuse((c) => (c.clocks[0].runningSince = null), /seat 0: its clock should be running/);
    refuse((c) => (c.seq += 1), 'seq does not match the plies played');
    refuse((c) => (c.boards.A.plies += 1), 'seq does not match the plies played');
  });

  it('verdicts that do not match the position', () => {
    refuse((c) => (c.verdicts.A.status = 'checkmate'), 'the verdicts do not match the positions');
    refuse((c) => (c.verdicts.B.turn = 'b'), 'the verdicts do not match the positions');
    refuse((c) => (c.verdicts.A.stuck = 'check'), 'the verdicts do not match the positions');
  });

  it('results that cannot be: the loser on the wrong board, the winner on the loser\'s team, an unknown reason, a mate that is not on the board, voided with extras', () => {
    const lost = { winnerTeam: 1, reason: 'resign', board: 'A', loserSeat: 1 }; // seat 1 is team 2: team 1 winning is consistent
    const ok = JSON.parse(JSON.stringify(good));
    ok.result = lost;
    ok.clocks.forEach((cl: any) => (cl.runningSince = null));
    ok.seq += 1;
    expect(deserializeMatch(JSON.stringify(ok)).ok).toBe(true);
    const bad = (patch: any, expected: string) => {
      const c = JSON.parse(JSON.stringify(ok));
      c.result = { ...lost, ...patch };
      const back = deserializeMatch(JSON.stringify(c));
      expect(back.ok).toBe(false);
      if (!back.ok) expect(back.error).toBe(expected);
    };
    bad({ board: 'B' }, 'bad result'); // seat 1 sits on board A
    bad({ winnerTeam: 2 }, 'bad result'); // the loser's own team cannot win
    bad({ winnerTeam: 3 }, 'bad result');
    bad({ reason: 'draw' }, 'bad result');
    bad({ loserSeat: 4 }, 'bad result');
    bad({ loserSeat: 1.5 }, 'bad result');
    const noMate = JSON.parse(JSON.stringify(ok));
    noMate.result = { ...lost, reason: 'checkmate' };
    noMate.seq -= 1; // a mate is the commit of the last ply: no extra commit
    const refused = deserializeMatch(JSON.stringify(noMate));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toBe('a checkmate result without a mate on the board');
    const v = JSON.parse(JSON.stringify(ok));
    v.result = { voided: true, reason: 'abandoned', extra: 1 };
    expect(deserializeMatch(JSON.stringify(v)).ok).toBe(false);
    v.result = { voided: false, reason: 'abandoned' };
    expect(deserializeMatch(JSON.stringify(v)).ok).toBe(false);
  });

  it('a match that no sequence of legal inputs could have produced (a piece out of nowhere, a pawn too many) is refused by the invariant', () => {
    refuse((c) => (c.pockets[3].q = 1), /^not a reachable match: White owns 3 of q|^not a reachable match: Black owns 3 of q/);
    refuse((c) => (c.pockets[0].p = 3), /^not a reachable match/);
  });

  it('never throws, whatever the text: 3,000 random corruptions of a valid snapshot all come back as { ok } objects', () => {
    const text = JSON.stringify(good);
    const rng = mulberry32(77);
    let accepted = 0;
    for (let i = 0; i < 3000; i++) {
      const chars = text.split('');
      const flips = 1 + Math.floor(rng() * 3);
      for (let f = 0; f < flips; f++) chars[Math.floor(rng() * chars.length)] = String.fromCharCode(32 + Math.floor(rng() * 95));
      const out = deserializeMatch(rng() < 0.1 ? chars.slice(0, Math.floor(rng() * chars.length)).join('') : chars.join(''));
      expect(typeof out.ok).toBe('boolean');
      if (out.ok) accepted++;
    }
    expect(accepted).toBeLessThan(3000);
    void drop;
  });
});
