/**
 * 4 Player Chess — pure helpers for the UI (kept out of the React Native components so they can be unit-tested without a renderer).
 */

import { SEAT_NAMES, SIZE } from './board';
import type { GameEvent } from './elimination';
import type { SeatController } from './setup';

/** The pixel size of one board square: as large as the width allows, capped by the height left over for the rest of the game screen. */
export function getFourPlayerCellSize(viewportWidth: number, viewportHeight: number): number {
  const byWidth = Math.floor((viewportWidth - 16) / SIZE);
  const byHeight = Math.floor((viewportHeight - 330) / SIZE);
  return Math.max(20, Math.min(byWidth, byHeight, 34));
}

const SHORT_LEVEL = { easy: 'easy', medium: 'med', hard: 'hard' } as const;

/** "Human" / "Bot med" — short enough for the four seat chips across a phone screen. */
export function shortController(controller: SeatController): string {
  return controller.kind === 'human' ? 'Human' : `Bot ${SHORT_LEVEL[controller.level]}`;
}

/** One human-readable line per notable event ("Blue was checkmated by Red (+20)"); ordinary moves produce nothing. */
export function describeEvents(events: readonly GameEvent[]): string[] {
  const lines: string[] = [];
  for (const event of events) {
    if (event.kind === 'eliminated') {
      const name = SEAT_NAMES[event.seat];
      if (event.reason === 'checkmate') lines.push(`${name} was checkmated${event.credit !== null ? ` by ${SEAT_NAMES[event.credit]} (+20)` : ''}`);
      else if (event.reason === 'stalemate') lines.push(`${name} was stalemated (+20 to ${name}, +10 to the others)`);
      else lines.push(`${name} ${event.reason === 'resign' ? 'resigned' : 'ran out of time'}`);
    } else if (event.kind === 'frozen') {
      lines.push(`${SEAT_NAMES[event.seat]}'s king can no longer move`);
    }
  }
  return lines;
}
