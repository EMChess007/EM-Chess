/**
 * Bughouse ONLINE (W4): the CLIENT'S VIEW of one room, as pure functions (BUGHOUSE_SPEC.md section 7, W4: "reducer / session / UI-logic twins"). The same split as 4 Player's
 * `fourPlayerOnline.ts`: no React, no socket, no clock - the caller hands in the instant - so every rule that matters (which snapshot wins, when to resync, what a refusal does, what the
 * clocks show) is unit-tested without a renderer.
 *
 * THE SERVER IS THE ONLY AUTHORITY. The view never applies an action itself: a move or a drop is SENT, and the board changes when the server's `bug_state` (the snapshot, `serializeMatch`
 * text) arrives. While one action of ours is in flight (`pending`) a second one is not sent - the acknowledgement or its refusal ends the wait - so the screen can never run ahead of the
 * match. A snapshot is applied only when its `seq` is exactly one more than ours: an older one is dropped, a gap asks for a resync (`bug_rejoin`), text that cannot be read asks for one too.
 *
 * CLOCKS. Every payload that carries a position also carries `serverNowMs`, the instant on the match's own monotonic clock. The view remembers the LOCAL instant the payload arrived
 * (`receivedAt`); the server's "now" is then `serverNowMs + (localNow - receivedAt)` (`serverNowAt`). The client's wall clock is never compared with the server's, only with itself, so a phone
 * whose clock is wrong by an hour shows the right time. The estimate never goes behind the match's own latest instant.
 */
import { afterEvents, type BankFlash, type LastMove } from './bughouseLocal';
import { deserializeMatch, type BughouseAction, type BughouseMatch, type MatchResult } from './bughouse';
import type { BoardId, BughouseSeat } from './bughouse/types';
import { isSeat } from './bughouse/match';
import {
  validateBugDropPayload,
  validateBugMovePayload,
  type BugGameOverPayload,
  type BugMatchFoundPayload,
  type BugMovePayload,
  type BugDropPayload,
  type BugRejectReason,
  type BugRejoinState,
  type BugSeatUpdatePayload,
  type BugSeats,
  type BugStatePayload,
} from './bughouse/wire';

/** The action a human can send: a move or a drop (a resignation has its own event). */
export type BughouseOnlineAction = Extract<BughouseAction, { kind: 'move' | 'drop' }>;

export interface BughouseOnlineView {
  readonly roomId: string;
  readonly mySeat: BughouseSeat;
  readonly seats: BugSeats;
  /** When the seat list arrived (local ms): the grace countdowns count from it. */
  readonly seatsAt: number;
  readonly timeControlLabel: string;
  /** The match as the server last said it. */
  readonly match: BughouseMatch;
  readonly lastMove: Readonly<Record<BoardId, LastMove | null>>;
  readonly bank: BankFlash | null;
  /** `serverNowMs` of the snapshot the match came from, and the local instant it arrived. */
  readonly serverNowMs: number;
  readonly receivedAt: number;
  /** The result from `bug_game_over`, when it arrived (the match's own `result` is set by the final snapshot). */
  readonly gameOver: BugGameOverPayload | null;
  /** One of our actions is on its way to the server (sent, not yet acknowledged). */
  readonly pending: { readonly id: number } | null;
  /** A whole-room request (`bug_rejoin`) is in flight; one at a time. */
  readonly resyncing: boolean;
  /** The last refusal, in words; cleared by the next accepted action. */
  readonly actionError: string | null;
  readonly nextId: number;
}

function parse(text: unknown): BughouseMatch | null {
  if (typeof text !== 'string') return null;
  const parsed = deserializeMatch(text);
  return parsed.ok ? parsed.match : null;
}

function validSeats(seats: unknown): seats is BugSeats {
  return Array.isArray(seats) && seats.length === 4 && seats.every((s) => typeof s === 'object' && s !== null && typeof (s as { name?: unknown }).name === 'string');
}

