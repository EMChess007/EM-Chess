import type { BotCategory, BotPersonality } from '../types/bot';
import type { Move } from '../types/chess';
import type { TimeControl } from '../types/timeControl';
import { PIECE_VALUES } from './analysis';
import { ChessEngine } from './ChessEngine';
import { applyAtomicMove, generateAtomicMoves, getAtomicKingWinner, isAtomicCheck, squareName, type AtomicMove, type AtomicPosition } from './atomic';
import { getGiveawayMoves } from './giveaway';

export const BOT_CATEGORIES: { category: BotCategory; label: string }[] = [
  { category: 'absoluteBeginner', label: 'Kid / Absolute Beginner' },
  { category: 'beginner', label: 'Beginner' },
  { category: 'intermediate', label: 'Intermediate' },
  { category: 'advanced', label: 'Advanced' },
  { category: 'expert', label: 'Expert' },
  { category: 'strong', label: 'Strong' },
  { category: 'grandmaster', label: 'Grandmaster Level' },
];

export const BOT_PERSONALITIES: BotPersonality[] = [
  { id: 'kiddo', name: 'Kiddo', elo: 400, category: 'absoluteBeginner' },
  { id: 'toddler', name: 'Toddler', elo: 600, category: 'absoluteBeginner' },

  { id: 'student', name: 'Student', elo: 800, category: 'beginner' },
  { id: 'apprentice', name: 'Apprentice', elo: 1000, category: 'beginner' },

  { id: 'amateur', name: 'Amateur', elo: 1200, category: 'intermediate' },
  { id: 'neighbor', name: 'The Neighbor', elo: 1400, category: 'intermediate' },

  { id: 'clubber', name: 'Club Player', elo: 1600, category: 'advanced' },
  { id: 'schoolChamp', name: 'School Champion', elo: 1800, category: 'advanced' },

  { id: 'veteran', name: 'Veteran', elo: 2000, category: 'expert' },
  { id: 'teacher', name: 'The Teacher', elo: 2200, category: 'expert' },

  { id: 'maestro', name: 'Maestro', elo: 2400, category: 'strong' },
  { id: 'overlord', name: 'Overlord', elo: 2600, category: 'strong' },

  { id: 'legend', name: 'Legend', elo: 2800, category: 'grandmaster' },
  { id: 'unbeatable', name: 'The Unbeatable', elo: 3000, category: 'grandmaster' },
];

export function getBotsByCategory(category: BotCategory): BotPersonality[] {
  return BOT_PERSONALITIES.filter((bot) => bot.category === category);
}

export interface BotThinkTimeOptions {
  timeControl: TimeControl;
  /** The bot's own remaining clock time, in seconds (ignored for daily/unlimited). */
  remainingSeconds: number;
  /** Legal move count in the current position — an optional, cheap "how sharp is this
   * position" proxy; more options on the board nudges thinking time up a little, fewer
   * nudges it down. Omit to skip this adjustment entirely. */
  legalMoveCount?: number;
  /** Injectable for deterministic tests; defaults to Math.random. */
  rng?: () => number;
}

// Per-category "how long would a bot plausibly think" range, in ms — mirrors the pacing of
// chess.com's bots (bullet reacts almost instantly, rapid visibly "thinks").
const CATEGORY_THINK_RANGE_MS: Partial<Record<TimeControl['category'], [number, number]>> = {
  bullet: [300, 1500],
  blitz: [1000, 4000],
  rapid: [2000, 10000],
};

// Safety rails so the bot can never lose on time because of its own "thinking" delay.
const MAX_PERCENT_OF_REMAINING_RANGE: [number, number] = [0.05, 0.08];
const LOW_TIME_THRESHOLD_MS = 5000;
const LOW_TIME_MAX_THINK_MS = 900;
const MIN_THINK_MS = 100;
const SAFETY_BUFFER_MS = 300;

function randomInRange(min: number, max: number, rng: () => number): number {
  if (max <= min) return min;
  return min + rng() * (max - min);
}

/** Scales a base thinking time by position complexity: more legal moves for the side to move
 * nudges thinking time up a bit, very few nudges it down — a light touch, not a real "is this
 * tactical" analysis. */
