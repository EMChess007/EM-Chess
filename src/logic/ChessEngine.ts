import { Chess, type Square as ChessJsSquare } from 'chess.js';
import type { BoardSquare, GameStatus, Move, Piece, PieceColor } from '../types/chess';
import { START_FEN } from '../types/chess';
import { collapseFenRank, expandFenRank, getChess960BackRankFiles } from './chess960';

const FILES = 'abcdefgh';

export interface ChessEngineOptions {
  /**
   * When true, castling is resolved using Chess960 (Fischer Random) rules instead of
   * delegating to chess.js's built-in castling logic, which assumes the classical
   * e1/e8 king and a1/h1/a8/h8 rook starting squares and gets castling wrong (or misses
   * it entirely) for most Chess960 starting positions.
   */
  chess960?: boolean;
  /**
   * The FEN the game actually started from. Required in Chess960 mode to know which
   * files the king and rooks originally stood on (this doesn't change during the game,
   * unlike `fen`, which reflects the current position).
   */
  initialFen?: string;
}

export class ChessEngine {
  private chess: Chess;
  private chess960: boolean;
  private files: { kingFile: number; queenRookFile: number; kingRookFile: number };

  constructor(fen?: string, options?: ChessEngineOptions) {
    this.chess = fen ? new Chess(fen) : new Chess();
    this.chess960 = options?.chess960 ?? false;
    this.files = getChess960BackRankFiles(options?.initialFen ?? fen ?? START_FEN);
  }

  getBoard(): BoardSquare[][] {
    return this.chess.board().map((row, rowIndex) =>
      row.map((cell, colIndex) => ({
        square: `${String.fromCharCode(97 + colIndex)}${8 - rowIndex}`,
        piece: cell ? ({ type: cell.type, color: cell.color } as Piece) : null,
      }))
    );
  }

  getTurn(): 'w' | 'b' {
    return this.chess.turn();
  }

  getLegalMoves(square: string): string[] {
    const verboseMoves = this.chess.moves({ square: square as ChessJsSquare, verbose: true });

    if (!this.chess960) {
      return verboseMoves.map((move) => move.to);
    }

    // chess.js's own castling moves assume classical rook/king squares and are unreliable
    // here, so we drop them and compute Chess960-legal castling targets ourselves.
    const nonCastling = verboseMoves.filter((move) => !move.flags.includes('k') && !move.flags.includes('q'));
    const castlingTargets = this.getChess960CastlingTargetsFrom(square);
    return [...nonCastling.map((move) => move.to), ...castlingTargets];
  }

  move(from: string, to: string, promotion?: 'n' | 'b' | 'r' | 'q'): Move | null {
    if (this.chess960) {
      const side = this.matchChess960CastleAttempt(from, to);
      if (side) {
        return this.performChess960Castle(side);
      }
    }

    try {
      const result = this.chess.move({ from, to, promotion });
      if (!result) return null;
      // Use chess.js's own `promotion` (only set when the move actually promoted a pawn),
      // not the `promotion` parameter we passed in — ChessBoard always passes 'q' as a
      // just-in-case default even for non-promotion moves, and echoing that back verbatim
      // would tag every ordinary move as if it ended in a promotion. A real promotion is
      // always to n/b/r/q (chess.js's PieceSymbol type is just broader than that in practice).
      const actualPromotion = result.promotion as 'n' | 'b' | 'r' | 'q' | undefined;
      return {
        from: result.from,
        to: result.to,
        promotion: actualPromotion,
        san: result.san,
        captured: result.captured as Move['captured'],
      };
    } catch {
      return null;
    }
  }

  undo(): void {
    this.chess.undo();
  }

  reset(): void {
    this.chess.reset();
  }

  getStatus(): GameStatus {
    if (this.chess.isCheckmate()) return 'checkmate';
    if (this.chess.isStalemate()) return 'stalemate';
    if (this.chess.isDraw()) return 'draw';
    if (this.chess.isCheck()) return 'check';
    return 'playing';
  }

  isGameOver(): boolean {
    return this.chess.isGameOver();
  }

  getFen(): string {
    return this.chess.fen();
  }

  getHistory(): string[] {
    return this.chess.history();
  }

  /** Total number of legal moves for the side to move in the current position — used as a
   * cheap "how complex is this position" proxy (e.g. for scaling bot thinking time). */
  getLegalMoveCount(): number {
    return this.chess.moves().length;
  }

  /** Whether `square` is attacked by any piece of `byColor` in the current position. */
  isSquareAttacked(square: string, byColor: PieceColor): boolean {
    return this.chess.isAttacked(square as ChessJsSquare, byColor);
  }

  /** The piece on `square`, or null if empty. */
  getPieceAt(square: string): Piece | null {
    const piece = this.chess.get(square as ChessJsSquare);
    return piece ? { type: piece.type, color: piece.color } : null;
  }

  // --- Chess960 castling ------------------------------------------------

