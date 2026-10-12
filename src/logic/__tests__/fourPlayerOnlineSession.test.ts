import { describe, expect, it } from 'vitest';
import { FourOnlineSession, FOUR_ACK_TIMEOUT_MS, type FourOnlineRole, type FourSessionEffects, type FourSessionState, type FourSocket } from '../fourPlayerOnlineSession';
import { displayState } from '../fourPlayerOnline';
import { initialState, legalMoves, serialize, type Move, type Seat } from '../fourPlayer';
import { clocksToWireMs, type FourRoomState, type FourSeats } from '../fourPlayerWire';
import { ROOM, OTHER_ROOM, ServerSim, mv, seatsOf } from './fourPlayerOnlineKit';

/**
 * FourOnlineSession (src/logic/fourPlayerOnlineSession.ts) against a FAKE SOCKET: when the client sends what, and what it does with the
 * answers. The reducer underneath is tested in fourPlayerOnline.test.ts; this file is the layer that decides "one four_rejoin per gap", "a
 * move nobody answered rolls back AND re-reads the room", "a reconnect rejoins once", "a spectator can send nothing". The server side is
 * the real engine through the shared ServerSim, so every payload is genuine.
 */

interface Sent {
  event: string;
  payload: unknown;
  cb?: (err: unknown, ack?: unknown) => void;
  timeoutMs?: number;
  answered: boolean;
}

class FakeSocket implements FourSocket {
  connected = true;
  readonly sent: Sent[] = [];
  private handlers = new Map<string, Set<(...args: never[]) => void>>();
  private ioHandlers = new Map<string, Set<() => void>>();

  on(event: string, handler: (...args: never[]) => void): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)?.add(handler);
  }
  off(event: string, handler: (...args: never[]) => void): void {
    this.handlers.get(event)?.delete(handler);
  }
  emit(event: string, ...args: unknown[]): void {
    this.sent.push({ event, payload: args[0], answered: true });
  }
  timeout(ms: number) {
    return {
      emit: (event: string, payload: object, cb: (err: unknown, ack?: unknown) => void) => {
        this.sent.push({ event, payload, cb, timeoutMs: ms, answered: false });
      },
    };
  }
  io = {
    on: (event: string, handler: () => void) => {
      if (!this.ioHandlers.has(event)) this.ioHandlers.set(event, new Set());
      this.ioHandlers.get(event)?.add(handler);
    },
    off: (event: string, handler: () => void) => {
      this.ioHandlers.get(event)?.delete(handler);
    },
  };

  // --- the test's side ---
  serverEmit(event: string, payload: unknown): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) (handler as (p: unknown) => void)(payload);
  }
  ioEmit(event: string): void {
    for (const handler of [...(this.ioHandlers.get(event) ?? [])]) handler();
  }
  listenerCount(): number {
    let n = 0;
    for (const set of this.handlers.values()) n += set.size;
    for (const set of this.ioHandlers.values()) n += set.size;
    return n;
  }
  requests(event: string): Sent[] {
    return this.sent.filter((s) => s.event === event);
  }
  /** Answers the OLDEST unanswered request of `event` with `ack`. */
  reply(event: string, ack: unknown): void {
    const request = this.sent.find((s) => s.event === event && !s.answered && s.cb);
    if (!request?.cb) throw new Error(`no unanswered ${event} request`);
    request.answered = true;
    request.cb(undefined, ack);
  }
  /** The request times out (the server never answered). */
  silence(event: string): void {
    const request = this.sent.find((s) => s.event === event && !s.answered && s.cb);
    if (!request?.cb) throw new Error(`no unanswered ${event} request`);
    request.answered = true;
    request.cb(new Error('operation has timed out'));
  }
}

interface Harness {
  sim: ServerSim;
  socket: FakeSocket;
  session: FourOnlineSession;
  sounds: { san: string; captured?: 'p' }[];
  ended: () => number;
  logs: string[];
  states: FourSessionState[];
  tick: (ms: number) => void;
}

function harness(roleOf: (sim: ServerSim) => FourOnlineRole, sim = new ServerSim()): Harness {
  const socket = new FakeSocket();
  const sounds: { san: string; captured?: 'p' }[] = [];
  const logs: string[] = [];
  let ended = 0;
  let t = 1_000_000;
  const effects: FourSessionEffects = {
    now: () => t,
    moveSound: (m) => sounds.push(m),
    gameEnded: () => void (ended += 1),
    log: (m) => logs.push(m),
  };
  const session = new FourOnlineSession(socket, roleOf(sim), effects);
  const states: FourSessionState[] = [];
  session.subscribe((s) => states.push(s));
  session.start();
  return { sim, socket, session, sounds, ended: () => ended, logs, states, tick: (ms) => void (t += ms) };
}

const player = (seat: Seat = 0, resume = false) => harness((sim) => ({ kind: 'player', match: sim.match(seat), resume }));
const spectator = () => harness(() => ({ kind: 'spectator', roomId: ROOM }));

const stateOf = (h: Harness) => h.session.state;
const viewOf = (h: Harness) => {
  const view = stateOf(h).view;
  if (!view) throw new Error('no view');
  return view;
};

