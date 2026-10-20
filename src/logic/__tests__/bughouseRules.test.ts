import { describe, expect, it } from 'vitest';
import { applyAction, conservationProblems, createMatch, legalActions, legalDropsOn, legalMovesOn, settle, BUGHOUSE_TIME_CONTROLS, type BughouseMatch } from '../bughouse';
import { drop, move, play, scene, START } from './bughouseScenes';

/**
 * Hand-built scenes for every rule of BUGHOUSE_SPEC.md section 1, numbered like the spec ("R4" = rule 4), plus the hard parts HP1 (one atomic step across both boards) and HP8 (`stuck`).
 * Seats: 0 = Board A White, 1 = A Black, 2 = Board B White, 3 = Board B Black; Team 1 = seats 0 + 3, Team 2 = 1 + 2; partner(0) = 3, partner(1) = 2. Constants are written out.
 */
const KINGS = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
const keys = (m: BughouseMatch, board: 'A' | 'B') => legalMovesOn(m, board).map((x) => `${x.from}${x.to}${x.promotion ?? ''}`);
const dropsOf = (m: BughouseMatch, board: 'A' | 'B') => legalDropsOn(m, board).map((d) => `${d.piece}@${d.square}`);
const refusal = (m: BughouseMatch, seat: 0 | 1 | 2 | 3, action: any, now = 2000) => {
  const outcome = settle(m, { seat, action }, now);
  expect(outcome.kind).toBe('rejected');
  if (outcome.kind !== 'rejected') throw new Error('not rejected');
  expect(outcome.match).toBe(m); // a refusal changes nothing: no state, no seq, no time
  return outcome.reason;
};

describe('R3, R24, R26: the start', () => {
  it('both boards start with White to move, the White clocks run, the four time controls are the spec\'s six', () => {
    const m = createMatch({ timeControl: BUGHOUSE_TIME_CONTROLS[0], roomNumber: 0, startMs: 0 });
    expect(m.verdicts.A.turn).toBe('w');
    expect(m.verdicts.B.turn).toBe('w');
    expect(m.clocks.map((c) => c.runningSince)).toEqual([0, null, 0, null]);
    expect(BUGHOUSE_TIME_CONTROLS).toEqual([
      { initialMs: 60000, incrementMs: 0 },
      { initialMs: 120000, incrementMs: 1000 },
      { initialMs: 180000, incrementMs: 0 },
      { initialMs: 180000, incrementMs: 2000 },
      { initialMs: 300000, incrementMs: 0 },
      { initialMs: 300000, incrementMs: 2000 },
    ]);
    expect(conservationProblems(m)).toEqual([]);
  });
});

describe('R4 / HP1: a capture goes to the capturer\'s PARTNER, at once, in the same step', () => {
  // board A: White (seat 0) can take Black's rook; board B: Black (seat 3) is to move and will hold the rook in its pocket
  const a = 'r3k3/8/8/8/8/8/8/R3K3 w - - 0 1';
  const b = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';
  const m0 = scene({ a, b, timeControl: { initialMs: 180000, incrementMs: 0 }, startMs: 0 });

  it('the rook lands in seat 3\'s pocket (the partner), not in the capturer\'s, and the move and the credit carry the same seq', () => {
    const outcome = settle(m0, { seat: 0, action: move('A', 'a1', 'a8') }, 500);
    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') return;
    const m = outcome.match;
    expect(m.pockets.map((p) => p.r)).toEqual([0, 0, 0, 1]);
    expect(m.pockets.map((p) => p.p + p.n + p.b + p.q)).toEqual([0, 0, 0, 0]);
    expect(outcome.events).toEqual([
      { kind: 'move', seq: 1, seat: 0, board: 'A', from: 'a1', to: 'a8', san: 'Rxa8+' },
      { kind: 'bank', seq: 1, seat: 3, piece: 'r' },
    ]);
    expect(m.seq).toBe(1);
  });

  it('it is droppable from the very commit that contains the capture, not before: a drop arriving first is refused, the same drop after the capture is applied', () => {
    expect(refusal(m0, 3, drop('B', 'r', 'e5'), 500)).toBe('dropNotInPocket');
    const m1 = play(m0, 0, move('A', 'a1', 'a8'), 500);
    expect(dropsOf(m1, 'B').filter((d) => d.startsWith('r@')).length).toBeGreaterThan(30);
    const m2 = play(m1, 3, drop('B', 'r', 'e5'), 500); // the same instant: arrival order decides, and this one arrived second
    expect(m2.boards.B.fen.split(' ')[0]).toBe('rnbqkbnr/pppppppp/8/4r3/8/8/PPPPPPPP/RNBQKBNR'); // a BLACK rook: the pocket holds a piece of the colour of whoever drops it
    expect(m2.pockets[3].r).toBe(0);
  });

  it('both arrival orders of a capture and a drop at the same millisecond: capture first - the drop works; drop first - refused, then the capture, then the drop works', () => {
    const first = play(play(m0, 0, move('A', 'a1', 'a8'), 700), 3, drop('B', 'r', 'e5'), 700);
    expect(first.pockets[3].r).toBe(0);
    expect(first.seq).toBe(2);
    expect(refusal(m0, 3, drop('B', 'r', 'e5'), 700)).toBe('dropNotInPocket');
    const second = play(play(m0, 0, move('A', 'a1', 'a8'), 700), 3, drop('B', 'r', 'e5'), 700);
    expect(second.boards).toEqual(first.boards);
  });
});

