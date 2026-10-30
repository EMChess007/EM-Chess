import { describe, expect, it } from 'vitest';
import { createMatch, serializeMatch } from '../bughouse';
import type { BugMatchFoundPayload, BugSeats } from '../bughouse/wire';
import { SOCKET_ACK_DEADLINE_MS } from '../../api/socketAck';
import { BughouseOnlineSession, type BughouseSessionEffects } from '../bughouseOnlineSession';
import { appendTeamChat, QUICK_MESSAGES, QUICK_TOAST_MS, quickNotice, quickText, TEAM_CHAT_HEADER, TEAM_CHAT_KEEP } from '../bughouseOnlineUi';
import { FakeBugSocket } from '../../test/fakeBugSocket';

/**
 * QUICK MESSAGES AND TEAM CHAT on the client (W4b; BUGHOUSE_SPEC.md 5.4, HP10). The SERVER decides who receives a line (the partner and the sender's echo, nobody else - proved with every socket's
 * events recorded in the backend's tests); the client's part is to send a closed code / a trimmed line through the 6 s request, to show only what the partner's `bug_*_from` carries, and to say in
 * words when nothing was delivered. Literals on purpose: the ten wordings and the numbers are pinned here, not read back from the module.
 */
const TC = { initialMs: 60000, incrementMs: 0 };
const SEATS: BugSeats = [0, 1, 2, 3].map((seat) => ({ seat, kind: 'human', name: `P${seat}`, connected: true })) as unknown as BugSeats;
const found = (): BugMatchFoundPayload => ({
  roomId: 'room-1',
  seat: 0,
  playerToken: 't',
  seats: SEATS,
  timeControl: TC,
  timeControlLabel: '1 min',
  state: serializeMatch(createMatch({ timeControl: TC, roomNumber: 2, startMs: 0 })),
  serverNowMs: 0,
  seq: 0,
});

function harness() {
  const socket = new FakeBugSocket();
  const effects: BughouseSessionEffects = { now: () => 1_000_000, moveSound: () => {}, gameEnded: () => {}, log: () => {} };
  const session = new BughouseOnlineSession(socket, { match: found(), resume: false }, effects);
  session.start();
  return { socket, session };
}

describe('the ten quick messages', () => {
  it('are the spec\'s ten in the spec\'s order, and a code outside 0..9 has no words', () => {
    expect([...QUICK_MESSAGES]).toEqual(['Need a knight', 'Need a bishop', 'Need a rook', 'Need a queen', 'Need a pawn', "Don't trade", 'Trade!', 'Sit / wait', 'Hurry!', 'Watch your king']);
    expect(quickText(0)).toBe('Need a knight');
    expect(quickText(9)).toBe('Watch your king');
    for (const bad of [-1, 10, 1.5, NaN, '3', null, undefined]) expect(quickText(bad)).toBeNull();
    expect(QUICK_TOAST_MS).toBe(2500);
  });

  it('a notice needs a seat 0..3 and a code 0..9', () => {
    expect(quickNotice({ seat: 2, code: 6 }, 7)).toEqual({ id: 7, seat: 2, code: 6, text: 'Trade!' });
    for (const bad of [null, 'x', {}, { seat: 4, code: 1 }, { seat: -1, code: 1 }, { seat: 1.5, code: 1 }, { seat: 1, code: 10 }, { seat: '1', code: 1 }]) expect(quickNotice(bad, 1)).toBeNull();
  });
});

