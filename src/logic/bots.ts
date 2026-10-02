import type { BotCategory, BotPersonality } from '../types/bot';
import type { Move } from '../types/chess';
import type { TimeControl } from '../types/timeControl';
import { PIECE_VALUES } from './analysis';
import { ChessEngine } from './ChessEngine';
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
