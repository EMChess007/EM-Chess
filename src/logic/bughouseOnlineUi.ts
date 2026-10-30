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
export function seatDisplayName(view: Pick<BughouseOnlineView, 'seats' | 'seatsAt' | 'mySeat'>, seat: BughouseSeat, now: number): string {
  const info = view.seats[seat];
  const name = view.mySeat === seat ? `${info.name} (you)` : info.name;
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

/** The line shown above the boards: where I sit and who my partner is. */
export function matchIntroLine(view: Pick<BughouseOnlineView, 'seats' | 'mySeat'>): string {
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
