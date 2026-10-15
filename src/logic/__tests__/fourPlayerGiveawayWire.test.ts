import { describe, expect, it } from 'vitest';
import {
  FOUR_REASONS,
  fourVariantOf,
  validateFourJoinQueue,
  validateFourMovePayload,
  validateFourVariant,
  type FourActiveGameSummary,
  type FourGameOverPayload,
  type FourJoinQueuePayload,
  type FourMatchFoundPayload,
  type FourReason,
  type FourRoomState,
  type FourVariant,
} from '../fourPlayerWire';
import { isGameOverPayload } from '../fourPlayerOnline';
import { GIVEAWAY_RULES, deserialize, describeResultReason, initialState, legalMoves, playMove, serialize, type FourPlayerResult } from '../fourPlayer';
import { mulberry32 } from './fourPlayerGoldenKit';

/**
 * 4 Player Giveaway on the wire (FOUR_PLAYER_GIVEAWAY_SPEC.md section 7). The existing fourPlayerWire.test.ts is untouched and still pins the
 * Chess protocol; this file pins what Giveaway ADDS and that nothing it adds changes what an old client sends or receives.
 */
const TC = { initialSeconds: 300, incrementSeconds: 0 };

describe('validateFourVariant', () => {
  it('an omitted variant is 4 Player Chess; both known variants are accepted as given', () => {
    expect(validateFourVariant(undefined)).toEqual({ ok: true, value: 'ffa' });
    expect(validateFourVariant('ffa')).toEqual({ ok: true, value: 'ffa' });
    expect(validateFourVariant('giveaway')).toEqual({ ok: true, value: 'giveaway' });
  });

  it('refuses everything else with an error - it never quietly plays the wrong game', () => {
    for (const bad of ['Giveaway', 'GIVEAWAY', 'giveaway ', ' ffa', 'chess', 'antichess', '', null, 0, 1, true, false, {}, [], ['giveaway'], { variant: 'giveaway' }, () => 'ffa', NaN]) {
      expect(validateFourVariant(bad), String(JSON.stringify(bad))).toEqual({ ok: false, error: 'Unknown game mode.' });
    }
  });
});

describe('four_join_queue carries the variant', () => {
  it('a payload from a client that predates Giveaway validates to EXACTLY what it always did (no variant key appears)', () => {
    expect(validateFourJoinQueue({ timeControl: TC })).toEqual({ ok: true, value: { timeControl: TC } });
    expect(validateFourJoinQueue({ timeControl: TC, timeControlLabel: '5 min' })).toEqual({ ok: true, value: { timeControl: TC, timeControlLabel: '5 min' } });
    const result = validateFourJoinQueue({ timeControl: TC });
    expect(result.ok && 'variant' in result.value).toBe(false);
  });

  it('a variant that is sent is validated and echoed (ffa and giveaway)', () => {
    expect(validateFourJoinQueue({ timeControl: TC, variant: 'giveaway' })).toEqual({ ok: true, value: { timeControl: TC, variant: 'giveaway' } });
    expect(validateFourJoinQueue({ timeControl: TC, timeControlLabel: 'Blitz', variant: 'ffa' })).toEqual({ ok: true, value: { timeControl: TC, timeControlLabel: 'Blitz', variant: 'ffa' } });
  });

  it('an unknown or malformed variant is refused with an error ack, including an explicit null', () => {
    for (const variant of ['bughouse', '', null, 7, {}, []]) {
      expect(validateFourJoinQueue({ timeControl: TC, variant })).toEqual({ ok: false, error: 'Unknown game mode.' });
    }
  });

  it('the time-control and label errors still come first and are unchanged', () => {
    expect(validateFourJoinQueue({ timeControl: { initialSeconds: 5, incrementSeconds: 0 }, variant: 'giveaway' })).toMatchObject({ ok: false });
    expect(validateFourJoinQueue({ timeControl: TC, timeControlLabel: 'x'.repeat(41), variant: 'giveaway' })).toEqual({ ok: false, error: 'Invalid time control label.' });
    expect(validateFourJoinQueue(null)).toEqual({ ok: false, error: 'Invalid request.' });
  });

  it('the payload type allows the field to be absent (compile-time pin)', () => {
    const old: FourJoinQueuePayload = { timeControl: TC };
    const next: FourJoinQueuePayload = { timeControl: TC, variant: 'giveaway' };
    expect([old.variant, next.variant]).toEqual([undefined, 'giveaway']);
  });
});

