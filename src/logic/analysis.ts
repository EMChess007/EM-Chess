import type { AnalysisLine, EngineEvaluation } from '../engine/ChessEngine';
import type { Move, PieceColor, PieceType } from '../types/chess';
import { ChessEngine } from './ChessEngine';

export type MoveQuality =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'equal'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'missedWin';

const MATE_SCORE = 100000;

/**
 * Converts an engine evaluation (cp or mate, from the side-to-move's perspective) into a
 * single comparable centipawn-like number, preserving ordering (bigger = better for the side
 * to move). Mate scores are mapped far outside the normal centipawn range so "mate in 2" still
 * compares as better than "mate in 8", which in turn is still miles better than any cp score.
 */
export function evaluationToComparable(evaluation: EngineEvaluation): number {
  if (evaluation.type === 'cp') return evaluation.value;
  return evaluation.value > 0 ? MATE_SCORE - evaluation.value : -MATE_SCORE - evaluation.value;
}

/**
 * Re-expresses an evaluation given from the side-to-move's perspective (the UCI convention) as
 * White's perspective — the usual convention for a single displayed number, where "+0.8" always
 * means White is better regardless of whose move it is.
 */
export function toWhitePerspective(evaluation: EngineEvaluation, turnAtPosition: PieceColor): EngineEvaluation {
  if (turnAtPosition === 'w') return evaluation;
  return { type: evaluation.type, value: -evaluation.value };
}

export function formatEvaluation(evaluation: EngineEvaluation): string {
  if (evaluation.type === 'mate') {
    if (evaluation.value === 0) return '#';
    return evaluation.value > 0 ? `Mate in ${evaluation.value}` : `-Mate in ${Math.abs(evaluation.value)}`;
  }
  const pawns = evaluation.value / 100;
  const sign = pawns > 0 ? '+' : '';
  return `${sign}${pawns.toFixed(1)}`;
}

/** Compact form for tight spaces like the eval bar label: "+2.3", "-0.4", "M3", "-M3". */
export function formatEvaluationCompact(evaluation: EngineEvaluation): string {
  if (evaluation.type === 'mate') {
    if (evaluation.value === 0) return '#';
    return evaluation.value > 0 ? `M${evaluation.value}` : `-M${Math.abs(evaluation.value)}`;
  }
  const pawns = evaluation.value / 100;
  const sign = pawns > 0 ? '+' : '';
  return `${sign}${pawns.toFixed(1)}`;
}

/**
 * Converts a "comparable" cp value (see evaluationToComparable) into an approximate win
 * percentage for the side the value is expressed from, using the same logistic curve Lichess
 * publishes for its eval bar/accuracy calculations. Saturates smoothly toward 0/100 for huge
 * (mate-equivalent) values.
 */
