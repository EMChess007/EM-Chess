import { describe, expect, it } from 'vitest';
import {
  BUG_CHAT_MAX_LENGTH,
  BUG_CLIENT_EVENT_NAMES,
  BUG_ID_MAX_LENGTH,
  BUG_QUICK_CODE_COUNT,
  BUG_REJECT_REASONS,
  BUG_SERVER_EVENT_NAMES,
  BUGHOUSE_TIME_CONTROLS,
  bugRefusal,
  classifyBugRejoinAck,
  normalizeBugChatText,
  validateBugBoard,
  validateBugDropPayload,
  validateBugId,
  validateBugJoinQueue,
  validateBugMovePayload,
  validateBugQuickCode,
  validateBugRejoin,
  validateBugRoomPayload,
  validateBugTimeControl,
} from '../bughouse';
import { FOUR_CLIENT_EVENT_NAMES, FOUR_SERVER_EVENT_NAMES } from '../fourPlayerWire';

/**
 * The Bughouse wire contract (bughouse/wire.ts, W2): the limits, the closed list of refusal reasons, the event names and the validators the server runs on EVERY inbound payload.
 * Constants are written out as literals.
 */
const ROOM = '0b2c2f3e-6d5b-4d3b-9f55-0a1b2c3d4e5f';

describe('limits and names', () => {
  it('literals', () => {
    expect(BUG_CHAT_MAX_LENGTH).toBe(500);
    expect(BUG_ID_MAX_LENGTH).toBe(64);
    expect(BUG_QUICK_CODE_COUNT).toBe(10);
  });

  it('the closed list of refusal reasons: the engine\'s nine, then the server\'s five', () => {
    expect([...BUG_REJECT_REASONS]).toEqual(['over', 'time', 'flagDue', 'malformed', 'wrongBoard', 'notYourTurn', 'illegalMove', 'dropNotInPocket', 'illegalDrop', 'invalidRequest', 'noGame', 'rateLimited', 'duplicate', 'partnerIsBot']);
    expect(bugRefusal('noGame', 'x')).toEqual({ ok: false, error: 'x', reason: 'noGame' });
  });

  it('eleven client events and seven server events, all bug_*, none shared with the 4-seat protocol', () => {
    expect([...BUG_CLIENT_EVENT_NAMES]).toEqual(['bug_join_queue', 'bug_leave_queue', 'bug_move', 'bug_drop', 'bug_resign', 'bug_rejoin', 'bug_chat', 'bug_quick', 'bug_list_active_games', 'bug_spectate_game', 'bug_stop_spectating']);
    expect([...BUG_SERVER_EVENT_NAMES]).toEqual(['bug_queue_update', 'bug_match_found', 'bug_state', 'bug_seat_update', 'bug_game_over', 'bug_chat_from', 'bug_quick_from']);
    const four = new Set<string>([...FOUR_CLIENT_EVENT_NAMES, ...FOUR_SERVER_EVENT_NAMES]);
    for (const name of [...BUG_CLIENT_EVENT_NAMES, ...BUG_SERVER_EVENT_NAMES]) expect(four.has(name)).toBe(false);
  });
});

describe('ids and boards', () => {
  it('an id is a non-empty string of at most 64 characters', () => {
    expect(validateBugId(ROOM)).toEqual({ ok: true, value: ROOM });
    expect(validateBugId('x'.repeat(64)).ok).toBe(true);
    for (const bad of ['', 'x'.repeat(65), 5, null, undefined, {}, []]) expect(validateBugId(bad).ok).toBe(false);
  });

  it('a board is exactly "A" or "B"', () => {
    expect(validateBugBoard('A')).toEqual({ ok: true, value: 'A' });
    expect(validateBugBoard('B')).toEqual({ ok: true, value: 'B' });
    for (const bad of ['a', 'b', 'C', '', 0, 1, null, undefined, ['A']]) expect(validateBugBoard(bad).ok).toBe(false);
  });
});

describe('the time control', () => {
  it('only the spec\'s six are valid, in milliseconds', () => {
    for (const tc of BUGHOUSE_TIME_CONTROLS) expect(validateBugTimeControl({ ...tc })).toEqual({ ok: true, value: tc });
    const refused: unknown[] = [{ initialMs: 600000, incrementMs: 0 }, { initialMs: 180000, incrementMs: 1000 }, { initialMs: 180000 }, { initialSeconds: 180, incrementSeconds: 0 }, { initialMs: '180000', incrementMs: 0 }, { initialMs: 180000.5, incrementMs: 0 }, null, undefined, 5, 'x', []];
    for (const tc of refused) expect(validateBugTimeControl(tc).ok).toBe(false);
  });

  it('a join takes a time control and nothing else matters', () => {
    expect(validateBugJoinQueue({ timeControl: { initialMs: 60000, incrementMs: 0 }, extra: 1 })).toEqual({ ok: true, value: { timeControl: { initialMs: 60000, incrementMs: 0 } } });
    for (const bad of [undefined, null, 5, {}, { timeControl: null }]) expect(validateBugJoinQueue(bad).ok).toBe(false);
  });
});

