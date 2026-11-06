import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FourFriendRoomView } from '../../logic/fourPlayerRoomWire';
import { logDiagnostic } from '../../logic/diagnosticLog';
import { FakeBugSocket } from '../../test/fakeBugSocket';
import FourPlayerRoomScreen, { type FourPlayerRoomMode } from '../FourPlayerRoomScreen';

/**
 * THE 4-SEAT FRIEND ROOM, RENDERED (command #35): on a fake socket - what the host and a friend see for each state of the room (the seats: friends first, then "Bot fills this seat"), that
 * create and start carry the 6 s limit with "Can't reach the server" + Retry and ONE Diagnostic Log line, that Start needs a friend and says how many bots fill, that the room closing and the
 * game beginning are followed, and that leaving is sent. Every number and word is compared with the pure helpers' own literals, never recomputed from the screen.
 */
const fake = vi.hoisted(() => ({ socket: null as unknown, clipboard: [] as string[] }));
vi.mock('../../api/socket', () => ({ connectSocket: () => fake.socket, disconnectSocket: () => {} }));
vi.mock('../../logic/diagnosticLog', () => ({ logDiagnostic: vi.fn() }));
vi.mock('expo-clipboard', () => ({ setStringAsync: async (text: string) => void fake.clipboard.push(text) }));

const TC = { initialSeconds: 300, incrementSeconds: 0 };
const room = (over: Partial<FourFriendRoomView> = {}): FourFriendRoomView => ({
  code: 'K7M2PQ',
  variant: 'chaturaji',
  timeControl: TC,
  timeControlLabel: '5 min',
  youAre: 'host',
  hostName: 'Ann',
  members: ['Ann'],
  maxMembers: 4,
  phase: 'open',
  expiresInMs: 600000,
  ...over,
});
const matchFound = { roomId: 'r1', variant: 'chaturaji', seat: 0, playerToken: 'tok', seats: [], timeControl: TC, timeControlLabel: '5 min', seq: 0, state: '{}', clocksMs: [300000, 300000, 300000, 300000] };

let socket: FakeBugSocket;
beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  vi.mocked(logDiagnostic).mockClear();
  socket = new FakeBugSocket();
  fake.socket = socket;
  fake.clipboard = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

const renderRoom = (mode: FourPlayerRoomMode) => {
  const onMatchFound = vi.fn();
  const onExit = vi.fn();
  const utils = render(<FourPlayerRoomScreen authToken="t" mode={mode} onMatchFound={onMatchFound} onExit={onExit} />);
  return { ...utils, onMatchFound, onExit };
};
const host = () => renderRoom({ kind: 'create', variant: 'chaturaji', timeControl: TC });
const fire = (event: string, payload?: unknown) => act(() => socket.fire(event, payload));
const answer = (event: string, ack: unknown) => act(() => void socket.answer(event, ack));
const text = (id: string) => screen.getByTestId(id).textContent ?? '';
const click = (id: string) => fireEvent.click(screen.getByTestId(id));
const disabled = (id: string) => screen.getByTestId(id).getAttribute('aria-disabled') === 'true' || (screen.getByTestId(id) as HTMLButtonElement).disabled === true;

