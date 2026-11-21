import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchFoundPayload } from '../../types/multiplayer';
import OnlineGameScreen from '../OnlineGameScreen';

/**
 * Command #68 (TODO "Rejoin ... two known limits"), the 2-player online screen, rendered with a scripted fake socket:
 *  - `seat_taken_over` for THIS room (the same account rejoined on another tab / device; backend rooms.ts, test-rejoin-persist.mjs section 7) swaps the
 *    game for the message and a way out; the exit says 'seatTakenOver' (App keeps the shared rejoin record), and a later restored connection does NOT
 *    rejoin (that would steal the seat back). A takeover for another room is ignored.
 *  - a resumed TOURNAMENT game re-registers its new socket as the participant (`rejoin_tournament` with the tournament id) after the rejoin succeeds;
 *    a non-tournament game never sends it.
 * Fake timers: no wall clock is read.
 */
const h = vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  type Listener = (...args: unknown[]) => void;
  return {
    emits: [] as { event: string; payload: Record<string, unknown> }[],
    listeners: new Map<string, Listener[]>(),
    ioListeners: new Map<string, Listener[]>(),
    acks: new Map<string, unknown>(),
  };
});
vi.mock('expo-clipboard', () => ({ setStringAsync: async () => {}, getStringAsync: async () => '' }));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: async () => ({ canceled: true, assets: null }) }));
vi.mock('react-native-webview', () => ({ WebView: () => null, default: () => null }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
vi.mock('expo-font', () => ({ useFonts: () => [true, null], loadAsync: async () => {}, isLoaded: () => true }));
vi.mock('expo-file-system/legacy', () => ({ documentDirectory: '/tmp/', readAsStringAsync: async () => '', writeAsStringAsync: async () => {}, getInfoAsync: async () => ({ exists: false }) }));
vi.mock('@sentry/react-native', () => ({ init: () => {}, captureException: () => {}, captureMessage: () => {}, wrap: (c: unknown) => c, addBreadcrumb: () => {}, setUser: () => {}, setTag: () => {} }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-navigation-bar', () => ({ NavigationBar: () => null, setButtonStyleAsync: async () => {}, setBackgroundColorAsync: async () => {}, setVisibilityAsync: async () => {} }));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('../../api/useSaveGameOnEnd', () => ({ useSaveGameOnEnd: () => {} }));
vi.mock('../../engine/engineRegistry', () => ({
  getEngineRuntime: () => ({
    engine: { attachBridge: () => {}, isAttached: () => true, handleLine: () => {}, initEngine: async () => {}, setPosition: () => {}, getBestMove: async () => 'e2e4', analyzePosition: async () => ({ lines: [] }) },
    buildHtml: () => '<html></html>',
  }),
}));
vi.mock('../../engine/StockfishBridge', () => ({ default: () => null }));
vi.mock('../../logic/ratingStorage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../logic/ratingStorage')>()),
  recordRatedGame: async () => 1500,
}));
vi.mock('../../logic/achievementStorage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../logic/achievementStorage')>()),
  unlockAchievement: async () => {},
}));
vi.mock('../../api/socket', () => {
  const add = (map: Map<string, ((...args: unknown[]) => void)[]>, event: string, fn: (...args: unknown[]) => void) => map.set(event, [...(map.get(event) ?? []), fn]);
  const remove = (map: Map<string, ((...args: unknown[]) => void)[]>, event: string, fn?: (...args: unknown[]) => void) =>
    map.set(event, fn ? (map.get(event) ?? []).filter((l) => l !== fn) : []);
  const socket = {
    id: 'fake',
    connected: true,
    io: {
      on: (event: string, fn: (...args: unknown[]) => void) => add(h.ioListeners, event, fn),
      off: (event: string, fn?: (...args: unknown[]) => void) => remove(h.ioListeners, event, fn),
    },
    on: (event: string, fn: (...args: unknown[]) => void) => {
      add(h.listeners, event, fn);
      return socket;
    },
    once: (event: string, fn: (...args: unknown[]) => void) => socket.on(event, fn),
    off: (event: string, fn?: (...args: unknown[]) => void) => {
      remove(h.listeners, event, fn);
      return socket;
    },
    emit: (event: string, payload: Record<string, unknown>, cb?: (...args: unknown[]) => void) => {
      h.emits.push({ event, payload });
      if (typeof cb === 'function') cb(h.acks.get(event) ?? { ok: true });
      return socket;
    },
    timeout: () => ({
      emit: (event: string, payload: Record<string, unknown>, cb?: (...args: unknown[]) => void) => {
        h.emits.push({ event, payload });
        if (typeof cb === 'function') cb(null, h.acks.get(event) ?? { ok: true });
      },
    }),
  };
  return { connectSocket: () => socket, disconnectSocket: () => {} };
});

