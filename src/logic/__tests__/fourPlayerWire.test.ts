import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FOUR_CHAT_MAX_LENGTH,
  FOUR_CLIENT_EVENT_NAMES,
  FOUR_ID_MAX_LENGTH,
  FOUR_SERVER_EVENT_NAMES,
  FOUR_TC_MAX_INCREMENT_SECONDS,
  FOUR_TC_MAX_INITIAL_SECONDS,
  FOUR_TC_MIN_INITIAL_SECONDS,
  classifyFourRejoinAck,
  clocksToWireMs,
  isCanonicalSquareName,
  normalizeFourChatText,
  validateFourId,
  validateFourJoinQueue,
  validateFourMovePayload,
  validateFourTimeControl,
  type FourGameOverPayload,
  type FourRejoinAck,
  type FourRejoinState,
  type FourRoomState,
  type FourSeats,
  type FourStatePayload,
} from '../fourPlayerWire';
import { addIncrement, chooseBotMove, clockTick, createClock, initialState, playMove, resign, serialize, squareName, type GameEvent } from '../fourPlayer';

/**
 * The 4 Player Online wire contract (src/logic/fourPlayerWire.ts). It is copied to the backend by a generator, so what is pinned here is
 * what BOTH sides will enforce: the limits, the validators (the server's only defence against a hostile or buggy client), the event
 * surface, and the claim that engine events cross the wire untouched. The generator and the engine parity are tested in the backend
 * repo (scripts/test-fourplayer-sync.mjs, scripts/test-fourplayer.mjs).
 */

const wireSource = readFileSync(join(__dirname, '../fourPlayerWire.ts'), 'utf8').replace(/\r\n/g, '\n');

describe('limits', () => {
  it('are the decided v1 numbers (live Bullet/Blitz/Rapid only)', () => {
    expect(FOUR_TC_MIN_INITIAL_SECONDS).toBe(60);
    expect(FOUR_TC_MAX_INITIAL_SECONDS).toBe(3600);
    expect(FOUR_TC_MAX_INCREMENT_SECONDS).toBe(30);
    expect(FOUR_CHAT_MAX_LENGTH).toBe(500);
    expect(FOUR_ID_MAX_LENGTH).toBeGreaterThanOrEqual(36); // a UUID must fit
  });
});

describe('validateFourTimeControl', () => {
  // No default parameter on purpose: `tc(600, undefined)` must hand the validator a REAL undefined increment (a default would turn it into 0).
  const tc = (initialSeconds: unknown, ...rest: [incrementSeconds?: unknown]) => validateFourTimeControl({ initialSeconds, incrementSeconds: rest.length ? rest[0] : 0 });

  it('accepts exactly the live range, boundaries included', () => {
    for (const [initial, inc] of [[60, 0], [61, 1], [180, 2], [600, 5], [3599, 29], [3600, 30], [60, 30], [3600, 0]] as const) {
      expect(tc(initial, inc)).toStrictEqual({ ok: true, value: { initialSeconds: initial, incrementSeconds: inc } });
    }
  });

  it('refuses one second outside either end', () => {
    expect(tc(59).ok).toBe(false);
    expect(tc(3601).ok).toBe(false);
    expect(tc(600, 31).ok).toBe(false);
    expect(tc(600, -1).ok).toBe(false);
  });

  it('refuses "No time limit" and Daily in every encoding they could arrive in', () => {
    for (const initial of [0, -1, 86_400, 172_800, Number.MAX_SAFE_INTEGER, Infinity, -Infinity]) expect(tc(initial).ok, String(initial)).toBe(false);
    const refused = tc(0);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/time limit/);
  });

  it('refuses anything that is not a whole number of seconds', () => {
    for (const bad of [600.5, NaN, '600', null, undefined, true, {}, [], [600]]) expect(tc(bad).ok, String(bad)).toBe(false);
    for (const bad of [0.5, NaN, '5', null, undefined, Infinity]) expect(tc(600, bad).ok, `increment ${String(bad)}`).toBe(false);
  });

  it('refuses a time control that is not an object', () => {
    for (const bad of [null, undefined, 600, '600', [], [600, 0], true]) expect(validateFourTimeControl(bad).ok, String(bad)).toBe(false);
  });

  it('returns ONLY the two fields: extra and prototype keys on the input never reach the server logic', () => {
    const polluted = JSON.parse('{"initialSeconds":600,"incrementSeconds":5,"extra":"x","__proto__":{"admin":true},"constructor":{"x":1}}');
    const result = validateFourTimeControl(polluted);
    expect(result).toStrictEqual({ ok: true, value: { initialSeconds: 600, incrementSeconds: 5 } });
    if (result.ok) expect(Object.keys(result.value)).toEqual(['initialSeconds', 'incrementSeconds']);
  });
});

