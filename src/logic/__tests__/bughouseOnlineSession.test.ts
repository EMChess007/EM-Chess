import { describe, expect, it } from 'vitest';
import { createMatch, serializeMatch, settle, type BughouseAction, type BughouseMatch, type BughouseSeat } from '../bughouse';
import type { BugGameOverPayload, BugMatchFoundPayload, BugRejoinAck, BugSeats, BugStatePayload } from '../bughouse/wire';
import { SOCKET_ACK_DEADLINE_MS } from '../../api/socketAck';
import { BughouseOnlineSession, CANT_REACH, type BugSocket, type BughouseSessionEffects } from '../bughouseOnlineSession';
import { isOver } from '../bughouseOnline';

/**
 * THE ONLINE BUGHOUSE SESSION (W4) against a FAKE socket: what it sends and when, what it does with each answer - and, above all, that EVERY wait has the 6 s limit and that an answer that never
 * comes ends in a sentence, one Diagnostic Log line and a way out. The snapshots are the real engine's. No timers, no clock: the fake socket answers (or does not) when the test says so.
 */
const TC = { initialMs: 60000, incrementMs: 0 };
const SEATS: BugSeats = [0, 1, 2, 3].map((seat) => ({ seat, kind: seat === 0 ? 'human' : 'bot', name: `P${seat}`, connected: true })) as unknown as BugSeats;
const ROOM = 'room-1';

type Cb = (err: unknown, ack?: unknown) => void;
class FakeSocket implements BugSocket {
  connected = true;
  handlers = new Map<string, Set<(...args: never[]) => void>>();
  managerHandlers = new Map<string, Set<() => void>>();
  /** every request that waits for an answer: the event, its payload, the limit it was given and the callback that answers it */
  asked: { event: string; payload: unknown; ms: number; cb: Cb }[] = [];
  /** every plain emit (no answer awaited) */
  plain: { event: string; args: unknown[] }[] = [];
  on(event: string, handler: (...args: never[]) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return this;
  }
  off(event: string, handler: (...args: never[]) => void) {
    this.handlers.get(event)?.delete(handler);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    this.plain.push({ event, args });
    return this;
  }
  timeout(ms: number) {
    return { emit: (event: string, payload: object, cb: Cb) => void this.asked.push({ event, payload, ms, cb }) };
  }
  io = {
    on: (event: string, handler: () => void) => {
      if (!this.managerHandlers.has(event)) this.managerHandlers.set(event, new Set());
      this.managerHandlers.get(event)!.add(handler);
    },
    off: (event: string, handler: () => void) => void this.managerHandlers.get(event)?.delete(handler),
  };
  fire(event: string, payload?: unknown) {
    for (const h of [...(this.handlers.get(event) ?? [])]) (h as (p: unknown) => void)(payload);
  }
  fireManager(event: string) {
    for (const h of [...(this.managerHandlers.get(event) ?? [])]) h();
  }
  /** answers the oldest unanswered request for `event` */
  answer(event: string, ack: unknown) {
    const index = this.asked.findIndex((a) => a.event === event && a.cb !== null);
    if (index < 0) throw new Error(`no pending ${event}`);
    const [req] = this.asked.splice(index, 1);
    req.cb(null, ack);
    return req;
  }
  /** the request gets no answer: socket.io's own timeout error */
  silence(event: string) {
    const index = this.asked.findIndex((a) => a.event === event);
    if (index < 0) throw new Error(`no pending ${event}`);
    const [req] = this.asked.splice(index, 1);
    req.cb(new Error('operation has timed out'));
  }
  pending(event: string) {
    return this.asked.filter((a) => a.event === event);
  }
}

const start = (): BughouseMatch => createMatch({ timeControl: TC, roomNumber: 2, startMs: 0 });
const play = (match: BughouseMatch, seat: BughouseSeat, action: BughouseAction, now: number) => {
  const outcome = settle(match, { seat, action }, now);
  if (outcome.kind !== 'applied' && outcome.kind !== 'flag') throw new Error(`not applied: ${outcome.kind}`);
  return outcome;
};
const found = (match: BughouseMatch = start()): BugMatchFoundPayload => ({ roomId: ROOM, seat: 0, playerToken: 'secret-token', seats: SEATS, timeControl: TC, timeControlLabel: '1 min', state: serializeMatch(match), serverNowMs: 0, seq: 0 });
const stateOf = (outcome: { match: BughouseMatch; events: unknown[] }, serverNowMs: number): BugStatePayload => ({ roomId: ROOM, seq: outcome.match.seq, events: outcome.events as BugStatePayload['events'], state: serializeMatch(outcome.match), serverNowMs });
const roomAck = (match: BughouseMatch, serverNowMs: number): BugRejoinAck => ({ ok: true, state: { roomId: ROOM, seat: 0, seats: SEATS, timeControl: TC, timeControlLabel: '1 min', seq: match.seq, state: serializeMatch(match), serverNowMs, log: [] } });

