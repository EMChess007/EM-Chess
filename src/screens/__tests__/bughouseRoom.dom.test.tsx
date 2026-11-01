import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMatch, serializeMatch } from '../../logic/bughouse';
import type { BugFriendRoomView } from '../../logic/bughouse/roomWire';
import type { BugMatchFoundPayload, BugSeats } from '../../logic/bughouse/wire';
import { logDiagnostic } from '../../logic/diagnosticLog';
import { FakeBugSocket } from '../../test/fakeBugSocket';
import BughouseRoomScreen, { type BughouseRoomMode } from '../BughouseRoomScreen';

/**
 * BUGHOUSE FRIEND ROOMS, THE ROOM / JOIN SCREEN RENDERED (W6): on a fake socket - what the host and the friend see for each state of the room, that every request has its 6 s limit with
 * "Can't reach the server" + Retry and one Diagnostic Log line, that Copy and Share carry the code and the invite link, that the pair queue is the same screen, and that leaving is sent.
 */
const fake = vi.hoisted(() => ({ socket: null as unknown, disconnect: null as unknown, clipboard: [] as string[], shared: [] as unknown[] }));
vi.mock('../../api/socket', () => ({ connectSocket: () => fake.socket, disconnectSocket: () => (fake.disconnect as () => void)() }));
vi.mock('../../logic/diagnosticLog', () => ({ logDiagnostic: vi.fn() }));
vi.mock('expo-clipboard', () => ({ setStringAsync: async (text: string) => void fake.clipboard.push(text) }));

const TC = { initialMs: 180000, incrementMs: 0 };
const SEATS: BugSeats = [0, 1, 2, 3].map((seat) => ({ seat, kind: seat === 0 || seat === 3 ? 'human' : 'bot', name: `P${seat}`, connected: true })) as unknown as BugSeats;
const found: BugMatchFoundPayload = {
  roomId: 'room-7',
  seat: 3,
  playerToken: 'tok',
  seats: SEATS,
  timeControl: TC,
  timeControlLabel: '3 min',
  state: serializeMatch(createMatch({ timeControl: TC, roomNumber: 1, startMs: 0 })),
  serverNowMs: 0,
  seq: 0,
};
const room = (over: Partial<BugFriendRoomView> = {}): BugFriendRoomView => ({ code: 'K7M2PQ', timeControl: TC, timeControlLabel: '3 min', youAre: 'host', hostName: 'Ann', friendName: null, phase: 'open', expiresInMs: 600000, ...over });

let socket: FakeBugSocket;
beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  vi.mocked(logDiagnostic).mockClear();
  socket = new FakeBugSocket();
  fake.socket = socket;
  fake.disconnect = vi.fn();
  fake.clipboard = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

const renderRoom = (mode: BughouseRoomMode) => {
  const onMatchFound = vi.fn();
  const onExit = vi.fn();
  const utils = render(<BughouseRoomScreen authToken="t" mode={mode} onMatchFound={onMatchFound} onExit={onExit} />);
  return { ...utils, onMatchFound, onExit };
};
const hostScreen = () => renderRoom({ kind: 'create', timeControl: TC });
const fire = (event: string, payload?: unknown) => act(() => socket.fire(event, payload));
const answer = (event: string, ack: unknown) => act(() => void socket.answer(event, ack));
const silence = (event: string) => act(() => void socket.silence(event));
const text = (id: string) => screen.getByTestId(id).textContent ?? '';
const click = (id: string) => fireEvent.click(screen.getByTestId(id));
const disabled = (id: string) => screen.getByTestId(id).getAttribute('aria-disabled') === 'true' || (screen.getByTestId(id) as HTMLButtonElement).disabled === true;

