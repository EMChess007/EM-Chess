import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { SEAT_TAKEN_OVER_EVENT, SEAT_TAKEN_OVER_MESSAGE, isSeatTakeoverFor } from '../seatTakeover';
import { REJOIN_TOURNAMENT_EVENT, reattachTournamentParticipant } from '../tournamentReattach';

const SRC = join(__dirname, '..', '..');
const app = readFileSync(join(SRC, '../App.tsx'), 'utf8').replace(/\r\n/g, '\n');

/** Command #68 (TODO "Rejoin ... two known limits"). The screens' reactions are rendered in onlineSeatTakeover.dom.test.tsx and fourPlayerOnlineSession.test.ts. */
describe('seat taken over (same account, two tabs / devices)', () => {
  it('the wire names and the message (literals)', () => {
    expect(SEAT_TAKEN_OVER_EVENT).toBe('seat_taken_over');
    expect(SEAT_TAKEN_OVER_MESSAGE).toBe('This game was opened on another tab or device signed in to your account. It continues there.');
  });

  it('only a payload for THIS room counts', () => {
    expect(isSeatTakeoverFor({ roomId: 'r1' }, 'r1')).toBe(true);
    for (const junk of [{ roomId: 'r2' }, {}, null, undefined, 'r1', 1, { roomId: 1 }]) expect(isSeatTakeoverFor(junk, 'r1')).toBe(false);
  });

  it("App keeps the shared rejoin record when the exit is a takeover (2-player and 4-seat), and clears it on any other exit as before", () => {
    expect(app).toContain("if (reason !== 'seatTakenOver') void clearActiveGame();");
    expect(app).toContain("if (!resumable && reason !== 'seatTakenOver') void clearActiveGame();");
  });
});

describe('a resumed tournament game re-registers as the participant', () => {
  it('sends rejoin_tournament with the id and survives any answer', () => {
    const sent: { event: string; payload: unknown }[] = [];
    const logs: string[] = [];
    const answers: unknown[] = [{ ok: true }, { ok: false, error: 'Tournament not found.' }, undefined];
    for (const answer of answers) {
      const socket = {
        emit(event: string, payload: { tournamentId: string }, ack: (res: { ok?: boolean; error?: string } | undefined) => void) {
          sent.push({ event, payload });
          ack(answer as { ok?: boolean; error?: string } | undefined);
        },
      };
      reattachTournamentParticipant(socket, 'tour-9', (line) => logs.push(line));
    }
    expect(logs).toEqual([
      '[Multiplayer] rejoin_tournament succeeded (tournament tour-9)',
      '[Multiplayer] rejoin_tournament failed: Tournament not found. (tournament tour-9)',
      '[Multiplayer] rejoin_tournament failed: no answer (tournament tour-9)',
    ]);
    expect(REJOIN_TOURNAMENT_EVENT).toBe('rejoin_tournament');
    expect(sent).toEqual(answers.map(() => ({ event: 'rejoin_tournament', payload: { tournamentId: 'tour-9' } })));
  });

  it('App hands the tournament id of the resumed record to the game screen', () => {
    expect(app).toContain('keepSocketAlive={!!returnToTournamentId}\n        tournamentId={returnToTournamentId}');
    expect(app).toContain("{ name: 'onlineGame', token: session.token, match: game.match, returnToTournamentId: game.returnToTournamentId, resume: true }");
  });
});
