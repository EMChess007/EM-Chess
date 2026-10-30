/**
 * Bughouse W5: premoves and drop premoves on the CLIENT (BUGHOUSE_SPEC.md HP3, 5.5), as pure functions. The engine side is `bughouse/premove.ts` (`resolvePremove`, mirrored): it judges a
 * queued intent against the snapshot that gives the player the turn. This module is the input side: which taps queue what while the opponent is to move, when a premove may exist at all, and
 * what the screen does at each snapshot (wait, send, or drop it with a reason).
 *
 * THE RULES (HP3): queue length ONE (a new premove replaces the old); a premove is never sent early - it is resolved only when the snapshot that gives me the turn arrives, against THAT
 * snapshot, and sent as an ordinary action; the server never sees one. A half-made premove (a picked piece / chip) belongs to the position of ITS board and is dropped when that board changes
 * (CHECKLIST 10). A premove exists only with exactly ONE human at the device (Local) or online; with two or more humans sharing the device it is off (B23).
 */
import { openBoard, pieceAtOf } from './bughouse/board';
import { resolvePremove, type Premove, type PremoveCancel } from './bughouse/premove';
import type { BughouseMatch } from './bughouse/match';
import type { BughouseAction, PromotionPiece } from './bughouse/rules';
import { seatPlace, type BoardId, type BughouseSeat } from './bughouse/types';
import type { ReservePieceType } from './crazyhouse';

/** What is half-made: a piece of mine picked up, or a pocket chip picked. Each remembers the position of its board. */
export type PremoveHalf = { kind: 'select'; board: BoardId; square: string; fen: string } | { kind: 'pick'; board: BoardId; piece: ReservePieceType; fen: string };

/** The reason sentences (HP3), one per cancellation; `gameOver` has none because it is shown silently. */
export const PREMOVE_NOTICE: Readonly<Record<Exclude<PremoveCancel, 'gameOver' | 'notYourTurn'>, string>> = {
  noLongerLegal: 'The premove is no longer legal.',
  squareOccupied: 'The square is occupied.',
  notInPocket: 'The piece is no longer in your pocket.',
  checkNotAnswered: 'Your king is in check: this drop does not answer it.',
};

/** Premoves are on with exactly one human at the device (Local) and online, off with two or more (B23); never after the end. */
export function premovesAllowed(humanCount: number, match: BughouseMatch): boolean {
  return humanCount === 1 && match.result === null;
}

/** Whether `seat` is waiting for the opponent on its own board right now (the only time a premove can be made). */
export function isWaiting(match: BughouseMatch, seat: BughouseSeat): boolean {
  const place = seatPlace(seat);
  return match.result === null && match.verdicts[place.board].turn !== place.color;
}

/** Keeps a half-made premove only while its board is as it was. */
export function liveHalf(half: PremoveHalf | null, match: BughouseMatch): PremoveHalf | null {
  return half !== null && match.result === null && half.fen === match.boards[half.board].fen ? half : null;
}

const lastRank = (color: 'w' | 'b') => (color === 'w' ? '8' : '1');
const firstOrLastRank = (square: string) => square[1] === '1' || square[1] === '8';

/** One tap on a square of my board while waiting. `queued` is the premove it completed (then `half` is null); otherwise `half` is what is half-made now. */
export function premoveTap(match: BughouseMatch, seat: BughouseSeat, half: PremoveHalf | null, square: string): { half: PremoveHalf | null; queued: Premove | null } {
  const place = seatPlace(seat);
  const fen = match.boards[place.board].fen;
  const chess = openBoard(fen);
  if (chess === null) return { half: null, queued: null };
  const piece = pieceAtOf(chess)(square);
  const mine = piece !== undefined && piece !== null && piece.color === place.color;
  const held = liveHalf(half, match);

  if (held !== null && held.kind === 'pick') {
    if (piece) return { half: null, queued: null }; // a drop needs an empty square
    if (held.piece === 'p' && firstOrLastRank(square)) return { half: held, queued: null }; // a pawn is never dropped on the 1st or 8th rank
    return { half: null, queued: { kind: 'drop', piece: held.piece, square } };
  }
  if (held !== null && held.kind === 'select') {
    if (held.square === square) return { half: null, queued: null };
    if (mine) return { half: { kind: 'select', board: place.board, square, fen }, queued: null };
    const mover = pieceAtOf(chess)(held.square);
    const promotes: PromotionPiece | undefined = mover && mover.type === 'p' && square[1] === lastRank(place.color) ? 'q' : undefined;
    return { half: null, queued: { kind: 'move', from: held.square, to: square, ...(promotes ? { promotion: promotes } : {}) } };
  }
  return { half: mine ? { kind: 'select', board: place.board, square, fen } : null, queued: null };
}

/** A tap on one of MY pocket chips while waiting: picks it (or puts it down); a chip I do not have does nothing. */
export function premovePick(match: BughouseMatch, seat: BughouseSeat, half: PremoveHalf | null, piece: ReservePieceType): PremoveHalf | null {
  const place = seatPlace(seat);
  if (!(match.pockets[seat][piece] > 0)) return liveHalf(half, match);
  const held = liveHalf(half, match);
  if (held !== null && held.kind === 'pick' && held.piece === piece) return null;
  return { kind: 'pick', board: place.board, piece, fen: match.boards[place.board].fen };
}

export type PremoveStep = { kind: 'wait' } | { kind: 'play'; action: BughouseAction } | { kind: 'drop'; notice: string | null };

/** What to do with a queued premove at the snapshot `match`: wait (the turn is not mine yet), send the ordinary action it denotes, or drop it - with the reason, or silently when the game is over. */
export function stepPremove(match: BughouseMatch, seat: BughouseSeat, premove: Premove | null): PremoveStep {
  if (premove === null) return { kind: 'wait' };
  const resolved = resolvePremove(match, seat, premove);
  if (resolved.ok) return { kind: 'play', action: resolved.action };
  if (resolved.reason === 'notYourTurn') return { kind: 'wait' };
  if (resolved.reason === 'gameOver') return { kind: 'drop', notice: null };
  return { kind: 'drop', notice: PREMOVE_NOTICE[resolved.reason] };
}

/** The squares a queued premove marks on its board (the screen draws them in the premove colour), and the ghost piece for the target. */
export function premoveMarks(match: BughouseMatch, seat: BughouseSeat, premove: Premove | null): { from: string | null; to: string; ghost: { color: 'w' | 'b'; type: 'p' | 'n' | 'b' | 'r' | 'q' | 'k' } } | null {
  if (premove === null) return null;
  const place = seatPlace(seat);
  if (premove.kind === 'drop') return { from: null, to: premove.square, ghost: { color: place.color, type: premove.piece } };
  const chess = openBoard(match.boards[place.board].fen);
  const mover = chess ? pieceAtOf(chess)(premove.from) : undefined;
  return { from: premove.from, to: premove.to, ghost: { color: place.color, type: (premove.promotion ?? mover?.type ?? 'p') as 'p' | 'n' | 'b' | 'r' | 'q' | 'k' } };
}
