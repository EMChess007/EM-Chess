import type { UciChessEngine } from '../engine/ChessEngine';
import { classifyMove, isBookMove, type MoveQuality } from './analysis';
import { ChessEngine } from './ChessEngine';
import type { PieceColor } from '../types/chess';
import type { GameHistoryEntry } from '../types/history';

// Deliberately much faster than Analysis mode's own per-position budget (1000ms/3 lines) — a
// finished game can be dozens of plies long, and this needs to stay a "few seconds" popup, not a
// full move-by-move deep dive (that's what Game Review/AnalysisScreen is for). Two lines is still
// enough for classifyMove's "great move" branch (which wants a 2nd-best line when available) —
// it already degrades gracefully to just using the top line if a 2nd isn't there.
const MOVETIME_MS = 250;
const MULTI_PV = 2;

export interface PlayerGameStats {
  /** 0-100, higher is better — see accuracyFromLosses for the formula. */
  accuracy: number;
  qualityCounts: Partial<Record<MoveQuality, number>>;
}

export interface GameAnalysisSummary {
  white: PlayerGameStats;
  black: PlayerGameStats;
}

// Lichess-style conversion from a move's win-probability loss to a 0-100 accuracy contribution —
// the same exponential-decay shape their own accuracy calculation publishes, so "lower average
// win% loss -> higher accuracy%" behaves the way players already expect from other chess sites,
// without needing to match any site bit-for-bit.
function moveAccuracy(winPercentLoss: number): number {
  const raw = 103.1668 * Math.exp(-0.04354 * winPercentLoss) - 3.1669;
  return Math.max(0, Math.min(100, raw));
}

function accuracyFromLosses(losses: number[]): number {
  if (losses.length === 0) return 100;
  const avg = losses.reduce((sum, loss) => sum + moveAccuracy(loss), 0) / losses.length;
  return Math.round(avg * 10) / 10;
}

/**
 * Runs the same per-position engine analysis + classifyMove pipeline AnalysisScreen uses (see
 * that screen for the original, move-by-move version of this loop), condensed into per-player
 * accuracy% and a move-quality tally — for the post-game summary popup, not a full review.
 */
export async function computeGameSummary(
  initialFen: string,
  chess960: boolean,
  history: GameHistoryEntry[],
  engine: UciChessEngine,
  onProgress?: (done: number, total: number) => void,
  // Fog of War only — see AnalyzeParams's own doc comment: the final position can genuinely be
  // missing the losing side's king, which the construction below needs skipValidation for.
  fogOfWar = false
): Promise<GameAnalysisSummary> {
  const positions = [initialFen, ...history.map((h) => h.fenAfter)];
  const sanHistory = history.map((h) => h.move.san);
  const evaluations: Awaited<ReturnType<UciChessEngine['analyzePosition']>>[] = [];

  for (let i = 0; i < positions.length; i++) {
    const positionEngine = new ChessEngine(positions[i], { chess960, initialFen, skipValidation: fogOfWar });
    const result = positionEngine.isGameOver()
      ? {
          lines: [
            {
              evaluation:
                positionEngine.getStatus() === 'checkmate'
                  ? ({ type: 'mate', value: 0 } as const)
                  : ({ type: 'cp', value: 0 } as const),
              moves: [],
            },
          ],
        }
      : await engine.analyzePosition(positions[i], { movetimeMs: MOVETIME_MS, multiPv: MULTI_PV });
    evaluations.push(result);
    onProgress?.(i + 1, positions.length);
  }

  const losses: Record<PieceColor, number[]> = { w: [], b: [] };
  const qualityCounts: Record<PieceColor, Partial<Record<MoveQuality, number>>> = { w: {}, b: {} };

  history.forEach((entry, i) => {
    const before = evaluations[i];
    const after = evaluations[i + 1];
    if (!before || !after) return;

    const moverColor: PieceColor = i % 2 === 0 ? 'w' : 'b';
    const classification = classifyMove({
      linesBefore: before.lines,
      linesAfter: after.lines,
      move: entry.move,
      moverColor,
      fenBefore: entry.fenBefore,
      chess960,
      initialFen,
      isBook: isBookMove(sanHistory, i, chess960),
    });

    losses[moverColor].push(classification.winPercentLoss);
    const counts = qualityCounts[moverColor];
    counts[classification.quality] = (counts[classification.quality] ?? 0) + 1;
  });

  return {
    white: { accuracy: accuracyFromLosses(losses.w), qualityCounts: qualityCounts.w },
    black: { accuracy: accuracyFromLosses(losses.b), qualityCounts: qualityCounts.b },
  };
}
