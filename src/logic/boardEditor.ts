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

/** The three FEN fields the editor's board/turn/castling controls cannot express. They only ever come from a LOADED/pasted FEN (so "From Position"
 * keeps a mid-game en passant square, a halfmove clock and a move number); any hand edit of the board resets them to DEFAULT_FEN_EXTRAS. */
export interface FenExtras {
  enPassant: string;
  halfmove: number;
  fullmove: number;
}
export const DEFAULT_FEN_EXTRAS: FenExtras = { enPassant: '-', halfmove: 0, fullmove: 1 };

/** The en passant / halfmove / fullmove fields of `fen`, defaulting each one that is missing or not a number. */
export function parseFenExtras(fen: string): FenExtras {
  const fields = fen.trim().split(/\s+/);
  const halfmove = parseInt(fields[4] ?? '', 10);
  const fullmove = parseInt(fields[5] ?? '', 10);
  return {
    enPassant: fields[3] && fields[3] !== '-' ? fields[3] : '-',
    halfmove: Number.isFinite(halfmove) && halfmove >= 0 ? halfmove : 0,
    fullmove: Number.isFinite(fullmove) && fullmove >= 1 ? fullmove : 1,
  };
}

/** Builds a full 6-field FEN from the editor's own state. Without `extras` it is a fresh position (no prior
 * moves): en passant target/halfmove clock "-"/"0" and fullmove number 1. */
export function buildFen(board: BoardSquare[][], turn: PieceColor, castling: CastlingRights, extras: FenExtras = DEFAULT_FEN_EXTRAS): string {
  const placement = boardToPlacement(board);
  const castlingField = `${castling.K ? 'K' : ''}${castling.Q ? 'Q' : ''}${castling.k ? 'k' : ''}${castling.q ? 'q' : ''}` || '-';
  return `${placement} ${turn} ${castlingField} ${extras.enPassant} ${extras.halfmove} ${extras.fullmove}`;
}

export const STARTING_EDITOR_FEN = START_FEN;

/** `error` is English, `errorEl` the same message in Greek (the screens show both lines; there is no app-wide language switch). */
export type EditorValidation = { ok: true } | { ok: false; error: string; errorEl: string };

export interface EditorValidationOptions {
  /** "From Position" (command #50): the position is about to be PLAYED, so it must also be a legal START of a game - castling rights and the
   * en-passant square consistent with the pieces, and not already over. Analysis keeps the looser check (any set-up position may be studied). */
  forPlay?: boolean;
}

const fail = (error: string, errorEl: string): EditorValidation => ({ ok: false, error, errorEl });

/** Greek twin of a chess.js structural error. Unknown messages fall back to a generic Greek line; the English text is always chess.js's own. */
function structuralErrorEl(error: string): string {
  const king = /(missing|too many) (white|black) king/.exec(error);
  if (king) {
    const white = king[2] === 'white';
    return king[1] === 'missing'
      ? `Λείπει ο ${white ? 'λευκός' : 'μαύρος'} βασιλιάς.`
      : `Υπάρχουν πολλοί ${white ? 'λευκοί' : 'μαύροι'} βασιλιάδες (πρέπει να υπάρχει ακριβώς ένας).`;
  }
  if (/pawns are on the edge rows/.test(error)) return 'Δεν επιτρέπονται πιόνια στην 1η ή την 8η γραμμή.';
  if (/en-passant/.test(error)) return 'Μη έγκυρο τετράγωνο en passant.';
  if (/castling/.test(error)) return 'Μη έγκυρα δικαιώματα ροκέ.';
  return 'Μη έγκυρο FEN.';
}

/** A pasted FEN with only the first four fields (placement, side, castling, en passant) is common (Lichess shows it so); the clocks default to
 * "0 1". Whitespace is collapsed. Anything else is returned trimmed and untouched for validateEditorFen to judge. */
export function normalizePlayFen(fen: string): string {
  const fields = fen.trim().split(/\s+/);
  return fields.length === 4 ? [...fields, '0', '1'].join(' ') : fields.join(' ');
}

/** The first castling right in `fields[2]` whose king or rook is not on its home square, or null. */
function inconsistentCastling(fen: string): string | null {
  const board = boardFromFen(fen);
  const at = (square: string) => board[8 - parseInt(square[1], 10)][square.charCodeAt(0) - 97].piece;
  const is = (square: string, type: PieceType, color: PieceColor) => {
    const piece = at(square);
    return piece !== null && piece.type === type && piece.color === color;
  };
  const rights = parseCastlingFromFen(fen);
  if (rights.K && !(is('e1', 'k', 'w') && is('h1', 'r', 'w'))) return 'K';
  if (rights.Q && !(is('e1', 'k', 'w') && is('a1', 'r', 'w'))) return 'Q';
  if (rights.k && !(is('e8', 'k', 'b') && is('h8', 'r', 'b'))) return 'k';
  if (rights.q && !(is('e8', 'k', 'b') && is('a8', 'r', 'b'))) return 'q';
  return null;
}

