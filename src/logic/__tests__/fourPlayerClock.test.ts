import { describe, expect, it } from 'vitest';
import {
  addIncrement,
  chooseBotMove,
  clockTick,
  createClock,
  findLegalMove,
  initialState,
  parseSquare,
  playMove,
  resign,
  stateFromPieces,
  type FourPlayerClock,
  type FourPlayerState,
  type GameEvent,
  type Seat,
} from '../fourPlayer';
import { clockForTimeControl } from '../useFourPlayerClock';

const RED = 0;
const BLUE = 1;
const YELLOW = 2;
const GREEN = 3;
const first = () => 0;

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const timeouts = (events: GameEvent[]) => events.filter((e) => e.kind === 'eliminated' && e.reason === 'timeout');
const withTurn = (state: FourPlayerState, turn: Seat): FourPlayerState => ({ ...state, turn });

describe('the four clocks', () => {
  it('start equal, one per seat', () => {
    const clock = createClock(300, 2, true);
    expect(clock.seconds).toEqual([300, 300, 300, 300]);
    expect(clock.incrementSeconds).toBe(2);
    expect(clock.enabled).toBe(true);
  });

  it('only the seat whose turn it is ticks — whichever seat that is', () => {
    const state = initialState();
    const clock = createClock(600, 0, true);
    expect(clockTick(state, clock, 5).clock.seconds).toEqual([595, 600, 600, 600]);
    for (const seat of [BLUE, YELLOW, GREEN] as Seat[]) {
      const seconds = clockTick(withTurn(state, seat), clock, 5).clock.seconds;
      expect(seconds.map((s, i) => (i === seat ? s : 600 - s))).toEqual([0, 0, 0, 0].map((_, i) => (i === seat ? 595 : 0)));
    }
  });

  it('time accumulates across ticks and never goes negative', () => {
    let clock = createClock(10, 0, true);
    const state = initialState();
    for (let i = 0; i < 4; i++) clock = clockTick(state, clock, 2.5).clock;
    expect(clock.seconds[RED]).toBe(0);
    expect(clockTick(stateFromPieces(['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7'], { turn: BLUE }), createClock(3, 0, true), 100).clock.seconds[BLUE]).toBe(0);
  });

  it('a disabled clock (No time limit) never ticks and nobody can time out', () => {
    const state = initialState();
    const clock = createClock(0, 0, false);
    const result = clockTick(state, clock, 99999);
    expect(result.clock).toBe(clock);
    expect(result.state).toBe(state);
    expect(result.events).toEqual([]);
    expect(addIncrement(clock, RED, state)).toBe(clock);
  });

  it('a seat that is out never loses time even if the turn pointer somehow rests on it', () => {
    const out = resign(initialState(), GREEN).state;
    const clock = createClock(600, 0, true);
    const result = clockTick(withTurn(out, GREEN), clock, 30);
    expect(result.clock).toBe(clock);
    expect(result.events).toEqual([]);
  });

  it('no time passes after the game is over', () => {
    const over = { ...initialState(), result: { winners: [RED as Seat], reason: 'cap' as const } };
    const clock = createClock(10, 0, true);
    expect(clockTick(over, clock, 5).clock).toBe(clock);
  });

  it('the increment goes to the seat that just moved — and only to an active one', () => {
    const state = initialState();
    const clock = createClock(60, 3, true);
    expect(addIncrement(clock, YELLOW, state).seconds).toEqual([60, 60, 63, 60]);
    const out = resign(state, GREEN).state;
    expect(addIncrement(clock, GREEN, out)).toBe(clock); // an eliminated seat's clock is never touched again
  });
});

describe('running out of time', () => {
  it('eliminates the seat through the engine\'s timeout path: no points, its pieces go dead, the turn passes on', () => {
    const state = initialState();
    const clock = { ...createClock(600, 0, true), seconds: [4, 600, 600, 600] };
    const tick = clockTick(state, clock, 5, first);
    expect(tick.clock.seconds[RED]).toBe(0);
    expect(timeouts(tick.events)).toEqual([expect.objectContaining({ kind: 'eliminated', seat: RED, reason: 'timeout', credit: null })]);
    expect(tick.state.status[RED]).toBe('dead-king');
    expect(tick.state.score).toEqual([0, 0, 0, 0]);
    expect(tick.state.turn).toBe(BLUE); // the turn passes on
    expect(tick.clock.seconds.slice(1)).toEqual([600, 600, 600]); // nobody else's clock was touched
  });

  it('flags at exactly zero, not a moment before', () => {
    const state = initialState();
    const almost = clockTick(state, { ...createClock(600, 0, true), seconds: [5.001, 600, 600, 600] }, 5, first);
    expect(almost.state.status[RED]).toBe('active');
    const exact = clockTick(state, { ...createClock(600, 0, true), seconds: [5, 600, 600, 600] }, 5, first);
    expect(exact.state.status[RED]).toBe('dead-king');
  });

  it('works for every seat, and the next seat that gets the turn is the next ACTIVE one', () => {
    const state = resign(initialState(), YELLOW).state; // Yellow already out
    const tick = clockTick(withTurn(state, BLUE), { ...createClock(600, 0, true), seconds: [600, 1, 600, 600] }, 2, first);
    expect(tick.state.status[BLUE]).toBe('dead-king');
    expect(tick.state.turn).toBe(GREEN); // Yellow is skipped
  });

  it('the third timeout ends the game; the highest score of all four wins', () => {
    const base = stateFromPieces(['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7'], { turn: GREEN, status: ['dead-king', 'active', 'dead-king', 'active'], score: [3, 9, 1, 2] });
    // Two seats left (Blue, Green); Green's flag falls -> only Blue active -> game over, Blue (highest) wins.
    const tick = clockTick(base, { ...createClock(600, 0, true), seconds: [600, 600, 600, 0.5] }, 1, first);
    expect(tick.state.result).toEqual({ winners: [BLUE], reason: 'elimination' });
    expect(tick.events[tick.events.length - 1].kind).toBe('gameOver');
  });
});

