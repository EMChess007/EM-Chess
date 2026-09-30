import type { PieceColor } from '../types/chess';

/** Number of times a side must have delivered check to win outright in Three-Check mode. */
export const THREE_CHECK_TARGET = 3;

/** Only the field these functions actually need — deliberately looser than this app's own `Move`
 * type so callers can pass anything with a SAN, including a spectator's plain `{ san }` move rows
 * which don't carry a `from`/`to`. */
interface SanMove {
  san: string;
}

function moveGaveCheck(move: SanMove): boolean {
  return move.san.endsWith('+') || move.san.endsWith('#');
}

/** How many times each side has delivered check so far, counted from the game's own move list
 * (chess.js already marks every checking move's SAN with a trailing '+' or '#') rather than kept
 * as separate mutable state — so it's automatically correct after Undo too (which just shortens
 * the move list passed in), without needing any decrement logic of its own. Moves strictly
 * alternate starting with White (same assumption computeCapturedMaterial already relies on), so
 * the mover is derived from each move's index rather than needing the position it was played from. */
export function getThreeCheckCounts(moves: SanMove[]): Record<PieceColor, number> {
  const counts: Record<PieceColor, number> = { w: 0, b: 0 };
  moves.forEach((move, i) => {
    if (moveGaveCheck(move)) counts[i % 2 === 0 ? 'w' : 'b']++;
  });
  return counts;
}

/** Whether either side has delivered check THREE_CHECK_TARGET times — callers only check this
 * when the game is actually being played in Three-Check mode, same convention as
 * getKingOfTheHillWinner. */
export function getThreeCheckWinner(moves: SanMove[]): PieceColor | null {
  const counts = getThreeCheckCounts(moves);
  if (counts.w >= THREE_CHECK_TARGET) return 'w';
  if (counts.b >= THREE_CHECK_TARGET) return 'b';
  return null;
}
