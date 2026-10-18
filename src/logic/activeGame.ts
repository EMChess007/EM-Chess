import type { MatchFoundPayload } from '../types/multiplayer';
import type { TimeControl } from '../types/timeControl';
import type { FourMatchFoundPayload } from './fourPlayerWire';

// The online game the player is in right now, remembered across a page reload / app kill so they can walk straight back into their seat.
//
// WHY. The rejoin token (`playerToken`) the server hands out in match_found is the only thing that proves a socket owns a seat. It lived in
// memory only, so a web refresh or an app kill dropped the seat: the opponent was awarded the win by abandonment after the server's 45 s
// grace (2-player: ABANDONMENT_GRACE_MS, 4 Player: FOUR_TAKEOVER_GRACE_MS - a bot takes the seat). The server side has always accepted the
// token from a brand-new socket (rejoin_game / four_rejoin are keyed by roomId + token, not by socket) - what was missing was keeping it.
//
// WHAT IS STORED. The whole match_found payload (it holds the starting FEN / seats / time control the screen is built from AND the token) plus
// who it belongs to. It is a bearer secret: the storage module keeps it in SecureStore on native (AsyncStorage on web, like the auth session),
// and nothing in this file or the storage module ever logs it.
//
// WHEN IT IS VALID. The server decides: a rejoin answers with the live state, with the result of a game that just ended (kept 5 minutes,
// FINISHED_RETENTION_MS), or "unavailable". `seenAt` (a heartbeat the app refreshes while the game screen is open) only keeps the client from
// asking about a record that cannot possibly be live any more.

/** 45 s of grace + 5 min of kept results (rooms.ts), rounded up: after this a rejoin could only come back "unavailable". */
export const ACTIVE_GAME_TTL_MS = 6 * 60 * 1000;

export type ActiveOnlineGame =
  | { kind: 'twoPlayer'; userId: string; match: MatchFoundPayload; returnToTournamentId?: string }
  | { kind: 'fourPlayer'; userId: string; match: FourMatchFoundPayload; timeControl: TimeControl };

export function serializeActiveGame(game: ActiveOnlineGame): string {
  return JSON.stringify(game);
}

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The record in `raw`, or null when it is missing or not a record this version can use (never throws). */
export function parseActiveGame(raw: string | null | undefined): ActiveOnlineGame | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(value) || !isString(value.userId) || !isObject(value.match)) return null;
  const match = value.match;
  if (!isString(match.roomId) || !isString(match.playerToken)) return null;
  if (value.kind === 'twoPlayer') {
    if (!isString(match.fen) || (match.color !== 'w' && match.color !== 'b') || !isObject(match.timeControl)) return null;
    return {
      kind: 'twoPlayer',
      userId: value.userId,
      match: match as unknown as MatchFoundPayload,
      ...(isString(value.returnToTournamentId) ? { returnToTournamentId: value.returnToTournamentId } : {}),
    };
  }
  if (value.kind === 'fourPlayer') {
    if (!isString(match.state) || typeof match.seats !== 'object' || match.seats === null || !isObject(value.timeControl)) return null; // seats is an array of four
    return { kind: 'fourPlayer', userId: value.userId, match: match as unknown as FourMatchFoundPayload, timeControl: value.timeControl as unknown as TimeControl };
  }
  return null;
}

/**
 * Whether the app should walk back into `game` now: it belongs to the signed-in user (never offer one player's seat to another account on a
 * shared device) and the app was last seen in it recently enough for the seat to still be live or its result still kept.
 */
export function isResumable(game: ActiveOnlineGame | null, seenAt: number | null, userId: string | null, now: number): game is ActiveOnlineGame {
  if (!game || !userId || game.userId !== userId) return false;
  if (seenAt === null || !Number.isFinite(seenAt)) return false;
  return now - seenAt <= ACTIVE_GAME_TTL_MS;
}

/** The room id of `game`, for log lines and "is this still the same game" checks (never the token). */
export function activeGameRoomId(game: ActiveOnlineGame): string {
  return game.match.roomId;
}
