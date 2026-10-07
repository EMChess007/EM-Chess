import type { GameOverPayload, RejoinAck, RejoinStatePayload } from '../types/multiplayer';

/**
 * What a `rejoin_game` answer means for the Online game screen — kept as a pure function so the three cases can be unit-tested without
 * a renderer or a socket:
 *   - 'state':       the game is still on; resume from this snapshot (the long-standing path).
 *   - 'finished':    the game ended while this player was offline (checkmate, a flag, resignation, the abandonment their own absence
 *                    caused…). The server keeps the result for a few minutes; show it exactly as a live `game_over` would be shown.
 *   - 'unavailable': the server has no such game (too long ago, a restarted server, a bad token). Before this existed the screen stayed on
 *                    "Reconnecting…" for ever; it now says plainly that the game is gone and lets the player leave.
 */
export type RejoinOutcome =
  | { kind: 'state'; state: RejoinStatePayload }
  | { kind: 'finished'; gameOver: GameOverPayload }
  | { kind: 'unavailable'; error: string };

export function classifyRejoinAck(ack: RejoinAck): RejoinOutcome {
  // A finished game comes back as a REFUSAL carrying the result (see RejoinFinishedAck), so this must be checked before `ok`.
  if ('finished' in ack && ack.finished === true) return { kind: 'finished', gameOver: ack.gameOver };
  if (!ack.ok) return { kind: 'unavailable', error: ack.error };
  if ('state' in ack) return { kind: 'state', state: ack.state };
  return { kind: 'unavailable', error: 'Unexpected reply from the server.' };
}