export function evalToWinPercent(comparableCp: number): number {
  const clamped = Math.max(-10000, Math.min(10000, comparableCp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

/** White's fill share (0-100) for the eval bar. Real mates saturate to exactly 0/100 instead of
 * just "very close", per how chess.com/Lichess render a forced mate. */
export function evalToWhiteFillPercent(whitePerspectiveEvaluation: EngineEvaluation): number {
  if (whitePerspectiveEvaluation.type === 'mate') {
    if (whitePerspectiveEvaluation.value === 0) return 50;
    return whitePerspectiveEvaluation.value > 0 ? 100 : 0;
  }
  return evalToWinPercent(whitePerspectiveEvaluation.value);
}

// --- Move classification -------------------------------------------------

export interface ClassifyContext {
  /** MultiPV lines at the position before the move, mover's perspective, best-first. */
  linesBefore: AnalysisLine[];
  /** MultiPV lines at the position after the move, opponent's perspective, best-first. */
  linesAfter: AnalysisLine[];
  move: Move;
  moverColor: PieceColor;
  fenBefore: string;
  chess960: boolean;
  initialFen: string;
  isBook: boolean;
}

export interface MoveClassification {
  quality: MoveQuality;
  /** Win-probability points given up by this move, from the mover's perspective, clamped >= 0. */
  winPercentLoss: number;
  centipawnLoss: number;
  wasBestMove: boolean;
}

export const PIECE_VALUES: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/**
 * Heuristic-only "did the mover give up material on purpose" detector: the moved piece (not a
 * pawn) lands on a square the opponent attacks, and the net material handed over if recaptured
 * is at least ~2 points. This is a simplification (real sacrifice detection needs a full static
 * exchange evaluation across all attackers/defenders) — paired with "this was still the engine's
 * best move with near-zero eval loss" it's a reasonable proxy for "Brilliant", but can miss
 * genuine sacrifices or (rarely) flag a well-defended piece that isn't really at risk.
 */
function isLikelySacrifice(ctx: ClassifyContext): boolean {
  const { move, moverColor, fenBefore, chess960, initialFen } = ctx;
  if (move.promotion) return false;

  const before = new ChessEngine(fenBefore, { chess960, initialFen });
  const movedPiece = before.getPieceAt(move.from);
  if (!movedPiece || movedPiece.type === 'p' || movedPiece.type === 'k') return false;

  const capturedPiece = before.getPieceAt(move.to);
  const movedValue = PIECE_VALUES[movedPiece.type];
  const capturedValue = capturedPiece ? PIECE_VALUES[capturedPiece.type] : 0;
  if (movedValue - capturedValue < 2) return false;

  const after = new ChessEngine(fenBefore, { chess960, initialFen });
  if (!after.move(move.from, move.to, move.promotion)) return false;

  const opponentColor: PieceColor = moverColor === 'w' ? 'b' : 'w';
  return after.isSquareAttacked(move.to, opponentColor);
}

/** Classifies a single played move against the engine's multi-line analysis before/after it. */
export function classifyMove(ctx: ClassifyContext): MoveClassification {
  const zero = { winPercentLoss: 0, centipawnLoss: 0, wasBestMove: false };
  if (ctx.isBook) return { quality: 'book', ...zero };
  if (ctx.linesBefore.length === 0 || ctx.linesAfter.length === 0) return { quality: 'good', ...zero };

  const topBefore = ctx.linesBefore[0];
  const topAfter = ctx.linesAfter[0];

  const beforeCp = evaluationToComparable(topBefore.evaluation);
  const afterCpForMover = -evaluationToComparable(topAfter.evaluation);

  const winPctBefore = evalToWinPercent(beforeCp);
  const winPctAfter = evalToWinPercent(afterCpForMover);
  const winPercentLoss = Math.max(0, winPctBefore - winPctAfter);
  const centipawnLoss = Math.max(0, beforeCp - afterCpForMover);

  const playedUci = `${ctx.move.from}${ctx.move.to}${ctx.move.promotion ?? ''}`;
  const wasBestMove = topBefore.moves[0] === playedUci;
  const base = { winPercentLoss, centipawnLoss, wasBestMove };

  if (!wasBestMove && winPctBefore >= 90 && winPctAfter < 50) {
    return { quality: 'missedWin', ...base };
  }

  if (wasBestMove) {
    if (winPctBefore < 90 && isLikelySacrifice(ctx)) {
      return { quality: 'brilliant', ...base };
    }
    const secondBest = ctx.linesBefore[1];
    if (secondBest && winPctBefore > 20 && winPctBefore < 80) {
      const gap = beforeCp - evaluationToComparable(secondBest.evaluation);
      if (gap >= 150) return { quality: 'great', ...base };
    }
    return { quality: 'best', ...base };
  }

  if (Math.abs(winPctAfter - 50) <= 3 && winPercentLoss <= 5) {
    return { quality: 'equal', ...base };
  }
  if (winPercentLoss <= 2) return { quality: 'excellent', ...base };
  if (winPercentLoss <= 5) return { quality: 'good', ...base };
  if (winPercentLoss <= 10) return { quality: 'inaccuracy', ...base };
  if (winPercentLoss <= 20) return { quality: 'mistake', ...base };
  return { quality: 'blunder', ...base };
}

// --- Opening book (small, hardcoded placeholder) --------------------------

// A deliberately small set of well-known main lines — enough to tag the first few moves of the
// most common openings as "Book" rather than judging them against engine eval, without building
// (or shipping) a real opening database. Anything not in this list just falls through to normal
// engine-based classification, which is a perfectly fine fallback for opening moves too.
const OPENING_BOOK_LINES: string[][] = [
  ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'],
  ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'],
  ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
  ['e4', 'e5', 'Nf3', 'Nc6'],
  ['e4', 'e5', 'Nf3'],
  ['e4', 'e5'],
  ['e4', 'c5', 'Nf3', 'd6'],
  ['e4', 'c5', 'Nf3'],
  ['e4', 'c5'],
  ['e4', 'e6', 'd4', 'd5'],
  ['e4', 'e6'],
  ['e4', 'c6', 'd4', 'd5'],
  ['e4', 'c6'],
  ['e4', 'd5'],
  ['e4', 'Nf6', 'e5', 'Nd5'],
  ['e4', 'Nf6'],
  ['d4', 'd5', 'c4', 'e6'],
  ['d4', 'd5', 'c4', 'c6'],
  ['d4', 'd5', 'c4'],
  ['d4', 'd5', 'Nf3', 'Nf6', 'c4'],
  ['d4', 'd5', 'Bf4'],
  ['d4', 'd5'],
  ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7'],
  ['d4', 'Nf6', 'c4', 'g6'],
  ['d4', 'Nf6', 'c4', 'e6'],
  ['d4', 'Nf6', 'Nf3', 'g6'],
  ['d4', 'Nf6'],
  ['Nf3', 'd5', 'g3'],
  ['Nf3', 'Nf6', 'c4'],
  ['Nf3'],
  ['c4', 'e5'],
  ['c4'],
];

const BOOK_MAX_PLIES = 8;

function stripSanDecorations(san: string): string {
  return san.replace(/[+#!?]+$/g, '');
}

/** Whether the move at `plyIndex` (0-indexed) is still known opening theory. Never true for
 * Chess960 (a fixed classical-opening book doesn't apply to a randomized starting position). */
export function isBookMove(sanHistorySoFar: string[], plyIndex: number, chess960: boolean): boolean {
  if (chess960 || plyIndex >= BOOK_MAX_PLIES) return false;
  const played = sanHistorySoFar.slice(0, plyIndex + 1).map(stripSanDecorations);
  return OPENING_BOOK_LINES.some(
    (line) => line.length >= played.length && played.every((san, i) => stripSanDecorations(line[i]) === san)
  );
}

// --- Display metadata -------------------------------------------------

export const MOVE_QUALITY_SYMBOLS: Record<MoveQuality, string> = {
  brilliant: '!!',
  great: '!',
  best: '★',
  excellent: '👍',
  good: '✓',
  book: '📖',
  equal: '=',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
  missedWin: '✕',
};

export const MOVE_QUALITY_LABELS: Record<MoveQuality, string> = {
  brilliant: 'Brilliant move',
  great: 'Great move',
  best: 'Best move',
  excellent: 'Excellent',
  good: 'Good',
  book: 'Opening theory',
  equal: 'Balanced position',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
  missedWin: 'Missed win',
};

export const MOVE_QUALITY_COLORS: Record<MoveQuality, string> = {
  brilliant: '#1abc9c',
  great: '#3498db',
  best: '#2e7d32',
  excellent: '#4caf50',
  good: '#8bc34a',
  book: '#8d6e63',
  equal: '#9e9e9e',
  inaccuracy: '#f2b705',
  mistake: '#fb8c00',
  blunder: '#e53935',
  missedWin: '#c62828',
};
