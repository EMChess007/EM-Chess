import { useCallback, useMemo, useState } from 'react';
import type { PositionEpoch } from '../logic/annotationLifecycle';
import { addSquareArrow, NO_MARKS, toggleSquareHighlight, type SquareMarks } from '../logic/boardArrows';
import { useClearAnnotationsOnMove } from './useClearAnnotationsOnMove';

export interface BoardMarks {
  marks: SquareMarks;
  /** An arrow drawn by a finger, from one square to another. */
  drawArrow: (from: string | null, to: string | null) => void;
  /** A square marked (or unmarked) by a finger. */
  toggleHighlight: (square: string | null) => void;
}

/**
 * The finger-drawn marks of ONE board, owned by the SCREEN (not by the board component, which is remounted when the Bughouse screen swaps the large board and the thumbnail) and cleared when
 * a move is played on THAT board and at no other time: `epoch` is the board's own position (its FEN - a move, a drop or a replaced position changes it; a pocket change caused by the other
 * board, a clock, a turn passing do not). The rule is logic/annotationLifecycle.ts; this hook only keeps the list.
 */
export function useBoardMarks(epoch: PositionEpoch): BoardMarks {
  const [marks, setMarks] = useState<SquareMarks>(NO_MARKS);
  useClearAnnotationsOnMove(epoch, () => setMarks(NO_MARKS));
  const drawArrow = useCallback((from: string | null, to: string | null) => setMarks((m) => addSquareArrow(m, from, to)), []);
  const toggleHighlight = useCallback((square: string | null) => setMarks((m) => toggleSquareHighlight(m, square)), []);
  // (one object for as long as nothing changed: a board that receives it is memoized, command #33)
  return useMemo(() => ({ marks, drawArrow, toggleHighlight }), [marks, drawArrow, toggleHighlight]);
}
