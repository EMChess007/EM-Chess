import { describe, expect, it } from 'vitest';
import {
  FOUR_CHAT_LOG_MAX,
  LEAVE_GAME_MESSAGE,
  LEAVE_GAME_TITLE,
  appendChat,
  buildSpectateRows,
  describeFourGame,
  describeFourResultNote,
  describeQueue,
  describeStatus,
  fillSecondsLeft,
  graceSecondsLeft,
  isLiveSeat,
  resultRows,
  seatLabel,
  seatLabels,
  type FourChatEntry,
} from '../fourPlayerOnlineUi';
import { applyGameOver, viewFromMatch, type FourOnlineView } from '../fourPlayerOnline';
import { initialState, serialize, stateFromPieces, type FourPlayerState, type Seat } from '../fourPlayer';
import { clocksToWireMs, type FourGameOverPayload, type FourMatchFoundPayload, type FourSeatInfo, type FourSeats } from '../fourPlayerWire';
import type { ActiveGameSummary } from '../../types/multiplayer';

/**
 * The wording and list-building of the 4 Player Online screens (src/logic/fourPlayerOnlineUi.ts). Pure, so pinned here: the spec's exact
 * seat wording ("Bot (Amateur)", name + "bot playing", the grace countdown), the queue line, the result table and the leave dialog.
 */

const human = (seat: Seat, name: string, over: Partial<FourSeatInfo> = {}): FourSeatInfo => ({ seat, kind: 'human', name, connected: true, ...over });
const seats = (over: Partial<Record<number, FourSeatInfo>> = {}): FourSeats =>
  [0, 1, 2, 3].map((s) => over[s] ?? human(s as Seat, ['Ana', 'Ben', 'Cy', 'Di'][s])) as FourSeats;

function matchWith(s: FourSeats, seat: Seat = 0, state: FourPlayerState = initialState()): FourMatchFoundPayload {
  return {
    roomId: 'r1',
    seat,
    playerToken: 't',
    seats: s,
    timeControl: { initialSeconds: 300, incrementSeconds: 0 },
    timeControlLabel: '5 | 0',
    state: serialize(state),
    clocksMs: clocksToWireMs([300, 300, 300, 300]),
    seq: 0,
  };
}
const viewOf = (s: FourSeats = seats(), seat: Seat = 0, state?: FourPlayerState): FourOnlineView => viewFromMatch(matchWith(s, seat, state), 1000) as FourOnlineView;

describe('seat labels (the spec\'s exact wording)', () => {
  it('a fill bot is "Bot (Amateur)" with no badge', () => {
    const bot: FourSeatInfo = { seat: 2, kind: 'bot', botReason: 'fill', name: 'Bot (Amateur)', elo: 1200, connected: true };
    expect(seatLabel(bot, false, 0, 0)).toStrictEqual({ name: 'Bot (Amateur)', badge: null });
  });

  it('a takeover keeps the human\'s name and gets the "bot playing" badge', () => {
    const taken: FourSeatInfo = { seat: 1, kind: 'bot', botReason: 'takeover', name: 'Ben', elo: 1200, connected: true };
    expect(seatLabel(taken, false, 0, 0)).toStrictEqual({ name: 'Ben', badge: 'bot playing' });
    expect(seatLabel(taken, true, 0, 0), 'the viewer\'s own seat taken over (seen after a rejoin)').toStrictEqual({ name: 'Ben (you)', badge: 'bot playing' });
  });

  it('a disconnected human shows the grace countdown, counted down from when the seats arrived', () => {
    const away = human(3, 'Di', { connected: false, graceMsLeft: 45_000 });
    expect(seatLabel(away, false, 10_000, 10_000)).toStrictEqual({ name: 'Di', badge: 'offline · 45s' });
    expect(seatLabel(away, false, 10_000, 10_000 + 12_300)).toStrictEqual({ name: 'Di', badge: 'offline · 33s' });
    expect(seatLabel(away, false, 10_000, 10_000 + 45_000).badge).toBe('offline · 0s');
    expect(seatLabel(away, false, 10_000, 10_000 + 99_000).badge, 'never negative').toBe('offline · 0s');
    expect(seatLabel(away, false, 10_000, 5_000).badge, 'a clock that ran backwards cannot add time').toBe('offline · 45s');
    expect(seatLabel(human(3, 'Di', { connected: false }), false, 0, 0).badge, 'no grace figure: just "offline"').toBe('offline');
  });

  it('marks the viewer\'s own seat, and labels all four in seat order', () => {
    const view = viewOf(seats({ 1: { seat: 1, kind: 'bot', botReason: 'fill', name: 'Bot (Amateur)', elo: 1200, connected: true } }), 2);
    expect(seatLabels(view, 1000).map((l) => l.name)).toStrictEqual(['Ana', 'Bot (Amateur)', 'Cy (you)', 'Di']);
  });

  it('graceSecondsLeft is null without a grace figure', () => {
    expect(graceSecondsLeft(human(0, 'A'), 0, 0)).toBeNull();
  });
});

