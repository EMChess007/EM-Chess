/**
 * Chaturaji - everything a SCREEN says that is not just the 4 Player Chess wording, kept pure for the same reason as `fourPlayerVariant.ts` (the tests render nothing
 * heavier than a few components): the "+N" a seat gets for a move, the status of a seat, the final table with its points breakdown, and the rules sheet. (W3;
 * CHATURAJI_SPEC.md section 9.) Client-only: not in the server mirror.
 *
 * THE POINTS ARE THE ENGINE'S. Nothing here recomputes what a capture, a king or a fork is worth: a gain is the difference between two score arrays the engine (locally) or
 * the server (online) produced, and the only figure derived from the rules is the end-of-game bonus, read from `lastStandingKingBonus` on the very rules object the engine
 * paid it from (a test pins that the engine's own final score minus the same game played with the bonus switched off equals it, on seeded games). The rules sheet gets its
 * numbers from the same constants, so it cannot drift from the game.
 */

import {
  CAPTURE_POINTS,
  CHATURAJI_RULES,
  KNIGHT,
  PAWN,
  ROOK,
  BISHOP,
  SEAT_NAMES,
  isInCheck,
  optionsOf,
  type FourPlayerRules,
  type FourPlayerState,
  type Seat,
} from './fourPlayer';
import { rankSeats } from './fourPlayerVariant';

const SEATS: readonly Seat[] = [0, 1, 2, 3];

// --- The "+N" at a seat ------------------------------------------------------------------------------------------------------------

export interface ScoreGain {
  seat: Seat;
  points: number;
}

/**
 * What each seat scored between two score arrays (the engine's or the server's, one move apart). Only increases count: a score never goes down in Chaturaji, and a
 * seat that did not score is not listed.
 */
export function scoreGains(before: readonly number[], after: readonly number[]): ScoreGain[] {
  const gains: ScoreGain[] = [];
  for (const seat of SEATS) {
    const points = (after[seat] ?? 0) - (before[seat] ?? 0);
    if (points > 0) gains.push({ seat, points });
  }
  return gains;
}

/** The little label shown at the seat: "+3". */
export const formatGain = (points: number): string => `+${points}`;

/** The screen-reader sentence for a gain: "Red scored 3 points". */
export const describeGain = (gain: ScoreGain): string => `${SEAT_NAMES[gain.seat]} scored ${gain.points} ${gain.points === 1 ? 'point' : 'points'}`;

// --- The status of a seat ------------------------------------------------------------------------------------------------------------

export type SeatEngineStatus = 'active' | 'attacked' | 'walking' | 'out';

export interface SeatStatusInfo {
  kind: SeatEngineStatus;
  /** The word under the seat's name, or null when the seat is simply playing. */
  text: string | null;
}

/**
 * What the ENGINE says about a seat: still playing, playing with its king attacked (a threat, not a check that must be answered), a resigned / timed-out / stalemated seat
 * whose king keeps walking, or an army whose king was captured. (Who controls the seat - a bot that took over, a player who dropped off - is a separate badge the online
 * screen adds; see `seatLabels`.)
 */
export function seatStatusOf(state: FourPlayerState, seat: Seat): SeatStatusInfo {
  const status = state.status[seat];
  if (status === 'frozen') return { kind: 'out', text: 'out' };
  if (status === 'dead-king') return { kind: 'walking', text: 'king walking' };
  if (!state.result && isInCheck(state, seat)) return { kind: 'attacked', text: 'king attacked' };
  return { kind: 'active', text: null };
}

/** The pill that replaces the status line while the viewer's own king is attacked. It never says the king has to be saved: nothing forces it. */
export const KING_ATTACKED_PILL = 'Your king is attacked — it can be captured';

/** Whether the pill applies: the viewer's own seat is playing and its king is attacked. */
export function showKingAttackedPill(state: FourPlayerState, seat: Seat | null): boolean {
  return seat !== null && seatStatusOf(state, seat).kind === 'attacked';
}

// --- The final table ------------------------------------------------------------------------------------------------------------------

export interface LastStandingBonus {
  seat: Seat;
  /** Other seats' kings still on the board. */
  kings: number;
  points: number;
}

/**
 * The bonus the engine paid the one seat left standing when the game ended by elimination: `lastStandingKingBonus` for each OTHER seat's king still on the board (a
 * resigned / timed-out seat's walking king; a captured king is gone). Null when nothing was paid: another ending, more than one seat active, or no king left.
 */
export function lastStandingBonus(final: Pick<FourPlayerState, 'rules' | 'status' | 'kings'>, reason: string): LastStandingBonus | null {
  const per = optionsOf(final.rules).lastStandingKingBonus;
  if (per <= 0 || reason !== 'elimination') return null;
  const active = SEATS.filter((seat) => final.status[seat] === 'active');
  if (active.length !== 1) return null;
  const kings = SEATS.filter((seat) => seat !== active[0] && final.kings[seat] >= 0).length;
  return kings > 0 ? { seat: active[0], kings, points: per * kings } : null;
}

