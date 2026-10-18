import { useCallback, useEffect, useRef, useState } from 'react';
import { CAPTURE_NUDGE_MS } from './giveawayHints';

/**
 * The "tap message" of the Giveaway capture hint: `nudge()` (called when the player taps a piece that cannot move because a capture is
 * mandatory) makes `nudged` true for CAPTURE_NUDGE_MS, during which MandatoryCaptureBanner shows the longer explanation instead of the
 * short status. Repeated taps restart the timer; the timer is cleared on unmount.
 */
export function useCaptureNudge(): { nudged: boolean; nudge: () => void } {
  const [nudged, setNudged] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudge = useCallback(() => {
    setNudged(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNudged(false), CAPTURE_NUDGE_MS);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  return { nudged, nudge };
}