describe('status line', () => {
  it('says whose move it is, who is a bot, who is offline and when you are in check', () => {
    const view = viewOf(seats(), 0);
    expect(describeStatus(view)).toBe('Your move');
    const blue = viewOf(seats(), 0, { ...initialState(), turn: 1 });
    expect(describeStatus(blue)).toBe('Blue (Ben) to move');
    const bot = viewOf(seats({ 1: { seat: 1, kind: 'bot', botReason: 'fill', name: 'Bot (Amateur)', connected: true } }), 0, { ...initialState(), turn: 1 });
    expect(describeStatus(bot)).toBe('Blue (bot) is thinking…');
    const away = viewOf(seats({ 1: human(1, 'Ben', { connected: false }) }), 0, { ...initialState(), turn: 1 });
    expect(describeStatus(away)).toBe('Blue (Ben) is offline');
    const check = stateFromPieces(['rK@h1', 'yK@g14', 'bK@a8', 'gK@n8', 'bR@h5'], { turn: 0 });
    expect(describeStatus(viewOf(seats(), 0, check))).toBe('Your move — in check!');
  });

  it('reports the result: a winner, a tie, and an abandoned game with no result', () => {
    const over = (reason: FourGameOverPayload['reason'], winners: Seat[]): FourGameOverPayload => ({ roomId: 'r1', reason, winners, scores: [10, 5, 0, 0], state: serialize(initialState()) });
    expect(describeStatus(applyGameOver(viewOf(), over('elimination', [0])))).toBe('Game over — Red wins');
    expect(describeStatus(applyGameOver(viewOf(), over('cap', [0, 2])))).toBe('Game over — Red & Yellow tie');
    expect(describeStatus(applyGameOver(viewOf(), over('abandoned', [])))).toBe('Game abandoned — no result');
  });
});

describe('result table', () => {
  const over = (scores: number[], winners: Seat[], reason: FourGameOverPayload['reason'] = 'elimination'): FourGameOverPayload => ({ roomId: 'r1', reason, winners, scores, state: '' });

  it('ranks by score, breaks ties by seat order, names the players and marks the winners', () => {
    const rows = resultRows(over([5, 30, 30, 0], [1, 2]), seats());
    expect(rows.map((r) => [r.place, r.seat, r.name, r.score, r.winner])).toStrictEqual([
      [1, 1, 'Ben', 30, true],
      [2, 2, 'Cy', 30, true],
      [3, 0, 'Ana', 5, false],
      [4, 3, 'Di', 0, false],
    ]);
  });

  it('has no rows for an abandoned game, and a note that says why', () => {
    expect(resultRows(over([1, 2, 3, 4], [], 'abandoned'), seats())).toStrictEqual([]);
    expect(describeFourResultNote('abandoned')).toMatch(/left/);
    expect(describeFourResultNote('cap')).toMatch(/Move limit/);
    expect(describeFourResultNote('deadPosition')).toMatch(/bare kings/);
    expect(describeFourResultNote('elimination')).toMatch(/eliminated/);
  });

  it('survives short score arrays and missing seats without throwing', () => {
    expect(resultRows(over([7], [0]), seats()).map((r) => r.score)).toStrictEqual([7, 0, 0, 0]);
    expect(() => resultRows(over([1, 2, 3, 4], [0]), [] as unknown as FourSeats)).not.toThrow();
  });
});

