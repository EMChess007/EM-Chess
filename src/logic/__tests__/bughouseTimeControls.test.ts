import { describe, expect, it } from 'vitest';
import {
  BUGHOUSE_TIME_CONTROLS,
  bughouseControlLabel,
  createMatch,
  deserializeMatch,
  isUnlimitedBughouse,
  runningClocks,
  serializeMatch,
  settle,
} from '../bughouse';
import { SPEC_SIX } from './bughouseGoldenKit';

/**
 * CRAZY BUGHOUSE TAKES EVERY CONTROL (command #35). The engine's list grew from the spec's six to the app's 21 (equality with the app's list in timeControlsEverywhere.test.ts); this file pins the
 * engine's side of the two new kinds, with literals: "No time limit" (`initialMs: 0`: no clock runs, nothing can flag, no increment) and Daily (a clock of days).
 */
const DAY = 86_400_000;

describe('the list', () => {
  it('starts with the six of the spec (the golden transcripts and the reference model index them) and then the rest, 21 in all', () => {
    expect(BUGHOUSE_TIME_CONTROLS.slice(0, 6)).toEqual(SPEC_SIX);
    expect(BUGHOUSE_TIME_CONTROLS).toHaveLength(21);
    expect(BUGHOUSE_TIME_CONTROLS.map(bughouseControlLabel)).toEqual([
      '1 min', '2 | 1', '3 min', '3 | 2', '5 min', '5 | 2', 'No time limit', '1 | 1', '5 | 5', '10 min', '15 | 10', '30 min', '10 | 5', '20 min', '60 min', '1 day', '2 days', '3 days', '5 days', '7 days', '14 days',
    ]);
  });

  it('the longest control fits what a timer can wait (2^31 - 1 ms): 14 days = 1 209 600 000 ms', () => {
    const longest = Math.max(...BUGHOUSE_TIME_CONTROLS.map((tc) => tc.initialMs));
    expect(longest).toBe(1_209_600_000);
    expect(longest).toBeLessThan(2_147_483_647);
  });
});

describe('"No time limit"', () => {
  const unlimited = { initialMs: 0, incrementMs: 0 };
  const e4 = { seat: 0 as const, action: { kind: 'move' as const, board: 'A' as const, from: 'e2', to: 'e4' } };

  it('is recognised, and no clock of the match is running, at the start and after a move', () => {
    const m = createMatch({ timeControl: unlimited, roomNumber: 0, startMs: 0 });
    expect(isUnlimitedBughouse(unlimited)).toBe(true);
    expect(isUnlimitedBughouse({ initialMs: 1, incrementMs: 0 })).toBe(false);
    expect(runningClocks(m)).toEqual([]);
    const moved = settle(m, e4, 5 * DAY);
    expect(moved.kind).toBe('applied');
    if (moved.kind === 'applied') {
      expect(runningClocks(moved.match)).toEqual([]);
      expect(moved.match.clocks.map((c) => c.remainingMs)).toEqual([0, 0, 0, 0]);
    }
  });

  it('never flags: a timer firing 400 days later settles nothing, and a late move is still accepted', () => {
    const m = createMatch({ timeControl: unlimited, roomNumber: 0, startMs: 0 });
    const late = settle(m, null, 400 * DAY);
    expect(late.kind).toBe('idle');
    expect(settle(m, e4, 400 * DAY).kind).toBe('applied');
  });

  it('has no increment: a match for 0 with an increment is refused, and so is its snapshot', () => {
    expect(() => createMatch({ timeControl: { initialMs: 0, incrementMs: 1000 }, roomNumber: 0, startMs: 0 })).toThrow(RangeError);
    const text = serializeMatch(createMatch({ timeControl: unlimited, roomNumber: 0, startMs: 0 }));
    expect(deserializeMatch(text).ok).toBe(true);
    const tampered = JSON.stringify({ ...JSON.parse(text), timeControl: { initialMs: 0, incrementMs: 1000 } });
    expect(deserializeMatch(tampered).ok).toBe(false);
  });

  it('a match still ends by resignation and by mate (nothing but the clock was removed)', () => {
    const m = createMatch({ timeControl: unlimited, roomNumber: 0, startMs: 0 });
    const resigned = settle(m, { seat: 1, action: { kind: 'resign' } }, 10 * DAY);
    expect(resigned.kind).toBe('applied');
    if (resigned.kind === 'applied') expect(resigned.match.result).toMatchObject({ reason: 'resign', loserSeat: 1 });
  });
});

describe('Daily', () => {
  it.each([1, 2, 3, 5, 7, 14])('%s day(s): the white clock of board A falls due at exactly that many days, not a millisecond before', (days) => {
    const m = createMatch({ timeControl: { initialMs: days * DAY, incrementMs: 0 }, roomNumber: 0, startMs: 1000 });
    expect(runningClocks(m).map((c) => c.deadline)).toEqual([1000 + days * DAY, 1000 + days * DAY]);
    expect(settle(m, null, days * DAY + 999).kind).toBe('idle');
    expect(settle(m, null, days * DAY + 1000).kind).toBe('flag');
  });
});