  private getChess960CastlingTargetsFrom(square: string): string[] {
    const piece = this.chess.get(square as ChessJsSquare);
    if (!piece || piece.type !== 'k' || piece.color !== this.chess.turn()) return [];

    const rank = piece.color === 'w' ? '1' : '8';
    if (square !== `${FILES[this.files.kingFile]}${rank}`) return [];

    const targets: string[] = [];
    if (this.isChess960CastleLegal(piece.color, 'k')) targets.push(`${FILES[6]}${rank}`);
    if (this.isChess960CastleLegal(piece.color, 'q')) targets.push(`${FILES[2]}${rank}`);
    return targets;
  }

  private matchChess960CastleAttempt(from: string, to: string): 'k' | 'q' | null {
    const piece = this.chess.get(from as ChessJsSquare);
    if (!piece || piece.type !== 'k' || piece.color !== this.chess.turn()) return null;

    const rank = piece.color === 'w' ? '1' : '8';
    if (from !== `${FILES[this.files.kingFile]}${rank}`) return null;

    if (to === `${FILES[6]}${rank}` && this.isChess960CastleLegal(piece.color, 'k')) return 'k';
    if (to === `${FILES[2]}${rank}` && this.isChess960CastleLegal(piece.color, 'q')) return 'q';
    return null;
  }

  private isChess960CastleLegal(color: PieceColor, side: 'k' | 'q'): boolean {
    const castlingChar = side === 'k' ? (color === 'w' ? 'K' : 'k') : color === 'w' ? 'Q' : 'q';
    if (!this.chess.fen().split(' ')[2].includes(castlingChar)) return false;

    const rank = color === 'w' ? '1' : '8';
    const kingFile = this.files.kingFile;
    const rookFile = side === 'k' ? this.files.kingRookFile : this.files.queenRookFile;

    const kingFromSq = `${FILES[kingFile]}${rank}` as ChessJsSquare;
    const rookFromSq = `${FILES[rookFile]}${rank}` as ChessJsSquare;

    const kingPiece = this.chess.get(kingFromSq);
    const rookPiece = this.chess.get(rookFromSq);
    if (!kingPiece || kingPiece.type !== 'k' || kingPiece.color !== color) return false;
    if (!rookPiece || rookPiece.type !== 'r' || rookPiece.color !== color) return false;

    const kingToFile = side === 'k' ? 6 : 2;
    const rookToFile = side === 'k' ? 5 : 3;

    const mustBeEmpty = new Set<number>([...fileRange(kingFile, kingToFile), ...fileRange(rookFile, rookToFile)]);
    mustBeEmpty.delete(kingFile);
    mustBeEmpty.delete(rookFile);

    for (const file of mustBeEmpty) {
      if (this.chess.get(`${FILES[file]}${rank}` as ChessJsSquare)) return false;
    }

    const opponent: PieceColor = color === 'w' ? 'b' : 'w';
    for (const file of fileRange(kingFile, kingToFile)) {
      if (this.chess.isAttacked(`${FILES[file]}${rank}` as ChessJsSquare, opponent)) return false;
    }

    return true;
  }

  private performChess960Castle(side: 'k' | 'q'): Move | null {
    const color = this.chess.turn();
    if (!this.isChess960CastleLegal(color, side)) return null;

    const rank = color === 'w' ? '1' : '8';
    const rankIndex = color === 'w' ? 7 : 0;
    const kingFile = this.files.kingFile;
    const rookFile = side === 'k' ? this.files.kingRookFile : this.files.queenRookFile;
    const kingToFile = side === 'k' ? 6 : 2;
    const rookToFile = side === 'k' ? 5 : 3;

    const [placement, , castling, , halfmove, fullmove] = this.chess.fen().split(' ');
    const ranks = placement.split('/');
    const row = expandFenRank(ranks[rankIndex]);

    const kingChar = row[kingFile];
    const rookChar = row[rookFile];
    row[kingFile] = '.';
    row[rookFile] = '.';
    row[kingToFile] = kingChar;
    row[rookToFile] = rookChar;
    ranks[rankIndex] = collapseFenRank(row);

    const newCastling = (color === 'w' ? castling.replace(/[KQ]/g, '') : castling.replace(/[kq]/g, '')) || '-';
    const newTurn = color === 'w' ? 'b' : 'w';
    const newHalfmove = String(Number(halfmove) + 1);
    const newFullmove = color === 'b' ? String(Number(fullmove) + 1) : fullmove;

    const newFen = [ranks.join('/'), newTurn, newCastling, '-', newHalfmove, newFullmove].join(' ');
    this.chess.load(newFen);

    const from = `${FILES[kingFile]}${rank}`;
    const to = `${FILES[kingToFile]}${rank}`;
    const san = side === 'k' ? 'O-O' : 'O-O-O';
    return { from, to, san };
  }
}

function fileRange(a: number, b: number): number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const out: number[] = [];
  for (let f = lo; f <= hi; f++) out.push(f);
  return out;
}