describe('R5: a captured PROMOTED piece goes to the pocket as a PAWN', () => {
  it('a pawn promotes on a8, the black rook takes it: seat 2 (the rook player\'s partner) gets a PAWN, not a queen', () => {
    const m0 = scene({ a: '7r/P3k3/8/8/8/8/8/4K3 w - - 0 1', b: START });
    const m1 = play(m0, 0, move('A', 'a7', 'a8', 'q'), 1500);
    expect(m1.boards.A.promoted).toEqual(['a8']);
    const m2 = play(m1, 1, move('A', 'h8', 'a8'), 1600);
    expect(m2.pockets[2]).toEqual({ p: 1, n: 0, b: 0, r: 0, q: 0 });
    expect(m2.boards.A.promoted).toEqual([]);
    expect(m2.pockets.reduce((n, p) => n + p.q, 0)).toBe(0);
  });

  it('an ORDINARY queen taken is banked as a queen', () => {
    const m0 = scene({ a: 'q3k3/8/8/8/8/8/8/Q3K3 w - - 0 1', b: START });
    const m1 = play(m0, 0, move('A', 'a1', 'a8'), 1500);
    expect(m1.pockets[3]).toEqual({ p: 0, n: 0, b: 0, r: 0, q: 1 });
  });

  it('the promoted mark travels with the piece and a capture of it on its new square still banks a pawn', () => {
    // a promoted queen on a8 (marked) moves to a2, where a white rook takes it
    const m0 = scene({ a: '3k4/8/8/8/8/8/8/R3K3 b - - 0 1', b: START, promotedA: ['a8'] });
    // put the marked queen on a8 by hand: black queen a8, white rook a1; Black plays Qa8-a2? (a-file clear), then White takes
    const withQueen = scene({ a: 'q2k4/8/8/8/8/8/8/R3K3 b - - 0 1', b: START, promotedA: ['a8'] });
    const m1 = play(withQueen, 1, move('A', 'a8', 'a2'), 1500);
    expect(m1.boards.A.promoted).toEqual(['a2']);
    const m2 = play(m1, 0, move('A', 'a1', 'a2'), 1600);
    expect(m2.pockets[3]).toEqual({ p: 1, n: 0, b: 0, r: 0, q: 0 });
    expect(m2.boards.A.promoted).toEqual([]);
    expect(m0.boards.A.promoted).toEqual(['a8']);
  });
});

describe('R6: a king is never banked', () => {
  it('a mate ends the match with no piece moving to any pocket', () => {
    const m0 = scene({ a: 'k7/2K5/8/8/8/8/8/1Q6 w - - 0 1', b: START });
    const m1 = play(m0, 0, move('A', 'b1', 'b7'), 1500);
    expect(m1.result).toEqual({ winnerTeam: 1, reason: 'checkmate', board: 'A', loserSeat: 1 });
    expect(m1.pockets.every((p) => p.p + p.n + p.b + p.r + p.q === 0)).toBe(true);
  });
});