describe('lifecycle', () => {
  it('registers the five socket events plus reconnect, and stop() removes every one; nothing changes after stop', () => {
    const h = player();
    expect(h.socket.listenerCount()).toBe(6);
    const before = stateOf(h);
    h.session.stop();
    expect(h.socket.listenerCount()).toBe(0);
    const p = h.sim.play(mv(h.sim.state, 'e2', 'e4'));
    h.socket.serverEmit('four_state', p); // no listener left: nothing happens
    expect(stateOf(h)).toBe(before);
  });

  it('a spectator tells the server it left; a seated player does not (leaving is the connection dropping)', () => {
    const s = spectator();
    s.session.stop();
    expect(s.socket.requests('four_stop_spectating')).toHaveLength(1);
    const p = player();
    p.session.stop();
    expect(p.socket.requests('four_stop_spectating')).toHaveLength(0);
  });

  it('answers that arrive after stop() are ignored', () => {
    const h = player(0, true); // resume: a rejoin is in flight
    expect(h.socket.requests('four_rejoin')).toHaveLength(1);
    const before = stateOf(h);
    h.session.stop();
    h.sim.play(mv(h.sim.state, 'e2', 'e4'));
    h.socket.reply('four_rejoin', { ok: true, state: { ...h.sim.room(), seat: 0 } });
    expect(stateOf(h)).toBe(before);
  });
});

describe('a normal game', () => {
  it('plays the own move at once, hears everyone else\'s, never hears the own one twice, and keeps the move log', () => {
    const h = player(0);
    const move = mv(h.sim.state, 'e2', 'e4');
    h.session.sendMove(move);
    expect(h.sounds).toHaveLength(1); // the own move, heard when made
    expect(h.socket.requests('four_make_move')).toHaveLength(1);
    expect(h.socket.requests('four_make_move')[0].timeoutMs).toBe(FOUR_ACK_TIMEOUT_MS);
    expect(h.socket.requests('four_make_move')[0].payload).toStrictEqual({ roomId: ROOM, from: 'e2', to: 'e4' });
    expect(viewOf(h).pending?.id).toBe(1);

    h.socket.serverEmit('four_state', h.sim.play(move)); // the server's broadcast of that same move
    h.socket.reply('four_make_move', { ok: true, seq: 1 });
    expect(h.sounds, 'the own move is not heard again').toHaveLength(1);
    expect(viewOf(h).pending).toBeNull();
    expect(viewOf(h).seq).toBe(1);

    for (const p of h.sim.untilTurn(0)) h.socket.serverEmit('four_state', p);
    expect(h.sounds).toHaveLength(4); // 1 own + 3 bots
    expect(viewOf(h).seq).toBe(4);
    expect(viewOf(h).log).toHaveLength(4);
    expect(viewOf(h).state.turn).toBe(0);
  });

  it('a capture is announced as a capture', () => {
    const h = player(0);
    h.sim.state = h.sim.state; // (kept: the simulator's state is the server's)
    const capture = { ...mv(h.sim.state, 'e2', 'e4'), captured: 0 };
    void capture;
    // a real capture needs a real position: take the first capture a bot finds in a long game
    let found = false;
    for (let i = 0; i < 400 && !found && !h.sim.state.result; i++) {
      const p = h.sim.bot();
      h.socket.serverEmit('four_state', p);
      if (p.move?.label.includes('x')) found = true;
    }
    expect(found).toBe(true);
    expect(h.sounds.some((s) => s.captured === 'p')).toBe(true);
    expect(h.sounds.every((s) => (s.captured === 'p') === s.san.includes('x'))).toBe(true);
  });
});

