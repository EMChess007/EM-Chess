import { useCallback, useRef } from 'react';

/**
 * A function with ONE identity for the life of the component that always runs the LATEST `fn` (command #33, the lag on the phone). A memoized child that is handed a callback which closes over
 * the screen's state would re-render every time the screen does (a new closure each render); handed this, it re-renders only when its DATA changes, and the call still sees the current state.
 * The ref is written during render, the same way the board hooks keep their options (`optionsRef.current = options`): the handlers only ever run from events, after the commit.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}
