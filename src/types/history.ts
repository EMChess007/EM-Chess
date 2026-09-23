import type { Move } from './chess';

export interface GameHistoryEntry {
  move: Move;
  fenBefore: string;
  fenAfter: string;
}

export interface AnalyzeParams {
  initialFen: string;
  chess960: boolean;
  history: GameHistoryEntry[];
}