describe('the player\'s move: refusal, silence, ordering of ack and state', () => {
  it('a refused move rolls back, re-keys the board, shows the message and does NOT re-read the room', () => {
    const h = player(0);
    const before = serialize(viewOf(h).state);
    h.session.sendMove(mv(h.sim.state, 'e2', 'e4'));
    expect(serialize(displayState(viewOf(h)))).not.toBe(before);
    const keyBefore = stateOf(h).boardKey;
    h.socket.reply('four_make_move', { ok: false, error: 'It is not your turn.' });
    expect(viewOf(h).pending).toBeNull();
    expect(displayState(viewOf(h))).toBe(viewOf(h).state);
    expect(serialize(viewOf(h).state)).toBe(before);
    expect(viewOf(h).moveError).toBe('It is not your turn.');
    expect(stateOf(h).boardKey).toBe(keyBefore + 1);
    expect(h.socket.requests('four_rejoin'), 'a refusal is an answer: nothing to re-read').toHaveLength(0);
    // and the player can try again
    h.session.sendMove(mv(h.sim.state, 'd2', 'd4'));
    expect(h.socket.requests('four_make_move')).toHaveLength(2);
  });

  it('a move nobody answers rolls back AND re-reads the room exactly once (it may or may not have been applied)', () => {
    const h = player(0);
    h.session.sendMove(mv(h.sim.state, 'e2', 'e4'));
    h.socket.silence('four_make_move');
    expect(viewOf(h).pending).toBeNull();
    expect(viewOf(h).moveError).toBe('The move was not confirmed by the server.');
    expect(h.socket.requests('four_rejoin')).toHaveLength(1);
    expect(viewOf(h).resyncing).toBe(true);
    // while re-reading, no moves
    h.session.sendMove(mv(h.sim.state, 'd2', 'd4'));
    expect(h.socket.requests('four_make_move')).toHaveLength(1);
    // the server HAD applied the move: the answer carries it
    h.sim.play(mv(h.sim.state, 'e2', 'e4'));
    h.socket.reply('four_rejoin', { ok: true, state: { ...h.sim.room(), seat: 0 } });
    expect(viewOf(h).resyncing).toBe(false);
    expect(viewOf(h).seq).toBe(1);
    expect(serialize(viewOf(h).state)).toBe(serialize(h.sim.state));
    expect(stateOf(h).connection).toBe('connected');
  });

  it('an ack that arrives BEFORE its state keeps the move pending until the state comes', () => {
    const h = player(0);
    const move = mv(h.sim.state, 'e2', 'e4');
    h.session.sendMove(move);
    h.socket.reply('four_make_move', { ok: true, seq: 1 });
    expect(viewOf(h).pending?.id, 'accepted, but not yet confirmed by its snapshot').toBe(1);
    h.socket.serverEmit('four_state', h.sim.play(move));
    expect(viewOf(h).pending).toBeNull();
  });

  it('a move refused because the flag had already fallen: the elimination state clears the optimistic copy, the late refusal only adds its message', () => {
    const h = player(0);
    h.session.sendMove(mv(h.sim.state, 'e2', 'e4'));
    const keyBefore = stateOf(h).boardKey;
    h.socket.serverEmit('four_state', h.sim.resignSeat(0)); // the server eliminated Red for time
    expect(viewOf(h).pending).toBeNull();
    h.socket.reply('four_make_move', { ok: false, error: 'Your time ran out.' });
    expect(viewOf(h).moveError).toBe('Your time ran out.');
    expect(viewOf(h).state.status[0]).not.toBe('active');
    expect(stateOf(h).boardKey, 'nothing was rolled back, so the board is not re-keyed').toBe(keyBefore);
  });

  it('sends nothing when the player may not move: another seat\'s turn, a move pending, offline, resyncing, a spectator', () => {
    const h = player(1); // Blue: Red moves first
    h.session.sendMove(legalMoves(initialState(), 1)[0]);
    expect(h.socket.requests('four_make_move')).toHaveLength(0);

    const mine = player(0);
    const move = mv(mine.sim.state, 'e2', 'e4');
    mine.session.sendMove(move);
    mine.session.sendMove(mv(mine.sim.state, 'd2', 'd4'));
    expect(mine.socket.requests('four_make_move'), 'one at a time').toHaveLength(1);

    const offline = player(0);
    offline.socket.connected = false;
    offline.socket.serverEmit('disconnect', undefined);
    offline.session.sendMove(move);
    expect(offline.socket.requests('four_make_move')).toHaveLength(0);

    const watcher = spectator();
    watcher.socket.reply('four_spectate_game', { ok: true, state: watcher.sim.room() });
    watcher.session.sendMove(move);
    watcher.session.resign(() => {});
    watcher.session.sendChat('hello');
    expect(watcher.socket.sent.map((s) => s.event)).toStrictEqual(['four_spectate_game']);
  });
});

describe('gaps and unreadable states', () => {
  it('a gap sends exactly one four_rejoin however many later states arrive, and the answer repairs the view', () => {
    const h = player(0);
    const p = [h.sim.play(mv(h.sim.state, 'e2', 'e4')), h.sim.bot(), h.sim.bot(), h.sim.bot(), h.sim.bot(), h.sim.bot()];
    h.socket.serverEmit('four_state', p[0]);
    h.socket.serverEmit('four_state', p[1]);
    // p[2], p[3] are lost
    h.socket.serverEmit('four_state', p[4]);
    h.socket.serverEmit('four_state', p[5]);
    expect(h.socket.requests('four_rejoin')).toHaveLength(1);
    expect(h.socket.requests('four_rejoin')[0].payload).toStrictEqual({ roomId: ROOM, playerToken: 'token-0' });
    expect(h.socket.requests('four_rejoin')[0].timeoutMs).toBe(FOUR_ACK_TIMEOUT_MS);
    expect(viewOf(h).seq).toBe(2);
    expect(viewOf(h).resyncing).toBe(true);

    const keyBefore = stateOf(h).boardKey;
    h.socket.reply('four_rejoin', { ok: true, state: { ...h.sim.room(), seat: 0 } });
    expect(viewOf(h).seq).toBe(6);
    expect(viewOf(h).resyncing).toBe(false);
    expect(serialize(viewOf(h).state)).toBe(serialize(h.sim.state));
    expect(stateOf(h).boardKey).toBe(keyBefore + 1);

    // the next gap may ask again
    const q = [h.sim.bot(), h.sim.bot()];
    h.socket.serverEmit('four_state', q[1]);
    expect(h.socket.requests('four_rejoin')).toHaveLength(2);
  });

  it('an unreadable state asks for the room once', () => {
    const h = player(0);
    const p = h.sim.play(mv(h.sim.state, 'e2', 'e4'));
    h.socket.serverEmit('four_state', { ...p, state: 'garbage' });
    h.socket.serverEmit('four_state', { ...p, state: 'garbage' });
    expect(h.socket.requests('four_rejoin')).toHaveLength(1);
    expect(viewOf(h).seq).toBe(0);
  });

  it('a rejoin nobody answers lets the next gap try again, and shows what the socket itself says', () => {
    const h = player(0);
    const p = [h.sim.play(mv(h.sim.state, 'e2', 'e4')), h.sim.bot(), h.sim.bot()];
    h.socket.serverEmit('four_state', p[2]); // gap
    expect(h.socket.requests('four_rejoin')).toHaveLength(1);
    h.socket.silence('four_rejoin');
    expect(viewOf(h).resyncing).toBe(false);
    expect(stateOf(h).connection).toBe('connected');
    h.socket.serverEmit('four_state', h.sim.bot()); // still behind: asks again
    expect(h.socket.requests('four_rejoin')).toHaveLength(2);
    h.socket.connected = false;
    h.socket.silence('four_rejoin');
    expect(stateOf(h).connection).toBe('reconnecting');
  });

  it('states for another room are ignored without a request', () => {
    const h = player(0);
    const p = h.sim.play(mv(h.sim.state, 'e2', 'e4'));
    h.socket.serverEmit('four_state', { ...p, roomId: OTHER_ROOM, seq: 9 });
    expect(h.socket.requests('four_rejoin')).toHaveLength(0);
    expect(viewOf(h).seq).toBe(0);
  });
});

