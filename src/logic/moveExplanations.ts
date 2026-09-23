import type { EngineEvaluation } from '../engine/ChessEngine';
import type { Move, PieceColor, PieceType } from '../types/chess';
import { PIECE_VALUES, type MoveQuality } from './analysis';
import { ChessEngine } from './ChessEngine';
import { parseUciMove } from './uciMove';

export interface ExplanationContext {
  fenBefore: string;
  fenAfter: string;
  move: Move;
  moverColor: PieceColor;
  quality: MoveQuality;
  /** Evaluation before the move, from the mover's own perspective (positive = good for mover). */
  evalBeforeForMover: EngineEvaluation;
  /** Evaluation after the move, from the mover's own perspective. */
  evalAfterForMover: EngineEvaluation;
  /** Win-probability-derived centipawn-equivalent loss for this move (see analysis.ts). */
  centipawnLoss: number;
  /** The engine's best move at the position before, in SAN — null if the played move already was it. */
  bestMoveSan: string | null;
  /** The engine's top reply (UCI) at the position right after this move — used to detect an
   * immediate, unanswered capture (a "hanging piece"). Null if unavailable. */
  bestOpponentReplyUci: string | null;
  chess960: boolean;
  initialFen: string;
}

// --- Piece names ----------------------------------------------------
// Two separate maps (rather than one) so templates can be written either as the object of a
// verb/preposition ("left your queen hanging") or as the subject of a sentence ("the knight
// forks two pieces") without ever needing to inflect a piece name inline — a leftover of the
// original Greek version's noun-case handling, kept as-is since English happens to need only
// one form either way, avoiding an unnecessary refactor of every template below.

const PIECE_ACCUSATIVE: Record<PieceType, string> = {
  p: 'your pawn',
  n: 'your knight',
  b: 'your bishop',
  r: 'your rook',
  q: 'your queen',
  k: 'your king',
};

const PIECE_NOMINATIVE: Record<PieceType, string> = {
  p: 'the pawn',
  n: 'the knight',
  b: 'the bishop',
  r: 'the rook',
  q: 'the queen',
  k: 'the king',
};

// --- Deterministic template selection --------------------------------------
// A small djb2-style hash (same approach as getDailyPuzzle in puzzles.ts) seeded by the move
// itself, so the SAME move always gets the SAME phrasing — this reads as "randomized" across
// different moves in a game (satisfying "don't repeat the exact same sentence"), without
// the phrasing flickering to a different random choice every time this screen re-renders while
// re-computing unrelated data (e.g. while background analysis of other positions is still running).

function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return hash >>> 0;
}

function pick(templates: string[], seed: string): string {
  return templates[hashString(seed) % templates.length];
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => vars[key] ?? '');
}

// --- Tactic detection (chess.js-backed, via ChessEngine) -------------------

/**
 * Whether the engine's own best reply right after this move captures one of the mover's pieces
 * — a strong, cheap signal for "you left something hanging", grounded in what the engine
 * actually says it would do next rather than a hand-rolled attack scan.
 */
function detectHangingPiece(ctx: ExplanationContext): { pieceType: PieceType; square: string } | null {
  if (!ctx.bestOpponentReplyUci) return null;
  const parsed = parseUciMove(ctx.bestOpponentReplyUci);
  if (!parsed) return null;

  const after = new ChessEngine(ctx.fenAfter, { chess960: ctx.chess960, initialFen: ctx.initialFen });
  const captured = after.getPieceAt(parsed.to);
  if (!captured || captured.color !== ctx.moverColor) return null;

  return { pieceType: captured.type, square: parsed.to };
}

/** Whether, right after this move, some single opponent piece can legally reach 2+ squares
 * occupied by the mover's minor-or-better pieces — a fork. */
function detectFork(ctx: ExplanationContext): { attackerType: PieceType } | null {
  const after = new ChessEngine(ctx.fenAfter, { chess960: ctx.chess960, initialFen: ctx.initialFen });
  const opponentColor: PieceColor = ctx.moverColor === 'w' ? 'b' : 'w';
  const board = after.getBoard().flat();

  const valuableMoverSquares = board
    .filter((sq) => sq.piece && sq.piece.color === ctx.moverColor && PIECE_VALUES[sq.piece.type] >= 3)
    .map((sq) => sq.square);
  if (valuableMoverSquares.length < 2) return null;

  for (const sq of board) {
    if (!sq.piece || sq.piece.color !== opponentColor) continue;
    const targets = after.getLegalMoves(sq.square).filter((t) => valuableMoverSquares.includes(t));
    if (targets.length >= 2) {
      return { attackerType: sq.piece.type };
    }
  }
  return null;
}

