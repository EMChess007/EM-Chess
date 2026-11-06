import { createContext, useContext, useSyncExternalStore } from 'react';

/**
 * THE CLOCK INSTANT, OUTSIDE REACT STATE (command #33, the lag on the phone).
 *
 * A Bughouse screen used to keep "the instant the clocks are drawn at" in its own state and tick it every 200 ms, so every tick re-rendered the whole screen: both boards, 64 squares and 32
 * SVG pieces each, the pockets, the thumbnail - five times a second, on a phone's JavaScript thread. The instant now lives in a tiny store; only the components that DRAW a time (`useNowMs`:
 * the four clock texts and the thumbnail's lines) subscribe to it, so a tick re-renders a few `Text`s and nothing else. The screen still owns what the instant MEANS (Local: its elapsed
 * time; online: the server's estimate), it only no longer re-renders to publish it.
 */
export interface NowSource {
  get: () => number;
  subscribe: (listener: () => void) => () => void;
}

export interface NowStore extends NowSource {
  set: (value: number) => void;
}

/** A store holding one number; `set` notifies the subscribers only when the value changed. */
export function createNowStore(initial = 0): NowStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (next === value) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

const NowContext = createContext<NowSource | null>(null);
export const NowProvider = NowContext.Provider;

const NEVER = () => () => {};

/** The current instant: the provider's store when there is one (a tick re-renders only this component), else `fallback` (a component drawn alone, in a test). */
export function useNowMs(fallback = 0): number {
  const source = useContext(NowContext);
  return useSyncExternalStore(source ? source.subscribe : NEVER, source ? source.get : () => fallback, source ? source.get : () => fallback);
}