describe('reconnecting', () => {
  it('a dropped connection shows "reconnecting"; the reconnect rejoins once and adopts the room', () => {
    const h = player(0);
    h.socket.connected = false;
    h.socket.serverEmit('disconnect', 'transport close');
    expect(stateOf(h).connection).toBe('reconnecting');
    // the room moved on while we were away
    h.sim.play(mv(h.sim.state, 'e2', 'e4'));
    h.sim.untilTurn(0);
    h.socket.connected = true;
    h.socket.ioEmit('reconnect');
    h.socket.ioEmit('reconnect'); // a second event while the first rejoin is in flight asks for nothing more
    expect(h.socket.requests('four_rejoin')).toHaveLength(1);
    h.socket.reply('four_rejoin', { ok: true, state: { ...h.sim.room(), seat: 0 } });
    expect(stateOf(h).connection).toBe('connected');
    expect(viewOf(h).seq).toBe(h.sim.seq);
    expect(serialize(viewOf(h).state)).toBe(serialize(h.sim.state));
    expect(viewOf(h).log).toHaveLength(h.sim.log.length);
  });

  it('a rejoin that finds the game already ended shows the result (and does not buzz the phone for a game that ended while away)', () => {
    const h = player(0);
    h.socket.serverEmit('disconnect', undefined);
    h.sim.resignSeat(1);
    h.sim.resignSeat(2);
    h.sim.resignSeat(3);
    expect(h.sim.state.result).not.toBeNull();
    h.socket.ioEmit('reconnect');
    h.socket.reply('four_rejoin', { ok: true, finished: true, gameOver: h.sim.over() });
    expect(viewOf(h).gameOver?.reason).toBe(h.sim.state.result?.reason);
    expect(stateOf(h).connection).toBe('connected');
    expect(h.ended()).toBe(0);
  });

  it('a rejoin the server cannot find ends in "unavailable" with the reason - never "reconnecting" for ever - and no moves go out', () => {
    const h = player(0);
    h.socket.serverEmit('disconnect', undefined);
    h.socket.ioEmit('reconnect');
    h.socket.reply('four_rejoin', { ok: false, error: 'Game not found.' });
    expect(stateOf(h).connection).toBe('unavailable');
    expect(stateOf(h).problem).toBe('Game not found.');
    expect(viewOf(h).resyncing).toBe(false);
    h.session.sendMove(mv(h.sim.state, 'e2', 'e4'));
    expect(h.socket.requests('four_make_move')).toHaveLength(0);
  });

  it('SURVIVOR - a malformed rejoin answer ends in an explicit state with the right reason, never a hang or a throw', () => {
    const UNEXPECTED = 'Unexpected reply from the server.';
    const READ = 'The game could not be read from the server.';
    const cases: [unknown, 'unavailable' | 'connected', string | null][] = [
      [undefined, 'connected', null], // no answer at all: the socket's own state is shown, the next gap may try again
      [null, 'connected', null],
      [{}, 'unavailable', UNEXPECTED],
      [{ ok: true }, 'unavailable', UNEXPECTED],
      [{ ok: true, state: null }, 'unavailable', UNEXPECTED],
      [{ ok: false }, 'unavailable', UNEXPECTED], // a refusal with no reason
      [5, 'unavailable', UNEXPECTED], // a primitive: "'finished' in 5" would throw inside the classifier
      ['x', 'unavailable', UNEXPECTED],
      [true, 'unavailable', UNEXPECTED],
      [{ ok: true, state: { ...new ServerSim().room(), state: 'junk', seat: 0 } }, 'unavailable', READ],
    ];
    for (const [junk, connection, problem] of cases) {
      const h = player(0);
      h.socket.ioEmit('reconnect');
      h.socket.reply('four_rejoin', junk);
      expect(stateOf(h).connection, JSON.stringify(junk)).toBe(connection);
      expect(stateOf(h).problem, JSON.stringify(junk)).toBe(problem);
      expect(viewOf(h).resyncing, JSON.stringify(junk)).toBe(false);
    }
  });

  it('once the game is over, a disconnect and a reconnect change nothing and ask for nothing', () => {
    const h = player(0);
    h.socket.serverEmit('four_game_over', h.sim.over('abandoned'));
    const before = stateOf(h);
    h.socket.serverEmit('disconnect', undefined);
    expect(stateOf(h)).toBe(before);
    h.socket.ioEmit('reconnect');
    expect(h.socket.requests('four_rejoin')).toHaveLength(0);
    expect(stateOf(h).connection).toBe('connected');
  });

  it('a screen reopened for a game in progress (resume) rejoins at once and waits for the answer', () => {
    const h = player(0, true);
    expect(stateOf(h).connection).toBe('reconnecting');
    expect(h.socket.requests('four_rejoin')).toHaveLength(1);
    expect(viewOf(h).resyncing).toBe(true);
    h.sim.play(mv(h.sim.state, 'e2', 'e4'));
    h.sim.untilTurn(0);
    h.socket.reply('four_rejoin', { ok: true, state: { ...h.sim.room(), seat: 0 } });
    expect(stateOf(h).connection).toBe('connected');
    expect(viewOf(h).seq).toBe(h.sim.seq);
    expect(viewOf(h).state.turn).toBe(0);
  });
});