describe('validateFourJoinQueue', () => {
  const tc = { initialSeconds: 300, incrementSeconds: 3 };
  it('accepts a time control with or without a label', () => {
    expect(validateFourJoinQueue({ timeControl: tc })).toStrictEqual({ ok: true, value: { timeControl: tc } });
    expect(validateFourJoinQueue({ timeControl: tc, timeControlLabel: '5 | 3' })).toStrictEqual({ ok: true, value: { timeControl: tc, timeControlLabel: '5 | 3' } });
  });
  it('refuses a bad time control, a non-string or over-long label, and a non-object payload', () => {
    expect(validateFourJoinQueue({ timeControl: { initialSeconds: 0, incrementSeconds: 0 } }).ok).toBe(false);
    expect(validateFourJoinQueue({ timeControl: tc, timeControlLabel: 5 }).ok).toBe(false);
    expect(validateFourJoinQueue({ timeControl: tc, timeControlLabel: 'x'.repeat(41) }).ok).toBe(false);
    expect(validateFourJoinQueue({ timeControl: tc, timeControlLabel: 'x'.repeat(40) }).ok).toBe(true);
    for (const bad of [null, undefined, 'x', 5, [], {}]) expect(validateFourJoinQueue(bad).ok, String(bad)).toBe(false);
  });
});

