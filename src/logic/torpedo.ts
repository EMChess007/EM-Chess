import type { ChessEngine } from './ChessEngine';
import type { Move, PieceColor, PieceType } from '../types/chess';

/**
 * Torpedo chess (the DeepMind / AlphaZero variant, played on chess.com's variants server and on PyChess). Sources that
 * agree on the rules: chess.com support article "What is Torpedo Chess?", chess.com/terms/torpedo-chess, the PyChess
 * variant page, Mats Winther's AlphaZero-variants page, ChessBase "AlphaZero/Kramnik: Torpedo pawns". (Lichess does not
 * offer the variant; chessvariants.org has no page for this one.)
 *
 * THE ONE RULE CHANGE: a pawn may ALWAYS move one or two squares straight ahead, from any rank — not only from its start
 * rank. Everything else is standard chess:
 *  - Start position is the ordinary one (TORPEDO_START_FEN), castling included.
 *  - The double step needs BOTH squares in front of the pawn empty (a pawn never jumps), and like every move it may not
 *    leave the mover's own king in check — it can also be the move that blocks a check.
 *  - Reaching the last rank by a double step (a pawn on the 6th rank to the 8th) promotes, like any pawn arrival there.
 *  - EN PASSANT works after EVERY double step, on every rank ("en passant can happen anywhere on the board"): the pawn
 *    that has just advanced two squares may be captured by an enemy pawn beside its landing square, as if it had moved
 *    one square, on the very next move only. So the en passant target square can be on rank 4 or 5 as well as 3 or 6.
 *  - Checkmate wins; stalemate is a draw; threefold repetition, the fifty-move rule and insufficient material
 *    (chess.js's own rule: pawns still on the board mean material is never insufficient) draw exactly as in standard chess.
 *    Unlike Racing Kings, Torpedo keeps the insufficient-material draw: the variant adds no way to mate or win with less.
 *
 * How little is custom: chess.js already generates the double step from the pawn's HOME rank (rank 2 for White, 7 for
 * Black), so the only moves it cannot generate are the double steps from ranks 3-6 (White) / 6-3 (Black). Those are
 * synthesized by ChessEngine through chess.js's own `_makeMove` with its BIG_PAWN flag, so the en passant square is
 * recorded like any double step (see ChessEngineOptions.torpedo). Two chess.js behaviours need care:
 *  - its FEN loader refuses an en passant square outside ranks 3/6, so a Torpedo engine is always built with skipValidation
 *    (every screen and bot rebuilds the engine from the FEN each ply);
 *  - its checkmate / stalemate detection does not know the extra double steps, which can block a check or be the only
 *    legal move, so ChessEngine.getStatus / isGameOver / getLegalMoveCount look for a legal torpedo step before they
 *    call a position mate or stalemate.
 *
 * Mutually exclusive with every other variant (Classic, 960, KotH, 3-check, Setup Chess, Fog of War, Giveaway, Atomic, Duck,
 * Spell, Horde, Racing Kings, Crazyhouse and the 4-seat games). Stockfish does not know the double step, so bots use
 * chooseTorpedoBotMove, and Game Review / PGN replay / analysis are not offered (they assume ordinary pawns).
 */

// --- Shared rules block (mirrored VERBATIM in backend/src/game/torpedo.ts; scripts/test-torpedo.mjs fails if the two
// copies differ -- edit both together) ------------------------------------------------------------------------------

/** Torpedo starts from the ordinary chess start position. */
export const TORPEDO_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** The square a pawn of `color` standing on `from` may reach with a torpedo double step that chess.js does NOT already
 * generate, or null. chess.js covers the home-rank double step (rank 2 for White, rank 7 for Black), so this answers null
 * from there; from every other rank 2-7 it answers the square two ahead when both squares in front are empty. A White pawn
 * on rank 6 lands on rank 8 (a promotion), a Black pawn on rank 3 on rank 1. Never leaves the board: White from rank 7 and
 * Black from rank 2 have only the single step. */
export function torpedoExtraDoubleStep(from: string, color: PieceColor, isOccupied: (square: string) => boolean): string | null {
  if (from.length !== 2) return null;
  const rank = Number(from[1]);
  if (!(rank >= 2 && rank <= 7)) return null;
  const step = color === 'w' ? 1 : -1;
  const homeRank = color === 'w' ? 2 : 7;
  const target = rank + 2 * step;
  if (rank === homeRank || target < 1 || target > 8) return null;
  const file = from[0];
  return isOccupied(`${file}${rank + step}`) || isOccupied(`${file}${target}`) ? null : `${file}${target}`;
}

// --- End of the shared rules block --------------------------------------------------------------------------------

const PROMOTION_PIECES: ('q' | 'r' | 'b' | 'n')[] = ['q', 'r', 'b', 'n'];

/** Every legal Torpedo move for the side to move (optionally only those starting on `square`), including the torpedo double
 * steps and every promotion choice. Moves carry no SAN (nothing has been played); `captured` is filled in, including the
 * pawn taken en passant. Built from the engine's own getLegalMoves, so it is exactly what the board offers. */
export function getTorpedoMoves(engine: ChessEngine, square?: string): Move[] {
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
