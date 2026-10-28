import { describe, expect, it } from 'vitest';
import {
  BUGHOUSE_DUAL_GUTTER,
  BUGHOUSE_ROTATE_OVERLAY_DETAIL,
  BUGHOUSE_ROTATE_OVERLAY_TITLE,
  bughouseSetupGate,
  deriveBughouseLayout,
  dualBoardPlan,
  needsRotateOverlay,
  premovesAllowed,
} from '../bughouseLayout';
import { dualBoardOrientation } from '../bughouseView';
import { scene } from './bughouseScenes';
import type { SeatConfig, SeatController } from '../fourPlayer/setup';

/**
 * BUGHOUSE W3b - the pure additions to the layout logic: what each board is when humans play both (a table over all 16 human / bot patterns), the colour at the bottom of each board, the
 * premove switch, the rotate overlay and the setup gate at the exact boundaries of BUGHOUSE_SPEC.md 5.6. Every number and every word is a LITERAL.
 */
const H: SeatController = { kind: 'human' };
const B: SeatController = { kind: 'bot', elo: 1200 };
const cfg = (a: string): SeatConfig => [a[0] === 'H' ? H : B, a[1] === 'H' ? H : B, a[2] === 'H' ? H : B, a[3] === 'H' ? H : B];
const ALL = Array.from({ length: 16 }, (_, n) => [3, 2, 1, 0].map((bit) => ((n >> bit) & 1 ? 'H' : 'B')).join(''));

describe('what each board is, when humans play both boards', () => {
  // pattern -> [A's human colours, B's human colours]; seat order: A White, A Black, B White, B Black
  const TABLE: Record<string, [string, string]> = {
    HBHB: ['w', 'w'],
    HBBH: ['w', 'b'],
    HBHH: ['w', 'wb'],
    BHHB: ['b', 'w'],
    BHBH: ['b', 'b'],
    BHHH: ['b', 'wb'],
    HHHB: ['wb', 'w'],
    HHBH: ['wb', 'b'],
    HHHH: ['wb', 'wb'],
  };

  it('the nine dual setups, board by board: the colours a human plays and whether both are human (the board is then pass-and-play)', () => {
    for (const [pattern, [a, b]] of Object.entries(TABLE)) {
      expect(deriveBughouseLayout(cfg(pattern)).kind, pattern).toBe('dual');
      expect(dualBoardPlan(cfg(pattern), 'A'), `${pattern} A`).toEqual({ board: 'A', humanColors: a.split(''), shared: a.length === 2 });
      expect(dualBoardPlan(cfg(pattern), 'B'), `${pattern} B`).toEqual({ board: 'B', humanColors: b.split(''), shared: b.length === 2 });
    }
  });

  it('the plan of a board looks at that board\'s seats only: a seat of the other board never counts', () => {
    expect(dualBoardPlan(cfg('HHBB'), 'B')).toEqual({ board: 'B', humanColors: [], shared: false }); // not a dual setup, but the board's own answer is still its own
    expect(dualBoardPlan(cfg('HHBB'), 'A')).toEqual({ board: 'A', humanColors: ['w', 'b'], shared: true });
    expect(dualBoardPlan(cfg('BBHB'), 'A')).toEqual({ board: 'A', humanColors: [], shared: false });
    expect(dualBoardPlan(cfg('BBHB'), 'B')).toEqual({ board: 'B', humanColors: ['w'], shared: false });
    expect(dualBoardPlan(cfg('BBBH'), 'B')).toEqual({ board: 'B', humanColors: ['b'], shared: false });
  });
});

