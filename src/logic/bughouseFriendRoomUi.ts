/**
 * Bughouse FRIEND ROOMS (W6): the wording and the small decisions the Room / Join screens need, kept pure (no React, no socket, no clock of its own) so they are tested without a renderer -
 * the twin of `bughouseOnlineUi.ts`. The wire contract is `bughouse/roomWire.ts`; the server's rules are backend `bughouseFriendRooms.ts`.
 */
import type { TimeControl } from '../types/timeControl';
import { TIME_CONTROLS } from './timeControls';
import { bugRoomInviteLink, type BugFriendRoomView, type BugRoomClosedReason } from './bughouse/roomWire';

/** How many whole seconds of the code's life are left, counted on THIS device's clock from the moment the view arrived (never the server's clock); never below 0. */
export function roomSecondsLeft(view: Pick<BugFriendRoomView, 'expiresInMs'>, receivedAt: number, now: number): number {
  return Math.max(0, Math.ceil((view.expiresInMs - Math.max(0, now - receivedAt)) / 1000));
}

/** 582 -> "9:42". */
export function formatRoomCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The two slots of the room as the screen writes them: the host sees "You" and "Friend: waiting"; the friend sees "<host>" and "You". */
export function roomSlots(view: BugFriendRoomView): { first: string; second: string; friendWaiting: boolean } {
  if (view.youAre === 'host') return { first: 'You (host)', second: view.friendName === null ? 'Friend: waiting' : `Friend: ${view.friendName}`, friendWaiting: view.friendName === null };
  return { first: `${view.hostName} (host)`, second: 'You', friendWaiting: false };
}

/** The line under the title: what this room is, for whoever looks at it. */
export function roomHeadline(view: BugFriendRoomView): string {
  return view.youAre === 'host' ? `Your room · ${view.timeControlLabel}` : `Room of ${view.hostName} · ${view.timeControlLabel} · you are teammates`;
}

/** The host may start with bots only when the friend is in and the room is not already in the matchmaking. */
export function canStartWithBots(view: BugFriendRoomView): boolean {
  return view.youAre === 'host' && view.friendName !== null && view.phase === 'open';
}

/** "Find opponents" is always possible for the host (with no friend it is a plain solo queue entry), except while the pair is already queued. */
export function canFindOpponents(view: BugFriendRoomView): boolean {
  return view.youAre === 'host' && view.phase === 'open';
}

/** The sentence a closed room shows. */
export function closedText(reason: BugRoomClosedReason): string {
  return reason === 'hostLeft' ? 'The host closed the room.' : 'The room expired. Open a new one.';
}

/** What the share sheet / the clipboard carries. `baseUrl` is the app's own address on the web and null on a phone (there is no link to a native app yet: the code is the invite). */
export function inviteMessage(code: string, baseUrl: string | null): string {
  const link = baseUrl === null ? null : bugRoomInviteLink(baseUrl, code);
  return link === null ? `Play Bughouse with me on EM-Chess! Open Bughouse > Join with a code and enter ${code}.` : `Play Bughouse with me on EM-Chess! ${link} (code ${code})`;
}

/** The invite code in the address the web app was opened with (`/bughouse/join/<code>`), or null. Pure: the caller passes the pathname. */
export function inviteCodeFromPath(pathname: string): string | null {
  const m = /^\/bughouse\/join\/([A-Za-z0-9-]{1,16})\/?$/.exec(pathname);
  return m ? m[1].toUpperCase().replace(/-/g, '') : null;
}

/** The app's time-control record for a match that came out of a room (the app's persisted record and "play again" want one; the room only knows milliseconds and a label). */
export function timeControlOfMatch(timeControl: { initialMs: number; incrementMs: number }, label: string): TimeControl {
  const initialSeconds = Math.round(timeControl.initialMs / 1000);
  const incrementSeconds = Math.round(timeControl.incrementMs / 1000);
  // the app's own preset when there is one (its category is what "play again" and the clocks read), else a record built from the milliseconds
  const preset = TIME_CONTROLS.find((tc) => tc.initialSeconds === initialSeconds && tc.incrementSeconds === incrementSeconds);
  if (preset) return { ...preset, label: label || preset.label };
  return { id: `bughouse-room-${initialSeconds}-${incrementSeconds}`, label, initialSeconds, incrementSeconds, category: initialSeconds <= 120 ? 'bullet' : 'blitz' };
}

/** The two "Back" destinations of the Room screen: a host who closes, a friend who leaves. */
export const ROOM_BUTTONS = { findOpponents: 'Find opponents', startWithBots: 'Start with bots', closeRoom: 'Close room', leaveRoom: 'Leave', copy: 'Copy', share: 'Share' } as const;
