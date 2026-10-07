/**
 * 4 Player Chess — the bot. Stockfish cannot play this game (no 4-seat position, no UCI variant), so this is a small heuristic in the
 * same spirit as the other variants' bots in bots.ts. It is NOT ELO-calibrated: strength is one of three levels, and 4-player
 * games are never rated.
 *
 *  - easy:   half the time a random capture (best victim first), otherwise any random legal move.
 *  - medium: one ply. Scores every legal move by the points it wins, the material change (a live-piece count measured against the
 *            average opponent), promotion, and whether the moved piece is left hanging (attacked and not defended); a move that
 *            checkmates the next seat is worth a fortune.
 *  - hard:   two ply, "paranoid" but only against the NEXT seat (the other two seats move in between in a way nobody can predict, so
 *            they are covered by the exposure term instead): for each of my moves, the next seat's reply that is worst for me is
 *            assumed, including being checkmated by it, and checkmating or stalemating that seat outright is valued directly.
 *
 * Material is measured over ACTIVE seats only: an eliminated seat's pieces are dead, worth nothing to anyone, and a bot gets no
 * credit for "ganging up" on a corpse. Only the evaluation of the position after the move is used, so it stays correct no matter which
 * seats are already eliminated.
 */

import { forwardCoord, nextSeat, type Seat } from './board';
import { FLAG_CASTLE, FLAG_PROMOTION, applyMoveRaw, attackers, isInCheck, legalMoves, type Move } from './moves';
import { PAWN, seatOf, typeOf, type FourPlayerState, type SeatStatus } from './state';

export type BotLevel = 'easy' | 'medium' | 'hard';
export const BOT_LEVELS: readonly BotLevel[] = ['easy', 'medium', 'hard'];

type Rng = () => number;

/** Material value by piece type (index = type code): P, N, B, R, Q, K (never counted), promoted queen. */
const VALUE = [0, 1, 3, 3.25, 5, 9, 0, 9];
const CHECKMATE_VALUE = 25;
const STALEMATE_VALUE = -6;

function materialBySeat(state: FourPlayerState): number[] {
  const mat = [0, 0, 0, 0];
  const cells = state.cells;
  for (let i = 0; i < cells.length; i++) {
    const code = cells[i];
    if (code <= 0) continue;
    const seat = seatOf(code);
    if (state.status[seat] !== 'active') continue;
    const type = typeOf(code);
    mat[seat] += VALUE[type];
    if (type === PAWN) mat[seat] += 0.04 * forwardCoord(seat, i); // a small reward for advancing pawns
  }
  return mat;
}

/** How good `state` is for `me`: its material against the average of the other ACTIVE seats'. */
export function evaluate(state: FourPlayerState, me: Seat): number {
  const mat = materialBySeat(state);
  let others = 0;
  let count = 0;
  for (let seat = 0; seat < 4; seat++) {
    if (seat !== me && state.status[seat] === 'active') {
      others += mat[seat];
      count++;
    }
  }
  return mat[me] - (count ? others / count : 0);
}

/** A status array in which only `seat` is active — makes `attackers` report only that seat's pieces (i.e. who DEFENDS a square). */
function onlyActive(seat: Seat): SeatStatus[] {
  return (['dead-king', 'dead-king', 'dead-king', 'dead-king'] as SeatStatus[]).map((s, i) => (i === seat ? 'active' : s));
}

/** The value of the piece that just moved to `to` if it can simply be taken (attacked by a live enemy and not defended), else 0. */
function hangingValue(state: FourPlayerState, to: number, me: Seat): number {
  if (attackers(state.cells, state.status, to, me) === 0) return 0;
  const defender = nextSeat(me); // any seat other than `me`, so that `me`'s pieces count as attackers of the square
  if (attackers(state.cells, onlyActive(me), to, defender) !== 0) return 0;
  return VALUE[typeOf(state.cells[to])];
}

/** The next seat clockwise that is still active (the one who actually answers my move), or null when it is only me. */
function nextActive(state: FourPlayerState, me: Seat): Seat | null {
  let seat = nextSeat(me);
  for (let i = 0; i < 3; i++, seat = nextSeat(seat)) if (state.status[seat] === 'active') return seat;
  return null;
}

/** One-ply score of `move` for `me` (shared by medium and hard). Also returns the resulting state. */
function scoreMove(state: FourPlayerState, move: Move, me: Seat, baseEval: number): { score: number; after: FourPlayerState } {
  const after = applyMoveRaw(state, move);
  let score = (after.score[me] - state.score[me]) * 1.5 + (evaluate(after, me) - baseEval);
  score -= hangingValue(after, move.to, me) * 0.8;
  if (move.flags & FLAG_CASTLE) score += 0.3;
  if (move.flags & FLAG_PROMOTION) score += 1;
  return { score, after };
}

/**
 * Picks a move for the seat to move. Returns null only if that seat has no legal move (which cannot happen mid-game: the engine
 * resolves such seats before handing out the turn).
 */
export function chooseBotMove(state: FourPlayerState, level: BotLevel, rng: Rng = Math.random): Move | null {
  const me = state.turn;
  const moves = legalMoves(state, me);
  if (moves.length === 0) return null;
  const pick = <T>(list: T[]): T => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

  if (level === 'easy') {
    const captures = moves.filter((m) => m.captured);
    if (captures.length > 0 && rng() < 0.5) {
      const best = Math.max(...captures.map((m) => VALUE[typeOf(m.captured)]));
      return pick(captures.filter((m) => VALUE[typeOf(m.captured)] === best));
    }
    return pick(moves);
  }

  const baseEval = evaluate(state, me);
  const opponent = nextActive(state, me);
  const scored: { move: Move; score: number }[] = [];

  for (const move of moves) {
    const { score: oneply, after } = scoreMove(state, move, me, baseEval);
    let score = oneply + rng() * 0.05; // tiny jitter so equal moves vary

    if (opponent !== null) {
      const replies = legalMoves(after, opponent);
      if (replies.length === 0) {
        // The next seat cannot move at all: checkmated (if attacked) or stalemated.
        score += isInCheck(after, opponent) ? CHECKMATE_VALUE : STALEMATE_VALUE;
      } else if (level === 'hard') {
        // Assume the next seat's reply that is worst for me (medium stops at the one-ply score above).
        let worst = Infinity;
        for (const reply of replies) {
          const afterReply = applyMoveRaw(after, reply);
          let value = evaluate(afterReply, me) - baseEval;
          if (isInCheck(afterReply, me) && legalMoves(afterReply, me).length === 0) value -= CHECKMATE_VALUE;
          if (value < worst) worst = value;
        }
        // Replace the one-ply material term with the worst-case one, keeping the points/hanging/castle terms.
        score = oneply - (evaluate(after, me) - baseEval) + worst + rng() * 0.05;
      }
    }
    scored.push({ move, score });
  }

  const best = Math.max(...scored.map((s) => s.score));
  return pick(scored.filter((s) => s.score >= best - 1e-9)).move;
}
