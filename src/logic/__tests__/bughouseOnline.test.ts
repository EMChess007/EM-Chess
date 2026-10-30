import { describe, expect, it } from 'vitest';
import { createMatch, remainingAt, serializeMatch, settle, type BughouseAction, type BughouseMatch, type BughouseSeat } from '../bughouse';
import type { BugGameOverPayload, BugMatchFoundPayload, BugRejoinState, BugSeats, BugStatePayload } from '../bughouse/wire';
import {
  actionAcked,
  actionFailed,
  actionPayload,
  adoptRejoin,
  applyBugState,
  applyGameOver,
  applySeatUpdate,
  beginAction,
  beginResync,
  endResync,
  isOver,
  refusalText,
  REFUSAL_TEXT,
  resultOf,
  serverNowAt,
  viewFromMatchFound,
  type BughouseOnlineView,
} from '../bughouseOnline';

/**
 * THE CLIENT'S VIEW OF AN ONLINE BUGHOUSE ROOM (W4), on the REAL engine: every snapshot below is `serializeMatch` of a match the engine produced, so "which snapshot wins", "when to resync",
 * what the clocks show and what a refusal does are tested against exactly what the server sends. No socket, no React, no clock: the caller hands in the instants (all of them literals).
 */
const TC = { initialMs: 60000, incrementMs: 0 };
const SEATS: BugSeats = [0, 1, 2, 3].map((seat) => ({ seat, kind: seat < 2 ? 'human' : 'bot', name: `P${seat}`, connected: true })) as unknown as BugSeats;
const ROOM = 'room-1';

function start(): BughouseMatch {
  return createMatch({ timeControl: TC, roomNumber: 2, startMs: 0 });
}
function play(match: BughouseMatch, seat: BughouseSeat, action: BughouseAction, now: number) {
  const outcome = settle(match, { seat, action }, now);
  if (outcome.kind !== 'applied' && outcome.kind !== 'flag') throw new Error(`not applied: ${outcome.kind}`);
  return outcome;
}
const found = (match: BughouseMatch, seat: BughouseSeat = 0, serverNowMs = 0): BugMatchFoundPayload => ({
  roomId: ROOM,
  seat,
  playerToken: 'token',
  seats: SEATS,
  timeControl: TC,
  timeControlLabel: '1 min',
  state: serializeMatch(match),
  serverNowMs,
  seq: 0,
});
function view(match: BughouseMatch = start(), seat: BughouseSeat = 0, localNow = 1_000_000): BughouseOnlineView {
  const v = viewFromMatchFound(found(match, seat), localNow);
  if (!v) throw new Error('no view');
  return v;
}
const statePayload = (outcome: { match: BughouseMatch; events: unknown[] }, serverNowMs: number): BugStatePayload => ({
  roomId: ROOM,
  seq: outcome.match.seq,
  events: outcome.events as BugStatePayload['events'],
  state: serializeMatch(outcome.match),
  serverNowMs,
});

describe('viewFromMatchFound', () => {
  it('builds the first view from the match_found payload: my seat, the seats, the label, the snapshot, nothing pending', () => {
    const v = view(start(), 3, 1_000_000);
    expect(v.roomId).toBe('room-1');
    expect(v.mySeat).toBe(3);
    expect(v.timeControlLabel).toBe('1 min');
    expect(v.match.seq).toBe(0);
    expect(v.seats).toBe(SEATS);
    expect(v.seatsAt).toBe(1_000_000);
    expect(v.receivedAt).toBe(1_000_000);
    expect(v.serverNowMs).toBe(0);
    expect(v.pending).toBeNull();
    expect(v.resyncing).toBe(false);
    expect(v.gameOver).toBeNull();
    expect(v.actionError).toBeNull();
    expect(v.lastMove).toEqual({ A: null, B: null });
    expect(v.bank).toBeNull();
  });

  it('is null for a seat that is not 0..3, an unreadable snapshot, missing seats or a missing instant', () => {
    expect(viewFromMatchFound({ ...found(start()), seat: 4 as BughouseSeat }, 0)).toBeNull();
    expect(viewFromMatchFound({ ...found(start()), seat: 1.5 as BughouseSeat }, 0)).toBeNull();
    expect(viewFromMatchFound({ ...found(start()), state: 'not a snapshot' }, 0)).toBeNull();
    expect(viewFromMatchFound({ ...found(start()), seats: [] as unknown as BugSeats }, 0)).toBeNull();
    expect(viewFromMatchFound({ ...found(start()), serverNowMs: 'x' as unknown as number }, 0)).toBeNull();
    expect(viewFromMatchFound(null as unknown as BugMatchFoundPayload, 0)).toBeNull();
  });
});

