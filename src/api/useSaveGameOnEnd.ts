import { useEffect, useRef } from 'react';
import { api, type GamePayload } from './client';
import { saveLocalGame } from '../logic/localGameHistory';

/**
 * Fires exactly once per game instance (guarded by `resetKey`, e.g. a screen's own "new game"
 * counter) as soon as `payload` becomes non-null, i.e. once the game has actually ended. Logged-in
 * players get POST /games; a guest/offline player (no `authToken`) gets the same game saved to
 * on-device storage instead (see logic/localGameHistory), so game history/PGN export work without
 * an account too. Either way, any failure (backend down, storage error) is swallowed after a
 * console warning so it can never interrupt the player.
 */
export function useSaveGameOnEnd(authToken: string | null, resetKey: number | string, payload: GamePayload | null) {
  const savedForRef = useRef<number | string | null>(null);

  useEffect(() => {
    if (!payload) return;
    if (savedForRef.current === resetKey) return;
    savedForRef.current = resetKey;

    if (authToken) {
      api.createGame(authToken, payload).catch((err) => {
        console.warn('[SaveGame] Failed to save game:', err instanceof Error ? err.message : err);
      });
    } else {
      saveLocalGame(payload).catch((err) => {
        console.warn('[SaveGame] Failed to save game locally:', err instanceof Error ? err.message : err);
      });
    }
  }, [authToken, resetKey, payload]);
}
