import { describe, expect, it } from 'vitest';
import { createMatch, fenOf, judgeBoardState, openBoard, seatAt, settle, type BughouseMatch } from '../bughouse';
import { emptyReserve } from '../crazyhouse';
import { fixtureMatch } from '../bughouseFixture';
import { isWaiting, liveHalf, PREMOVE_NOTICE, premoveMarks, premovePick, premovesAllowed, premoveTap, stepPremove, type PremoveHalf } from '../bughousePremoveInput';

/**
 * BUGHOUSE W5 - PREMOVES ON THE CLIENT (BUGHOUSE_SPEC.md HP3, 5.5). The input (which taps queue what), the single slot, the resolution at the snapshot that gives me the turn and the one
 * visible reason per cancellation, on the real engine. "Never sent early" is a property of `stepPremove`: it returns `wait` until the turn is mine. Literals on purpose.
 */
const TC = { initialMs: 60000, incrementMs: 0 };
const start = () => createMatch({ timeControl: TC, roomNumber: 2, startMs: 0 });
/** Seat 1 is Black on Board A: it waits while White (seat 0) is to move. */
const BLACK_A = 1;

function play(match: BughouseMatch, seat: 0 | 1 | 2 | 3, from: string, to: string, now: number): BughouseMatch {
  const out = settle(match, { seat, action: { kind: 'move', board: seat < 2 ? 'A' : 'B', from, to } }, now);
  if (out.kind !== 'applied') throw new Error(`not applied: ${out.kind}`);
  return out.match;
}

/** A match whose Board A is `fen` (White to move) with the given pockets for the seats (the drops' tests). */
function withBoardA(fen: string, pockets: Partial<Record<0 | 1 | 2 | 3, Partial<ReturnType<typeof emptyReserve>>>>): BughouseMatch {
  const base = start();
  const chess = openBoard(fen)!;
  const boards = { ...base.boards, A: { fen: fenOf(chess), promoted: [], plies: 0 } };
  const reserves = ([0, 1, 2, 3] as const).map((seat) => ({ ...emptyReserve(), ...(pockets[seat] ?? {}) }));
  const verdicts = { ...base.verdicts, A: judgeBoardState('A', boards.A, reserves[seatAt('A', 'w')], reserves[seatAt('A', 'b')]) };
  return { ...base, boards, pockets: reserves, verdicts };
}

describe('when a premove may exist', () => {
  it('exactly one human at the device, never after the end', () => {
    const m = start();
    expect(premovesAllowed(1, m)).toBe(true);
    expect(premovesAllowed(0, m)).toBe(false);
    expect(premovesAllowed(2, m)).toBe(false); // pass and play / two boards played at once (B23)
    expect(premovesAllowed(4, m)).toBe(false);
    expect(premovesAllowed(1, { ...m, result: { winnerTeam: 1, reason: 'resign', board: 'A' } as never })).toBe(false);
  });

  it('only while the opponent is to move on my board', () => {
    const m = start();
    expect(isWaiting(m, 0)).toBe(false); // White on A moves first
    expect(isWaiting(m, BLACK_A)).toBe(true);
    expect(isWaiting(play(m, 0, 'e2', 'e4', 1000), BLACK_A)).toBe(false);
  });
});

describe('the taps', () => {
  it('a piece of mine, then a square, queues a move; a piece of the opponent or an empty square picks nothing', () => {
    const m = start();
    expect(premoveTap(m, BLACK_A, null, 'e2')).toEqual({ half: null, queued: null }); // White's pawn
    expect(premoveTap(m, BLACK_A, null, 'e4')).toEqual({ half: null, queued: null }); // empty
    const first = premoveTap(m, BLACK_A, null, 'e7');
    expect(first).toEqual({ half: { kind: 'select', board: 'A', square: 'e7', fen: m.boards.A.fen }, queued: null });
    expect(premoveTap(m, BLACK_A, first.half, 'e5')).toEqual({ half: null, queued: { kind: 'move', from: 'e7', to: 'e5' } });
  });

  it('the same square again puts it down; another piece of mine re-selects', () => {
    const m = start();
    const half = premoveTap(m, BLACK_A, null, 'e7').half as PremoveHalf;
    expect(premoveTap(m, BLACK_A, half, 'e7')).toEqual({ half: null, queued: null });
    expect(premoveTap(m, BLACK_A, half, 'd7').half).toMatchObject({ kind: 'select', square: 'd7' });
  });

  it('a pawn to its last rank queues a queen promotion (a promotion premove)', () => {
    const m = withBoardA('4k3/8/8/8/8/8/p7/4K3 w - - 0 1', {});
    const half = premoveTap(m, BLACK_A, null, 'a2').half as PremoveHalf;
    expect(premoveTap(m, BLACK_A, half, 'a1')).toEqual({ half: null, queued: { kind: 'move', from: 'a2', to: 'a1', promotion: 'q' } });
  });

  it('a chip, then an EMPTY square, queues a drop; an occupied square or a chip I do not have queues nothing', () => {
    const m = withBoardA('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', { 1: { n: 2 } });
    expect(premovePick(m, BLACK_A, null, 'q')).toBeNull(); // not in my pocket
    const picked = premovePick(m, BLACK_A, null, 'n') as PremoveHalf;
    expect(picked).toEqual({ kind: 'pick', board: 'A', piece: 'n', fen: m.boards.A.fen });
    expect(premovePick(m, BLACK_A, picked, 'n')).toBeNull(); // the same chip again puts it down
    expect(premoveTap(m, BLACK_A, picked, 'a8')).toEqual({ half: null, queued: null }); // occupied
    expect(premoveTap(m, BLACK_A, picked, 'd5')).toEqual({ half: null, queued: { kind: 'drop', piece: 'n', square: 'd5' } });
  });

  it('a pawn is never dropped on the 1st or 8th rank: the pick stays, nothing is queued', () => {
    const m = withBoardA('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', { 1: { p: 1 } });
    const picked = premovePick(m, BLACK_A, null, 'p') as PremoveHalf;
    expect(premoveTap(m, BLACK_A, picked, 'd8')).toEqual({ half: picked, queued: null });
    expect(premoveTap(m, BLACK_A, picked, 'd1')).toEqual({ half: picked, queued: null });
    expect(premoveTap(m, BLACK_A, picked, 'd4').queued).toEqual({ kind: 'drop', piece: 'p', square: 'd4' });
  });

  it('a half-made premove is dropped when ITS board changes, and kept when only the other board does', () => {
    const m = start();
    const half = premoveTap(m, BLACK_A, null, 'e7').half;
    expect(liveHalf(half, m)).toEqual(half);
    expect(liveHalf(half, play(m, 2, 'e2', 'e4', 1000))).toEqual(half); // Board B moved: A is as it was
    expect(liveHalf(half, play(m, 0, 'e2', 'e4', 1000))).toBeNull(); // Board A moved
    expect(liveHalf(null, m)).toBeNull();
  });
});

