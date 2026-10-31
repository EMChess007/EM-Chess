import { describe, expect, it } from 'vitest';
import { createMatch, serializeMatch, settle } from '../bughouse';
import type { BugSeats, BugSpectateState, BugStatePayload } from '../bughouse/wire';
import { SOCKET_ACK_DEADLINE_MS } from '../../api/socketAck';
import { BughouseOnlineSession, type BughouseSessionEffects } from '../bughouseOnlineSession';
import { viewFromSpectate } from '../bughouseOnline';
import { matchIntroLine, seatDisplayName, spectatorSeatConfig, spectatorStandardSeatConfig } from '../bughouseOnlineUi';
import { buildSpectateRows, describeBughouseGame } from '../fourPlayerOnlineUi';
import { deriveBughouseLayout, needsRotateOverlay } from '../bughouseLayout';
import { FakeBugSocket } from '../../test/fakeBugSocket';

/**
 * SPECTATING A BUGHOUSE GAME (W4b; BUGHOUSE_SPEC.md HP6). A spectator joins the room's stream with `bug_spectate_game` and then receives the same `bug_state` / `bug_seat_update` /
 * `bug_game_over` as a player; it owns no seat, so nothing it does can send an action, a resignation, a quick message or a chat line, and the list shows the room under its own section.
 * The snapshots are the real engine's; the socket is the fake one (no timers).
 */
const TC = { initialMs: 60000, incrementMs: 0 };
const SEATS: BugSeats = ['Ann', 'Bob', 'Cy', 'Di'].map((name, seat) => ({ seat, kind: 'human', name, connected: true })) as unknown as BugSeats;
const ROOM = 'room-9';
const start = () => createMatch({ timeControl: TC, roomNumber: 2, startMs: 0 });
const roomState = (match = start(), serverNowMs = 5000): BugSpectateState => ({ roomId: ROOM, seats: SEATS, timeControl: TC, timeControlLabel: '1 min', seq: match.seq, state: serializeMatch(match), serverNowMs, log: [] });

function harness() {
  const socket = new FakeBugSocket();
  const log: string[] = [];
  const effects: BughouseSessionEffects = { now: () => 1_000_000, moveSound: () => {}, gameEnded: () => {}, log: (m) => void log.push(m) };
  const session = new BughouseOnlineSession(socket, { spectate: { roomId: ROOM } }, effects);
  session.start();
  return { socket, session, log };
}

describe('joining the stream', () => {
  it('asks for the room once, within 6 s, and shows it when the answer comes', () => {
    const { socket, session } = harness();
    expect(session.state.view).toBeNull();
    expect(socket.asked).toHaveLength(1);
    expect(socket.asked[0]).toMatchObject({ event: 'bug_spectate_game', payload: { roomId: ROOM }, ms: SOCKET_ACK_DEADLINE_MS });
    socket.answer('bug_spectate_game', { ok: true, state: roomState() });
    expect(session.state.connection).toBe('connected');
    expect(session.state.problem).toBeNull();
    expect(session.state.view).toMatchObject({ roomId: ROOM, spectator: true, timeControlLabel: '1 min' });
  });

  it('a refusal ends in a sentence, silence in "Can\'t reach the server" with a way to retry, a broken room in a sentence', () => {
    const refused = harness();
    refused.socket.answer('bug_spectate_game', { ok: false, error: 'No such game.', reason: 'noGame' });
    expect(refused.session.state).toMatchObject({ view: null, connection: 'unavailable', problem: 'No such game.' });

    const silent = harness();
    silent.socket.silence('bug_spectate_game');
    expect(silent.session.state.problem).toBe("Can't reach the server.");
    expect(silent.log.some((l) => l.includes('bug_spectate_game was not answered'))).toBe(true);
    silent.session.retry();
    expect(silent.socket.pending('bug_spectate_game')).toHaveLength(1);
    silent.socket.answer('bug_spectate_game', { ok: true, state: roomState() });
    expect(silent.session.state).toMatchObject({ connection: 'connected', problem: null });

    const broken = harness();
    broken.socket.answer('bug_spectate_game', { ok: true, state: { ...roomState(), state: 'not a match' } });
    expect(broken.session.state).toMatchObject({ view: null, connection: 'unavailable', problem: 'The game could not be read from the server.' });
  });

  it('never asks twice at once', () => {
    const { socket, session } = harness();
    session.retry();
    session.retry();
    expect(socket.pending('bug_spectate_game')).toHaveLength(1);
  });
});