function complexityFactor(legalMoveCount: number | undefined): number {
  if (legalMoveCount === undefined) return 1;
  return Math.max(0.85, Math.min(1.25, 0.85 + legalMoveCount / 80));
}

/**
 * How long (ms) the bot should actually spend "thinking" on its next move — used both as the
 * UI delay (via the engine's own `movetime`) and as the amount of real time deducted from the
 * bot's own clock (see BotGameScreen), so a bot never appears to think without its clock
 * reflecting it. Applies uniformly to every bot personality/ELO and to both classical and
 * Chess960 games — this is the one function BotGameScreen calls regardless of which.
 *
 * For "daily"/"unlimited" (no live countdown), there's no time pressure to model, so this just
 * returns a fixed, pleasant "thinking" pause for UI pacing.
 */
export function getBotThinkTimeMs({ timeControl, remainingSeconds, legalMoveCount, rng = Math.random }: BotThinkTimeOptions): number {
  const range = CATEGORY_THINK_RANGE_MS[timeControl.category];
  if (!range) {
    return Math.round(randomInRange(800, 1500, rng));
  }

  const remainingMs = Math.max(0, remainingSeconds * 1000);
  let thinkMs: number;

  // Fairness floor: with very little time left, think almost instantly — never risk losing on
  // time because of our own "let's pretend to think" delay. The same principle (don't let our
  // own overhead cost either side time unfairly) is why the human's clock only ever runs while
  // it's actually their turn, with no extra delay added anywhere in the move pipeline.
  if (remainingMs <= LOW_TIME_THRESHOLD_MS) {
    const ceiling = Math.min(LOW_TIME_MAX_THINK_MS, remainingMs * 0.3);
    const floor = Math.min(MIN_THINK_MS, ceiling / 2);
    thinkMs = randomInRange(floor, ceiling, rng);
  } else {
    const [rangeMin, rangeMax] = range;
    const desired = randomInRange(rangeMin, rangeMax, rng) * complexityFactor(legalMoveCount);
    const capPercent = randomInRange(MAX_PERCENT_OF_REMAINING_RANGE[0], MAX_PERCENT_OF_REMAINING_RANGE[1], rng);
    const hardCap = remainingMs * capPercent;
    thinkMs = Math.min(desired, hardCap, remainingMs - SAFETY_BUFFER_MS);
  }

  // Absolute safety net regardless of which branch ran above: never claim more time than the
  // bot actually has left, however small `remainingMs` is (this is what protects it from ever
  // flagging on time because of our own computed "thinking" delay).
  thinkMs = Math.min(thinkMs, remainingMs - 1);
  return Math.round(Math.max(0, thinkMs));
}

// --- Giveaway (Antichess) -----------------------------------------------------------------

/**
 * Picks a move for a bot playing Giveaway. Deliberately NOT Stockfish: it has no concept of this
 * ruleset (mandatory captures, capturable kings, "run out of moves to win"), and — unlike Fog of
 * War, where any Stockfish move is automatically also legal — a normal engine move routinely
 * breaks the mandatory-capture rule. So this picks from getGiveawayMoves (always rule-legal) with a
 * deliberately simple heuristic, shipped as a first version to be tuned later (how good Giveaway
 * bots should be is a product decision, not just engineering):
 *
 *  - The aim of Giveaway is to LOSE all your material, so a move scores by what it hands the
 *    opponent: the value of the pieces they can then capture of ours (they are forced to capture
 *    if they can), minus the value of anything we capture ourselves (taking their pieces helps them).
 *  - A move after which the opponent has NO legal move is heavily penalised — that wins THEM the game.
 *  - ELO is the only strength dial: the chance of playing the best-scoring move (rather than a
 *    random legal one) rises from ~20% at 400 ELO to ~90% at 3000, so weak bots still blunder
 *    plenty and strong ones play the heuristic reliably. Every bot shares the same 1-ply heuristic.
 *
 * Returns null only when the bot has no legal move (the game would already be over — see
 * getGiveawayWinner).
 */