function findKingSquare(engine: ChessEngine, color: PieceColor): string | null {
  const found = engine.getBoard().flat().find((sq) => sq.piece?.type === 'k' && sq.piece.color === color);
  return found?.square ?? null;
}

function adjacentSquares(square: string): string[] {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1], 10) - 1;
  const result: string[] = [];
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const f = file + df;
      const r = rank + dr;
      if (f < 0 || f > 7 || r < 0 || r > 7) continue;
      result.push(`${String.fromCharCode(97 + f)}${r + 1}`);
    }
  }
  return result;
}

function countKingShield(engine: ChessEngine, kingSquare: string, color: PieceColor): number {
  return adjacentSquares(kingSquare).filter((sq) => engine.getPieceAt(sq)?.color === color).length;
}

/** Whether this move reduced the number of the mover's own pawns/pieces immediately around
 * their own king, leaving it comparatively bare (a rough, cheap king-safety proxy). */
function detectKingSafetyDrop(ctx: ExplanationContext): boolean {
  const before = new ChessEngine(ctx.fenBefore, { chess960: ctx.chess960, initialFen: ctx.initialFen });
  const after = new ChessEngine(ctx.fenAfter, { chess960: ctx.chess960, initialFen: ctx.initialFen });

  const kingBefore = findKingSquare(before, ctx.moverColor);
  const kingAfter = findKingSquare(after, ctx.moverColor);
  if (!kingBefore || !kingAfter) return false;

  const shieldBefore = countKingShield(before, kingBefore, ctx.moverColor);
  const shieldAfter = countKingShield(after, kingAfter, ctx.moverColor);
  return shieldAfter < shieldBefore && shieldAfter <= 2;
}

// --- Templates --------------------------------------------------------------

const BRILLIANT_TEMPLATES = [
  'Brilliant move! You sacrificed {piece}, but your position remains the best possible — a non-obvious choice that shows real depth of calculation.',
  'Impressive! This sacrifice isn\'t obvious at first glance, but the engine confirms {moveSan} is the strongest move in the position.',
  'A rare move: you gave up material for something more important — exactly what a very strong player would play here.',
  'A very strong sacrifice! Most players wouldn\'t find {moveSan} here, but it\'s objectively the best move in the position.',
];

const GREAT_TEMPLATES = [
  'Very strong move! {moveSan} is clearly better than the alternatives — keep this level up.',
  'Excellent choice, with a large gap over the second-best move in the position.',
  'A powerful strike — your position improved noticeably with {moveSan}.',
  'Very good move! Few players would find anything better here.',
];

const BEST_TEMPLATES = [
  'The best possible move in the position — exactly what the engine would play.',
  'Correct choice! No other move was better than {moveSan} here.',
  'You found the top move in the position.',
  'Right on target! {moveSan} was the optimal move according to the analysis.',
];

const EXCELLENT_TEMPLATES = [
  'Very close to the best move — barely any evaluation loss.',
  'Excellent move, nearly perfect.',
  'Very good choice, with only a tiny gap from the optimal move.',
  'A strong move that keeps your position on a very good track.',
];

const GOOD_TEMPLATES = [
  'Good move, keeps a solid position.',
  'A sensible choice, without any serious problems.',
  'A satisfactory move — the position stays healthy.',
  'A decent move, without giving up any ground.',
];

const BOOK_TEMPLATES = [
  'Known opening theory.',
  'This move follows established theory.',
  'A standard opening move — a safe choice.',
];

const EQUAL_TEMPLATES = [
  'The position remains balanced after this move.',
  'A calm position — neither side has a clear advantage here.',
  'A balanced continuation, without much risk.',
];

const HANGING_PIECE_TEMPLATES = [
  'You left {piece} on {square} undefended — your opponent can take it for free.',
  'This move leaves {piece} exposed there; your opponent threatens to win it for nothing.',
  'Watch out: {piece} on {square} is left uncovered after this move.',
  'You forgot to protect {piece} — an expected loss of material on {square}.',
];

const FORK_TEMPLATES = [
  'This allowed a fork: your opponent\'s {attacker} threatens two of your pieces at once.',
  'Your opponent gets a fork — {attacker} splits two of your pieces.',
  'After this move, your opponent\'s {attacker} hits two targets at once.',
  'Watch out for the fork: {attacker} threatens two of your pieces at once.',
];

const KING_SAFETY_TEMPLATES = [
  'This move weakened your king\'s safety — fewer pieces protect it now.',
  'Your king was left more exposed after this move.',
  'The shield around your king was weakened — watch for incoming threats.',
  'This move opens lines toward your king, reducing its safety.',
];

