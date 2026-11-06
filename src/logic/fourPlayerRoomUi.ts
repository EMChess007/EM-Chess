/**
 * 4-seat FRIEND ROOMS (command #35): the wording and the small decisions the room screen needs, pure (no React, no socket, no clock of its own) so they are tested without a renderer - the twin of
 * `bughouseFriendRoomUi.ts`. The wire contract is `fourPlayerRoomWire.ts`; the server's rules are the backend's one friend-room manager (`friendRooms.ts`).
 */
import type { FourFriendRoomView, FourRoomClosedReason } from './fourPlayerRoomWire';
import { FOUR_ROOM_MAX_MEMBERS } from './fourPlayerRoomWire';
import { variantTitle } from './fourPlayerVariant';

/** The host can start once at least one friend is in; bots take every empty seat. */
export const canStartRoom = (room: Pick<FourFriendRoomView, 'youAre' | 'members'>): boolean => room.youAre === 'host' && room.members.length >= 2;

/** How many seats the bots will take if the host starts now. */
export const botSeatsOf = (room: Pick<FourFriendRoomView, 'members'>): number => Math.max(0, FOUR_ROOM_MAX_MEMBERS - room.members.length);

/** "You are the host" / "You joined Ana's room". */
export function roomHeadline(room: Pick<FourFriendRoomView, 'youAre' | 'hostName' | 'variant' | 'timeControlLabel'>): string {
  const game = `${variantTitle(room.variant)} · ${room.timeControlLabel}`;
  return room.youAre === 'host' ? `${game} - send your code to up to three friends.` : `${game} - you joined ${room.hostName}'s room.`;
}

/** The four seats of the room as lines: the members first ("You (host)", "Ben"), then "Bot" for every empty seat the bots would take. */
export function roomLines(room: Pick<FourFriendRoomView, 'youAre' | 'members'>, myName?: string): { text: string; bot: boolean }[] {
  const lines = room.members.map((name, index) => {
    const mine = (room.youAre === 'host' && index === 0) || (room.youAre === 'friend' && myName !== undefined && name === myName);
    return { text: index === 0 ? (mine ? `${name} (you, host)` : `${name} (host)`) : mine ? `${name} (you)` : name, bot: false };
  });
  for (let i = room.members.length; i < FOUR_ROOM_MAX_MEMBERS; i++) lines.push({ text: 'Bot fills this seat', bot: true });
  return lines;
}

export function startText(room: Pick<FourFriendRoomView, 'members'>): string {
  const bots = botSeatsOf(room);
  return bots === 0 ? 'Start the game' : `Start - ${bots} bot${bots === 1 ? '' : 's'} fill${bots === 1 ? 's' : ''} the empty seat${bots === 1 ? '' : 's'}`;
}

export const closedText = (reason: FourRoomClosedReason): string => (reason === 'hostLeft' ? 'The host closed the room.' : 'The room expired. Open a new one.');

/** What the share sheet / the clipboard carries. */
export const inviteText = (code: string, title: string): string => `Play ${title} with me on EM-Chess! Open Play > Online > Challenge Friend > Join by Code and enter ${code}.`;
