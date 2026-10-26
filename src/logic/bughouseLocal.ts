/**
 * Bughouse W3a: the state of a LOCAL game (this device plays every seat: humans at the screen, bots on the W2 bot). A thin layer over the engine: every input and every timer goes through
 * the engine's `settle(match, input | null, nowMs)` with ONE integer clock (the Local clock uses the W1 settle rules: due flags first, no draws, the tie-break of clock.ts), so the Local
 * game cannot disagree with an Online one. What this adds is only what a screen needs and the engine does not keep: the last move of each board and the piece that was just banked into a
 * partner's pocket (for the highlight). Pure: the caller passes the instant; nothing here reads a clock.
 */
import type { ReservePieceType } from './crazyhouse';
import { chooseBughouseAction, createMatch, runningClocks, settle, type BughouseAction, type BughouseEvent, type BughouseMatch, type BughouseTimeControl, type SettleOutcome } from './bughouse';
import { BOARD_IDS, seatAt, type BoardId, type BughouseSeat } from './bughouse/types';
import type { SeatConfig } from './fourPlayer/setup';

export interface LastMove {
  from: string;
  to: string;
}

/** A capture that put a piece in `seat`'s pocket at commit `seq` (the capturer's partner, on the other board). */
export interface BankFlash {
  seat: BughouseSeat;
  piece: ReservePieceType;
  seq: number;
}

export interface LocalGameState {
  readonly match: BughouseMatch;
  readonly lastMove: Readonly<Record<BoardId, LastMove | null>>;
  readonly bank: BankFlash | null;
}

export function startLocalGame(timeControl: BughouseTimeControl, startMs: number, roomNumber: number): LocalGameState {
  return { match: createMatch({ timeControl, roomNumber, startMs }), lastMove: { A: null, B: null }, bank: null };
}

/** What a commit's events change in the screen-only state. */
function afterEvents(state: LocalGameState, match: BughouseMatch, events: readonly BughouseEvent[]): LocalGameState {
  let lastMove = state.lastMove;
  let bank = state.bank;
  for (const event of events) {
    if (event.kind === 'move') lastMove = { ...lastMove, [event.board]: { from: event.from, to: event.to } };
    else if (event.kind === 'drop') lastMove = { ...lastMove, [event.board]: { from: event.square, to: event.square } };
    else if (event.kind === 'bank') bank = { seat: event.seat, piece: event.piece, seq: event.seq };
  }
  return { match, lastMove, bank };
}

export interface LocalStep {
  state: LocalGameState;
  outcome: SettleOutcome;
}

/**
 * One step: an action by `seat` (or a timer, `action` null) at the instant `nowMs`. The instant is raised to the match's own latest one (a clock that reads a hair behind cannot wedge
 * the game). A refusal returns the very same state.
 */
export function localStep(state: LocalGameState, input: { seat: BughouseSeat; action: BughouseAction } | null, nowMs: number): LocalStep {
  const at = Math.max(nowMs, state.match.nowMs);
  const outcome = settle(state.match, input, at);
  if (outcome.kind === 'applied' || outcome.kind === 'flag') return { state: afterEvents(state, outcome.match, outcome.events), outcome };
  return { state, outcome };
}

/** The clock timers a screen needs: for each board with a running clock, the instant its flag falls (the smallest). Empty once the match is over. */
export function nextDeadline(match: BughouseMatch): number | null {
  const running = runningClocks(match);
  return running.length === 0 ? null : Math.min(...running.map((c) => c.deadline));
}

// --- Bots -------------------------------------------------------------------------------------------------------------------------------------

/** The think delay of a Local bot: 200 ms in bullet (up to 2 | 1), 450 ms above - the server's numbers, so Local and Online bots move at the same pace. */
export function bughouseBotThinkMs(initialMs: number): number {
  return initialMs <= 120000 ? 200 : 450;
}

/** The bot seats that are on move now (at most one per board), in board order. */
export function dueBotSeats(config: SeatConfig, match: BughouseMatch): BughouseSeat[] {
  if (match.result !== null) return [];
  const due: BughouseSeat[] = [];
  for (const board of BOARD_IDS) {
    const verdict = match.verdicts[board];
    if (verdict.status === 'stuck') continue;
    const seat = seatAt(board, verdict.turn);
    if (config[seat].kind === 'bot') due.push(seat);
  }
  return due;
}

/** The bot's turn for `seat`: the W2 bot at the seat's ELO, `rng` injected. Null when the seat has nothing to do. */
export function localBotAction(config: SeatConfig, match: BughouseMatch, seat: BughouseSeat, rng: () => number): BughouseAction | null {
  const controller = config[seat];
  if (controller.kind !== 'bot') return null;
  return chooseBughouseAction(match, seat, controller.elo, rng);
}