describe('the host', () => {
  it('opens a room for its time control with the 6 s limit and shows the code, the free friend slot and the countdown', () => {
    hostScreen();
    const [req] = socket.pending('bug_room_create');
    expect(req.payload).toEqual({ timeControl: TC });
    expect(req.ms).toBe(6000);
    answer('bug_room_create', { ok: true, room: room() });
    expect(text('bughouse-room-code')).toBe('K7M2PQ');
    expect(text('bughouse-room-headline')).toBe('Your room · 3 min');
    expect([text('bughouse-room-slot-1'), text('bughouse-room-slot-2')]).toEqual(['You (host)', 'Friend: waiting']);
    expect(text('bughouse-room-countdown')).toBe('The code works for 10:00');
    act(() => void vi.advanceTimersByTime(61_000));
    expect(text('bughouse-room-countdown')).toBe('The code works for 8:59');
    expect(disabled('bughouse-room-bots')).toBe(true); // no friend yet
    expect(disabled('bughouse-room-find')).toBe(false); // "Find a match alone" is a solo queue entry
  });

  it('a friend arriving fills the slot and unlocks Start with bots; starting with bots asks the server and the match hands over', () => {
    const { onMatchFound } = hostScreen();
    answer('bug_room_create', { ok: true, room: room() });
    fire('bug_room_update', room({ friendName: 'Bo' }));
    expect(text('bughouse-room-slot-2')).toBe('Friend: Bo');
    expect(disabled('bughouse-room-bots')).toBe(false);
    click('bughouse-room-bots');
    expect(socket.pending('bug_room_start')[0].payload).toEqual({ mode: 'bots' });
    expect(socket.pending('bug_room_start')[0].ms).toBe(6000);
    answer('bug_room_start', { ok: true, outcome: 'started' });
    fire('bug_match_found', found);
    expect(onMatchFound).toHaveBeenCalledWith(found, '3 min');
  });

  it('Find opponents puts the pair in the queue: the same screen shows the queue, Cancel returns both to the room', () => {
    hostScreen();
    answer('bug_room_create', { ok: true, room: room({ friendName: 'Bo' }) });
    click('bughouse-room-find');
    expect(socket.pending('bug_room_start')[0].payload).toEqual({ mode: 'queue' });
    answer('bug_room_start', { ok: true, outcome: 'queued' });
    fire('bug_room_update', room({ friendName: 'Bo', phase: 'queued' }));
    fire('bug_queue_update', { queued: 2, fillInMs: 30000 });
    expect(text('bughouse-room-queue-title')).toContain('2 players waiting');
    expect(text('bughouse-room-queue-title')).toContain('you and your friend are one team');
    expect(text('bughouse-room-queue-detail')).toBe('Bots fill the empty seats in 30s, sooner if more players join.');
    click('bughouse-room-queue-cancel');
    expect(socket.plain.some((p) => p.event === 'bug_leave_queue')).toBe(true);
    fire('bug_room_update', room({ friendName: 'Bo', phase: 'open' }));
    expect(text('bughouse-room-slot-2')).toBe('Friend: Bo'); // both still in the open room
  });

  it('Find opponents without a friend is a solo queue entry (the room is closed by the server)', () => {
    const { onExit } = hostScreen();
    answer('bug_room_create', { ok: true, room: room() });
    click('bughouse-room-find');
    answer('bug_room_start', { ok: true, outcome: 'solo' });
    expect(screen.getByTestId('bughouse-room-queue-cancel')).toBeTruthy();
    click('bughouse-room-queue-cancel');
    expect(socket.plain.some((p) => p.event === 'bug_leave_queue')).toBe(true);
    expect(onExit).toHaveBeenCalled();
  });

  it('Close room leaves the room on the server and goes back', () => {
    const { onExit } = hostScreen();
    answer('bug_room_create', { ok: true, room: room() });
    click('bughouse-room-close');
    expect(socket.plain.filter((p) => p.event === 'bug_room_leave')).toHaveLength(1);
    expect(onExit).toHaveBeenCalled();
  });

  it('a refusal of the start (the friend left meanwhile) is shown as the server worded it', () => {
    hostScreen();
    answer('bug_room_create', { ok: true, room: room({ friendName: 'Bo' }) });
    click('bughouse-room-bots');
    answer('bug_room_start', { ok: false, error: 'Wait for your friend to join first.', reason: 'invalidRequest' });
    expect(text('bughouse-room-notice')).toBe('Wait for your friend to join first.');
  });

  it('Copy puts the code on the clipboard; Share (web) puts the invite with the link on it', async () => {
    hostScreen();
    answer('bug_room_create', { ok: true, room: room() });
    await act(async () => void click('bughouse-room-copy'));
    expect(fake.clipboard).toEqual(['K7M2PQ']);
    expect(text('bughouse-room-copy')).toBe('Copied');
    await act(async () => void click('bughouse-room-share'));
    expect(fake.clipboard).toHaveLength(2);
    expect(fake.clipboard[1]).toContain('/bughouse/join/K7M2PQ');
    expect(fake.clipboard[1]).toContain('K7M2PQ');
  });

  it('when the code has lived its time the screen says so', () => {
    hostScreen();
    answer('bug_room_create', { ok: true, room: room({ expiresInMs: 3000 }) });
    act(() => void vi.advanceTimersByTime(3500));
    expect(text('bughouse-room-countdown')).toBe('The code has expired.');
  });
});