describe('the team chat list', () => {
  it('appends a well-formed line, marks mine, keeps the newest 40, ignores anything else', () => {
    let list = appendTeamChat([], { seat: 2, name: 'Sam', text: 'hello' }, 0, 1);
    expect(list).toEqual([{ id: 1, seat: 2, name: 'Sam', text: 'hello', mine: false }]);
    list = appendTeamChat(list, { seat: 0, name: 'Me', text: 'hi' }, 0, 2);
    expect(list[1]).toMatchObject({ mine: true });
    for (const bad of [null, 5, {}, { seat: 9, name: 'a', text: 'b' }, { seat: 1, name: 5, text: 'b' }, { seat: 1, name: 'a', text: '   ' }, { seat: 1, name: 'a' }]) expect(appendTeamChat(list, bad, 0, 3)).toBe(list);
    let long: ReturnType<typeof appendTeamChat> = [];
    for (let i = 0; i < 60; i++) long = appendTeamChat(long, { seat: 1, name: 'a', text: `m${i}` }, 0, i);
    expect(long).toHaveLength(40);
    expect(TEAM_CHAT_KEEP).toBe(40);
    expect(long[0].text).toBe('m20');
    expect(TEAM_CHAT_HEADER).toBe('Team chat - only your partner sees this');
  });
});

describe('the session', () => {
  it('shows what my partner sends and nothing it did not: a chat line, a quick message', () => {
    const { socket, session } = harness();
    socket.fire('bug_chat_from', { seat: 2, name: 'P2', text: 'watch b7' });
    socket.fire('bug_quick_from', { seat: 2, code: 3 });
    expect(session.state.chat).toEqual([{ id: 1, seat: 2, name: 'P2', text: 'watch b7', mine: false }]);
    expect(session.state.quick).toMatchObject({ seat: 2, code: 3, text: 'Need a queen' });
    // a malformed payload, a code outside 0..9 and a "quick message from myself" change nothing
    socket.fire('bug_chat_from', { nope: true });
    socket.fire('bug_quick_from', { seat: 2, code: 12 });
    socket.fire('bug_quick_from', { seat: 0, code: 1 });
    expect(session.state.chat).toHaveLength(1);
    expect(session.state.quick?.code).toBe(3);
  });

  it('sends a quick message as a code with the 6 s limit; an ack is null, a refusal and silence are sentences', () => {
    const { socket, session } = harness();
    const seen: (string | null)[] = [];
    session.sendQuick(4, (o) => seen.push(o));
    expect(socket.asked[0]).toMatchObject({ event: 'bug_quick', payload: { roomId: 'room-1', code: 4 }, ms: SOCKET_ACK_DEADLINE_MS });
    socket.answer('bug_quick', { ok: true, delivered: true });
    session.sendQuick(5, (o) => seen.push(o));
    socket.answer('bug_quick', { ok: true, delivered: false });
    session.sendQuick(6, (o) => seen.push(o));
    socket.answer('bug_quick', { ok: false, reason: 'partnerIsBot', error: 'x' });
    session.sendQuick(7, (o) => seen.push(o));
    socket.answer('bug_quick', { ok: false, reason: 'rateLimited', error: 'x' });
    session.sendQuick(8, (o) => seen.push(o));
    socket.silence('bug_quick');
    expect(seen).toEqual([null, 'Your partner is not connected right now: nothing was delivered.', 'Your partner is a bot.', 'Slow down: too many moves at once.', "Can't reach the server. Try again."]);
  });

  it('sends a chat line trimmed, nothing for an empty one, and names no recipient', () => {
    const { socket, session } = harness();
    const seen: (string | null)[] = [];
    session.sendChat('   ', (o) => seen.push(o));
    expect(socket.asked).toHaveLength(0);
    session.sendChat('  take the knight  ', (o) => seen.push(o));
    expect(socket.asked[0]).toMatchObject({ event: 'bug_chat', payload: { roomId: 'room-1', text: 'take the knight' }, ms: SOCKET_ACK_DEADLINE_MS });
    expect(Object.keys(socket.asked[0].payload as object).sort()).toEqual(['roomId', 'text']);
    socket.answer('bug_chat', { ok: true, delivered: true });
    expect(seen).toEqual([null, null]);
  });

  it('stops listening when the session stops', () => {
    const { socket, session } = harness();
    session.stop();
    expect(socket.listenerCount('bug_chat_from')).toBe(0);
    expect(socket.listenerCount('bug_quick_from')).toBe(0);
  });
});
