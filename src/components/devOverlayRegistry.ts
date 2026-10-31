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

/**
 * The same pattern for the Android end-to-end run's state probe (command #30, `src/dev/E2eStateProbe.tsx`): registered by `src/dev/registerE2e.ts` (index.ts `require`s it inside `if (__DEV__)`),
 * and null in a release build and in a development build that is not the end-to-end build. A board renders it when it is not null (`e2eStateProbe.test.ts` scans that nothing imports the probe).
 */
export interface E2eStateProbeProps {
  /** Names the board: "board-2p", "board-A", "board-B". */
  channel: string;
  /** The facts about the board the driver reads (position, side to move, selection ...). */
  state: Record<string, unknown>;
  /** The board's container, to measure its rectangle on the screen. */
  rectOf?: { current: { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null };
}
let registeredProbe: ComponentType<E2eStateProbeProps> | null = null;

export function registerE2eStateProbe(component: ComponentType<E2eStateProbeProps>): void {
  registeredProbe = component;
}

export function getE2eStateProbe(): ComponentType<E2eStateProbeProps> | null {
  return registeredProbe;
}

/** The end-to-end build's counter of gesture events (a board's responder granted / released / resolved a tap): the driver compares them with what it injected. Null everywhere else. */
export type E2eGestureCounter = (channel: string, event: string, extra?: Record<string, unknown>) => void;
let registeredCounter: E2eGestureCounter | null = null;

export function registerE2eGestureCounter(counter: E2eGestureCounter): void {
  registeredCounter = counter;
}

export function getE2eGestureCounter(): E2eGestureCounter | null {
  return registeredCounter;
}