describe('every wait ends', () => {
  it('a create that gets no answer is "Can\'t reach the server" + Retry with one Diagnostic Log line; Retry asks again', () => {
    hostScreen();
    silence('bug_room_create');
    expect(text('bughouse-room-failed')).toContain("Can't reach the server");
    expect(vi.mocked(logDiagnostic).mock.calls.filter((c) => String(c[0]).startsWith('[BughouseRoom]'))).toHaveLength(1);
    fireEvent.click(screen.getByText('Retry'));
    expect(socket.pending('bug_room_create')).toHaveLength(1);
    answer('bug_room_create', { ok: true, room: room() });
    expect(text('bughouse-room-code')).toBe('K7M2PQ');
  });

  it('a refused create (already in a room) shows the sentence and a way back', () => {
    const { onExit } = hostScreen();
    answer('bug_room_create', { ok: false, error: 'You already have an open room. Leave it first.', reason: 'invalidRequest' });
    expect(text('bughouse-room-error')).toBe('You already have an open room. Leave it first.');
    click('bughouse-room-back');
    expect(onExit).toHaveBeenCalled();
  });

  it('a start that gets no answer says so under the buttons and logs one line', () => {
    hostScreen();
    answer('bug_room_create', { ok: true, room: room({ friendName: 'Bo' }) });
    click('bughouse-room-find');
    silence('bug_room_start');
    expect(text('bughouse-room-notice')).toBe("Can't reach the server");
    expect(vi.mocked(logDiagnostic).mock.calls.filter((c) => String(c[0]).includes('bug_room_start'))).toHaveLength(1);
  });
});