describe('following the game', () => {
  it('applies the next snapshot, asks for the room again on a gap, and re-joins after a reconnect', () => {
    const { socket, session } = harness();
    socket.answer('bug_spectate_game', { ok: true, state: roomState() });
    const applied = settle(start(), { seat: 0, action: { kind: 'move', board: 'A', from: 'e2', to: 'e4' } }, 2000);
    if (applied.kind !== 'applied') throw new Error('not applied');
    const payload: BugStatePayload = { roomId: ROOM, seq: applied.match.seq, events: applied.events as BugStatePayload['events'], state: serializeMatch(applied.match), serverNowMs: 7000 };
    socket.fire('bug_state', payload);
    expect(session.state.view?.match.seq).toBe(applied.match.seq);
    expect(session.state.view?.lastMove.A).not.toBeNull();
    // a snapshot two ahead is a gap: the room is read again through bug_spectate_game, never bug_rejoin
    socket.fire('bug_state', { ...payload, seq: applied.match.seq + 2 });
    expect(socket.pending('bug_spectate_game')).toHaveLength(1);
    expect(socket.pending('bug_rejoin')).toHaveLength(0);
    socket.answer('bug_spectate_game', { ok: true, state: roomState(applied.match, 9000) });
    expect(session.state.view?.resyncing).toBe(false);
    // the server drops a spectator whose socket dropped: the reconnect joins the stream again
    socket.fireManager('reconnect');
    expect(socket.pending('bug_spectate_game')).toHaveLength(1);
  });

  it('stops listening to the room when it ends the session', () => {
    const { socket, session } = harness();
    session.stopSpectating();
    expect(socket.plain.map((p) => p.event)).toEqual(['bug_stop_spectating']);
    session.stop();
    expect(socket.listenerCount('bug_state')).toBe(0);
  });
});

describe('a spectator can send nothing', () => {
  it('no action, no resignation, no quick message, no chat line', () => {
    const { socket, session } = harness();
    socket.answer('bug_spectate_game', { ok: true, state: roomState() });
    session.sendAction({ kind: 'move', board: 'A', from: 'e2', to: 'e4' });
    session.resign(() => {});
    const replies: (string | null)[] = [];
    session.sendQuick(3, (o) => replies.push(o));
    session.sendChat('hello', (o) => replies.push(o));
    expect(socket.asked).toHaveLength(0);
    expect(replies).toEqual(['The game is over.', 'The game is over.']);
  });

  it('the view says "watching", names nobody "(you)", and the seat map gives an equal-boards layout with no Resign', () => {
    const view = viewFromSpectate(roomState(), 1)!;
    expect(matchIntroLine(view)).toBe('Watching: Ann + Di (Team 1) vs Bob + Cy (Team 2)');
    expect([0, 1, 2, 3].map((seat) => seatDisplayName(view, seat as 0 | 1 | 2 | 3, 1))).toEqual(['Ann', 'Bob', 'Cy', 'Di']);
    expect(deriveBughouseLayout(spectatorSeatConfig())).toEqual({ kind: 'dual' });
    // a window too small for two equal boards: Board A large and Board B as a thumbnail (never the "rotate the device" layer over a game nobody plays)
    expect(deriveBughouseLayout(spectatorStandardSeatConfig())).toEqual({ kind: 'standard', seat: 0 });
    expect(needsRotateOverlay(spectatorSeatConfig(), 360, 568)).toBe(true);
    expect(needsRotateOverlay(spectatorSeatConfig(), 412, 915)).toBe(false);
    expect(viewFromSpectate({ ...roomState(), seats: [] as never }, 1)).toBeNull();
  });
});

describe('the list', () => {
  const game = { roomId: 'r1', timeControlLabel: '3 min', seats: SEATS.map((s) => ({ name: s.name, kind: s.kind })) } as never;
  it('has a Bughouse section only when there are games, after the 4-seat sections, and names the teams', () => {
    expect(buildSpectateRows([], null, [])).toEqual([]);
    expect(buildSpectateRows([], null, null)).toEqual([]);
    const rows = buildSpectateRows([], [], [game]);
    expect(rows).toEqual([
      { key: 'header:bughouse', kind: 'header', title: 'Bughouse' },
      { key: 'bughouse:r1', kind: 'bughouse', game },
    ]);
    expect(describeBughouseGame(game)).toBe('Ann + Di vs Bob + Cy');
  });
});