describe('the variant on server payloads (read through fourVariantOf)', () => {
  it('a payload without a variant - an OLDER server\'s - reads as 4 Player Chess; one with a variant reads as sent', () => {
    expect(fourVariantOf({})).toBe('ffa');
    expect(fourVariantOf({ variant: 'ffa' })).toBe('ffa');
    expect(fourVariantOf({ variant: 'giveaway' })).toBe('giveaway');
  });

  it('match-found, room state and the active-game summary all accept the field; none requires it (so the Chess fixtures are unchanged)', () => {
    const match: Pick<FourMatchFoundPayload, 'variant'> = { variant: 'giveaway' };
    const room: Pick<FourRoomState, 'variant'> = {};
    const summary: Pick<FourActiveGameSummary, 'variant'> = { variant: 'ffa' };
    expect([fourVariantOf(match), fourVariantOf(room), fourVariantOf(summary)]).toEqual(['giveaway', 'ffa', 'ffa']);
    const variants: FourVariant[] = ['ffa', 'giveaway'];
    expect(variants).toHaveLength(2);
  });
});

describe('result reasons', () => {
  it('FOUR_REASONS is exactly the engine\'s reasons plus abandoned, in this set', () => {
    expect([...FOUR_REASONS].sort()).toEqual(['abandoned', 'cap', 'deadPosition', 'elimination', 'lastStanding', 'outOfPieces', 'stuck']);
  });

  it('every reason the Giveaway engine can produce is a wire reason, and the client accepts a game-over payload with it', () => {
    const engineReasons: FourPlayerResult['reason'][] = ['elimination', 'cap', 'deadPosition', 'outOfPieces', 'stuck', 'lastStanding'];
    for (const reason of engineReasons) {
      const wire: FourReason = reason; // compile-time: an engine reason is always a wire reason
      expect(FOUR_REASONS).toContain(wire);
      const payload: FourGameOverPayload = { roomId: 'r', reason: wire, winners: [0], scores: [3, 1, 4, 1], state: 'x' };
      expect(isGameOverPayload(payload), reason).toBe(true);
    }
    expect(isGameOverPayload({ roomId: 'r', reason: 'mate', winners: [0], scores: [0, 0, 0, 0], state: 'x' })).toBe(false); // an unknown reason is still refused
    expect(isGameOverPayload({ roomId: 'r', reason: 'abandoned', winners: [], scores: [0, 0, 0, 0], state: 'x' })).toBe(true);
  });

  it('describeResultReason is total over the reasons (no reason falls through to the Chess "Three players eliminated" text)', () => {
    expect(describeResultReason('outOfPieces')).toMatch(/last piece/);
    expect(describeResultReason('stuck')).toMatch(/no legal move/);
    expect(describeResultReason('lastStanding')).toMatch(/resigned or ran out of time/);
    expect(describeResultReason('elimination')).toMatch(/eliminated/);
  });

  it('a real Giveaway game\'s final snapshot and result survive the wire text and are accepted as a game-over payload', () => {
    const rng = mulberry32(99);
    let state = initialState({ ...GIVEAWAY_RULES, maxPlies: 300 });
    while (!state.result) {
      const moves = legalMoves(state, state.turn);
      state = playMove(state, moves[Math.floor(rng() * moves.length)], () => 0).state;
    }
    const payload: FourGameOverPayload = { roomId: 'r', reason: state.result.reason, winners: [...state.result.winners], scores: [...state.score], state: serialize(state) };
    expect(isGameOverPayload(payload)).toBe(true);
    expect(deserialize(payload.state, GIVEAWAY_RULES).result).toEqual(state.result);
  });
});

describe('the move payload is unchanged (promotion stays q/r/b/n; there is no king promotion on the wire either)', () => {
  it('a king promotion is refused at the boundary, before the engine ever sees it', () => {
    const base = { roomId: 'r', from: 'e7', to: 'e8' };
    for (const promotion of ['q', 'r', 'b', 'n']) expect(validateFourMovePayload({ ...base, promotion })).toMatchObject({ ok: true });
    for (const promotion of ['k', 'K', 'p', '', 'queen']) expect(validateFourMovePayload({ ...base, promotion })).toEqual({ ok: false, error: 'Invalid promotion piece.' });
  });
});
