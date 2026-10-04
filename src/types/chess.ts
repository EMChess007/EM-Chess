export type PieceColor = 'w' | 'b';

// A user's color preference before a bot game starts — 'random' is resolved to an actual
// PieceColor once the game begins (see BotGameScreen).
export type ColorChoice = PieceColor | 'random';

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export interface Piece {
  type: PieceType;
  color: PieceColor;
}

export type Square = string;

export interface BoardSquare {
  square: Square;
  piece: Piece | null;
}

/** A piece an Atomic explosion removed from the board, and where it stood — see Move.exploded. */
export interface ExplodedPiece {
  square: Square;
  piece: Piece;
}

export interface Move {
  from: Square;
  to: Square;
  /** 'k' only ever appears in Giveaway (Antichess), where a pawn may promote to a king — see
   * ChessEngineOptions.giveaway. */
  promotion?: 'n' | 'b' | 'r' | 'q' | 'k';
  san: string;
  /** The type of piece captured by this move (regular capture or en passant), if any. */
  captured?: PieceType;
  /** Atomic only — every piece the move's explosion removed: the capturing piece, the captured piece
   * and every non-pawn neighbour of the landing square, each on the square it stood on (the captured
   * pawn of an en passant capture is on its own square, not the landing square). Absent for every
   * other mode and for non-capturing moves. */
  exploded?: ExplodedPiece[];
}

export type GameStatus = 'playing' | 'checkmate' | 'stalemate' | 'draw' | 'check';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