function harness(resume = false) {
  const socket = new FakeSocket();
  const log: string[] = [];
  const sounds = { moves: 0, ends: 0 };
  let now = 1_000_000;
  const effects: BughouseSessionEffects = { now: () => now, moveSound: () => void sounds.moves++, gameEnded: () => void sounds.ends++, log: (m) => void log.push(m) };
  const session = new BughouseOnlineSession(socket, { match: found(), resume }, effects);
  const states: ReturnType<typeof session.state.valueOf>[] = [];
  session.subscribe((s) => states.push(s));
  session.start();
  return { socket, session, log, sounds, states, tick: (ms: number) => void (now += ms) };
}

const E4 = { kind: 'move', board: 'A', from: 'e2', to: 'e4' } as const;
const first = play(start(), 0, E4, 2000);

describe('starting', () => {
  it('a new game starts connected on the seat of the match_found, with nothing sent', () => {
    const h = harness();
    expect(h.session.state.connection).toBe('connected');
    expect(h.session.state.view?.mySeat).toBe(0);
    expect(h.socket.asked).toHaveLength(0);
    expect(h.socket.plain).toHaveLength(0);
    expect([...h.socket.handlers.keys()].sort()).toEqual(['bug_game_over', 'bug_seat_update', 'bug_state', 'disconnect']);
    expect([...h.socket.managerHandlers.keys()]).toEqual(['reconnect']);
  });

  it('an unreadable match_found is "could not be read" and no view', () => {
    const socket = new FakeSocket();
    const session = new BughouseOnlineSession(socket, { match: { ...found(), state: 'x' }, resume: false }, { now: () => 0, moveSound: () => undefined, gameEnded: () => undefined, log: () => undefined });
    expect(session.state.view).toBeNull();
    expect(session.state.problem).toBe('The game could not be read from the server.');
  });

  it('a reopened screen (resume) is "reconnecting" and rejoins at once with the room and the token it holds', () => {
    const h = harness(true);
    expect(h.session.state.connection).toBe('reconnecting');
    const [rejoin] = h.socket.pending('bug_rejoin');
    expect(rejoin.payload).toEqual({ roomId: 'room-1', playerToken: 'secret-token' });
    expect(h.session.state.view?.resyncing).toBe(true);
  });

  it('stop() takes every handler off the socket and the manager', () => {
    const h = harness();
    h.session.stop();
    for (const set of h.socket.handlers.values()) expect(set.size).toBe(0);
    for (const set of h.socket.managerHandlers.values()) expect(set.size).toBe(0);
    h.socket.fire('bug_state', stateOf(first, 2000));
    expect(h.session.state.view?.match.seq).toBe(0);
  });
});

describe('every wait has the 6 s limit', () => {
  it('SOCKET_ACK_DEADLINE_MS is 6000 and a move, a rejoin and a resignation are all asked with it', () => {
    expect(SOCKET_ACK_DEADLINE_MS).toBe(6000);
    const h = harness();
    h.session.sendAction(E4);
    h.session.resign(() => undefined);
    h.socket.fire('disconnect');
    h.socket.fireManager('reconnect');
    expect(h.socket.asked.map((a) => `${a.event}:${a.ms}`)).toEqual(['bug_move:6000', 'bug_resign:6000', 'bug_rejoin:6000']);
  });
});

