/**
 * 4 Player Chess ONLINE — the client's view of one room, and the pure functions that move it forward (FOUR_PLAYER_ONLINE_SPEC.md §3, §8).
 *
 * WHY THIS IS A SEPARATE, PURE FILE. The project has no React Native renderer in its tests, so the only way to test the part of the client
 * that can go wrong in ways a player cannot see — a lost, duplicated or reordered message; a move the server refuses; a reconnect — is to
 * keep it free of React and the socket. `useFourPlayerOnlineGame` (the hook) only wires socket events to these functions and sends what
 * they ask for. Every rule below has a named test in `__tests__/fourPlayerOnline.test.ts`.
 *
 * THE MODEL. The AUTHORITY is the last `four_state` snapshot the client adopted (`state`, `seq`, `clocksMs`); nothing the client does
 * ever edits it. A move the player makes is shown at once as an OPTIMISTIC copy (`pending.state`, the engine's `applyMoveRaw`, which has
 * no randomness), kept BESIDE the authority and never instead of it. So "roll back to the last authoritative snapshot" is not an undo
 * that could go wrong: it is just dropping `pending`, and the screen then draws `state` again. The position the screen draws is
 * `displayState(view)`; the position everything else reasons about (legality, premoves, whose turn) is `view.state`.
 *
 * ORDERING (the spec's rule, exactly). `seq` starts at 0 (the match-found / rejoin snapshot) and grows by 1 per `four_state`:
 *   seq <= current        -> ignored (equal = a duplicate, smaller = a late arrival; neither may move the view, not even by reference)
 *   seq == current + 1    -> adopted
 *   seq >  current + 1    -> a GAP: something was lost (a reconnect), so ask the server for the whole room (`four_rejoin`) instead of
 *                            guessing; ONE request in flight at a time (`resyncing`), however many later states arrive meanwhile.
 * A snapshot is never rebuilt by replaying moves: the engine plays random dead-king walks a client cannot predict, so the server's
 * `state` text is adopted as it is.
 *
 * GOTCHAS.
 *   - An answer from the wrong room, or anything after the game ended, never changes the view: a late rejoin answer or a stale event must
 *     not disturb a result that is already on screen (the 2-player screen's `gameOverHandledRef` rule, here part of the model).
 *   - Server data is untrusted: an unreadable snapshot or malformed clocks is reported as 'invalid' (the hook resyncs), never thrown.
 *   - The ack of a move and the `four_state` it caused can arrive in either order as far as this file is concerned; the state is what
 *     clears `pending`, the ack only ever reports a REFUSAL.
 *   - Time is passed in (`now`), never read, so the tests are deterministic and a render can use one timestamp for everything.
 */

import {
  BISHOP,
  KNIGHT,
  QUEEN,
  ROOK,
  applyMoveRaw,
  deserialize,
  describeEvents,
  geometryOf,
  promotionOf,
  rulesFor,
  squareName,
  type FourPlayerClock,
  type FourPlayerRules,
  type FourPlayerState,
  type Move,
  type Seat,
} from './fourPlayer';
import { FOUR_REASONS, fourVariantOf, validateFourVariant } from './fourPlayerWire';
import type {
  FourClocksMs,
  FourGameOverPayload,
  FourLogEntry,
  FourMakeMovePayload,
  FourMatchFoundPayload,
  FourPromotion,
  FourRoomState,
  FourSeatUpdatePayload,
  FourSeats,
  FourStatePayload,
  FourTimeControl,
  FourVariant,
} from './fourPlayerWire';

/** A move the player has made but the server has not yet confirmed. `id` tells one pending move from the next, so a late refusal of an
 * earlier move can never roll back a later one. */
export interface FourPendingMove {
  id: number;
  move: Move;
  /** The authority with `move` applied (same `turn`: the engine's `applyMoveRaw` does not pass it on). Display only. */
  state: FourPlayerState;
}

