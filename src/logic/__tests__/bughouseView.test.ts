import { describe, expect, it } from 'vitest';
import { applyAction, settle, type BughouseMatch } from '../bughouse';
import type { BoardId, BughouseSeat } from '../bughouse/types';
import { deriveBughouseLayout } from '../bughouseLayout';
import {
  STUCK_CHECK_TEXT,
  STUCK_TEXT,
  boardCellToSquare,
  boardOrientation,
  boardSeatsTopFirst,
  boardSquareToCell,
  boardStatusLine,
  checkedKingSquare,
  dropSquares,
  formatBughouseClock,
  gameOverSummary,
  kingBadge,
  mainBoardOf,
  pocketChips,
  touchSeat,
  viewerWon,
} from '../bughouseView';
import type { SeatConfig, SeatController } from '../fourPlayer/setup';
import { scene, START } from './bughouseScenes';

/**
 * BUGHOUSE W3a - what the Local screens show and allow, from the engine's match and the seat config. Every expectation is a literal or the engine's own answer (the squares a drop may
 * go to, the verdict, the result are asked of the engine and compared, never recomputed here).
 */
const H: SeatController = { kind: 'human' };
const B: SeatController = { kind: 'bot', elo: 1200 };
const cfg = (a: string): SeatConfig => [a[0] === 'H' ? H : B, a[1] === 'H' ? H : B, a[2] === 'H' ? H : B, a[3] === 'H' ? H : B];
const sorted = (xs: string[]) => [...xs].sort();

/** A real play-out: the actions in order, one second apart, each through the engine. */
function play(match: BughouseMatch, steps: [BughouseSeat, Parameters<typeof applyAction>[2]][]): BughouseMatch {
  let m = match;
  let now = m.nowMs;
  for (const [seat, action] of steps) {
    now += 1000;
    const out = applyAction(m, seat, action, now);
    if (!out.ok) throw new Error(`refused: ${out.reason}`);
    m = out.match;
  }
  return m;
}
const mv = (board: BoardId, from: string, to: string) => ({ kind: 'move' as const, board, from, to });
/** Scholar's mate on `board` (White mates: the queen is adjacent to the king and protected, so no dropped piece could ever answer it - a REAL mate, unlike a distant queen check). */
const scholar = (board: BoardId): [BughouseSeat, ReturnType<typeof mv>][] => {
  const [white, black] = board === 'A' ? [0, 1] : [2, 3];
  return [[white as BughouseSeat, mv(board, 'e2', 'e4')], [black as BughouseSeat, mv(board, 'e7', 'e5')], [white as BughouseSeat, mv(board, 'f1', 'c4')], [black as BughouseSeat, mv(board, 'b8', 'c6')], [white as BughouseSeat, mv(board, 'd1', 'h5')], [black as BughouseSeat, mv(board, 'g8', 'f6')], [white as BughouseSeat, mv(board, 'h5', 'f7')]];
};

