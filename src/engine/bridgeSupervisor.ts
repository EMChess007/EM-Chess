// Pure (no React Native import) so it is unit-testable and shared by the native and web bridges.
//
// The engine runs inside a hidden WebView/iframe. If that renderer dies (Android "render process gone",
// iOS "content process terminated") or fails to load, nothing ever answers again. The bridge component
// reports such a failure to its supervisor, which remounts the WebView ONCE and tells the adapter through
// two synthetic lines on the normal output channel (the HTML itself never emits them):
//   BRIDGE_RESTARTED_LINE  - a fresh WebView is coming: forget the handshake, fail whatever was waiting
//   BRIDGE_FAILED_PREFIX + reason - second failure: give up, surface an error (a screen "Retry" remounts)

export const BRIDGE_RESTARTED_LINE = '__EM_BRIDGE_RESTARTED__';
export const BRIDGE_FAILED_PREFIX = '__EM_BRIDGE_FAILED__:';
export const MAX_BRIDGE_RESTARTS = 1;
/** Every error the adapter raises about the engine / its bridge starts with this (screens retry on it once). */
export const ENGINE_BRIDGE_ERROR_PREFIX = 'StockfishEngineAdapter:';

export interface BridgeSupervisorDeps {
  /** Mounts a fresh WebView/iframe (e.g. bumps its React key). */
  remount: () => void;
  /** Sends a synthetic line to the adapter (the bridge's own onLine). */
  emit: (line: string) => void;
  /** Diagnostics log (logDiagnostic). */
  log: (message: string) => void;
}

export interface BridgeSupervisor {
  /** Report a dead / failed bridge. Restarts once, then reports failure. */
  fail: (reason: string) => void;
  restartCount: () => number;
}

export function createBridgeSupervisor(deps: BridgeSupervisorDeps): BridgeSupervisor {
  let restarts = 0;
  return {
    fail(reason: string) {
      if (restarts < MAX_BRIDGE_RESTARTS) {
        restarts += 1;
        deps.log(`[EngineBridge] ${reason} - remounting the engine WebView (restart ${restarts}/${MAX_BRIDGE_RESTARTS})`);
        deps.remount();
        deps.emit(BRIDGE_RESTARTED_LINE);
        return;
      }
      deps.log(`[EngineBridge] ${reason} - restart budget used up, engine unavailable`);
      deps.emit(`${BRIDGE_FAILED_PREFIX}${reason}`);
    },
    restartCount: () => restarts,
  };
}
