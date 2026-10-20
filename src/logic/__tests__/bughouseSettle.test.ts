import { describe, expect, it } from 'vitest';
import { deadlineOf, dueFlag, flagLoser, settle, type BughouseMatch, type RunningClock } from '../bughouse';
import { drop, move, play, scene, START } from './bughouseScenes';

/**
 * settle(): the flag settlement of BUGHOUSE_SPEC.md rule 25 / HP2, every boundary with LITERALS (nothing here reads a constant from the module under test). The match starts at 1,000 ms
 * on a 1-minute control (60,000 ms, no increment) unless a test says otherwise, so the first deadlines are 61,000.
 */
const ONE_MINUTE = { initialMs: 60000, incrementMs: 0 };
const fresh = (roomNumber = 0) => scene({ timeControl: ONE_MINUTE, roomNumber, startMs: 1000 });
const mateInOne = 'k7/2K5/8/8/8/8/8/1Q6 w - - 0 1'; // Qb1-b7 is a REAL mate: an adjacent protected queen cannot be blocked (Rh8 against Ka8 would only be stuck, rule 18)

describe('the first deadlines', () => {
  it('both White clocks run from the start with no first-move grace, the Black clocks wait', () => {
    const m = fresh();
    expect(m.clocks.map((c) => c.runningSince)).toEqual([1000, null, 1000, null]);
    expect(m.clocks.map(deadlineOf)).toEqual([61000, null, 61000, null]);
    expect(m.clocks.map((c) => c.startSeq)).toEqual([0, 0, 0, 0]);
    expect(m.seq).toBe(0);
    expect(m.nowMs).toBe(1000);
  });
});

describe('d versus now', () => {
  it('d == now + 1: not due - the action is applied and the mover keeps 1 ms', () => {
    const m = fresh();
    const outcome = settle(m, { seat: 0, action: move('A', 'e2', 'e4') }, 60999);
    expect(outcome.kind).toBe('applied');
    if (outcome.kind === 'applied') expect(outcome.match.clocks[0].remainingMs).toBe(1);
  });

  it('d == now: due - the flag wins, the action is discarded (the loser is decided by the tie-break: both White clocks fall at 61,000)', () => {
    const m = fresh(0);
    const input = { seat: 0 as const, action: move('A', 'e2', 'e4') };
    const outcome = settle(m, input, 61000);
    expect(outcome.kind).toBe('flag');
    if (outcome.kind !== 'flag') return;
    expect(outcome.discarded).toBe(input);
    expect(outcome.match.boards).toBe(m.boards); // the discarded move changed nothing on the board
    expect(outcome.match.pockets).toBe(m.pockets);
    expect(outcome.match.result).toEqual({ winnerTeam: 2, reason: 'flag', board: 'A', loserSeat: 0 }); // room 0: board A loses the tie
    expect(outcome.match.seq).toBe(1);
    expect(outcome.events).toEqual([{ kind: 'result', seq: 1, result: outcome.match.result }]);
  });

  it('d == now - 1: due as well (the instant has passed), and a timer (null input) settles it too', () => {
    const m = fresh(0);
    const outcome = settle(m, null, 61001);
    expect(outcome.kind).toBe('flag');
    if (outcome.kind === 'flag') {
      expect(outcome.discarded).toBeNull();
      expect(outcome.match.result).toMatchObject({ reason: 'flag', loserSeat: 0 });
    }
  });

  it('a timer that fires before anything is due is idle: the very same match', () => {
    const m = fresh();
    const outcome = settle(m, null, 60999);
    expect(outcome.kind).toBe('idle');
    if (outcome.kind === 'idle') expect(outcome.match).toBe(m);
  });

  it('a resignation arriving at the loser\'s own deadline is discarded: the flag wins', () => {
    const m = fresh(0);
    const outcome = settle(m, { seat: 1, action: { kind: 'resign' } }, 61000);
    expect(outcome.kind).toBe('flag');
    if (outcome.kind === 'flag') expect(outcome.match.result).toMatchObject({ reason: 'flag', winnerTeam: 2, loserSeat: 0 });
  });
});