export interface FourOnlineView {
  roomId: string;
  /** Which game this room plays (4 Player Chess or Giveaway): picks the rules every snapshot is read with. Absent from an older server's payloads = Chess. */
  variant: FourVariant;
  /** The seat this client plays; null for a spectator (who owns no seat and can never move). */
  mySeat: Seat | null;
  timeControl: FourTimeControl;
  timeControlLabel: string;
  seats: FourSeats;
  /** When `seats` was received, for the cosmetic grace countdown. */
  seatsAt: number;
  /** The `seq` of the snapshot in `state`. */
  seq: number;
  /** THE AUTHORITY: the last adopted snapshot. Never edited by a local move. */
  state: FourPlayerState;
  clocksMs: FourClocksMs;
  /** When `clocksMs` was received: the seat on move runs down from here on the screen (cosmetic; the server decides flag falls). */
  clocksAt: number;
  log: readonly FourLogEntry[];
  lastMove: { from: number; to: number; /** The move was a promotion (Chaturaji's automatic one is announced on the board). */ promoted?: boolean } | null;
  /** Presentation lines for the latest state ("Blue was checkmated by Red (+20)"). */
  notices: readonly string[];
  pending: FourPendingMove | null;
  /** Counts moves begun, to give each its own `id`. */
  moveCounter: number;
  /** Why the last move was refused (or "not confirmed"); cleared by the next move or the next adopted state. */
  moveError: string | null;
  /** A `four_rejoin` is in flight (after a gap, an unreadable state, an unconfirmed move, a reconnect). The player may not move meanwhile. */
  resyncing: boolean;
  gameOver: FourGameOverPayload | null;
}

// --- Building a view ------------------------------------------------------------------------------------------------------------

const isClocksMs = (value: unknown): value is FourClocksMs =>
  Array.isArray(value) && value.length === 4 && value.every((ms) => typeof ms === 'number' && Number.isFinite(ms) && ms >= 0);

const isSeatNumber = (value: unknown): value is Seat => value === 0 || value === 1 || value === 2 || value === 3;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Four well-formed seats. The screens read `kind`, `name` and `connected` of every one while drawing, so a malformed list must never get that far. */
export function isFourSeats(value: unknown): value is FourSeats {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((seat) => isObject(seat) && isSeatNumber(seat.seat) && (seat.kind === 'human' || seat.kind === 'bot') && typeof seat.name === 'string' && typeof seat.connected === 'boolean')
  );
}

const REASONS: readonly unknown[] = FOUR_REASONS; // the wire's own list: a reason added to the engine cannot be missing here

/** A well-formed `four_game_over`: the status line and the result card read `reason`, `winners` and `scores` while drawing. */
export function isGameOverPayload(value: unknown): value is FourGameOverPayload {
  return (
    isObject(value) &&
    typeof value.roomId === 'string' &&
    REASONS.includes(value.reason) &&
    Array.isArray(value.winners) &&
    value.winners.every(isSeatNumber) &&
    Array.isArray(value.scores) &&
    value.scores.length === 4 &&
    value.scores.every((score) => typeof score === 'number' && Number.isFinite(score)) &&
    typeof value.state === 'string'
  );
}

const isTimeControl = (value: unknown): value is FourTimeControl =>
  isObject(value) && typeof value.initialSeconds === 'number' && typeof value.incrementSeconds === 'number' && Number.isFinite(value.initialSeconds) && Number.isFinite(value.incrementSeconds);

/**
 * The engine's own parser, wrapped: server text that does not parse is "no snapshot", never an exception in a render or a listener. The text carries no
 * rules (the snapshot format is the same for both variants), so the caller passes the room's: `rulesFor(view.variant)`. Omitted = 4 Player Chess.
 */
export function readSnapshot(text: unknown, rules?: FourPlayerRules): FourPlayerState | null {
  // EQUIVALENT-MUTANT NOTE (mutation set W5, "snapshot: non-string accepted"): this check is a fast path. The engine's `deserialize` throws on
  // anything but its own text format, and the catch below turns every throw into `null`, so removing the check changes no result.
  if (typeof text !== 'string') return null;
  try {
    return deserialize(text, rules);
  } catch {
    return null;
  }
}

