import type { PieceColor, PieceType } from '../types/chess';
import { PIECE_VALUES } from './analysis';

export interface CapturedMaterial {
  /** Types of the opponent's (black) pieces white has captured, in play order. */
  whiteCaptured: PieceType[];
  /** Types of the opponent's (white) pieces black has captured, in play order. */
  blackCaptured: PieceType[];
}

/**
 * Builds both sides' captured-piece lists from a game's moves so far. Each entry's `captured`
 * (see ChessEngine.move()) already names the piece *type* taken; `moverColor` says who took it —
 * the captured piece always belongs to the other color.
 */
export function computeCapturedMaterial(moves: { captured?: PieceType; moverColor: PieceColor }[]): CapturedMaterial {
  const whiteCaptured: PieceType[] = [];
  const blackCaptured: PieceType[] = [];
  for (const { captured, moverColor } of moves) {
    if (!captured) continue;
    (moverColor === 'w' ? whiteCaptured : blackCaptured).push(captured);
  }
  return { whiteCaptured, blackCaptured };
}

/** Total point value of a list of captured pieces, using standard values (pawn=1, knight=3,
 * bishop=3, rook=5, queen=9; a king can never be captured so it never appears here anyway). */
export function materialValue(pieces: PieceType[]): number {
  return pieces.reduce((sum, type) => sum + PIECE_VALUES[type], 0);
}