describe('moves and drops: sent, never played here', () => {
  it('sendAction emits bug_move with the room, the board and the seq, marks the action pending, and does NOT touch the board', () => {
    const h = harness();
    h.session.sendAction(E4);
    const [req] = h.socket.pending('bug_move');
    expect(req.payload).toEqual({ roomId: 'room-1', board: 'A', from: 'e2', to: 'e4', baseSeq: 0 });
    expect(h.session.state.view?.pending).toEqual({ id: 1 });
    expect(h.session.state.view?.match.boards.A.fen).toBe(start().boards.A.fen);
  });

  it('a drop goes out as bug_drop', () => {
    const h = harness();
    h.session.sendAction({ kind: 'drop', board: 'A', piece: 'n', square: 'f3' });
    expect(h.socket.pending('bug_drop')[0].payload).toEqual({ roomId: 'room-1', board: 'A', piece: 'n', square: 'f3', baseSeq: 0 });
  });

  it('a second action while one waits is not sent', () => {
    const h = harness();
    h.session.sendAction(E4);
    h.session.sendAction({ kind: 'move', board: 'A', from: 'd2', to: 'd4' });
    expect(h.socket.asked).toHaveLength(1);
  });

  it('the ack ends the wait; the board changes only when the snapshot arrives, in either order; the move is heard once', () => {
    const h = harness();
    h.session.sendAction(E4);
    h.socket.answer('bug_move', { ok: true, seq: 1 });
    expect(h.session.state.view?.pending).toBeNull();
    expect(h.session.state.view?.match.seq).toBe(0);
    h.socket.fire('bug_state', stateOf(first, 2000));
    expect(h.session.state.view?.match.boards.A.fen).toBe(first.match.boards.A.fen);
    expect(h.session.state.view?.lastMove.A).toEqual({ from: 'e2', to: 'e4' });
    expect(h.sounds.moves).toBe(1);
    // the other order: the snapshot first, then the ack
    const g = harness();
    g.session.sendAction(E4);
    g.socket.fire('bug_state', stateOf(first, 2000));
    expect(g.session.state.view?.pending).toEqual({ id: 1 });
    g.socket.answer('bug_move', { ok: true, seq: 1 });
    expect(g.session.state.view?.pending).toBeNull();
    expect(g.session.state.view?.match.seq).toBe(1);
  });

  it('a refusal ends the wait with its sentence, one log line carries the reason, and the position is the server\'s', () => {
    const h = harness();
    h.session.sendAction(E4);
    h.socket.answer('bug_move', { ok: false, error: 'Illegal move.', reason: 'illegalMove' });
    expect(h.session.state.view?.pending).toBeNull();
    expect(h.session.state.view?.actionError).toBe('That move is not legal.');
    expect(h.log).toEqual(['[BughouseOnline] bug_move refused (room room-1): illegalMove']);
    expect(h.session.state.view?.match.seq).toBe(0);
  });

  it('SILENCE (no answer within the limit): a sentence that says "Can\'t reach the server", ONE log line, and the room is read again', () => {
    const h = harness();
    h.session.sendAction(E4);
    h.socket.silence('bug_move');
    expect(h.session.state.view?.pending).toBeNull();
    expect(h.session.state.view?.actionError).toBe(`${CANT_REACH} Your move may not have gone through: check the board and try again.`);
    expect(h.log.filter((l) => /bug_move was not answered/.test(l))).toHaveLength(1);
    expect(h.socket.pending('bug_rejoin')).toHaveLength(1);
    expect(h.session.state.view?.resyncing).toBe(true);
  });

  it('a reply that is not an ack object is "Unexpected reply" and ends the wait', () => {
    const h = harness();
    h.session.sendAction(E4);
    h.socket.answer('bug_move', 'nonsense');
    expect(h.session.state.view?.pending).toBeNull();
    expect(h.session.state.view?.actionError).toBe('Unexpected reply from the server.');
  });

  it('nothing is sent while the connection is down, or when the wire would refuse the payload', () => {
    const h = harness();
    h.socket.fire('disconnect');
    h.session.sendAction(E4);
    expect(h.socket.pending('bug_move')).toHaveLength(0);
    const g = harness();
    g.session.sendAction({ kind: 'move', board: 'A', from: 'z9', to: 'e4' });
    expect(g.socket.asked).toHaveLength(0);
    expect(g.session.state.view?.actionError).toBe('Invalid move.');
  });
});