describe('R7, R8: pockets are public and hold only pawn, knight, bishop, rook, queen', () => {
  it('the match carries all four pockets with exactly those five counts', () => {
    const m = createMatch({ timeControl: BUGHOUSE_TIME_CONTROLS[0], roomNumber: 0, startMs: 0 });
    expect(m.pockets).toHaveLength(4);
    expect(Object.keys(m.pockets[0])).toEqual(['p', 'n', 'b', 'r', 'q']);
  });
});

describe('R9, R10: a turn is ONE action; a drop goes on an EMPTY square; no pawn on rank 1 or 8', () => {
  const m0 = scene({ a: KINGS, b: START, pockets: { 0: { p: 1, n: 1 }, 1: { p: 1 } } });

  it('a drop passes the turn and charges the clock like a move; the drop is not offered twice', () => {
    const m1 = play(m0, 0, drop('A', 'n', 'c3'), 1500);
    expect(m1.verdicts.A.turn).toBe('b');
    expect(m1.pockets[0].n).toBe(0);
    expect(refusal(m1, 0, drop('A', 'n', 'd3'), 1600)).toBe('notYourTurn');
  });

  it('an occupied square is refused ("no drop capture"): the king\'s own square and the opposing king\'s', () => {
    expect(refusal(m0, 0, drop('A', 'n', 'e1'))).toBe('illegalDrop');
    expect(refusal(m0, 0, drop('A', 'n', 'e8'))).toBe('illegalDrop');
  });

  it('a pawn is refused on rank 1 and rank 8 and allowed on every rank between (for Black too)', () => {
    for (const sq of ['a1', 'h1', 'a8', 'h8', 'd8']) expect(refusal(m0, 0, drop('A', 'p', sq)), sq).toBe('illegalDrop');
    const whitePawnSquares = dropsOf(m0, 'A').filter((d) => d.startsWith('p@')).map((d) => d.slice(2));
    expect(whitePawnSquares.some((s) => s[1] === '1' || s[1] === '8')).toBe(false);
    expect(whitePawnSquares).toContain('a2');
    expect(whitePawnSquares).toContain('h7');
    const m1 = play(m0, 0, drop('A', 'n', 'c3'), 1500);
    const blackPawnSquares = dropsOf(m1, 'A').filter((d) => d.startsWith('p@')).map((d) => d.slice(2));
    expect(blackPawnSquares.some((s) => s[1] === '1' || s[1] === '8')).toBe(false);
    expect(blackPawnSquares).toContain('a7');
  });
});

