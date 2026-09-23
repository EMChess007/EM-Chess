import type { GameStatus, PieceColor } from '../types/chess';

export type PgnResult = '1-0' | '0-1' | '1/2-1/2';

export type GameOutcome = { over: false } | { over: true; result: PgnResult; reason: 'checkmate' | 'stalemate' | 'draw' | 'timeout' };

/**
 * Whether a game just ended and, if so, its PGN-style result ("1-0"/"0-1"/"1/2-1/2") — shared
 * by every game screen so "who won" is computed identically everywhere (including for the
 * game-history payload saved to the backend).
 */
export function getGameOutcome(chessStatus: GameStatus, turn: PieceColor, timeoutWinner: PieceColor | null): GameOutcome {
  if (timeoutWinner) {
    return { over: true, result: timeoutWinner === 'w' ? '1-0' : '0-1', reason: 'timeout' };
  }
  if (chessStatus === 'checkmate') {
    // `turn` is the side TO MOVE in the final position, i.e. the side that got checkmated.
    return { over: true, result: turn === 'w' ? '0-1' : '1-0', reason: 'checkmate' };
  }
  if (chessStatus === 'stalemate' || chessStatus === 'draw') {
    return { over: true, result: '1/2-1/2', reason: chessStatus };
  }
  return { over: false };
}
