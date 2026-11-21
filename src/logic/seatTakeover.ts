/**
 * "Seat taken over" (command #68, TODO "Rejoin ... two known limits"): the same account opened the SAME online game on a second tab or device.
 * The server seats whoever rejoins with the player token last and tells the OLD socket so (`seat_taken_over` for a 2-player room, rooms.ts;
 * `four_seat_taken_over` for a 4-seat room, fourPlayerRooms.ts, both with `{ roomId }`). The old screen then leaves the game with this
 * message instead of showing a game it no longer owns.
 *
 * Gotchas:
 * - the old screen must NOT rejoin on its own afterwards (a dropped-and-restored connection rejoins automatically): that would steal the
 *   seat back and the two would fight over it for ever. Both screens stop listening / rejoining once taken over.
 * - the old screen must NOT clear the persisted rejoin record (activeGameStorage.ts): two tabs of one browser profile share it, and it is
 *   the NEW tab's record now. App.tsx's exit path skips the clear for this reason.
 */

export const SEAT_TAKEN_OVER_EVENT = 'seat_taken_over';

export interface SeatTakenOverPayload {
  roomId: string;
}

export const SEAT_TAKEN_OVER_MESSAGE = 'This game was opened on another tab or device signed in to your account. It continues there.';

/** True when an inbound `seat_taken_over` / `four_seat_taken_over` payload is about THIS room (anything else is dropped). */
export function isSeatTakeoverFor(payload: unknown, roomId: string): boolean {
  return !!payload && typeof payload === 'object' && (payload as { roomId?: unknown }).roomId === roomId;
}