describe('the end of the game, seats and chat', () => {
  it('four_game_over shows the result once, buzzes once, and nothing after it changes it', () => {
    const h = player(0);
    h.socket.serverEmit('four_game_over', h.sim.over('abandoned'));
    expect(viewOf(h).gameOver?.reason).toBe('abandoned');
    expect(h.ended()).toBe(1);
    h.socket.serverEmit('four_game_over', h.sim.over('elimination'));
    expect(viewOf(h).gameOver?.reason, 'the first result wins').toBe('abandoned');
    expect(h.ended()).toBe(1);
    const before = stateOf(h).view;
    h.socket.serverEmit('four_state', h.sim.play(mv(h.sim.state, 'e2', 'e4')));
    expect(stateOf(h).view).toBe(before);
    expect(h.socket.requests('four_rejoin')).toHaveLength(0);
  });

  it('a game that ends with a final state buzzes once, not again at four_game_over', () => {
    const h = player(0);
    const resigns = [h.sim.resignSeat(1), h.sim.resignSeat(2), h.sim.resignSeat(3)];
    for (const p of resigns) h.socket.serverEmit('four_state', p);
    expect(viewOf(h).state.result).not.toBeNull();
    expect(h.ended()).toBe(1);
    h.socket.serverEmit('four_game_over', h.sim.over());
    expect(h.ended()).toBe(1);
    expect(viewOf(h).gameOver).not.toBeNull();
  });

  it('a seat update replaces the seats (a takeover shows at once); one for another room is ignored', () => {
    const h = player(0);
    const seats: FourSeats = seatsOf({ 1: { kind: 'bot', botReason: 'takeover', name: 'Ben' } });
    h.socket.serverEmit('four_seat_update', { roomId: ROOM, seats });
    expect(viewOf(h).seats[1].botReason).toBe('takeover');
    h.socket.serverEmit('four_seat_update', { roomId: OTHER_ROOM, seats: seatsOf() });
    expect(viewOf(h).seats[1].botReason).toBe('takeover');
  });

  it('chat: incoming lines count as unread until read; the own line is added at once and sent normalised; blanks are not sent', () => {
    const h = player(0);
    h.socket.serverEmit('four_chat_message', { fromSeat: 2, name: 'Cy', text: 'gl hf', sentAt: 1 });
    h.socket.serverEmit('four_chat_message', { fromSeat: 3, name: 'Di', text: 'you too', sentAt: 2 });
    expect(stateOf(h).chat.map((c) => c.text)).toStrictEqual(['gl hf', 'you too']);
    expect(stateOf(h).chatUnread).toBe(2);
    h.session.markChatRead();
    expect(stateOf(h).chatUnread).toBe(0);

    h.session.sendChat('  hello table  ');
    h.session.sendChat('   ');
    h.session.sendChat('');
    expect(h.socket.requests('four_send_chat')).toHaveLength(1);
    expect(h.socket.requests('four_send_chat')[0].payload).toStrictEqual({ roomId: ROOM, text: 'hello table' });
    const last = stateOf(h).chat[stateOf(h).chat.length - 1];
    expect(last).toMatchObject({ mine: true, name: 'You', text: 'hello table', fromSeat: null });
    h.socket.reply('four_send_chat', { ok: false, error: 'Slow down.' });
    expect(h.logs.some((l) => l.includes('Slow down.'))).toBe(true);
  });

  it('resign sends one request and reports a refusal or silence to the caller', () => {
    const h = player(0);
    const errors: string[] = [];
    h.session.resign((m) => errors.push(m));
    h.socket.reply('four_resign', { ok: false, error: 'The game is over.' });
    h.session.resign((m) => errors.push(m));
    h.socket.silence('four_resign');
    h.session.resign((m) => errors.push(m));
    h.socket.reply('four_resign', { ok: true });
    expect(errors).toStrictEqual(['The game is over.', 'The server did not answer.']);
    expect(h.socket.requests('four_resign')[0].payload).toStrictEqual({ roomId: ROOM });
  });
});

