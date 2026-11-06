import { useEffect } from 'react';
import { getE2eNotice } from '../components/devOverlayRegistry';

/**
 * Tells the Android end-to-end driver when a one-off notice appears and goes (command #35b, `registerE2eNotice` in src/dev/registerE2e.ts). It is a no-op everywhere but the end-to-end
 * development build (`getE2eNotice()` is null in a release build and in an ordinary development build). It reports only CHANGES of `shown`, and the first render reports "not shown" once,
 * so the driver's last state of a notice is always the screen's.
 */
export function useE2eNoticeReport(name: string, shown: boolean): void {
  useEffect(() => {
    getE2eNotice()?.(name, shown);
  }, [name, shown]);
}