describe('snapshots: a gap or unreadable text asks for the whole room', () => {
  it('a gap sends bug_rejoin once (not once per late snapshot) and the answer replaces the view and re-keys the board', () => {
    const h = harness();
    const second = play(first.match, 2, { kind: 'move', board: 'B', from: 'e2', to: 'e4' }, 2500);
    const third = play(second.match, 3, { kind: 'move', board: 'B', from: 'e7', to: 'e5' }, 3000);
    h.socket.fire('bug_state', stateOf(third, 3000)); // seq 3 while we are on 0
    h.socket.fire('bug_state', stateOf(third, 3000));
    expect(h.socket.pending('bug_rejoin')).toHaveLength(1);
    // each late snapshot is logged, but only the first one asks (one request at a time)
    expect(h.log.filter((l) => /gap at seq 3 \(have 0\)/.test(l))).toHaveLength(2);
    const keyBefore = h.session.state.boardKey;
    h.socket.answer('bug_rejoin', roomAck(third.match, 3000));
    expect(h.session.state.view?.match.seq).toBe(3);
    expect(h.session.state.view?.resyncing).toBe(false);
    expect(h.session.state.boardKey).toBe(keyBefore + 1);
    expect(h.session.state.connection).toBe('connected');
  });

  it('unreadable text also asks for the room', () => {
    const h = harness();
    h.socket.fire('bug_state', { ...stateOf(first, 2000), state: '{"bad":true}' });
    expect(h.socket.pending('bug_rejoin')).toHaveLength(1);
    expect(h.session.state.view?.match.seq).toBe(0);
  });

  it('a stale snapshot is dropped silently: no request, no sound', () => {
    const h = harness();
    h.socket.fire('bug_state', stateOf(first, 2000));
    h.socket.fire('bug_state', stateOf(first, 2000));
    expect(h.socket.asked).toHaveLength(0);
    expect(h.sounds.moves).toBe(1);
  });

  it('an event handler that throws is logged and dropped, never thrown into the socket', () => {
    const socket = new FakeSocket();
    const log: string[] = [];
    const session = new BughouseOnlineSession(socket, { match: found(), resume: false }, {
      now: () => 0,
      moveSound: () => {
        throw new Error('speaker broke');
      },
      gameEnded: () => undefined,
      log: (m) => void log.push(m),
    });
    session.start();
    expect(() => socket.fire('bug_state', stateOf(first, 2000))).not.toThrow();
    expect(log).toEqual(['[BughouseOnline] bug_state handler failed and was dropped: speaker broke']);
    expect(session.state.view?.match.seq).toBe(1);
  });
});