export interface ChaturajiResultRow {
  place: number;
  seat: Seat;
  total: number;
  /** The part of `total` that is the surviving-kings bonus (0 for everyone but the last seat standing). */
  bonus: number;
  /** Everything else: captures, king captures, check forks. */
  fromPlay: number;
  winner: boolean;
  /** "9 points" or "12 points — 3 from play + 9 for 3 kings left", ready to show under the name. */
  detail: string;
}

/**
 * The final ranking with its points breakdown. `scores` are the final points (the engine's, or the server's `four_game_over.scores`); `final` is the final position,
 * which says how many kings were left for the bonus. Highest score first (ties by seat), winners marked.
 */
export function chaturajiResultRows(
  final: Pick<FourPlayerState, 'rules' | 'status' | 'kings'>,
  scores: readonly number[],
  winners: readonly Seat[],
  reason: string
): ChaturajiResultRow[] {
  const bonus = lastStandingBonus(final, reason);
  return rankSeats('chaturaji', scores, winners).map((seat, index) => {
    const total = scores[seat] ?? 0;
    const bonusPoints = bonus && bonus.seat === seat ? bonus.points : 0;
    const fromPlay = total - bonusPoints;
    const unit = (n: number) => `${n} ${n === 1 ? 'point' : 'points'}`;
    const detail = bonusPoints > 0 && bonus ? `${unit(total)} — ${fromPlay} from play + ${bonusPoints} for ${bonus.kings} ${bonus.kings === 1 ? 'king' : 'kings'} left` : unit(total);
    return { place: index + 1, seat, total, bonus: bonusPoints, fromPlay, winner: winners.includes(seat), detail };
  });
}

// --- The rules sheet -------------------------------------------------------------------------------------------------------------------

export interface RulesSection {
  title: string;
  lines: string[];
}

/**
 * The Chaturaji rules sheet (CHATURAJI_SPEC.md sections 1, 4). Every number comes from the engine's own constants (`CAPTURE_POINTS`, the rules' options), so the sheet
 * cannot say something the game does not do.
 */
export function chaturajiRulesSheet(rules: FourPlayerRules = CHATURAJI_RULES): RulesSection[] {
  const options = optionsOf(rules);
  const order = SEATS.map((seat) => SEAT_NAMES[seat]).join(' → ');
  const points = (type: number) => CAPTURE_POINTS[type];
  const fork = options.forkPoints;
  return [
    {
      title: 'The set-up',
      lines: [
        'Four armies on an 8 × 8 board, one in each corner. Every army has a boat, a knight, a bishop, a king and four pawns; each army is the previous one turned a quarter turn.',
        `Turns go ${order}, clockwise. ${SEAT_NAMES[0]} moves first. There are no dice and no queens.`,
      ],
    },
    {
      title: 'The pieces',
      lines: [
        'Boat: moves like a rook. Knight, bishop and king move as in chess. There is no castling.',
        'Pawn: one step forward (never two), captures one step diagonally forward. There is no en passant.',
        'A pawn that reaches the far (8th) rank becomes a boat, automatically.',
      ],
    },
    {
      title: 'Capture the King',
      lines: [
        'To checkmate, kings must be captured. A check never has to be answered: you can leave your king attacked, or even step it into an attack, and no piece is ever pinned.',
        `An attacked king can be captured — that scores ${options.kingPoints} points and puts the whole army out. The best defence is often to capture first.`,
      ],
    },
    {
      title: 'Points',
      lines: [
        `Pawn ${points(PAWN)} · Knight ${points(KNIGHT)} · King ${options.kingPoints} · Bishop ${points(BISHOP)} · Boat ${points(ROOK)}.`,
        fork ? `Attack two kings with one piece: +${fork.double}. Attack three: +${fork.triple}.` : '',
        'Pieces of an army that is out are grey and score nothing when captured.',
        `When the game ends with one army left standing, it scores +${options.lastStandingKingBonus} for every other king still on the board.`,
      ].filter((line) => line !== ''),
    },
    {
      title: 'Leaving the game',
      lines: [
        'A player who resigns or runs out of time is out: the army turns grey, but its king keeps walking at random until it is captured (worth the same points).',
        'A player with no legal move is out as well, without points for anyone.',
      ],
    },
    {
      title: 'The end',
      lines: [
        `The game ends when three armies are out, or after ${rules.maxPlies} moves. The highest score wins — not necessarily the last army standing. Equal scores share the win.`,
      ],
    },
  ];
}