describe('spectating', () => {
  it('asks for the room on start, builds a seat-less view from the answer, follows the game and reads the chat - and sends nothing else', () => {
    const h = spectator();
    expect(h.socket.requests('four_spectate_game')).toHaveLength(1);
    expect(h.socket.requests('four_spectate_game')[0].payload).toStrictEqual({ roomId: ROOM });
    expect(stateOf(h).view).toBeNull();
    h.sim.play(mv(h.sim.state, 'e2', 'e4'));
    h.socket.reply('four_spectate_game', { ok: true, state: h.sim.room() });
    expect(viewOf(h).mySeat).toBeNull();
    expect(viewOf(h).seq).toBe(1);
    expect(stateOf(h).connection).toBe('connected');

    h.socket.serverEmit('four_state', h.sim.bot());
    h.socket.serverEmit('four_state', h.sim.bot());
    expect(viewOf(h).seq).toBe(3);
    h.socket.serverEmit('four_chat_message', { fromSeat: 0, name: 'Ana', text: 'hi', sentAt: 1 });
    expect(stateOf(h).chat).toHaveLength(1);
    expect(h.socket.sent.map((s) => s.event)).toStrictEqual(['four_spectate_game']);
  });

  it('a refused spectate (game not found / finished) is shown with its reason; a silent server says so', () => {
    const refused = spectator();
    refused.socket.reply('four_spectate_game', { ok: false, error: 'Game not found.' });
    expect(stateOf(refused).view).toBeNull();
    expect(stateOf(refused).problem).toBe('Game not found.');
    expect(stateOf(refused).connection).toBe('unavailable');

    const silent = spectator();
    silent.socket.silence('four_spectate_game');
    expect(stateOf(silent).problem).toMatch(/did not answer/);
  });

  it('after a reconnect a spectator asks to watch again and adopts the newer room', () => {
    const h = spectator();
    h.socket.reply('four_spectate_game', { ok: true, state: h.sim.room() });
    h.socket.serverEmit('disconnect', undefined);
    expect(stateOf(h).connection).toBe('reconnecting');
    h.sim.play(mv(h.sim.state, 'e2', 'e4'));
    h.sim.untilTurn(0);
    h.socket.ioEmit('reconnect');
    expect(h.socket.requests('four_spectate_game')).toHaveLength(2);
    h.socket.reply('four_spectate_game', { ok: true, state: h.sim.room() });
    expect(viewOf(h).seq).toBe(h.sim.seq);
    expect(stateOf(h).connection).toBe('connected');
  });

  it('a gap for a spectator re-asks to watch (there is no rejoin for someone without a seat)', () => {
    const h = spectator();
    h.socket.reply('four_spectate_game', { ok: true, state: h.sim.room() });
    h.sim.bot();
    h.socket.serverEmit('four_state', h.sim.bot());
    expect(h.socket.requests('four_rejoin')).toHaveLength(0);
    expect(h.socket.requests('four_spectate_game')).toHaveLength(2);
  });
});

describe('hostile input never throws out of a socket callback and never changes the game', () => {
  const junk: unknown[] = [undefined, null, 0, 1, -1, NaN, '', 'x', true, [], [1, 2], {}, { roomId: ROOM }, { roomId: ROOM, seq: 'a' }, { roomId: ROOM, seq: 1, state: 5 }, { seats: 5 }, () => 1, Symbol('s')];

  it('junk payloads to every server event are dropped', () => {
    const h = player(0);
    const before = stateOf(h).view;
    for (const event of ['four_state', 'four_seat_update', 'four_game_over', 'four_chat_message']) {
      for (const payload of junk) {
        expect(() => h.socket.serverEmit(event, payload), `${event} ${String(payload)}`).not.toThrow();
      }
    }
    // junk chat is not a chat line; the game itself is untouched
    expect(stateOf(h).chat).toHaveLength(0);
    expect(viewOf(h).state).toBe(before?.state);
    expect(viewOf(h).gameOver).toBeNull();
    expect(viewOf(h).seq).toBe(0);
  });

  it('junk acks to a move, a rejoin and a spectate request are survived', () => {
    for (const ack of junk) {
      const h = player(0);
      h.session.sendMove(mv(h.sim.state, 'e2', 'e4'));
      expect(() => h.socket.reply('four_make_move', ack), `move ack ${String(ack)}`).not.toThrow();
      const g = player(0, true);
      expect(() => g.socket.reply('four_rejoin', ack), `rejoin ack ${String(ack)}`).not.toThrow();
      const s = spectator();
      expect(() => s.socket.reply('four_spectate_game', ack), `spectate ack ${String(ack)}`).not.toThrow();
    }
  });

  it('a pseudo-random flood of valid and broken events leaves the view equal to the server\'s once the room is re-read', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const h = player(0);
    const sent: ReturnType<ServerSim['bot']>[] = [];
    for (let i = 0; i < 60 && !h.sim.state.result; i++) {
      const p = h.sim.state.turn === 0 ? h.sim.play(legalMoves(h.sim.state, 0)[0], 'human') : h.sim.bot();
      sent.push(p);
      const r = rnd();
      if (r < 0.55) h.socket.serverEmit('four_state', p); // delivered
      else if (r < 0.7) h.socket.serverEmit('four_state', p), h.socket.serverEmit('four_state', p); // duplicated
      else if (r < 0.85) void 0; // lost
      else h.socket.serverEmit('four_state', { ...p, state: 'broken' });
      if (rnd() < 0.2 && sent.length > 2) h.socket.serverEmit('four_state', sent[Math.floor(rnd() * sent.length)]); // a late old one
      // whenever the client asked for the room, the server answers with its truth
      while (h.socket.sent.some((s) => s.event === 'four_rejoin' && !s.answered)) h.socket.reply('four_rejoin', { ok: true, state: { ...h.sim.room(), seat: 0 } });
    }
    // final catch-up exactly as a reconnect would do
    h.socket.ioEmit('reconnect');
    while (h.socket.sent.some((s) => s.event === 'four_rejoin' && !s.answered)) h.socket.reply('four_rejoin', { ok: true, state: { ...h.sim.room(), seat: 0 } });
    expect(viewOf(h).seq).toBe(h.sim.seq);
    expect(serialize(viewOf(h).state)).toBe(serialize(h.sim.state));
    expect(viewOf(h).log.map((l) => l.text)).toStrictEqual(h.sim.log.map((l) => l.text));
    expect(clocksToWireMs(h.sim.clocks)).toStrictEqual(viewOf(h).clocksMs);
  });
});