function viewFromParts(room: Omit<FourRoomState, 'log'> & { log?: readonly FourLogEntry[] }, mySeat: Seat | null, now: number): FourOnlineView | null {
  const variant = validateFourVariant(room.variant); // an unknown variant is a room this client cannot play
  if (!variant.ok) return null;
  const state = readSnapshot(room.state, rulesFor(variant.value));
  if (!state || !isClocksMs(room.clocksMs) || !isFourSeats(room.seats) || !isTimeControl(room.timeControl) || typeof room.roomId !== 'string') return null;
  return {
    roomId: room.roomId,
    variant: variant.value,
    mySeat,
    timeControl: room.timeControl,
    timeControlLabel: room.timeControlLabel,
    seats: room.seats,
    seatsAt: now,
    seq: room.seq,
    state,
    clocksMs: room.clocksMs,
    clocksAt: now,
    log: Array.isArray(room.log) ? room.log : [],
    lastMove: null,
    notices: [],
    pending: null,
    moveCounter: 0,
    moveError: null,
    resyncing: false,
    gameOver: null,
  };
}

/** The first view of a game: from `four_match_found` (seq 0). Null if the snapshot or clocks are unreadable. */
export function viewFromMatch(match: FourMatchFoundPayload, now: number): FourOnlineView | null {
  return viewFromParts(match, match.seat, now);
}

/** A view of a room the client is watching, or rebuilding from a rejoin answer (`mySeat` null = spectator). */
export function viewFromRoom(room: FourRoomState, mySeat: Seat | null, now: number): FourOnlineView | null {
  return viewFromParts(room, mySeat, now);
}

// --- Adopting what the server says ----------------------------------------------------------------------------------------------

export type FourStateOutcome =
  | 'applied' // seq was exactly current + 1: adopted
  | 'duplicate' // seq == current: ignored
  | 'stale' // seq < current (arrived late / out of order): ignored
  | 'gap' // seq > current + 1: the caller must send ONE four_rejoin
  | 'gapPending' // a gap again while that rejoin is already in flight: nothing more to send
  | 'wrongRoom'
  | 'finished' // the game is over: nothing may change the result on screen
  | 'invalid'; // unreadable snapshot / clocks / seq: the caller resyncs

export interface FourStateResult {
  view: FourOnlineView;
  outcome: FourStateOutcome;
  /** True exactly when the caller must send ONE `four_rejoin` now (a gap or an unreadable state, and none already in flight). */
  resync: boolean;
}

/**
 * Applies one `four_state`. The view is returned BY REFERENCE UNCHANGED for everything but 'applied', 'gap' and 'invalid' (where only
 * `resyncing` flips, and only the first time), so a caller can tell "nothing happened" with `===` and a React `setState` skips the render.
 */
export function applyFourState(view: FourOnlineView, payload: FourStatePayload, now: number): FourStateResult {
  if (payload.roomId !== view.roomId) return { view, outcome: 'wrongRoom', resync: false };
  if (view.gameOver) return { view, outcome: 'finished', resync: false };
  if (!Number.isInteger(payload.seq) || payload.seq < 0) return { ...needResync(view), outcome: 'invalid' };
  if (payload.seq === view.seq) return { view, outcome: 'duplicate', resync: false };
  if (payload.seq < view.seq) return { view, outcome: 'stale', resync: false };
  if (payload.seq > view.seq + 1) {
    const begun = needResync(view);
    return { ...begun, outcome: begun.resync ? 'gap' : 'gapPending' };
  }
  const state = readSnapshot(payload.state, rulesFor(view.variant));
  if (!state || !isClocksMs(payload.clocksMs)) return { ...needResync(view), outcome: 'invalid' };
  const move = isObject(payload.move) ? payload.move : null;
  const parse = geometryOf(state.rules).parseSquare; // the squares the server named are the room's own board's
  const from = move ? parse(move.from) : -1;
  const to = move ? parse(move.to) : -1;
  return {
    outcome: 'applied',
    resync: false,
    view: {
      ...view,
      seq: payload.seq,
      state,
      clocksMs: payload.clocksMs,
      clocksAt: now,
      // EQUIVALENT-MUTANT NOTE (mutation set W5, "state: log entry has wrong seat"): replacing `move.seat` with `view.state.turn` changes nothing
      // observable, because in any valid flow the mover's seat IS the previous snapshot's turn. `move.seat` is kept as the server's own word for who moved.
      log: move && isSeatNumber(move.seat) && typeof move.label === 'string' ? [...view.log, { seat: move.seat, text: move.label }] : view.log,
      lastMove: from >= 0 && to >= 0 ? { from, to, ...(move && typeof move.promotion === 'string' ? { promoted: true } : {}) } : view.lastMove,
      notices: Array.isArray(payload.events) ? describeEvents(payload.events) : [],
      pending: null,
      moveError: null,
    },
  };
}