export function chooseGiveawayBotMove(engine: ChessEngine, elo: number, rng: () => number = Math.random): Move | null {
  const moves = getGiveawayMoves(engine);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const bestChance = 0.2 + 0.7 * Math.min(1, Math.max(0, (elo - 400) / 2600));
  if (rng() >= bestChance) return moves[Math.floor(rng() * moves.length)];

  const fen = engine.getFen();
  const scored = moves.map((move) => {
    const scratch = new ChessEngine(fen, { skipValidation: true, giveaway: true });
    scratch.movePseudoLegal(move.from, move.to, move.promotion);
    const replies = getGiveawayMoves(scratch);
    let score = 0;
    if (move.captured) score -= PIECE_VALUES[move.captured] + 1;
    if (replies.length === 0) {
      score -= 100;
    } else {
      // The opponent must capture whenever they can, so every reply here that captures takes
      // something of ours; assume they pick the most valuable (the pessimistic case for scoring).
      // A bot that WANTS to be captured scores higher for handing over more.
      const captured = replies.filter((reply) => reply.captured);
      if (captured.length > 0) {
        const taken = captured.map((reply) => PIECE_VALUES[scratch.getPieceAt(reply.to)?.type ?? 'p']);
        score += Math.max(...taken) + 1;
      }
    }
    return { move, score };
  });
  const top = Math.max(...scored.map((s) => s.score));
  const best = scored.filter((s) => s.score === top);
  return best[Math.floor(rng() * best.length)].move;
}

// --- Atomic -------------------------------------------------------------------------------

/** Centipawn value per piece code (1 pawn … 6 king, see atomic.ts); kings carry no material value. */
const ATOMIC_CP = [0, 100, 300, 300, 500, 900, 0];
/** Score for "the enemy king is blown up" — far above any material total; ply is subtracted so a
 * quicker win scores higher and a slower loss scores better. */
const ATOMIC_WIN = 100000;
/** Positions the search may visit in one move, a safety valve so a slow device never stalls the bot. */
const ATOMIC_NODE_BUDGET = 12000;

/** Material from the side to move's point of view, in centipawns. */
function atomicMaterial(pos: AtomicPosition): number {
  let white = 0;
  for (let i = 0; i < 64; i++) {
    const v = pos.squares[i];
    if (v > 0) white += ATOMIC_CP[v];
    else if (v < 0) white -= ATOMIC_CP[-v];
  }
  return pos.turn === 'w' ? white : -white;
}

interface AtomicSearchState {
  nodes: number;
  aborted: boolean;
}

/** Captures first (biggest victim first), then promotions, then quiet moves. Under-promotions are
 * dropped: a capture-promotion explodes the new piece so every choice is identical, and the rest are
 * rarely right. */
function orderAtomicMoves(pos: AtomicPosition, moves: AtomicMove[]): AtomicMove[] {
  const keyed: { move: AtomicMove; key: number }[] = [];
  for (const move of moves) {
    if (move.promotion && move.promotion !== 'q') continue;
    const victim = move.enPassant ? 1 : Math.abs(pos.squares[move.to]);
    keyed.push({ move, key: victim > 0 ? 1000 + ATOMIC_CP[victim] : move.promotion ? 500 : 0 });
  }
  keyed.sort((a, b) => b.key - a.key);
  return keyed.map((k) => k.move);
}

/** Score at the horizon: a side that can explode the enemy king right now has already won (this is
 * what stops even a 1-ply bot from leaving its own king blastable), otherwise plain material. */
function atomicLeafScore(pos: AtomicPosition, moves: AtomicMove[], ply: number): number {
  for (const move of moves) {
    if (!move.enPassant && pos.squares[move.to] === 0) continue;
    const after = applyAtomicMove(pos, move);
    if (getAtomicKingWinner(after.position)) return ATOMIC_WIN - ply;
  }
  return atomicMaterial(pos);
}

