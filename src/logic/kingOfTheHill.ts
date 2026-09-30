import type { ChessEngine } from './ChessEngine';
import type { PieceColor } from '../types/chess';

/** The four center squares — reaching one with your own king is an immediate win in King of the
 * Hill mode, regardless of the rest of the position. */
export const KING_OF_THE_HILL_SQUARES = ['d4', 'd5', 'e4', 'e5'] as const;

/** Whether either king is currently on one of the 4 center squares. Chess.js (and this app's own
 * ChessEngine) has no idea this rule exists, so callers only check this when the game is actually
 * being played in King of the Hill mode — it's a plain independent board check, not part of
 * ChessEngine.getStatus(). */
export function getKingOfTheHillWinner(engine: ChessEngine): PieceColor | null {
  for (const square of KING_OF_THE_HILL_SQUARES) {
    const piece = engine.getPieceAt(square);
    if (piece?.type === 'k') return piece.color;
  }
  return null;
}
