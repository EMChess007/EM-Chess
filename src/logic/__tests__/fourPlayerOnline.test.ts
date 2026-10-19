import { describe, expect, it } from 'vitest';
import {
  adoptSnapshot,
  applyFourState,
  applyGameOver,
  applySeatUpdate,
  beginMove,
  beginResync,
  canMove,
  displayClock,
  displayClocksMs,
  displayState,
  failResync,
  moveAcked,
  movePayloadFor,
  moveRejected,
  readSnapshot,
  viewFromMatch,
  viewFromRoom,
  type FourOnlineView,
  type FourStateResult,
} from '../fourPlayerOnline';
import { BISHOP, KNIGHT, QUEEN, ROOK, chooseBotMove, findLegalMove, initialState, legalMoves, parseSquare, resolvePremove, serialize, stateFromPieces, type Move, type Seat } from '../fourPlayer';
import { stepPremove } from '../premove';
import { clocksToWireMs, validateFourMovePayload, type FourRoomState, type FourSeats, type FourStatePayload } from '../fourPlayerWire';
import { OTHER_ROOM, ROOM, ServerSim, T0, authoritative, feedAll, firstFive, freshView, mv, seatsOf } from './fourPlayerOnlineKit';

/**
 * The client's online reducer (src/logic/fourPlayerOnline.ts). The only safety net this part of the client has is this file - the project
 * has no React Native renderer - so it is tested against a SERVER SIMULATOR built on the real engine (the same `playMove` / `resign` /
 * `serialize` the real server's mirror runs), not against hand-typed snapshots: every payload below is exactly what `four_state` carries.
 *
 * The four tests the spec asks for BY NAME are in the first block and each stands alone: an out-of-order seq, a duplicate seq, a genuine
 * gap that sends four_rejoin, and a refused optimistic move rolling back to the last authoritative snapshot.
 */


// --- The four named tests ------------------------------------------------------------------------------------------------------------