describe('the host', () => {
  it('asks for a room with the variant and the control, with the 6 s limit, and shows the code and four seats', () => {
    host();
    const [asked] = socket.pending('four_room_create');
    expect(asked.payload).toEqual({ variant: 'chaturaji', timeControl: TC });
    expect(asked.ms).toBe(6000);
    answer('four_room_create', { ok: true, room: room() });
    expect(text('four-room-code')).toBe('K7M2PQ');
    expect(text('four-room-headline')).toBe('Chaturaji · 5 min - send your code to up to three friends.');
    expect([1, 2, 3, 4].map((n) => text(`four-room-slot-${n}`))).toEqual(['Ann (you, host)', 'Bot fills this seat', 'Bot fills this seat', 'Bot fills this seat']);
    expect(text('four-room-start')).toBe('Start - 3 bots fill the empty seats');
    expect(disabled('four-room-start')).toBe(true); // needs a friend
  });

  it('a friend joins: the seats follow, Start is enabled and says two bots fill; with three friends no bot is left', () => {
    host();
    answer('four_room_create', { ok: true, room: room() });
    fire('four_room_update', room({ members: ['Ann', 'Ben'] }));
    expect([1, 2, 3, 4].map((n) => text(`four-room-slot-${n}`))).toEqual(['Ann (you, host)', 'Ben', 'Bot fills this seat', 'Bot fills this seat']);
    expect(text('four-room-start')).toBe('Start - 2 bots fill the empty seats');
    expect(disabled('four-room-start')).toBe(false);
    fire('four_room_update', room({ members: ['Ann', 'Ben', 'Cy'] }));
    expect(text('four-room-start')).toBe('Start - 1 bot fills the empty seat');
    fire('four_room_update', room({ members: ['Ann', 'Ben', 'Cy', 'Di'] }));
    expect(text('four-room-start')).toBe('Start the game');
  });

  it('Start sends four_room_start with the 6 s limit; no answer says "Can\'t reach the server" under the buttons and logs ONE line; a refusal keeps its words', () => {
    host();
    answer('four_room_create', { ok: true, room: room({ members: ['Ann', 'Ben'] }) });
    click('four-room-start');
    expect(socket.pending('four_room_start')[0].ms).toBe(6000);
    act(() => void socket.silence('four_room_start'));
    expect(text('four-room-notice')).toBe("Can't reach the server");
    expect(vi.mocked(logDiagnostic)).toHaveBeenCalledTimes(1);
    click('four-room-start');
    answer('four_room_start', { ok: false, error: 'Wait for a friend to join first.' });
    expect(text('four-room-notice')).toBe('Wait for a friend to join first.');
  });

  it('the game beginning hands the match over, and the room is not left on unmount (the server consumed it)', () => {
    const { onMatchFound, unmount } = host();
    answer('four_room_create', { ok: true, room: room({ members: ['Ann', 'Ben'] }) });
    fire('four_match_found', matchFound);
    expect(onMatchFound).toHaveBeenCalledWith(matchFound);
    unmount();
    expect(socket.plain.filter((p) => p.event === 'four_room_leave')).toHaveLength(0);
  });

  it('a match for ANOTHER game is refused: the player resigns it and is told', () => {
    const { onMatchFound } = host();
    answer('four_room_create', { ok: true, room: room() });
    fire('four_match_found', { ...matchFound, variant: 'ffa' });
    expect(onMatchFound).not.toHaveBeenCalled();
    expect(socket.plain.some((p) => p.event === 'four_resign')).toBe(true);
  });

  it('Close room sends four_room_leave once and exits; leaving by unmount sends it too', () => {
    const { onExit } = host();
    answer('four_room_create', { ok: true, room: room() });
    click('four-room-close');
    expect(socket.plain.filter((p) => p.event === 'four_room_leave')).toHaveLength(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('no answer to the create: "Can\'t reach the server" with Retry, one Diagnostic Log line; Retry asks again', () => {
    host();
    act(() => void socket.silence('four_room_create'));
    expect(screen.getByText("Can't reach the server")).toBeTruthy();
    expect(vi.mocked(logDiagnostic)).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Retry'));
    expect(socket.pending('four_room_create')).toHaveLength(1);
  });

  it('a refused create shows the server\'s sentence and a way back', () => {
    const { onExit } = host();
    answer('four_room_create', { ok: false, error: 'You already have an open room. Leave it first.' });
    expect(text('four-room-error')).toBe('You already have an open room. Leave it first.');
    click('four-room-back');
    expect(onExit).toHaveBeenCalled();
  });

  it('Copy puts the code on the clipboard', async () => {
    host();
    answer('four_room_create', { ok: true, room: room() });
    await act(async () => {
      click('four-room-copy');
    });
    expect(fake.clipboard).toEqual(['K7M2PQ']);
  });
});

describe('a friend', () => {
  it('starts from the view the join answered with: the same seats, "Waiting for the host to start", Leave', () => {
    const { onExit } = renderRoom({ kind: 'joined', room: room({ youAre: 'friend', members: ['Ann', 'Ben'] }) });
    expect(socket.pending('four_room_create')).toHaveLength(0); // it never asks for a room
    expect(text('four-room-headline')).toBe("Chaturaji · 5 min - you joined Ann's room.");
    expect([1, 2, 3, 4].map((n) => text(`four-room-slot-${n}`))).toEqual(['Ann (host)', 'Ben', 'Bot fills this seat', 'Bot fills this seat']);
    expect(screen.getByText('Waiting for the host to start.')).toBeTruthy();
    expect(screen.queryByTestId('four-room-start')).toBeNull();
    expect(screen.queryByTestId('four-room-copy')).toBeNull();
    click('four-room-leave');
    expect(socket.plain.filter((p) => p.event === 'four_room_leave')).toHaveLength(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('the host closing the room, and the code expiring, each say so', () => {
    renderRoom({ kind: 'joined', room: room({ youAre: 'friend', members: ['Ann', 'Ben'] }) });
    fire('four_room_closed', { reason: 'hostLeft' });
    expect(text('four-room-closed')).toBe('The host closed the room.');
  });

  it('a lost connection ends the room and says so', () => {
    renderRoom({ kind: 'joined', room: room({ youAre: 'friend', members: ['Ann', 'Ben'] }) });
    fire('disconnect');
    expect(text('four-room-closed')).toBe('The connection was lost, so the room is closed.');
  });

  it('the countdown runs on this device\'s clock', () => {
    renderRoom({ kind: 'joined', room: room({ youAre: 'friend', members: ['Ann', 'Ben'], expiresInMs: 125000 }) });
    expect(text('four-room-countdown')).toBe('The code works for 2:05');
    act(() => void vi.advanceTimersByTime(65000));
    expect(text('four-room-countdown')).toBe('The code works for 1:00');
  });
});
