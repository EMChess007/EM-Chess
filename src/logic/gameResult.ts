import type { GameStatus, PieceColor } from '../types/chess';

export type PgnResult = '1-0' | '0-1' | '1/2-1/2';

export type GameOutcome =
  | { over: false }
  | {
      over: true;
      result: PgnResult;
      reason:
        | 'checkmate'
        | 'stalemate'
        | 'draw'
        | 'timeout'
        | 'resignation'
        | 'agreement'
        | 'kingOfTheHill'
        | 'threeCheck'
        | 'fogOfWar'
        | 'giveaway'
        | 'atomic'
        | 'duckChess'
        | 'spellChess'
        | 'horde';
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
  threeCheckWinner: PieceColor | null = null,
  fogOfWarWinner: PieceColor | null = null,
  giveawayWinner: PieceColor | null = null,
  atomicWinner: PieceColor | null = null,
  duckChessWinner: PieceColor | null = null,
  spellChessWinner: PieceColor | null = null,
  hordeWinner: PieceColor | null = null
): GameOutcome {
  // Checked first of all — Fog of War has no checkmate/stalemate/draw concept whatsoever (see
  // ChessBoard's own fogOfWar doc comment), so king capture is the ONLY way a Fog of War game
  // ever ends; every other branch below is unreachable for it, same as kingOfTheHillWinner/
  // threeCheckWinner for their own variants (all mutually exclusive — one game is only ever one
  // of these at a time).
  // Giveaway (Antichess) sits in this same top tier: it has no checkmate/stalemate/draw concept
  // either (running out of legal moves is a WIN for whoever is stuck — see giveaway.ts), and the
  // variants are mutually exclusive, so at most one of this and fogOfWarWinner is ever set.
  // Atomic sits in this tier too, for its king-exploded win only: a king blown up ends the game on the
  // spot, whatever else the position says. Ordinary Atomic checkmate/stalemate/draws come in through
  // `chessStatus` (ChessEngine.getStatus answers from atomic.ts there) under the usual reasons.
  // Duck Chess likewise: it has no check/checkmate, so capturing the enemy king is its only decisive result
  // (a fully blockaded side to move is reported as a draw through `chessStatus` by the screens).
  // Spell Chess is the one exception in this tier that ALSO has normal checkmate/stalemate/draw (see
  // spellChess.ts's own doc comment) — but a king capture (only ever possible via a Jump-augmented move;
  // chess.js's own legality never allows one) still has to be checked before `chessStatus`, because the
  // position it leaves behind is missing a king and chessStatus's own checkmate/stalemate detection was
  // never run against it.
  // Horde's one extra result: Black wins the instant White has no pieces left (see horde.ts). It sits in this top tier
  // — ahead of chessStatus, resignation and the clock — because the position it leaves behind (White to move, with
  // nothing on the board) is reported by chess.js as STALEMATE, which would otherwise be read as a draw. White's own win
  // (checkmating Black's king) and every stalemate/50-move draw come in through chessStatus under the usual reasons.
  if (hordeWinner) {
    return { over: true, result: hordeWinner === 'w' ? '1-0' : '0-1', reason: 'horde' };
  }
  if (spellChessWinner) {
    return { over: true, result: spellChessWinner === 'w' ? '1-0' : '0-1', reason: 'spellChess' };
  }
  if (duckChessWinner) {
    return { over: true, result: duckChessWinner === 'w' ? '1-0' : '0-1', reason: 'duckChess' };
  }
  if (atomicWinner) {
    return { over: true, result: atomicWinner === 'w' ? '1-0' : '0-1', reason: 'atomic' };
  }
  if (giveawayWinner) {
    return { over: true, result: giveawayWinner === 'w' ? '1-0' : '0-1', reason: 'giveaway' };
  }
  if (fogOfWarWinner) {
    return { over: true, result: fogOfWarWinner === 'w' ? '1-0' : '0-1', reason: 'fogOfWar' };
  }
  // Checked next — reaching the center (or delivering the third check) wins outright regardless
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