describe('R11 (B1): a pawn dropped on the 2nd rank may double-step and be taken en passant; a dropped pawn may promote', () => {
  it('drop e2, the king moves, e2-e4 (two squares), and the black pawn on d4 takes en passant - the victim is banked to seat 2 as a pawn', () => {
    const m0 = scene({ a: '4k3/8/8/8/3p4/8/8/4K3 w - - 0 1', b: START, pockets: { 0: { p: 1 } } });
    const m1 = play(m0, 0, drop('A', 'p', 'e2'), 1500);
    const m2 = play(m1, 1, move('A', 'e8', 'd8'), 1600);
    expect(keys(m2, 'A')).toContain('e2e4');
    const m3 = play(m2, 0, move('A', 'e2', 'e4'), 1700);
    expect(m3.boards.A.fen.split(' ')[3]).toBe('e3');
    expect(keys(m3, 'A')).toContain('d4e3');
    const m4 = play(m3, 1, move('A', 'd4', 'e3'), 1800);
    expect(m4.boards.A.fen.split(' ')[0]).toBe('3k4/8/8/8/8/4p3/8/4K3');
    expect(m4.pockets[2].p).toBe(1);
  });

  it('a pawn dropped on the 7th rank promotes on its next move', () => {
    const m0 = scene({ a: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', b: START, pockets: { 0: { p: 1 } } });
    const m1 = play(m0, 0, drop('A', 'p', 'a7'), 1500);
    const m2 = play(m1, 1, move('A', 'e8', 'd7'), 1600);
    const m3 = play(m2, 0, move('A', 'a7', 'a8', 'q'), 1700);
    expect(m3.boards.A.promoted).toEqual(['a8']);
  });
});

describe('R12: a drop may give check and may deliver a REAL mate', () => {
  it('a knight dropped on b6 gives check; the notation says so', () => {
    const m0 = scene({ a: 'k7/8/8/8/8/8/8/4K3 w - - 0 1', b: START, pockets: { 0: { n: 1 } } });
    const outcome = settle(m0, { seat: 0, action: drop('A', 'n', 'b6') }, 1500);
    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') return;
    expect(outcome.events[0]).toMatchObject({ kind: 'drop', san: 'N@b6+' });
    expect(outcome.match.verdicts.A).toMatchObject({ status: 'check', inCheck: true, stuck: null });
  });

  it('Q@g8 beside a king boxed in by its own pawns, with the queen protected by a bishop, is a REAL mate: the match ends, team 1 wins on board A', () => {
    const m0 = scene({ a: '7k/6pp/8/8/2B5/8/8/4K3 w - - 0 1', b: START, pockets: { 0: { q: 1 } } });
    const outcome = settle(m0, { seat: 0, action: drop('A', 'q', 'g8') }, 1500);
    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') return;
    expect(outcome.events[0]).toMatchObject({ san: 'Q@g8#' });
    expect(outcome.match.result).toEqual({ winnerTeam: 1, reason: 'checkmate', board: 'A', loserSeat: 1 });
  });

  it('Q@e8 against the same king is only a back-rank check that a piece dropped on f8 or g8 could block: stuck, not mate (rule 18)', () => {
    const m0 = scene({ a: '7k/6pp/8/8/8/8/8/4K3 w - - 0 1', b: START, pockets: { 0: { q: 1 } } });
    const outcome = settle(m0, { seat: 0, action: drop('A', 'q', 'e8') }, 1500);
    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') return;
    expect(outcome.events[0]).toMatchObject({ san: 'Q@e8+' });
    expect(outcome.match.result).toBeNull();
    expect(outcome.match.verdicts.A).toEqual({ status: 'stuck', turn: 'b', inCheck: true, stuck: 'check' });
    // and if Black\'s partner supplies a piece, Black can block
    const rescued = scene({ a: '4Q2k/6pp/8/8/8/8/8/4K3 b - - 0 1', b: START, pockets: { 1: { b: 1 } } });
    expect(dropsOf(rescued, 'A').sort()).toEqual(['b@f8', 'b@g8']);
  });
});

describe('R13: in check, only a drop BETWEEN a single slider and the king; none against a knight, a pawn or a double check', () => {
  it('rook a1 checks Ke1: the only legal drops are b1, c1, d1 - and a pawn cannot be dropped there', () => {
    const m = scene({ a: '4k3/8/8/8/8/8/8/r3K3 w - - 0 1', b: START, pockets: { 0: { n: 1, p: 1 } } });
    expect(dropsOf(m, 'A').sort()).toEqual(['n@b1', 'n@c1', 'n@d1']);
    expect(refusal(m, 0, drop('A', 'n', 'a2'))).toBe('illegalDrop');
  });

  it('a knight check, a pawn check and a double check offer no drop at all', () => {
    const pocket = { 0: { p: 1, n: 1, b: 1, r: 1, q: 1 } };
    for (const fen of ['4k3/8/8/8/8/3n4/8/4K3 w - - 0 1', '4k3/8/8/8/8/8/3p4/4K3 w - - 0 1', 'k3r3/8/8/8/8/3n4/8/4K3 w - - 0 1']) {
      const m = scene({ a: fen, b: START, pockets: pocket });
      expect(legalDropsOn(m, 'A'), fen).toEqual([]);
    }
  });
});

describe('R14 (B6): a rook dropped back on its home square does NOT restore castling', () => {
  it('with only the queen-side right left, a rook dropped on h1 leaves e1c1 legal and e1g1 illegal', () => {
    const m0 = scene({ a: '4k3/8/8/8/8/8/8/R3K3 w Q - 0 1', b: START, pockets: { 0: { r: 1 } } });
    expect(keys(m0, 'A')).toContain('e1c1');
    expect(keys(m0, 'A')).not.toContain('e1g1');
    const m1 = play(m0, 0, drop('A', 'r', 'h1'), 1500);
    const m2 = play(m1, 1, move('A', 'e8', 'd8'), 1600);
    expect(keys(m2, 'A')).not.toContain('e1g1');
    expect(keys(m2, 'A')).toContain('e1c1');
  });

  it('a captured corner rook takes its castling right with it, and a dropped rook does not bring it back', () => {
    const m0 = scene({ a: 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', b: START, pockets: { 0: { r: 1 } } });
    const m1 = play(m0, 1, move('A', 'h8', 'h1'), 1500); // Black's rook takes h1 with check
    expect(m1.boards.A.fen.split(' ')[2]).not.toContain('K');
    const m2 = play(m1, 0, drop('A', 'r', 'f1'), 1600); // blocks the check
    const m3 = play(m2, 1, move('A', 'e8', 'd8'), 1700);
    expect(m3.boards.A.fen.split(' ')[2]).not.toContain('K');
  });
});

describe('R15, R16: promotion by push or capture; a drop clears a stale en passant square', () => {
  it('b7 can promote on b8 (push) and on a8 (capture), to all four pieces', () => {
    const m = scene({ a: 'r3k3/1P6/8/8/8/8/8/4K3 w - - 0 1', b: START });
    const promotions = keys(m, 'A').filter((k) => k.startsWith('b7'));
    expect(promotions.sort()).toEqual(['b7a8b', 'b7a8n', 'b7a8q', 'b7a8r', 'b7b8b', 'b7b8n', 'b7b8q', 'b7b8r']);
  });

  it('Black\'s double step offers e5xd6 en passant; if White DROPS instead of taking, the square is gone', () => {
    const m0 = scene({ a: '4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1', b: START, pockets: { 0: { p: 1 } } });
    const m1 = play(m0, 1, move('A', 'd7', 'd5'), 1500);
    expect(keys(m1, 'A')).toContain('e5d6');
    const m2 = play(m1, 0, drop('A', 'p', 'a2'), 1600);
    const m3 = play(m2, 1, move('A', 'e8', 'e7'), 1700);
    expect(keys(m3, 'A')).not.toContain('e5d6');
    expect(m2.boards.A.fen.split(' ')[3]).toBe('-');
  });
});

describe('R17 / R23: the WHOLE match ends as soon as ANY board ends', () => {
  it('a mate on board B ends the match while board A is mid-game; nothing more is accepted', () => {
    const m0 = scene({ a: START, b: 'k7/2K5/8/8/8/8/8/1Q6 w - - 0 1' });
    const m1 = play(m0, 2, move('B', 'b1', 'b7'), 1500);
    expect(m1.result).toEqual({ winnerTeam: 2, reason: 'checkmate', board: 'B', loserSeat: 3 });
    expect(m1.clocks.every((c) => c.runningSince === null)).toBe(true);
    expect(refusal(m1, 0, move('A', 'e2', 'e4'), 1600)).toBe('over');
  });

  it('a resignation is possible at any time, also off turn and also by the player who is waiting; the loser is the resigner\'s team', () => {
    const m0 = scene({ a: START, b: START });
    expect(play(m0, 1, { kind: 'resign' }, 1500).result).toEqual({ winnerTeam: 1, reason: 'resign', board: 'A', loserSeat: 1 });
    expect(play(m0, 2, { kind: 'resign' }, 1500).result).toEqual({ winnerTeam: 1, reason: 'resign', board: 'B', loserSeat: 2 });
    expect(play(m0, 3, { kind: 'disconnect' }, 1500).result).toEqual({ winnerTeam: 2, reason: 'disconnect', board: 'B', loserSeat: 3 });
  });
});

describe('R18 (B4) / HP8: a check that a dropped piece could block is NOT mate - the player is stuck and waits', () => {
  // White Kh1 behind its pawns g2 h2, Black rook a1 checks along rank 1: no legal move, nothing to drop yet, but a piece on b1..g1 would answer
  const backRank = 'k7/8/8/8/8/8/6PP/r6K w - - 0 1';

  it('with an EMPTY pocket the verdict is stuck (check), not checkmate; the match goes on and the clock keeps running', () => {
    const m = scene({ a: backRank, b: START, timeControl: { initialMs: 60000, incrementMs: 0 }, startMs: 0 });
    expect(m.verdicts.A).toEqual({ status: 'stuck', turn: 'w', inCheck: true, stuck: 'check' });
    expect(m.result).toBeNull();
    expect(legalActions(m, 0)).toEqual({ moves: [], drops: [] });
    // time passes: seat 0 simply loses time and falls on its flag
    const outcome = settle(m, null, 60000);
    expect(outcome.kind).toBe('flag');
    if (outcome.kind === 'flag') expect(outcome.match.result).toMatchObject({ reason: 'flag', loserSeat: 0 });
  });

  it('the status flips at the exact commit in which the partner\'s capture fills the pocket', () => {
    // seat 3 (B Black, seat 0\'s partner) takes a white rook on board B: a rook arrives in seat 0\'s pocket
    const m0 = scene({ a: backRank, b: 'r3k3/8/8/8/8/8/8/R3K3 b - - 0 1' });
    expect(m0.verdicts.A.status).toBe('stuck');
    const m1 = play(m0, 3, move('B', 'a8', 'a1'), 1500);
    expect(m1.seq).toBe(1);
    expect(m1.pockets[0].r).toBe(1);
    expect(m1.verdicts.A).toEqual({ status: 'check', turn: 'w', inCheck: true, stuck: null });
    expect(dropsOf(m1, 'A').sort()).toEqual(['r@b1', 'r@c1', 'r@d1', 'r@e1', 'r@f1', 'r@g1']);
    const m2 = play(m1, 0, drop('A', 'r', 'g1'), 1600);
    expect(m2.verdicts.A.turn).toBe('b');
  });

  it('REAL mates: an adjacent protected queen, a smothering knight, a double check - no drop could ever help', () => {
    const adjacent = scene({ a: 'k7/2K5/8/8/8/8/8/1Q6 w - - 0 1', b: START });
    expect(play(adjacent, 0, move('A', 'b1', 'b7'), 1500).result).toMatchObject({ reason: 'checkmate' });
    const smothered = scene({ a: '6k1/8/8/8/8/3n4/6PP/6RK b - - 0 1', b: START });
    const mated = play(smothered, 1, move('A', 'd3', 'f2'), 1500);
    expect(mated.result).toEqual({ winnerTeam: 2, reason: 'checkmate', board: 'A', loserSeat: 0 });
    const double = scene({ a: 'b3k2r/8/8/8/8/8/8/6RK w - - 0 1', b: START });
    expect(double.verdicts.A).toEqual({ status: 'checkmate', turn: 'w', inCheck: true, stuck: null });
  });

  it('the notation of a stuck check is "+", of a real mate "#"', () => {
    const mate = scene({ a: '6k1/8/8/8/8/3n4/6PP/6RK b - - 0 1', b: START });
    const mated = settle(mate, { seat: 1, action: move('A', 'd3', 'f2') }, 1500);
    expect(mated.kind).toBe('applied');
    if (mated.kind === 'applied') expect(mated.events[0]).toMatchObject({ san: 'Nf2#' });
    // Black\'s rook swings to b1: a back-rank check on Kh1 behind its pawns that a dropped piece could still block
    const stuckCheck = scene({ a: 'k7/1r6/8/8/8/8/6PP/7K b - - 0 1', b: START });
    const checked = settle(stuckCheck, { seat: 1, action: move('A', 'b7', 'b1') }, 1500);
    expect(checked.kind).toBe('applied');
    if (checked.kind === 'applied') {
      expect(checked.events[0]).toMatchObject({ san: 'Rb1+' });
      expect(checked.match.result).toBeNull();
      expect(checked.match.verdicts.A.status).toBe('stuck');
    }
  });
});

describe('R19 (B5): no legal action and not in check - the player waits and the clock decides', () => {
  it('a stalemate with an empty pocket is stuck (noAction), nothing ends, and the stalemated player falls on the clock', () => {
    const m = scene({ a: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', b: START, timeControl: { initialMs: 60000, incrementMs: 0 }, startMs: 0 });
    expect(m.verdicts.A).toEqual({ status: 'stuck', turn: 'b', inCheck: false, stuck: 'noAction' });
    expect(m.result).toBeNull();
    const outcome = settle(m, null, 60000);
    expect(outcome.kind).toBe('flag');
    if (outcome.kind === 'flag') expect(outcome.match.result).toMatchObject({ reason: 'flag', loserSeat: 1 });
  });

  it('with a piece in the pocket the same position is NOT stuck: the player drops', () => {
    const m = scene({ a: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', b: START, pockets: { 1: { p: 1 } } });
    expect(m.verdicts.A.status).toBe('playing');
    expect(legalDropsOn(m, 'A').length).toBeGreaterThan(40);
  });
});

describe('R20, R22: insufficient material, repetition and the fifty-move rule never end a game; there is no draw', () => {
  it('bare kings go on', () => {
    const m = scene({ a: 'k7/8/8/8/8/8/8/7K w - - 0 1', b: START });
    expect(m.verdicts.A.status).toBe('playing');
    expect(m.result).toBeNull();
    expect(play(m, 0, move('A', 'h1', 'g1'), 1500).result).toBeNull();
  });

  it('a halfmove clock at 100 (the fifty-move rule) changes nothing', () => {
    const m = scene({ a: 'k7/8/8/8/8/8/8/7K w - - 100 90', b: START });
    const next = play(m, 0, move('A', 'h1', 'g1'), 1500);
    expect(next.result).toBeNull();
    expect(next.verdicts.A.status).toBe('playing');
  });

  it('the same position four times: the knights shuffle and nobody is awarded anything', () => {
    let m = scene({ a: 'r1bqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'.replace('r1bqkbnr', 'rnbqkbnr'), b: START });
    let t = 1500;
    for (let i = 0; i < 4; i++) {
      m = play(m, 0, move('A', 'b1', 'c3'), (t += 10));
      m = play(m, 1, move('A', 'b8', 'c6'), (t += 10));
      m = play(m, 0, move('A', 'c3', 'b1'), (t += 10));
      m = play(m, 1, move('A', 'c6', 'b8'), (t += 10));
    }
    expect(m.result).toBeNull();
    expect(m.seq).toBe(16);
  });

  it('the result type has no tie: the only non-winning result is "voided", and no source file of the module names a tie', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = `${__dirname}/../bughouse`;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const text = readFileSync(`${dir}/${file}`, 'utf8');
      expect(/['"`]draw['"`]|\bdraw\s*:|\bisDraw\b|\.isDraw\(|\bstalemate\b\s*:/i.test(text), `${file} must not model a draw`).toBe(false);
    }
  });
});

describe('R21: an illegal request does not exist - it is refused with a reason, and nothing changes', () => {
  const m = scene({ a: START, b: START });

  it('each kind of refusal, with the match returned untouched', () => {
    expect(refusal(m, 0, move('A', 'e2', 'e5'))).toBe('illegalMove');
    expect(refusal(m, 0, move('A', 'e7', 'e5'))).toBe('illegalMove'); // an opposing pawn
    expect(refusal(m, 0, move('B', 'e2', 'e4'))).toBe('wrongBoard');
    expect(refusal(m, 1, move('A', 'e7', 'e5'))).toBe('notYourTurn');
    expect(refusal(m, 0, drop('A', 'n', 'e4'))).toBe('dropNotInPocket');
    expect(refusal(m, 0, { kind: 'move', board: 'A', from: 'e9', to: 'e4' })).toBe('malformed');
    expect(refusal(m, 0, { kind: 'castle' })).toBe('malformed');
    expect(refusal(m, 9 as any, { kind: 'resign' })).toBe('malformed');
    expect(refusal(m, 0, { kind: 'move', board: 'C', from: 'e2', to: 'e4' })).toBe('malformed');
    expect(refusal(m, 0, { kind: 'move', board: 'A', from: 'e2', to: 'e4', promotion: 'k' })).toBe('malformed');
  });

  it('applyAction itself refuses while a flag is due (the order "due flags first" cannot be bypassed)', () => {
    const outcome = applyAction(m, 0, move('A', 'e2', 'e4'), 1000 + 180000);
    expect(outcome).toEqual({ ok: false, reason: 'flagDue' });
  });
});

describe('HP1: one commit is atomic across both boards', () => {
  it('the capture on A, the credit on B, the clock charge and the seq are ONE new match: there is no state with a capture and no credit', () => {
    const m0 = scene({ a: 'r3k3/8/8/8/8/8/8/R3K3 w - - 0 1', b: START });
    const before = JSON.stringify(m0);
    const outcome = applyAction(m0, 0, move('A', 'a1', 'a8'), 1500);
    expect(JSON.stringify(m0)).toBe(before); // the input match is never changed
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const m = outcome.match;
    expect(m.boards.A.fen.split(' ')[0]).toBe('R3k3/8/8/8/8/8/8/4K3');
    expect(m.pockets[3].r).toBe(1);
    expect(m.clocks[0].runningSince).toBeNull();
    expect(m.clocks[1].runningSince).toBe(1500);
    expect(m.seq).toBe(1);
  });
});