const serverEmit = (event: string, payload?: unknown) => {
  for (const fn of h.listeners.get(event) ?? []) fn(payload);
};
const ioEmit = (event: string) => {
  for (const fn of h.ioListeners.get(event) ?? []) fn();
};
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const sent = (event: string) => h.emits.filter((e) => e.event === event);

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MESSAGE = 'This game was opened on another tab or device signed in to your account. It continues there.';
const ROOM = 'room-takeover';

function classicMatch(): MatchFoundPayload {
  return {
    roomId: ROOM,
    color: 'w',
    playerToken: 'token',
    opponent: { userId: null },
    timeControl: { initialSeconds: 300, incrementSeconds: 0 },
    isChess960: false,
    isKingOfTheHill: false,
    isThreeCheck: false,
    isSetupChess: false,
    isFogOfWar: false,
    isGiveaway: false,
    isAtomic: false,
    isDuckChess: false,
    isSpellChess: false,
    isHorde: false,
    isCrazyhouse: false,
    fen: START,
    whiteMs: 300_000,
    blackMs: 300_000,
  } as MatchFoundPayload;
}
const REJOIN_STATE_ACK = {
  ok: true,
  state: { fen: START, turn: 'w', color: 'w', timeControl: { initialSeconds: 300, incrementSeconds: 0 }, whiteMs: 290_000, blackMs: 300_000, moves: [], opponentConnected: true },
};

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  h.emits.length = 0;
  h.listeners.clear();
  h.ioListeners.clear();
  h.acks.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('2-player online: the seat is taken over by another tab / device of the same account', () => {
  it('shows the message instead of the game; the exit says seatTakenOver; a restored connection does not rejoin', async () => {
    const exits: unknown[] = [];
    render(<OnlineGameScreen authToken="t" match={classicMatch()} onExit={(reason) => exits.push(reason)} onAnalyze={() => {}} />);
    await flush(50);
    expect(screen.queryByText(MESSAGE)).toBeNull();
    expect(screen.getByText('Your turn')).toBeTruthy();

    serverEmit('seat_taken_over', { roomId: 'some-other-room' });
    await flush();
    expect(screen.queryByText(MESSAGE)).toBeNull(); // another room's takeover is not ours

    serverEmit('seat_taken_over', { roomId: ROOM });
    await flush();
    expect(screen.getByText(MESSAGE)).toBeTruthy();
    expect(screen.getByTestId('online-seat-taken-over')).toBeTruthy();
    expect(screen.queryByText('Your turn')).toBeNull();
    expect(screen.queryByText('Resign')).toBeNull();

    // a dropped and restored connection must not take the seat back
    serverEmit('disconnect');
    ioEmit('reconnect');
    await flush();
    expect(sent('rejoin_game')).toHaveLength(0);
    expect(screen.getByText(MESSAGE)).toBeTruthy();

    fireEvent.click(screen.getByTestId('online-seat-taken-over-exit'));
    expect(exits).toEqual(['seatTakenOver']);
  });

  it('an ordinary exit passes no reason (App clears the rejoin record as before)', async () => {
    const exits: unknown[] = [];
    render(<OnlineGameScreen authToken="t" match={classicMatch()} onExit={(reason) => exits.push(reason)} onAnalyze={() => {}} />);
    await flush(50);
    fireEvent.click(screen.getByText('‹ Menu'));
    expect(exits).toEqual([undefined]);
  });
});

describe('2-player online: a resumed tournament game re-registers as the participant', () => {
  it('after the rejoin succeeds it sends rejoin_tournament with the tournament id', async () => {
    h.acks.set('rejoin_game', REJOIN_STATE_ACK);
    render(<OnlineGameScreen authToken="t" match={classicMatch()} resume tournamentId="tour-1" keepSocketAlive onExit={() => {}} onAnalyze={() => {}} />);
    await flush(50);
    expect(sent('rejoin_game')).toHaveLength(1);
    expect(sent('rejoin_tournament').map((e) => e.payload)).toEqual([{ tournamentId: 'tour-1' }]);

    // a restored connection is a new socket id too: it re-registers again
    ioEmit('reconnect');
    await flush();
    expect(sent('rejoin_tournament')).toHaveLength(2);
  });

  it('a failed rejoin sends no rejoin_tournament; a game outside a tournament never sends it', async () => {
    h.acks.set('rejoin_game', { ok: false, error: 'The game was not found or has already ended.' });
    const first = render(<OnlineGameScreen authToken="t" match={classicMatch()} resume tournamentId="tour-1" onExit={() => {}} onAnalyze={() => {}} />);
    await flush(50);
    expect(sent('rejoin_game')).toHaveLength(1);
    expect(sent('rejoin_tournament')).toHaveLength(0);
    first.unmount();

    h.emits.length = 0;
    h.acks.set('rejoin_game', REJOIN_STATE_ACK);
    render(<OnlineGameScreen authToken="t" match={classicMatch()} resume onExit={() => {}} onAnalyze={() => {}} />);
    await flush(50);
    expect(sent('rejoin_game')).toHaveLength(1);
    expect(sent('rejoin_tournament')).toHaveLength(0);
  });
});
