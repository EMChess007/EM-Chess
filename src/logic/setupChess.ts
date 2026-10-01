import type { PieceColor, PieceType } from '../types/chess';

/** Classical value of a full army (8+10+6+6+9 = 8 pawns, 2 rooks, 2 knights, 2 bishops, 1 queen)
 * — the budget every Setup Chess army must fit within. The king is mandatory and free. */
export const SETUP_CHESS_BUDGET = 39;

export const SETUP_CHESS_PIECE_COST: Record<Exclude<PieceType, 'k'>, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
};

/** King first (free, mandatory), then descending value — same palette order BoardSetupScreen
 * already uses. */
export const SETUP_CHESS_PALETTE_ORDER: PieceType[] = ['k', 'q', 'r', 'b', 'n', 'p'];

export interface SetupChessPiece {
  square: string;
  type: PieceType;
}

export function pieceCost(type: PieceType): number {
  return type === 'k' ? 0 : SETUP_CHESS_PIECE_COST[type];
}

export function computeArmyCost(pieces: SetupChessPiece[]): number {
  return pieces.reduce((sum, p) => sum + pieceCost(p.type), 0);
}

/** The rank a color's non-pawn pieces (including the king) must sit on. */
export function backRankFor(color: PieceColor): number {
  return color === 'w' ? 1 : 8;
}

/** The rank a color's pawns must sit on. */
export function pawnRankFor(color: PieceColor): number {
  return color === 'w' ? 2 : 7;
}

/** Same placement restriction as normal chess's own starting position — pawns only on their own
 * pawn rank, everything else only on the back rank — the player just picks WHICH pieces go where
 * within that, not the classical arrangement. */
export function isSquareAllowed(square: string, type: PieceType, color: PieceColor): boolean {
  const rank = parseInt(square[1], 10);
  return type === 'p' ? rank === pawnRankFor(color) : rank === backRankFor(color);
}

export type SetupChessValidation = { ok: true } | { ok: false; error: string };

/** Validates one player's own army before it can be finalized. Square legality and one-piece-
 * per-square are already enforced at placement time (see SetupChessBuilderScreen), so this only
 * checks the two rules the UI alone can't guarantee stay true: exactly one king present, and the
 * total cost not exceeding the budget — nothing requires spending all of it. */
export function validateSetupArmy(pieces: SetupChessPiece[]): SetupChessValidation {
  const kings = pieces.filter((p) => p.type === 'k').length;
  if (kings !== 1) return { ok: false, error: 'You need exactly one king.' };
  const cost = computeArmyCost(pieces);
  if (cost > SETUP_CHESS_BUDGET) {
    return { ok: false, error: `Your army costs ${cost}, but the budget is ${SETUP_CHESS_BUDGET}.` };
  }
  return { ok: true };
}

/** Merges each side's independently-built army into the starting FEN for a live game — ranks 3-6
 * are always empty, White always moves first, and castling rights are computed the same way real
 * chess itself would: available only if the king AND the matching rook both ended up on their
 * classical corner squares (e1/a1/h1, e8/a8/h8). A player who placed either elsewhere simply has
 * no castling rights on that side, same as if they'd already moved in a real game. */
export function mergeSetupArmies(whitePieces: SetupChessPiece[], blackPieces: SetupChessPiece[]): string {
  const grid: (string | null)[][] = Array.from({ length: 8 }, () => Array(8).fill(null));

  const place = (pieces: SetupChessPiece[], color: PieceColor) => {
    for (const { square, type } of pieces) {
      const file = square.charCodeAt(0) - 97;
      const rank = parseInt(square[1], 10);
      const row = 8 - rank;
      grid[row][file] = color === 'w' ? type.toUpperCase() : type;
    }
  };
  place(whitePieces, 'w');
  place(blackPieces, 'b');

  const placement = grid
    .map((row) => {
      let rankStr = '';
      let emptyCount = 0;
      for (const cell of row) {
        if (!cell) {
          emptyCount += 1;
          continue;
        }
        if (emptyCount > 0) {
          rankStr += emptyCount;
          emptyCount = 0;
        }
        rankStr += cell;
      }
      if (emptyCount > 0) rankStr += emptyCount;
      return rankStr;
    })
    .join('/');

  const hasPieceAt = (pieces: SetupChessPiece[], square: string, type: PieceType) =>
    pieces.some((p) => p.square === square && p.type === type);
  const castling =
    (hasPieceAt(whitePieces, 'e1', 'k') && hasPieceAt(whitePieces, 'h1', 'r') ? 'K' : '') +
    (hasPieceAt(whitePieces, 'e1', 'k') && hasPieceAt(whitePieces, 'a1', 'r') ? 'Q' : '') +
    (hasPieceAt(blackPieces, 'e8', 'k') && hasPieceAt(blackPieces, 'h8', 'r') ? 'k' : '') +
    (hasPieceAt(blackPieces, 'e8', 'k') && hasPieceAt(blackPieces, 'a8', 'r') ? 'q' : '');

  return `${placement} w ${castling || '-'} - 0 1`;
}

/** The fixed classical army (rooks/knights/bishops/queen at their usual squares, plus the king
 * and 8 pawns) used for the bot's side in Bot-mode Setup Chess — deliberately deterministic
 * rather than a randomly-generated-but-valid army, see the app's own design decision on this. */
export function classicalSetupArmy(color: PieceColor): SetupChessPiece[] {
  const back = backRankFor(color);
  const pawnRank = pawnRankFor(color);
  const files = 'abcdefgh';
  const backRankTypes: PieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  const pieces: SetupChessPiece[] = backRankTypes.map((type, i) => ({ square: `${files[i]}${back}`, type }));
  for (const file of files) pieces.push({ square: `${file}${pawnRank}`, type: 'p' });
  return pieces;
}