/** The first view, from `bug_match_found`; null when the payload cannot be used (an unreadable snapshot, a seat that is not 0..3). */
export function viewFromMatchFound(payload: BugMatchFoundPayload, localNow: number): BughouseOnlineView | null {
  if (!payload || typeof payload !== 'object' || typeof payload.roomId !== 'string' || !isSeat(payload.seat) || !validSeats(payload.seats)) return null;
  const match = parse(payload.state);
  if (match === null || typeof payload.serverNowMs !== 'number') return null;
  return {
    roomId: payload.roomId,
    mySeat: payload.seat,
    seats: payload.seats,
    seatsAt: localNow,
    timeControlLabel: String(payload.timeControlLabel ?? ''),
    match,
    lastMove: { A: null, B: null },
    bank: null,
    serverNowMs: payload.serverNowMs,
    receivedAt: localNow,
    gameOver: null,
    pending: null,
    resyncing: false,
    actionError: null,
    nextId: 1,
  };
}

/** The server's "now" on the match's own clock, estimated at local instant `localNow`: monotonic, never behind the match's latest instant. */
export function serverNowAt(view: Pick<BughouseOnlineView, 'serverNowMs' | 'receivedAt' | 'match'>, localNow: number): number {
  return Math.max(view.match.nowMs, Math.floor(view.serverNowMs + Math.max(0, localNow - view.receivedAt)));
}

export type StateOutcome = 'applied' | 'stale' | 'gap' | 'invalid';

/** One `bug_state`. `resync` is true when the client must ask the server for the whole room (a gap, or text it cannot read). */
export function applyBugState(view: BughouseOnlineView, payload: BugStatePayload, localNow: number): { view: BughouseOnlineView; outcome: StateOutcome; resync: boolean } {
  if (!payload || typeof payload !== 'object' || payload.roomId !== view.roomId || !Number.isSafeInteger(payload.seq)) return { view, outcome: 'stale', resync: false };
  if (payload.seq <= view.match.seq) return { view, outcome: 'stale', resync: false };
  if (payload.seq !== view.match.seq + 1) return { view, outcome: 'gap', resync: true };
  const match = parse(payload.state);
  if (match === null || match.seq !== payload.seq || typeof payload.serverNowMs !== 'number') return { view, outcome: 'invalid', resync: true };
  const events = Array.isArray(payload.events) ? payload.events : [];
  const screen = afterEvents({ match: view.match, lastMove: view.lastMove, bank: view.bank }, match, events);
  return {
    view: { ...view, match, lastMove: screen.lastMove, bank: screen.bank, serverNowMs: payload.serverNowMs, receivedAt: localNow, actionError: null },
    outcome: 'applied',
    resync: false,
  };
}

export function applySeatUpdate(view: BughouseOnlineView, payload: BugSeatUpdatePayload, localNow: number): BughouseOnlineView {
  if (!payload || typeof payload !== 'object' || payload.roomId !== view.roomId || !validSeats(payload.seats)) return view;
  return { ...view, seats: payload.seats, seatsAt: localNow };
}

/** `bug_game_over`: the result is on screen whatever else is in flight. Its snapshot is adopted when it is newer than ours. */
export function applyGameOver(view: BughouseOnlineView, payload: BugGameOverPayload, localNow: number): BughouseOnlineView {
  if (!payload || typeof payload !== 'object' || payload.roomId !== view.roomId || typeof payload.result !== 'object' || payload.result === null) return view;
  const final = parse(payload.state);
  const newer = final !== null && final.seq >= view.match.seq;
  return {
    ...view,
    ...(newer ? { match: final as BughouseMatch, receivedAt: localNow, serverNowMs: (final as BughouseMatch).nowMs } : {}),
    gameOver: payload,
    pending: null,
    resyncing: false,
  };
}

/** The result to show: the match's own once the final snapshot arrived, else the one `bug_game_over` carried. */
export function resultOf(view: BughouseOnlineView): MatchResult | null {
  return view.match.result ?? view.gameOver?.result ?? null;
}

export function isOver(view: BughouseOnlineView): boolean {
  return resultOf(view) !== null;
}

