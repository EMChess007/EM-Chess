import { describe, expect, it } from 'vitest';
import { CHATURAJI_RULES, CROSS14, SQUARE8, deserialize, initialState, legalMoves, playMove, serialize } from '../fourPlayer';
import { checkMatchVariant, joinQueueRequest } from '../fourPlayerOnlineUi';
import { viewFromMatch } from '../fourPlayerOnline';
import { fourVariantOf, isCanonicalSquareName, validateFourJoinQueue, validateFourMovePayload, validateFourVariant, type FourMatchFoundPayload, type FourSeats } from '../fourPlayerWire';
import { variantOfState, variantTitle } from '../fourPlayerVariant';

/**
 * Chaturaji on the wire (CHATURAJI_SPEC.md section 6): the existing protocol carries it unchanged - only `variant: 'chaturaji'` is new, the snapshot text is the
 * same format with 8 rows - and the rollout safety of 4 Player Giveaway (decision D15: a client that asks for a variant must see it echoed, an old server that
 * ignores the field would start 4 Player Chess instead) covers it too. fourPlayerWire.test.ts and fourPlayerGiveawayWire.test.ts are untouched.
 */
const TC = { initialSeconds: 300, incrementSeconds: 0 };

describe('the variant value', () => {
  it('validateFourVariant accepts chaturaji as given, an omitted variant is still 4 Player Chess, and near-misses are refused', () => {
    expect(validateFourVariant('chaturaji')).toEqual({ ok: true, value: 'chaturaji' });
    expect(validateFourVariant(undefined)).toEqual({ ok: true, value: 'ffa' });
    for (const bad of ['Chaturaji', 'CHATURAJI', 'chaturaji ', ' chaturaji', 'chaturanga', 'chaturaji8', ['chaturaji'], { variant: 'chaturaji' }, null]) {
      expect(validateFourVariant(bad), JSON.stringify(bad)).toEqual({ ok: false, error: 'Unknown game mode.' });
    }
  });

  it('four_join_queue validates and echoes it; a payload without a variant is unchanged', () => {
    expect(validateFourJoinQueue({ timeControl: TC, variant: 'chaturaji' })).toEqual({ ok: true, value: { timeControl: TC, variant: 'chaturaji' } });
    expect(validateFourJoinQueue({ timeControl: TC })).toEqual({ ok: true, value: { timeControl: TC } });
    expect(validateFourJoinQueue({ timeControl: TC, variant: 'chaturanga' })).toEqual({ ok: false, error: 'Unknown game mode.' });
  });

  it('fourVariantOf: what a payload says, or 4 Player Chess when it says nothing', () => {
    expect(fourVariantOf({ variant: 'chaturaji' })).toBe('chaturaji');
    expect(fourVariantOf({})).toBe('ffa');
  });
});

describe('move payloads are checked against the board of the room they name', () => {
  const room = 'room-0001';
  it('canonical square names: the default is still the cross board (a1 is a cut corner), the 8 x 8 board has a1 and ends at h8', () => {
    expect(isCanonicalSquareName('a1')).toBe(false);
    expect(isCanonicalSquareName('a1', SQUARE8)).toBe(true);
    expect(isCanonicalSquareName('h8', SQUARE8)).toBe(true);
    for (const bad of ['i1', 'a9', 'n14', 'a01', 'A1', 'e2 ', '', 5, null]) expect(isCanonicalSquareName(bad, SQUARE8), String(bad)).toBe(false);
    expect(isCanonicalSquareName('e2')).toBe(true); // unchanged for the cross board
  });

  it('validateFourMovePayload takes the board from a resolver of the room id; without one it is exactly what it was', () => {
    const onSquare8 = () => SQUARE8;
    expect(validateFourMovePayload({ roomId: room, from: 'a2', to: 'a3' }, onSquare8)).toMatchObject({ ok: true });
    expect(validateFourMovePayload({ roomId: room, from: 'a2', to: 'a3' })).toEqual({ ok: false, error: 'Invalid move.' }); // a2 is a cut corner on the cross board
    expect(validateFourMovePayload({ roomId: room, from: 'a2', to: 'a9' }, onSquare8)).toEqual({ ok: false, error: 'Invalid move.' });
    expect(validateFourMovePayload({ roomId: room, from: 'e2', to: 'e4' })).toMatchObject({ ok: true });
    expect(validateFourMovePayload({ roomId: room, from: 'c7', to: 'c8', promotion: 'r' }, onSquare8)).toMatchObject({ ok: true, value: { promotion: 'r' } });
    expect(validateFourMovePayload({ roomId: room, from: 'c7', to: 'c8', promotion: 'k' }, onSquare8)).toEqual({ ok: false, error: 'Invalid promotion piece.' });
    const asked: string[] = [];
    validateFourMovePayload({ roomId: room, from: 'e2', to: 'e4' }, (id) => (asked.push(id), CROSS14));
    expect(asked).toEqual([room]); // the resolver gets the room id from the payload
  });
});

