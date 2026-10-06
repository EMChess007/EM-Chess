import type { Move } from './chess';
import type { CrazyhouseState } from '../logic/crazyhouse';
import type { SpellChessState } from '../logic/spellChess';

export interface GameHistoryEntry {
  move: Move;
  fenBefore: string;
  fenAfter: string;
  /** Duck Chess only — where the duck stood AFTER this ply (the second half of the turn). The duck before
   * the ply is the previous entry's duckSquare (none before White's first move), which is what Undo and
   * position review restore. Undefined in every other mode. */
  duckSquare?: string | null;
  /** Spell Chess only — charges/cooldowns/pending freeze+jump AFTER this ply (the state before is the
   * previous entry's spellState, or spellChess.initialSpellChessState() before White's first move) —
   * exactly the same "carried per ply, restored by Undo/position review" shape as duckSquare above.
   * Undefined in every other mode. */
  spellState?: SpellChessState;
  /** Crazyhouse only — reserves and promoted pieces AFTER this ply (the state before is the previous entry's, or
   * crazyhouse.initialCrazyhouseState() before the first move): the same "carried per ply, restored by Undo/position review"
   * shape as duckSquare/spellState. Undefined in every other mode. */
  crazyhouse?: CrazyhouseState;
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