/** The whole room from a rejoin: adopted when it is at least as new as ours (a snapshot older than ours is ignored). The last move is not in it, so it is dropped. */
export function adoptRejoin(view: BughouseOnlineView, state: BugRejoinState, localNow: number): { view: BughouseOnlineView; outcome: 'adopted' | 'older' | 'invalid' } {
  if (!state || typeof state !== 'object' || state.roomId !== view.roomId || !validSeats(state.seats)) return { view, outcome: 'invalid' };
  const match = parse(state.state);
  if (match === null || typeof state.serverNowMs !== 'number') return { view, outcome: 'invalid' };
  if (match.seq < view.match.seq) return { view: { ...view, resyncing: false }, outcome: 'older' };
  const sameCommit = match.seq === view.match.seq;
  return {
    view: {
      ...view,
      match,
      seats: state.seats,
      seatsAt: localNow,
      lastMove: sameCommit ? view.lastMove : { A: null, B: null },
      bank: sameCommit ? view.bank : null,
      serverNowMs: state.serverNowMs,
      receivedAt: localNow,
      pending: null,
      resyncing: false,
    },
    outcome: 'adopted',
  };
}

export function beginResync(view: BughouseOnlineView): { view: BughouseOnlineView; send: boolean } {
  if (view.resyncing || isOver(view)) return { view, send: false };
  return { view: { ...view, resyncing: true }, send: true };
}
export function endResync(view: BughouseOnlineView): BughouseOnlineView {
  return view.resyncing ? { ...view, resyncing: false } : view;
}

// --- Our own actions ---------------------------------------------------------------------------------------------------------------

/** What the wire payload of an action is (the room and the board named explicitly, HP9), and the match `seq` it was validated against. */
export function actionPayload(view: BughouseOnlineView, action: BughouseOnlineAction): BugMovePayload | BugDropPayload {
  if (action.kind === 'move') {
    return { roomId: view.roomId, board: action.board, from: action.from, to: action.to, ...(action.promotion ? { promotion: action.promotion } : {}), baseSeq: view.match.seq };
  }
  return { roomId: view.roomId, board: action.board, piece: action.piece, square: action.square, baseSeq: view.match.seq };
}

/** Whether `action` may be sent now, and the payload; `id` is null when nothing is sent (over, one already in flight, or a shape the wire would refuse). */
export function beginAction(view: BughouseOnlineView, action: BughouseOnlineAction): { view: BughouseOnlineView; id: number | null; payload: BugMovePayload | BugDropPayload | null } {
  if (isOver(view) || view.pending !== null || view.resyncing) return { view, id: null, payload: null };
  const raw = actionPayload(view, action);
  const checked = action.kind === 'move' ? validateBugMovePayload(raw) : validateBugDropPayload(raw);
  if (!checked.ok) return { view: { ...view, actionError: checked.error }, id: null, payload: null };
  const id = view.nextId;
  return { view: { ...view, pending: { id }, nextId: id + 1, actionError: null }, id, payload: checked.value };
}

/** The server accepted action `id`: the wait is over (the snapshot that shows it comes as its own `bug_state`, in either order). */
export function actionAcked(view: BughouseOnlineView, id: number): BughouseOnlineView {
  return view.pending?.id === id ? { ...view, pending: null } : view;
}

/** What a refusal says to a person, by its closed reason (the server's `error` text is kept for the log). */
export const REFUSAL_TEXT: Readonly<Record<BugRejectReason, string>> = {
  over: 'The game is over.',
  time: 'That move came too late.',
  flagDue: 'A clock has run out.',
  malformed: 'That move was not understood.',
  wrongBoard: 'That is not your board.',
  notYourTurn: 'It is not your turn on this board.',
  illegalMove: 'That move is not legal.',
  dropNotInPocket: 'You no longer have that piece in your pocket.',
  illegalDrop: 'You cannot drop there.',
  invalidRequest: 'That request was not understood.',
  noGame: 'You are not in this game any more.',
  rateLimited: 'Slow down: too many moves at once.',
  duplicate: 'That was already sent.',
  partnerIsBot: 'Your partner is a bot.',
};

export function refusalText(reason: unknown): string {
  return typeof reason === 'string' && Object.prototype.hasOwnProperty.call(REFUSAL_TEXT, reason) ? REFUSAL_TEXT[reason as BugRejectReason] : 'The server refused that.';
}

/** The server refused (or did not answer) action `id`: the wait is over and `text` is shown. Another action's answer is ignored. */
export function actionFailed(view: BughouseOnlineView, id: number, text: string): BughouseOnlineView {
  return view.pending?.id === id ? { ...view, pending: null, actionError: text } : view;
}
