import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openBoard, pocketOfSeat, serializeMatch, deserializeMatch } from '../bughouse';
import { BUGHOUSE_FIXTURE_GLOBAL, BUGHOUSE_FIXTURE_NAMES, fixtureMatch, readBughouseFixture } from '../bughouseFixture';

/**
 * The device matrix's test-only fixtures (command #27b), CHECKLIST section 7: the switch is read in one place, honoured only on the web in a development build, ignored with ONE warning that
 * does not print the value anywhere else, and accepts only a name from the closed set. Then the fixtures themselves: the worst pockets a phone can be shown, and a board with all twelve
 * kinds of piece on both square colours. Names, counts and positions are literals.
 */
const TC = { initialMs: 180000, incrementMs: 0 };

describe('the switch', () => {
  it('the global is called __EM_BUGHOUSE_FIXTURE__ and the closed set is fullPockets and allPieces', () => {
    expect(BUGHOUSE_FIXTURE_GLOBAL).toBe('__EM_BUGHOUSE_FIXTURE__');
    expect([...BUGHOUSE_FIXTURE_NAMES]).toEqual(['fullPockets', 'allPieces']);
  });

  it('unset: no fixture and nothing said', () => {
    const warn = vi.fn();
    expect(readBughouseFixture(true, 'web', undefined, warn)).toBeNull();
    expect(readBughouseFixture(true, 'web', null, warn)).toBeNull();
    expect(readBughouseFixture(false, 'android', undefined, warn)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('a development build on the web honours a name from the set', () => {
    const warn = vi.fn();
    expect(readBughouseFixture(true, 'web', 'fullPockets', warn)).toBe('fullPockets');
    expect(readBughouseFixture(true, 'web', 'allPieces', warn)).toBe('allPieces');
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['a release build on the web', false, 'web'],
    ['a development build on a phone', true, 'android'],
    ['a release build on a phone', false, 'android'],
    ['a development build on iOS', true, 'ios'],
  ])('%s ignores it with one warning that does not print the value', (_name, dev, platform) => {
    const warn = vi.fn();
    expect(readBughouseFixture(dev, platform, 'fullPockets', warn)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain('fullPockets');
  });

  it.each([['somethingElse'], [''], [42], [{}], [true], ['fullpockets'], ['FullPockets']])('a value that is not a fixture (%j) is ignored with one warning that does not print it', (value) => {
    const warn = vi.fn();
    expect(readBughouseFixture(true, 'web', value, warn)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain(String(value) || '\u0000');
  });

  it('only the game screen and the fixture module name the switch in the app (the matrix and the tests set it)', () => {
    const root = path.resolve(__dirname, '../..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry !== '__tests__' && entry !== 'generated') walk(full);
        } else if (/\.(ts|tsx)$/.test(entry) && readFileSync(full, 'utf8').includes('__EM_BUGHOUSE_FIXTURE__')) {
          hits.push(path.relative(root, full).replace(/\\/g, '/'));
        }
      }
    };
    walk(root);
    expect(hits.sort()).toEqual(['logic/bughouseFixture.ts']);
  });
});

describe('fullPockets', () => {
  const match = fixtureMatch('fullPockets', TC);
  const COUNTS = [
    { p: 16, n: 16, b: 16, r: 16, q: 16 },
    { p: 16, n: 9, b: 12, r: 10, q: 1 },
    { p: 14, n: 16, b: 1, r: 13, q: 16 },
    { p: 8, n: 15, b: 16, r: 1, q: 12 },
  ] as const;

  it('every one of the four pockets holds all five kinds, with these counts', () => {
    for (const seat of [0, 1, 2, 3] as const) expect(pocketOfSeat(match, seat), `seat ${seat}`).toEqual(COUNTS[seat]);
  });

  it('a promoted piece on each board: a white queen on b7 of A, a black rook on f8 of B', () => {
    expect([...match.boards.A.promoted]).toEqual(['b7']);
    expect([...match.boards.B.promoted]).toEqual(['f8']);
    expect(openBoard(match.boards.A.fen)?.get('b7' as never)).toMatchObject({ type: 'q', color: 'w' });
    expect(openBoard(match.boards.B.fen)?.get('f8' as never)).toMatchObject({ type: 'r', color: 'b' });
  });

  it('White is to move on A and Black on B, and exactly those two clocks run, from 0 ms', () => {
    expect(match.verdicts.A.turn).toBe('w');
    expect(match.verdicts.B.turn).toBe('b');
    expect(match.clocks.map((clock) => clock.runningSince)).toEqual([0, null, null, 0]);
    expect(match.clocks.every((clock) => clock.remainingMs === 180000)).toBe(true);
    expect(match.result).toBeNull();
    expect(match.nowMs).toBe(0);
  });

  it('is a hand-built position like the test scenes: it does not hold 64 pieces, so the snapshot loader (which checks that conservation) refuses it - the screen never loads it', () => {
    expect(deserializeMatch(serializeMatch(match)).ok).toBe(false);
  });
});

describe('allPieces', () => {
  const match = fixtureMatch('allPieces', TC);

  /** [colour][type] -> the parities ((file + rank) mod 2) of the squares that kind stands on, over both boards. */
  const parities = new Map<string, Set<number>>();
  for (const board of ['A', 'B'] as const) {
    const grid = openBoard(match.boards[board].fen)?.board() ?? [];
    grid.forEach((row, r) =>
      row.forEach((piece, f) => {
        if (!piece) return;
        const key = piece.color + piece.type;
        if (!parities.has(key)) parities.set(key, new Set());
        parities.get(key)?.add((f + (8 - r)) % 2);
      }),
    );
  }

  it('all twelve kinds are on the boards', () => {
    expect([...parities.keys()].sort()).toEqual(['bb', 'bk', 'bn', 'bp', 'bq', 'br', 'wb', 'wk', 'wn', 'wp', 'wq', 'wr']);
  });

  it('every kind stands on a light AND on a dark square', () => {
    for (const [kind, set] of parities) expect(set.size, kind).toBe(2);
  });

  it('the pockets are empty', () => {
    for (const seat of [0, 1, 2, 3] as const) expect(Object.values(pocketOfSeat(match, seat)).reduce((a, b) => a + b, 0)).toBe(0);
  });
});
