import type { GamePayload } from '../api/client';
import type { GameStatus, PieceColor } from '../types/chess';
import type { GameHistoryEntry } from '../types/history';
import type { TimeControl } from '../types/timeControl';
import { getGameOutcome } from './gameResult';
import { buildPgn } from './pgn';

interface BuildGamePayloadArgs {
  chessStatus: GameStatus;
  turn: PieceColor;
  timeoutWinner: PieceColor | null;
  resignedBy?: PieceColor | null;
  drawnByAgreement?: boolean;
  kingOfTheHillWinner?: PieceColor | null;
  threeCheckWinner?: PieceColor | null;
  fogOfWarWinner?: PieceColor | null;
  giveawayWinner?: PieceColor | null;
  /** Tags the saved PGN as Antichess so replay/analysis (which assume ordinary chess rules) refuse
   * it instead of mis-replaying a game whose moves aren't legal chess. */
  giveaway?: boolean;
  /** Atomic: the side that blew up the enemy king, if any (see atomic.ts). */
  atomicWinner?: PieceColor | null;
  /** Tags the saved PGN as Atomic for the same reason as `giveaway` above. */
  atomic?: boolean;
  /** Duck Chess: the side that captured the enemy king, if any (see duckChess.ts). */
  duckChessWinner?: PieceColor | null;
  /** Tags the saved PGN [Variant "Duck"] for the same reason as `giveaway`/`atomic` above. */
  duckChess?: boolean;
  history: GameHistoryEntry[];
  initialFen: string;
  chess960: boolean;
  timeControl: TimeControl;
  opponentType: 'bot' | 'human';
  opponentElo?: number | null;
}

/**
 * Builds the POST /games payload once a game has actually ended (and at least one move was
 * played) — null otherwise. Shared by every game screen so "is this game over, and with what
 * result" is computed the same way everywhere.
 */
export function buildGamePayload(args: BuildGamePayloadArgs): GamePayload | null {
  const outcome = getGameOutcome(
    args.chessStatus,
    args.turn,
    args.timeoutWinner,
    args.resignedBy ?? null,
    args.drawnByAgreement ?? false,
    args.kingOfTheHillWinner ?? null,
    args.threeCheckWinner ?? null,
    args.fogOfWarWinner ?? null,
    args.giveawayWinner ?? null,
    args.atomicWinner ?? null,
    args.duckChessWinner ?? null
  );
  if (!outcome.over || args.history.length === 0) return null;

  return {
    opponentType: args.opponentType,
    opponentElo: args.opponentElo ?? null,
    result: outcome.result,
    pgn: buildPgn(args.initialFen, args.history, outcome.result, args.giveaway ? 'Antichess' : args.atomic ? 'Atomic' : args.duckChess ? 'Duck' : undefined),
    timeControl: args.timeControl.label,
    isChess960: args.chess960,
  };
}
