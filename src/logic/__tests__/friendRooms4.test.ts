import { describe, expect, it } from 'vitest';
import {
  FOUR_ROOM_MAX_MEMBERS,
  FOUR_ROOM_NOT_FOUND_MESSAGE,
  FOUR_ROOM_TTL_MS,
  fourControlLabel,
  normalizeFourRoomCode,
  validateFourRoomCreate,
  validateFourRoomJoin,
} from '../fourPlayerRoomWire';
import { BUG_ROOM_CODE_ALPHABET, BUG_ROOM_CODE_LENGTH, BUG_ROOM_TTL_MS } from '../bughouse/roomWire';
import { botSeatsOf, canStartRoom, closedText, roomHeadline, roomLines, startText } from '../fourPlayerRoomUi';
import { joinFriendCode, FRIEND_CODE_NOT_FOUND, type FriendCodeAnswer } from '../friendCodeJoin';
import { FOUR_SEAT_GAMES, FOUR_SEAT_GAME_TITLES, fourVariantOfGame, gameOfFourVariant, isFourSeatGame } from '../onlineGames';
import { TIME_CONTROLS } from '../timeControls';

/**
 * THE 4-SEAT FRIEND ROOMS AND THE ONE "JOIN BY CODE" (command #35), the pure parts: the room wire (its code rules are Bughouse's and the 2-player challenge's, pinned equal), the wording of the
 * room screen, the games of the online chip row, and the order in which a code is tried. Every expectation is a literal.
 */
