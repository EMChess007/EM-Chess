import { useEffect, useRef } from 'react';
import { annotationsSurvive, type PositionEpoch } from '../logic/annotationLifecycle';

/**
 * Clears a board's arrows and highlights when — and only when — the position changed, i.e. a move was played or the position was
 * replaced. The rule and what a board must pass as `epoch` are documented in logic/annotationLifecycle.ts; every board uses THIS hook so
 * there is exactly one place where annotations get cleared. `clear` is read fresh, so it may close over the board's setters.
 */
export function useClearAnnotationsOnMove(epoch: PositionEpoch, clear: () => void): void {
  const previous = useRef(epoch);
  const latestClear = useRef(clear);
  latestClear.current = clear;
  useEffect(() => {
    if (!annotationsSurvive(previous.current, epoch)) latestClear.current();
    previous.current = epoch;
  }, [epoch]);
}
