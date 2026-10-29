import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthCallOptions } from '../api/client';

/**
 * What the Login and Register screens share about a sign-in that may have to wait for a sleeping server (command #27b): the AbortController behind Cancel, and `waking`, which turns
 * true when the client reports (after AUTH_WAKING_NOTICE_MS, src/api/client.ts) that the request is still waiting. Leaving the screen cancels the request too, so nothing
 * keeps running behind a screen that is gone.
 */
export function useSignInRequest() {
  const [waking, setWaking] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const start = useCallback(async <T>(run: (call: AuthCallOptions) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setWaking(false);
    try {
      return await run({ signal: controller.signal, onWaking: () => setWaking(true) });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setWaking(false);
    }
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  return { waking, start, cancel };
}