describe('an eliminated seat\'s clock stops for good', () => {
  const rounds = (state: FourPlayerState, clock: FourPlayerClock, count: number) => {
    // Ticks one second at a time through `count` full rounds, playing a first legal move whenever the engine hands over a turn.
    let s = state;
    let c = clock;
    for (let i = 0; i < count && !s.result; i++) {
      const tick = clockTick(s, c, 1, first);
      s = tick.state;
      c = tick.clock;
      if (s.result) break;
      const move = chooseBotMove(s, 400, () => 0.99) ?? null; // an arbitrary legal move (random branch)
      if (move) s = playMove(s, move, first).state;
    }
    return { state: s, clock: c };
  };

  it('after a timeout the seat\'s time stays exactly where it was, through dead-king walks and any number of later rounds', () => {
    const state = resign(initialState(), RED, first, 'timeout').state; // Red timed out at some point
    const frozen = createClock(600, 0, true);
    const clock = { ...frozen, seconds: [0, 600, 600, 600] };
    const after = rounds(state, clock, 60);
    expect(after.clock.seconds[RED]).toBe(0);
    // ...and the other seats really did run (so the test is not vacuous).
    expect(after.clock.seconds.slice(1).some((s) => s < 600)).toBe(true);
  });

  it('a seat eliminated by checkmate keeps the time it had; later ticks drain only the seats that are still playing', () => {
    const mate = stateFromPieces(['rK@h1', 'rR@d11', 'bK@a8', 'bP@b7', 'bP@b8', 'bP@b9', 'bR@e7', 'yK@h14', 'gK@n7']);
    const clock: FourPlayerClock = { ...createClock(600, 0, true), seconds: [500, 321, 450, 400] };
    const move = findLegalMove(mate, RED, parseSquare('d11'), parseSquare('a11'))!;
    const played = playMove(mate, move, first);
    expect(played.state.status[BLUE]).toBe('dead-king');
    const after = rounds(played.state, clock, 40);
    expect(after.clock.seconds[BLUE]).toBe(321);
  });

  it('a dead king\'s random walk costs nobody time (playMove never touches a clock; only ticks and increments do)', () => {
    const start = stateFromPieces(['rK@h1', 'rP@e2', 'bK@d8', 'yK@g14', 'gK@n7'], { status: ['active', 'dead-king', 'active', 'active'] });
    const clock: FourPlayerClock = { ...createClock(600, 5, true), seconds: [100, 200, 300, 400] };
    const walked = playMove(start, findLegalMove(start, RED, parseSquare('e2'), parseSquare('e3'))!, first);
    expect(walked.events.some((e) => e.kind === 'deadKingMove')).toBe(true);
    // The only clock effect of that whole turn is Red's increment (it made the move); the dead king's walk added or removed nothing.
    expect(addIncrement(clock, RED, start).seconds).toEqual([105, 200, 300, 400]);
  });
});

describe('a whole timed game (simulated time)', () => {
  it('each move costs the mover 3 s of a 60 s clock: every step only the mover\'s clock changes, eliminated seats never change again, timeouts end the game', () => {
    const rng = seeded(2024);
    let state = initialState();
    let clock = createClock(60, 0, true);
    const frozenAt = new Map<Seat, number>();
    let timeoutCount = 0;
    for (let step = 0; step < 600 && !state.result; step++) {
      const mover = state.turn;
      const before = clock.seconds.slice();
      const tick = clockTick(state, clock, 3, rng);
      clock = tick.clock;
      // Only the mover's clock moved.
      for (let seat = 0; seat < 4; seat++) if (seat !== mover) expect(clock.seconds[seat], `step ${step} seat ${seat}`).toBe(before[seat]);
      expect(clock.seconds[mover]).toBe(Math.max(0, before[mover] - 3));
      timeoutCount += timeouts(tick.events).length;
      for (let seat = 0; seat < 4; seat++) {
        if (tick.state.status[seat] !== 'active' && !frozenAt.has(seat as Seat)) frozenAt.set(seat as Seat, clock.seconds[seat]);
        if (frozenAt.has(seat as Seat)) expect(clock.seconds[seat], `seat ${seat} must stay frozen`).toBe(frozenAt.get(seat as Seat));
      }
      state = tick.state;
      if (state.result) break;
      const move = chooseBotMove(state, 1000, rng);
      if (move) state = playMove(state, move, rng).state;
    }
    expect(state.result).not.toBeNull();
    expect(timeoutCount).toBeGreaterThan(0);
  }, 120_000);
});

describe('building a clock from a time control', () => {
  it('a timed preset is enabled with its seconds and increment; "No time limit" is not', () => {
    const blitz = clockForTimeControl({ id: 'blitz-5-2', label: '5 | 2', initialSeconds: 300, incrementSeconds: 2, category: 'blitz' });
    expect(blitz).toEqual({ enabled: true, incrementSeconds: 2, seconds: [300, 300, 300, 300] });
    expect(clockForTimeControl({ id: 'unlimited', label: 'No time limit', initialSeconds: 0, incrementSeconds: 0, category: 'unlimited' }).enabled).toBe(false);
    expect(clockForTimeControl({ id: 'bullet-1', label: '1 min', initialSeconds: 60, incrementSeconds: 0, category: 'bullet' }).enabled).toBe(true);
    expect(clockForTimeControl({ id: 'rapid-10', label: '10 min', initialSeconds: 600, incrementSeconds: 0, category: 'rapid' }).seconds[3]).toBe(600);
  });
});
