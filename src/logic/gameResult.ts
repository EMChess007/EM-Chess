import type { GameStatus, PieceColor } from '../types/chess';

export type PgnResult = '1-0' | '0-1' | '1/2-1/2';

export type GameOutcome =
  | { over: false }
  | {
      over: true;
      result: PgnResult;
      reason: 'checkmate' | 'stalemate' | 'draw' | 'timeout' | 'resignation' | 'agreement' | 'kingOfTheHill' | 'threeCheck';
    };

/**
 * Whether a game just ended and, if so, its PGN-style result ("1-0"/"0-1"/"1/2-1/2") — shared
 * by every game screen so "who won" is computed identically everywhere (including for the
 * game-history payload saved to the backend).
 */
export function getGameOutcome(
  chessStatus: GameStatus,
  turn: PieceColor,
  timeoutWinner: PieceColor | null,
  resignedBy: PieceColor | null = null,
  drawnByAgreement = false,
  kingOfTheHillWinner: PieceColor | null = null,
  threeCheckWinner: PieceColor | null = null
): GameOutcome {
  // Checked first — reaching the center (or delivering the third check) wins outright regardless
  // of the rest of the position (check/material/whose turn it technically is don't matter), and
  // chess.js has no idea either rule exists, so neither can ever surface via `chessStatus` on its
  // own. The two are mutually exclusive variants, so both being set at once never happens.
  if (kingOfTheHillWinner) {
    return { over: true, result: kingOfTheHillWinner === 'w' ? '1-0' : '0-1', reason: 'kingOfTheHill' };
  }
  if (threeCheckWinner) {
    return { over: true, result: threeCheckWinner === 'w' ? '1-0' : '0-1', reason: 'threeCheck' };
  }
  if (drawnByAgreement) {
    return { over: true, result: '1/2-1/2', reason: 'agreement' };
  }
  if (resignedBy) {
    return { over: true, result: resignedBy === 'w' ? '0-1' : '1-0', reason: 'resignation' };
  }
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