// keep the type import used even if a test above changes
export type _RoomShape = FourRoomState;
export type _MoveShape = Move;

describe('answers that race a live result, and results the client cannot read', () => {
  it('a four_game_over that lands while a rejoin is in flight stays on screen; the late answer cannot disturb it', () => {
    const h = player(0);
    h.socket.ioEmit('reconnect'); // rejoin in flight
    h.socket.serverEmit('four_game_over', h.sim.over('abandoned'));
    const shown = viewOf(h).gameOver;
    h.socket.reply('four_rejoin', { ok: true, state: { ...h.sim.room(), seat: 0 } });
    expect(viewOf(h).gameOver).toBe(shown);
    expect(stateOf(h).connection).toBe('connected');
    expect(viewOf(h).resyncing).toBe(false);
  });

  it('a "finished" rejoin answer carrying an unreadable result ends in "unavailable", not an eternal "catching up"', () => {
    const h = player(0);
    h.socket.ioEmit('reconnect');
    h.socket.reply('four_rejoin', { ok: true, finished: true, gameOver: { roomId: ROOM } });
    expect(stateOf(h).connection).toBe('unavailable');
    expect(viewOf(h).resyncing).toBe(false);
  });

  it('a junk four_game_over is dropped and does not buzz the phone', () => {
    const h = player(0);
    h.socket.serverEmit('four_game_over', { roomId: ROOM, reason: 'elimination' });
    expect(viewOf(h).gameOver).toBeNull();
    expect(h.ended()).toBe(0);
  });
});

// --- Mutation survivors, closed one cluster at a time ---------------------------------------------------------------------------------

describe('SURVIVOR CLUSTER 5 - a result that is already on screen is never disturbed by a rejoin that was in flight', () => {
  it('a state answer arriving after a live four_game_over changes nothing: same result object, board not re-keyed, no error', () => {
    const h = player(0);
    h.socket.ioEmit('reconnect'); // rejoin in flight
    h.socket.serverEmit('four_game_over', h.sim.over('abandoned'));
    const shown = viewOf(h).gameOver;
    const keyBefore = stateOf(h).boardKey;
    h.socket.reply('four_rejoin', { ok: true, state: { ...h.sim.room(), seat: 0 } });
    expect(viewOf(h).gameOver).toBe(shown);
    expect(stateOf(h).boardKey, 'a board re-key would throw away the player\'s review of the final position').toBe(keyBefore);
    expect(stateOf(h).connection).toBe('connected');
    expect(stateOf(h).problem).toBeNull();
  });

  it('a "finished" answer arriving after the same result was shown live is NOT an error (the result is already there)', () => {
    const h = player(0);
    h.socket.ioEmit('reconnect');
    h.socket.serverEmit('four_game_over', h.sim.over('abandoned'));
    h.socket.reply('four_rejoin', { ok: true, finished: true, gameOver: h.sim.over('abandoned') });
    expect(stateOf(h).connection, 'not "unavailable"').toBe('connected');
    expect(stateOf(h).problem).toBeNull();
    expect(viewOf(h).gameOver?.reason).toBe('abandoned');
  });

  it('a "game not found" answer arriving after the result was shown live does not turn the screen into an error either', () => {
    const h = player(0);
    h.socket.ioEmit('reconnect');
    h.socket.serverEmit('four_game_over', h.sim.over('abandoned'));
    h.socket.reply('four_rejoin', { ok: false, error: 'Game not found.' });
    expect(stateOf(h).connection).toBe('connected');
    expect(stateOf(h).problem).toBeNull();
  });
});