describe('two flags', () => {
  // seat 0 (A White, team 1) and seat 3 (B Black, team 1) running with deadlines 5,000 and 5,001
  const apart = (d0: number, d3: number) =>
    scene({ a: START, b: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1', timeControl: ONE_MINUTE, startMs: 0, clocks: { 0: { remainingMs: d0, runningSince: 0 }, 2: { runningSince: null }, 3: { remainingMs: d3, runningSince: 0 } } });

  it('1 ms apart, both due: the EARLIER deadline loses (seat 0 at 5,000), whichever is listed first', () => {
    const m = apart(5000, 5001);
    expect(m.clocks.map(deadlineOf)).toEqual([5000, null, null, 5001]);
    const outcome = settle(m, null, 5001);
    expect(outcome.kind).toBe('flag');
    if (outcome.kind === 'flag') expect(outcome.match.result).toMatchObject({ loserSeat: 0, board: 'A', winnerTeam: 2 });
  });

  it('the same with the deadlines swapped: seat 3 (5,000) loses', () => {
    const m = apart(5001, 5000);
    const outcome = settle(m, null, 5001);
    expect(outcome.kind).toBe('flag');
    if (outcome.kind === 'flag') expect(outcome.match.result).toMatchObject({ loserSeat: 3, board: 'B', winnerTeam: 2 });
  });

  it('only the earlier one is due at 5,000: it loses alone, and the other clock stops at the instant the first flag fell', () => {
    const m = apart(5000, 5001);
    const outcome = settle(m, null, 5000);
    expect(outcome.kind).toBe('flag');
    if (outcome.kind !== 'flag') return;
    expect(outcome.match.clocks.map((c) => c.runningSince)).toEqual([null, null, null, null]);
    expect(outcome.match.clocks[0].remainingMs).toBe(0);
    expect(outcome.match.clocks[3].remainingMs).toBe(1); // 5,001 - 5,000
  });

  it('a late callback cannot change the order: both are due long after, the earlier deadline still loses and the other clock is frozen at that deadline, not at "now"', () => {
    const m = apart(4000, 5000);
    const outcome = settle(m, null, 9000);
    expect(outcome.kind).toBe('flag');
    if (outcome.kind !== 'flag') return;
    expect(outcome.match.result).toMatchObject({ loserSeat: 0 });
    expect(outcome.match.clocks[3].remainingMs).toBe(1000); // 5,000 - 4,000
    expect(outcome.match.nowMs).toBe(9000);
  });
});

describe('an exact tie, both levels of the tie-break (HP2)', () => {
  // seat 1 (A Black) and seat 2 (B White) running, equal deadlines 7,000
  const tied = (startSeq1: number, startSeq2: number, roomNumber: number) =>
    scene({
      a: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1',
      b: START,
      timeControl: ONE_MINUTE,
      startMs: 0,
      roomNumber,
      seq: 9,
      clocks: { 0: { runningSince: null }, 1: { remainingMs: 7000, runningSince: 0, startSeq: startSeq1 }, 2: { remainingMs: 7000, runningSince: 0, startSeq: startSeq2 }, 3: { runningSince: null } },
    });
  const loser = (m: BughouseMatch) => {
    const outcome = settle(m, null, 7000);
    if (outcome.kind !== 'flag' || outcome.match.result === null || 'voided' in outcome.match.result) throw new Error('expected a flag');
    return outcome.match.result.loserSeat;
  };

  it('level 1: the clock that started at the LOWER seq loses, whatever the room number', () => {
    for (const room of [0, 1, 2, 7, 998, 999]) {
      expect(loser(tied(3, 8, room)), `room ${room}`).toBe(1);
      expect(loser(tied(8, 3, room)), `room ${room}`).toBe(2);
    }
  });

  it('level 2: equal start seq - an EVEN room number makes board A lose, an ODD one board B', () => {
    for (const room of [0, 2, 4, 1000]) expect(loser(tied(5, 5, room)), `room ${room}`).toBe(1); // seat 1 sits on board A
    for (const room of [1, 3, 5, 999]) expect(loser(tied(5, 5, room)), `room ${room}`).toBe(2); // seat 2 sits on board B
  });

  it('flagLoser is the same rule on its own: deadline, then start seq, then room parity', () => {
    const a: RunningClock = { seat: 0, board: 'A', deadline: 100, startSeq: 4 };
    const b: RunningClock = { seat: 2, board: 'B', deadline: 100, startSeq: 4 };
    expect(flagLoser(a, b, 0)).toBe(a);
    expect(flagLoser(b, a, 0)).toBe(a);
    expect(flagLoser(a, b, 1)).toBe(b);
    expect(flagLoser(b, a, 1)).toBe(b);
    expect(flagLoser({ ...a, deadline: 99 }, b, 1)).toMatchObject({ seat: 0 });
    expect(flagLoser({ ...a, startSeq: 5 }, b, 0)).toBe(b);
  });

  it('dueFlag names the same loser without changing anything', () => {
    const m = tied(3, 8, 0);
    expect(dueFlag(m, 6999)).toBeNull();
    expect(dueFlag(m, 7000)).toMatchObject({ seat: 1, deadline: 7000, startSeq: 3 });
  });
});

describe('a flag against a checkmate (B8)', () => {
  // board A: White (seat 0) to move and mates with Rh8; board B: White (seat 2) to move. Deadlines are set by the clocks, in ms.
  const racing = (d0: number, d2: number) => scene({ a: mateInOne, b: START, timeControl: ONE_MINUTE, startMs: 0, roomNumber: 0, clocks: { 0: { remainingMs: d0 }, 2: { remainingMs: d2 } } });
  const mate = { seat: 0 as const, action: move('A', 'b1', 'b7') };

  it('the mate is taken one millisecond BEFORE the other board\'s flag: the mate wins', () => {
    const outcome = settle(racing(50000, 10000), mate, 9999);
    expect(outcome.kind).toBe('applied');
    if (outcome.kind === 'applied') expect(outcome.match.result).toEqual({ winnerTeam: 1, reason: 'checkmate', board: 'A', loserSeat: 1 });
  });

  it('the mate is taken AT the flag\'s deadline: the flag is due first and wins; the mating move is discarded', () => {
    const outcome = settle(racing(50000, 10000), mate, 10000);
    expect(outcome.kind).toBe('flag');
    if (outcome.kind === 'flag') {
      expect(outcome.match.result).toEqual({ winnerTeam: 1, reason: 'flag', board: 'B', loserSeat: 2 }); // seat 2 is team 2: team 1 wins either way here, the REASON differs
      expect(outcome.discarded).toBe(mate); // the mating move is reported as discarded, not played
      expect(outcome.match.boards).toEqual(racing(50000, 10000).boards);
    }
  });

  it('the mate is taken one millisecond AFTER the flag\'s deadline: the flag wins', () => {
    const outcome = settle(racing(50000, 10000), mate, 10001);
    expect(outcome.kind).toBe('flag');
    if (outcome.kind === 'flag') expect(outcome.match.result).toMatchObject({ reason: 'flag', loserSeat: 2 });
  });

  it('the MATING player\'s own flag at that instant: the mover loses, the mate is discarded (the other team wins)', () => {
    const outcome = settle(racing(10000, 50000), mate, 10000);
    expect(outcome.kind).toBe('flag');
    if (outcome.kind === 'flag') expect(outcome.match.result).toEqual({ winnerTeam: 2, reason: 'flag', board: 'A', loserSeat: 0 });
  });

  it('flag first, mate second: the mate is refused because the match is over', () => {
    const m = racing(50000, 10000);
    const flagged = settle(m, null, 10000);
    expect(flagged.kind).toBe('flag');
    if (flagged.kind !== 'flag') return;
    const late = settle(flagged.match, mate, 10000);
    expect(late.kind).toBe('rejected');
    if (late.kind === 'rejected') expect(late.reason).toBe('over');
  });

  it('mate first, flag second: a timer after the mate changes nothing', () => {
    const m = racing(50000, 10000);
    const mated = settle(m, mate, 9000);
    expect(mated.kind).toBe('applied');
    if (mated.kind !== 'applied') return;
    const after = settle(mated.match, null, 20000);
    expect(after.kind).toBe('idle');
    if (after.kind === 'idle') expect(after.match).toBe(mated.match);
  });
});

describe('what a commit does to the clocks', () => {
  it('the mover is charged and the opponent on THAT board starts at the new seq; the other board is untouched', () => {
    const m = play(fresh(), 0, move('A', 'e2', 'e4'), 3000);
    expect(m.seq).toBe(1);
    expect(m.clocks[0]).toEqual({ remainingMs: 58000, runningSince: null, startSeq: 0 });
    expect(m.clocks[1]).toEqual({ remainingMs: 60000, runningSince: 3000, startSeq: 1 });
    expect(m.clocks[2]).toEqual({ remainingMs: 60000, runningSince: 1000, startSeq: 0 }); // board B: nobody moved
    expect(m.clocks[3]).toEqual({ remainingMs: 60000, runningSince: null, startSeq: 0 });
  });

  it('the increment goes to the mover, after the move: 2 | 1 gives 1,000 ms back', () => {
    const m = scene({ timeControl: { initialMs: 120000, incrementMs: 1000 }, startMs: 0 });
    const next = play(m, 0, move('A', 'e2', 'e4'), 2500);
    expect(next.clocks[0].remainingMs).toBe(118500); // 120,000 - 2,500 + 1,000
    expect(next.clocks[1].remainingMs).toBe(120000); // the opponent has not been charged yet
  });

  it('a drop is charged and passes the turn exactly like a move', () => {
    const m = scene({ a: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', b: START, timeControl: ONE_MINUTE, startMs: 0, pockets: { 0: { n: 1 } } });
    const next = play(m, 0, drop('A', 'n', 'c3'), 4000);
    expect(next.clocks[0].remainingMs).toBe(56000);
    expect(next.clocks[1]).toEqual({ remainingMs: 60000, runningSince: 4000, startSeq: 1 });
    expect(next.pockets[0].n).toBe(0);
  });

  it('a mate stops every clock; the mover is charged (and gets the increment) up to the mating instant', () => {
    const m = scene({ a: mateInOne, b: START, timeControl: { initialMs: 60000, incrementMs: 2000 }, startMs: 0 });
    const next = play(m, 0, move('A', 'b1', 'b7'), 5000);
    expect(next.clocks.map((c) => c.runningSince)).toEqual([null, null, null, null]);
    expect(next.clocks[0].remainingMs).toBe(57000); // 60,000 - 5,000 + 2,000
    expect(next.clocks[2].remainingMs).toBe(55000); // board B's White clock ran until the mate: 60,000 - 5,000
  });

  it('a resignation stops every clock at that instant', () => {
    const m = fresh();
    const next = play(m, 3, { kind: 'resign' }, 8000);
    expect(next.clocks.map((c) => c.runningSince)).toEqual([null, null, null, null]);
    expect(next.clocks.map((c) => c.remainingMs)).toEqual([53000, 60000, 53000, 60000]);
    expect(next.result).toEqual({ winnerTeam: 2, reason: 'resign', board: 'B', loserSeat: 3 });
  });
});

describe('the instant itself', () => {
  it('a fractional, negative, NaN or backwards instant is refused with "time" and changes nothing', () => {
    const m = play(fresh(), 0, move('A', 'e2', 'e4'), 3000);
    for (const now of [3000.5, -1, Number.NaN, Number.POSITIVE_INFINITY, 2999]) {
      const outcome = settle(m, { seat: 1, action: move('A', 'e7', 'e5') }, now);
      expect(outcome.kind, String(now)).toBe('rejected');
      if (outcome.kind === 'rejected') {
        expect(outcome.reason, String(now)).toBe('time');
        expect(outcome.match).toBe(m);
      }
    }
    expect(settle(m, null, 2999).kind).toBe('rejected');
  });

  it('the same instant as the last commit is allowed (zero think time)', () => {
    const m = play(fresh(), 0, move('A', 'e2', 'e4'), 3000);
    expect(settle(m, { seat: 1, action: move('A', 'e7', 'e5') }, 3000).kind).toBe('applied');
  });

  it('once the match is over every input is refused with "over" and a timer is idle', () => {
    const m = play(fresh(), 0, { kind: 'resign' }, 2000);
    expect(settle(m, { seat: 1, action: move('A', 'e7', 'e5') }, 2001)).toMatchObject({ kind: 'rejected', reason: 'over' });
    expect(settle(m, null, 99999999)).toMatchObject({ kind: 'idle' });
  });
});