describe('validateFourMovePayload', () => {
  const room = '3f2b1c5e-9a4d-4b7e-8c11-0a2f6d9e7b10';
  const move = (over: Record<string, unknown> = {}) => validateFourMovePayload({ roomId: room, from: 'e2', to: 'e4', ...over });

  it('accepts a playable-square move, with or without a promotion piece (q r b n)', () => {
    expect(move()).toStrictEqual({ ok: true, value: { roomId: room, from: 'e2', to: 'e4' } });
    for (const promotion of ['q', 'r', 'b', 'n']) expect(move({ to: 'e8', promotion })).toStrictEqual({ ok: true, value: { roomId: room, from: 'e2', to: 'e8', promotion } });
  });

  it('accepts the extreme playable squares of the cross (and nothing outside it)', () => {
    for (const name of ['d1', 'k1', 'a4', 'a11', 'n4', 'n11', 'd14', 'k14']) expect(move({ from: name }).ok, name).toBe(true);
    for (const corner of ['a1', 'c1', 'l1', 'n1', 'a3', 'a12', 'a14', 'n14', 'c14', 'l14', 'n12', 'n3']) expect(move({ from: corner }).ok, `cut corner ${corner}`).toBe(false);
  });

  it('refuses squares that are not squares - and any spelling but the canonical one (client input at the server boundary)', () => {
    // 'e02' / 'a04' are the interesting ones: the engine's parseSquare accepts a leading zero, so without the canonical check they would
    // silently mean e2 / a4.
    for (const bad of ['', 'e', '2', 'e0', 'e15', 'o5', 'E2', 'e 2', ' e2', 'e2 ', 'e02', 'a04', 'e002', 'd01', 'n011', 'e-2', 'e+2', 'ee2', '5', null, undefined, 5, {}, []]) {
      expect(move({ from: bad }).ok, `from ${JSON.stringify(bad)}`).toBe(false);
      expect(move({ to: bad }).ok, `to ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it('isCanonicalSquareName: true only for the squareName spelling of a playable square - every one of the 160, and nothing else', () => {
    let accepted = 0;
    for (let i = 0; i < 196; i++) {
      const name = squareName(i);
      if (isCanonicalSquareName(name)) accepted++;
    }
    expect(accepted).toBe(160);
    for (const bad of ['e02', 'a04', 'E2', 'e2 ', 'a1', 'n14', 'a3', '', 5, null]) expect(isCanonicalSquareName(bad), String(bad)).toBe(false);
    expect(isCanonicalSquareName('e2')).toBe(true);
    expect(isCanonicalSquareName('d14')).toBe(true);
  });

  it('refuses a promotion piece that is not one of q r b n (a king, a pawn, upper case, a number)', () => {
    for (const bad of ['k', 'p', 'Q', 'queen', '', 1, null, {}, ['q']]) expect(move({ promotion: bad }).ok, `promotion ${JSON.stringify(bad)}`).toBe(false);
  });

  it('refuses a missing, empty, over-long or non-string room id', () => {
    for (const bad of [undefined, null, '', 5, {}, 'x'.repeat(FOUR_ID_MAX_LENGTH + 1)]) expect(move({ roomId: bad }).ok, `room ${JSON.stringify(bad)}`).toBe(false);
    expect(move({ roomId: 'x'.repeat(FOUR_ID_MAX_LENGTH) }).ok).toBe(true);
  });

  it('refuses a payload that is not an object', () => {
    for (const bad of [null, undefined, 'e2e4', 5, [], [room, 'e2', 'e4']]) expect(validateFourMovePayload(bad).ok, String(bad)).toBe(false);
  });

  it('a payload must be a PLAIN object: an array that merely carries the right property names is refused (in every validator)', () => {
    const dressed = (props: Record<string, unknown>) => Object.assign([], props);
    expect(validateFourMovePayload(dressed({ roomId: room, from: 'e2', to: 'e4' })).ok).toBe(false);
    expect(validateFourTimeControl(dressed({ initialSeconds: 600, incrementSeconds: 0 })).ok).toBe(false);
    expect(validateFourJoinQueue(dressed({ timeControl: { initialSeconds: 600, incrementSeconds: 0 } })).ok).toBe(false);
  });

  it('hostile values that blow up when converted to text are refused, never thrown on (a validator at the server boundary must not throw)', () => {
    const exploding = { toString: () => { throw new Error('boom'); }, valueOf: () => { throw new Error('boom'); } };
    for (const bad of [Symbol('e2'), exploding, new String('e2'), ['e2'], Object.create(null)]) {
      expect(() => isCanonicalSquareName(bad)).not.toThrow();
      expect(isCanonicalSquareName(bad)).toBe(false);
      expect(() => validateFourMovePayload({ roomId: room, from: bad, to: 'e4' })).not.toThrow();
      expect(validateFourMovePayload({ roomId: room, from: 'e2', to: bad }).ok).toBe(false);
    }
  });

  it('returns only the known fields', () => {
    const result = move({ seat: 3, token: 'x', __proto__: { x: 1 } });
    expect(result).toStrictEqual({ ok: true, value: { roomId: room, from: 'e2', to: 'e4' } });
  });

  it("never lets a client choose its seat: there is no seat field in a move payload (the server uses the socket's own)", () => {
    expect(wireSource).toMatch(/export interface FourMakeMovePayload \{[^}]*\}/);
    const body = /export interface FourMakeMovePayload \{([^}]*)\}/.exec(wireSource)![1];
    expect(body).not.toMatch(/seat/i);
  });
});

describe('validateFourId', () => {
  it('accepts a non-empty string up to the cap and refuses everything else', () => {
    expect(validateFourId('abc')).toStrictEqual({ ok: true, value: 'abc' });
    expect(validateFourId('x'.repeat(FOUR_ID_MAX_LENGTH)).ok).toBe(true);
    for (const bad of ['', 'x'.repeat(FOUR_ID_MAX_LENGTH + 1), 5, null, undefined, {}, []]) expect(validateFourId(bad).ok, String(bad)).toBe(false);
  });
});

describe('normalizeFourChatText (same rule as the 2-player chat: trim, then cut, then refuse if empty)', () => {
  it('trims and keeps ordinary text', () => {
    expect(normalizeFourChatText('  hello  ')).toStrictEqual({ ok: true, value: 'hello' });
    expect(normalizeFourChatText('a b\nc')).toStrictEqual({ ok: true, value: 'a b\nc' });
  });
  it('cuts to the limit exactly at the boundary, never refusing for length', () => {
    expect(normalizeFourChatText('a'.repeat(500))).toStrictEqual({ ok: true, value: 'a'.repeat(500) });
    expect(normalizeFourChatText('a'.repeat(501))).toStrictEqual({ ok: true, value: 'a'.repeat(500) });
    expect(normalizeFourChatText('a'.repeat(5000))).toStrictEqual({ ok: true, value: 'a'.repeat(500) });
  });
  it('trims BEFORE cutting, so leading spaces do not eat the allowance', () => {
    expect(normalizeFourChatText(`   ${'a'.repeat(600)}`)).toStrictEqual({ ok: true, value: 'a'.repeat(500) });
  });
  it('refuses empty, whitespace-only and non-text input', () => {
    for (const bad of ['', '   ', '\n\t ', null, undefined, 5, {}, ['hi']]) expect(normalizeFourChatText(bad).ok, JSON.stringify(bad)).toBe(false);
  });
});

describe('validators never throw on garbage', () => {
  it('survive a thousand random values of every shape', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const pool: unknown[] = [null, undefined, 0, -1, 1e308, NaN, Infinity, '', 'e2', '__proto__', {}, [], [[]], true, Symbol('x') as unknown];
    const rndValue = (depth = 0): unknown => {
      const r = rnd();
      if (r < 0.5 || depth > 2) return pool[Math.floor(rnd() * pool.length)];
      if (r < 0.75) return Object.fromEntries(['roomId', 'from', 'to', 'promotion', 'timeControl', 'initialSeconds', 'incrementSeconds', 'timeControlLabel', 'text'].filter(() => rnd() < 0.5).map((k) => [k, rndValue(depth + 1)]));
      return Array.from({ length: Math.floor(rnd() * 3) }, () => rndValue(depth + 1));
    };
    for (let i = 0; i < 1000; i++) {
      const v = rndValue();
      for (const validate of [validateFourTimeControl, validateFourJoinQueue, validateFourMovePayload, normalizeFourChatText, (x: unknown) => validateFourId(x)]) {
        const result = validate(v);
        expect(typeof result.ok).toBe('boolean');
        if (!result.ok) expect(typeof result.error).toBe('string');
      }
    }
  });
});

describe('clocksToWireMs', () => {
  it('converts seconds to whole milliseconds, never negative', () => {
    expect(clocksToWireMs([60, 59.5, 0.0004, 3600])).toEqual([60_000, 59_500, 0, 3_600_000]);
    expect(clocksToWireMs([-5, 0, 12.3456, 0.0005])).toEqual([0, 0, 12_346, 1]);
    expect(clocksToWireMs([59.9996, 1e-9, 0.9995, 2.5004])).toEqual([60_000, 0, 1000, 2500]);
  });
  it('always has exactly four entries, and a missing seat is 0 rather than NaN', () => {
    expect(clocksToWireMs([1, 2])).toEqual([1000, 2000, 0, 0]);
    expect(clocksToWireMs([])).toEqual([0, 0, 0, 0]);
    expect(Number.isInteger(clocksToWireMs([0.1 + 0.2, 7 / 3, 1 / 3, 2 / 3])[0])).toBe(true);
  });
});

describe('classifyFourRejoinAck', () => {
  const seats = [0, 1, 2, 3].map((seat) => ({ seat, kind: 'human', name: `P${seat}`, connected: true })) as unknown as FourSeats;
  const room: FourRoomState = { roomId: 'r', seats, timeControl: { initialSeconds: 60, incrementSeconds: 0 }, timeControlLabel: '1 min', seq: 7, state: 's', clocksMs: [1, 2, 3, 4], log: [] };
  const state: FourRejoinState = { ...room, seat: 2 };
  const gameOver: FourGameOverPayload = { roomId: 'r', reason: 'elimination', winners: [1], scores: [0, 40, 10, 0], state: 's' };

  it('a live game resumes from its state', () => {
    expect(classifyFourRejoinAck({ ok: true, state })).toEqual({ kind: 'state', state });
  });
  it('a game that ended returns its result - as a SUCCESS (a new event has no released client to protect)', () => {
    const ack: FourRejoinAck = { ok: true, finished: true, gameOver };
    expect(classifyFourRejoinAck(ack)).toEqual({ kind: 'finished', gameOver });
  });
  it('"no result" (everyone left) is still a result, with its empty winners', () => {
    const abandoned: FourGameOverPayload = { ...gameOver, reason: 'abandoned', winners: [], scores: [] };
    expect(classifyFourRejoinAck({ ok: true, finished: true, gameOver: abandoned })).toEqual({ kind: 'finished', gameOver: abandoned });
  });
  it('a refusal is "unavailable" and keeps the server\'s message', () => {
    expect(classifyFourRejoinAck({ ok: false, error: 'The game was not found.' })).toEqual({ kind: 'unavailable', error: 'The game was not found.' });
  });
  it('a malformed success (neither state nor result) is "unavailable", never a crash or a half-resume', () => {
    expect(classifyFourRejoinAck({ ok: true } as unknown as FourRejoinAck)).toEqual({ kind: 'unavailable', error: 'Unexpected reply from the server.' });
    expect(classifyFourRejoinAck({ ok: true, state: null } as unknown as FourRejoinAck).kind).toBe('unavailable');
  });
  it('the result wins if (a future) server sent both: the game is over', () => {
    expect(classifyFourRejoinAck({ ok: true, state, finished: true, gameOver } as unknown as FourRejoinAck).kind).toBe('finished');
  });
});

describe('the event surface', () => {
  const block = (name: string) => new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(wireSource)![1];
  const namesIn = (text: string) => [...text.matchAll(/^\s+(four_\w+):/gm)].map((m) => m[1]);

  it('every event is namespaced four_ and unique, so no 2-player event can collide with it', () => {
    const all = [...FOUR_CLIENT_EVENT_NAMES, ...FOUR_SERVER_EVENT_NAMES];
    expect(all.every((n) => /^four_[a-z_]+$/.test(n))).toBe(true);
    expect(new Set(all).size).toBe(all.length);
    expect(FOUR_CLIENT_EVENT_NAMES).toHaveLength(9);
    expect(FOUR_SERVER_EVENT_NAMES).toHaveLength(6);
  });

  it('the runtime lists equal the typed interfaces (adding an event to one and forgetting the other fails here)', () => {
    expect([...FOUR_CLIENT_EVENT_NAMES].sort()).toEqual(namesIn(block('FourClientToServerEvents')).sort());
    expect([...FOUR_SERVER_EVENT_NAMES].sort()).toEqual(namesIn(block('FourServerToClientEvents')).sort());
  });

  it('has no draw offer events: the engine models no draws', () => {
    expect([...FOUR_CLIENT_EVENT_NAMES, ...FOUR_SERVER_EVENT_NAMES].some((n) => /draw/.test(n))).toBe(false);
  });
});

describe('engine events cross the wire untouched (no conversion exists to get wrong)', () => {
  /** A game that is GUARANTEED to end: bots play, then two resignations and a flag fall eliminate three seats (the engine ends the game
   * at the third), so every GameEvent kind - move, deadKingMove, eliminated and gameOver - appears. */
  function eventsOfAGame(): GameEvent[] {
    const events: GameEvent[] = [];
    let state = initialState();
    let clock = createClock(600, 2, true);
    let rngState = 99;
    const rng = () => ((rngState = (rngState * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 2000 && !state.result; i++) {
      if (i === 40 || i === 140) {
        const r = resign(state, state.turn, rng, 'resign');
        state = r.state;
        events.push(...r.events);
        continue;
      }
      if (i === 90) {
        const tick = clockTick(state, clock, clock.seconds[state.turn] + 1, rng);
        state = tick.state;
        clock = tick.clock;
        events.push(...tick.events);
        continue;
      }
      const move = chooseBotMove(state, 1200, rng);
      if (!move) break;
      const seat = state.turn;
      const applied = playMove(state, move, rng);
      state = applied.state;
      clock = addIncrement(clock, seat, state);
      events.push(...applied.events);
    }
    return events;
  }

  it('JSON round trip returns exactly the same events, of every kind', () => {
    const events = eventsOfAGame();
    const kinds = new Set(events.map((e) => e.kind));
    for (const kind of ['move', 'deadKingMove', 'eliminated', 'gameOver']) expect(kinds.has(kind as GameEvent['kind']), `a ${kind} event occurs in the sample game`).toBe(true);
    expect(JSON.parse(JSON.stringify(events))).toEqual(events);
    expect(events.length).toBeGreaterThan(200);
  });
});

describe('payload size (measured, and bounded so a regression is noticed)', () => {
  it('a typical four_state is small', () => {
    let state = initialState();
    let rngState = 7;
    const rng = () => ((rngState = (rngState * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    let last: ReturnType<typeof playMove> | null = null;
    for (let i = 0; i < 150 && !state.result; i++) {
      const move = chooseBotMove(state, 1200, rng)!;
      last = playMove(state, move, rng);
      state = last.state;
    }
    const payload: FourStatePayload = {
      roomId: '3f2b1c5e-9a4d-4b7e-8c11-0a2f6d9e7b10',
      seq: 150,
      actor: 'bot',
      move: { seat: 1, from: squareName(last!.events[0].kind === 'move' ? last!.events[0].move.from : 0), to: 'e4', label: 'e2-e4' },
      events: last!.events,
      state: serialize(state),
      clocksMs: [412_345, 398_001, 120_000, 77_777],
    };
    const bytes = JSON.stringify(payload).length;
    console.log(`four_state payload at ply ${state.ply}: ${bytes} bytes (snapshot ${payload.state.length} chars, ${payload.events.length} events)`);
    expect(payload.state.length).toBeLessThan(500);
    expect(bytes).toBeLessThan(1500);
  });

  it('a rejoin state with a long move log stays far below any sane socket limit', () => {
    const log = Array.from({ length: 1000 }, (_, i) => ({ seat: (i % 4) as 0 | 1 | 2 | 3, text: 'd4xe5=Q' }));
    const bytes = JSON.stringify({ log }).length;
    console.log(`1000-entry move log: ${bytes} bytes`);
    expect(bytes).toBeLessThan(40_000);
  });
});

describe('the wire file stays mirrorable', () => {
  it('imports only mirrored engine modules, extensionless (the generator adds ".js")', () => {
    const specifiers = [...wireSource.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const s of specifiers) expect(s, s).toMatch(/^\.\/fourPlayer\/(board|state|moves|elimination|bot|clock)$/);
  });
});
