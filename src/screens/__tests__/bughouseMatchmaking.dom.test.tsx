import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMatch, serializeMatch } from '../../logic/bughouse';
import type { BugMatchFoundPayload, BugSeats } from '../../logic/bughouse/wire';
import { logDiagnostic } from '../../logic/diagnosticLog';
import { FakeBugSocket } from '../../test/fakeBugSocket';
import BughouseMatchmakingScreen from '../BughouseMatchmakingScreen';
import PlayModeSelectScreen from '../PlayModeSelectScreen';
import AppAlertHost from '../../components/AppAlert';
import type { ComponentProps } from 'react';

/**
 * ONLINE BUGHOUSE, THE QUEUE SCREEN AND THE MENU ENTRY RENDERED (W4): the searching screen on a fake socket - what it asks, what it shows for each answer, that EVERY wait ends (the 6 s limit,
 * "Can't reach the server", Retry, one Diagnostic Log line) and that Cancel leaves the queue.
 */
const fake = vi.hoisted(() => ({ socket: null as unknown, disconnect: null as unknown }));
vi.mock('../../api/socket', () => ({ connectSocket: () => fake.socket, disconnectSocket: () => (fake.disconnect as () => void)() }));
vi.mock('../../logic/diagnosticLog', () => ({ logDiagnostic: vi.fn() }));

const TC = { initialMs: 60000, incrementMs: 0 };
const SEATS: BugSeats = [0, 1, 2, 3].map((seat) => ({ seat, kind: seat === 0 ? 'human' : 'bot', name: `P${seat}`, connected: true })) as unknown as BugSeats;
const found: BugMatchFoundPayload = {
  roomId: 'room-9',
  seat: 2,
  playerToken: 'tok',
  seats: SEATS,
  timeControl: TC,
  timeControlLabel: '1 min',
  state: serializeMatch(createMatch({ timeControl: TC, roomNumber: 2, startMs: 0 })),
  serverNowMs: 0,
  seq: 0,
};

let socket: FakeBugSocket;
let disconnected: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  vi.mocked(logDiagnostic).mockClear();
  socket = new FakeBugSocket();
  disconnected = vi.fn();
  fake.socket = socket;
  fake.disconnect = disconnected;
});
afterEach(() => {
  vi.restoreAllMocks();
});

const renderQueue = () => {
  const onMatchFound = vi.fn();
  const onCancel = vi.fn();
  const utils = render(<BughouseMatchmakingScreen authToken="t" timeControl={TC} timeControlLabel="1 min" onMatchFound={onMatchFound} onCancel={onCancel} />);
  return { ...utils, onMatchFound, onCancel };
};
const fire = (event: string, payload?: unknown) => act(() => socket.fire(event, payload));
const answer = (event: string, ack: unknown) => act(() => void socket.answer(event, ack));
const silence = (event: string) => act(() => void socket.silence(event));
const text = (id: string) => screen.getByTestId(id).textContent ?? '';

