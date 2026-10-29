import type { ComponentType } from 'react';
import type { TouchDebugOverlayProps } from './TouchDebugOverlay';

/**
 * Where the DEV-ONLY touch-debug overlay (TouchDebugOverlay.tsx) is handed to the screens. Nothing here imports the overlay's code: it is registered by `src/dev/registerTouchDebug.ts`, which App.tsx
 * `require`s inside `if (__DEV__)` only. In a release bundle `__DEV__` is the literal false, that `require` is dead code and neither the overlay nor its registration is bundled, so
 * `getTouchDebugOverlay()` is null for ever there and the in-game switch never shows. (`bughouseTouchDebug.test.ts` scans that nothing else imports the overlay.)
 */
let registered: ComponentType<TouchDebugOverlayProps> | null = null;

export function registerTouchDebugOverlay(component: ComponentType<TouchDebugOverlayProps>): void {
  registered = component;
}

export function getTouchDebugOverlay(): ComponentType<TouchDebugOverlayProps> | null {
  return registered;
}