describe('the four named seq / rollback tests', () => {
  it('NAMED 1 - an out-of-order seq (a late older state after newer ones) is ignored and the view is not touched', () => {
    const { sim, view } = freshView();
    const states = firstFive(sim);
    const atFive = feedAll(view, states); // seq 1..5 adopted in order
    expect(atFive.seq).toBe(5);
    const before = authoritative(atFive);

    for (const late of [states[2], states[0], states[3], states[1]]) {
      const result = applyFourState(atFive, late, T0 + 5);
      expect(result.outcome, `late seq ${late.seq}`).toBe('stale');
      expect(result.resync, 'a late arrival is not a gap: it asks for nothing').toBe(false);
      expect(result.view, 'not even a new object').toBe(atFive);
    }
    expect(authoritative(atFive)).toStrictEqual(before);
    expect(atFive.state.turn).toBe(sim.state.turn);
    expect(serialize(atFive.state)).toBe(serialize(sim.state));

    // ...and the room still moves on normally afterwards.
    const six = sim.bot();
    const next = applyFourState(atFive, six, T0 + 6);
    expect(next.outcome).toBe('applied');
    expect(next.view.seq).toBe(6);
  });

  it('NAMED 2 - a duplicate seq (the same state delivered twice) is ignored and the view is not touched', () => {
    const { sim, view } = freshView();
    const states = firstFive(sim);
    const atThree = feedAll(view, states.slice(0, 3));
    const before = authoritative(atThree);

    const again = applyFourState(atThree, states[2], T0 + 9); // seq 3 again
    expect(again.outcome).toBe('duplicate');
    expect(again.resync).toBe(false);
    expect(again.view).toBe(atThree);
    expect(authoritative(atThree)).toStrictEqual(before);
    expect(atThree.log.length, 'the move is not logged twice').toBe(3);
    expect(atThree.clocksAt, 'the clock reference time is not re-stamped by a duplicate').toBe(T0);

    // seq 0 (the match-found snapshot, re-sent) is also just a stale duplicate.
    const zero: FourStatePayload = { roomId: ROOM, seq: 0, actor: 'human', move: null, events: [], state: serialize(initialState()), clocksMs: clocksToWireMs([300, 300, 300, 300]) };
    expect(applyFourState(atThree, zero, T0).outcome).toBe('stale');

    // the next real state still applies exactly once
    const next = applyFourState(atThree, states[3], T0 + 10);
    expect(next.outcome).toBe('applied');
    expect(next.view.log.length).toBe(4);
  });

  it('NAMED 3 - a genuine gap sends exactly ONE four_rejoin, however many later states arrive, and the answer repairs the view', () => {
    const { sim, view } = freshView();
    const states = firstFive(sim);
    const atTwo = feedAll(view, states.slice(0, 2)); // the client has seq 2; 3 and 4 are LOST
    const more = [sim.bot(), sim.bot()]; // seq 6, 7 exist on the server too

    // seq 5 arrives while 3 and 4 never did: a gap.
    const gap = applyFourState(atTwo, states[4], T0 + 1);
    expect(gap.outcome).toBe('gap');
    expect(gap.resync, 'this is the one that sends four_rejoin').toBe(true);
    expect(gap.view.resyncing).toBe(true);
    expect(gap.view.seq, 'the authority is NOT advanced past the hole').toBe(2);
    expect(serialize(gap.view.state)).toBe(serialize(atTwo.state));
    expect(canMove(gap.view, true), 'no moves while the room is being re-read').toBe(false);

    // two more states arrive before the answer: still a gap, but no second request
    const second = applyFourState(gap.view, more[0], T0 + 2);
    const third = applyFourState(second.view, more[1], T0 + 3);
    expect([second.outcome, third.outcome]).toStrictEqual(['gapPending', 'gapPending']);
    expect([gap.resync, second.resync, third.resync].filter(Boolean).length, 'exactly one four_rejoin for the whole gap').toBe(1);

    // the server's answer (the whole room at seq 7)
    const answer = adoptSnapshot(third.view, sim.room(), T0 + 4);
    expect(answer.outcome).toBe('adopted');
    expect(answer.view.resyncing).toBe(false);
    expect(answer.view.seq).toBe(7);
    expect(serialize(answer.view.state)).toBe(serialize(sim.state));
    expect(answer.view.clocksMs).toStrictEqual(clocksToWireMs(sim.clocks));
    expect(answer.view.log.map((l) => l.text)).toStrictEqual(sim.log.map((l) => l.text));

    // the late states 3 and 4 (if they straggle in after all) change nothing; the next real one applies
    for (const late of [states[2], states[3], states[4], more[0]]) expect(applyFourState(answer.view, late, T0 + 5).outcome, `late ${late.seq}`).toBe('stale');
    expect(applyFourState(answer.view, more[1], T0 + 5).outcome, 'seq 7 is the snapshot the answer already holds').toBe('duplicate');
    const eight = sim.bot();
    const live = applyFourState(answer.view, eight, T0 + 6);
    expect(live.outcome).toBe('applied');
    expect(live.view.seq).toBe(8);

    // and a SECOND, later gap is allowed to ask again (the flag was cleared by the answer)
    const nine = sim.bot();
    const ten = sim.bot();
    expect(applyFourState(live.view, ten, T0 + 7).resync).toBe(true);
    expect(nine.seq).toBe(9);
  });

  it('NAMED 4 - a refused optimistic move rolls back to exactly the last authoritative snapshot', () => {
    const { sim, view } = freshView(0);
    const before = authoritative(view);
    const authorityBefore = view.state;

    const move = mv(view.state, 'e2', 'e4');
    const begun = beginMove(view, move);
    expect(begun.id).toBe(1);
    const shown = begun.view;
    // the optimistic position is on screen...
    expect(shown.pending?.move).toBe(move);
    expect(serialize(displayState(shown))).not.toBe(serialize(view.state));
    expect(displayState(shown).cells[move.to]).toBe(view.state.cells[move.from]);
    expect(displayState(shown).cells[move.from]).toBe(0);
    // ...but the authority was never edited: same object, same text
    expect(shown.state).toBe(authorityBefore);
    expect(canMove(shown, true), 'one move in flight at a time').toBe(false);

    // the server says no
    const refused = moveRejected(shown, begun.id as number, 'It is not your turn.');
    expect(refused.rolledBack).toBe(true);
    const back = refused.view;
    expect(back.pending).toBeNull();
    expect(displayState(back), 'the screen draws the authority again: the very same object').toBe(authorityBefore);
    expect(serialize(displayState(back))).toBe(before.text);
    expect(authoritative(back)).toStrictEqual(before);
    expect(back.moveError).toBe('It is not your turn.');
    expect(canMove(back, true), 'and the player may try again').toBe(true);
    expect(sim.seq, 'the server never moved').toBe(0);

    // trying again gets a NEW id and works
    const again = beginMove(back, mv(back.state, 'd2', 'd4'));
    expect(again.id).toBe(2);
    expect(again.view.moveError, 'a new attempt clears the old message').toBeNull();
  });
});

// --- Ordering, in depth -------------------------------------------------------------------------------------------------------------