describe('the resolution (never early, one reason each)', () => {
  it('waits for as long as the turn is not mine, then sends the ordinary action - exactly on the snapshot that gives me the turn', () => {
    const m = start();
    const premove = { kind: 'move', from: 'e7', to: 'e5' } as const;
    expect(stepPremove(m, BLACK_A, premove)).toEqual({ kind: 'wait' });
    // a move on the OTHER board does not give me the turn
    expect(stepPremove(play(m, 2, 'e2', 'e4', 900), BLACK_A, premove)).toEqual({ kind: 'wait' });
    const mine = play(m, 0, 'e2', 'e4', 1000);
    expect(stepPremove(mine, BLACK_A, premove)).toEqual({ kind: 'play', action: { kind: 'move', board: 'A', from: 'e7', to: 'e5' } });
    expect(stepPremove(m, BLACK_A, null)).toEqual({ kind: 'wait' });
  });

  it('a move that the opponent made illegal is dropped with its reason', () => {
    const m = play(start(), 0, 'e2', 'e4', 1000);
    const step = stepPremove(m, BLACK_A, { kind: 'move', from: 'e7', to: 'e4' }); // not a pawn move
    expect(step).toEqual({ kind: 'drop', notice: 'The premove is no longer legal.' });
  });

  it('a drop square the opponent took, a piece no longer in the pocket, a check the drop does not answer: one sentence each', () => {
    const taken = withBoardA('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', { 0: { n: 1 } });
    expect(stepPremove(taken, 0, { kind: 'drop', piece: 'n', square: 'a8' })).toEqual({ kind: 'drop', notice: 'The square is occupied.' });
    expect(stepPremove(taken, 0, { kind: 'drop', piece: 'q', square: 'd4' })).toEqual({ kind: 'drop', notice: 'The piece is no longer in your pocket.' });
    const check = withBoardA('4r1k1/8/8/8/8/8/8/4K3 w - - 0 1', { 0: { n: 1 } });
    expect(stepPremove(check, 0, { kind: 'drop', piece: 'n', square: 'a3' })).toEqual({ kind: 'drop', notice: 'Your king is in check: this drop does not answer it.' });
    expect(stepPremove(check, 0, { kind: 'drop', piece: 'n', square: 'e3' })).toMatchObject({ kind: 'play' }); // a block is still fine
    expect(PREMOVE_NOTICE).toEqual({
      noLongerLegal: 'The premove is no longer legal.',
      squareOccupied: 'The square is occupied.',
      notInPocket: 'The piece is no longer in your pocket.',
      checkNotAnswered: 'Your king is in check: this drop does not answer it.',
    });
  });

  it('the end of the game drops it silently', () => {
    const over = { ...start(), result: { winnerTeam: 1, reason: 'resign', board: 'A' } as never };
    expect(stepPremove(over, BLACK_A, { kind: 'move', from: 'e7', to: 'e5' })).toEqual({ kind: 'drop', notice: null });
  });
});

describe('the marks', () => {
  it('a move marks both squares with the moving piece as the ghost; a promotion shows the new piece; a drop marks its square with the dropped piece', () => {
    const m = start();
    expect(premoveMarks(m, BLACK_A, null)).toBeNull();
    expect(premoveMarks(m, BLACK_A, { kind: 'move', from: 'g8', to: 'f6' })).toEqual({ from: 'g8', to: 'f6', ghost: { color: 'b', type: 'n' } });
    expect(premoveMarks(m, BLACK_A, { kind: 'move', from: 'a2', to: 'a1', promotion: 'q' })?.ghost).toEqual({ color: 'b', type: 'q' });
    expect(premoveMarks(fixtureMatch('fullPockets', TC), BLACK_A, { kind: 'drop', piece: 'r', square: 'd5' })).toEqual({ from: null, to: 'd5', ghost: { color: 'b', type: 'r' } });
  });
});
