import type { BugFriendRoomView } from './bughouse/roomWire';
import { normalizeBugRoomCode } from './bughouse/roomWire';
import type { FourFriendRoomView } from './fourPlayerRoomWire';

/**
 * "JOIN BY CODE" FOR EVERY GAME (command #35). A friend types ONE code; which game it belongs to is not asked. The code is tried, in this order, as a 2-player challenge (`join_challenge`), a
 * Crazy Bughouse room (`bug_room_join`) and a 4-seat room (`four_room_join`: 4 Player Chess, 4 Player Giveaway, Chaturaji); the first that accepts it wins. The three servers share one alphabet and
 * length, so every well-formed code is tried against each, and each answers a wrong code with its own ONE sentence - the screen shows the shared sentence below, never which service refused.
 *
 * COST, written down: a code that belongs to the second or third kind counts as a failed guess against the first one or two (each has its own join limiter: 5 failures per socket in 5 minutes,
 * 10 per user in 15, 30 per address in 15). A friend joining one room costs at most two failures; a mistyped code costs three. If a limiter has already blocked this player the cooldown sentence is
 * what they are shown (and the other kinds are still tried: their limiters are independent).
 *
 * Pure: `ask` sends one request and resolves with its answer (the screen wraps `emitWithin`), so the order and the messages are tested with a fake.
 */
export type FriendCodeAnswer = { unreachable: true } | { unreachable?: false; ack: { ok: true; room?: unknown } | { ok: false; error: string; reason?: string } };
export type FriendCodeAsk = (event: 'join_challenge' | 'bug_room_join' | 'four_room_join', payload: { code: string }) => Promise<FriendCodeAnswer>;

export type FriendCodeResult =
  | { kind: 'challenge' }
  | { kind: 'bughouse'; room: BugFriendRoomView }
  | { kind: 'four'; room: FourFriendRoomView }
  | { kind: 'unreachable' }
  | { kind: 'refused'; error: string };

export const FRIEND_CODE_NOT_FOUND = 'That code was not found or has expired.';
const isCooldown = (error: string): boolean => /^Too many wrong codes/.test(error);
/** The three services' "wrong code" sentences ("That challenge code was not found or has expired." / "That code was not found or has expired."). */
const isNotFound = (error: string): boolean => /not found or has expired/.test(error);

export async function joinFriendCode(rawCode: string, ask: FriendCodeAsk): Promise<FriendCodeResult> {
  const code = rawCode.trim();
  if (code === '') return { kind: 'refused', error: FRIEND_CODE_NOT_FOUND };
  let cooldown: string | null = null;
  // a refusal that is about the PLAYER, not the code ("You already have an open room", "Finish or leave your current game") ends the search and is shown as it is
  let about: string | null = null;
  const note = (error: string): void => {
    if (isCooldown(error)) cooldown ??= error;
    else if (!isNotFound(error)) about ??= error;
  };

  const challenge = await ask('join_challenge', { code });
  if (challenge.unreachable) return { kind: 'unreachable' };
  if (challenge.ack.ok) return { kind: 'challenge' };
  note(challenge.ack.error);
  if (about !== null) return { kind: 'refused', error: about };

  // a code that is not 6 characters of the alphabet cannot be a room's: no request, no failed guess
  const roomCode = normalizeBugRoomCode(code);
  if (roomCode !== null) {
    const bughouse = await ask('bug_room_join', { code: roomCode });
    if (bughouse.unreachable) return { kind: 'unreachable' };
    if (bughouse.ack.ok) return { kind: 'bughouse', room: bughouse.ack.room as BugFriendRoomView };
    note(bughouse.ack.error);
    if (about !== null) return { kind: 'refused', error: about };

    const four = await ask('four_room_join', { code: roomCode });
    if (four.unreachable) return { kind: 'unreachable' };
    if (four.ack.ok) return { kind: 'four', room: four.ack.room as FourFriendRoomView };
    note(four.ack.error);
    if (about !== null) return { kind: 'refused', error: about };
  }
  return { kind: 'refused', error: cooldown ?? FRIEND_CODE_NOT_FOUND };
}