describe('ordering and adoption', () => {
  it('adopts a long real game in lockstep: after every state the client position, clocks and log equal the server\'s (eliminations and dead-king walks included)', () => {
    let eliminations = 0;
    let deadKingWalks = 0;
    let plies = 0;
    for (const seed of [1, 2, 3]) {
      const { sim, view } = freshView(0, new ServerSim(seed));
      let current = view;
      while (!sim.state.result && sim.seq < 1000) {
        // Green resigns early: its king becomes a dead king that the engine then WALKS at random on every later round of the table
        const payload =
          sim.seq === 12 && sim.state.status[3] === 'active'
            ? sim.resignSeat(3)
            : sim.state.turn === 0
              ? sim.play(chooseBotMove(sim.state, 1200, sim.rng) as Move, 'human')
              : sim.bot();
        const result = applyFourState(current, payload, T0 + sim.seq);
        expect(result.outcome, `seed ${seed} seq ${payload.seq}`).toBe('applied');
        current = result.view;
        expect(serialize(current.state), `seed ${seed} seq ${payload.seq}`).toBe(serialize(sim.state));
        expect(current.seq).toBe(sim.seq);
        expect(current.clocksMs).toStrictEqual(clocksToWireMs(sim.clocks));
        plies++;
      }
      expect(current.log.length).toBe(sim.log.length);
      expect(current.log.map((l) => l.text)).toStrictEqual(sim.log.map((l) => l.text));
      eliminations += sim.events.filter((e) => e.kind === 'eliminated').length;
      deadKingWalks += sim.events.filter((e) => e.kind === 'deadKingMove').length;
    }
    // the lockstep above must really have covered the unpredictable parts, or it proves less than it claims
    expect(eliminations).toBeGreaterThan(0);
    expect(deadKingWalks).toBeGreaterThan(0);
    expect(plies).toBeGreaterThan(150);
  });

  it('keeps lastMove across a state with no move (a flag fall / resignation) and replaces it on the next move', () => {
    const { sim, view } = freshView(0);
    const first = sim.play(mv(sim.state, 'e2', 'e4'));
    const afterMove = applyFourState(view, first, T0).view;
    expect(afterMove.lastMove).toStrictEqual({ from: parseSquare('e2'), to: parseSquare('e4') });

    const resigned = applyFourState(afterMove, sim.resignSeat(3), T0 + 1);
    expect(resigned.outcome).toBe('applied');
    expect(resigned.view.lastMove, 'a resignation is not a move').toStrictEqual(afterMove.lastMove);
    expect(resigned.view.log.length, 'and is not in the move log').toBe(1);
    expect(resigned.view.state.status[3]).not.toBe('active');
    expect(resigned.view.notices.join(' ')).toMatch(/Green resigned/);

    const next = applyFourState(resigned.view, sim.bot(), T0 + 2);
    expect(next.view.lastMove).not.toStrictEqual(afterMove.lastMove);
  });

  it('never buffers: a state two ahead is a gap even if the missing one arrives right after (the rejoin answer decides)', () => {
    const { sim, view } = freshView();
    const states = firstFive(sim);
    const atOne = feedAll(view, states.slice(0, 1));
    const jump = applyFourState(atOne, states[2], T0); // seq 3 before 2
    expect(jump.outcome).toBe('gap');
    expect(jump.view.seq).toBe(1);
    const late = applyFourState(jump.view, states[1], T0); // seq 2 now IS the next one
    expect(late.outcome, 'applying the missing one is still correct and harmless').toBe('applied');
    expect(late.view.seq).toBe(2);
    expect(late.view.resyncing, 'the request is still in flight until its answer').toBe(true);
    // the answer (at seq 5) then repairs everything
    const answer = adoptSnapshot(late.view, sim.room(), T0);
    expect(answer.view.seq).toBe(5);
    expect(answer.view.resyncing).toBe(false);
  });

  it('ignores a state for another room, and anything after the game ended, without touching the view', () => {
    const { sim, view } = freshView();
    const [one, two] = firstFive(sim);
    const foreign = { ...one, roomId: OTHER_ROOM };
    const wrong = applyFourState(view, foreign, T0);
    expect(wrong.outcome).toBe('wrongRoom');
    expect(wrong.view).toBe(view);
    expect(applySeatUpdate(view, { roomId: OTHER_ROOM, seats: seatsOf({ 1: { name: 'X' } }) }, T0)).toBe(view);
    expect(applyGameOver(view, { ...sim.over('abandoned'), roomId: OTHER_ROOM })).toBe(view);
    expect(adoptSnapshot(view, { ...sim.room(), roomId: OTHER_ROOM }, T0).outcome).toBe('wrongRoom');

    const live = applyFourState(view, one, T0).view;
    const ended = applyGameOver(live, sim.over('elimination'));
    const after = applyFourState(ended, two, T0);
    expect(after.outcome).toBe('finished');
    expect(after.view).toBe(ended);
    expect(after.resync).toBe(false);
  });

  it('treats an unreadable snapshot, bad clocks or a garbage seq as invalid: no throw, authority untouched, ONE rejoin requested', () => {
    const { sim, view } = freshView();
    const [one] = firstFive(sim);
    const broken: FourStatePayload[] = [
      { ...one, state: 'not a snapshot' },
      { ...one, state: '' },
      { ...one, state: (undefined as unknown) as string },
      { ...one, clocksMs: [1, 2, 3] as unknown as FourStatePayload['clocksMs'] },
      { ...one, clocksMs: [1, 2, 3, NaN] },
      { ...one, clocksMs: [1, 2, 3, -5] },
      { ...one, seq: Number.NaN },
      { ...one, seq: -1 },
      { ...one, seq: 1.5 },
      { ...one, seq: ('1' as unknown) as number },
    ];
    for (const payload of broken) {
      const result = applyFourState(view, payload, T0);
      expect(result.outcome, JSON.stringify(payload).slice(0, 80)).toBe('invalid');
      expect(result.resync).toBe(true);
      expect(result.view.seq).toBe(0);
      expect(serialize(result.view.state)).toBe(serialize(view.state));
      // a second broken payload while the request is in flight asks for nothing more
      expect(applyFourState(result.view, payload, T0).resync).toBe(false);
    }
  });

  it('readSnapshot never throws on junk', () => {
    for (const junk of [undefined, null, 5, {}, [], '', 'x', '{}', '[]', 'a'.repeat(5000)]) expect(readSnapshot(junk), String(junk).slice(0, 20)).toBeNull();
    expect(readSnapshot(serialize(initialState()))).not.toBeNull();
  });
});

