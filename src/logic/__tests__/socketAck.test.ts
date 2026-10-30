import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { emitWithin, SOCKET_ACK_DEADLINE_MS } from '../../api/socketAck';

/**
 * Socket requests end too (offline-states branch). `socket.emit(event, payload, ack)` on a socket that never connects buffers the event and never calls `ack`, so a screen waiting for
 * it spun for ever (Spectate list, Tournament standings, creating / joining a tournament or a challenge). `emitWithin` is the form with a deadline.
 */
interface Call {
  ms: number;
  event: string;
  payload: unknown;
}
/** A socket whose `timeout(ms).emit(...)` records the call and lets the test answer it (or time it out) like socket.io does: `(err, ack)`. */
function fakeSocket() {
  const calls: Call[] = [];
  let reply: (err: unknown, ack?: unknown) => void = () => {};
  const socket = {
    timeout: (ms: number) => ({
      emit: (event: string, payload: unknown, callback: (err: unknown, ack?: unknown) => void) => {
        calls.push({ ms, event, payload });
        reply = callback;
      },
    }),
  };
  return { socket: socket as never, calls, answer: (err: unknown, ack?: unknown) => reply(err, ack) };
}

describe('emitWithin', () => {
  it('the deadline is 6000 ms', () => {
    expect(SOCKET_ACK_DEADLINE_MS).toBe(6000);
  });

  it('asks with the 6000 ms deadline by default, naming the event and the payload', () => {
    const { socket, calls } = fakeSocket();
    emitWithin(socket, 'list_active_games', { a: 1 }, () => {});
    expect(calls).toEqual([{ ms: 6000, event: 'list_active_games', payload: { a: 1 } }]);
  });

  it('a deadline can be given', () => {
    const { socket, calls } = fakeSocket();
    emitWithin(socket, 'e', {}, () => {}, 5000);
    expect(calls[0].ms).toBe(5000);
  });

  it('hands the server\'s answer on as { unreachable: false, ack }', () => {
    const { socket, answer } = fakeSocket();
    const done = vi.fn();
    emitWithin(socket, 'e', {}, done);
    answer(null, { ok: true, games: [] });
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith({ unreachable: false, ack: { ok: true, games: [] } });
  });

  it('a timeout error is { unreachable: true }', () => {
    const { socket, answer } = fakeSocket();
    const done = vi.fn();
    emitWithin(socket, 'e', {}, done);
    answer(new Error('operation has timed out'));
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith({ unreachable: true });
  });

  it('an answer that is missing is { unreachable: true } too', () => {
    const { socket, answer } = fakeSocket();
    const done = vi.fn();
    emitWithin(socket, 'e', {}, done);
    answer(null, undefined);
    expect(done).toHaveBeenCalledWith({ unreachable: true });
  });

  it('a falsy but present answer is still an answer', () => {
    const { socket, answer } = fakeSocket();
    const done = vi.fn();
    emitWithin(socket, 'e', {}, done);
    answer(null, 0);
    expect(done).toHaveBeenCalledWith({ unreachable: false, ack: 0 });
  });
});

describe('the screens that wait for a socket answer use it', () => {
  const root = path.resolve(__dirname, '..', '..', '..');
  const waiting = [
    'list_active_games',
    'spectate_game',
    'get_tournament_standings',
    'create_tournament',
    'join_tournament',
    'start_tournament',
    'create_challenge',
    'join_challenge',
  ];
  const screens = ['SpectateListScreen', 'SpectatorGameScreen', 'TournamentStandingsScreen', 'TournamentScreen', 'ChallengeScreen'];
  const sources = screens.map((name) => ({ name, text: readFileSync(path.join(root, 'src', 'screens', `${name}.tsx`), 'utf8') }));

  it('no bare `.emit(<event>, ...)` with a callback for those events: they all go through emitWithin', () => {
    for (const { name, text } of sources) {
      for (const event of waiting) {
        expect(text, `${name} emits ${event} without a deadline`).not.toMatch(new RegExp(`\\.emit\\(\\s*'${event}'`));
      }
    }
  });

  it('every one of those events is sent with emitWithin somewhere', () => {
    const all = sources.map((s) => s.text).join('\n');
    for (const event of waiting) expect(all, event).toMatch(new RegExp(`emitWithin<[^\\n]*>\\(\\s*[^,]+,\\s*'${event}'`));
  });
});
