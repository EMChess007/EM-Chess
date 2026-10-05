import type { ChessEngine } from './ChessEngine';
import type { Move, PieceColor, PieceType } from '../types/chess';

/**
 * Horde chess, per chess.com's own documentation (support.chess.com/en/articles/8708676, chess.com/terms/horde-chess):
 *
 *  - Black has the normal army. White has a HORDE of 36 pawns and NO KING AT ALL: nothing for White can be in check, so
 *    White's moves are never filtered for king safety, and White has no castling. Black may castle as usual (the start
 *    FEN keeps the "kq" castling rights).
 *  - White wins by checkmating Black's king, the ordinary way. Black wins by capturing EVERY White pawn (and every
 *    piece White has promoted to) — the position is then simply "White has nothing left", see getHordeWinnerFromFen.
 *  - Stalemate is a DRAW for either side, exactly as in standard chess. (Lichess/community variants sometimes treat a
 *    stalemated horde differently; chess.com does not, and neither do we.)
 *  - En passant works normally; White's pawns promote normally on the 8th rank, Black's on the 1st.
 *  - THE ONE REAL RULE DEVIATION: "White pawns on the first and second ranks can move two squares forward if they have
 *    room to do it." Double-step eligibility is POSITIONAL (any White pawn currently standing on rank 1 or 2), not a
 *    one-time "first move only" flag — a pawn that goes 1->2 may still go 2->4 afterwards. chess.js already grants the
 *    double step from rank 2 (its fixed home rank for White), so the ONLY move it cannot generate is the rank-1 double
 *    step (rank 1 -> rank 3). That single move is synthesized here and applied through chess.js's own `_makeMove` with
 *    its BIG_PAWN flag (so an en passant square is recorded like any double step) — see ChessEngine's `horde` option.
 *
 * How little else is custom (compare Giveaway/Atomic/Duck Chess, which replace chess.js's legality): chess.js
 * tolerates a missing White king when loaded with skipValidation (its king-safety filter is simply skipped for a side with
 * no king), generates Black's legal moves normally, and reports Black checkmate and either side's stalemate correctly.
 * What it gets WRONG for Horde, and ChessEngine therefore overrides when `horde` is set:
 *  - isInsufficientMaterial() counts "Black king + one White bishop" as king-versus-king and calls a draw — in Horde
 *    Black must capture that bishop, so insufficient material never ends a Horde game;
 *  - a White side with no pieces left reports "stalemate" (a draw) — it is Black's WIN, decided here first.
 *
 * Mutually exclusive with every other variant. Every engine used with this file MUST be constructed with
 * { horde: true } (which implies skipValidation: a Horde FEN has no White king).
 *
 * KNOWN LIMIT (same as every non-Atomic mode, see TODO.md): threefold repetition is never detected, because screens
 * rebuild the engine from the FEN each move; the fifty-move rule is read from the FEN's halfmove clock and works.
 */

// --- Shared rules block (mirrored VERBATIM in backend/src/game/horde.ts; scripts/test-horde.mjs fails if the two
// copies differ -- edit both together) ------------------------------------------------------------------------------

/** The standard Horde start position (the layout Lichess and chess.com both use): 36 White pawns — ranks 1-4 full, plus
 * b5, c5, f5, g5 — against Black's normal army. "kq": Black keeps its castling rights; White has no king to castle. */
export const HORDE_START_FEN = 'rnbqkbnr/pppppppp/8/1PP2PP1/PPPPPPPP/PPPPPPPP/PPPPPPPP/PPPPPPPP w kq - 0 1';
export const HORDE_START_PAWN_COUNT = 36;

/** Whether a pawn that has just double-stepped from RANK 1 (rank 1 -> 3) may be captured en passant by a Black pawn
 * beside it. chess.com's documentation says only "en passant captures are allowed" and does not single this case out,
 * so it is treated like any other double step (true). Lichess's rules (and the chessops library the tests use as an
 * oracle) say NO for this one case — flip this constant, in BOTH copies of this block, to follow them; the tests pin
 * exactly this divergence, so they will tell you what else to update. */
export const HORDE_FIRST_RANK_DOUBLE_STEP_ALLOWS_EN_PASSANT = true;

/** The square a White pawn standing on `from` may reach with the Horde-only RANK-1 double step (rank 1 -> rank 3), or null.
 * Needs the next two squares on its file empty. Rank 2 -> rank 4 is NOT handled here: chess.js already generates it. */
export function hordeFirstRankDoubleStep(from: string, isOccupied: (square: string) => boolean): string | null {
  if (from.length !== 2 || from[1] !== '1') return null;
  const file = from[0];
  return isOccupied(`${file}2`) || isOccupied(`${file}3`) ? null : `${file}3`;
}

/** How many White pieces (pawns and anything promoted) the FEN's piece-placement field still has. */
export function hordeWhitePieceCount(fen: string): number {
  const placement = fen.split(' ')[0];
  let count = 0;
  for (let i = 0; i < placement.length; i++) {
    const ch = placement[i];
    if (ch >= 'A' && ch <= 'Z') count++;
  }
  return count;
}

/** Black's win condition: 'b' once White has no pieces left, else null. (Checkmate — White's win — is chess.js's own
 * checkmate detection, so it is not repeated here.) Must be checked BEFORE the stalemate status: a White side with
 * nothing left has no legal move and no king in check, which chess.js calls stalemate. */
export function getHordeWinnerFromFen(fen: string): PieceColor | null {
  return hordeWhitePieceCount(fen) === 0 ? 'b' : null;
}

// --- End of the shared rules block --------------------------------------------------------------------------------

/** Black's win condition for a live engine — see getHordeWinnerFromFen. */
export function getHordeWinner(engine: ChessEngine): PieceColor | null {
  return getHordeWinnerFromFen(engine.getFen());
}

const PROMOTION_PIECES: ('q' | 'r' | 'b' | 'n')[] = ['q', 'r', 'b', 'n'];

/** Every legal Horde move for the side to move (optionally only those starting on `square`), including the rank-1 double
 * step and every promotion choice. Moves carry no SAN (nothing has been played); `captured` is filled in, including the
 * pawn taken en passant. Built from the engine's own getLegalMoves, so it is exactly what the board offers. */
export function getHordeMoves(engine: ChessEngine, square?: string): Move[] {
  const turn = engine.getTurn();
  const moves: Move[] = [];
  const squares = square ? [square] : engine.getBoard().flat().filter((s) => s.piece?.color === turn).map((s) => s.square);
  for (const from of squares) {
    const piece = engine.getPieceAt(from);
    if (!piece || piece.color !== turn) continue;
    // A set: chess.js lists a promotion target once per promotion piece, and the choices are expanded below.
    for (const to of new Set(engine.getLegalMoves(from))) {
      const target = engine.getPieceAt(to);
      const enPassant = piece.type === 'p' && !target && from[0] !== to[0];
      const captured: PieceType | undefined = target ? target.type : enPassant ? 'p' : undefined;
      const lastRank = (turn === 'w' && to[1] === '8') || (turn === 'b' && to[1] === '1');
      if (piece.type === 'p' && lastRank) {
        for (const promotion of PROMOTION_PIECES) moves.push({ from, to, promotion, san: '', captured });
      } else {
        moves.push({ from, to, san: '', captured });
      }
    }
  }
  return moves;
}