/** A rejoin is needed; `resync` is false when one is already in flight (or the game is over), so it is never sent twice. */
function needResync(view: FourOnlineView): { view: FourOnlineView; resync: boolean } {
  const begun = beginResync(view);
  return { view: begun.view, resync: begun.send };
}

export type FourAdoptOutcome ='adopted' | 'stale' | 'wrongRoom' | 'finished' | 'invalid';

/**
 * Adopts a whole-room answer (`four_rejoin`, `four_spectate_game`). Newer or equal `seq` replaces the authority, the seats and the log
 * and ends the resync; an OLDER answer changes nothing but still ends the resync (the request has been answered). `pending` survives an
 * answer of the same `seq` (the move's own ack and state decide it) and is dropped by a newer one.
 */
export function adoptSnapshot(view: FourOnlineView, room: FourRoomState, now: number): { view: FourOnlineView; outcome: FourAdoptOutcome } {
  if (room.roomId !== view.roomId) return { view, outcome: 'wrongRoom' };
  if (view.gameOver) return { view, outcome: 'finished' };
  // A room never changes variant: an answer that names another one (or an unknown one) is not this room's.
  const variant = validateFourVariant(room.variant);
  if (!variant.ok || variant.value !== view.variant) return { view, outcome: 'invalid' };
  const state = readSnapshot(room.state, rulesFor(view.variant));
  if (!state || !isClocksMs(room.clocksMs) || !isFourSeats(room.seats) || !Number.isInteger(room.seq)) return { view, outcome: 'invalid' };
  if (room.seq < view.seq) return { view: view.resyncing ? { ...view, resyncing: false } : view, outcome: 'stale' };
  const advanced = room.seq > view.seq;
  return {
    outcome: 'adopted',
    view: {
      ...view,
      seats: room.seats,
      seatsAt: now,
      seq: room.seq,
      state,
      clocksMs: room.clocksMs,
      clocksAt: now,
      log: Array.isArray(room.log) ? room.log : view.log,
      lastMove: advanced ? null : view.lastMove,
      notices: advanced ? [] : view.notices,
      pending: advanced ? null : view.pending,
      moveError: advanced ? null : view.moveError,
      resyncing: false,
    },
  };
}

/** `four_seat_update`: who holds each seat now (a disconnect, a takeover, a retake). No `seq`: the last one wins, as they arrive in order. */
export function applySeatUpdate(view: FourOnlineView, payload: FourSeatUpdatePayload, now: number): FourOnlineView {
  if (payload.roomId !== view.roomId || !isFourSeats(payload.seats)) return view;
  return { ...view, seats: payload.seats, seatsAt: now };
}

/**
 * `four_game_over` (live, or inside a rejoin answer for a game that ended while the client was away). The first one wins; later ones
 * (a live result followed by a rejoin answer) change nothing. The final snapshot it carries is adopted, which also covers a client that
 * missed the last `four_state`.
 */
export function applyGameOver(view: FourOnlineView, payload: FourGameOverPayload): FourOnlineView {
  if (!isGameOverPayload(payload) || payload.roomId !== view.roomId || view.gameOver) return view;
  const state = readSnapshot(payload.state, rulesFor(view.variant)) ?? view.state;
  return { ...view, state, gameOver: payload, pending: null, resyncing: false };
}

// --- Resync bookkeeping -----------------------------------------------------------------------------------------------------------

/** Marks a rejoin as in flight. `send` is true only for the caller that must actually emit it: one request at a time, none after the end. */
export function beginResync(view: FourOnlineView): { view: FourOnlineView; send: boolean } {
  if (view.resyncing || view.gameOver) return { view, send: false };
  return { view: { ...view, resyncing: true }, send: true };
}

/** The rejoin got no usable answer (timeout): allow the next gap or reconnect to try again. */
export function failResync(view: FourOnlineView): FourOnlineView {
  return view.resyncing ? { ...view, resyncing: false } : view;
}

// --- The player's own move: optimistic apply, confirm, refuse ----------------------------------------------------------------------

