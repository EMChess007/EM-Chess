import type { ChessEngine } from './ChessEngine';
import type { Move, PieceColor, PieceType } from '../types/chess';

/**
 * Duck Chess rules, layered on ChessEngine's pseudo-legal generator — the same primitive Fog of War,
 * Giveaway and Atomic use, for the same reason: there is no check, so chess.js's king-safety filtering is
 * simply not wanted. The rules:
 *  - NO check, checkmate or stalemate-by-check: moving into "check" is fully legal, and the game ends the
 *    instant a king is actually CAPTURED (see getDuckChessWinner).
 *  - One neutral DUCK piece belongs to neither side, can never be captured, and blocks every other piece:
 *    nothing may land on its square, and sliding pieces and double pawn steps may not pass through it
 *    (knights and kings only care about their destination). Castling is blocked when the duck sits on any
 *    square the king or rook crosses or lands on. Handled inside ChessEngine's move generation
 *    (ChessEngineOptions.duckChess/duckSquare), using isMoveBlockedByDuck / isCastleBlockedByDuck below.
 *  - A TURN is two actions: a normal move from the duck-aware pseudo-legal set, then placing the duck on
 *    ANY other empty square (getLegalDuckPlacementSquares — the duck's current square is occupied by the
 *    duck, so it is never "empty" and must move every turn). There is no duck before White's first move;
 *    White's first turn already includes both actions. A move that captures a king ends the game at once,
 *    with no duck placement.
 *  - If the side to move has NO regular move at all (fully blockaded by the duck and its own pieces), the
 *    game is a draw (hasNoDuckMoves).
 *  - Castling, promotion and en passant otherwise follow the ordinary rules, with one consequence of "no
 *    check": castling is NOT restricted by attacks (out of, through or into "check" is fine), so ChessEngine
 *    adds back the castles chess.js's generator withholds for that reason — only the right, empty squares
 *    and the duck matter.
 *
 * Mutually exclusive with every other variant. The duck's square is NOT part of the FEN (chess.js knows
 * nothing of it), so every engine used for Duck Chess is built from { fen, duckSquare } and the game state
 * carries `duckSquare` next to the fen (GameHistoryEntry.duckSquare per ply; Move.duck for notation).
 * Mirrored on the server in backend/src/game/duckChess.ts.
 */

// --- Shared rules block (mirrored VERBATIM in backend/src/game/duckChess.ts; scripts/test-duck.mjs fails if the
// two copies differ — edit both together) -----------------------------------------------------------------------

const FILES = 'abcdefgh';

const fileOf = (square: string) => square.charCodeAt(0) - 97;
const rankOf = (square: string) => Number(square[1]) - 1;
const nameOf = (file: number, rank: number) => `${FILES[file]}${rank + 1}`;

/** The squares strictly between `from` and `to` when they share a rank, file or diagonal; empty for
 * anything else (a knight's jump) and for adjacent squares. */
export function squaresBetween(from: string, to: string): string[] {
  const df = fileOf(to) - fileOf(from);
  const dr = rankOf(to) - rankOf(from);
  if (!(df === 0 || dr === 0 || Math.abs(df) === Math.abs(dr))) return [];
  const steps = Math.max(Math.abs(df), Math.abs(dr));
  const sf = Math.sign(df);
  const sr = Math.sign(dr);
  const out: string[] = [];
  for (let i = 1; i < steps; i++) out.push(nameOf(fileOf(from) + sf * i, rankOf(from) + sr * i));
  return out;
}

/** Whether the duck stops an ordinary (non-castling) move: nothing may land on it, and sliding pieces and
 * a pawn's double step may not pass over it. Knights and kings jump/step, so only their destination matters. */
export function isMoveBlockedByDuck(piece: PieceType, from: string, to: string, duckSquare: string | null | undefined): boolean {
  if (!duckSquare) return false;
  if (to === duckSquare) return true;
  if (piece === 'n' || piece === 'k') return false;
  return squaresBetween(from, to).includes(duckSquare);
}

/** Whether the duck blocks a castling move (`from` = the king's square, `to` = where it lands, two files
 * away): it may not sit on any square the king or the rook crosses or lands on. */
export function isCastleBlockedByDuck(from: string, to: string, duckSquare: string | null | undefined): boolean {
  if (!duckSquare) return false;
  const rank = from[1];
  const kingSide = fileOf(to) > fileOf(from);
  const crossed = kingSide ? ['f', 'g'] : ['b', 'c', 'd'];
  return crossed.some((file) => `${file}${rank}` === duckSquare);
}

// --- End of the shared rules block --------------------------------------------------------------------------------

/** Every square the duck may be placed on after a regular move: all currently EMPTY squares of the
 * position `engine` holds (i.e. AFTER the move), except the duck's present square — which the duck itself
 * occupies, so it is forced to move somewhere new every turn. */
export function getLegalDuckPlacementSquares(engine: ChessEngine, duckSquare: string | null | undefined): string[] {
  const out: string[] = [];
  for (const row of engine.getBoard()) {
    for (const square of row) {
      if (!square.piece && square.square !== duckSquare) out.push(square.square);
    }
  }
  return out;
}

/** Duck Chess's only decisive result — directly capturing the enemy king. `mover` is whoever just moved. */
export function getDuckChessWinner(move: Move | null, mover: PieceColor): PieceColor | null {
  return move?.captured === 'k' ? mover : null;
}

/** True when the side to move has no regular move at all (blockaded by the duck and its own pieces) — a
 * draw. `engine` must be built with the duck's current square. */
export function hasNoDuckMoves(engine: ChessEngine): boolean {
  return engine.getPseudoLegalMoves(engine.getTurn()).length === 0;
}

/** A move as shown in the move list: standard notation followed by where the duck went, "e4 @g6". */
export function duckMoveNotation(move: Pick<Move, 'san' | 'duck'>): string {
  return move.duck ? `${move.san} @${move.duck}` : move.san;
}