describe('the friend', () => {
  it('the code field keeps only the 31 allowed characters, accepts a pasted link, and Join stays off until there are six', () => {
    renderRoom({ kind: 'join' });
    const input = screen.getByTestId('join-code-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'k7m-2p0o1' } });
    expect(input.value).toBe('K7M2P');
    expect(disabled('join-code-submit')).toBe(true);
    fireEvent.change(input, { target: { value: 'https://app.example/bughouse/join/k7m2pq' } });
    expect(input.value).toBe('K7M2PQ');
    expect(disabled('join-code-submit')).toBe(false);
  });

  it('an invite link opens the field with the code in it', () => {
    renderRoom({ kind: 'join', code: 'k7m2pq' });
    expect((screen.getByTestId('join-code-input') as HTMLInputElement).value).toBe('K7M2PQ');
  });

  it('a wrong code shows the ONE sentence (or the cooldown) and stays on the form; the right code shows the room', () => {
    const { onExit } = renderRoom({ kind: 'join', code: 'ZZZZZZ' });
    click('join-code-submit');
    expect(socket.pending('bug_room_join')[0].payload).toEqual({ code: 'ZZZZZZ' });
    expect(socket.pending('bug_room_join')[0].ms).toBe(6000);
    answer('bug_room_join', { ok: false, error: 'That code was not found or has expired.', reason: 'invalidRequest' });
    expect(text('join-code-error')).toBe('That code was not found or has expired.');
    click('join-code-submit');
    answer('bug_room_join', { ok: false, error: 'Too many wrong codes. Try again in 5 minutes.', reason: 'rateLimited' });
    expect(text('join-code-error')).toBe('Too many wrong codes. Try again in 5 minutes.');
    click('join-code-submit');
    answer('bug_room_join', { ok: true, room: room({ youAre: 'friend', friendName: 'Bo' }) });
    expect(text('bughouse-room-headline')).toBe('Room of Ann · 3 min · you are teammates');
    expect([text('bughouse-room-slot-1'), text('bughouse-room-slot-2')]).toEqual(['Ann (host)', 'You']);
    expect(screen.queryByTestId('bughouse-room-copy')).toBeNull(); // only the host shares
    click('bughouse-room-leave');
    expect(socket.plain.filter((p) => p.event === 'bug_room_leave')).toHaveLength(1);
    expect(onExit).toHaveBeenCalled();
  });

  it('a join that gets no answer is "Can\'t reach the server" + Retry', () => {
    renderRoom({ kind: 'join', code: 'K7M2PQ' });
    click('join-code-submit');
    silence('bug_room_join');
    expect(text('bughouse-room-failed')).toContain("Can't reach the server");
    expect(vi.mocked(logDiagnostic).mock.calls.filter((c) => String(c[0]).includes('bug_room_join'))).toHaveLength(1);
    expect(vi.mocked(logDiagnostic).mock.calls.every((c) => !String(c[0]).includes('K7M2PQ'))).toBe(true); // a code is never logged
  });

  it('the host closing the room, and a lost connection, end it with a sentence', () => {
    renderRoom({ kind: 'join', code: 'K7M2PQ' });
    click('join-code-submit');
    answer('bug_room_join', { ok: true, room: room({ youAre: 'friend', friendName: 'Bo' }) });
    fire('bug_room_closed', { reason: 'hostLeft' });
    expect(text('bughouse-room-closed')).toBe('The host closed the room.');
  });

  it('the friend follows the host into the queue and the match', () => {
    const { onMatchFound } = renderRoom({ kind: 'join', code: 'K7M2PQ' });
    click('join-code-submit');
    answer('bug_room_join', { ok: true, room: room({ youAre: 'friend', friendName: 'Bo' }) });
    fire('bug_room_update', room({ youAre: 'friend', friendName: 'Bo', phase: 'queued' }));
    expect(screen.getByTestId('bughouse-room-queue-cancel')).toBeTruthy();
    fire('bug_match_found', found);
    expect(onMatchFound).toHaveBeenCalledWith(found, '3 min');
  });
});

describe('leaving', () => {
  it('leaving the screen while in a room leaves the room; after a match began it does not', () => {
    const a = hostScreen();
    answer('bug_room_create', { ok: true, room: room() });
    a.unmount();
    expect(socket.plain.filter((p) => p.event === 'bug_room_leave')).toHaveLength(1);
    socket = new FakeBugSocket();
    fake.socket = socket;
    const b = hostScreen();
    answer('bug_room_create', { ok: true, room: room({ friendName: 'Bo' }) });
    fire('bug_match_found', found);
    b.unmount();
    expect(socket.plain.filter((p) => p.event === 'bug_room_leave')).toHaveLength(0);
  });

  it('a dropped connection closes the room on screen', () => {
    hostScreen();
    answer('bug_room_create', { ok: true, room: room() });
    fire('disconnect');
    expect(text('bughouse-room-closed')).toBe('The connection was lost, so the room is closed.');
  });
});
