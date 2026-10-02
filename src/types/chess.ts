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

export interface Move {
  from: Square;
  to: Square;
  /** 'k' only ever appears in Giveaway (Antichess), where a pawn may promote to a king — see
   * ChessEngineOptions.giveaway. */
  promotion?: 'n' | 'b' | 'r' | 'q' | 'k';
  san: string;
  /** The type of piece captured by this move (regular capture or en passant), if any. */
  captured?: PieceType;
}

export type GameStatus = 'playing' | 'checkmate' | 'stalemate' | 'draw' | 'check';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
