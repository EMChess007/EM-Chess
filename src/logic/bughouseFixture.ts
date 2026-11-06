import { emptyReserve, type Reserve } from './crazyhouse';
import { createMatch, fenOf, judgeBoardState, openBoard, seatAt, seatPlace, type BoardId, type BoardState, type BughouseMatch, type BughouseSeat, type BughouseTimeControl, type SeatClock } from './bughouse';

/**
 * Fixed Bughouse positions for the browser device matrix (command #27b): a test-only switch, CHECKLIST section 7.
 *
 * The matrix has to look at the worst a Bughouse screen can show - every pocket full of every kind of piece with high counts, a promoted piece on each board, all twelve piece kinds on both
 * square colours - and a game played by hand does not get there. `window.__EM_BUGHOUSE_FIXTURE__` names one of the fixtures below and the game screen starts from it instead of from the
 * standard position (BughouseGameScreen `startFrom`).
 *
 * The rules of a test-only switch (CHECKLIST 7): read in ONE place (`readBughouseFixture`, tested in bughouseFixture.test.ts); an opt-in name that says what it does; honoured only on the web
 * and only in a development build; ignored in a release build and on a phone with ONE warning that does not print the value; only a name from the closed set is accepted (anything else is
 * ignored the same way); set only by the matrix's own page (scripts/browser/android-matrix.mjs).
 */
export const BUGHOUSE_FIXTURE_GLOBAL = '__EM_BUGHOUSE_FIXTURE__';

export const BUGHOUSE_FIXTURE_NAMES = ['fullPockets', 'allPieces'] as const;
export type BughouseFixtureName = (typeof BUGHOUSE_FIXTURE_NAMES)[number];

/** The fixture the page asked for, or null. `warn` is called once when a value was given but is not honoured (its text never contains the value). */
export function readBughouseFixture(dev: boolean, platform: string, raw: unknown, warn: (message: string) => void = console.warn): BughouseFixtureName | null {
  if (raw === undefined || raw === null) return null;
  if (!dev || platform !== 'web') {
    warn('[bughouse] a test-only fixture switch was set and is ignored (it works only on the web in a development build)');
    return null;
  }
  if (typeof raw === 'string' && (BUGHOUSE_FIXTURE_NAMES as readonly string[]).includes(raw)) return raw as BughouseFixtureName;
  warn('[bughouse] a test-only fixture switch was set to something that is not a fixture and is ignored');
  return null;
}

interface FixtureSpec {
  a: string;
  b: string;
  promotedA: readonly string[];
  promotedB: readonly string[];
  pockets: Readonly<Record<BughouseSeat, Partial<Reserve>>>;
}

const FIXTURES: Record<BughouseFixtureName, FixtureSpec> = {
  // Both boards in a middlegame with a promoted piece each (a white queen on b7, a black rook on f8), White to move on A and Black on B; all four pockets hold all five kinds of piece, with high
  // counts and every digit count the chips can show (1, 2-9, 10-16).
  fullPockets: {
    a: 'r3k2r/pQp2ppp/2n5/8/8/5N2/PP1PPPPP/R3K2R w KQkq - 0 1',
    b: 'r1bq1rk1/ppp2ppp/2n2n2/3pp3/1b1PP3/2N2N2/PPP2PPP/R1BQKB1R b KQ - 0 1',
    promotedA: ['b7'],
    promotedB: ['f8'],
    pockets: {
      0: { p: 16, n: 16, b: 16, r: 16, q: 16 },
      1: { p: 16, n: 9, b: 12, r: 10, q: 1 },
      2: { p: 14, n: 16, b: 1, r: 13, q: 16 },
      3: { p: 8, n: 15, b: 16, r: 1, q: 12 },
    },
  },
  // All twelve piece kinds, each on a light and on a dark square (the piece colour check of the matrix reads them from the screen), pockets as in the standard start.
  allPieces: {
    a: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    b: '3k4/8/2q5/4Q3/8/8/8/3K4 w - - 0 1',
    promotedA: [],
    promotedB: [],
    pockets: { 0: {}, 1: {}, 2: {}, 3: {} },
  },
};

/** The match of a fixture, on the screen's own time base (it starts at 0 ms: the side to move on each board has a running clock). */
export function fixtureMatch(name: BughouseFixtureName, timeControl: BughouseTimeControl): BughouseMatch {
  const spec = FIXTURES[name];
  const base = createMatch({ timeControl, roomNumber: 0, startMs: 0 });
  const fens: Record<BoardId, string> = { A: spec.a, B: spec.b };
  const boards = {} as Record<BoardId, BoardState>;
  for (const board of ['A', 'B'] as const) {
    const chess = openBoard(fens[board]);
    if (chess === null) throw new Error(`bughouse fixture ${name}: board ${board} is not a valid FEN`);
    boards[board] = { fen: fenOf(chess), promoted: [...(board === 'A' ? spec.promotedA : spec.promotedB)].sort(), plies: 0 };
  }
  const pockets: Reserve[] = ([0, 1, 2, 3] as BughouseSeat[]).map((seat) => ({ ...emptyReserve(), ...spec.pockets[seat] }));
  const verdicts = {
    A: judgeBoardState('A', boards.A, pockets[seatAt('A', 'w')], pockets[seatAt('A', 'b')]),
    B: judgeBoardState('B', boards.B, pockets[seatAt('B', 'w')], pockets[seatAt('B', 'b')]),
  };
  const clocks: SeatClock[] = ([0, 1, 2, 3] as BughouseSeat[]).map((seat) => {
    const place = seatPlace(seat);
    return { remainingMs: timeControl.initialMs, runningSince: verdicts[place.board].turn === place.color ? 0 : null, startSeq: 0 };
  });
  return { ...base, seq: 0, boards, pockets, clocks, verdicts };
}