describe('rollout safety (D15): the client plays on only when the server echoes the variant it asked for', () => {
  it('the client sends `variant` for Chaturaji and Giveaway but never for 4 Player Chess (that payload stays what every released client sends)', () => {
    expect(joinQueueRequest({ ...TC, label: '5 min' }, 'chaturaji')).toEqual({ timeControl: TC, timeControlLabel: '5 min', variant: 'chaturaji' });
    expect(joinQueueRequest({ ...TC, label: '5 min' }, 'giveaway')).toMatchObject({ variant: 'giveaway' });
    expect('variant' in joinQueueRequest({ ...TC, label: '5 min' }, 'ffa')).toBe(false);
  });

  it('an OLD server (no variant in four_match_found) or one that started a different game is refused with a message that names Chaturaji', () => {
    expect(checkMatchVariant('chaturaji', {})).toEqual({
      ok: false,
      error: 'This server does not support Chaturaji yet, so it started a different game. You have left it. Please try again later.',
    });
    for (const echoed of ['ffa', 'giveaway'] as const) expect(checkMatchVariant('chaturaji', { variant: echoed }).ok).toBe(false);
    expect(checkMatchVariant('chaturaji', { variant: 'bughouse' as never }).ok).toBe(false);
    expect(checkMatchVariant('chaturaji', { variant: 'chaturaji' })).toEqual({ ok: true });
  });

  it('and the other way round: a server that echoes Chaturaji to a client that asked for another game is refused too; 4 Player Chess and Giveaway are unchanged', () => {
    expect(checkMatchVariant('ffa', { variant: 'chaturaji' }).ok).toBe(false);
    expect(checkMatchVariant('giveaway', { variant: 'chaturaji' }).ok).toBe(false);
    expect(checkMatchVariant('ffa', {})).toEqual({ ok: true });
    expect(checkMatchVariant('giveaway', { variant: 'giveaway' })).toEqual({ ok: true });
    expect(checkMatchVariant('giveaway', {}).ok).toBe(false);
  });
});

describe('an 8 x 8 snapshot travels in the existing fields and a client can read it', () => {
  const seats: FourSeats = [0, 1, 2, 3].map((seat) => ({ seat, kind: 'human', name: `P${seat}`, connected: true })) as FourSeats;
  const match = (state: string, variant?: 'chaturaji' | 'ffa'): FourMatchFoundPayload => ({
    roomId: 'room-0001',
    ...(variant ? { variant } : {}),
    seat: 0,
    playerToken: 'secret',
    seats,
    timeControl: TC,
    timeControlLabel: '5 min',
    state,
    clocksMs: [300_000, 300_000, 300_000, 300_000],
    seq: 0,
  });

  it('four_match_found for a Chaturaji room becomes a view on the 8 x 8 position, with the variant, and the rules travel with the position', () => {
    const start = initialState(CHATURAJI_RULES);
    const view = viewFromMatch(match(serialize(start), 'chaturaji'), 1000);
    expect(view).not.toBeNull();
    expect(view!.variant).toBe('chaturaji');
    expect(view!.state.cells).toHaveLength(64);
    expect(serialize(view!.state)).toBe(serialize(start));
    expect(variantOfState(view!.state)).toBe('chaturaji');
    expect(variantTitle('chaturaji')).toBe('Chaturaji');
  });

  it('the same 8-row text read as 4 Player Chess is refused (a room never changes game), and a Chess snapshot read as Chaturaji is refused too', () => {
    const text = serialize(initialState(CHATURAJI_RULES));
    expect(viewFromMatch(match(text, 'ffa'), 1000)).toBeNull(); // 8 rows where the cross board has 14
    const chess = serialize(initialState());
    expect(viewFromMatch(match(chess, 'chaturaji'), 1000)).toBeNull();
  });

  it('a whole game of snapshots round-trips: every position the engine produces is read back identically', () => {
    let state = initialState(CHATURAJI_RULES);
    for (let i = 0; i < 40 && !state.result; i++) {
      const moves = legalMoves(state, state.turn);
      state = playMove(state, moves[(i * 7) % moves.length], () => 0).state;
      expect(deserialize(serialize(state), CHATURAJI_RULES)).toEqual(state);
    }
  });
});