/** Negamax with alpha-beta over atomic.ts's legal moves; scores are from the side to move's view. */
function searchAtomic(pos: AtomicPosition, depth: number, alpha: number, beta: number, ply: number, state: AtomicSearchState, budget: number): number {
  state.nodes += 1;
  if (state.nodes > budget) {
    state.aborted = true;
    return 0;
  }
  const moves = generateAtomicMoves(pos);
  if (moves.length === 0) return isAtomicCheck(pos) ? -(ATOMIC_WIN - ply) : 0;
  if (depth <= 0) return atomicLeafScore(pos, moves, ply);

  let best = -Infinity;
  for (const move of orderAtomicMoves(pos, moves)) {
    const after = applyAtomicMove(pos, move);
    const wins = after.exploded.length > 0 && getAtomicKingWinner(after.position) !== null;
    const score = wins ? ATOMIC_WIN - ply : -searchAtomic(after.position, depth - 1, -beta, -alpha, ply + 1, state, budget);
    if (state.aborted) return 0;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function describeAtomicMove(pos: AtomicPosition, m: AtomicMove): Move {
  const victim = m.enPassant ? 1 : Math.abs(pos.squares[m.to]);
  return {
    from: squareName(m.from),
    to: squareName(m.to),
    promotion: m.promotion,
    san: '',
    captured: victim > 0 ? (['p', 'n', 'b', 'r', 'q', 'k'] as const)[victim - 1] : undefined,
  };
}

/**
 * Picks a move for a bot playing Atomic. Deliberately NOT Stockfish: it has no concept of explosions,
 * so its moves are routinely illegal or suicidal here (and a WASM variant engine — Fairy-Stockfish — is
 * out of scope for now). This is a shallow alpha-beta search over atomic.ts's legal moves (always
 * rule-legal, explosions included) with a simple material evaluation; explosions need no special
 * evaluation because the search itself plays the blast out. Exploding the enemy king is scored as a
 * win, losing your own as a loss, so even the shallowest bot never leaves its king blastable.
 *
 * ELO is the only strength dial, as for Giveaway: the chance of playing the searched best move
 * (rather than a random legal one) rises from ~20% at 400 ELO to ~90% at 3000, and the search deepens
 * with ELO (1 ply below 1000, 2 below 2000, otherwise 3), capped by a node budget so a slow device
 * can't stall. Returns null only when there is no legal move (the game is already over).
 */
export function chooseAtomicBotMove(engine: ChessEngine, elo: number, rng: () => number = Math.random): Move | null {
  const pos = engine.getAtomicPosition();
  const moves = generateAtomicMoves(pos);
  if (moves.length === 0) return null;
  if (moves.length === 1) return describeAtomicMove(pos, moves[0]);

  const bestChance = 0.2 + 0.7 * Math.min(1, Math.max(0, (elo - 400) / 2600));
  if (rng() >= bestChance) return describeAtomicMove(pos, moves[Math.floor(rng() * moves.length)]);

  const maxDepth = elo < 1000 ? 1 : elo < 2000 ? 2 : 3;
  let rootMoves = orderAtomicMoves(pos, moves);
  let scored: { move: AtomicMove; score: number }[] = rootMoves.map((move) => ({ move, score: 0 }));

  // Iterative deepening: each completed depth reorders the next; an iteration cut off by the node
  // budget is discarded in favour of the last complete one.
  const state: AtomicSearchState = { nodes: 0, aborted: false };
  for (let depth = 1; depth <= maxDepth; depth++) {
    const iteration: { move: AtomicMove; score: number }[] = [];
    for (const move of rootMoves) {
      const after = applyAtomicMove(pos, move);
      const wins = after.exploded.length > 0 && getAtomicKingWinner(after.position) !== null;
      // Full window at the root: every root score is exact, so ties below are genuine ties.
      const score = wins ? ATOMIC_WIN : -searchAtomic(after.position, depth - 1, -Infinity, Infinity, 1, state, ATOMIC_NODE_BUDGET);
      if (state.aborted) break;
      iteration.push({ move, score });
    }
    if (state.aborted) break;
    scored = iteration;
    iteration.sort((a, b) => b.score - a.score);
    rootMoves = iteration.map((s) => s.move);
  }

  const top = Math.max(...scored.map((s) => s.score));
  const best = scored.filter((s) => s.score === top);
  return describeAtomicMove(pos, best[Math.floor(rng() * best.length)].move);
}
