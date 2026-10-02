import type { ChessEngine } from './ChessEngine';
import type { Move, PieceColor } from '../types/chess';

/**
 * Giveaway (Antichess) rules, layered on ChessEngine's pseudo-legal generator — the same
 * primitive Fog of War uses, for the same reason: chess.js's own legal-move filtering is all about
 * king safety, which does not exist here. The rules:
 *  - Captures are MANDATORY: if the side to move has any capture anywhere on the board, every
 *    non-capturing move is illegal that turn (globally, not per piece).
 *  - The king is an ordinary piece: it can be captured, there is no check/checkmate, and a pawn may
 *    promote to a king as well as the usual pieces.
 *  - You WIN the instant it is your turn and you have no legal move — no pieces left, or every
 *    remaining piece is blocked. Being stuck wins; it never loses or draws.
 *  - No castling (standard Antichess).
 *
 * The castling and king-promotion parts live in ChessEngine itself behind its "giveaway" option
 * (chess.js can't express them), so every engine used with this file MUST be constructed with
 * { giveaway: true, skipValidation: true } — skipValidation because a captured king makes later
 * strict FEN reloads fail ("missing king"), same as Fog of War.
 *
 * Mutually exclusive with every other variant. Like getKingOfTheHillWinner/getFogOfWarWinner, the
 * helpers here are only meant to be called when the game is actually being played in Giveaway
 * mode — nothing in ChessEngine.getStatus()/isGameOver() knows about any of these rules.
 */

/** Every legal Giveaway move for the side to move, optionally narrowed to those starting on
 * "square". The mandatory-capture collapse happens BEFORE the square filter on purpose: if any
 * piece on the board can capture, a piece with no capture of its own correctly has no legal moves
 * at all (rather than its quiet moves looking available). */
export function getGiveawayMoves(engine: ChessEngine, square?: string): Move[] {
  const all = engine.getPseudoLegalMoves(engine.getTurn());
  const capturing = all.filter((m) => m.captured);
  const legal = capturing.length > 0 ? capturing : all;
  return square ? legal.filter((m) => m.from === square) : legal;
}

/** The side that has just won, or null while the game goes on: whoever is to move wins the
 * instant they have no legal move at all. */
export function getGiveawayWinner(engine: ChessEngine): PieceColor | null {
  return getGiveawayMoves(engine).length === 0 ? engine.getTurn() : null;
}