describe('the searching screen', () => {
  it('joins the queue for its time control with the 6 s limit, and says it is looking', () => {
    renderQueue();
    expect(screen.getByText('Bughouse · 1 min')).toBeTruthy();
    const [req] = socket.pending('bug_join_queue');
    expect(req.payload).toEqual({ timeControl: { initialMs: 60000, incrementMs: 0 } });
    expect(req.ms).toBe(6000);
    expect(text('bughouse-queue-title')).toBe('Looking for a game…');
    expect(screen.getByTestId('bughouse-queue-cancel')).toBeTruthy();
  });

  it('shows how many are waiting, and the countdown to the bots once two are (it counts down from the update)', () => {
    renderQueue();
    answer('bug_join_queue', { ok: true });
    fire('bug_queue_update', { queued: 1, fillInMs: null });
    expect(text('bughouse-queue-title')).toBe('1 player waiting');
    expect(text('bughouse-queue-detail')).toBe('Waiting for at least one more player. Bots fill the empty seats once two are here.');
    fire('bug_queue_update', { queued: 2, fillInMs: 30000 });
    expect(text('bughouse-queue-title')).toBe('2 players waiting');
    expect(text('bughouse-queue-detail')).toBe('Bots fill the empty seats in 30s, sooner if more players join.');
    act(() => void vi.advanceTimersByTime(10_000));
    expect(text('bughouse-queue-detail')).toBe('Bots fill the empty seats in 20s, sooner if more players join.');
  });

  it('a match found hands the payload over, and leaving the screen afterwards does NOT leave the queue (the server already did)', () => {
    const { onMatchFound, unmount } = renderQueue();
    answer('bug_join_queue', { ok: true });
    fire('bug_match_found', found);
    expect(onMatchFound).toHaveBeenCalledWith(found);
    unmount();
    expect(socket.plain.filter((p) => p.event === 'bug_leave_queue')).toHaveLength(0);
  });

  it('a match that cannot be read is not a match: the screen says so and leaves the room', () => {
    const { onMatchFound } = renderQueue();
    fire('bug_match_found', { ...found, state: 'garbage' });
    expect(onMatchFound).not.toHaveBeenCalled();
    expect(text('bughouse-queue-error')).toBe('The game could not be read from the server.');
    expect(socket.plain.find((p) => p.event === 'bug_resign')?.args[0]).toEqual({ roomId: 'room-9' });
  });

  it('Cancel leaves the queue, drops the connection and goes back', () => {
    const { onCancel } = renderQueue();
    fireEvent.click(screen.getByTestId('bughouse-queue-cancel'));
    expect(socket.plain.filter((p) => p.event === 'bug_leave_queue')).toHaveLength(1);
    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('leaving the screen while still queued (back button) leaves the queue once', () => {
    const { unmount } = renderQueue();
    answer('bug_join_queue', { ok: true });
    unmount();
    expect(socket.plain.filter((p) => p.event === 'bug_leave_queue')).toHaveLength(1);
  });

  it('a dropped connection that comes back joins the queue again by itself', () => {
    renderQueue();
    answer('bug_join_queue', { ok: true });
    act(() => socket.fireManager('reconnect'));
    expect(socket.pending('bug_join_queue')).toHaveLength(1);
  });
});

describe('every wait ends', () => {
  it('no answer to the join: "Can\'t reach the server" with Retry and ONE Diagnostic Log line; Retry joins again and an answer clears the failure', () => {
    renderQueue();
    silence('bug_join_queue');
    expect(screen.getByTestId('bughouse-queue-failed')).toBeTruthy();
    expect(screen.getByTestId('bughouse-queue-failed').textContent).toContain("Can't reach the server");
    expect(screen.queryByTestId('bughouse-queue-cancel')).toBeNull();
    expect(vi.mocked(logDiagnostic).mock.calls.filter(([m]) => /bug_join_queue was not answered/.test(String(m)))).toHaveLength(1);
    fireEvent.click(screen.getByTestId('bughouse-queue-failed-retry'));
    expect(socket.pending('bug_join_queue')).toHaveLength(1);
    expect(screen.queryByTestId('bughouse-queue-failed')).toBeNull();
    answer('bug_join_queue', { ok: true });
    expect(screen.getByTestId('bughouse-queue-cancel')).toBeTruthy();
  });

  it('the failed screen has a way back that leaves the queue', () => {
    const { onCancel } = renderQueue();
    silence('bug_join_queue');
    fireEvent.click(screen.getByTestId('bughouse-queue-back'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('a refusal (already in a game) is shown as the server worded it, once in the log, with a way back and no Retry', () => {
    renderQueue();
    answer('bug_join_queue', { ok: false, error: 'You are already in a game.', reason: 'noGame' });
    expect(text('bughouse-queue-error')).toBe('You are already in a game.');
    expect(screen.queryByTestId('bughouse-queue-failed')).toBeNull();
    expect(screen.getByTestId('bughouse-queue-back')).toBeTruthy();
    expect(vi.mocked(logDiagnostic).mock.calls.filter(([m]) => /bug_join_queue refused: noGame/.test(String(m)))).toHaveLength(1);
  });

  it('an answer that arrives after Cancel is ignored', () => {
    const { onCancel } = renderQueue();
    fireEvent.click(screen.getByTestId('bughouse-queue-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    silence('bug_join_queue');
    expect(vi.mocked(logDiagnostic)).not.toHaveBeenCalled();
  });
});

describe('the Play menu', () => {
  const baseProps = (over: Record<string, unknown> = {}): ComponentProps<typeof PlayModeSelectScreen> =>
    ({ authUser: { id: 'u', username: 'Ana' }, onAuthPress: vi.fn(), onBughouse: vi.fn(), onBughouseOnline: vi.fn(), ...over }) as unknown as ComponentProps<typeof PlayModeSelectScreen>;

  it('the Bughouse card has Local AND Online', () => {
    render(<PlayModeSelectScreen {...baseProps()} />);
    const card = screen.getByTestId('bughouse-card');
    expect(card.querySelector('[aria-label="Bughouse local"]')).not.toBeNull();
    expect(card.querySelector('[aria-label="Bughouse online"]')).not.toBeNull();
  });

  it('Online opens the online flow for a signed-in player', () => {
    const onBughouseOnline = vi.fn();
    render(<PlayModeSelectScreen {...baseProps({ onBughouseOnline })} />);
    fireEvent.click(screen.getByLabelText('Bughouse online'));
    expect(onBughouseOnline).toHaveBeenCalledTimes(1);
  });

  it('a guest is asked to log in first and the flow does not start', () => {
    const onBughouseOnline = vi.fn();
    const onAuthPress = vi.fn();
    render(
      <>
        <PlayModeSelectScreen {...baseProps({ authUser: null, onBughouseOnline, onAuthPress })} />
        <AppAlertHost />
      </>
    );
    fireEvent.click(screen.getByLabelText('Bughouse online'));
    expect(onBughouseOnline).not.toHaveBeenCalled();
    expect(screen.getByText('Login required')).toBeTruthy();
    fireEvent.click(screen.getByText('Log in / Sign up'));
    expect(onAuthPress).toHaveBeenCalledTimes(1);
  });
});