describe('snapshot sync: applyBugState', () => {
  const first = play(start(), 0, { kind: 'move', board: 'A', from: 'e2', to: 'e4' }, 2000);

  it('applies the very next snapshot (seq + 1): the match, the last move, the instant and the arrival time all follow it', () => {
    const v = view();
    const result = applyBugState(v, statePayload(first, 2000), 1_002_100);
    expect(result.outcome).toBe('applied');
    expect(result.resync).toBe(false);
    expect(result.view.match.seq).toBe(1);
    expect(result.view.match.boards.A.fen).toBe(first.match.boards.A.fen);
    expect(result.view.lastMove.A).toEqual({ from: 'e2', to: 'e4' });
    expect(result.view.lastMove.B).toBeNull();
    expect(result.view.serverNowMs).toBe(2000);
    expect(result.view.receivedAt).toBe(1_002_100);
  });

  it('an old or repeated snapshot (seq <= ours) is dropped and returns the very same view', () => {
    const v = applyBugState(view(), statePayload(first, 2000), 1_002_100).view;
    const again = applyBugState(v, statePayload(first, 2000), 1_003_000);
    expect(again.outcome).toBe('stale');
    expect(again.resync).toBe(false);
    expect(again.view).toBe(v);
    const older = applyBugState(v, { ...statePayload(first, 2000), seq: 0 }, 1_003_000);
    expect(older.view).toBe(v);
  });

  it('a gap (seq + 2) asks for a resync and changes nothing', () => {
    const second = play(first.match, 2, { kind: 'move', board: 'B', from: 'e2', to: 'e4' }, 2500);
    const v = view();
    const gap = applyBugState(v, statePayload(second, 2500), 1_002_500);
    expect(gap.outcome).toBe('gap');
    expect(gap.resync).toBe(true);
    expect(gap.view).toBe(v);
  });

  it('text that cannot be read, or whose own seq is not the payload\'s, asks for a resync and changes nothing', () => {
    const v = view();
    const garbled = applyBugState(v, { ...statePayload(first, 2000), state: '{"nope":1}' }, 1_002_000);
    expect(garbled.outcome).toBe('invalid');
    expect(garbled.resync).toBe(true);
    expect(garbled.view).toBe(v);
    const lying = applyBugState(v, { ...statePayload(first, 2000), seq: 1, state: serializeMatch(start()) }, 1_002_000);
    expect(lying.outcome).toBe('invalid');
    expect(lying.resync).toBe(true);
    const noInstant = applyBugState(v, { ...statePayload(first, 2000), serverNowMs: undefined as unknown as number }, 1_002_000);
    expect(noInstant.outcome).toBe('invalid');
  });

  it('a snapshot of another room, or a payload that is not an object, is ignored without a resync', () => {
    const v = view();
    expect(applyBugState(v, { ...statePayload(first, 2000), roomId: 'other' }, 0)).toEqual({ view: v, outcome: 'stale', resync: false });
    expect(applyBugState(v, null as unknown as BugStatePayload, 0).outcome).toBe('stale');
    expect(applyBugState(v, { ...statePayload(first, 2000), seq: 1.5 }, 0).outcome).toBe('stale');
  });

  it('a capture banks the piece for the partner on the other board in the very same snapshot, and the view says which seat and piece', () => {
    let m = start();
    let now = 1000;
    const script: Array<[BughouseSeat, BughouseAction]> = [
      [0, { kind: 'move', board: 'A', from: 'e2', to: 'e4' }],
      [1, { kind: 'move', board: 'A', from: 'd7', to: 'd5' }],
    ];
    for (const [seat, action] of script) {
      m = play(m, seat, action, (now += 500)).match;
    }
    const capture = play(m, 0, { kind: 'move', board: 'A', from: 'e4', to: 'd5' }, now + 500);
    const applied = applyBugState(view(m), statePayload(capture, now + 500), 1_005_000);
    expect(applied.outcome).toBe('applied');
    expect(applied.view.bank).toEqual({ seat: 3, piece: 'p', seq: 3 });
    expect(applied.view.match.pockets[3].p).toBe(1);
    expect(applied.view.lastMove.A).toEqual({ from: 'e4', to: 'd5' });
  });

  it('an applied snapshot clears the last refusal', () => {
    const v = { ...view(), actionError: 'That move is not legal.' };
    expect(applyBugState(v, statePayload(first, 2000), 0).view.actionError).toBeNull();
  });
});