describe('the room wire', () => {
  it('has the code rules of the Bughouse rooms and the 2-player challenges: 31 characters, 6 long, 10 minutes, four members', () => {
    expect(FOUR_ROOM_MAX_MEMBERS).toBe(4);
    expect(FOUR_ROOM_TTL_MS).toBe(600000);
    expect(FOUR_ROOM_TTL_MS).toBe(BUG_ROOM_TTL_MS);
    expect(BUG_ROOM_CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
    expect(BUG_ROOM_CODE_LENGTH).toBe(6);
    expect(normalizeFourRoomCode(' abc-234 ')).toBe('ABC234');
    for (const bad of ['ABC23', 'ABC2345', 'ABC10O', 5, null, undefined, 'x'.repeat(65)]) expect(normalizeFourRoomCode(bad), String(bad)).toBeNull();
  });

  it('a create needs a game and one control of the list; a join is a code or the one sentence', () => {
    for (const tc of TIME_CONTROLS) expect(validateFourRoomCreate({ variant: 'ffa', timeControl: { initialSeconds: tc.initialSeconds, incrementSeconds: tc.incrementSeconds } }).ok, tc.id).toBe(true);
    expect(validateFourRoomCreate({ timeControl: { initialSeconds: 300, incrementSeconds: 0 } }).ok).toBe(false);
    expect(validateFourRoomCreate({ variant: 'bughouse', timeControl: { initialSeconds: 300, incrementSeconds: 0 } }).ok).toBe(false);
    expect(validateFourRoomCreate({ variant: 'giveaway', timeControl: { initialSeconds: 301, incrementSeconds: 99 } }).ok).toBe(false);
    expect(validateFourRoomJoin({ code: 'k7m2pq' })).toEqual({ ok: true, value: { code: 'K7M2PQ' } });
    expect(validateFourRoomJoin({ code: 'nope' })).toEqual({ ok: false, error: FOUR_ROOM_NOT_FOUND_MESSAGE });
    expect(FOUR_ROOM_NOT_FOUND_MESSAGE).toBe('That code was not found or has expired.');
  });

  it('labels every control of the list as the list does', () => {
    for (const tc of TIME_CONTROLS) expect(fourControlLabel({ initialSeconds: tc.initialSeconds, incrementSeconds: tc.incrementSeconds }), tc.id).toBe(tc.label);
  });
});

describe('the room screen\'s wording', () => {
  const view = (members: string[], youAre: 'host' | 'friend' = 'host') => ({ youAre, hostName: 'Ann', variant: 'giveaway' as const, timeControlLabel: '3 | 2', members });

  it('names the seats and the bots that would fill them', () => {
    expect(roomLines(view(['Ann'])).map((l) => l.text)).toEqual(['Ann (you, host)', 'Bot fills this seat', 'Bot fills this seat', 'Bot fills this seat']);
    expect(roomLines(view(['Ann', 'Ben', 'Cy', 'Di'], 'friend')).map((l) => l.text)).toEqual(['Ann (host)', 'Ben', 'Cy', 'Di']);
    expect(roomLines(view(['Ann', 'Ben'])).filter((l) => l.bot)).toHaveLength(2);
    expect([1, 2, 3, 4].map((n) => botSeatsOf({ members: Array.from({ length: n }, () => 'x') }))).toEqual([3, 2, 1, 0]);
  });

  it('Start needs the host and a friend and says how many bots fill', () => {
    expect(canStartRoom({ youAre: 'host', members: ['Ann'] })).toBe(false);
    expect(canStartRoom({ youAre: 'host', members: ['Ann', 'Ben'] })).toBe(true);
    expect(canStartRoom({ youAre: 'friend', members: ['Ann', 'Ben'] })).toBe(false);
    expect([1, 2, 3, 4].map((n) => startText({ members: Array.from({ length: n }, () => 'x') }))).toEqual([
      'Start - 3 bots fill the empty seats',
      'Start - 2 bots fill the empty seats',
      'Start - 1 bot fills the empty seat',
      'Start the game',
    ]);
  });

  it('the headline and the closed sentences', () => {
    expect(roomHeadline(view(['Ann']))).toBe('4 Player Giveaway · 3 | 2 - send your code to up to three friends.');
    expect(roomHeadline(view(['Ann', 'Ben'], 'friend'))).toBe("4 Player Giveaway · 3 | 2 - you joined Ann's room.");
    expect(closedText('hostLeft')).toBe('The host closed the room.');
    expect(closedText('expired')).toBe('The room expired. Open a new one.');
  });
});

describe('the games of the online chip row', () => {
  it('are the four 4 Player Variations, in this order, with these names', () => {
    expect(FOUR_SEAT_GAMES.map((g) => g.value)).toEqual(['fourPlayerChess', 'fourPlayerGiveaway', 'chaturaji', 'crazyBughouse']);
    expect(FOUR_SEAT_GAMES.map((g) => g.label.replace('\n', ' '))).toEqual(['4 Player Chess', '4 Player Giveaway', 'Chaturaji', 'Crazy Bughouse']);
    expect(FOUR_SEAT_GAME_TITLES).toEqual({ fourPlayerChess: '4 Player Chess', fourPlayerGiveaway: '4 Player Giveaway', chaturaji: 'Chaturaji', crazyBughouse: 'Crazy Bughouse' });
  });

  it('map to the 4-seat engine\'s variants (Crazy Bughouse has its own engine) and back', () => {
    expect(FOUR_SEAT_GAMES.map((g) => fourVariantOfGame(g.value))).toEqual(['ffa', 'giveaway', 'chaturaji', null]);
    expect((['ffa', 'giveaway', 'chaturaji'] as const).map(gameOfFourVariant)).toEqual(['fourPlayerChess', 'fourPlayerGiveaway', 'chaturaji']);
    expect(['classic', 'chess960', 'crazyhouse'].some(isFourSeatGame)).toBe(false);
    expect(['fourPlayerChess', 'crazyBughouse'].every(isFourSeatGame)).toBe(true);
  });
});

describe('Join by Code: one field, tried as a challenge, a Crazy Bughouse room and a 4-seat room', () => {
  type Sent = { event: string; code: string };
  const run = async (code: string, answers: Record<string, FriendCodeAnswer>) => {
    const sent: Sent[] = [];
    const result = await joinFriendCode(code, async (event, payload) => {
      sent.push({ event, code: payload.code });
      return answers[event] ?? { ack: { ok: false, error: 'That code was not found or has expired.' } };
    });
    return { result, sent };
  };
  const NOT_FOUND = { ack: { ok: false as const, error: 'That challenge code was not found or has expired.' } };

  it('a challenge code stops at the first request', async () => {
    const { result, sent } = await run('ABC234', { join_challenge: { ack: { ok: true } } });
    expect(result).toEqual({ kind: 'challenge' });
    expect(sent.map((s) => s.event)).toEqual(['join_challenge']);
  });

  it('a Crazy Bughouse room code is found second, a 4-seat room code third; the room comes back', async () => {
    const bug = await run('abc234', { join_challenge: NOT_FOUND, bug_room_join: { ack: { ok: true, room: { code: 'ABC234' } } } });
    expect(bug.result).toEqual({ kind: 'bughouse', room: { code: 'ABC234' } });
    expect(bug.sent).toEqual([{ event: 'join_challenge', code: 'abc234' }, { event: 'bug_room_join', code: 'ABC234' }]);
    const four = await run('ABC234', { join_challenge: NOT_FOUND, four_room_join: { ack: { ok: true, room: { code: 'ABC234', variant: 'chaturaji' } } } });
    expect(four.result).toEqual({ kind: 'four', room: { code: 'ABC234', variant: 'chaturaji' } });
    expect(four.sent.map((s) => s.event)).toEqual(['join_challenge', 'bug_room_join', 'four_room_join']);
  });

  it('a wrong code is ONE sentence, whichever service refused; nothing is sent for what cannot be a room code beyond the challenge', async () => {
    const wrong = await run('ZZZZZZ', {});
    expect(wrong.result).toEqual({ kind: 'refused', error: FRIEND_CODE_NOT_FOUND });
    expect(wrong.sent.map((s) => s.event)).toEqual(['join_challenge', 'bug_room_join', 'four_room_join']);
    const notACode = await run('QQQ111', {});
    expect(notACode.result).toEqual({ kind: 'refused', error: FRIEND_CODE_NOT_FOUND });
    expect(notACode.sent.map((s) => s.event)).toEqual(['join_challenge']); // '1' is not in the alphabet: no room can have it
    expect((await run('   ', {})).sent).toEqual([]);
  });

  it('a refusal about the PLAYER ends the search and is shown as it is; a cooldown is shown if nothing else was said', async () => {
    const busy = await run('ABC234', { join_challenge: NOT_FOUND, bug_room_join: { ack: { ok: false, error: 'You already have an open room. Leave it first.' } } });
    expect(busy.result).toEqual({ kind: 'refused', error: 'You already have an open room. Leave it first.' });
    expect(busy.sent.map((s) => s.event)).toEqual(['join_challenge', 'bug_room_join']);
    const cooldown = await run('ABC234', { join_challenge: { ack: { ok: false, error: 'Too many wrong codes. Try again in 5 minutes.' } } });
    expect(cooldown.result).toEqual({ kind: 'refused', error: 'Too many wrong codes. Try again in 5 minutes.' });
    expect(cooldown.sent.map((s) => s.event)).toEqual(['join_challenge', 'bug_room_join', 'four_room_join']); // the other services' limiters are independent
  });

  it('no answer from any of them is "unreachable" and stops there', async () => {
    const first = await run('ABC234', { join_challenge: { unreachable: true } });
    expect(first.result).toEqual({ kind: 'unreachable' });
    expect(first.sent).toHaveLength(1);
    const third = await run('ABC234', { join_challenge: NOT_FOUND, four_room_join: { unreachable: true }, bug_room_join: NOT_FOUND });
    expect(third.result).toEqual({ kind: 'unreachable' });
  });
});
