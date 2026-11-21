/**
 * A tournament game resumed on a NEW socket re-registers as the tournament participant (command #68, TODO "Rejoin ... two known limits").
 *
 * Why: the server tracks tournament participants by socket.id (backend tournaments.ts). After an app restart / page reload the resumed game
 * (activeGame.ts `returnToTournamentId`) runs on a brand-new socket, and a dropped-and-restored connection also gets a new id; without this the
 * live standings pushes and the next round's `tournament_match_ready` went to the dead socket until the player re-entered the tournament
 * screen. OnlineGameScreen calls this after every successful `rejoin_game` of a tournament game. The answer is only logged: a refusal (the
 * tournament is gone) changes nothing about the game itself.
 */
export const REJOIN_TOURNAMENT_EVENT = 'rejoin_tournament';

interface EmitsWithAck {
  emit(event: string, payload: { tournamentId: string }, ack: (res: { ok?: boolean; error?: string } | undefined) => void): unknown;
}

/** `log` is the screen's `logDiagnostic` (passed in: this module stays free of react-native, so the logic tests can import it). */
export function reattachTournamentParticipant(socket: EmitsWithAck, tournamentId: string, log: (message: string) => void): void {
  socket.emit(REJOIN_TOURNAMENT_EVENT, { tournamentId }, (res) => {
    log(`[Multiplayer] rejoin_tournament ${res?.ok ? 'succeeded' : `failed: ${res?.error ?? 'no answer'}`} (tournament ${tournamentId})`);
  });
}
