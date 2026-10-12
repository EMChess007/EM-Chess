/**
 * 4 Player Chess ONLINE — the wording and list-building the screens need, kept pure for the same reason as `fourPlayerOnline.ts` (no
 * renderer in the tests): who is sitting where and what to call them, the queue line, the result table, the combined Spectate list and the
 * chat log. Nothing here talks to the socket or to React.
 *
 * The seat names and badges are the spec's exact wording (FOUR_PLAYER_ONLINE_SPEC.md §6.2, §8): a fill bot is "Bot (Amateur)"; a seat a
 * bot took over keeps the human's name and gets a "bot playing" badge; a human who dropped shows "offline" with the grace countdown.
 */

import { SEAT_NAMES, describeResultReason, isInCheck, type Seat } from './fourPlayer';
import type { FourOnlineView } from './fourPlayerOnline';
import type { FourActiveGameSummary, FourGameOverPayload, FourQueueUpdatePayload, FourSeatInfo } from './fourPlayerWire';
import type { ActiveGameSummary } from '../types/multiplayer';

// --- Seats --------------------------------------------------------------------------------------------------------------------------

export interface FourSeatLabel {
  /** The line under the clock: the player's name, "(you)" for the viewer's own seat. */
  name: string;
  /** A second small line, or null: "bot playing" (a takeover) or "offline · 32s" (a human inside the grace period). */
  badge: string | null;
}

/** Whole seconds of the 45 s grace left for a disconnected human, counted down from when the seats were received; never below 0. */
export function graceSecondsLeft(seat: FourSeatInfo, seatsAt: number, now: number): number | null {
  if (seat.graceMsLeft === undefined) return null;
  return Math.max(0, Math.ceil((seat.graceMsLeft - Math.max(0, now - seatsAt)) / 1000));
}

export function seatLabel(seat: FourSeatInfo, isMe: boolean, seatsAt: number, now: number): FourSeatLabel {
  const name = isMe ? `${seat.name} (you)` : seat.name;
  if (seat.kind === 'bot') return { name, badge: seat.botReason === 'takeover' ? 'bot playing' : null };
  if (!seat.connected) {
    const left = graceSecondsLeft(seat, seatsAt, now);
    return { name, badge: left === null ? 'offline' : `offline · ${left}s` };
  }
  return { name, badge: null };
}

export function seatLabels(view: Pick<FourOnlineView, 'seats' | 'seatsAt' | 'mySeat'>, now: number): FourSeatLabel[] {
  return view.seats.map((seat, index) => seatLabel(seat, view.mySeat === index, view.seatsAt, now));
}

// --- Status and result ---------------------------------------------------------------------------------------------------------------

const seatName = (seat: Seat): string => SEAT_NAMES[seat];

function describeWinners(winners: readonly Seat[]): string {
  const names = winners.map(seatName).join(' & ');
  return winners.length > 1 ? `Game over — ${names} tie` : `Game over — ${names} wins`;
}

/** The status line above the board. */
export function describeStatus(view: FourOnlineView): string {
  if (view.gameOver) return view.gameOver.reason === 'abandoned' ? 'Game abandoned — no result' : describeWinners(view.gameOver.winners);
  const result = view.state.result;
  if (result) return describeWinners(result.winners);
  const turn = view.state.turn;
  const info = view.seats[turn];
  const check = isInCheck(view.state, turn) ? ' — in check!' : '';
  if (view.mySeat === turn) return `Your move${check}`;
  if (info.kind === 'bot') return `${seatName(turn)} (bot) is thinking…`;
  if (!info.connected) return `${seatName(turn)} (${info.name}) is offline${check}`;
  return `${seatName(turn)} (${info.name}) to move${check}`;
}

export interface FourResultRow {
  place: number;
  seat: Seat;
  name: string;
  score: number;
  winner: boolean;
}

/** The final ranking (highest score first, ties by seat order). Empty for an abandoned game: it has no result, so no scores are shown. */
export function resultRows(gameOver: FourGameOverPayload, seats: readonly FourSeatInfo[]): FourResultRow[] {
  if (gameOver.reason === 'abandoned') return [];
  return ([0, 1, 2, 3] as Seat[])
    .slice()
    .sort((a, b) => (gameOver.scores[b] ?? 0) - (gameOver.scores[a] ?? 0) || a - b)
    .map((seat, index) => ({ place: index + 1, seat, name: seats[seat]?.name ?? seatName(seat), score: gameOver.scores[seat] ?? 0, winner: gameOver.winners.includes(seat) }));
}

