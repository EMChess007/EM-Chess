import type { PieceShapeType } from '../components/pieceArt';
import type { Move, PieceColor, PieceType } from '../types/chess';
import type { ChessEngine } from './ChessEngine';
import { kmApply, kmLegalMoves, kmOnlyRoyalKnight, kmParseFen, kmSan, kmSquareName } from './knightmate';

/** The picture a Knightmate piece is drawn from: the royal knight is the theme's KNIGHT, the commoner the theme's KING (Piece.tsx adds the badge that tells them from the real ones). */
export function knightmateShape(type: PieceType): PieceShapeType {
  if (type === 'k') return 'n';
  if (type === 'm') return 'k';
  return type;
}

/** Every legal move of the side to move in a Knightmate engine, as app Moves (SAN included; a promotion appears once per choice: q, r, b, m). */
export function getKnightmateMoves(engine: ChessEngine, square?: string): Move[] {
  const pos = kmParseFen(engine.getFen());
  const legal = kmLegalMoves(pos);
  return legal
    .filter((m) => square === undefined || kmSquareName(m.from) === square)
    .map((m) => {
      const next = kmApply(pos, m);
      return {
        from: kmSquareName(m.from),
        to: kmSquareName(m.to),
        promotion: m.promotion,
        san: kmSan(pos, m, legal, next.position),
        captured: next.captured,
      };
    });
}

/**
 * Knightmate's clock rule for the game screens (the rule itself is knightmate.kmTimeoutResult). `timeoutWinner` is what useChessClock reports:
 * the side whose opponent's flag fell. When that winner holds ONLY its royal knight the game is a DRAW instead (it could never have mated);
 * otherwise the flagged side loses as in every mode. Read off the position's FEN so it is right after Undo too.
 * Returns the two values to hand to getGameOutcome / buildGamePayload: the winner (null for a draw or no flag) and the draw flag.
 */
export function knightmateTimeoutOutcome(fen: string, timeoutWinner: PieceColor | null): { timeoutDraw: boolean; timeoutWinner: PieceColor | null } {
  if (!timeoutWinner) return { timeoutDraw: false, timeoutWinner: null };
  return kmOnlyRoyalKnight(kmParseFen(fen), timeoutWinner) ? { timeoutDraw: true, timeoutWinner: null } : { timeoutDraw: false, timeoutWinner };
}
