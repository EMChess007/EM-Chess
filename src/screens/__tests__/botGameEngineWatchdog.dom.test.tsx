import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UciChessEngine } from '../../engine/ChessEngine';
import type { StockfishBridgeHandle } from '../../engine/StockfishBridge';
import { BOT_PERSONALITIES } from '../../logic/bots';
import type { TimeControl } from '../../types/timeControl';
import BotGameScreen from '../BotGameScreen';

/**
 * BOT vs A DEAD ENGINE BRIDGE (command #51). Before: when the Stockfish WebView never became ready or died, getBestMove never settled and the bot screen
 * showed "Thinking..." forever. Now: the first bridge failure is retried ONCE on a freshly mounted bridge; the second shows the engine error with a Retry button.
 * The engine and the bridge are fakes (no WebView in jsdom); the screen, board and clock are the real ones. Fake timers; no wall clock.
 */
const h = vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false; // the api client (pulled in by the rating storage) reads it at import; false = ignore any URL override
  return {
  mounts: 0,
  initCalls: 0,
  initBehaviour: 'fail' as 'fail' | 'ok',
  bestMoveCalls: 0,
  };
});
const BRIDGE_ERROR = 'StockfishEngineAdapter: engine bridge did not become ready within 10000 ms';

const fakeEngine = {
  attachBridge: (_bridge: StockfishBridgeHandle | null) => {},
  isAttached: () => true,
  handleLine: (_line: string) => {},
  initEngine: async () => {
    h.initCalls += 1;
    if (h.initBehaviour === 'fail') throw new Error(BRIDGE_ERROR);
  },
  setPosition: (_fen: string) => {},
  getBestMove: async () => {
    h.bestMoveCalls += 1;
    return 'e2e4';
  },
  analyzePosition: async () => ({ lines: [] }),
} satisfies UciChessEngine;

vi.mock('../../engine/engineRegistry', () => ({
  getEngineRuntime: () => ({ engine: fakeEngine, buildHtml: () => '<html></html>' }),
}));
vi.mock('../../engine/StockfishBridge', () => ({
  default: function FakeBridge() {
    useEffect(() => {
      h.mounts += 1;
    }, []);
    return null;
  },
}));
vi.mock('../../logic/diagnosticLog', () => ({ logDiagnostic: vi.fn() }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { hostUri: undefined }, expoGoConfig: undefined } }));
vi.mock('../../api/useSaveGameOnEnd', () => ({ useSaveGameOnEnd: () => {} })); // the network client is not what is under test

const NO_CLOCK: TimeControl = { id: 'unlimited', label: 'No time limit', initialSeconds: 0, incrementSeconds: 0, category: 'unlimited' };

const renderBotAsWhite = () =>
  render(<BotGameScreen bot={BOT_PERSONALITIES[0]} timeControl={NO_CLOCK} colorChoice="b" authToken={null} onExit={() => {}} onAnalyze={() => {}} />);

const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
};

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  h.mounts = 0;
  h.initCalls = 0;
  h.bestMoveCalls = 0;
  h.initBehaviour = 'fail';
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('BotGameScreen with an engine bridge that never becomes ready', () => {
  it('retries once on a freshly mounted bridge, then shows the error and Retry instead of "Thinking..." forever', async () => {
    renderBotAsWhite(); // the user plays black, so the bot (white) moves first
    await flush();

    expect(h.initCalls).toBe(2); // the first attempt + exactly ONE automatic retry
    expect(h.mounts).toBe(2); // the retry ran on a freshly mounted bridge (the first mount + the remount)
    expect(screen.getByTestId('bot-engine-error').textContent).toBe(`Engine error: ${BRIDGE_ERROR}`);
    expect(screen.getByTestId('bot-engine-retry')).toBeTruthy();
    expect(screen.queryByText('Thinking...')).toBeNull();

    await flush();
    expect(h.initCalls).toBe(2); // and it does not keep looping on its own
    expect(h.bestMoveCalls).toBe(0);
  });

  it('Retry remounts the bridge and, once the engine answers, clears the error and plays the bot move', async () => {
    renderBotAsWhite();
    await flush();
    expect(screen.getByTestId('bot-engine-retry')).toBeTruthy();

    h.initBehaviour = 'ok'; // the WebView finally works
    fireEvent.click(screen.getByTestId('bot-engine-retry'));
    await flush();

    expect(h.mounts).toBe(3); // Retry = a third fresh bridge
    expect(h.bestMoveCalls).toBe(1);
    expect(screen.queryByTestId('bot-engine-error')).toBeNull();
    expect(screen.queryByTestId('bot-engine-retry')).toBeNull();
    expect(screen.getByText("King's Pawn Game")).toBeTruthy(); // the engine's e2e4 was played (the real opening detector names it)
  });

  it('a first failure that the fresh bridge cures never shows an error at all', async () => {
    let calls = 0;
    const real = fakeEngine.initEngine;
    fakeEngine.initEngine = async () => {
      calls += 1;
      if (calls === 1) throw new Error(BRIDGE_ERROR); // e.g. the WebView process died once
      h.initBehaviour = 'ok';
      return real();
    };
    try {
      renderBotAsWhite();
      await flush();
      expect(calls).toBe(2);
      expect(h.mounts).toBe(2);
      expect(h.bestMoveCalls).toBe(1);
      expect(screen.queryByTestId('bot-engine-error')).toBeNull();
      expect(screen.getByText("King's Pawn Game")).toBeTruthy();
    } finally {
      fakeEngine.initEngine = real;
    }
  });

  it('an error that is not about the bridge (an illegal engine move) is shown at once, with no remount', async () => {
    h.initBehaviour = 'ok';
    const realBest = fakeEngine.getBestMove;
    fakeEngine.getBestMove = async () => 'e2e5';
    try {
      renderBotAsWhite();
      await flush();
      expect(h.mounts).toBe(1);
      expect(screen.getByTestId('bot-engine-error').textContent).toContain('Invalid move from engine');
    } finally {
      fakeEngine.getBestMove = realBest;
    }
  });
});
