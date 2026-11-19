import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tapMove } from '../../test/domKit';
import type { AnalyzeParams } from '../../types/history';
import type { MatchFoundPayload } from '../../types/multiplayer';
import AnalysisScreen from '../AnalysisScreen';
import BoardSetupScreen from '../BoardSetupScreen';
import ChallengeScreen from '../ChallengeScreen';
import OnlineGameScreen from '../OnlineGameScreen';

/**
 * COMMAND #53 (From Position, Part 2: online by direct challenge). Rendered, with a scripted fake socket (what the SERVER would answer is written out; the
 * server's own rules are tested in the backend, scripts/test-from-position.mjs and test-multiplayer.mjs):
 *  - the Board Editor offers "Challenge a friend" only when signed in;
 *  - the challenge screen opened with a FEN has no Join / game chips and sends `initialFen` + the time control and NO variant flag;
 *  - the online game starts from the FEN with Black to move, is labelled "From Position", shows no opening name, and is NOT rated;
 *  - a rejoin replays the moves from the START FEN (a replay from the classical start could not even play them);
 *  - after the game, "Game Review" hands the START FEN and the played moves to the analysis, and the analysis screen shows them.
 * Fake timers: no wall clock is read.
 */
const h = vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  type Listener = (...args: unknown[]) => void;
  return {
    emits: [] as { event: string; payload: Record<string, unknown> }[],
    listeners: new Map<string, Listener[]>(),
    /** What the next acknowledged emit of an event answers (the server's ack). */
    acks: new Map<string, unknown>(),
    rated: [] as unknown[][],
    achievements: [] as string[],
    analysed: [] as string[],
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
    engine: { attachBridge: () => {}, isAttached: () => true, handleLine: () => {}, initEngine: async () => {}, setPosition: () => {}, getBestMove: async () => 'e2e4', analyzePosition: async (fen: string) => {
        // The analysis asks about each position of the game: remembered, and answered with the position's own first legal move (so the SAN conversion has a real move).
        h.analysed.push(fen);
        const { Chess } = await import('chess.js');
        const move = new Chess(fen).moves({ verbose: true })[0];
        return { lines: [{ evaluation: { type: 'cp', value: 20 }, moves: move ? [`${move.from}${move.to}${move.promotion ?? ''}`] : [] }] };
      } },
    buildHtml: () => '<html></html>',
  }),
}));
vi.mock('../../engine/StockfishBridge', () => ({ default: () => null }));
vi.mock('../../logic/ratingStorage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../logic/ratingStorage')>()),
  recordRatedGame: async (...args: unknown[]) => {
    h.rated.push(args);
    return 1500;
  },
}));
vi.mock('../../logic/achievementStorage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../logic/achievementStorage')>()),
  unlockAchievement: async (id: string) => {
    h.achievements.push(id);
  },
}));
vi.mock('../../api/socket', () => {
  const socket = {
    id: 'fake',
    connected: true,
    io: { on: () => {}, off: () => {} },
    on: (event: string, fn: (...args: unknown[]) => void) => {
      h.listeners.set(event, [...(h.listeners.get(event) ?? []), fn]);
      return socket;
    },
    once: (event: string, fn: (...args: unknown[]) => void) => socket.on(event, fn),
    off: (event: string, fn?: (...args: unknown[]) => void) => {
      h.listeners.set(event, fn ? (h.listeners.get(event) ?? []).filter((l) => l !== fn) : []);
      return socket;
    },
    // a plain emit's ack callback gets the answer alone; `timeout(ms).emit`'s gets (error, answer) - both shapes are real socket.io
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
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

/** Black to move; one move (Qh4#) mates. */
const MATE_FEN = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2';
/** Black to move and nothing like the classical start: Black has pawns a7-d7 and White e2-h2. */
const QUIET_FEN = '4k3/pppp4/8/8/8/8/4PPPP/4K3 b - - 0 7';

function matchOf(fen: string, color: 'w' | 'b'): MatchFoundPayload {
  return {
    roomId: 'room-1',
    color,
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
    isFromPosition: true,
    fen,
    whiteMs: 300_000,
    blackMs: 300_000,
  } as MatchFoundPayload;
}

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  h.emits.length = 0;
  h.listeners.clear();
  h.acks.clear();
  h.rated.length = 0;
  h.achievements.length = 0;
  h.analysed.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('From Position online: the Board Editor and the challenge screen', () => {
  it('offers "Challenge a friend" only when signed in, and hands the FEN over with mode "friend"', async () => {
    const played: [string, string][] = [];
    const { unmount } = render(<BoardSetupScreen onBack={() => {}} onAnalyze={() => {}} fromPosition onPlay={(fen, mode) => played.push([fen, mode])} initialFen={QUIET_FEN} />);
    await flush(50);
    fireEvent.click(screen.getByTestId('play-from-here'));
    await flush(50);
    expect(screen.queryByTestId('from-position-friend')).toBeNull(); // signed out
    unmount();

    render(<BoardSetupScreen onBack={() => {}} onAnalyze={() => {}} fromPosition onlineAvailable onPlay={(fen, mode) => played.push([fen, mode])} initialFen={QUIET_FEN} />);
    await flush(50);
    fireEvent.click(screen.getByTestId('play-from-here'));
    await flush(50);
    fireEvent.click(screen.getByTestId('from-position-friend'));
    expect(played).toEqual([[QUIET_FEN, 'friend']]);
  });

  it('the FEN field has the testID "fen-input" (the Android driver scrolls to it); a typed FEN + Load + Play from here hands that FEN over', async () => {
    const played: [string, string][] = [];
    render(<BoardSetupScreen onBack={() => {}} onAnalyze={() => {}} fromPosition onPlay={(fen, mode) => played.push([fen, mode])} initialFen={QUIET_FEN} />);
    await flush(50);
    const field = screen.getByTestId('fen-input') as HTMLTextAreaElement;
    expect(field.value).toBe(QUIET_FEN);
    const typed = '4k3/pppp4/8/8/8/8/4PPPP/4K3 b - - 0 7';
    fireEvent.change(field, { target: { value: typed } });
    fireEvent.click(screen.getByText('Load'));
    await flush(50);
    fireEvent.click(screen.getByTestId('play-from-here'));
    await flush(50);
    fireEvent.click(screen.getByTestId('from-position-local'));
    expect(played).toEqual([[typed, 'local']]);
  });

  it('a refused position never offers the challenge', async () => {
    const played: unknown[] = [];
    render(<BoardSetupScreen onBack={() => {}} onAnalyze={() => {}} fromPosition onlineAvailable onPlay={(fen, mode) => played.push([fen, mode])} initialFen="7k/6Q1/6K1/8/8/8/8/8 b - - 0 1" />);
    await flush(50);
    fireEvent.click(screen.getByTestId('play-from-here'));
    await flush(50);
    expect(screen.queryByTestId('from-position-friend')).toBeNull();
    expect(screen.getByText(/already checkmate/)).toBeTruthy();
    expect(played).toEqual([]);
  });

  it('the challenge screen opened with a FEN sends initialFen + the time control and no variant flag; there is no Join and no game chips', async () => {
    h.acks.set('create_challenge', { ok: true, code: 'ABC234' });
    render(<ChallengeScreen authToken="t" fromPositionFen={QUIET_FEN} onMatchFound={() => {}} onFriendRoom={() => {}} onSetupChessPaired={() => {}} onBack={() => {}} />);
    await flush(50);
    expect(screen.getByTestId('from-position-note')).toBeTruthy();
    expect(screen.queryByText('Join by Code')).toBeNull();
    expect(screen.queryByText('Create Challenge')).toBeNull();
    expect(screen.queryByText('Atomic')).toBeNull(); // the game chips are not offered

    fireEvent.click(screen.getByText('5 min'));
    await flush(50);
    const created = h.emits.filter((e) => e.event === 'create_challenge');
    expect(created).toHaveLength(1);
    expect(created[0].payload).toMatchObject({
      timeControl: { initialSeconds: 300, incrementSeconds: 0 },
      timeControlLabel: '5 min',
      initialFen: QUIET_FEN,
    });
    // every variant flag is false (the server refuses a FEN together with a variant)
    const flags = Object.entries(created[0].payload).filter(([key]) => /^is[A-Z]/.test(key));
    expect(flags.length).toBeGreaterThan(5);
    expect(flags.every(([, value]) => value === false)).toBe(true);
    expect(screen.getByText('ABC234')).toBeTruthy(); // the code to share
  });

  it('a server refusal of the position is shown and nothing waits', async () => {
    h.acks.set('create_challenge', { ok: false, error: 'This position is already a draw (insufficient material or the fifty-move rule) - there is no game to play.' });
    render(<ChallengeScreen authToken="t" fromPositionFen={QUIET_FEN} onMatchFound={() => {}} onFriendRoom={() => {}} onSetupChessPaired={() => {}} onBack={() => {}} />);
    await flush(50);
    fireEvent.click(screen.getByText('5 min'));
    await flush(50);
    expect(screen.getByText(/already a draw/)).toBeTruthy();
    expect(screen.queryByText('Waiting for your friend to join...')).toBeNull();
  });

  it('an ordinary challenge screen is unchanged: menu first, game chips, no initialFen', async () => {
    render(<ChallengeScreen authToken="t" onMatchFound={() => {}} onFriendRoom={() => {}} onSetupChessPaired={() => {}} onBack={() => {}} />);
    await flush(50);
    expect(screen.getByText('Create Challenge')).toBeTruthy();
    expect(screen.getByText('Join by Code')).toBeTruthy();
    expect(screen.queryByTestId('from-position-note')).toBeNull();
  });
});

describe('From Position online: the game, rejoin and the post-game review', () => {
  it('starts from the FEN with Black to move, is labelled From Position, shows no opening and is NOT rated; Game Review opens at the START FEN', async () => {
    const analyses: AnalyzeParams[] = [];
    render(<OnlineGameScreen authToken="t" match={matchOf(MATE_FEN, 'b')} onExit={() => {}} onAnalyze={(p) => analyses.push(p)} />);
    await flush(50);
    expect(screen.getByText('From Position')).toBeTruthy();

    h.acks.set('make_move', { ok: true, fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', san: 'Qh4#', turn: 'w', whiteMs: 300_000, blackMs: 299_000 });
    tapMove('d8', 'h4', 2); // the board is turned round for Black (view 2 = seen from the far side)
    await flush(50);
    const made = h.emits.filter((e) => e.event === 'make_move');
    expect(made).toHaveLength(1);
    expect(made[0].payload).toMatchObject({ roomId: 'room-1', from: 'd8', to: 'h4' });

    await act(async () => serverEmit('game_over', { reason: 'checkmate', winner: 'b' }));
    await flush(50);
    expect(h.rated).toEqual([]); // unrated
    expect(h.achievements).toEqual([]);
    expect(screen.queryByText(/Sicilian|Opening/)).toBeNull();

    fireEvent.click(screen.getByText('Game Review'));
    await flush(50);
    expect(analyses).toHaveLength(1);
    expect(analyses[0].initialFen).toBe(MATE_FEN);
    expect(analyses[0].chess960).toBe(false);
    expect(analyses[0].history).toHaveLength(1);
    expect(analyses[0].history[0].fenBefore).toBe(MATE_FEN);
    expect(analyses[0].history[0].move.san).toBe('Qh4#');

    // ...and the analysis screen built from those params shows the game that was played from the FEN.
    render(<AnalysisScreen {...analyses[0]} onExit={() => {}} />);
    await flush(500);
    expect(screen.getAllByText(/Qh4#/).length).toBeGreaterThan(0);
    // the engine was asked about the START position first (the opening analysis at the FEN); the final position is checkmate, so there is nothing to ask there
    expect(h.analysed[0]).toBe(MATE_FEN);
    expect(h.analysed).toEqual([MATE_FEN]);
  });

  it('a rejoin rebuilds the move list from the START FEN (the moves are not playable from the classical start)', async () => {
    const afterTwo = '4k3/1ppp4/8/p7/4P3/8/5PPP/4K3 b - - 0 8';
    h.acks.set('rejoin_game', {
      ok: true,
      state: {
        fen: afterTwo,
        initialFen: QUIET_FEN,
        isFromPosition: true,
        turn: 'b',
        color: 'b',
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
        whiteMs: 290_000,
        blackMs: 295_000,
        moves: [
          { from: 'a7', to: 'a5', san: 'a5' },
          { from: 'e2', to: 'e4', san: 'e4' },
        ],
        opponentConnected: true,
      },
    });
    render(<OnlineGameScreen authToken="t" match={matchOf(QUIET_FEN, 'b')} resume onExit={() => {}} onAnalyze={() => {}} />);
    await flush(100);
    expect(h.emits.some((e) => e.event === 'rejoin_game' && e.payload.roomId === 'room-1')).toBe(true);
    expect(screen.getByText('a5')).toBeTruthy();
    expect(screen.getByText('e4')).toBeTruthy();
  });
});
