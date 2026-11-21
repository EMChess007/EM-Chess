import { useCallback, useRef, useState } from 'react';
import { ENGINE_BRIDGE_ERROR_PREFIX } from '../engine/bridgeSupervisor';
import { logDiagnostic } from './diagnosticLog';

export interface EngineRetry {
  /** The error shown to the player (null = none). */
  engineError: string | null;
  /** Put on the <StockfishBridge key=...>: bumping it mounts a fresh bridge. */
  bridgeKey: number;
  /** Put in the dependency list of the effect that talks to the engine: bumping it re-runs it. */
  retryNonce: number;
  /**
   * Report a failed engine call. A bridge failure gets ONE automatic retry on a fresh bridge (returns 'retrying');
   * anything else, or a second failure, is shown to the player with a Retry button (returns 'shown').
   */
  fail: (err: unknown, label: string) => 'retrying' | 'shown';
  /** The Retry button: a fresh bridge, a full new retry budget, the engine effect runs again. */
  retry: () => void;
  clearError: () => void;
  /** The engine answered: the automatic-retry budget is full again. */
  succeeded: () => void;
}

/**
 * The engine watchdog every screen that talks to the engine shares (bot game, engine vs engine, analysis, hints):
 * the bridge times out / remounts instead of hanging (bridgeSupervisor.ts), and the screen shows the error with a Retry.
 */
export function useEngineRetry(autoRetry: boolean = true): EngineRetry {
  const [engineError, setEngineError] = useState<string | null>(null);
  const [bridgeKey, setBridgeKey] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const attemptRef = useRef(0);

  const fail = useCallback(
    (err: unknown, label: string): 'retrying' | 'shown' => {
      const message = err instanceof Error ? err.message : String(err);
      if (autoRetry && message.startsWith(ENGINE_BRIDGE_ERROR_PREFIX) && attemptRef.current < 1) {
        attemptRef.current += 1;
        logDiagnostic(`[Engine] ${label} bridge failure (${message}) - retrying once on a fresh bridge`);
        setBridgeKey((k) => k + 1);
        setRetryNonce((n) => n + 1);
        return 'retrying';
      }
      logDiagnostic(`[Engine] ${label} engine error shown to the player: ${message}`);
      setEngineError(message);
      return 'shown';
    },
    [autoRetry]
  );

  const retry = useCallback(() => {
    attemptRef.current = 0;
    setEngineError(null);
    setBridgeKey((k) => k + 1);
    setRetryNonce((n) => n + 1);
  }, []);

  const clearError = useCallback(() => setEngineError(null), []);

  const succeeded = useCallback(() => {
    attemptRef.current = 0;
  }, []);

  return { engineError, bridgeKey, retryNonce, fail, retry, clearError, succeeded };
}
