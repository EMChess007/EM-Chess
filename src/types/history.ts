import type { Move } from './chess';

export interface GameHistoryEntry {
  move: Move;
  fenBefore: string;
  fenAfter: string;
  /** Duck Chess only — where the duck stood AFTER this ply (the second half of the turn). The duck before
   * the ply is the previous entry's duckSquare (none before White's first move), which is what Undo and
   * position review restore. Undefined in every other mode. */
  duckSquare?: string | null;
}

export interface AnalyzeParams {
  initialFen: string;
  chess960: boolean;
  /** Fog of War only — a finished Fog of War game's final fenAfter genuinely has no king for the
   * losing side (it was captured, not just redacted), which every ChessEngine construction
   * downstream of this (AnalysisScreen, gameSummary.ts, moveExplanations.ts) needs to pass
   * skipValidation for. False for every other variant, which never produces a king-missing fen. */
  fogOfWar: boolean;
  history: GameHistoryEntry[];
}
