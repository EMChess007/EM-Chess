/**
 * Bughouse ONLINE (W4): the wording the screens need, kept pure (no React, no socket) so it is tested without a renderer - the twin of `fourPlayerOnlineUi.ts`. Who sits where and what to call
 * them, the line that says "you are Board A, White, Team 1, your partner is ...", the queue text and its countdown, and the seat map the shared game screen is given.
 *
 * Online there is ONE human per device. The game screen of Local (`BughouseGameScreen`) is driven by a `SeatConfig`; online it is given a config in which only the player's own seat is a
 * human, so the layout it derives (own board large + the partner's thumbnail, or two boards side by side) and the touch rule (only my seat's turn is touchable) are the Local ones.
 */
import { DEFAULT_BOT_ELO, type SeatConfig, type SeatController } from './fourPlayer/setup';
import { partnerOf, seatPlace, type BughouseSeat } from './bughouse/types';
import type { BugQueueUpdatePayload, BugSeatInfo } from './bughouse/wire';
import type { BughouseOnlineView } from './bughouseOnline';

/** The seat map the Local game screen is given for an online game: my seat a human, the other three drawn as bots (their real names come from the server, `seatName`). */
export function onlineSeatConfig(mySeat: BughouseSeat): SeatConfig {
  const bot: SeatController = { kind: 'bot', elo: DEFAULT_BOT_ELO };
  const human: SeatController = { kind: 'human' };
  return [0, 1, 2, 3].map((seat) => (seat === mySeat ? human : bot)) as unknown as SeatConfig;
}

/** Whole seconds of the 45 s grace left for a disconnected human, counted from when the seat list arrived; never below 0. */
export function graceSecondsLeft(seat: BugSeatInfo, seatsAt: number, now: number): number | null {
  if (seat.graceMsLeft === undefined) return null;
  return Math.max(0, Math.ceil((seat.graceMsLeft - Math.max(0, now - seatsAt)) / 1000));
}

/** What a seat is called on screen: the server's name, "(you)" for mine, "bot playing" for a seat a bot took over, "offline · 32s" for a human inside the grace period. */
export function seatDisplayName(view: Pick<BughouseOnlineView, 'seats' | 'seatsAt' | 'mySeat' | 'spectator'>, seat: BughouseSeat, now: number): string {
  const info = view.seats[seat];
  const name = view.mySeat === seat && !view.spectator ? `${info.name} (you)` : info.name;
  if (info.kind === 'bot') return info.botReason === 'takeover' ? `${name} (bot playing)` : name;
  if (!info.connected) {
    const left = graceSecondsLeft(info, view.seatsAt, now);
    return left === null ? `${name} (offline)` : `${name} (offline · ${left}s)`;
  }
  return name;
}

/** "Board A · White · Team 1": a seat's place, in the words of the setup screen. */
export function seatPlaceText(seat: BughouseSeat): string {
  const place = seatPlace(seat);
  return `Board ${place.board} · ${place.color === 'w' ? 'White' : 'Black'} · Team ${place.team}`;
}

/** What a spectator's seat map is: no seat of theirs, all four seats drawn from the outside (two humans on two different boards: the screen's equal-boards layout, input switched off). */
export function spectatorSeatConfig(): SeatConfig {
  const bot: SeatController = { kind: 'bot', elo: DEFAULT_BOT_ELO };
  const human: SeatController = { kind: 'human' };
  return [human, bot, human, bot] as unknown as SeatConfig;
}

/**
 * The seat map for a spectator whose window is too small for two equal boards (the "rotate the device" layer would cover them: below 360 x 640 dp-ish, `needsRotateOverlay`): ONE seat
 * drawn as the human's, so the screen shows Board A large and Board B as a thumbnail to tap. Input is switched off by the view's `spectator` flag either way.
 */
export function spectatorStandardSeatConfig(): SeatConfig {
  return onlineSeatConfig(0);
}

/** The line shown above the boards: where I sit and who my partner is (a spectator: whose game it is). */
export function matchIntroLine(view: Pick<BughouseOnlineView, 'seats' | 'mySeat' | 'spectator'>): string {
  if (view.spectator) return `Watching: ${view.seats[0].name} + ${view.seats[3].name} (Team 1) vs ${view.seats[1].name} + ${view.seats[2].name} (Team 2)`;
  const partner = partnerOf(view.mySeat);
  return `You: ${seatPlaceText(view.mySeat)} · Partner: ${view.seats[partner].name} (Board ${seatPlace(partner).board} · ${seatPlace(partner).color === 'w' ? 'White' : 'Black'})`;
}