describe('reconnect: the W2 rejoin', () => {
  it('a dropped connection shows "reconnecting" (one log line); the manager\'s reconnect sends bug_rejoin with the token; the room comes back "connected"', () => {
    const h = harness();
    h.socket.connected = false;
    h.socket.fire('disconnect');
    expect(h.session.state.connection).toBe('reconnecting');
    expect(h.log).toEqual(['[BughouseOnline] own connection dropped (room room-1)']);
    h.socket.connected = true;
    h.socket.fireManager('reconnect');
    expect(h.socket.pending('bug_rejoin')[0].payload).toEqual({ roomId: 'room-1', playerToken: 'secret-token' });
    h.socket.answer('bug_rejoin', roomAck(first.match, 2500));
    expect(h.session.state.connection).toBe('connected');
    expect(h.session.state.problem).toBeNull();
    expect(h.session.state.view?.match.seq).toBe(1);
    expect(h.log).toContain('[BughouseOnline] bug_rejoin state (room room-1)');
  });

  it('a rejoin that gets NO answer is "Can\'t reach the server" with ONE log line; Retry asks again; a later answer recovers', () => {
    const h = harness();
    h.socket.fire('disconnect');
    h.socket.fireManager('reconnect');
    h.socket.silence('bug_rejoin');
    expect(h.session.state.problem).toBe(CANT_REACH);
    expect(h.session.state.view?.resyncing).toBe(false);
    expect(h.log.filter((l) => /bug_rejoin was not answered/.test(l))).toHaveLength(1);
    h.session.retry();
    expect(h.socket.pending('bug_rejoin')).toHaveLength(1);
    h.socket.answer('bug_rejoin', roomAck(start(), 0));
    expect(h.session.state.problem).toBeNull();
    expect(h.session.state.connection).toBe('connected');
  });

  it('a rejoin that finds the game gone is "unavailable" with the server\'s words', () => {
    const h = harness();
    h.socket.fire('disconnect');
    h.socket.fireManager('reconnect');
    h.socket.answer('bug_rejoin', { ok: false, error: 'Game not found.', reason: 'noGame' });
    expect(h.session.state.connection).toBe('unavailable');
    expect(h.session.state.problem).toBe('Game not found.');
  });

  it('a rejoin on a game that ENDED while we were away hands back the result', () => {
    const h = harness();
    const ended = settle(start(), { seat: 1, action: { kind: 'resign' } }, 3000);
    h.socket.fire('disconnect');
    h.socket.fireManager('reconnect');
    h.socket.answer('bug_rejoin', { ok: true, finished: true, gameOver: { roomId: ROOM, result: ended.match.result!, state: serializeMatch(ended.match) } });
    expect(isOver(h.session.state.view!)).toBe(true);
    expect(h.session.state.connection).toBe('connected');
  });

  it('a reply that is not an object is "Unexpected reply" and the game is unavailable', () => {
    const h = harness();
    h.socket.fire('disconnect');
    h.socket.fireManager('reconnect');
    h.socket.answer('bug_rejoin', 7);
    expect(h.session.state.connection).toBe('unavailable');
    expect(h.session.state.problem).toBe('Unexpected reply from the server.');
  });

  it('after the result is on screen a disconnect and a reconnect change nothing and ask nothing', () => {
    const h = harness();
    const ended = settle(start(), { seat: 1, action: { kind: 'resign' } }, 3000);
    h.socket.fire('bug_game_over', { roomId: ROOM, result: ended.match.result!, state: serializeMatch(ended.match) } satisfies BugGameOverPayload);
    h.socket.fire('disconnect');
    expect(h.session.state.connection).toBe('connected');
    h.socket.fireManager('reconnect');
    expect(h.socket.asked).toHaveLength(0);
  });

  it('a rejoin answer that lands after the result is ignored (the result stays)', () => {
    const h = harness();
    h.socket.fire('disconnect');
    h.socket.fireManager('reconnect');
    const ended = settle(start(), { seat: 1, action: { kind: 'resign' } }, 3000);
    h.socket.fire('bug_game_over', { roomId: ROOM, result: ended.match.result!, state: serializeMatch(ended.match) });
    h.socket.answer('bug_rejoin', roomAck(first.match, 2500));
    expect(isOver(h.session.state.view!)).toBe(true);
    expect(h.session.state.view?.match.seq).toBe(ended.match.seq);
  });
});

describe('the end of the game and resigning', () => {
  it('bug_game_over shows the result and announces the end ONCE even when the final snapshot comes too', () => {
    const h = harness();
    const ended = settle(start(), { seat: 1, action: { kind: 'resign' } }, 3000);
    h.socket.fire('bug_state', stateOf(ended as { match: BughouseMatch; events: unknown[] }, 3000));
    h.socket.fire('bug_game_over', { roomId: ROOM, result: ended.match.result!, state: serializeMatch(ended.match) });
    expect(isOver(h.session.state.view!)).toBe(true);
    expect(h.sounds.ends).toBe(1);
  });

  it('resign emits bug_resign with the room; a refusal is reported in words and silence as "Can\'t reach the server"; success reports nothing', () => {
    const h = harness();
    const errors: string[] = [];
    h.session.resign((m) => errors.push(m));
    expect(h.socket.pending('bug_resign')[0].payload).toEqual({ roomId: 'room-1' });
    h.socket.answer('bug_resign', { ok: true });
    h.session.resign((m) => errors.push(m));
    h.socket.answer('bug_resign', { ok: false, error: 'x', reason: 'over' });
    h.session.resign((m) => errors.push(m));
    h.socket.silence('bug_resign');
    expect(errors).toEqual(['The game is over.', `${CANT_REACH} Try again.`]);
    expect(h.log.filter((l) => /bug_resign was not answered/.test(l))).toHaveLength(1);
  });

  it('resigning a finished game sends nothing', () => {
    const h = harness();
    const ended = settle(start(), { seat: 1, action: { kind: 'resign' } }, 3000);
    h.socket.fire('bug_game_over', { roomId: ROOM, result: ended.match.result!, state: serializeMatch(ended.match) });
    h.session.resign(() => undefined);
    expect(h.socket.asked).toHaveLength(0);
  });

  it('a seat update replaces the seats on the view', () => {
    const h = harness();
    const next = SEATS.map((s) => ({ ...s, connected: false, graceMsLeft: 30000 }));
    h.socket.fire('bug_seat_update', { roomId: ROOM, seats: next });
    expect(h.session.state.view?.seats).toBe(next);
  });
});