/** An en-passant square must be on the 6th rank with White to move (3rd with Black to move), have the pawn that just double-stepped on the
 * square beyond it, and be empty together with the square that pawn came from. */
function enPassantProblem(fen: string): boolean {
  const fields = fen.trim().split(/\s+/);
  const target = fields[3];
  if (!target || target === '-') return false;
  const whiteToMove = fields[1] === 'w';
  if (target[1] !== (whiteToMove ? '6' : '3')) return true;
  const board = boardFromFen(fen);
  const at = (square: string) => board[8 - parseInt(square[1], 10)][square.charCodeAt(0) - 97].piece;
  const file = target[0];
  const pawnSquare = `${file}${whiteToMove ? 5 : 4}`;
  const originSquare = `${file}${whiteToMove ? 7 : 2}`;
  const pawn = at(pawnSquare);
  return !(pawn && pawn.type === 'p' && pawn.color === (whiteToMove ? 'b' : 'w')) || at(target) !== null || at(originSquare) !== null;
}

/** Beyond chess.js's own validateFen (exactly one king per color, no pawns on rank 1/8, correct
 * FEN structure), a placed-by-hand position also needs the one rule those checks don't cover:
 * the side NOT currently to move must not be in check. A real game can never reach such a
 * position — if it were legal, the side to move could simply have captured the king on the
 * previous move — and chess.js's own isCheck() only ever reports on the side to move, so it can't
 * catch this directly. Checked here by flipping whose turn it is and asking a fresh Chess
 * instance whether THAT side is in check. This single rule also covers the narrower case of
 * "both kings in check at once", since if the side not to move can never be in check, the two
 * sides can never both be in check simultaneously either. */
export function validateEditorFen(fen: string, options: EditorValidationOptions = {}): EditorValidation {
  const structural = validateFen(fen);
  if (!structural.ok) {
    const error = structural.error ?? 'Invalid FEN.';
    return fail(error, structuralErrorEl(error));
  }

  const fields = fen.trim().split(/\s+/);
  const flippedTurn = fields[1] === 'w' ? 'b' : 'w';
  const flippedFen = [fields[0], flippedTurn, '-', '-', '0', '1'].join(' ');
  const flipped = new Chess(flippedFen);
  if (flipped.isCheck()) {
    return fail('The side not to move cannot be in check.', 'Η πλευρά που δεν παίζει δεν μπορεί να είναι σε σαχ.');
  }

  if (!options.forPlay) return { ok: true };

  const badRight = inconsistentCastling(fen);
  if (badRight) {
    return fail(
      `Castling right "${badRight}" needs the king and that rook on their starting squares.`,
      `Το δικαίωμα ροκέ "${badRight}" απαιτεί βασιλιά και πύργο στις αρχικές τους θέσεις.`
    );
  }
  if (enPassantProblem(fen)) {
    return fail(
      'The en passant square does not match the position (it must follow a pawn double step).',
      'Το τετράγωνο en passant δεν ταιριάζει με τη θέση (πρέπει να ακολουθεί διπλό βήμα πιονιού).'
    );
  }

  const game = new Chess(fen);
  if (game.isCheckmate()) {
    return fail('This position is already checkmate - there is no game to play.', 'Η θέση είναι ήδη ματ - δεν υπάρχει παρτίδα να παιχτεί.');
  }
  if (game.isStalemate()) {
    return fail('This position is already stalemate - there is no game to play.', 'Η θέση είναι ήδη πατ - δεν υπάρχει παρτίδα να παιχτεί.');
  }
  if (game.isDraw()) {
    return fail(
      'This position is already a draw (insufficient material or the fifty-move rule) - there is no game to play.',
      'Η θέση είναι ήδη ισοπαλία (ανεπαρκές υλικό ή κανόνας των 50 κινήσεων) - δεν υπάρχει παρτίδα να παιχτεί.'
    );
  }

  return { ok: true };
}

/** What the screens show for a failed validation: English, then Greek on its own line. */
export function editorErrorText(validation: { error: string; errorEl: string }): string {
  return `${validation.error}\n${validation.errorEl}`;
}