describe('clock math: serverNowAt', () => {
  it('is the server instant of the snapshot plus the LOCAL time since it arrived: 5000 + (1002500 - 1000000) = 7500', () => {
    const v = { ...view(), serverNowMs: 5000, receivedAt: 1_000_000 };
    expect(serverNowAt(v, 1_002_500)).toBe(7500);
    expect(serverNowAt(v, 1_000_000)).toBe(5000);
  });

  it('only differences of the local clock count: a phone whose clock is an hour wrong shows the same figure', () => {
    const wrong = { ...view(), serverNowMs: 5000, receivedAt: 1_000_000 + 3_600_000 };
    expect(serverNowAt(wrong, 1_002_500 + 3_600_000)).toBe(7500);
  });

  it('never goes back: a local clock that reads behind the arrival time adds nothing, and the match\'s own latest instant is a floor', () => {
    const v = { ...view(), serverNowMs: 5000, receivedAt: 1_000_000 };
    expect(serverNowAt(v, 999_000)).toBe(5000);
    const m = play(start(), 0, { kind: 'move', board: 'A', from: 'e2', to: 'e4' }, 9000).match; // the match has seen 9000
    expect(serverNowAt({ ...v, match: m }, 1_000_000)).toBe(9000);
  });

  it('the fractions of a millisecond are dropped (the engine works in whole ms)', () => {
    const v = { ...view(), serverNowMs: 5000, receivedAt: 1_000_000 };
    expect(serverNowAt(v, 1_000_000.9)).toBe(5000);
  });

  it('what a clock shows: the running White clocks of a 60 s match read 52500 ms at server instant 7500, the Black ones a full 60000', () => {
    const v = { ...view(), serverNowMs: 5000, receivedAt: 1_000_000 };
    const now = serverNowAt(v, 1_002_500);
    expect(remainingAt(v.match.clocks[0], now)).toBe(52500);
    expect(remainingAt(v.match.clocks[2], now)).toBe(52500);
    expect(remainingAt(v.match.clocks[1], now)).toBe(60000);
    expect(remainingAt(v.match.clocks[3], now)).toBe(60000);
  });
});

describe('acks: one action in flight, and what answers it', () => {
  const MOVE = { kind: 'move', board: 'A', from: 'e2', to: 'e4' } as const;

  it('beginAction names the room and the board and the seq it was chosen on, and marks the action pending with the next id', () => {
    const begun = beginAction(view(), MOVE);
    expect(begun.id).toBe(1);
    expect(begun.view.pending).toEqual({ id: 1 });
    expect(begun.view.nextId).toBe(2);
    expect(begun.payload).toEqual({ roomId: 'room-1', board: 'A', from: 'e2', to: 'e4', baseSeq: 0 });
    // the board position is NOT touched: the server's snapshot is the only thing that moves a piece
    expect(begun.view.match.boards.A.fen).toBe(start().boards.A.fen);
  });

  it('a drop and a promotion carry their own fields', () => {
    expect(actionPayload(view(), { kind: 'drop', board: 'B', piece: 'n', square: 'f6' })).toEqual({ roomId: 'room-1', board: 'B', piece: 'n', square: 'f6', baseSeq: 0 });
    expect(actionPayload(view(), { kind: 'move', board: 'A', from: 'e7', to: 'e8', promotion: 'q' })).toEqual({ roomId: 'room-1', board: 'A', from: 'e7', to: 'e8', promotion: 'q', baseSeq: 0 });
  });

  it('a second action while one is in flight is not sent', () => {
    const first = beginAction(view(), MOVE);
    const second = beginAction(first.view, { kind: 'move', board: 'A', from: 'd2', to: 'd4' });
    expect(second.id).toBeNull();
    expect(second.payload).toBeNull();
    expect(second.view).toBe(first.view);
  });

  it('nothing is sent while a resync runs or after the game is over', () => {
    const resyncing = { ...view(), resyncing: true };
    expect(beginAction(resyncing, MOVE).id).toBeNull();
    const over = applyGameOver(view(), { roomId: ROOM, result: { winnerTeam: 1, reason: 'resign', board: 'A', loserSeat: 1 }, state: serializeMatch(start()) }, 0);
    expect(beginAction(over, MOVE).id).toBeNull();
  });

  it('a payload the wire would refuse (a square that is not a square) is not sent and says why', () => {
    const begun = beginAction(view(), { kind: 'move', board: 'A', from: 'z9', to: 'e4' });
    expect(begun.id).toBeNull();
    expect(begun.view.actionError).toBe('Invalid move.');
    expect(begun.view.pending).toBeNull();
  });

  it('actionAcked ends the wait of THAT action only', () => {
    const begun = beginAction(view(), MOVE);
    expect(actionAcked(begun.view, 1).pending).toBeNull();
    expect(actionAcked(begun.view, 2)).toBe(begun.view);
    expect(actionAcked(view(), 1).pending).toBeNull();
  });

  it('actionFailed ends the wait and shows the sentence; the answer of another action is ignored', () => {
    const begun = beginAction(view(), MOVE);
    const failed = actionFailed(begun.view, 1, 'That move is not legal.');
    expect(failed.pending).toBeNull();
    expect(failed.actionError).toBe('That move is not legal.');
    expect(actionFailed(begun.view, 9, 'x')).toBe(begun.view);
  });

  it('beginAction clears the previous refusal', () => {
    const v = { ...view(), actionError: 'old' };
    expect(beginAction(v, MOVE).view.actionError).toBeNull();
  });
});

