import type { ChessEngine } from './ChessEngine';
import type { Move, PieceColor, PieceType } from '../types/chess';

/**
 * Racing Kings, per Lichess's rules (lichess.org/variant/racingKings) and chess.com's "Racing Kings" help page:
 *
 *  - Both sides have the SAME army (K Q 2R 2B 2N) on ranks 1-2, split on the a-d / e-h files (see RACING_KINGS_START_FEN).
 *    There are no pawns and no castling.
 *  - THE ONE REAL RULE DEVIATION: giving check is ILLEGAL — a move may not leave EITHER king in check. (Leaving your own
 *    king in check is illegal in ordinary chess too, so chess.js already enforces that half; the other half — a move
 *    that checks the opponent — is filtered out here, via the "+" / "#" suffix of chess.js's own SAN.) A king is
 *    therefore never in check, there is no checkmate, and getStatus() never reports 'check' or 'checkmate'.
 *  - The goal is to bring your KING to the 8th rank. White moves first, so White has a one-move head start: if White's
 *    king reaches rank 8 and Black's king can reach rank 8 on the very next move, the game is a DRAW (both made it);
 *    if it cannot, White wins. If Black's king gets to rank 8 first (White's is not there), Black wins at once.
 *  - Stalemate (the side to move has no check-free legal move) is a DRAW. The fifty-move rule, threefold repetition
 *    (repetition.ts) and chess.js's insufficient-material draw apply as in ordinary chess.
 *
 * Mutually exclusive with every other variant. Every engine used with this file MUST be constructed with
 * { racingKings: true }. chess.js loads the start FEN normally (one king each, no castling rights), so no
 * skipValidation is needed.
 */

// --- Shared rules block (mirrored VERBATIM in backend/src/game/racingKings.ts; scripts/test-racingKings.mjs fails if the
// two copies differ -- edit both together) --------------------------------------------------------------------------

/** The standard Racing Kings start position (Lichess / chess.com): Black's army fills the a-d files of ranks 1-2, White's
 * the e-h files (Black king a2, White king h2; queens a1 / h1). */
export const RACING_KINGS_START_FEN = '8/8/8/8/8/8/krbnNBRK/qrbnNBRQ w - - 0 1';

/** The rank a king must reach (FEN rank 8). */
export const RACING_KINGS_GOAL_RANK = '8';

/** Which kings stand on the goal rank, read from the FEN's piece placement (its FIRST row is rank 8). */
export function racingKingsKingsOnGoal(fen: string): { w: boolean; b: boolean } {
  const rank8 = fen.split(' ')[0].split('/')[0] ?? '';
  return { w: rank8.includes('K'), b: rank8.includes('k') };
}

/** The result a position can have WITHOUT looking at legal moves: 'draw' when both kings are on rank 8, 'b' when only
 * Black's is, 'w' when only White's is AND it is White's move (Black had its reply and did not make it), else null.
 * White's king on rank 8 with BLACK to move is undecided here -- Black may still reach rank 8 (see getRacingKingsOutcome). */
export function racingKingsOutcomeFromFen(fen: string): 'w' | 'b' | 'draw' | null {
  const { w, b } = racingKingsKingsOnGoal(fen);
  if (w && b) return 'draw';
  if (b) return 'b';
  if (w) return fen.split(' ')[1] === 'w' ? 'w' : null;
  return null;
}

// --- End of the shared rules block --------------------------------------------------------------------------------

/** Whether the side to move can put its KING on rank 8 with one legal (check-free) move. */
export function racingKingsMoverCanReachGoal(engine: ChessEngine): boolean {
  const turn = engine.getTurn();
  for (const row of engine.getBoard()) {
    for (const cell of row) {
      if (cell.piece?.type !== 'k' || cell.piece.color !== turn) continue;
      return engine.getLegalMoves(cell.square).some((to) => to[1] === RACING_KINGS_GOAL_RANK);
    }
  }
  return false;
}

/** The decisive/draw result of a live engine: 'w' / 'b' (the winner), 'draw' (both kings made it), or null (play on).
 * Stalemate and the fifty-move draw come in through the engine's own getStatus(). */
export function getRacingKingsOutcome(engine: ChessEngine): 'w' | 'b' | 'draw' | null {
  const fen = engine.getFen();
  const direct = racingKingsOutcomeFromFen(fen);
  if (direct) return direct;
  const { w } = racingKingsKingsOnGoal(fen);
  // White is on rank 8 and Black is to move: Black's one reply decides draw (it reaches) versus White's win (it cannot).
  if (w && !racingKingsMoverCanReachGoal(engine)) return 'w';
  return null;
}

/** The winner of a live engine (null for a draw or while playing) -- the same shape as the other variants' winner helpers. */
export function getRacingKingsWinner(engine: ChessEngine): PieceColor | null {
  const outcome = getRacingKingsOutcome(engine);
  return outcome === 'w' || outcome === 'b' ? outcome : null;
}

/** Every legal Racing Kings move for the side to move (there are no pawns, so no promotions). Moves carry no SAN;
 * `captured` is filled in. Built from the engine's own getLegalMoves, so it is exactly what the board offers (checking
 * moves are already gone). */
export function getRacingKingsMoves(engine: ChessEngine, square?: string): Move[] {
  const turn = engine.getTurn();
  const moves: Move[] = [];
  const squares = square ? [square] : engine.getBoard().flat().filter((s) => s.piece?.color === turn).map((s) => s.square);
  for (const from of squares) {
    const piece = engine.getPieceAt(from);
    if (!piece || piece.color !== turn) continue;
    for (const to of new Set(engine.getLegalMoves(from))) {
      const target = engine.getPieceAt(to);
      const captured: PieceType | undefined = target ? target.type : undefined;
      moves.push({ from, to, san: '', captured });
    }
  }
  return moves;
}
