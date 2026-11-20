import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tapMove } from '../../test/domKit';
import type { MatchFoundPayload } from '../../types/multiplayer';
import OnlineGameScreen from '../OnlineGameScreen';

/**
 * Knightmate ONLINE, rendered, with a scripted fake socket (what the SERVER answers is written out; the server's own rules are tested in the backend, scripts/test-knightmate.mjs and
 * test-multiplayer.mjs). The real OnlineGameScreen and the real board, against the real engine:
 *  - the game is labelled "Knightmate", draws the royal knights with a crown badge and the Commoners with an "M" badge, and is NOT rated;
 *  - the promotion picker offers Queen, Rook, Bishop and COMMONER -- never a Knight -- and choosing the Commoner sends make_move with promotion 'm'; the move list writes "axb8=M";
 *  - the opponent's promotion to a Commoner arrives as promotion 'm' / san "bxa1=M" and is replayed into the same position;
 *  - the Rules entry of the options menu opens the sheet (with the legend) in the online game too;
 *  - a flag fall against a bare royal knight arrives as { reason: 'timeout', winner: null } and is shown as a draw.
 * Fake timers: no wall clock is read.
 */
const h = vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  type Listener = (...args: unknown[]) => void;
  return {
    emits: [] as { event: string; payload: Record<string, unknown> }[],
    listeners: new Map<string, Listener[]>(),
    acks: new Map<string, unknown>(),
    rated: [] as unknown[][],
    achievements: [] as string[],
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

/** White to move; the pawn on a7 can capture the commoner on b8 and promote (a8 is occupied by a rook, so a7 -> a8 is blocked). */
const PROMOTE_FEN = 'rmbq1bmr/P1ppppp1/5k2/7p/8/5K2/1PPPPPPP/RMBQ1BMR w - - 0 6';
/** After 6.axb8=M (what the server answers). */
const AFTER_PROMOTION_FEN = 'rMbq1bmr/2ppppp1/5k2/7p/8/5K2/1PPPPPPP/RMBQ1BMR b - - 0 6';
/** Black to move; its pawn on b2 captures the rook on a1 and promotes. */
const BLACK_PROMOTE_FEN = 'rmbqkbmr/8/8/8/8/8/1p6/R3K3 b - - 0 20';
/** After 20...bxa1=M (what the server answers). */
const AFTER_BLACK_PROMOTION_FEN = 'rmbqkbmr/8/8/8/8/8/8/m3K3 w - - 0 21';

function matchOf(fen: string, color: 'w' | 'b'): MatchFoundPayload {
  return {
    roomId: 'room-km',
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
    isKnightmate: true,
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
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Knightmate online (rendered)', () => {
  it('is labelled Knightmate, draws the crown and "M" badges on the theme\'s knight and king, and offers no opening name', async () => {
    render(<OnlineGameScreen authToken="t" match={matchOf('rmbqkbmr/pppppppp/8/8/8/8/PPPPPPPP/RMBQKBMR w KQkq - 0 1', 'w')} onExit={() => {}} onAnalyze={() => {}} />);
    await flush(50);
    expect(screen.getByText('Knightmate')).toBeTruthy();
    expect(screen.queryByText(/Opening/)).toBeNull();
    expect(document.querySelectorAll('[aria-label="crown badge"]')).toHaveLength(2);
    expect(document.querySelectorAll('[aria-label="commoner badge"]')).toHaveLength(4);
    expect(document.querySelectorAll('[data-piece="wn"], [data-piece="bn"]')).toHaveLength(0);
  });

  it('the promotion picker offers Queen, Rook, Bishop and Commoner (no Knight); the Commoner goes out as promotion "m" and is written "axb8=M"', async () => {
    render(<OnlineGameScreen authToken="t" match={matchOf(PROMOTE_FEN, 'w')} onExit={() => {}} onAnalyze={() => {}} />);
    await flush(50);
    h.acks.set('make_move', { ok: true, fen: AFTER_PROMOTION_FEN, san: 'axb8=M', turn: 'b', whiteMs: 299_000, blackMs: 300_000 });
    tapMove('a7', 'b8');
    await flush(50);

    expect(screen.getByLabelText('Promote to Queen')).toBeTruthy();
    expect(screen.getByLabelText('Promote to Rook')).toBeTruthy();
    expect(screen.getByLabelText('Promote to Bishop')).toBeTruthy();
    expect(screen.getByLabelText('Promote to Commoner')).toBeTruthy();
    expect(screen.queryByLabelText('Promote to Knight')).toBeNull();
    expect(screen.queryByLabelText('Promote to King')).toBeNull();
    expect(h.emits.filter((e) => e.event === 'make_move')).toHaveLength(0); // nothing is sent until a piece is chosen

    fireEvent.click(screen.getByLabelText('Promote to Commoner'));
    await flush(50);
    const made = h.emits.filter((e) => e.event === 'make_move');
    expect(made).toHaveLength(1);
    expect(made[0].payload).toMatchObject({ roomId: 'room-km', from: 'a7', to: 'b8', promotion: 'm' });
    expect(screen.getByText('axb8=M')).toBeTruthy(); // the move list entry
    expect(screen.getByText(/Last move: axb8=M/)).toBeTruthy();
    // the new Commoner stands on b8 (the Black Commoner that stood there was captured)
    expect(document.querySelectorAll('[data-piece="bm"]')).toHaveLength(1); // Black's b8 Commoner is gone (g8 remains)
    expect(document.querySelectorAll('[data-piece="wm"]').length).toBeGreaterThanOrEqual(3); // b1, g1 and the new one (a sliding copy may be drawn too)
  });

  it('a promotion to a Queen is still offered and sent as "q" (the picker is not Commoner-only)', async () => {
    render(<OnlineGameScreen authToken="t" match={matchOf(PROMOTE_FEN, 'w')} onExit={() => {}} onAnalyze={() => {}} />);
    await flush(50);
    h.acks.set('make_move', { ok: true, fen: 'rQbq1bmr/2ppppp1/5k2/7p/8/5K2/1PPPPPPP/RMBQ1BMR b - - 0 6', san: 'axb8=Q', turn: 'b', whiteMs: 299_000, blackMs: 300_000 });
    tapMove('a7', 'b8');
    await flush(50);
    fireEvent.click(screen.getByLabelText('Promote to Queen'));
    await flush(50);
    expect(h.emits.filter((e) => e.event === 'make_move')[0].payload).toMatchObject({ from: 'a7', to: 'b8', promotion: 'q' });
  });

  it('an opponent promotion to a Commoner (promotion "m", san "bxa1=M") is replayed into the server position and listed', async () => {
    render(<OnlineGameScreen authToken="t" match={matchOf(BLACK_PROMOTE_FEN, 'w')} onExit={() => {}} onAnalyze={() => {}} />);
    await flush(50);
    // It is Black's move in this position: the opponent (Black) captures on a1 and promotes to a Commoner.
    expect(document.querySelectorAll('[data-piece="bm"]')).toHaveLength(2); // g8 and b8, before the move
    await act(async () => serverEmit('opponent_move', { from: 'b2', to: 'a1', promotion: 'm', san: 'bxa1=M', fen: AFTER_BLACK_PROMOTION_FEN, turn: 'w', whiteMs: 300_000, blackMs: 299_000 }));
    await flush(50);
    expect(screen.getByText('bxa1=M')).toBeTruthy(); // the move list entry
    expect(document.querySelectorAll('[data-piece="bm"]')).toHaveLength(3); // the new Commoner on a1, with its badge
    expect(document.querySelectorAll('[aria-label="commoner badge"]')).toHaveLength(3);
  });

  it('the options menu has Rules in the online game; the sheet opens with the legend and closes', async () => {
    render(<OnlineGameScreen authToken="t" match={matchOf('rmbqkbmr/pppppppp/8/8/8/8/PPPPPPPP/RMBQKBMR w KQkq - 0 1', 'w')} onExit={() => {}} onAnalyze={() => {}} />);
    await flush(50);
    fireEvent.click(screen.getByText('More'));
    await flush(50);
    fireEvent.click(screen.getByText('Rules'));
    await flush(50);
    expect(screen.getByText('How to play Knightmate')).toBeTruthy();
    expect(screen.getByText('Notation: K / M / =M')).toBeTruthy();
    expect(screen.getByTestId('knightmate-legend').querySelectorAll('[aria-label="crown badge"]')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('rules-close'));
    await flush(50);
    expect(screen.queryByText('How to play Knightmate')).toBeNull();
  });

  it('a flag fall against a bare royal knight (server: timeout, no winner) is a draw, and an online Knightmate game is never rated', async () => {
    render(<OnlineGameScreen authToken="t" match={matchOf(PROMOTE_FEN, 'w')} onExit={() => {}} onAnalyze={() => {}} />);
    await flush(50);
    await act(async () => serverEmit('game_over', { reason: 'timeout', winner: null }));
    await flush(50);
    expect(screen.getByText('Draw')).toBeTruthy();
    expect(screen.getByText('by Timeout')).toBeTruthy();
    expect(h.rated).toEqual([]);
    expect(h.achievements).toEqual([]);
  });
});