describe('whole-room answers (rejoin, spectate)', () => {
  it('an older answer changes nothing but still ends the resync; an equal-seq answer keeps a pending move; a newer one drops it', () => {
    const { sim, view } = freshView(0);
    const begun = beginMove(view, mv(view.state, 'e2', 'e4'));
    const resyncing = beginResync(begun.view).view;
    expect(resyncing.resyncing).toBe(true);

    const room0 = sim.room(); // seq 0: the same as the client's
    const same = adoptSnapshot(resyncing, room0, T0 + 1);
    expect(same.outcome).toBe('adopted');
    expect(same.view.pending?.id, 'the move is still waiting for its own state').toBe(1);
    expect(same.view.resyncing).toBe(false);

    const move = sim.play(mv(sim.state, 'e2', 'e4'));
    expect(move.seq).toBe(1);
    const newer = adoptSnapshot(same.view, sim.room(), T0 + 2);
    expect(newer.view.seq).toBe(1);
    expect(newer.view.pending, 'a newer authority supersedes the optimistic copy').toBeNull();
    expect(newer.view.lastMove).toBeNull();

    const older = adoptSnapshot({ ...newer.view, resyncing: true }, room0, T0 + 3);
    expect(older.outcome).toBe('stale');
    expect(older.view.seq).toBe(1);
    expect(older.view.resyncing).toBe(false);
    expect(serialize(older.view.state)).toBe(serialize(newer.view.state));
  });

  it('is refused for a bad snapshot or after the game ended (a late rejoin answer must not disturb a result on screen)', () => {
    const { sim, view } = freshView(0);
    expect(adoptSnapshot(view, { ...sim.room(), state: 'junk' }, T0).outcome).toBe('invalid');
    expect(adoptSnapshot(view, { ...sim.room(), clocksMs: [1, 2] as unknown as FourRoomState['clocksMs'] }, T0).outcome).toBe('invalid');
    const ended = applyGameOver(view, sim.over('elimination'));
    const late = adoptSnapshot(ended, sim.room(), T0);
    expect(late.outcome).toBe('finished');
    expect(late.view).toBe(ended);
  });

  it('builds a spectator view from the room answer: no seat, never able to move', () => {
    const { sim } = freshView(0);
    sim.play(mv(sim.state, 'e2', 'e4'));
    const spectator = viewFromRoom(sim.room(), null, T0) as FourOnlineView;
    expect(spectator.mySeat).toBeNull();
    expect(spectator.seq).toBe(1);
    expect(spectator.log).toHaveLength(1);
    for (const turnOwner of [0, 1, 2, 3]) {
      const view = { ...spectator, state: { ...spectator.state, turn: turnOwner as Seat } };
      expect(canMove(view, true), `turn of seat ${turnOwner}`).toBe(false);
      expect(beginMove(view, legalMoves(view.state, view.state.turn)[0]).id).toBeNull();
    }
  });

  it('refuses to build a view from an unreadable match or room', () => {
    const sim = new ServerSim();
    expect(viewFromMatch({ ...sim.match(0), state: 'junk' }, T0)).toBeNull();
    expect(viewFromRoom({ ...sim.room(), clocksMs: [0, 0, 0] as unknown as FourRoomState['clocksMs'] }, null, T0)).toBeNull();
  });
});

describe('game over, seats and resync bookkeeping', () => {
  it('adopts the final snapshot from four_game_over (a client that missed the last state), and the FIRST result wins', () => {
    const { sim, view } = freshView(0);
    const states = firstFive(sim);
    const atTwo = feedAll(view, states.slice(0, 2));
    const over = applyGameOver(atTwo, sim.over('elimination'));
    expect(over.gameOver?.reason).toBe('elimination');
    expect(serialize(over.state)).toBe(serialize(sim.state));
    expect(over.pending).toBeNull();
    expect(over.resyncing).toBe(false);
    expect(over.seq, 'game over carries no seq').toBe(2);

    const second = applyGameOver(over, { ...sim.over('abandoned') });
    expect(second).toBe(over);
    expect(canMove(over, true)).toBe(false);
  });

  it('an unreadable final snapshot still records the result and keeps the last good position', () => {
    const { sim, view } = freshView(0);
    const over = applyGameOver(view, { ...sim.over('abandoned'), state: 'junk' });
    expect(over.gameOver?.reason).toBe('abandoned');
    expect(over.state).toBe(view.state);
  });

  it('applySeatUpdate replaces the seats and stamps the time; malformed updates are ignored', () => {
    const { view } = freshView(0);
    const seats = seatsOf({ 2: { kind: 'bot', botReason: 'takeover', connected: true } });
    const updated = applySeatUpdate(view, { roomId: ROOM, seats }, T0 + 77);
    expect(updated.seats).toBe(seats);
    expect(updated.seatsAt).toBe(T0 + 77);
    expect(applySeatUpdate(view, { roomId: ROOM, seats: seats.slice(0, 3) as unknown as FourSeats }, T0)).toBe(view);
    expect(applySeatUpdate(view, { roomId: ROOM, seats: null as unknown as FourSeats }, T0)).toBe(view);
  });

  it('beginResync sends once; failResync re-arms it; nothing is ever sent after the game ended', () => {
    const { sim, view } = freshView(0);
    const first = beginResync(view);
    expect(first.send).toBe(true);
    expect(beginResync(first.view).send).toBe(false);
    expect(beginResync(first.view).view).toBe(first.view);
    const failed = failResync(first.view);
    expect(failed.resyncing).toBe(false);
    expect(failResync(failed)).toBe(failed);
    expect(beginResync(failed).send).toBe(true);
    const ended = applyGameOver(view, sim.over('abandoned'));
    expect(beginResync(ended)).toStrictEqual({ view: ended, send: false });
  });
});

// --- The player's own moves ---------------------------------------------------------------------------------------------------------