describe('SURVIVOR CLUSTER 6 - nothing a stopped session receives can change its state', () => {
  it('a move ack, a chat line and a read-marker after stop() are all ignored (the subscriber is never called again)', () => {
    const h = player(0);
    h.session.sendMove(mv(h.sim.state, 'e2', 'e4'));
    const calls = h.states.length;
    const before = stateOf(h);
    h.session.stop();
    h.socket.reply('four_make_move', { ok: false, error: 'late refusal' }); // the ack callback is still held by the (fake) socket
    h.session.sendChat('too late');
    h.session.markChatRead();
    expect(h.states.length, 'the subscriber must not hear anything after stop').toBe(calls);
    expect(stateOf(h)).toBe(before);
    expect(viewOf(h).pending, 'the late refusal did not roll anything back on a screen that is gone').not.toBeNull();
  });
});

describe('SURVIVOR CLUSTER 7 - the guards around callbacks', () => {
  it('a throwing logger inside the rejoin handler still releases the resync flag (the recovery does not depend on the log)', () => {
    const sim = new ServerSim();
    const socket = new FakeSocket();
    const effects: FourSessionEffects = {
      now: () => 1_000_000,
      moveSound: () => {},
      gameEnded: () => {},
      log: (message) => {
        if (message.includes('four_rejoin state')) throw new Error('the log is broken');
      },
    };
    const session = new FourOnlineSession(socket, { kind: 'player', match: sim.match(0), resume: true }, effects);
    session.start();
    expect(session.state.view?.resyncing).toBe(true);
    socket.reply('four_rejoin', { ok: true, state: { ...sim.room(), seat: 0 } }); // the handler throws at its log line
    expect(session.state.view?.resyncing, 'released by the failure path').toBe(false);
    expect(session.state.connection).toBe('connected');
  });

  it('even a logger that always throws cannot let a callback escape', () => {
    const sim = new ServerSim();
    const socket = new FakeSocket();
    const effects: FourSessionEffects = {
      now: () => 1,
      moveSound: () => {},
      gameEnded: () => {},
      log: () => {
        throw new Error('always');
      },
    };
    const session = new FourOnlineSession(socket, { kind: 'player', match: sim.match(0), resume: false }, effects);
    session.start();
    expect(() => socket.serverEmit('four_state', null)).not.toThrow();
    expect(() => socket.serverEmit('four_state', { roomId: ROOM, seq: 1, state: 'x' })).not.toThrow();
  });

  it('after the game ended, a reconnect does not even try (nothing is logged as a rejoin)', () => {
    const h = player(0);
    h.socket.serverEmit('four_game_over', h.sim.over('abandoned'));
    h.socket.serverEmit('disconnect', undefined);
    h.socket.ioEmit('reconnect');
    expect(h.logs.some((l) => l.includes('restored, rejoining'))).toBe(false);
    expect(h.socket.requests('four_rejoin')).toHaveLength(0);
  });
});

describe('SURVIVOR CLUSTER 8 - chat from the server is only trusted as far as its shape', () => {
  it('a sender seat outside 0-3 (or not a number) is shown as an unattributed line, never as a bogus seat colour', () => {
    const h = player(0);
    for (const fromSeat of [9, -1, 1.5, '2', null, undefined, NaN]) h.socket.serverEmit('four_chat_message', { fromSeat, name: 'X', text: 'hi', sentAt: 1 });
    expect(stateOf(h).chat).toHaveLength(7);
    expect(stateOf(h).chat.every((c) => c.fromSeat === null)).toBe(true);
    h.socket.serverEmit('four_chat_message', { fromSeat: 2, name: 'Cy', text: 'hi', sentAt: 1 });
    expect(stateOf(h).chat[7].fromSeat).toBe(2);
  });
});

describe('GUARD DEFECT - a throwing logger must neither escape nor skip the recovery that follows it', () => {
  it('NAMED GUARD - with a logger that ALWAYS throws, a failing rejoin handler still clears the resync flag and nothing escapes', () => {
    // The defect: the callback guard logged first, unprotected. A logger that threw (here: every message) made the guard itself throw, so the
    // recovery after the log - releasing the resync flag - never ran, and the screen sat on "catching up" for ever.
    const sim = new ServerSim();
    const socket = new FakeSocket();
    const effects: FourSessionEffects = {
      now: () => 1_000_000,
      moveSound: () => {},
      gameEnded: () => {},
      log: () => {
        throw new Error('the log always throws');
      },
    };
    const session = new FourOnlineSession(socket, { kind: 'player', match: sim.match(0), resume: true }, effects);
    session.start();
    expect(session.state.view?.resyncing).toBe(true); // the rejoin is in flight
    // The server answers with a perfectly good room; the handler's own log line throws, which the guard must contain AND recover from.
    expect(() => socket.reply('four_rejoin', { ok: true, state: { ...sim.room(), seat: 0 } })).not.toThrow();
    expect(session.state.view?.resyncing, 'the recovery ran even though every log call throws').toBe(false);
    expect(session.state.connection).toBe('connected');
  });
});
