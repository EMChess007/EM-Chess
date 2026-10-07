/**
 * 4 Player Chess — who controls each seat. A game is configured as one controller per seat (Red, Blue, Yellow, Green), each either a
 * human at the device or a bot of a given ELO (one of the roster bots: Kiddo 400 … The Unbeatable 3000 — see bots.ts; this folder only
 * stores the number, and bot.ts turns it into playing strength). The setup screen edits one of these and the game screen plays it.
 * Hotseat (several humans), 1 human + 3 bots and any mix in between are all just different SeatConfigs — there is no separate "mode".
 */

import type { Seat } from './board';

export type SeatController = { kind: 'human' } | { kind: 'bot'; elo: number };
export type SeatConfig = readonly [SeatController, SeatController, SeatController, SeatController];

const HUMAN: SeatController = { kind: 'human' };

/** The ELO a seat gets when it is switched to a bot (Amateur 1200 in the roster). */
export const DEFAULT_BOT_ELO = 1200;

/** Red is the human, the other three seats are bots of `elo`. */
export function defaultSeatConfig(elo: number = DEFAULT_BOT_ELO): SeatConfig {
  return [HUMAN, { kind: 'bot', elo }, { kind: 'bot', elo }, { kind: 'bot', elo }];
}

export function withController(config: SeatConfig, seat: Seat, controller: SeatController): SeatConfig {
  const next = [...config] as unknown as [SeatController, SeatController, SeatController, SeatController];
  next[seat] = controller;
  return next;
}

export function humanSeats(config: SeatConfig): Seat[] {
  return ([0, 1, 2, 3] as Seat[]).filter((seat) => config[seat].kind === 'human');
}

/** A game needs at least one human at the device. */
export function isStartable(config: SeatConfig): boolean {
  return humanSeats(config).length >= 1;
}

/** Which seat sits at the bottom of the screen at the start: the only human's, otherwise Red's. */
export function defaultViewSeat(config: SeatConfig): Seat {
  const humans = humanSeats(config);
  return humans.length === 1 ? humans[0] : 0;
}

export function describeController(controller: SeatController): string {
  return controller.kind === 'human' ? 'Human' : `Bot (ELO ${controller.elo})`;
}
