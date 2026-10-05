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

/** Spell Chess only — a spell cast as the first half of a turn, before the move; see spellChess.ts
 * and Move.spell below. Defined here (like ExplodedPiece above) rather than in spellChess.ts so that
 * module can import it alongside Move/Piece/PieceColor without types/chess.ts depending on logic/. */
export type SpellCast = { type: 'freeze'; center: Square; squares: Square[] } | { type: 'jump'; square: Square };

export interface Move {
  from: Square;
  to: Square;
  /** 'k' only ever appears in Giveaway (Antichess), where a pawn may promote to a king — see
   * ChessEngineOptions.giveaway. */
  promotion?: 'n' | 'b' | 'r' | 'q' | 'k';
  san: string;
  /** The type of piece captured by this move (regular capture or en passant), if any. */
  captured?: PieceType;
  /** Atomic only — every piece the move's explosion removed: the capturing piece, the captured
   * piece and every non-pawn neighbour of the landing square, each on the square it stood on (the
   * captured pawn of an en passant capture is on its own square, not the landing square). Absent
   * for every other mode and for non-capturing moves. */
  exploded?: ExplodedPiece[];
  /** Duck Chess only — the square the duck was placed on as the second half of this turn (see
   * duckChess.ts); shown after the move as "e4 @g6" and carried per ply in GameHistoryEntry.duckSquare.
   * Absent for every other mode, and for the move that captures a king (the game ends with no placement). */
  duck?: string;
  /** Spell Chess only — the spell (if any) cast immediately before this move, see spellChess.ts's
   * SpellCast and spellMoveNotation. Absent for every other mode, and for a turn nothing was cast on. */
  spell?: SpellCast;
}

export type GameStatus = 'playing' | 'checkmate' | 'stalemate' | 'draw' | 'check';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