describe('optimistic moves', () => {
  it('shows the move at once without passing the turn, and the next authoritative state replaces it', () => {
    const { sim, view } = freshView(0);
    const move = mv(view.state, 'e2', 'e4');
    const { view: pendingView, id } = beginMove(view, move);
    expect(id).toBe(1);
    expect(displayState(pendingView).ply).toBe(view.state.ply + 1);
    expect(displayState(pendingView).turn, 'applyMoveRaw keeps the turn: the screen must not look like Blue already moved').toBe(0);
    expect(pendingView.seq).toBe(0);

    const server = applyFourState(pendingView, sim.play(move), T0 + 1);
    expect(server.outcome).toBe('applied');
    expect(server.view.pending).toBeNull();
    expect(displayState(server.view)).toBe(server.view.state);
    expect(server.view.state.turn).toBe(1);
  });

  it('is refused (id null, view untouched) when the player may not move: not their turn, a move pending, resyncing, game over, eliminated, spectator', () => {
    const { sim, view } = freshView(0);
    const move = mv(view.state, 'e2', 'e4');
    const sent = applyFourState(beginMove(view, move).view, sim.play(move), T0).view; // Blue to move
    const blueMove = legalMoves(sent.state, 1)[0];
    expect(beginMove(sent, blueMove).id, 'not my turn').toBeNull();
    expect(beginMove(sent, blueMove).view).toBe(sent);

    const mine = freshView(0).view;
    const pending = beginMove(mine, mv(mine.state, 'e2', 'e4')).view;
    expect(beginMove(pending, mv(mine.state, 'd2', 'd4')).id, 'a move is already pending').toBeNull();
    expect(beginMove(beginResync(mine).view, mv(mine.state, 'e2', 'e4')).id, 'resyncing').toBeNull();
    expect(beginMove(applyGameOver(mine, sim.over('abandoned')), mv(mine.state, 'e2', 'e4')).id, 'game over').toBeNull();
    expect(canMove(mine, false), 'offline').toBe(false);

    const eliminated = applyFourState(mine, new ServerSim().resignSeat(0), T0).view;
    expect(eliminated.state.status[0]).not.toBe('active');
    expect(canMove(eliminated, true)).toBe(false);
  });

  it('a state arriving while a move is pending drops the optimistic copy even if the server did something else (a flag fall)', () => {
    const { sim, view } = freshView(0);
    const move = mv(view.state, 'e2', 'e4');
    const pending = beginMove(view, move).view;
    // the server had already eliminated Red for time: the move is refused and the broadcast is an elimination, not a move
    const flagged = applyFourState(pending, sim.resignSeat(0), T0 + 1);
    expect(flagged.view.pending).toBeNull();
    expect(displayState(flagged.view)).toBe(flagged.view.state);
    expect(flagged.view.state.status[0]).not.toBe('active');
    // the late refusal of that move still shows its message but rolls nothing back
    const refusal = moveRejected(flagged.view, 1, 'Your time ran out.');
    expect(refusal.rolledBack).toBe(false);
    expect(refusal.view.moveError).toBe('Your time ran out.');
    expect(refusal.view.state).toBe(flagged.view.state);
  });

  it('a late refusal of an EARLIER move never rolls back a later pending move (ids, not positions)', () => {
    const { view } = freshView(0);
    const first = beginMove(view, mv(view.state, 'e2', 'e4'));
    const rolledBack = moveRejected(first.view, first.id as number, 'no').view;
    const second = beginMove(rolledBack, mv(rolledBack.state, 'd2', 'd4'));
    expect(second.id).toBe(2);
    const stray = moveRejected(second.view, 1, 'a duplicate callback for move 1');
    expect(stray.rolledBack).toBe(false);
    expect(stray.view.pending?.id).toBe(2);
    expect(displayState(stray.view)).toBe(second.view.pending?.state);
  });

  it('a move that was never answered (timeout) rolls back exactly like a refusal', () => {
    const { view } = freshView(0);
    const before = authoritative(view);
    const begun = beginMove(view, mv(view.state, 'e2', 'e4'));
    const timedOut = moveRejected(begun.view, begun.id as number, 'The move was not confirmed by the server.');
    expect(timedOut.rolledBack).toBe(true);
    expect(authoritative(timedOut.view)).toStrictEqual(before);
    expect(displayState(timedOut.view)).toBe(view.state);
  });

  it('moveAcked clears the pending move only once its state has been adopted (the state, not the ack, normally does it)', () => {
    const { sim, view } = freshView(0);
    const move = mv(view.state, 'e2', 'e4');
    const begun = beginMove(view, move);
    expect(moveAcked(begun.view, 1, 1), 'the ack came first: the state (seq 1) has not arrived').toBe(begun.view);
    const arrived = applyFourState(begun.view, sim.play(move), T0).view;
    expect(arrived.pending).toBeNull();
    // an ack for an id that is not pending is a no-op
    expect(moveAcked(arrived, 1, 1)).toBe(arrived);
    // a defensive case: pending somehow still set while the state is already in
    const stuck = { ...begun.view, seq: 1 };
    expect(moveAcked(stuck, 1, 1).pending).toBeNull();
    expect(moveAcked(stuck, 7, 1).pending, 'the wrong id').not.toBeNull();
  });

  it('movePayloadFor writes squares as names and the promotion as q/r/b/n, in a form the server validator accepts', () => {
    const plain = mv(initialState(), 'e2', 'e4');
    expect(movePayloadFor(ROOM, plain)).toStrictEqual({ roomId: ROOM, from: 'e2', to: 'e4' });
    expect(validateFourMovePayload(movePayloadFor(ROOM, plain)).ok).toBe(true);
  });
});