describe('leaving', () => {
  it('uses the decided dialog wording', () => {
    expect(LEAVE_GAME_TITLE).toBe('Leave the game?');
    expect(LEAVE_GAME_MESSAGE).toBe('A bot takes your seat after 45s. You can return until the game ends.');
  });

  it('only a live seat needs the confirmation (not a spectator, not a finished game)', () => {
    const live = viewOf();
    expect(isLiveSeat(live)).toBe(true);
    expect(isLiveSeat({ ...live, mySeat: null })).toBe(false);
    expect(isLiveSeat(applyGameOver(live, { roomId: 'r1', reason: 'abandoned', winners: [], scores: [0, 0, 0, 0], state: '' }))).toBe(false);
  });
});

describe('queue line', () => {
  it('counts down the fill time from when the update arrived', () => {
    const update = { queued: 2, fillInMs: 30_000 };
    expect(fillSecondsLeft(update, 5000, 5000)).toBe(30);
    expect(fillSecondsLeft(update, 5000, 5000 + 1)).toBe(30);
    expect(fillSecondsLeft(update, 5000, 5000 + 1000)).toBe(29);
    expect(fillSecondsLeft(update, 5000, 5000 + 29_001)).toBe(1);
    expect(fillSecondsLeft(update, 5000, 5000 + 30_000)).toBe(0);
    expect(fillSecondsLeft(update, 5000, 5000 + 90_000), 'never negative').toBe(0);
    expect(fillSecondsLeft(update, 5000, 1000), 'never more than the server said').toBe(30);
  });

  it('is null while fewer than two people are waiting (fillInMs null) and for junk', () => {
    expect(fillSecondsLeft({ queued: 1, fillInMs: null }, 0, 0)).toBeNull();
    expect(fillSecondsLeft(null, 0, 0)).toBeNull();
    expect(fillSecondsLeft({ queued: 2, fillInMs: Number.NaN }, 0, 0)).toBeNull();
  });

  it('describes each stage', () => {
    expect(describeQueue(null, null).title).toBe('Looking for a game…');
    expect(describeQueue({ queued: 1, fillInMs: null }, null)).toStrictEqual({ title: '1 player waiting', detail: 'Waiting for at least one more player. Bots fill the empty seats once two are here.' });
    expect(describeQueue({ queued: 3, fillInMs: 12_000 }, 12)).toStrictEqual({ title: '3 players waiting', detail: 'Bots fill the empty seats in 12s, sooner if more players join.' });
  });
});

describe('chat log', () => {
  const line = (text: string): Omit<FourChatEntry, 'id'> => ({ fromSeat: 1, name: 'Ben', text, mine: false });

  it('gives increasing ids and keeps only the newest lines', () => {
    let log: FourChatEntry[] = [];
    for (let i = 0; i < FOUR_CHAT_LOG_MAX + 25; i++) log = appendChat(log, line(`m${i}`));
    expect(log).toHaveLength(FOUR_CHAT_LOG_MAX);
    expect(log[0].text).toBe('m25');
    expect(log[log.length - 1].text).toBe(`m${FOUR_CHAT_LOG_MAX + 24}`);
    expect(log[log.length - 1].id).toBe(FOUR_CHAT_LOG_MAX + 25);
    const ids = log.map((l) => l.id);
    expect(ids).toStrictEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not mutate the previous log', () => {
    const first = appendChat([], line('a'));
    const second = appendChat(first, line('b'));
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);
  });
});