describe('orientation (S-U3): each board is shown from its player\'s side', () => {
  const start = scene({ a: START, b: START });
  it('one human: the own board shows the human\'s colour, the partner\'s board the PARTNER\'s colour (the other one)', () => {
    const expected: Record<string, [string, string]> = { HBBB: ['w', 'b'], BHBB: ['b', 'w'], BBHB: ['b', 'w'], BBBH: ['w', 'b'] }; // [board A, board B]
    for (const [pattern, [a, b]] of Object.entries(expected)) {
      const layout = deriveBughouseLayout(cfg(pattern));
      expect([boardOrientation(layout, 'A', start, true), boardOrientation(layout, 'B', start, true)], pattern).toEqual([a, b]);
    }
  });

  it('pass-and-play: the shared board turns to the side to move, the other board shows that side\'s partner; "auto-turn off" keeps White at the bottom', () => {
    const layout = deriveBughouseLayout(cfg('HHBB'));
    expect([boardOrientation(layout, 'A', start, true), boardOrientation(layout, 'B', start, true)]).toEqual(['w', 'b']);
    const afterE4 = play(start, [[0, mv('A', 'e2', 'e4')]]);
    expect([boardOrientation(layout, 'A', afterE4, true), boardOrientation(layout, 'B', afterE4, true)]).toEqual(['b', 'w']);
    expect([boardOrientation(layout, 'A', afterE4, false), boardOrientation(layout, 'B', afterE4, false)]).toEqual(['w', 'w']);
    const onB = deriveBughouseLayout(cfg('BBHH'));
    expect([boardOrientation(onB, 'B', start, true), boardOrientation(onB, 'A', start, true)]).toEqual(['w', 'b']);
    // the shared board is B: it follows ITS turn, not board A's
    const afterB = play(start, [[2, mv('B', 'e2', 'e4')]]);
    expect([boardOrientation(onB, 'B', afterB, true), boardOrientation(onB, 'A', afterB, true)]).toEqual(['b', 'w']);
  });

  it('the dual layout (W3b) and a game with no human show White at the bottom', () => {
    expect(boardOrientation(deriveBughouseLayout(cfg('HBBH')), 'A', start, true)).toBe('w');
    expect(boardOrientation(deriveBughouseLayout(cfg('BBBB')), 'B', start, true)).toBe('w');
  });

  it('the main board is the human\'s own board, or the shared board of pass-and-play', () => {
    expect(['HBBB', 'BHBB', 'BBHB', 'BBBH', 'HHBB', 'BBHH'].map((p) => mainBoardOf(deriveBughouseLayout(cfg(p))))).toEqual(['A', 'A', 'B', 'B', 'A', 'B']);
  });

  it('seat bars: the side at the bottom is last', () => {
    expect(boardSeatsTopFirst('A', 'w')).toEqual([1, 0]);
    expect(boardSeatsTopFirst('A', 'b')).toEqual([0, 1]);
    expect(boardSeatsTopFirst('B', 'w')).toEqual([3, 2]);
    expect(boardSeatsTopFirst('B', 'b')).toEqual([2, 3]);
  });
});

describe('the cell <-> square map takes the board and the orientation', () => {
  it('White at the bottom: the top-left cell is a8, the bottom-right h1; Black at the bottom: h1 and a8', () => {
    expect(boardCellToSquare('A', 'w', 0, 0)).toEqual({ board: 'A', square: 'a8' });
    expect(boardCellToSquare('B', 'w', 7, 7)).toEqual({ board: 'B', square: 'h1' });
    expect(boardCellToSquare('A', 'b', 0, 0)).toEqual({ board: 'A', square: 'h1' });
    expect(boardCellToSquare('B', 'b', 7, 7)).toEqual({ board: 'B', square: 'a8' });
    expect(boardCellToSquare('A', 'w', 4, 4)).toEqual({ board: 'A', square: 'e4' });
    expect(boardCellToSquare('A', 'b', 3, 3)).toEqual({ board: 'A', square: 'e4' });
  });

  it('the inverse round-trips on all 64 squares, both orientations, both boards', () => {
    for (const board of ['A', 'B'] as BoardId[])
      for (const o of ['w', 'b'] as const)
        for (let row = 0; row < 8; row++)
          for (let col = 0; col < 8; col++) {
            const { square } = boardCellToSquare(board, o, row, col);
            expect(boardSquareToCell(board, o, square)).toEqual({ board, row, col });
          }
  });
});

describe('who may touch (the turn lock)', () => {
  const start = scene({ a: START, b: START });
  it('only the side to move, and only when a human sits there', () => {
    const opponents = cfg('HHBB');
    expect(touchSeat(opponents, start, 'A')).toBe(0);
    expect(touchSeat(opponents, start, 'B')).toBeNull(); // a bot is to move on B
    const afterE4 = play(start, [[0, mv('A', 'e2', 'e4')]]);
    expect(touchSeat(opponents, afterE4, 'A')).toBe(1); // the turn passes to the other human
    expect(touchSeat(cfg('HBBB'), afterE4, 'A')).toBeNull(); // ...and for one human the opponent is a bot
    expect(touchSeat(cfg('BBBB'), start, 'A')).toBeNull();
  });

  it('nobody touches a finished match', () => {
    const mated = play(start, scholar('A'));
    expect(mated.result).not.toBeNull();
    expect(touchSeat(cfg('HHHH'), mated, 'A')).toBeNull();
    expect(touchSeat(cfg('HHHH'), mated, 'B')).toBeNull();
  });
});

