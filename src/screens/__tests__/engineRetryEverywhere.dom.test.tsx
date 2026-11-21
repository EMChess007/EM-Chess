import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UciChessEngine } from '../../engine/ChessEngine';
import type { StockfishBridgeHandle } from '../../engine/StockfishBridge';
import { BOT_PERSONALITIES } from '../../logic/bots';
import type { TimeControl } from '../../types/timeControl';
import AnalysisScreen from '../AnalysisScreen';
import BotGameScreen from '../BotGameScreen';
import EngineVsEngineGameScreen from '../EngineVsEngineGameScreen';
import LocalGameScreen from '../LocalGameScreen';

/**
 * COMMAND #64: every screen that talks to the engine shows the SAME error + "Retry" the bot game got in #51
 * (components/EngineErrorRow + logic/useEngineRetry): engine vs engine, Analysis, and the Hint of the local and the bot game.
 * Engine and bridge are fakes (no WebView in jsdom); the screens are the real ones. Fake timers; no wall clock.
 */
const h = vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  return { mounts: 0, behaviour: 'fail' as 'fail' | 'ok', fen: '', answers: 0 };
});
const BRIDGE_ERROR = 'StockfishEngineAdapter: engine bridge did not become ready within 10000 ms';

const fakeEngine = {
  attachBridge: (_bridge: StockfishBridgeHandle | null) => {},
  isAttached: () => true,
  handleLine: (_line: string) => {},
  initEngine: async () => {
    if (h.behaviour === 'fail') throw new Error(BRIDGE_ERROR);
  },
  setPosition: (fen: string) => {
    h.fen = fen;
  },
  // The first two answers are legal opening moves, then the engine "thinks" for ever (the test ends there).
  getBestMove: (): Promise<string> => {
    h.answers += 1;
    if (h.answers > 2) return new Promise<string>(() => {});
    return Promise.resolve(h.fen.split(' ')[1] === 'b' ? 'e7e5' : 'e2e4');
  },
  analyzePosition: async () => ({ lines: [{ evaluation: { type: 'cp' as const, value: 20 }, moves: ['e2e4'] }] }),
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
vi.mock('../../api/useSaveGameOnEnd', () => ({ useSaveGameOnEnd: () => {} }));

const NO_CLOCK: TimeControl = { id: 'unlimited', label: 'No time limit', initialSeconds: 0, incrementSeconds: 0, category: 'unlimited' };

const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
};

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  h.mounts = 0;
  h.answers = 0;
  h.behaviour = 'fail';
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('engine vs engine', () => {
  it('shows the engine error with Retry; Retry remounts the bridge and the engine then plays', async () => {
    render(<EngineVsEngineGameScreen engine1={BOT_PERSONALITIES[0]} engine2={BOT_PERSONALITIES[1]} timeControl={NO_CLOCK} onExit={() => {}} onAnalyze={() => {}} />);
    await flush();
    expect(screen.getByTestId('eve-engine-error').textContent).toBe(`Engine error: ${BRIDGE_ERROR}`);
    expect(screen.getByTestId('eve-engine-retry')).toBeTruthy();
    const mountsBefore = h.mounts;

    h.behaviour = 'ok';
    fireEvent.click(screen.getByTestId('eve-engine-retry'));
    await flush();

    expect(h.mounts).toBeGreaterThan(mountsBefore); // a fresh bridge
    expect(screen.queryByTestId('eve-engine-error')).toBeNull();
    expect(screen.getAllByText("King's Pawn Game").length).toBeGreaterThan(0); // the engine's e2e4 was played
  });
});

describe('Analysis', () => {
  const renderAnalysis = () =>
    render(<AnalysisScreen initialFen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" chess960={false} fogOfWar={false} history={[]} onExit={() => {}} />);

  it('shows the engine error with Retry; Retry remounts the bridge and the analysis then runs', async () => {
    renderAnalysis();
    await flush();
    expect(screen.getByTestId('analysis-engine-error').textContent).toBe(`Engine error: ${BRIDGE_ERROR}`);
    const mountsBefore = h.mounts;

    h.behaviour = 'ok';
    fireEvent.click(screen.getByTestId('analysis-engine-retry'));
    await flush();

    expect(h.mounts).toBeGreaterThan(mountsBefore);
    expect(screen.queryByTestId('analysis-engine-error')).toBeNull();
  });
});

describe('Hint', () => {
  it('local game: a failed hint shows the error + Retry; Retry asks again and the hint appears', async () => {
    render(<LocalGameScreen timeControl={NO_CLOCK} authToken={null} onExit={() => {}} onAnalyze={() => {}} />);
    await flush();
    fireEvent.click(screen.getByText('Hint'));
    await flush();
    expect(screen.getByTestId('local-hint-error').textContent).toBe(`Engine error: ${BRIDGE_ERROR}`);
    expect(screen.queryByText('Thinking of a hint...')).toBeNull();
    const mountsBefore = h.mounts;

    h.behaviour = 'ok';
    fireEvent.click(screen.getByTestId('local-hint-retry'));
    await flush();

    expect(h.mounts).toBeGreaterThan(mountsBefore);
    expect(screen.queryByTestId('local-hint-error')).toBeNull();
    expect(screen.getByText('Hint: e4')).toBeTruthy();
  });

  it('bot game: a failed hint shows the error + Retry; Retry asks again and the hint appears', async () => {
    h.behaviour = 'ok'; // the bot (user plays white) does not move first
    render(<BotGameScreen bot={BOT_PERSONALITIES[0]} timeControl={NO_CLOCK} colorChoice="w" authToken={null} onExit={() => {}} onAnalyze={() => {}} />);
    await flush();
    h.behaviour = 'fail';
    fireEvent.click(screen.getByText('Hint'));
    await flush();
    expect(screen.getByTestId('bot-hint-error').textContent).toBe(`Engine error: ${BRIDGE_ERROR}`);
    expect(screen.queryByTestId('bot-engine-error')).toBeNull(); // the hint failure is not the bot's

    h.behaviour = 'ok';
    fireEvent.click(screen.getByTestId('bot-hint-retry'));
    await flush();

    expect(screen.queryByTestId('bot-hint-error')).toBeNull();
    expect(screen.getByText('Hint: e4')).toBeTruthy();
  });
});