/** Whether the player may make a move right now (the board's `interactive`, the Resign enablement is separate). */
export function canMove(view: FourOnlineView, connected: boolean): boolean {
  const seat = view.mySeat;
  return (
    seat !== null &&
    connected &&
    !view.resyncing &&
    !view.pending &&
    !view.gameOver &&
    !view.state.result &&
    view.state.turn === seat &&
    view.state.status[seat] === 'active'
  );
}

/**
 * Shows `move` at once (as `pending`) and returns its `id`. Refused (`id` null, view unchanged) when the player may not move: not their
 * turn, a move already pending, a resync in flight, game over. The caller sends the move only when `id` is not null.
 */
export function beginMove(view: FourOnlineView, move: Move): { view: FourOnlineView; id: number | null } {
  if (!canMove(view, true)) return { view, id: null };
  const id = view.moveCounter + 1;
  return {
    id,
    view: { ...view, moveCounter: id, moveError: null, pending: { id, move, state: applyMoveRaw(view.state, move) } },
  };
}

/** The server accepted the move AND its resulting state is already adopted: nothing left pending. (Normally the state itself cleared it.) */
export function moveAcked(view: FourOnlineView, id: number, ackSeq: number): FourOnlineView {
  if (!view.pending || view.pending.id !== id || view.seq < ackSeq) return view;
  return { ...view, pending: null };
}

/**
 * The server refused the move (an error ack), or never answered (`timedOut`). If it is STILL the pending move, it is dropped: the screen
 * draws the last authoritative snapshot again, and `rolledBack` tells the caller to reset the board's selection. A refusal of an
 * EARLIER move (its id is no longer pending) records nothing on the board, but its message is still shown ("your flag fell").
 */
export function moveRejected(view: FourOnlineView, id: number, error: string): { view: FourOnlineView; rolledBack: boolean } {
  const rolledBack = view.pending?.id === id;
  return { rolledBack, view: { ...view, moveError: error, pending: rolledBack ? null : view.pending } };
}

/**
 * The wire payload for a move the engine produced (squares as names, the promotion piece as q/r/b/n). The squares are named on the board of the ROOM (`rules`): the same
 * square index is "e4" on one board and a different square on the other, and the server validates against its room's board (Chaturaji W3 - found by a screen-level test:
 * the cross board's names would have sent every Chaturaji move to the wrong square).
 */
export function movePayloadFor(roomId: string, move: Move, rules?: FourPlayerRules): FourMakeMovePayload {
  const piece = promotionOf(move);
  const promotion: FourPromotion | undefined = piece === ROOK ? 'r' : piece === BISHOP ? 'b' : piece === KNIGHT ? 'n' : piece === QUEEN ? 'q' : undefined;
  const name = rules ? geometryOf(rules).squareName : squareName;
  return { roomId, from: name(move.from), to: name(move.to), ...(promotion ? { promotion } : {}) };
}

// --- What to draw -------------------------------------------------------------------------------------------------------------------

/** The position the board shows: the optimistic copy while a move is pending, otherwise the authority. */
export function displayState(view: FourOnlineView): FourPlayerState {
  return view.pending ? view.pending.state : view.state;
}

/**
 * The four clocks to show at `now`: the authority's, with the seat on move running down since they were received. Cosmetic only: it
 * never "flags" anybody (the server decides that and says so in a `four_state`), is never below 0, and stops at the end of the game.
 */
export function displayClocksMs(view: FourOnlineView, now: number): FourClocksMs {
  const ms: FourClocksMs = [view.clocksMs[0], view.clocksMs[1], view.clocksMs[2], view.clocksMs[3]];
  const turn = view.state.turn;
  if (!view.gameOver && !view.state.result && view.state.status[turn] === 'active') ms[turn] = Math.max(0, ms[turn] - Math.max(0, now - view.clocksAt));
  return ms;
}

/** The clocks in the shape `FourPlayerSeatStrip` takes (seconds). */
export function displayClock(view: FourOnlineView, now: number): FourPlayerClock {
  const ms = displayClocksMs(view, now);
  return { enabled: true, incrementSeconds: view.timeControl.incrementSeconds, seconds: [ms[0] / 1000, ms[1] / 1000, ms[2] / 1000, ms[3] / 1000] };
}