describe('premoves online', () => {
  it('a queued premove is resolved against the AUTHORITY on the snapshot that gives the turn back, then played through beginMove', () => {
    const { sim, view } = freshView(0);
    const first = mv(view.state, 'e2', 'e4');
    let current = applyFourState(beginMove(view, first).view, sim.play(first), T0).view; // Blue's turn
    const intent = { from: parseSquare('e4'), to: parseSquare('e5') };
    const ctx = (v: FourOnlineView) => ({
      intent,
      isMyTurn: v.state.turn === 0,
      canStillPlay: v.state.status[0] === 'active',
      gameOver: !!v.gameOver || !!v.state.result,
      resolve: (i: typeof intent) => resolvePremove(v.state, 0, i),
    });
    expect(stepPremove(ctx(current)).kind, 'not my turn yet').toBe('wait');
    for (const payload of sim.untilTurn(0)) {
      current = applyFourState(current, payload, T0).view;
      if (current.state.turn !== 0) expect(stepPremove(ctx(current)).kind).toBe('wait');
    }
    const step = stepPremove(ctx(current));
    expect(step.kind).toBe('play');
    if (step.kind !== 'play') return;
    const begun = beginMove(current, step.move);
    expect(begun.id, 'the premove goes through the same path as a hand-made move (the second move of the game)').toBe(2);
    expect(movePayloadFor(ROOM, step.move)).toStrictEqual({ roomId: ROOM, from: 'e4', to: 'e5' });
  });

  it('is cancelled when the player is eliminated while waiting, and when the game ends', () => {
    const { sim, view } = freshView(0);
    const first = mv(view.state, 'e2', 'e4');
    const current = applyFourState(beginMove(view, first).view, sim.play(first), T0).view;
    const intent = { from: parseSquare('e4'), to: parseSquare('e5') };
    const base = { intent, resolve: (i: typeof intent) => resolvePremove(current.state, 0, i) };
    const eliminated = applyFourState(current, sim.resignSeat(0), T0).view; // e.g. a flag fall for Red
    expect(stepPremove({ ...base, isMyTurn: false, canStillPlay: eliminated.state.status[0] === 'active', gameOver: false })).toStrictEqual({ kind: 'cancel', reason: 'eliminated' });
    expect(stepPremove({ ...base, isMyTurn: false, canStillPlay: true, gameOver: true })).toStrictEqual({ kind: 'cancel', reason: null });
  });
});

// --- Clocks -----------------------------------------------------------------------------------------------------------------------

describe('display clocks (cosmetic; the server decides flag falls)', () => {
  it('runs only the seat on move, from the time the clocks were received', () => {
    const { view } = freshView(0);
    expect(displayClocksMs(view, T0)).toStrictEqual([300000, 300000, 300000, 300000]);
    expect(displayClocksMs(view, T0 + 4000)).toStrictEqual([296000, 300000, 300000, 300000]);
    const sim = new ServerSim();
    const state = applyFourState(view, sim.play(mv(sim.state, 'e2', 'e4')), T0 + 1000).view; // Blue to move; Red paid 1 s on the server
    expect(displayClocksMs(state, T0 + 3000)).toStrictEqual([299000, 298000, 300000, 300000]);
  });

  it('never goes below zero or runs backwards, and stops at the end of the game', () => {
    const { sim, view } = freshView(0);
    expect(displayClocksMs(view, T0 + 10 ** 9)[0]).toBe(0);
    expect(displayClocksMs(view, T0 - 5000), 'a clock reading from before it was received').toStrictEqual([300000, 300000, 300000, 300000]);
    const over = applyGameOver(view, sim.over('elimination'));
    expect(displayClocksMs(over, T0 + 10_000)).toStrictEqual([300000, 300000, 300000, 300000]);
  });

  it('does not run a seat that is not active, and displayClock matches the seat strip shape (seconds, always enabled)', () => {
    const sim = new ServerSim();
    const { view } = freshView(0, sim);
    const out = applyFourState(view, sim.resignSeat(0), T0).view; // Red resigned; the engine passed the turn to Blue
    const running = out.state.turn;
    expect(running).not.toBe(0);
    expect(displayClocksMs(out, T0 + 2000)[0]).toBe(300000);
    expect(displayClocksMs(out, T0 + 2000)[running]).toBe(298000);
    const clock = displayClock(view, T0 + 1500);
    expect(clock.enabled).toBe(true);
    expect(clock.seconds[0]).toBeCloseTo(298.5, 6);
    expect(clock.incrementSeconds).toBe(0);
  });
});

// --- Performance --------------------------------------------------------------------------------------------------------------------

