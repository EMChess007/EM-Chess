import { useRef, useState } from 'react';
import { NO_SELECTION, reduceSelection, type BoardPosition, type BoardSelection, type SelectionCommit, type SelectionInput } from '../logic/bughouseSelection';
import type { BoardId } from '../logic/bughouse/types';

/**
 * Bughouse W3b: the selection reducer of ONE board (logic/bughouseSelection.ts) as a hook. The dual-board screen calls it once per board; an instance is given its board and nothing else, so a
 * tap handler built from board A's instance cannot read or write board B's selection (HP12, rule 2).
 *
 * The current selection also lives in a ref that is written at once: two taps on the same board that land before React has re-rendered (a quick second tap, a tap resolved after an
 * asynchronous measurement on a phone) must each see the result of the one before. Rendering reads the state.
 */
export function useBoardSelection(board: BoardId): { selection: BoardSelection; apply: (input: SelectionInput, position: BoardPosition) => SelectionCommit | null } {
  const ref = useRef<BoardSelection>(NO_SELECTION);
  const [selection, setSelection] = useState<BoardSelection>(NO_SELECTION);
  const apply = (input: SelectionInput, position: BoardPosition): SelectionCommit | null => {
    const step = reduceSelection(board, ref.current, input, position);
    ref.current = step.state;
    setSelection(step.state);
    return step.commit;
  };
  return { selection, apply };
}