describe('spectate list', () => {
  const two = (id: string): ActiveGameSummary => ({ roomId: id, whiteUsername: 'w', blackUsername: 'b', timeControlLabel: '5 | 0' }) as ActiveGameSummary;
  const four = (id: string) => ({ roomId: id, timeControlLabel: '3 | 2', seats: [{ name: 'Ana', kind: 'human' as const }, { name: 'Bot (Amateur)', kind: 'bot' as const }, { name: 'Cy', kind: 'human' as const }, { name: 'Bot (Amateur)', kind: 'bot' as const }] });

  it('lists 4 Player games first under their own heading, then head-to-head games; a heading only where there is a game', () => {
    const rows = buildSpectateRows([two('a'), two('b')], [four('x')]);
    expect(rows.map((r) => r.key)).toStrictEqual(['header:four', 'four:x', 'header:two', 'two:a', 'two:b']);
    expect(buildSpectateRows([two('a')], []).map((r) => r.key), 'no 4 Player games: no heading, no extra row').toStrictEqual(['two:a']);
    expect(buildSpectateRows([], [four('x')]).map((r) => r.key)).toStrictEqual(['header:four', 'four:x']);
    expect(buildSpectateRows([], [])).toStrictEqual([]);
  });

  it('an unavailable 4 Player list (null, e.g. an older server) never hides the head-to-head games', () => {
    expect(buildSpectateRows([two('a')], null).map((r) => r.key)).toStrictEqual(['two:a']);
  });

  it('keys are unique even when a 2-player and a 4 Player room share an id', () => {
    const keys = buildSpectateRows([two('same')], [four('same')]).map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('describes a 4 Player game by its four names', () => {
    expect(describeFourGame(four('x'))).toBe('Ana · Bot (Amateur) · Cy · Bot (Amateur)');
  });
});

// --- Mutation survivors, closed ---------------------------------------------------------------------------------------------------------

describe('SURVIVOR CLUSTER 9 - wording that was not pinned', () => {
  it('a final state that has arrived without its four_game_over yet already reads as the result', () => {
    const final: FourPlayerState = { ...initialState(), result: { winners: [2 as Seat], reason: 'elimination' } };
    expect(describeStatus(viewOf(seats(), 0, final))).toBe('Game over — Yellow wins');
    const tie: FourPlayerState = { ...initialState(), result: { winners: [0 as Seat, 3 as Seat], reason: 'cap' } };
    expect(describeStatus(viewOf(seats(), 0, tie))).toBe('Game over — Red & Green tie');
  });

  it('the Spectate list headings are exactly "4 Player Chess" and "Head to head", each over its own games', () => {
    const two = { roomId: 'a', whiteUsername: 'w', blackUsername: 'b', timeControlLabel: '5 | 0', isChess960: false } as ActiveGameSummary;
    const four = { roomId: 'x', timeControlLabel: '3 | 2', seats: [{ name: 'Ana', kind: 'human' as const }] };
    const rows = buildSpectateRows([two], [four]);
    expect(rows.filter((r) => r.kind === 'header').map((r) => (r.kind === 'header' ? r.title : ''))).toStrictEqual(['4 Player Chess', 'Head to head']);
    expect(rows.map((r) => r.kind)).toStrictEqual(['header', 'four', 'header', 'two']);
  });

  it('a fill countdown needs a real number: null, NaN and Infinity-like values never produce one', () => {
    expect(fillSecondsLeft({ queued: 2, fillInMs: null }, 0, 0)).toBeNull();
    expect(fillSecondsLeft({ queued: 2, fillInMs: Number.POSITIVE_INFINITY }, 0, 0)).toBeNull();
    expect(fillSecondsLeft({ queued: 2, fillInMs: Number.NaN }, 0, 0)).toBeNull();
    expect(fillSecondsLeft({ queued: 2, fillInMs: 0 }, 0, 0)).toBe(0);
  });
});