describe('the colour at the bottom of each board', () => {
  const start = scene({ startMs: 0 });
  it('a board with one human shows that human\'s colour at the bottom, whatever the other board shows, and whoever is to move', () => {
    const expected: Record<string, ['w' | 'b', 'w' | 'b']> = { HBHB: ['w', 'w'], HBBH: ['w', 'b'], BHHB: ['b', 'w'], BHBH: ['b', 'b'] };
    for (const [pattern, [a, b]] of Object.entries(expected)) {
      for (const autoFlip of [true, false]) {
        expect(dualBoardOrientation(cfg(pattern), 'A', start, autoFlip), `${pattern} A`).toBe(a);
        expect(dualBoardOrientation(cfg(pattern), 'B', start, autoFlip), `${pattern} B`).toBe(b);
      }
    }
  });

  it('a board with both colours human follows the side to move; with auto-turn off it keeps White at the bottom; the other board is not affected', () => {
    const blackToMoveOnA = scene({ startMs: 0, a: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1' });
    expect(dualBoardOrientation(cfg('HHHB'), 'A', start, true)).toBe('w');
    expect(dualBoardOrientation(cfg('HHHB'), 'A', blackToMoveOnA, true)).toBe('b');
    expect(dualBoardOrientation(cfg('HHHB'), 'A', blackToMoveOnA, false)).toBe('w');
    expect(dualBoardOrientation(cfg('HHHB'), 'B', blackToMoveOnA, true)).toBe('w'); // B's human is White, A's turn is none of its business
    expect(dualBoardOrientation(cfg('HHBH'), 'B', blackToMoveOnA, true)).toBe('b');
    const blackToMoveOnB = scene({ startMs: 0, b: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1' });
    expect(dualBoardOrientation(cfg('HBHH'), 'B', blackToMoveOnB, true)).toBe('b');
    expect(dualBoardOrientation(cfg('HBHH'), 'B', blackToMoveOnB, false)).toBe('w');
    expect(dualBoardOrientation(cfg('HBHH'), 'A', blackToMoveOnB, true)).toBe('w');
    expect(dualBoardOrientation(cfg('HHHH'), 'A', blackToMoveOnB, true)).toBe('w');
    expect(dualBoardOrientation(cfg('HHHH'), 'B', blackToMoveOnB, true)).toBe('b');
  });
});

describe('premoves are off whenever two or more humans share the device', () => {
  it('on with exactly one human, off with none or with two to four (all 16 patterns)', () => {
    for (const pattern of ALL) {
      const humans = pattern.split('').filter((c) => c === 'H').length;
      expect(premovesAllowed(cfg(pattern)), pattern).toBe(humans === 1);
    }
  });
});

describe('the rotate overlay and the setup gate share one rule: two boards of at least 28 px', () => {
  const WINDOWS: [number, number, boolean][] = [
    // [width, height, fits]; from the table of BUGHOUSE_SPEC.md 5.6 and its boundaries
    [360, 640, false],
    [375, 667, false],
    [360, 740, true],
    [360, 800, true],
    [390, 844, true],
    [412, 915, true],
    [800, 360, true],
    [568, 320, false],
    [768, 1024, true],
    [1024, 768, true],
    [240, 736, true],
    [239, 736, false],
    [240, 735, false],
    [472, 352, true],
    [471, 352, false],
    [472, 351, false],
    [0, 0, false],
  ];

  it('a dual setup is covered exactly when it does not fit; every other setup never is', () => {
    for (const [w, h, fits] of WINDOWS) {
      for (const pattern of ALL) {
        const dual = deriveBughouseLayout(cfg(pattern)).kind === 'dual';
        expect(needsRotateOverlay(cfg(pattern), w, h), `${pattern} ${w} x ${h}`).toBe(dual && !fits);
      }
    }
  });

  it('the gate starts a dual setup exactly when it fits, with the spec\'s sentence otherwise; setups with humans on one board or one human start anywhere', () => {
    for (const [w, h, fits] of WINDOWS) {
      expect(bughouseSetupGate(cfg('HBBH'), w, h), `${w} x ${h}`).toEqual(fits ? { startable: true } : { startable: false, reason: 'tooSmall', message: 'This seat setup needs a larger screen. Turn the device to landscape, or put every human on one board.' });
      expect(bughouseSetupGate(cfg('HHBB'), w, h)).toEqual({ startable: true });
      expect(bughouseSetupGate(cfg('HBBB'), w, h)).toEqual({ startable: true });
      expect(bughouseSetupGate(cfg('BBBB'), w, h)).toMatchObject({ startable: false, reason: 'noHuman' });
    }
  });

  it('the words of the overlay are the spec\'s, and the gutter between the boards is 12 px', () => {
    expect(BUGHOUSE_ROTATE_OVERLAY_TITLE).toBe('Rotate the device to keep playing');
    expect(BUGHOUSE_ROTATE_OVERLAY_DETAIL).toBe('The clocks keep running.');
    expect(BUGHOUSE_DUAL_GUTTER).toBe(12);
  });
});