export function describeFourResultNote(reason: FourGameOverPayload['reason']): string {
  return reason === 'abandoned' ? 'Every human player left, so the game was ended with no result.' : describeResultReason(reason);
}

/** Whether leaving now abandons a live seat (so the screen must confirm, and the menu can offer "Return to your game"). */
export function isLiveSeat(view: Pick<FourOnlineView, 'mySeat' | 'gameOver' | 'state'>): boolean {
  return view.mySeat !== null && !view.gameOver && !view.state.result;
}

/** The leave dialog, exactly as decided: a bot plays on after the grace period, and the player can come back until the game ends. */
export const LEAVE_GAME_TITLE = 'Leave the game?';
export const LEAVE_GAME_MESSAGE = 'A bot takes your seat after 45s. You can return until the game ends.';

// --- Queue ----------------------------------------------------------------------------------------------------------------------------

/** Whole seconds until the bots fill the table, or null while fewer than two people are waiting. Counted from when the update arrived. */
export function fillSecondsLeft(update: FourQueueUpdatePayload | null, receivedAt: number, now: number): number | null {
  // EQUIVALENT-MUTANT NOTE (mutation set W5, "ui: fill countdown for one player"): `=== null` is spelled out for the reader; `Number.isFinite(null)`
  // is already false, so dropping it changes no result (the null/NaN/Infinity cases are pinned in the tests anyway).
  if (!update || update.fillInMs === null || !Number.isFinite(update.fillInMs)) return null;
  return Math.max(0, Math.ceil((update.fillInMs - Math.max(0, now - receivedAt)) / 1000));
}

export function describeQueue(update: FourQueueUpdatePayload | null, secondsLeft: number | null): { title: string; detail: string } {
  if (!update) return { title: 'Looking for a game…', detail: 'Joining the queue.' };
  const people = `${update.queued} ${update.queued === 1 ? 'player' : 'players'} waiting`;
  if (secondsLeft === null) return { title: people, detail: 'Waiting for at least one more player. Bots fill the empty seats once two are here.' };
  return { title: people, detail: `Bots fill the empty seats in ${secondsLeft}s, sooner if more players join.` };
}

// --- Chat ----------------------------------------------------------------------------------------------------------------------------

export interface FourChatEntry {
  id: number;
  /** null for the viewer's own line. */
  fromSeat: Seat | null;
  name: string;
  text: string;
  mine: boolean;
}

export const FOUR_CHAT_LOG_MAX = 200;

/** Appends a line, keeping the newest FOUR_CHAT_LOG_MAX (a chatty room cannot grow the log for ever). Ids only grow. */
export function appendChat(log: readonly FourChatEntry[], entry: Omit<FourChatEntry, 'id'>, max: number = FOUR_CHAT_LOG_MAX): FourChatEntry[] {
  const id = (log.length > 0 ? log[log.length - 1].id : 0) + 1;
  const next = [...log, { ...entry, id }];
  return next.length > max ? next.slice(next.length - max) : next;
}

// --- Spectate list -------------------------------------------------------------------------------------------------------------------

export type SpectateRow =
  | { key: string; kind: 'header'; title: string }
  | { key: string; kind: 'two'; game: ActiveGameSummary }
  | { key: string; kind: 'four'; game: FourActiveGameSummary };

/**
 * One list for both kinds of game. A section appears only when it has games; `four` is null when the server could not list 4 Player
 * games at all (an older server without the handlers), which must not hide the 2-player list.
 */
export function buildSpectateRows(two: readonly ActiveGameSummary[], four: readonly FourActiveGameSummary[] | null): SpectateRow[] {
  const rows: SpectateRow[] = [];
  if (four && four.length > 0) {
    rows.push({ key: 'header:four', kind: 'header', title: '4 Player Chess' });
    for (const game of four) rows.push({ key: `four:${game.roomId}`, kind: 'four', game });
  }
  if (two.length > 0) {
    if (rows.length > 0) rows.push({ key: 'header:two', kind: 'header', title: 'Head to head' });
    for (const game of two) rows.push({ key: `two:${game.roomId}`, kind: 'two', game });
  }
  return rows;
}

export const describeFourGame = (game: FourActiveGameSummary): string => game.seats.map((seat) => seat.name).join(' · ');