describe('refusals in words: every reason of the closed list has its own sentence', () => {
  it('the fourteen reasons, literally', () => {
    expect(REFUSAL_TEXT).toEqual({
      over: 'The game is over.',
      time: 'That move came too late.',
      flagDue: 'A clock has run out.',
      malformed: 'That move was not understood.',
      wrongBoard: 'That is not your board.',
      notYourTurn: 'It is not your turn on this board.',
      illegalMove: 'That move is not legal.',
      dropNotInPocket: 'You no longer have that piece in your pocket.',
      illegalDrop: 'You cannot drop there.',
      invalidRequest: 'That request was not understood.',
      noGame: 'You are not in this game any more.',
      rateLimited: 'Slow down: too many moves at once.',
      duplicate: 'That was already sent.',
      partnerIsBot: 'Your partner is a bot.',
    });
  });

  it('an unknown reason (or one that is not text, or an object property name) is the generic sentence', () => {
    expect(refusalText('illegalMove')).toBe('That move is not legal.');
    expect(refusalText('somethingNew')).toBe('The server refused that.');
    expect(refusalText(undefined)).toBe('The server refused that.');
    expect(refusalText('toString')).toBe('The server refused that.');
    expect(refusalText('__proto__')).toBe('The server refused that.');
  });
});

describe('rejoin: adoptRejoin', () => {
  const first = play(start(), 0, { kind: 'move', board: 'A', from: 'e2', to: 'e4' }, 2000);
  const second = play(first.match, 2, { kind: 'move', board: 'B', from: 'd2', to: 'd4' }, 2500);
  const room = (match: BughouseMatch, serverNowMs: number): BugRejoinState => ({ roomId: ROOM, seat: 0, seats: SEATS, timeControl: TC, timeControlLabel: '1 min', seq: match.seq, state: serializeMatch(match), serverNowMs, log: [] });

  it('adopts a newer room whole: the match, the seats, the instant, the arrival time; the last move (not in it) is dropped; a pending action and the resync flag end', () => {
    const v = { ...applyBugState(view(), statePayload(first, 2000), 1_002_000).view, pending: { id: 3 }, resyncing: true };
    const adopted = adoptRejoin(v, room(second.match, 2500), 1_004_000);
    expect(adopted.outcome).toBe('adopted');
    expect(adopted.view.match.seq).toBe(2);
    expect(adopted.view.serverNowMs).toBe(2500);
    expect(adopted.view.receivedAt).toBe(1_004_000);
    expect(adopted.view.seatsAt).toBe(1_004_000);
    expect(adopted.view.lastMove).toEqual({ A: null, B: null });
    expect(adopted.view.bank).toBeNull();
    expect(adopted.view.pending).toBeNull();
    expect(adopted.view.resyncing).toBe(false);
  });

  it('the very same commit keeps the last move the view already knows', () => {
    const v = applyBugState(view(), statePayload(first, 2000), 1_002_000).view;
    const adopted = adoptRejoin({ ...v, resyncing: true }, room(first.match, 2100), 1_003_000);
    expect(adopted.outcome).toBe('adopted');
    expect(adopted.view.lastMove.A).toEqual({ from: 'e2', to: 'e4' });
  });

  it('a room OLDER than ours is ignored (the resync flag ends, nothing else changes)', () => {
    const v = { ...applyBugState(view(), statePayload(first, 2000), 1_002_000).view, resyncing: true };
    const adopted = adoptRejoin(v, room(start(), 0), 1_003_000);
    expect(adopted.outcome).toBe('older');
    expect(adopted.view.match).toBe(v.match);
    expect(adopted.view.resyncing).toBe(false);
  });

  it('an unreadable room, another room or a missing instant is invalid and changes nothing', () => {
    const v = view();
    expect(adoptRejoin(v, { ...room(first.match, 1), state: 'x' }, 0)).toEqual({ view: v, outcome: 'invalid' });
    expect(adoptRejoin(v, { ...room(first.match, 1), roomId: 'other' }, 0).outcome).toBe('invalid');
    expect(adoptRejoin(v, { ...room(first.match, 1), serverNowMs: undefined as unknown as number }, 0).outcome).toBe('invalid');
    expect(adoptRejoin(v, { ...room(first.match, 1), seats: [] as unknown as BugSeats }, 0).outcome).toBe('invalid');
  });

  it('one resync at a time, none once the game is over; endResync only changes a running one', () => {
    const v = view();
    const begun = beginResync(v);
    expect(begun.send).toBe(true);
    expect(begun.view.resyncing).toBe(true);
    expect(beginResync(begun.view)).toEqual({ view: begun.view, send: false });
    expect(endResync(begun.view).resyncing).toBe(false);
    expect(endResync(v)).toBe(v);
    const over = applyGameOver(v, { roomId: ROOM, result: { winnerTeam: 2, reason: 'flag', board: 'B', loserSeat: 2 }, state: serializeMatch(start()) }, 0);
    expect(beginResync(over).send).toBe(false);
  });
});