describe('performance', () => {
  it('adopts a full-length game of snapshots quickly (every state is parsed by the engine\'s deserialize)', () => {
    const { sim, view } = freshView(0, new ServerSim(2));
    const payloads: FourStatePayload[] = [];
    while (!sim.state.result && sim.seq < 1000) payloads.push(sim.state.turn === 0 ? sim.play(chooseBotMove(sim.state, 1200, sim.rng) as Move) : sim.bot());
    expect(payloads.length).toBeGreaterThan(200);

    const times: number[] = [];
    let current = view;
    for (const payload of payloads) {
      // Best of 3 adoptions of the same payload onto the same view (a pure reducer: identical work each time), so one scheduler pause / GC / a second suite
      // on the machine cannot become the "max" (a 484 ms outlier failed this when three suites ran at once; the work itself is ~0.1 ms).
      let best = Infinity;
      let next = current;
      for (let attempt = 0; attempt < 3; attempt++) {
        const t0 = performance.now();
        next = applyFourState(current, payload, T0).view;
        best = Math.min(best, performance.now() - t0);
      }
      current = next;
      times.push(best);
    }
    expect(current.seq).toBe(payloads.length);
    const total = times.reduce((a, b) => a + b, 0);
    const sorted = times.slice().sort((a, b) => a - b);
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    // eslint-disable-next-line no-console
    console.info(`[perf] applyFourState over ${payloads.length} real snapshots: total ${total.toFixed(1)} ms, mean ${(total / payloads.length).toFixed(3)} ms, p99 ${p99.toFixed(3)} ms, max ${sorted[sorted.length - 1].toFixed(3)} ms`);
    // generous bounds (CI machines vary): one adoption must be far below a frame, the whole game far below a second
    expect(total / payloads.length).toBeLessThan(5);
    expect(sorted[sorted.length - 1]).toBeLessThan(100);
  });
});

// --- Untrusted server data ------------------------------------------------------------------------------------------------------------

describe('malformed server payloads never reach a render', () => {
  it('a four_game_over missing fields, with a bad reason, bad winners or bad scores is ignored (the status line and result card would crash on it)', () => {
    const { sim, view } = freshView(0);
    const good = sim.over('elimination');
    for (const bad of [
      {},
      { roomId: ROOM },
      { ...good, reason: 'rage-quit' },
      { ...good, winners: undefined },
      { ...good, winners: [7] },
      { ...good, winners: 'Red' },
      { ...good, scores: [1, 2, 3] },
      { ...good, scores: [1, 2, 3, NaN] },
      { ...good, scores: undefined },
      { ...good, state: undefined },
      null,
      undefined,
      5,
    ]) {
      expect(applyGameOver(view, bad as never), JSON.stringify(bad)).toBe(view);
    }
    expect(applyGameOver(view, good).gameOver).not.toBeNull();
  });

  it('seats must be four well-formed seats - in a seat update, a match, a room answer', () => {
    const { sim, view } = freshView(0);
    const badLists: unknown[] = [
      null,
      [],
      [1, 2, 3, 4],
      [null, null, null, null],
      seatsOf().slice(0, 3),
      seatsOf({ 1: { kind: 'wizard' as never } }),
      seatsOf({ 2: { name: 5 as never } }),
      seatsOf({ 3: { connected: 'yes' as never } }),
      seatsOf({ 0: { seat: 9 as never } }),
    ];
    for (const seats of badLists) {
      expect(applySeatUpdate(view, { roomId: ROOM, seats: seats as FourSeats }, T0), JSON.stringify(seats)).toBe(view);
      expect(viewFromMatch({ ...sim.match(0), seats: seats as FourSeats }, T0), `match ${JSON.stringify(seats)}`).toBeNull();
      expect(adoptSnapshot(view, { ...sim.room(), seats: seats as FourSeats }, T0).outcome, `room ${JSON.stringify(seats)}`).toBe('invalid');
    }
    expect(applySeatUpdate(view, { roomId: ROOM, seats: seatsOf() }, T0 + 1)).not.toBe(view);
  });

  it('a bad time control, room id or log in a room is refused or defaulted, not carried into the view', () => {
    const sim = new ServerSim();
    expect(viewFromRoom({ ...sim.room(), timeControl: null as never }, null, T0)).toBeNull();
    expect(viewFromRoom({ ...sim.room(), timeControl: { initialSeconds: 'x', incrementSeconds: 0 } as never }, null, T0)).toBeNull();
    expect(viewFromRoom({ ...sim.room(), roomId: 5 as never }, null, T0)).toBeNull();
    expect(viewFromRoom({ ...sim.room(), log: 'nope' as never }, null, T0)?.log).toStrictEqual([]);
  });

  it('a four_state with a junk move or junk events is still a valid state: the position is adopted, only the extras are dropped', () => {
    const { sim, view } = freshView(0);
    const p = sim.play(mv(sim.state, 'e2', 'e4'));
    const junkMove = applyFourState(view, { ...p, move: { seat: 9, from: 5, to: {}, label: 7 } as never, events: 'none' as never }, T0);
    expect(junkMove.outcome).toBe('applied');
    expect(serialize(junkMove.view.state)).toBe(serialize(sim.state));
    expect(junkMove.view.log).toHaveLength(0);
    expect(junkMove.view.lastMove).toBe(view.lastMove);
    expect(junkMove.view.notices).toStrictEqual([]);
    const noMove = applyFourState(view, { ...p, move: undefined as never, events: undefined as never }, T0);
    expect(noMove.outcome).toBe('applied');
  });
});

// --- Mutation survivors, closed one cluster at a time ---------------------------------------------------------------------------------

describe('SURVIVOR CLUSTER 1 - the promotion piece on the wire', () => {
  const KINGS = ['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7'];

  it('writes each promotion piece as its own letter (q r b n), in a payload the server\'s validator accepts', () => {
    const state = stateFromPieces([...KINGS, 'rP@e7'], { turn: 0 });
    const expected: [number, string][] = [
      [QUEEN, 'q'],
      [ROOK, 'r'],
      [BISHOP, 'b'],
      [KNIGHT, 'n'],
    ];
    for (const [piece, letter] of expected) {
      const move = findLegalMove(state, 0, parseSquare('e7'), parseSquare('e8'), piece);
      expect(move, letter).not.toBeNull();
      const payload = movePayloadFor(ROOM, move as Move);
      expect(payload, letter).toStrictEqual({ roomId: ROOM, from: 'e7', to: 'e8', promotion: letter });
      expect(validateFourMovePayload(payload).ok, letter).toBe(true);
    }
  });

  it('a move that is not a promotion carries no promotion field at all, even on the promotion square\'s neighbours', () => {
    const state = stateFromPieces([...KINGS, 'rP@e6'], { turn: 0 });
    const payload = movePayloadFor(ROOM, findLegalMove(state, 0, parseSquare('e6'), parseSquare('e7')) as Move);
    expect(payload).toStrictEqual({ roomId: ROOM, from: 'e6', to: 'e7' });
    expect('promotion' in payload).toBe(false);
  });
});

