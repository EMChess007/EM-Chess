import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppAlertHost from '../../components/AppAlert';
import { createMatch, serializeMatch } from '../../logic/bughouse';
import type { BugMatchFoundPayload, BugSeats } from '../../logic/bughouse/wire';
import { FakeBugSocket } from '../../test/fakeBugSocket';
import { allRenderCounts, renderCount, resetRenderCounts } from '../../test/renderCounter';
import BughouseOnlineGameScreen from '../BughouseOnlineGameScreen';

/**
 * AN IDLE ONLINE BUGHOUSE SCREEN IS IDLE (command #66, item 1). The Android run's "could not get idle state" on the Bughouse game screen means the window never stopped changing for
 * `uiautomator`. This test renders the real online screen on a fake socket with fake timers, lets 10 s of game time pass with NO move, and counts what the JavaScript side does: renders of the
 * screen, the boards and the team bar, and every setTimeout / setInterval / requestAnimationFrame scheduled. A clock that is running must re-render only its own text (NowClock), and only when
 * the text it draws changes; nothing may reschedule itself in a loop.
 */
const fake = vi.hoisted(() => ({ socket: null as unknown, disconnect: null as unknown }));
vi.mock('../../api/socket', () => ({ connectSocket: () => fake.socket, disconnectSocket: () => (fake.disconnect as () => void)() }));
vi.mock('../../logic/moveSounds', () => ({ playMoveSound: vi.fn() }));
vi.mock('../../logic/haptics', () => ({ triggerMoveHaptics: vi.fn(), triggerGameEndHaptics: vi.fn() }));
vi.mock('../../logic/diagnosticLog', () => ({ logDiagnostic: vi.fn() }));
vi.mock('../BughouseGameScreen', async (importOriginal) => (await import('../../test/renderCounter')).countModule('BughouseGameScreen', await importOriginal()));
vi.mock('../../components/BughouseBoard', async (importOriginal) => (await import('../../test/renderCounter')).countModule('BughouseBoard', await importOriginal()));
vi.mock('../../components/BughouseTeamBar', async (importOriginal) => (await import('../../test/renderCounter')).countModule('BughouseTeamBar', await importOriginal()));
vi.mock('../../components/Square', async (importOriginal) => (await import('../../test/renderCounter')).countModule('Square', await importOriginal()));

const TC = { initialMs: 180000, incrementMs: 0 };
const SEATS: BugSeats = [
  { seat: 0, kind: 'human', name: 'Ana', connected: true },
  { seat: 1, kind: 'bot', botReason: 'fill', name: 'Bot (Amateur)', connected: true },
  { seat: 2, kind: 'bot', botReason: 'fill', name: 'Bot (Beginner)', connected: true },
  { seat: 3, kind: 'human', name: 'Ben', connected: true },
];
const found = (): BugMatchFoundPayload => ({ roomId: 'room-1', seat: 0, playerToken: 'tok', seats: SEATS, timeControl: TC, timeControlLabel: '3 min', state: serializeMatch(createMatch({ timeControl: TC, roomNumber: 2, startMs: 0 })), serverNowMs: 0, seq: 0 });

let socket: FakeBugSocket;
beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  socket = new FakeBugSocket();
  fake.socket = socket;
  fake.disconnect = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the online Bughouse game screen while nobody moves', () => {
  it('10 s of idle game time: the screen, boards and team bar do not re-render, and no timer reschedules in a loop', () => {
    render(
      <>
        <BughouseOnlineGameScreen authToken="t" match={found()} resume={false} onExit={vi.fn()} onPlayAgain={vi.fn()} />
        <AppAlertHost />
      </>
    );
    act(() => void vi.advanceTimersByTime(2000)); // mount effects, the first layout, the session's start
    resetRenderCounts();
    const scheduled = { timeout: 0, interval: 0, raf: 0 };
    const st = globalThis.setTimeout;
    const si = globalThis.setInterval;
    const raf = globalThis.requestAnimationFrame;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((...a: Parameters<typeof setTimeout>) => (scheduled.timeout++, st(...a))) as typeof setTimeout);
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((...a: Parameters<typeof setInterval>) => (scheduled.interval++, si(...a))) as typeof setInterval);
    if (raf) vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(((cb: FrameRequestCallback) => (scheduled.raf++, raf(cb))) as typeof requestAnimationFrame);
    for (let i = 0; i < 100; i++) act(() => void vi.advanceTimersByTime(100));
    // before the fix: {"BughouseGameScreen":10,"BughouseTeamBar":10} - the hook's once-a-second `setNow` re-rendered the whole screen for a countdown nobody had
    expect(allRenderCounts()).toEqual({});
    expect(renderCount('BughouseGameScreen')).toBe(0);
    expect(renderCount('BughouseBoard')).toBe(0);
    expect(renderCount('Square')).toBe(0);
    expect(renderCount('BughouseTeamBar')).toBe(0);
    expect(scheduled.raf).toBe(0);
    expect(scheduled.interval).toBe(0);
  });

  it('a seat offline in its grace period still counts down once a second, and only that costs renders', () => {
    const seats: BugSeats = [SEATS[0], SEATS[1], SEATS[2], { seat: 3, kind: 'human', name: 'Ben', connected: false, graceMsLeft: 45000 }];
    render(<BughouseOnlineGameScreen authToken="t" match={{ ...found(), seats }} resume={false} onExit={vi.fn()} onPlayAgain={vi.fn()} />);
    expect(screen.getAllByText(/Ben \(offline · 45s\)/).length).toBeGreaterThan(0);
    resetRenderCounts();
    for (let i = 0; i < 30; i++) act(() => void vi.advanceTimersByTime(100));
    expect(screen.getAllByText(/Ben \(offline · 42s\)/).length).toBeGreaterThan(0);
    expect(renderCount('BughouseGameScreen')).toBeLessThanOrEqual(4); // one per second of countdown (3 s), never per clock tick
    expect(renderCount('Square')).toBe(0);
  });
});