const GENERIC_TEMPLATES: Record<'inaccuracy' | 'mistake' | 'blunder' | 'missedWin', string[]> = {
  inaccuracy: [
    'A small inaccuracy: {bestMoveSan} would have been a slightly more precise choice (about {pawns} points difference).',
    'Not the most precise move — {bestMoveSan} would have kept a bit more from the position.',
    'Slightly inaccurate; the difference is small (~{pawns} points) but {bestMoveSan} was better.',
  ],
  mistake: [
    'This move lost about {pawns} evaluation points compared to the best choice, {bestMoveSan}.',
    'There was a better move here: {bestMoveSan} would have kept {pawns} more points of evaluation.',
    'The position got noticeably worse (~{pawns} points) — {bestMoveSan} was a more precise choice.',
    'A miscalculation; {bestMoveSan} was clearly a better move in this position.',
  ],
  blunder: [
    'Serious mistake — the position got worse by about {pawns} points. {bestMoveSan} was much better.',
    'This was costly: about {pawns} evaluation points were lost compared to {bestMoveSan}.',
    'A big blunder — {bestMoveSan} would have kept your position in much better shape.',
    'A large drop in evaluation (~{pawns} points); {bestMoveSan} was the move needed here.',
  ],
  missedWin: [
    'You had a winning position, but this move let your opponent off the hook.',
    'Missed opportunity: there was a decisive advantage with {bestMoveSan}.',
    'The position was decisively yours, but this move brought it back to balance.',
    'You were letting a nearly winning position slip here — {bestMoveSan} would have kept the advantage.',
  ],
};

// --- Public API ---------------------------------------------------------

/**
 * Produces a short, rule-based (no external AI/API) explanation of why a played move got the
 * quality it did, using only data we already compute during analysis (engine eval before/after,
 * the classified quality, the engine's best alternative) plus a few cheap chess.js-backed
 * tactical checks (hanging piece / fork / weakened king) for the bad-move case.
 */
export function generateExplanation(ctx: ExplanationContext): string {
  const seed = `${ctx.fenBefore}|${ctx.move.from}${ctx.move.to}${ctx.move.promotion ?? ''}`;
  const moveSan = ctx.move.san;

  switch (ctx.quality) {
    case 'brilliant': {
      const before = new ChessEngine(ctx.fenBefore, { chess960: ctx.chess960, initialFen: ctx.initialFen });
      const movedPiece = before.getPieceAt(ctx.move.from);
      return fill(pick(BRILLIANT_TEMPLATES, seed), { piece: movedPiece ? PIECE_ACCUSATIVE[movedPiece.type] : 'material', moveSan });
    }
    case 'great':
      return fill(pick(GREAT_TEMPLATES, seed), { moveSan });
    case 'best':
      return fill(pick(BEST_TEMPLATES, seed), { moveSan });
    case 'excellent':
      return pick(EXCELLENT_TEMPLATES, seed);
    case 'good':
      return pick(GOOD_TEMPLATES, seed);
    case 'book':
      return pick(BOOK_TEMPLATES, seed);
    case 'equal':
      return pick(EQUAL_TEMPLATES, seed);
    case 'inaccuracy':
    case 'mistake':
    case 'blunder':
    case 'missedWin':
      return explainSuboptimalMove(ctx, seed);
  }
}

function explainSuboptimalMove(ctx: ExplanationContext, seed: string): string {
  const hanging = detectHangingPiece(ctx);
  if (hanging) {
    return fill(pick(HANGING_PIECE_TEMPLATES, seed), {
      piece: PIECE_ACCUSATIVE[hanging.pieceType],
      square: hanging.square,
    });
  }

  const fork = detectFork(ctx);
  if (fork) {
    return fill(pick(FORK_TEMPLATES, seed), { attacker: PIECE_NOMINATIVE[fork.attackerType] });
  }

  if (detectKingSafetyDrop(ctx)) {
    return pick(KING_SAFETY_TEMPLATES, seed);
  }

  const pawns = Math.min(ctx.centipawnLoss / 100, 15).toFixed(1);
  const quality = ctx.quality === 'inaccuracy' || ctx.quality === 'mistake' || ctx.quality === 'blunder' || ctx.quality === 'missedWin' ? ctx.quality : 'mistake';
  return fill(pick(GENERIC_TEMPLATES[quality], seed), {
    pawns,
    bestMoveSan: ctx.bestMoveSan ?? 'another move',
  });
}
