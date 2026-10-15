/**
 * 4 Player Chess — pure helpers for the UI (kept out of the React Native components so they can be unit-tested without a renderer).
 */

import { SEAT_NAMES, SIZE } from './board';
import type { GameEvent } from './elimination';
import type { FourPlayerResult } from './state';
import type { SeatController } from './setup';

/** The pixel size of one board square: as large as the width allows, capped by the height left over for the rest of the game screen. */
export function getFourPlayerCellSize(viewportWidth: number, viewportHeight: number): number {
  const byWidth = Math.floor((viewportWidth - 16) / SIZE);
  const byHeight = Math.floor((viewportHeight - 345) / SIZE);
  return Math.max(20, Math.min(byWidth, byHeight, 34));
}

/**
 * Piece themes (Cburnett, Merida, uploaded sets …) only draw two colours, white and black, keyed `${'w'|'b'}${'p'|'n'|'b'|'r'|'q'|'k'}`.
 * The four seats cannot each have their own art, so the board draws the theme's piece on a disc in the seat's colour and picks the set
 * that contrasts with it: the white set on the dark seats (Red, Blue, Green), the black set on Yellow.
 */
export const SEAT_PIECE_SET = ['w', 'w', 'b', 'w'] as const;
const PIECE_KEY_LETTER = ['', 'p', 'n', 'b', 'r', 'q', 'k', 'q', 'n', 'b', 'r']; // by piece type; a promoted piece is drawn as the piece it became

/** The theme image key for a piece of `seat` and engine piece `type` (1 pawn … 6 king, 7-10 promoted queen / knight / bishop / rook): 'wn', 'bq', … */
export function seatPieceImageKey(seat: number, type: number): string {
  return `${SEAT_PIECE_SET[seat]}${PIECE_KEY_LETTER[type]}`;
}

/** "Human" / "Bot 1400" — short enough for the four seat cards across a phone screen (the screens show the roster name when there is room). */
export function shortController(controller: SeatController): string {
  return controller.kind === 'human' ? 'Human' : `Bot ${controller.elo}`;
}

/** The clock under a seat's name: "m:ss" ("h:mm:ss" past an hour), rounded UP so a seat is never shown 0:00 while it still has time. */
export function formatSeatClock(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds - 1e-9));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const ss = String(secs).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`;
}

/** The line under the final ranking explaining why the game ended. */
export function describeResultReason(reason: FourPlayerResult['reason']): string {
  if (reason === 'cap') return 'Move limit reached — scored by points.';
  if (reason === 'deadPosition') return 'Only bare kings are left, so no checkmate is possible — highest score wins.';
  // 4 Player GIVEAWAY reasons (W1 makes the function total; the variant-aware Giveaway wording, e.g. the cap's "fewest pieces wins", is the screens' job in W3).
  if (reason === 'outOfPieces') return 'A player lost their last piece and wins.';
  if (reason === 'stuck') return 'A player had no legal move and wins.';
  if (reason === 'lastStanding') return 'Everyone else resigned or ran out of time.';
  return 'Three players eliminated — highest score wins.';
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
