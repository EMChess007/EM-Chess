import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_FAILED_PREFIX, BRIDGE_RESTARTED_LINE, createBridgeSupervisor, ENGINE_BRIDGE_ERROR_PREFIX, MAX_BRIDGE_RESTARTS } from '../../engine/bridgeSupervisor';
import { StockfishEngineAdapter } from '../../engine/StockfishEngineAdapter';

/**
 * THE ENGINE BRIDGE WATCHDOG (command #51). The bot used to hang forever when the Stockfish WebView never sent BRIDGE_READY or its process died.
 * A fake bridge stands in for the WebView: it records the commands the adapter posts, and the test plays the engine's side by calling handleLine.
 * Fake timers only; the 10 s / 20 s bounds below are LITERALS (a test that read them from the module under test could never catch a changed constant).
 */
const READY_MS = 10000;

function setup() {
  const adapter = new StockfishEngineAdapter();
  const sent: string[] = [];
  adapter.attachBridge({ postCommand: (command) => void sent.push(command) });
  /** The engine side of a healthy handshake: answers `uci` / `isready` as they are posted. */
  const answerHandshake = () => {
    adapter.handleLine('BRIDGE_READY');
  };
  const answer = (command: string, reply: string) => {
    expect(sent).toContain(command);
    adapter.handleLine(reply);
  };
  return { adapter, sent, answerHandshake, answer };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('initEngine: a bridge that never becomes ready', () => {
  it('rejects with a clear error after 10 s instead of hanging', async () => {
    const { adapter, sent } = setup();
    const result = adapter.initEngine();
    const assertion = expect(result).rejects.toThrow('engine bridge did not become ready within 10000 ms');
    await vi.advanceTimersByTimeAsync(READY_MS - 1);
    expect(sent).toEqual([]); // still waiting: nothing was posted into a WebView that is not listening
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(sent).toEqual([]);
  });

  it('every engine error starts with the prefix the screens retry on', async () => {
    const { adapter } = setup();
    const result = adapter.getBestMove({ movetimeMs: 10 });
    const assertion = expect(result).rejects.toThrow(new RegExp(`^${ENGINE_BRIDGE_ERROR_PREFIX}`));
    await vi.advanceTimersByTimeAsync(READY_MS);
    await assertion;
  });

  it('a failed init is not cached: BRIDGE_READY arriving later, then a retry, completes the handshake', async () => {
    const { adapter, sent, answer } = setup();
    const first = adapter.initEngine();
    const firstAssertion = expect(first).rejects.toThrow('did not become ready');
    await vi.advanceTimersByTimeAsync(READY_MS);
    await firstAssertion;

    adapter.handleLine('BRIDGE_READY'); // the slow WebView finally loaded
    const second = adapter.initEngine(); // a NEW attempt, not the cached rejection
    await vi.advanceTimersByTimeAsync(0);
    answer('uci', 'uciok');
    await vi.advanceTimersByTimeAsync(0);
    answer('isready', 'readyok');
    await expect(second).resolves.toBeUndefined();
    expect(sent).toEqual(['uci', 'isready']);
  });

  it('a successful handshake is cached (no second uci)', async () => {
    const { adapter, sent, answerHandshake, answer } = setup();
    answerHandshake();
    const first = adapter.initEngine();
    await vi.advanceTimersByTimeAsync(0);
    answer('uci', 'uciok');
    await vi.advanceTimersByTimeAsync(0);
    answer('isready', 'readyok');
    await first;
    await adapter.initEngine();
    expect(sent).toEqual(['uci', 'isready']);
  });

  it('the READY timer is cancelled once the bridge is ready (no late rejection)', async () => {
    const { adapter, answer } = setup();
    adapter.handleLine('BRIDGE_READY');
    const init = adapter.initEngine();
    await vi.advanceTimersByTimeAsync(0);
    answer('uci', 'uciok');
    await vi.advanceTimersByTimeAsync(0);
    answer('isready', 'readyok');
    await init;
    await vi.advanceTimersByTimeAsync(60000);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the WebView process is lost', () => {
  it('a pending bestmove wait fails at once on BRIDGE_RESTARTED, and the restarted bridge then works', async () => {
    const { adapter, sent, answer } = setup();
    adapter.handleLine('BRIDGE_READY');
    const init = adapter.initEngine();
    await vi.advanceTimersByTimeAsync(0);
    answer('uci', 'uciok');
    await vi.advanceTimersByTimeAsync(0);
    answer('isready', 'readyok');
    await init;

    const move = adapter.getBestMove({ movetimeMs: 100 });
    const moveAssertion = expect(move).rejects.toThrow('engine bridge restarted');
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.at(-1)).toBe('go movetime 100');
    adapter.handleLine(BRIDGE_RESTARTED_LINE); // the supervisor remounted the WebView
    await moveAssertion; // immediately, not after the 20 s bestmove timeout

    // The fresh WebView loads and the next call re-handshakes from scratch.
    sent.length = 0;
    const retry = adapter.getBestMove({ movetimeMs: 100 });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([]); // waiting for the NEW BRIDGE_READY, not talking to a dead engine
    adapter.handleLine('BRIDGE_READY');
    await vi.advanceTimersByTimeAsync(0);
    answer('uci', 'uciok');
    await vi.advanceTimersByTimeAsync(0);
    answer('isready', 'readyok');
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.at(-1)).toBe('go movetime 100');
    adapter.handleLine('bestmove e2e4');
    await expect(retry).resolves.toBe('e2e4');
  });

  it('an init that was waiting for the (old) bridge fails at once on BRIDGE_RESTARTED', async () => {
    const { adapter } = setup();
    const init = adapter.initEngine();
    const assertion = expect(init).rejects.toThrow('engine bridge restarted');
    await vi.advanceTimersByTimeAsync(1000);
    adapter.handleLine(BRIDGE_RESTARTED_LINE);
    await assertion;
  });

  it('after BRIDGE_FAILED the adapter refuses at once, and a re-attached bridge clears the failure', async () => {
    const { adapter, sent } = setup();
    const pending = adapter.initEngine();
    const pendingAssertion = expect(pending).rejects.toThrow('engine bridge failed (render process gone)');
    await vi.advanceTimersByTimeAsync(0);
    adapter.handleLine(`${BRIDGE_FAILED_PREFIX}render process gone`);
    await pendingAssertion;
    await expect(adapter.initEngine()).rejects.toThrow('engine bridge failed (render process gone)');
    expect(sent).toEqual([]);

    adapter.attachBridge(null); // what a screen's Retry does: a full remount re-attaches the ref
    adapter.attachBridge({ postCommand: (command) => void sent.push(command) });
    adapter.handleLine('BRIDGE_READY');
    const init = adapter.initEngine();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual(['uci']);
    adapter.handleLine('uciok');
    await vi.advanceTimersByTimeAsync(0);
    adapter.handleLine('readyok');
    await expect(init).resolves.toBeUndefined();
  });

});

describe('createBridgeSupervisor: remount once, then give up', () => {
  const make = () => {
    const calls: string[] = [];
    const supervisor = createBridgeSupervisor({
      remount: () => void calls.push('remount'),
      emit: (line) => void calls.push(`emit:${line}`),
      log: (message) => void calls.push(`log:${message}`),
    });
    return { calls, supervisor };
  };

  it('the first failure logs, remounts and announces the restart (in that order: remount before emit)', () => {
    const { calls, supervisor } = make();
    supervisor.fail('WebView render process gone (didCrash=true)');
    expect(calls).toEqual([
      'log:[EngineBridge] WebView render process gone (didCrash=true) - remounting the engine WebView (restart 1/1)',
      'remount',
      `emit:${BRIDGE_RESTARTED_LINE}`,
    ]);
    expect(supervisor.restartCount()).toBe(1);
  });

  it('the second failure does not remount again: it logs and reports BRIDGE_FAILED with the reason', () => {
    const { calls, supervisor } = make();
    supervisor.fail('first');
    calls.length = 0;
    supervisor.fail('WebView load error -6: net::ERR_FAILED');
    expect(calls).toEqual([
      'log:[EngineBridge] WebView load error -6: net::ERR_FAILED - restart budget used up, engine unavailable',
      `emit:${BRIDGE_FAILED_PREFIX}WebView load error -6: net::ERR_FAILED`,
    ]);
    expect(supervisor.restartCount()).toBe(1);
  });

  it('the literals the screens and the adapter agree on', () => {
    expect(MAX_BRIDGE_RESTARTS).toBe(1);
    expect(BRIDGE_RESTARTED_LINE).toBe('__EM_BRIDGE_RESTARTED__');
    expect(BRIDGE_FAILED_PREFIX).toBe('__EM_BRIDGE_FAILED__:');
    expect(ENGINE_BRIDGE_ERROR_PREFIX).toBe('StockfishEngineAdapter:');
  });
});

describe('supervisor + adapter together: process gone -> remount -> success; twice -> error', () => {
  it('first loss recovers on the new WebView; a second loss surfaces an error', async () => {
    const adapter = new StockfishEngineAdapter();
    const sent: string[] = [];
    adapter.attachBridge({ postCommand: (command) => void sent.push(command) });
    let remounts = 0;
    const supervisor = createBridgeSupervisor({ remount: () => void (remounts += 1), emit: (line) => adapter.handleLine(line), log: () => {} });

    const first = adapter.initEngine();
    const firstAssertion = expect(first).rejects.toThrow('engine bridge restarted');
    await vi.advanceTimersByTimeAsync(0);
    supervisor.fail('render process gone'); // the WebView died before it ever became ready
    await firstAssertion;
    expect(remounts).toBe(1);

    adapter.handleLine('BRIDGE_READY'); // the remounted WebView loads
    const second = adapter.initEngine();
    await vi.advanceTimersByTimeAsync(0);
    adapter.handleLine('uciok');
    await vi.advanceTimersByTimeAsync(0);
    adapter.handleLine('readyok');
    await expect(second).resolves.toBeUndefined();

    const move = adapter.getBestMove({ movetimeMs: 50 });
    const moveAssertion = expect(move).rejects.toThrow('engine bridge failed (render process gone again)');
    await vi.advanceTimersByTimeAsync(0);
    supervisor.fail('render process gone again'); // died a second time: no more remounts
    await moveAssertion;
    expect(remounts).toBe(1);
    await expect(adapter.initEngine()).rejects.toThrow('engine bridge failed');
  });
});
