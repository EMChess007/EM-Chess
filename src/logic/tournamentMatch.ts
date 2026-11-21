import type { MatchFoundPayload, OnlineTimeControl, TournamentVariantFlags } from '../types/multiplayer';
import type { PieceColor } from '../types/chess';
import { completeVariantFlags } from './onlineVariants';

/** What both tournament entry points (tournament_match_ready and the Standings screen's "Play now") know about an active match. */
export interface TournamentMatchSource extends Partial<TournamentVariantFlags> {
  roomId: string;
  color: PieceColor;
  playerToken: string;
  timeControl: OnlineTimeControl;
  fen: string;
  whiteMs: number;
  blackMs: number;
  visibleSquares?: string[];
}

/**
 * A tournament match IS an ordinary game room of the tournament's variant, so it enters through the same MatchFoundPayload as a Quick Match
 * (and OnlineGameScreen then opens the right board from the flags). The flags are the tournament's own, completed to the full record via
 * the SAME mapping the queue uses (variantWireFlags) - never a per-variant `false` list.
 */
export function tournamentMatchToGame(source: TournamentMatchSource, opponent: { userId: string | null }): MatchFoundPayload {
  const { roomId, color, playerToken, timeControl, fen, whiteMs, blackMs, visibleSquares } = source;
  return {
    roomId,
    color,
    playerToken,
    opponent,
    timeControl,
    ...completeVariantFlags(source),
    fen,
    whiteMs,
    blackMs,
    ...(visibleSquares ? { visibleSquares } : {}),
  };
}