describe('drops: the squares come from the engine', () => {
  it('a knight may go to every empty square, a pawn to every empty square except ranks 1 and 8', () => {
    const m = scene({ a: 'k7/8/8/8/8/8/8/K7 w - - 0 1', b: START, pockets: { 0: { n: 1, p: 1 } } });
    const knight = dropSquares(m, 'A', 'n');
    const pawn = dropSquares(m, 'A', 'p');
    expect(knight.length).toBe(62);
    expect(pawn.length).toBe(48);
    expect(pawn.some((s) => s[1] === '1' || s[1] === '8')).toBe(false);
    expect(knight).toContain('b1');
    expect(knight).not.toContain('a1'); // occupied
    expect(dropSquares(m, 'A', 'q')).toEqual([]); // not in the pocket
    expect(dropSquares(m, 'B', 'n')).toEqual([]); // the pocket belongs to the other board
  });

  it('in check, only the squares between the checker and the king (and a pawn cannot go to rank 1)', () => {
    const m = scene({ a: '4k3/8/8/8/8/8/8/K6r w - - 0 1', b: START, pockets: { 0: { n: 1, p: 1 } } });
    expect(sorted(dropSquares(m, 'A', 'n'))).toEqual(['b1', 'c1', 'd1', 'e1', 'f1', 'g1']);
    expect(dropSquares(m, 'A', 'p')).toEqual([]);
  });

  it('...and against a knight check no drop is offered at all', () => {
    const m = scene({ a: '4k3/8/8/8/8/1n6/8/K7 w - - 0 1', b: START, pockets: { 0: { q: 1 } } });
    expect(m.verdicts.A.status).toBe('check'); // the king can still step away; but no dropped piece can answer a knight's check
    expect(dropSquares(m, 'A', 'q')).toEqual([]);
  });
});

describe('pocket chips', () => {
  const m = scene({ a: START, b: START, pockets: { 0: { p: 2, q: 1, n: 1 }, 1: { r: 1 } } });
  it('the pieces held, queen first, with counts; usable only for the seat that may act and only with a legal square', () => {
    expect(pocketChips(m, 0, 0)).toEqual([
      { piece: 'q', count: 1, usable: true },
      { piece: 'n', count: 1, usable: true },
      { piece: 'p', count: 2, usable: true },
    ]);
    expect(pocketChips(m, 0, null).every((c) => !c.usable)).toBe(true);
    expect(pocketChips(m, 0, 1).every((c) => !c.usable)).toBe(true); // another seat is the actor
    expect(pocketChips(m, 3, 3)).toEqual([]);
  });

  it('a piece with no legal square is not usable (in check from a rook on the first rank, a pawn cannot block there but a knight can)', () => {
    const check = scene({ a: '4k3/8/8/8/8/8/8/K6r w - - 0 1', b: START, pockets: { 0: { n: 1, p: 1 } } });
    expect(pocketChips(check, 0, 0)).toEqual([
      { piece: 'n', count: 1, usable: true },
      { piece: 'p', count: 1, usable: false },
    ]);
  });
});

