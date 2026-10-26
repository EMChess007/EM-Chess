/**
 * Setup for the `dom` test project (vitest.config.mts): screens and components rendered in jsdom through react-native-web.
 *
 * What is replaced and why. Everything native-only or I/O-bound is stubbed so a render is deterministic and touches nothing outside the test:
 *   - `expo-haptics`, the move sounds and the haptics module: no device, no audio context. The stubs RECORD their calls, so a test can ask whether a move buzzed.
 *   - `@react-native-async-storage/async-storage`: an in-memory map (the colour scheme, the theme and the sound settings read it).
 *   - `react-native-safe-area-context`: zero insets (there is no notch in jsdom).
 * Everything else - the real board, seat strip, result card, sheets and screens, the real engine - is the code the app ships.
 */
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * THE DEFAULT WINDOW IS A PHONE (412 x 915). react-native-web's Dimensions reads `document.documentElement.clientWidth / clientHeight`, which jsdom reports as 0 - so, without
 * this, every rendered test that does not resize the window runs in a 0 x 0 one, where every size- and layout-dependent branch of a screen takes its degenerate path. Each test
 * starts at this size (a test that needs another calls `setWindowSize` in domKit.tsx).
 */
export const DOM_DEFAULT_WINDOW = { width: 412, height: 915 } as const;
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: DOM_DEFAULT_WINDOW.width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: DOM_DEFAULT_WINDOW.height });
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: DOM_DEFAULT_WINDOW.width });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: DOM_DEFAULT_WINDOW.height });
  window.dispatchEvent(new Event('resize')); // Dimensions keeps the size it read last: tell it
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(async () => {}),
  notificationAsync: vi.fn(async () => {}),
  selectionAsync: vi.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => void store.set(key, value),
    removeItem: async (key: string) => void store.delete(key),
    clear: async () => store.clear(),
  },
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));

// react-native-svg ships native-only sources (Flow `import typeof`, codegen components) that no node test can load. The shapes are drawn by the BoatIcon and the annotation overlay;
// here each one becomes a plain element that keeps its name (data-svg), so a test can still see THAT a boat or an arrow was drawn - what it looks like is the browser pass's job.
vi.mock('react-native-svg', async () => {
  const { createElement } = await import('react');
  const shape = (name: string) => {
    const Shape = ({ children }: { children?: unknown }) => createElement('span', { 'data-svg': name }, children as never);
    return Shape;
  };
  return {
    default: shape('Svg'),
    Svg: shape('Svg'),
    Path: shape('Path'),
    Line: shape('Line'),
    Polygon: shape('Polygon'),
    Rect: shape('Rect'),
    Circle: shape('Circle'),
    G: shape('G'),
  };
});

// The move sounds need an audio context and `require()` of .wav files; a screen only calls `playMoveSound(...)`.
vi.mock('../logic/moveSounds', () => ({ playMoveSound: vi.fn() }));

/**
 * THE ONE SEAM IN THE BOARD. A real tap reaches the board through a PanResponder over measured pixel coordinates (components/useBoardGestures.ts); jsdom has no layout, so
 * there is nothing to measure. The gesture hook is replaced by one that hands the test the board's CURRENT options (`onTap`, `onArrow`, `onHighlight`, the grid size), and a
 * test taps a square with `tapSquare` (src/test/domKit.tsx), which turns the square into the display cell a finger would have hit. Everything from the tap on - selection,
 * legal-move dots, the move, promotion, premoves, the screen, the engine - is the real code. The pixel -> cell step is shared by every board in the app (it is
 * tested in boardGestures.test.ts and checked in the browser).
 */
vi.mock('../components/useBoardGestures', () => ({
  LONG_PRESS_MS: 400,
  MOVE_THRESHOLD_PX: 8,
  useBoardGestures: (options: unknown) => {
    (globalThis as unknown as { __boardGestures: unknown }).__boardGestures = options;
    // A screen with several boards (Bughouse) names each: `tapBoardSquare` finds the one it means by that key.
    const key = (options as { seamKey?: string }).seamKey;
    if (key) {
      const registry = ((globalThis as unknown as { __boardGesturesByKey?: Record<string, unknown> }).__boardGesturesByKey ??= {});
      registry[key] = options;
    }
    return { containerRef: { current: null }, onLayout: () => {}, panHandlers: {}, liveArrow: null, clearLiveArrow: () => {} };
  },
}));