describe('moves and drops', () => {
  const move = { roomId: ROOM, board: 'A', from: 'e2', to: 'e4' };
  it('a move needs a room, a board and two canonical squares; the promotion and baseSeq are optional and checked', () => {
    expect(validateBugMovePayload(move)).toEqual({ ok: true, value: move });
    expect(validateBugMovePayload({ ...move, promotion: 'q', baseSeq: 12 })).toEqual({ ok: true, value: { ...move, promotion: 'q', baseSeq: 12 } });
    expect(validateBugMovePayload({ ...move, recipients: [1], seat: 3 })).toEqual({ ok: true, value: move }); // unknown fields are dropped, not carried
    const bad = [undefined, null, 0, 'x', [], {}, { ...move, board: 'C' }, { ...move, board: undefined }, { ...move, from: 'E2' }, { ...move, from: 'e9' }, { ...move, to: 'e04' }, { ...move, to: 5 }, { ...move, promotion: 'k' }, { ...move, promotion: 'Q' }, { ...move, baseSeq: -1 }, { ...move, baseSeq: 1.5 }, { ...move, roomId: '' }];
    for (const payload of bad) expect(validateBugMovePayload(payload).ok, JSON.stringify(payload)).toBe(false);
    expect(validateBugMovePayload({ ...move, board: 'C' })).toMatchObject({ ok: false, reason: 'invalidRequest' });
  });

  it('a drop needs a room, a board, a pocket piece (never a king) and a canonical square', () => {
    const drop = { roomId: ROOM, board: 'B', piece: 'n', square: 'f3' };
    expect(validateBugDropPayload(drop)).toEqual({ ok: true, value: drop });
    for (const piece of ['p', 'n', 'b', 'r', 'q']) expect(validateBugDropPayload({ ...drop, piece }).ok).toBe(true);
    for (const bad of [{ ...drop, piece: 'k' }, { ...drop, piece: 'N' }, { ...drop, piece: 5 }, { ...drop, square: 'z9' }, { ...drop, square: 'f03' }, { ...drop, board: undefined }, { ...drop, roomId: 5 }, null, undefined, 'x']) {
      expect(validateBugDropPayload(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('room and rejoin payloads', () => {
    expect(validateBugRoomPayload({ roomId: ROOM, junk: true })).toEqual({ ok: true, value: { roomId: ROOM } });
    expect(validateBugRoomPayload({}).ok).toBe(false);
    expect(validateBugRejoin({ roomId: ROOM, playerToken: ROOM })).toEqual({ ok: true, value: { roomId: ROOM, playerToken: ROOM } });
    for (const bad of [undefined, null, {}, { roomId: ROOM }, { playerToken: ROOM }, { roomId: ROOM, playerToken: '' }]) expect(validateBugRejoin(bad).ok).toBe(false);
  });
});

describe('chat text and quick codes', () => {
  it('text is trimmed, cut at 500 and refused when empty or not text', () => {
    expect(normalizeBugChatText('  hi  ')).toEqual({ ok: true, value: 'hi' });
    expect(normalizeBugChatText('x'.repeat(501))).toEqual({ ok: true, value: 'x'.repeat(500) });
    for (const bad of ['', '   ', '\n', 5, null, undefined, {}, []]) expect(normalizeBugChatText(bad).ok).toBe(false);
  });

  it('a quick code is an integer 0..9 and nothing else', () => {
    for (let code = 0; code <= 9; code++) expect(validateBugQuickCode(code)).toEqual({ ok: true, value: code });
    for (const bad of [-1, 10, 1.5, NaN, Infinity, '3', '', null, undefined, true, [], {}, [3]]) expect(validateBugQuickCode(bad).ok, String(bad)).toBe(false);
  });
});

describe('the rejoin answer', () => {
  it('a live match resumes, a finished one hands back its result, anything else is unavailable', () => {
    const state = { roomId: ROOM, seat: 1 as const, seats: [] as never, timeControl: BUGHOUSE_TIME_CONTROLS[0], timeControlLabel: '1 min', seq: 3, state: '{}', serverNowMs: 5, log: [] };
    expect(classifyBugRejoinAck({ ok: true, state })).toEqual({ kind: 'state', state });
    const gameOver = { roomId: ROOM, result: { voided: true as const, reason: 'abandoned' as const }, state: '{}' };
    expect(classifyBugRejoinAck({ ok: true, finished: true, gameOver })).toEqual({ kind: 'finished', gameOver });
    expect(classifyBugRejoinAck(bugRefusal('noGame', 'gone'))).toEqual({ kind: 'unavailable', error: 'gone' });
  });
});
