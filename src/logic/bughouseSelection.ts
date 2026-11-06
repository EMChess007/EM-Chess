/**
 * Bughouse W3b (BUGHOUSE_SPEC.md HP12, rule 2): the half-made action of ONE board - the picked-up piece, the picked pocket piece, a promotion waiting for its choice - as a pure reducer. The
 * dual-board screen keeps one instance per board and routes a board's taps to its own instance only, so a tap, a commit or a refusal on board A cannot read or write the selection of board B
 * (the single selection of the W3a screen could not allow that: a tap on the other board replaced it).
 *
 * Every half-made action remembers the position (FEN) of ITS board it was made in and is dropped when that board changes - never when "the match" changes: with a human or a bot moving on the
 * other board a commit lands every few hundred milliseconds, and a selection that any commit cleared could never be followed by its second tap (CHECKLIST 10).
 *
 * THE BOARD IS A REQUIRED ARGUMENT of every function here and is stamped on every commit; the reducer never looks at another board because it is never given one.
 */
import type { ReservePieceType } from './crazyhouse';
import type { PromotionPiece } from './bughouse';
import type { BoardId } from './bughouse/types';

export interface BoardSelection {
  /** The square of the piece picked up to move, in the position `fen`. */
  readonly selected: { readonly square: string; readonly fen: string } | null;
  /** The pocket piece picked up to drop. */
  readonly picked: { readonly piece: ReservePieceType; readonly fen: string } | null;
  /** A move that needs a promotion piece. */
  readonly promotion: { readonly from: string; readonly to: string; readonly choices: readonly PromotionPiece[]; readonly fen: string } | null;
}

export const NO_SELECTION: BoardSelection = { selected: null, picked: null, promotion: null };

/** What the reducer needs to know about ITS board right now. */
export interface BoardPosition {
  readonly fen: string;
  /** A human may act on this board now: the match is on and the side to move is a human seat (the turn lock). */
  readonly active: boolean;
  /** The legal moves of the side to move that start on `square`. */
  movesFrom(square: string): readonly { to: string; promotion?: PromotionPiece }[];
  /** The squares `piece` may be dropped on by the side to move. */
  dropSquares(piece: ReservePieceType): readonly string[];
}

export type SelectionInput =
  | { kind: 'tapSquare'; square: string }
  | { kind: 'pickPocket'; piece: ReservePieceType }
  | { kind: 'choosePromotion'; piece: PromotionPiece }
  | { kind: 'cancelPromotion' };

/** The action a completed selection asks the engine for. */
export type SelectionCommit =
  | { board: BoardId; kind: 'move'; from: string; to: string; promotion?: PromotionPiece }
  | { board: BoardId; kind: 'drop'; piece: ReservePieceType; square: string };

export interface SelectionStep {
  state: BoardSelection;
  commit: SelectionCommit | null;
}

const PROMOTION_ORDER: readonly PromotionPiece[] = ['q', 'r', 'b', 'n'];

/** The selection with whatever is no longer true of `board`'s position dropped: a half-made action is kept only while its board has not changed and a human may still act on it. */
export function liveSelection(state: BoardSelection, position: BoardPosition): BoardSelection {
  if (!position.active) return NO_SELECTION;
  const selected = state.selected !== null && state.selected.fen === position.fen ? state.selected : null;
  const picked = state.picked !== null && state.picked.fen === position.fen ? state.picked : null;
  const promotion = state.promotion !== null && state.promotion.fen === position.fen ? state.promotion : null;
  if (selected === state.selected && picked === state.picked && promotion === state.promotion) return state;
  return { selected, picked, promotion };
}

/** One input of one board: the board's new selection and, when the input completes an action, the commit to send to the engine. */
export function reduceSelection(board: BoardId, previous: BoardSelection, input: SelectionInput, position: BoardPosition): SelectionStep {
  const state = liveSelection(previous, position);
  if (!position.active) return { state, commit: null };

  if (input.kind === 'cancelPromotion') return { state: { ...state, promotion: null }, commit: null };

  if (input.kind === 'choosePromotion') {
    const pending = state.promotion;
    if (pending === null) return { state, commit: null };
    return { state: NO_SELECTION, commit: { board, kind: 'move', from: pending.from, to: pending.to, promotion: input.piece } };
  }

  if (input.kind === 'pickPocket') {
    if (position.dropSquares(input.piece).length === 0) return { state, commit: null }; // a chip with no legal square cannot be picked
    const same = state.picked !== null && state.picked.piece === input.piece;
    return { state: { selected: null, picked: same ? null : { piece: input.piece, fen: position.fen }, promotion: null }, commit: null };
  }

  // a tap on a square (a promotion still waiting for its choice is given up by it)
  const square = input.square;
  let current: BoardSelection = { ...state, promotion: null };
  if (current.picked !== null) {
    if (position.dropSquares(current.picked.piece).includes(square)) return { state: NO_SELECTION, commit: { board, kind: 'drop', piece: current.picked.piece, square } };
    current = { ...current, picked: null };
  }
  if (current.selected !== null) {
    const matching = position.movesFrom(current.selected.square).filter((m) => m.to === square);
    if (matching.length > 0) {
      if (matching.some((m) => m.promotion)) {
        const choices = PROMOTION_ORDER.filter((p) => matching.some((m) => m.promotion === p));
        return { state: { ...current, promotion: { from: current.selected.square, to: square, choices, fen: position.fen } }, commit: null };
      }
      return { state: NO_SELECTION, commit: { board, kind: 'move', from: current.selected.square, to: square } };
    }
  }
  const own = position.movesFrom(square).length > 0;
  return { state: { ...current, selected: own ? { square, fen: position.fen } : null }, commit: null };
}