describe('SURVIVOR CLUSTER 2 - canMove refuses in every situation where a move makes no sense', () => {
  it('is true only for the live, connected, active player on move - and each other condition alone turns it off', () => {
    const { sim, view } = freshView(0);
    expect(canMove(view, true)).toBe(true);
    // the result arrived as a four_game_over (abandoned: the state itself has no result)
    expect(canMove({ ...view, gameOver: sim.over('abandoned') }, true), 'game over event only').toBe(false);
    // the final STATE arrived but four_game_over has not yet
    expect(canMove({ ...view, state: { ...view.state, result: { winners: [1 as Seat], reason: 'cap' } } }, true), 'state.result only').toBe(false);
    // our own seat is out (a resignation / flag), even though the turn were somehow ours
    expect(canMove({ ...view, state: { ...view.state, status: ['dead-king', 'active', 'active', 'active'] } }, true), 'eliminated only').toBe(false);
    expect(canMove({ ...view, state: { ...view.state, status: ['frozen', 'active', 'active', 'active'] } }, true), 'frozen only').toBe(false);
    expect(canMove({ ...view, resyncing: true }, true), 'resyncing only').toBe(false);
    expect(canMove(view, false), 'offline only').toBe(false);
    expect(canMove({ ...view, state: { ...view.state, turn: 1 } }, true), 'not my turn only').toBe(false);
    const pending = beginMove(view, mv(view.state, 'e2', 'e4')).view;
    expect(canMove(pending, true), 'pending only').toBe(false);
  });
});

describe('SURVIVOR CLUSTER 3 - nothing stale survives a newer authority', () => {
  it('a whole-room answer NEWER than the view replaces the seats and clears lastMove, notices and the move message; an equal one keeps them', () => {
    const { sim, view } = freshView(0);
    const first = sim.play(mv(sim.state, 'e2', 'e4'));
    const withMove = applyFourState(view, first, T0).view;
    expect(withMove.lastMove).not.toBeNull();
    const noted: FourOnlineView = { ...withMove, moveError: 'Your time ran out.', notices: ['Blue was checkmated'], lastMove: { from: 1, to: 2 } };
    const newerSeats = seatsOf({ 1: { kind: 'bot', botReason: 'takeover', name: 'Ben' } });
    sim.bot();
    const answer = { ...sim.room(), seats: newerSeats };
    const newer = adoptSnapshot(noted, answer, T0 + 1);
    expect(newer.outcome).toBe('adopted');
    expect(newer.view.seats, 'the seats of the answer, not the old ones').toBe(newerSeats);
    expect(newer.view.lastMove).toBeNull();
    expect(newer.view.moveError).toBeNull();
    expect(newer.view.notices).toStrictEqual([]);

    const same = adoptSnapshot({ ...noted, seq: sim.seq }, { ...answer, seq: sim.seq }, T0 + 2);
    expect(same.view.lastMove, 'an answer of the same seq changes nothing about the last move').toStrictEqual(noted.lastMove);
    expect(same.view.moveError).toBe('Your time ran out.');
    expect(same.view.notices).toStrictEqual(['Blue was checkmated']);
    expect(same.view.seats, 'but the seats are always the freshest').toBe(newerSeats);
  });

  it('an adopted state clears the previous move\'s error message', () => {
    const { sim, view } = freshView(0);
    const begun = beginMove(view, mv(view.state, 'e2', 'e4'));
    const refused = moveRejected(begun.view, begun.id as number, 'It is not your turn.').view;
    expect(refused.moveError).toBe('It is not your turn.');
    const next = applyFourState(refused, sim.play(mv(sim.state, 'd2', 'd4')), T0).view;
    expect(next.moveError).toBeNull();
  });

  it('a game over drops the optimistic move: the final board is the authority\'s', () => {
    const { sim, view } = freshView(0);
    const pending = beginMove(view, mv(view.state, 'e2', 'e4')).view;
    expect(pending.pending).not.toBeNull();
    const over = applyGameOver(pending, sim.over('abandoned'));
    expect(over.pending).toBeNull();
    expect(displayState(over)).toBe(over.state);
  });
});

describe('SURVIVOR CLUSTER 4 - clocks stop with the result, whichever way the result arrives', () => {
  it('once the final state is in (no four_game_over yet) no clock runs any more', () => {
    const { sim, view } = freshView(0);
    const resigns = [sim.resignSeat(1), sim.resignSeat(2), sim.resignSeat(3)];
    const done = resigns.reduce((v, p) => applyFourState(v, p, T0).view, view);
    expect(done.state.result).not.toBeNull();
    expect(done.gameOver).toBeNull();
    expect(displayClocksMs(done, T0 + 60_000)).toStrictEqual(done.clocksMs);
  });
});
