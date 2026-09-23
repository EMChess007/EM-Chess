import { useEffect, useRef } from 'react';
import { api, type GamePayload } from './client';

/**
 * Fires POST /games exactly once per game instance (guarded by `resetKey`, e.g. a screen's own
 * "new game" counter) as soon as `payload` becomes non-null, i.e. once the game has actually
 * ended. A no-op while `authToken` is null — guest play is never touched — and any request
 * failure (backend down, network hiccup) is swallowed after a console warning so it can never
 * interrupt the player.
 */
export function useSaveGameOnEnd(authToken: string | null, resetKey: number | string, payload: GamePayload | null) {
  const savedForRef = useRef<number | string | null>(null);

  useEffect(() => {
    if (!authToken || !payload) return;
    if (savedForRef.current === resetKey) return;
    savedForRef.current = resetKey;

    api.createGame(authToken, payload).catch((err) => {
      console.warn('[SaveGame] Failed to save game:', err instanceof Error ? err.message : err);
    });
  }, [authToken, resetKey, payload]);
}