describe('the status line: a stuck side is waiting, never mated', () => {
  it('playing, check, and the side to move named', () => {
    const start = scene({ a: START, b: START });
    expect(boardStatusLine(start, 'A', true)).toEqual({ kind: 'playing', text: 'White to move' });
    const afterE4 = play(start, [[0, mv('A', 'e2', 'e4')]]);
    expect(boardStatusLine(afterE4, 'A', false)).toEqual({ kind: 'playing', text: 'Black to move' });
    const check = scene({ a: '4k3/8/8/8/8/8/8/K6r w - - 0 1', b: START, pockets: { 0: { n: 1 } } });
    expect(boardStatusLine(check, 'A', true)).toEqual({ kind: 'check', text: 'Check - your king is attacked' });
    expect(boardStatusLine(check, 'A', false)).toEqual({ kind: 'check', text: 'White is in check' });
  });

  it('a single slider check with an empty square between and nothing to drop is STUCK, not mate', () => {
    const m = scene({ a: 'R6k/6pp/8/8/8/8/8/K7 b - - 0 1', b: START });
    expect(m.verdicts.A.status).toBe('stuck');
    expect(boardStatusLine(m, 'A', true)).toEqual({ kind: 'stuck', text: STUCK_CHECK_TEXT });
    expect(boardStatusLine(m, 'A', false)).toEqual({ kind: 'stuck', text: 'Black is in check - waiting for a piece from their partner to block it' });
    expect(STUCK_CHECK_TEXT.toLowerCase()).not.toContain('mate');
  });

  it('nothing to move and nothing to drop, not in check, is STUCK too', () => {
    const m = scene({ a: START, b: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' });
    expect(m.verdicts.B.status).toBe('stuck');
    expect(boardStatusLine(m, 'B', true)).toEqual({ kind: 'stuck', text: STUCK_TEXT });
    expect(boardStatusLine(m, 'B', false)).toEqual({ kind: 'stuck', text: 'Black is waiting for a piece from their partner' });
    expect(STUCK_TEXT).toBe('Waiting for a piece from your partner');
  });

  it('once the match is over the board says so; "Checkmate" only for a real mate', () => {
    const start = scene({ a: START, b: START });
    const mated = play(start, scholar('A'));
    expect(mated.verdicts.A.status).toBe('checkmate');
    expect(boardStatusLine(mated, 'A', true)).toEqual({ kind: 'over', text: 'Checkmate' });
    expect(boardStatusLine(mated, 'B', true)).toEqual({ kind: 'over', text: 'Game over' });
  });

  it('the king in check is found for check, stuck-in-check and mate, and for nobody else', () => {
    expect(checkedKingSquare(scene({ a: '4k3/8/8/8/8/8/8/K6r w - - 0 1', b: START, pockets: { 0: { n: 1 } } }), 'A')).toBe('a1');
    expect(checkedKingSquare(scene({ a: 'R6k/6pp/8/8/8/8/8/K7 b - - 0 1', b: START }), 'A')).toBe('h8');
    expect(checkedKingSquare(scene({ a: START, b: START }), 'A')).toBeNull();
    expect(checkedKingSquare(scene({ a: START, b: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' }), 'B')).toBeNull(); // stuck without check
    expect(checkedKingSquare(play(scene({ a: START, b: START }), scholar('A')), 'A')).toBe('e8');
  });
});

describe('team badges (5.3)', () => {
  it('one human: only the human\'s own team is badged, "your team"; diamond for Team 1', () => {
    const solo = deriveBughouseLayout(cfg('HBBB')); // seat 0 = Team 1
    expect(kingBadge(solo, 'A', 'w')).toEqual({ team: 1, shape: '◆', label: 'your team' });
    expect(kingBadge(solo, 'B', 'b')).toEqual({ team: 1, shape: '◆', label: 'your team' }); // the partner
    expect(kingBadge(solo, 'A', 'b')).toBeNull();
    expect(kingBadge(solo, 'B', 'w')).toBeNull();
    const team2 = deriveBughouseLayout(cfg('BHBB')); // seat 1 = Team 2: circle
    expect(kingBadge(team2, 'A', 'b')).toEqual({ team: 2, shape: '●', label: 'your team' });
    expect(kingBadge(team2, 'B', 'w')).toEqual({ team: 2, shape: '●', label: 'your team' });
    expect(kingBadge(team2, 'A', 'w')).toBeNull();
  });

  it('several humans: both teams are badged on all four kings, by shape and "Team N"', () => {
    for (const pattern of ['HHBB', 'HBBH']) {
      const layout = deriveBughouseLayout(cfg(pattern));
      expect(kingBadge(layout, 'A', 'w')).toEqual({ team: 1, shape: '◆', label: 'Team 1' });
      expect(kingBadge(layout, 'A', 'b')).toEqual({ team: 2, shape: '●', label: 'Team 2' });
      expect(kingBadge(layout, 'B', 'w')).toEqual({ team: 2, shape: '●', label: 'Team 2' });
      expect(kingBadge(layout, 'B', 'b')).toEqual({ team: 1, shape: '◆', label: 'Team 1' });
    }
  });
});

describe('the game-over summary reads the engine\'s result', () => {
  const start = scene({ a: START, b: START });
  it('checkmate: the winning team, the reason and the deciding board', () => {
    // board B: B White (seat 2, Team 2) mates B Black (seat 3, Team 1)
    expect(gameOverSummary(play(start, scholar('B')))).toEqual({ voided: false, winnerTeam: 2, headline: 'Team 2 wins', reason: 'Checkmate', decidingBoard: 'B', loserSeat: 3, detail: 'Board B - checkmate' });
    expect(gameOverSummary(play(start, scholar('A')))).toEqual({ voided: false, winnerTeam: 1, headline: 'Team 1 wins', reason: 'Checkmate', decidingBoard: 'A', loserSeat: 1, detail: 'Board A - checkmate' });
  });

  it('a flag and a resignation', () => {
    const flagged = settle(start, null, 181000); // the clocks started at 1000 with 180000 each
    expect(flagged.kind).toBe('flag');
    const summary = gameOverSummary((flagged as { match: BughouseMatch }).match);
    expect(summary).toMatchObject({ voided: false, reason: 'Flag fell', detail: expect.stringMatching(/^Board [AB] - flag fell$/) });
    const resigned = play(start, [[1, { kind: 'resign' }]]);
    expect(gameOverSummary(resigned)).toEqual({ voided: false, winnerTeam: 1, headline: 'Team 1 wins', reason: 'Resigned', decidingBoard: 'A', loserSeat: 1, detail: 'Board A - resigned' });
    expect(gameOverSummary(play(start, [[3, { kind: 'resign' }]]))).toMatchObject({ winnerTeam: 2, decidingBoard: 'B', loserSeat: 3 });
  });

  it('nothing while the match is on; a voided match is "No result" with no deciding board', () => {
    expect(gameOverSummary(start)).toBeNull();
    expect(gameOverSummary({ ...start, result: { voided: true, reason: 'abandoned' } })).toEqual({ voided: true, winnerTeam: null, headline: 'No result', reason: 'Abandoned', decidingBoard: null, loserSeat: null, detail: 'Abandoned' });
  });

  it('the viewer won / lost with one human; unknown with several or none', () => {
    const resigned = play(start, [[1, { kind: 'resign' }]]); // Team 1 wins
    expect(viewerWon(cfg('HBBB'), resigned)).toBe(true); // seat 0 is Team 1
    expect(viewerWon(cfg('BHBB'), resigned)).toBe(false);
    expect(viewerWon(cfg('HHBB'), resigned)).toBeNull();
    expect(viewerWon(cfg('BBBB'), resigned)).toBeNull();
    expect(viewerWon(cfg('HBBB'), start)).toBeNull();
    expect(viewerWon(cfg('HBBB'), { ...start, result: { voided: true, reason: 'abandoned' } })).toBeNull(); // nobody won a voided match
  });
});

describe('clock text', () => {
  it('m:ss, tenths under ten seconds, never negative', () => {
    expect(formatBughouseClock(180000)).toBe('3:00');
    expect(formatBughouseClock(600000)).toBe('10:00');
    expect(formatBughouseClock(61000)).toBe('1:01');
    expect(formatBughouseClock(59999)).toBe('0:59');
    expect(formatBughouseClock(10000)).toBe('0:10');
    expect(formatBughouseClock(9999)).toBe('0:09.9');
    expect(formatBughouseClock(7400)).toBe('0:07.4');
    expect(formatBughouseClock(0)).toBe('0:00.0');
    expect(formatBughouseClock(-5)).toBe('0:00.0');
  });
});