describe('the end: applyGameOver, resultOf, isOver', () => {
  const resigned = settle(start(), { seat: 1, action: { kind: 'resign' } }, 3000);
  const final = resigned.match;
  const over = (state: string, result = final.result!): BugGameOverPayload => ({ roomId: ROOM, result, state });

  it('the match\'s own result is the result once its final snapshot arrived; bug_game_over alone also ends the game on screen', () => {
    const v = view();
    expect(isOver(v)).toBe(false);
    expect(resultOf(v)).toBeNull();
    const ended = applyGameOver(v, over(serializeMatch(final)), 1_003_000);
    expect(isOver(ended)).toBe(true);
    expect(resultOf(ended)).toEqual(final.result);
    expect(ended.match.seq).toBe(final.seq);
    expect(ended.gameOver).not.toBeNull();
    // the snapshot of the ending is older than ours (we already have a later one): the result still shows, our match stays
    const later = play(start(), 0, { kind: 'move', board: 'A', from: 'e2', to: 'e4' }, 2000);
    const ahead = applyBugState(view(), statePayload(later, 2000), 1_002_000).view;
    const kept = applyGameOver(ahead, over('garbage'), 1_003_000);
    expect(kept.match).toBe(ahead.match);
    expect(resultOf(kept)).toEqual(final.result);
  });

  it('ends a pending action and a resync (the result is on screen whatever else is in flight)', () => {
    const v = { ...view(), pending: { id: 1 }, resyncing: true };
    const ended = applyGameOver(v, over(serializeMatch(final)), 0);
    expect(ended.pending).toBeNull();
    expect(ended.resyncing).toBe(false);
  });

  it('a payload for another room, or without a result, changes nothing', () => {
    const v = view();
    expect(applyGameOver(v, { ...over(serializeMatch(final)), roomId: 'other' }, 0)).toBe(v);
    expect(applyGameOver(v, { roomId: ROOM, state: '' } as unknown as BugGameOverPayload, 0)).toBe(v);
    expect(applyGameOver(v, null as unknown as BugGameOverPayload, 0)).toBe(v);
  });
});

describe('seat updates', () => {
  it('replace the seat list and the time it arrived; another room\'s or a malformed list is ignored', () => {
    const v = view();
    const next = [...SEATS].map((s) => ({ ...s, name: `${s.name}!` })) as unknown as BugSeats;
    const updated = applySeatUpdate(v, { roomId: ROOM, seats: next }, 1_009_000);
    expect(updated.seats).toBe(next);
    expect(updated.seatsAt).toBe(1_009_000);
    expect(applySeatUpdate(v, { roomId: 'other', seats: next }, 1)).toBe(v);
    expect(applySeatUpdate(v, { roomId: ROOM, seats: [] as unknown as BugSeats }, 1)).toBe(v);
  });
});
