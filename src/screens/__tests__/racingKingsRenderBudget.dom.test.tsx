import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderCount, resetRenderCounts } from '../../test/renderCounter';
import { tapMove } from '../../test/domKit';
import LocalGameScreen from '../LocalGameScreen';

vi.mock('../../components/Square', async (importOriginal) => (await import('../../test/renderCounter')).countModule('Square', await importOriginal()));
vi.mock('../../components/Piece', async (importOriginal) => (await import('../../test/renderCounter')).countModule('Piece', await importOriginal()));

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
vi.mock('expo-file-system/legacy', () => ({ documentDirectory: '/tmp/', readAsStringAsync: async () => '', writeAsStringAsync: async () => {}, getInfoAsync: async () => ({ exists: false }) }));
vi.mock('@sentry/react-native', () => ({ init: () => {}, captureException: () => {}, captureMessage: () => {}, wrap: (c: unknown) => c, addBreadcrumb: () => {}, setUser: () => {}, setTag: () => {} }));
vi.mock('react-native-webview', () => ({ WebView: () => null, default: () => null }));
vi.mock('expo-clipboard', () => ({ setStringAsync: async () => {}, getStringAsync: async () => '' }));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: async () => ({ canceled: true, assets: null }) }));
vi.mock('expo-font', () => ({ useFonts: () => [true, null], loadAsync: async () => {}, isLoaded: () => true }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('../../api/socket', () => ({ connectSocket: () => ({ on: () => {}, off: () => {}, emit: () => {} }), disconnectSocket: () => {} }));
vi.mock('../../api/authStorage', () => ({ loadAuthSession: async () => null, saveAuthSession: async () => {}, clearAuthSession: async () => {} }));
vi.mock('../../api/activeGameStorage', () => ({ loadResumableGame: async () => null, saveActiveGame: async () => {}, clearActiveGame: async () => {}, touchActiveGame: async () => {} }));

/** Counts every ChessEngine construction (the real class, subclassed; nothing else changes). */
const engines = vi.hoisted(() => ({ built: 0 }));
vi.mock('../../logic/ChessEngine', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../logic/ChessEngine')>();
  class CountedEngine extends mod.ChessEngine {
    constructor(...args: ConstructorParameters<typeof mod.ChessEngine>) {
      super(...args);
      engines.built++;
    }
  }
  return { ...mod, ChessEngine: CountedEngine };
});

/**
 * COMMAND #41: does the Racing Kings wiring (the racingKings prop threaded into LocalGameScreen's engine, ChessBoard's engines, the outcome memo) cost more work per render than
 * Classic? Renders and engine constructions are COUNTED (no clock is read; fake timers), for the same interactions, in a Racing Kings game and a Classic game, and Racing Kings may
 * not cost more. The literal bounds are the Classic numbers measured on this branch.
 */
const TC5 = { id: 'blitz-5', label: '5 min', initialSeconds: 300, incrementSeconds: 0, category: 'blitz' as const };

interface Cost {
  mountEngines: number;
  tickEngines: number;
  tickSquares: number;
  moveEngines: number;
  moveSquares: number;
}

function measure(racingKings: boolean, from: string, to: string): Cost {
  engines.built = 0;
  resetRenderCounts();
  const { unmount } = render(<LocalGameScreen timeControl={TC5} racingKings={racingKings} authToken={null} onExit={() => {}} onAnalyze={() => {}} />);
  act(() => void vi.advanceTimersByTime(0));
  const mountEngines = engines.built;
  engines.built = 0;
  resetRenderCounts();
  for (let i = 0; i < 5; i++) act(() => void vi.advanceTimersByTime(1000)); // five clock ticks, no move
  const tickEngines = engines.built;
  const tickSquares = renderCount('Square');
  engines.built = 0;
  resetRenderCounts();
  tapMove(from, to);
  act(() => void vi.advanceTimersByTime(0));
  const cost = { mountEngines, tickEngines, tickSquares, moveEngines: engines.built, moveSquares: renderCount('Square') };
  unmount();
  return cost;
}

describe('Racing Kings costs no more than Classic on the Local game screen', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a clock tick builds no engine and re-renders no square, in both games; a move costs Racing Kings no more than Classic', () => {
    const classic = measure(false, 'g1', 'f3');
    const racing = measure(true, 'e2', 'g3');
    console.log('local game cost: classic', JSON.stringify(classic), 'racing kings', JSON.stringify(racing));
    expect(classic.tickEngines).toBe(0);
    expect(classic.tickSquares).toBe(0);
    expect(racing.tickEngines).toBe(0);
    expect(racing.tickSquares).toBe(0);
    expect(racing.mountEngines).toBeLessThanOrEqual(classic.mountEngines);
    expect(racing.moveEngines).toBeLessThanOrEqual(classic.moveEngines);
    // the two moves differ (1.Nf3 from g1 vs 1.Ng3 from e2), so their highlight / legal-dot squares differ by a couple: one board redraw plus its highlights in both, never a second board
    expect(racing.moveSquares).toBeLessThanOrEqual(classic.moveSquares + 2);
    expect(racing.moveSquares).toBeLessThan(2 * 64);
  });
});
