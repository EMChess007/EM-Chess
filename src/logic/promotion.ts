import type { Piece, PieceColor } from '../types/chess';

export type PromotionPiece = 'q' | 'r' | 'b' | 'n' | 'k';

/** Display order of the promotion picker — queen first since it's by far the most common choice. */
export const PROMOTION_CHOICES: readonly PromotionPiece[] = ['q', 'r', 'b', 'n'];

/** Giveaway (Antichess) additionally lets a pawn promote to a king — see giveaway.ts. */
export const GIVEAWAY_PROMOTION_CHOICES: readonly PromotionPiece[] = ['q', 'r', 'b', 'n', 'k'];

/** The picker's options for the current game mode. */
export function getPromotionChoices(giveaway: boolean): readonly PromotionPiece[] {
  return giveaway ? GIVEAWAY_PROMOTION_CHOICES : PROMOTION_CHOICES;
}

export const PROMOTION_LABELS: Record<PromotionPiece, string> = {
  q: 'Queen',
  r: 'Rook',
  b: 'Bishop',
  n: 'Knight',
  k: 'King',
};

/** The rank a pawn of `color` promotes on. */
export function promotionRank(color: PieceColor): '8' | '1' {
  return color === 'w' ? '8' : '1';
}

/**
 * Whether moving `piece` to `toSquare` is a promotion — i.e. a pawn arriving on its last rank, by a
 * plain push or a capture alike (this only looks at the destination, so both cases are covered by
 * the same check and neither can be missed independently). The caller must ask the human player
 * which piece to promote to before completing the move; engine/bot moves already carry their own
 * explicit choice and never go through this.
 */
export function isPromotionMove(piece: Pick<Piece, 'type' | 'color'> | null | undefined, toSquare: string): boolean {
  if (!piece || piece.type !== 'p') return false;
  return toSquare[1] === promotionRank(piece.color);
}