// --- Queue ---------------------------------------------------------------------------------------------------------------------------

/** Whole seconds until the bots fill the empty seats, counted from when the update arrived; null while fewer than two humans wait. */
export function fillSecondsLeft(update: BugQueueUpdatePayload | null, receivedAt: number, now: number): number | null {
  if (!update || update.fillInMs === null || !Number.isFinite(update.fillInMs)) return null;
  return Math.max(0, Math.ceil((update.fillInMs - Math.max(0, now - receivedAt)) / 1000));
}

export function describeQueue(update: BugQueueUpdatePayload | null, secondsLeft: number | null): { title: string; detail: string } {
  if (!update) return { title: 'Looking for a game…', detail: 'Joining the queue.' };
  const people = `${update.queued} ${update.queued === 1 ? 'player' : 'players'} waiting`;
  if (secondsLeft === null) return { title: people, detail: 'Waiting for at least one more player. Bots fill the empty seats once two are here.' };
  return { title: people, detail: `Bots fill the empty seats in ${secondsLeft}s, sooner if more players join.` };
}

/** Joining the queue got no answer inside the deadline. */
export const QUEUE_NO_ANSWER = "Can't reach the server. Check your connection and try again.";

// --- Quick messages and team chat (W4b; BUGHOUSE_SPEC.md 5.4, HP10) -----------------------------------------------------------------------

/** The ten quick messages, by code 0..9, as literals in the spec's order: the wire carries the code and the RECEIVING client renders the words (never text, so never an injection). */
export const QUICK_MESSAGES = [
  'Need a knight',
  'Need a bishop',
  'Need a rook',
  'Need a queen',
  'Need a pawn',
  "Don't trade",
  'Trade!',
  'Sit / wait',
  'Hurry!',
  'Watch your king',
] as const;

/** The words of a quick-message code, or null for a code outside 0..9 (a server never sends one; a client never shows one). */
export function quickText(code: unknown): string | null {
  return typeof code === 'number' && Number.isInteger(code) && code >= 0 && code < QUICK_MESSAGES.length ? QUICK_MESSAGES[code] : null;
}

/** The header of the chat panel and its empty line: who can read what is written (the server enforces it; the words say it). */
export const TEAM_CHAT_HEADER = 'Team chat - only your partner sees this';
export const TEAM_CHAT_EMPTY = 'No messages yet. Only your partner sees what you write here.';
/** The panel keeps the newest lines only. */
export const TEAM_CHAT_KEEP = 40;

export interface TeamChatEntry {
  readonly id: number;
  readonly seat: BughouseSeat;
  readonly name: string;
  readonly text: string;
  /** The echo of a line this player sent. */
  readonly mine: boolean;
}

/** The chat after `bug_chat_from`; a payload that is not a line (wrong shape, empty text) changes nothing. The list is a new array only when a line was added. */
export function appendTeamChat(list: readonly TeamChatEntry[], payload: unknown, mySeat: BughouseSeat, id: number): readonly TeamChatEntry[] {
  if (typeof payload !== 'object' || payload === null) return list;
  const { seat, name, text } = payload as { seat?: unknown; name?: unknown; text?: unknown };
  if (typeof seat !== 'number' || !Number.isInteger(seat) || seat < 0 || seat > 3 || typeof name !== 'string' || typeof text !== 'string' || text.trim() === '') return list;
  return [...list, { id, seat: seat as BughouseSeat, name, text, mine: seat === mySeat }].slice(-TEAM_CHAT_KEEP);
}

export interface QuickNotice {
  readonly id: number;
  readonly seat: BughouseSeat;
  readonly code: number;
  readonly text: string;
}

/** The notice for `bug_quick_from`, or null (not a seat, a code outside 0..9). */
export function quickNotice(payload: unknown, id: number): QuickNotice | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { seat, code } = payload as { seat?: unknown; code?: unknown };
  const text = quickText(code);
  if (typeof seat !== 'number' || !Number.isInteger(seat) || seat < 0 || seat > 3 || text === null) return null;
  return { id, seat: seat as BughouseSeat, code: code as number, text };
}

/** How long the toast stays, and how long the message stays on the sender's clock (BUGHOUSE_SPEC.md 5.4): literals. */
export const QUICK_TOAST_MS = 2500;
export const QUICK_CLOCK_ICON_MS = 8000;
