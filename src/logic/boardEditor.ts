import { Chess, validateFen } from 'chess.js';
import { START_FEN, type BoardSquare, type PieceColor, type PieceType } from '../types/chess';

const FILES = 'abcdefgh';

export interface CastlingRights {
  K: boolean;
  Q: boolean;
  k: boolean;
  q: boolean;
}

export function emptyBoard(): BoardSquare[][] {
  return Array.from({ length: 8 }, (_, row) =>
    Array.from({ length: 8 }, (_, col) => ({ square: `${FILES[col]}${8 - row}`, piece: null }))
  );
}

/** Reads only the piece-placement field — a caller-supplied FEN may be structurally invalid
 * elsewhere (that's what validateEditorFen is for), but the placement field alone is enough to
 * populate the editor's board grid for the user to then fix by hand. */
export function boardFromFen(fen: string): BoardSquare[][] {
  const placement = fen.trim().split(/\s+/)[0] ?? '';
  const board = emptyBoard();
  const ranks = placement.split('/');
  ranks.forEach((rankStr, rowIndex) => {
    if (rowIndex > 7) return;
    let col = 0;
    for (const char of rankStr) {
      if (col > 7) break;
      if (/[1-8]/.test(char)) {
        col += Number(char);
      } else if (/[pnbrqkPNBRQK]/.test(char)) {
        const color: PieceColor = char === char.toUpperCase() ? 'w' : 'b';
        const type = char.toLowerCase() as PieceType;
        board[rowIndex][col] = { square: `${FILES[col]}${8 - rowIndex}`, piece: { type, color } };
        col += 1;
      }
    }
  });
  return board;
}

function boardToPlacement(board: BoardSquare[][]): string {
  return board
    .map((row) => {
      let rankStr = '';
      let emptyCount = 0;
      for (const square of row) {
        if (!square.piece) {
          emptyCount += 1;
          continue;
        }
        if (emptyCount > 0) {
          rankStr += emptyCount;
          emptyCount = 0;
        }
        const letter = square.piece.type;
        rankStr += square.piece.color === 'w' ? letter.toUpperCase() : letter;
      }
      if (emptyCount > 0) rankStr += emptyCount;
      return rankStr;
    })
    .join('/');
}

export function parseCastlingFromFen(fen: string): CastlingRights {
  const field = fen.trim().split(/\s+/)[2] ?? '-';
  return { K: field.includes('K'), Q: field.includes('Q'), k: field.includes('k'), q: field.includes('q') };
}

export function getTurnFromFen(fen: string): PieceColor {
  const field = fen.trim().split(/\s+/)[1];
  return field === 'b' ? 'b' : 'w';
}

/** Builds a full 6-field FEN from the editor's own state — always a fresh position (no prior
 * moves), so en passant target/halfmove clock are always "-"/"0" and the fullmove number is 1. */
export function buildFen(board: BoardSquare[][], turn: PieceColor, castling: CastlingRights): string {
  const placement = boardToPlacement(board);
  const castlingField = `${castling.K ? 'K' : ''}${castling.Q ? 'Q' : ''}${castling.k ? 'k' : ''}${castling.q ? 'q' : ''}` || '-';
  return `${placement} ${turn} ${castlingField} - 0 1`;
}

export const STARTING_EDITOR_FEN = START_FEN;

export type EditorValidation = { ok: true } | { ok: false; error: string };

/** Beyond chess.js's own validateFen (exactly one king per color, no pawns on rank 1/8, correct
 * FEN structure), a placed-by-hand position also needs the one rule those checks don't cover:
 * the side NOT currently to move must not be in check. A real game can never reach such a
 * position — if it were legal, the side to move could simply have captured the king on the
 * previous move — and chess.js's own isCheck() only ever reports on the side to move, so it can't
 * catch this directly. Checked here by flipping whose turn it is and asking a fresh Chess
 * instance whether THAT side is in check. This single rule also covers the narrower case of
 * "both kings in check at once", since if the side not to move can never be in check, the two
 * sides can never both be in check simultaneously either. */
export function validateEditorFen(fen: string): EditorValidation {
  const structural = validateFen(fen);
  if (!structural.ok) return { ok: false, error: structural.error ?? 'Invalid FEN.' };

  const fields = fen.trim().split(/\s+/);
  const flippedTurn = fields[1] === 'w' ? 'b' : 'w';
  const flippedFen = [fields[0], flippedTurn, '-', '-', '0', '1'].join(' ');
  const flipped = new Chess(flippedFen);
  if (flipped.isCheck()) {
    return { ok: false, error: 'The side not to move cannot be in check.' };
  }

  return { ok: true };
}
