import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FFA_RULES,
  GIVEAWAY_RULES,
  chooseBotMoveFor,
  findLegalMove,
  initialState,
  legalMoves,
  moveLabel,
  parseSquare,
  playMove,
  resign,
  resolvePremove,
  serialize,
  squareName,
  stateFromPieces,
  type FourPlayerState,
  type PositionOptions,
  type Seat,
} from '../fourPlayer';
import {
  adoptSnapshot,
  applyFourState,
  applyGameOver,
  beginMove,
  displayState,
  moveRejected,
  readSnapshot,
  viewFromMatch,
  viewFromRoom,
  type FourOnlineView,
} from '../fourPlayerOnline';
import {
  buildSpectateRows,
  checkMatchVariant,
  describeFourResultNote,
  describeStatus,
  joinQueueRequest,
  resultRows,
} from '../fourPlayerOnlineUi';
import {
  GIVEAWAY_RULE_HINT,
  checkedKingSquares,
  describeResignWarning,
  describeResultNote,
  rankSeats,
  seatMetric,
  seatMetricText,
  statusSuffix,
  variantIntro,
  variantModeLabel,
  variantOfState,
  variantTitle,
} from '../fourPlayerVariant';
import type { FourGameOverPayload, FourMatchFoundPayload, FourRoomState, FourSeatInfo, FourSeats, FourStatePayload } from '../fourPlayerWire';
import { validateFourJoinQueue } from '../fourPlayerWire';

/**
 * 4 Player Giveaway, workstream W3 - every screen (FOUR_PLAYER_GIVEAWAY_SPEC.md section 8). The project has no React Native renderer, so, as for the
 * Chess screens, what can be exercised is the PURE part (wording, ranking, what the seat card counts, how the online view reads a snapshot, the queue's
 * request and its echo check) and the rest is pinned at source level: the screen really calls those functions and the Chess entries really pass 'ffa'.
 * The annotation-lifecycle additions are in annotationLifecycle.test.ts.
 */
const RED: Seat = 0;
const BLUE: Seat = 1;
const YELLOW: Seat = 2;
const GREEN: Seat = 3;
const first = () => 0;
const sq = parseSquare;
const gp = (pieces: string[], options: PositionOptions = {}): FourPlayerState => stateFromPieces(pieces, { rules: GIVEAWAY_RULES, ...options });
const KINGS = ['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7'];

describe('wording per variant', () => {
  it('titles, header labels and intro text', () => {
    expect(variantTitle('ffa')).toBe('4 Player Chess');
    expect(variantTitle('giveaway')).toBe('4 Player Giveaway');
    expect(variantModeLabel('ffa')).toBe('Free-for-All');
    expect(variantModeLabel('giveaway')).toBe('Antichess'); // the title already says Giveaway
    expect(variantIntro('ffa')).toMatch(/Checkmate players to eliminate them and score points/); // the original text, unchanged
    expect(variantIntro('giveaway')).toMatch(/Captures are mandatory/);
    expect(variantIntro('giveaway')).not.toMatch(/Checkmate/);
    expect(GIVEAWAY_RULE_HINT).toBe('Captures are mandatory — lose all your pieces to win.');
  });

  it('the variant of a position is read from its rules', () => {
    expect(variantOfState(initialState(FFA_RULES))).toBe('ffa');
    expect(variantOfState(initialState(GIVEAWAY_RULES))).toBe('giveaway');
  });
});

describe('the Resign confirmation (a wording gap found by the W5 browser pass: the ONLINE screen said "dead blockers" in a Giveaway game)', () => {
  it('4 Player Chess keeps its two original sentences exactly; Giveaway says the pieces become walls nobody can capture, locally and online', () => {
    expect(describeResignWarning('ffa', false)).toBe('This seat is eliminated; its pieces stay on the board as dead blockers.');
    expect(describeResignWarning('ffa', true)).toBe('Your seat is eliminated and its pieces stay on the board as dead blockers. You can keep watching until the game ends.');
    expect(describeResignWarning('giveaway', false)).toBe('This seat is eliminated and cannot win; its pieces stay on the board as walls that nobody can capture.');
    expect(describeResignWarning('giveaway', true)).toBe('Your seat is eliminated and cannot win; its pieces stay on the board as walls that nobody can capture. You can keep watching until the game ends.');
    expect(describeResignWarning('giveaway', true)).not.toMatch(/dead blockers/);
  });

  it('both game screens take the wording from the helper with the right arguments (no screen carries its own copy)', () => {
    const read = (rel: string) => readFileSync(join(__dirname, '../..', rel), 'utf8').replace(/\r\n/g, '\n');
    expect(read('screens/FourPlayerOnlineGameScreen.tsx')).toContain("appAlert('Resign?', describeResignWarning(view.variant, true), [");
    expect(read('screens/FourPlayerGameScreen.tsx')).toContain('describeResignWarning(variant, false),');
    for (const file of ['screens/FourPlayerOnlineGameScreen.tsx', 'screens/FourPlayerGameScreen.tsx']) expect(read(file), file).not.toContain('dead blockers');
  });
});

describe('the seat card: points in Chess, pieces left in Giveaway', () => {
  it('Chess counts the score, Giveaway the pieces on the board (kings and walls included)', () => {
    const chess = stateFromPieces([...KINGS, 'rP@e3', 'rP@e4'], { score: [7, 0, 3, 0] });
    expect([0, 1, 2, 3].map((s) => seatMetric(chess, s as Seat))).toEqual([7, 0, 3, 0]);
    expect(seatMetricText(chess, RED)).toBe('score 7');
    const giveaway = gp([...KINGS, 'rP@e3', 'rP@e4']);
    expect([0, 1, 2, 3].map((s) => seatMetric(giveaway, s as Seat))).toEqual([3, 1, 1, 1]);
    expect(seatMetricText(giveaway, RED)).toBe('3 pieces left');
    expect(seatMetricText(giveaway, BLUE)).toBe('1 piece left');
    expect(seatMetric(initialState(GIVEAWAY_RULES), YELLOW)).toBe(16);
  });
});

describe('the "in check" highlight and status suffix', () => {
  // Blue's rook attacks the Red king on h1 along rank 1: in 4 Player Chess that is check; in Giveaway there is no check.
  const pieces = ['rK@h1', 'bR@d1', 'bK@a8', 'yK@g14', 'gK@n7'];

  it('Chess marks the king in check and says so; Giveaway marks nothing and never says "in check"', () => {
    const chess = stateFromPieces(pieces, { turn: RED });
    expect(checkedKingSquares(chess)).toEqual([sq('h1')]);
    expect(statusSuffix(chess, RED)).toBe(' — in check!');
    const giveaway = gp(pieces, { turn: RED });
    expect(checkedKingSquares(giveaway)).toEqual([]);
    expect(statusSuffix(giveaway, RED)).not.toMatch(/check!/);
  });

  it('Chess: nothing when not in check; an eliminated seat\'s king is never marked', () => {
    expect(statusSuffix(stateFromPieces(KINGS, { turn: RED }), RED)).toBe('');
    const dead = stateFromPieces(pieces, { turn: BLUE, status: ['dead-king', 'active', 'active', 'active'] });
    expect(checkedKingSquares(dead)).toEqual([]);
  });

  it('Giveaway says "must capture" exactly when the seat to move has a capture', () => {
    expect(statusSuffix(gp(['rR@d5', 'bP@d9', ...KINGS], { turn: RED }), RED)).toBe(' — must capture');
    expect(statusSuffix(gp(KINGS, { turn: RED }), RED)).toBe('');
    expect(statusSuffix(initialState(GIVEAWAY_RULES), RED)).toBe('');
  });
});

describe('the result table', () => {
  it('Chess ranks by score (ties by seat), exactly as before', () => {
    expect(rankSeats('ffa', [3, 9, 9, 1], [BLUE, YELLOW])).toEqual([BLUE, YELLOW, RED, GREEN]);
    expect(rankSeats('ffa', [0, 0, 0, 0], [RED, BLUE, YELLOW, GREEN])).toEqual([RED, BLUE, YELLOW, GREEN]);
  });

  it('Giveaway: the winner first, then the fewest pieces left (ties by seat)', () => {
    expect(rankSeats('giveaway', [5, 2, 7, 0], [GREEN])).toEqual([GREEN, BLUE, RED, YELLOW]);
    expect(rankSeats('giveaway', [5, 9, 2, 2], [BLUE])).toEqual([BLUE, YELLOW, GREEN, RED]); // a winner is first even with the most pieces (stuck win)
    expect(rankSeats('giveaway', [3, 3, 8, 3], [RED, BLUE, GREEN])).toEqual([RED, BLUE, GREEN, YELLOW]); // a tied cap: all winners first
  });

  it('the online result rows follow the variant and show the pieces left as the score', () => {
    const seats = [0, 1, 2, 3].map((i) => ({ seat: i, kind: 'human', name: `P${i}`, connected: true })) as FourSeatInfo[];
    const over: FourGameOverPayload = { roomId: 'r', reason: 'outOfPieces', winners: [GREEN], scores: [5, 2, 7, 0], state: 'x' };
    expect(resultRows(over, seats, 'giveaway').map((r) => [r.place, r.seat, r.score, r.winner])).toEqual([
      [1, GREEN, 0, true],
      [2, BLUE, 2, false],
      [3, RED, 5, false],
      [4, YELLOW, 7, false],
    ]);
    // the default is 4 Player Chess: by score, descending
    expect(resultRows(over, seats).map((r) => r.seat)).toEqual([YELLOW, RED, BLUE, GREEN]);
    expect(resultRows({ ...over, reason: 'abandoned', winners: [] }, seats, 'giveaway')).toEqual([]);
  });

  it('the one-line reason names the seat in Giveaway and keeps the Chess text for Chess', () => {
    expect(describeResultNote({ reason: 'outOfPieces', winners: [GREEN] }, 'giveaway')).toBe('Green lost its last piece and wins.');
    expect(describeResultNote({ reason: 'stuck', winners: [YELLOW] }, 'giveaway')).toBe('Yellow had no legal move and wins.');
    expect(describeResultNote({ reason: 'lastStanding', winners: [RED] }, 'giveaway')).toMatch(/Everyone else resigned or ran out of time — Red wins/);
    expect(describeResultNote({ reason: 'cap', winners: [RED, BLUE] }, 'giveaway')).toBe('Move limit reached — fewest pieces wins.');
    expect(describeResultNote({ reason: 'elimination', winners: [RED] }, 'ffa')).toMatch(/eliminated/);
    expect(describeResultNote({ reason: 'cap', winners: [RED] }, 'ffa')).toMatch(/scored by points/);
    expect(describeResultNote({ reason: 'abandoned', winners: [] }, 'giveaway')).toMatch(/Every human player left/);
    expect(describeResultNote({ reason: 'abandoned', winners: [] }, 'ffa')).toMatch(/Every human player left/);
    // the online wrapper, defaults = Chess
    expect(describeFourResultNote('cap')).toMatch(/scored by points/);
    expect(describeFourResultNote('stuck', 'giveaway', [BLUE])).toBe('Blue had no legal move and wins.');
  });
});

// --- the online client: a snapshot has no rules in it, so the view carries the variant ----------------------------------------------------------

const SEATS: FourSeats = [0, 1, 2, 3].map((i) => ({ seat: i as Seat, kind: 'human', name: `P${i}`, connected: true })) as FourSeats;
const TC = { initialSeconds: 600, incrementSeconds: 0 };
const CLOCKS: [number, number, number, number] = [600000, 600000, 600000, 600000];

function roomOf(state: FourPlayerState, extra: Partial<FourRoomState> = {}): FourRoomState {
  return { roomId: 'room', seats: SEATS, timeControl: TC, timeControlLabel: '10 min', seq: 0, state: serialize(state), clocksMs: CLOCKS, log: [], ...extra };
}
function matchOf(state: FourPlayerState, seat: Seat, extra: Partial<FourMatchFoundPayload> = {}): FourMatchFoundPayload {
  return { roomId: 'room', seat, playerToken: 't', seats: SEATS, timeControl: TC, timeControlLabel: '10 min', state: serialize(state), clocksMs: CLOCKS, seq: 0, ...extra };
}
const statePayload = (state: FourPlayerState, seq: number): FourStatePayload => ({ roomId: 'room', seq, actor: 'human', move: null, events: [], state: serialize(state), clocksMs: CLOCKS });

// a position where the capture is forced: Red's rook can take Blue's pawn
const FORCED = gp(['rR@d5', 'bP@d9', ...KINGS], { turn: RED });

describe('the online view reads every snapshot with its room\'s rules', () => {
  it('a Giveaway match builds a Giveaway view whose position has the Giveaway legal moves (the capture is forced); the same text read as Chess is not', () => {
    const view = viewFromMatch(matchOf(FORCED, RED, { variant: 'giveaway' }), 0)!;
    expect(view.variant).toBe('giveaway');
    expect(view.state.rules.mode).toBe('giveaway');
    expect(legalMoves(view.state, RED).map((m) => m.captured !== 0)).toEqual([true]);
    const asChess = readSnapshot(serialize(FORCED))!; // what the screens did before: Chess rules
    expect(legalMoves(asChess, RED).some((m) => m.captured === 0)).toBe(true);
  });

  it('no variant (an older server) is 4 Player Chess; an unknown variant builds no view at all', () => {
    const chess = viewFromMatch(matchOf(initialState(FFA_RULES), RED), 0)!;
    expect(chess.variant).toBe('ffa');
    expect(chess.state.rules.mode).toBe('ffa');
    expect(viewFromMatch(matchOf(initialState(FFA_RULES), RED, { variant: 'bughouse' as never }), 0)).toBeNull();
    expect(viewFromRoom(roomOf(FORCED, { variant: 'giveaway' }), null, 0)!.variant).toBe('giveaway'); // a spectator\'s view too
  });

  it('every later snapshot is adopted with the same rules (applyFourState)', () => {
    const view = viewFromMatch(matchOf(gp(KINGS, { turn: RED }), RED, { variant: 'giveaway' }), 0)!;
    const next = applyFourState(view, statePayload(FORCED, 1), 1);
    expect(next.outcome).toBe('applied');
    expect(next.view.state.rules.mode).toBe('giveaway');
    expect(legalMoves(next.view.state, RED).every((m) => m.captured !== 0)).toBe(true);
  });

  it('a rejoin / spectate answer must name the same game: a different or unknown variant is refused, a Chess answer without a variant fits a Chess view', () => {
    const view = viewFromMatch(matchOf(FORCED, RED, { variant: 'giveaway' }), 0)!;
    const adopted = adoptSnapshot(view, roomOf(FORCED, { variant: 'giveaway', seq: 3 }), 1);
    expect(adopted.outcome).toBe('adopted');
    expect(adopted.view.state.rules.mode).toBe('giveaway'); // the rejoin answer is read with the room's rules, not the Chess ones
    expect(legalMoves(adopted.view.state, RED).every((m) => m.captured !== 0)).toBe(true);
    expect(adoptSnapshot(view, roomOf(FORCED, { variant: 'ffa', seq: 3 }), 1).outcome).toBe('invalid');
    expect(adoptSnapshot(view, roomOf(FORCED, { seq: 3 }), 1).outcome).toBe('invalid'); // a server that dropped the field mid-game
    expect(adoptSnapshot(view, roomOf(FORCED, { variant: 'x' as never, seq: 3 }), 1).outcome).toBe('invalid');
    const chess = viewFromMatch(matchOf(initialState(FFA_RULES), RED), 0)!;
    expect(adoptSnapshot(chess, roomOf(initialState(FFA_RULES), { seq: 3 }), 1).outcome).toBe('adopted');
    expect(adoptSnapshot(chess, roomOf(initialState(FFA_RULES), { variant: 'giveaway', seq: 3 }), 1).outcome).toBe('invalid');
  });

  it('the final snapshot of a game over is read with the room\'s rules too (the result survives the round trip)', () => {
    const finished: FourPlayerState = playMove(gp(['rR@e5', 'gP@m5', 'rK@h1', 'bK@a8', 'yK@g14'], { turn: RED }), findLegalMove(gp(['rR@e5', 'gP@m5', 'rK@h1', 'bK@a8', 'yK@g14'], { turn: RED }), RED, sq('e5'), sq('m5'))!, first).state;
    expect(finished.result?.reason).toBe('outOfPieces');
    const view = viewFromMatch(matchOf(gp(KINGS), RED, { variant: 'giveaway' }), 0)!;
    const over: FourGameOverPayload = { roomId: 'room', reason: 'outOfPieces', winners: [GREEN], scores: [2, 1, 1, 0], state: serialize(finished) };
    const out = applyGameOver(view, over);
    expect(out.gameOver).toEqual(over);
    expect(out.state.result).toEqual(finished.result);
    expect(out.state.rules.mode).toBe('giveaway');
  });
});

describe('a whole Giveaway game through the online reducer', () => {
  // A tiny server simulator on the real engine (as the Chess lockstep test uses): every payload is exactly what the server would send.
  function playThrough(seed: number): { plies: number; reason: string | undefined; walls: number } {
    let a = seed | 0;
    const rng = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let server = initialState(GIVEAWAY_RULES);
    let seq = 0;
    let view = viewFromMatch(matchOf(server, RED, { variant: 'giveaway' }), 0)!;
    let walls = 0;
    while (!server.result && seq < 600) {
      let payload: FourStatePayload;
      if (seq === 8 && server.status[GREEN] === 'active') {
        server = resign(server, GREEN, rng).state; // an off-turn resignation: its pieces become walls
        walls++;
        payload = { ...statePayload(server, ++seq), actor: 'resign' };
      } else {
        const move = chooseBotMoveFor(server, 1200, rng)!;
        const mover = server.turn;
        server = playMove(server, move, rng).state;
        payload = { ...statePayload(server, ++seq), actor: 'bot', move: { seat: mover, from: squareName(move.from), to: squareName(move.to), label: moveLabel(move) } };
      }
      const out = applyFourState(view, payload, seq);
      expect(out.outcome, `seed ${seed} seq ${seq}`).toBe('applied');
      view = out.view;
      expect(serialize(view.state), `seed ${seed} seq ${seq}`).toBe(serialize(server));
      expect(view.state.rules.mode).toBe('giveaway');
    }
    return { plies: seq, reason: server.result?.reason, walls };
  }

  it('the client position equals the server\'s after every state of full Giveaway games, resignations (walls) included', () => {
    let total = 0;
    let walls = 0;
    const reasons = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = playThrough(seed);
      total += r.plies;
      walls += r.walls;
      if (r.reason) reasons.add(r.reason);
    }
    expect(total).toBeGreaterThan(300);
    expect(walls).toBeGreaterThan(0);
    expect(reasons.size).toBeGreaterThan(0);
  });

  it('the optimistic move of a forced capture is shown at once, kept beside the authority, and a refusal rolls it back', () => {
    const view = viewFromMatch(matchOf(FORCED, RED, { variant: 'giveaway' }), 0)!;
    const capture = findLegalMove(view.state, RED, sq('d5'), sq('d9'))!;
    const begun = beginMove(view, capture);
    expect(begun.id).not.toBeNull();
    expect(displayState(begun.view).cells[sq('d9')]).toBe(view.state.cells[sq('d5')]); // the rook is drawn on d9 straight away
    expect(begun.view.state).toBe(view.state); // the authority is untouched
    const refused = moveRejected(begun.view, begun.id!, 'Illegal move.');
    expect(refused.rolledBack).toBe(true);
    expect(displayState(refused.view)).toBe(view.state);
  });
});

describe('the online status line', () => {
  const viewOf = (variant: 'ffa' | 'giveaway', state: FourPlayerState, mySeat: Seat): FourOnlineView => viewFromMatch(matchOf(state, mySeat, { variant }), 0)!;

  it('Giveaway: "Your move — must capture" when a capture is forced, and never "in check"', () => {
    expect(describeStatus(viewOf('giveaway', FORCED, RED))).toBe('Your move — must capture');
    const other = gp(['rR@d5', 'bP@d9', ...KINGS], { turn: BLUE });
    expect(describeStatus(viewOf('giveaway', other, RED))).toBe('Blue (P1) to move');
    expect(describeStatus(viewOf('giveaway', gp(['rK@h1', 'bR@d1', 'bK@a8', 'yK@g14', 'gK@n7'], { turn: RED }), RED))).toBe('Your move');
  });

  it('Chess keeps "in check!" exactly as before', () => {
    const check = stateFromPieces(['rK@h1', 'bR@d1', 'bK@a8', 'yK@g14', 'gK@n7'], { turn: RED });
    expect(describeStatus(viewOf('ffa', check, RED))).toBe('Your move — in check!');
    expect(describeStatus(viewOf('ffa', check, BLUE))).toBe('Red (P0) to move — in check!');
  });
});

describe('asking for a variant, and checking that is what we got (decision D15)', () => {
  const tc = { initialSeconds: 300, incrementSeconds: 3, label: '5 | 3' };

  it('a Chess request is byte-for-byte what every released client sends; only a Giveaway request carries the variant', () => {
    expect(joinQueueRequest(tc, 'ffa')).toEqual({ timeControl: { initialSeconds: 300, incrementSeconds: 3 }, timeControlLabel: '5 | 3' });
    expect('variant' in joinQueueRequest(tc, 'ffa')).toBe(false);
    expect(joinQueueRequest(tc, 'giveaway')).toEqual({ timeControl: { initialSeconds: 300, incrementSeconds: 3 }, timeControlLabel: '5 | 3', variant: 'giveaway' });
    expect(validateFourJoinQueue(joinQueueRequest(tc, 'giveaway'))).toEqual({ ok: true, value: { timeControl: { initialSeconds: 300, incrementSeconds: 3 }, timeControlLabel: '5 | 3', variant: 'giveaway' } });
    expect(validateFourJoinQueue(joinQueueRequest(tc, 'ffa'))).toMatchObject({ ok: true });
  });

  it('the match is accepted only when it names the game that was asked for (a missing field means Chess)', () => {
    expect(checkMatchVariant('giveaway', { variant: 'giveaway' })).toEqual({ ok: true });
    expect(checkMatchVariant('ffa', { variant: 'ffa' })).toEqual({ ok: true });
    expect(checkMatchVariant('ffa', {})).toEqual({ ok: true }); // an older server only has Chess
    const old = checkMatchVariant('giveaway', {}); // ...and so a Giveaway request answered without an echo is an older server that started a Chess game
    expect(old.ok).toBe(false);
    expect(!old.ok && old.error).toMatch(/does not support 4 Player Giveaway/);
    expect(checkMatchVariant('giveaway', { variant: 'ffa' }).ok).toBe(false);
    expect(checkMatchVariant('ffa', { variant: 'giveaway' }).ok).toBe(false);
    expect(checkMatchVariant('giveaway', { variant: 'bughouse' as never }).ok).toBe(false);
    expect(checkMatchVariant('ffa', { variant: null as never }).ok).toBe(false);
  });
});

describe('the Spectate list tags each game with its variant', () => {
  const game = (roomId: string, variant?: 'ffa' | 'giveaway') => ({ roomId, ...(variant ? { variant } : {}), timeControlLabel: '5 min', seats: [] as { name: string; kind: 'human' | 'bot' }[] });

  it('Chess games (and an older server\'s, with no variant) under "4 Player Chess", Giveaway games under their own header, 2-player games last', () => {
    const rows = buildSpectateRows([{ roomId: 't1' } as never], [game('a', 'ffa'), game('b', 'giveaway'), game('c'), game('d', 'giveaway')]);
    expect(rows.map((r) => (r.kind === 'header' ? `# ${r.title}` : r.key))).toEqual(['# 4 Player Chess', 'four:a', 'four:c', '# 4 Player Giveaway', 'four:b', 'four:d', '# Head to head', 'two:t1']);
  });

  it('a game of a variant this client does not know is not listed at all (not under the Chess header)', () => {
    const rows = buildSpectateRows([], [game('a', 'ffa'), { ...game('x'), variant: 'teams' as never }]);
    expect(rows.map((r) => r.key)).toEqual(['header:four', 'four:a']);
    expect(buildSpectateRows([], [{ ...game('x'), variant: 'teams' as never }])).toEqual([]);
  });

  it('a section appears only when it has games, and the keys of the Chess section are the ones they always were', () => {
    expect(buildSpectateRows([], [game('b', 'giveaway')]).map((r) => r.key)).toEqual(['header:fourGiveaway', 'four:b']);
    expect(buildSpectateRows([], [game('a')]).map((r) => r.key)).toEqual(['header:four', 'four:a']);
    expect(buildSpectateRows([], null)).toEqual([]);
  });
});

// --- Premove, Undo ----------------------------------------------------------------------------------------------------------------------------

describe('premove and Undo meet the forced capture (the local game\'s mechanisms)', () => {
  it('a premove that was legal when queued is cancelled once a forced capture has made it illegal', () => {
    // Red queued rook d5-d4 (a quiet move). By the time Red's turn is back, Blue has a pawn on d9 in the rook's line: the capture is forced, d5-d4 is not legal.
    const queued = { from: sq('d5'), to: sq('d4') };
    const quiet = gp(['rR@d5', ...KINGS], { turn: RED });
    expect(resolvePremove(quiet, RED, queued)).not.toBeNull(); // legal in the position it was queued in
    expect(resolvePremove(FORCED, RED, queued)).toBeNull(); // ...cancelled now ("no longer legal")
    expect(resolvePremove(FORCED, RED, { from: sq('d5'), to: sq('d9') })).not.toBeNull(); // the capture itself is a fine premove
  });

  it('Undo across a forced capture: the earlier position is untouched by the capture and offers the same forced capture again', () => {
    const before = FORCED;
    const cells = Array.from(before.cells);
    const capture = findLegalMove(before, RED, sq('d5'), sq('d9'))!;
    const after = playMove(before, capture, first).state;
    expect(Array.from(before.cells)).toEqual(cells); // immutable states: a stack of them IS the undo
    expect(after.cells).not.toBe(before.cells);
    // "Undo" = show the earlier state again
    expect(legalMoves(before, RED).map((m) => m.captured !== 0)).toEqual([true]);
    expect(serialize(before)).toBe(serialize(FORCED));
  });
});

// --- Source pins for the screens ----------------------------------------------------------------------------------------------------------

describe('screens: the Giveaway flow is wired through the same screens (no renderer available)', () => {
  const SRC = join(__dirname, '../..');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');
  const app = readFileSync(join(SRC, '../App.tsx'), 'utf8').replace(/\r\n/g, '\n');

  it('the Play menu has a 4 Player Giveaway card under the 4 Player Chess one: Local, and Online behind the login gate', () => {
    const menu = read('screens/PlayModeSelectScreen.tsx');
    expect(menu).toContain('<Text style={styles.categoryTitle}>4 Player Giveaway</Text>');
    expect(menu.indexOf('4 Player Chess</Text>')).toBeLessThan(menu.indexOf('4 Player Giveaway</Text>'));
    expect(menu).toContain('const handleFourPlayerGiveawayOnline = requireLogin(onFourPlayerGiveawayOnline);');
    expect(menu).toContain('onPress={onFourPlayerGiveaway}');
    expect(menu).toContain('onPress={handleFourPlayerGiveawayOnline}');
    expect(menu).toContain('label="Local"');
    // the Chess card is as it was
    expect(menu.match(/label="Free-for-All"/g)).toHaveLength(1);
    expect(menu).toContain('onPress={onFourPlayer}');
    expect(menu).toContain('onPress={handleFourPlayerOnline}');
  });

  it('App.tsx: Giveaway local goes setup -> bot picker -> time control (no Daily) -> game with variant "giveaway"; online goes time control (no Daily / unlimited) -> queue', () => {
    expect(app).toContain("onFourPlayerGiveaway={() => setScreen({ name: 'fourPlayerSetup', variant: 'giveaway', seats: defaultSeatConfig() })}");
    expect(app).toContain("onFourPlayerGiveawayOnline={() => authSession && setScreen({ name: 'fourPlayerOnlineTimeControl', variant: 'giveaway', token: authSession.token })}");
    expect(app).toContain("| { name: 'fourPlayerOnlineTimeControl'; variant: FourVariant; token: string }");
    expect(app).toContain("| { name: 'fourPlayerMatchmaking'; variant: FourVariant; token: string; timeControl: TimeControl }");
    expect(app).toContain('<FourPlayerMatchmakingScreen\n        variant={variant}');
    expect(app).toContain('<FourPlayerSetupScreen\n        variant={variant}');
    expect(app).toContain("onSelect={(timeControl) => setScreen({ name: 'fourPlayerMatchmaking', variant, token, timeControl })}");
    expect(app).toContain("excludeCategories={['daily', 'unlimited']}");
    expect(app).toContain('subtitle={`${variantTitle(variant)} · ${variantModeLabel(variant)}`}');
    // every Chess entry passes 'ffa' explicitly
    expect(app).toContain("onFourPlayer={() => setScreen({ name: 'fourPlayerSetup', variant: 'ffa', seats: defaultSeatConfig() })}");
    expect(app).toContain("onFourPlayerOnline={() => authSession && setScreen({ name: 'fourPlayerOnlineTimeControl', variant: 'ffa', token: authSession.token })}");
  });

  it('the local game: the start rules, the bot and every new game follow the variant; no "in check" in Giveaway', () => {
    const game = read('screens/FourPlayerGameScreen.tsx');
    expect(game.match(/initialState\(rulesFor\(variant\)\)/g)).toHaveLength(2); // the first game and "New Game"
    expect(game).not.toMatch(/\binitialState\(\)/);
    expect(game).toContain('chooseBotMoveFor(game, controller.elo)');
    expect(game).not.toMatch(/isInCheck|chooseBotMove\(/);
    expect(game).toContain('statusSuffix(game, game.turn)');
    expect(game).toContain('<ScreenHeader title={variantTitle(variant)} subtitle={`${variantModeLabel(variant)} · ${timeControl.label}`}');
    expect(game).toContain('rankSeats(variant,');
    expect(game).toContain('describeResultNote(game.result, variant)');
    expect(game).toContain("variant === 'giveaway' ? `${seatMetric(game, seat)} left` : seatMetric(game, seat)");
    expect(game).toContain("export default function FourPlayerGameScreen({ variant = 'ffa',"); // omitted = 4 Player Chess
  });

  it('the board draws check from the variant-aware helper only; the seat card counts through seatMetric', () => {
    const board = read('components/FourPlayerBoard.tsx');
    expect(board).toContain('new Set(checkedKingSquares(state))');
    expect(board).not.toMatch(/\bisInCheck\b/);
    const strip = read('components/FourPlayerSeatStrip.tsx');
    expect(strip).toContain('seatMetricText(state, seat)');
    expect(strip).not.toContain('state.score[seat]');
  });

  it('the shared result card ranks and words its table by the variant it is given (and shows the pieces left as "N left")', () => {
    const card = read('components/FourPlayerResultCard.tsx');
    expect(card).toContain("variant = 'ffa' }: FourPlayerResultCardProps"); // omitted = 4 Player Chess
    expect(card).toContain('resultRows(gameOver, seats, variant)');
    expect(card).toContain('describeFourResultNote(gameOver.reason, variant, gameOver.winners)');
    expect(card).toContain("variant === 'giveaway' ? `${row.score} left` : row.score");
  });

  it('the setup screen takes the variant for its title, intro and rule hint', () => {
    const setup = read('screens/FourPlayerSetupScreen.tsx');
    expect(setup).toContain("export default function FourPlayerSetupScreen({ variant = 'ffa',");
    expect(setup).toContain('<ScreenHeader title={variantTitle(variant)} subtitle={variantModeLabel(variant)}');
    expect(setup).toContain('{variantIntro(variant)}');
    expect(setup).toContain("variant === 'giveaway' && <Text style={styles.intro}>{GIVEAWAY_RULE_HINT}</Text>");
    expect(setup).not.toContain('Checkmate players');
  });

  it('the queue sends the variant only for Giveaway, and refuses a match that does not echo it (resigning the seat it was given)', () => {
    const queue = read('screens/FourPlayerMatchmakingScreen.tsx');
    expect(queue).toContain('validateFourJoinQueue(joinQueueRequest(timeControl, variant))');
    const found = queue.slice(queue.indexOf('const handleMatchFound'), queue.indexOf('const rejoinQueueOnReconnect'));
    expect(found.indexOf('checkMatchVariant(variant, payload)')).toBeGreaterThan(-1);
    expect(found.indexOf("socket.emit('four_resign', { roomId: payload.roomId })")).toBeGreaterThan(found.indexOf('checkMatchVariant'));
    expect(found.indexOf('onMatchFound(payload)')).toBeGreaterThan(found.indexOf("socket.emit('four_resign'")); // the hand-over comes only after the check
    expect(found).toContain('return;');
    expect(queue).toContain('{variantTitle(variant)} · {timeControl.label}');
    expect(queue).toContain("variant === 'giveaway' && !error && <Text style={styles.queueDetail}>{GIVEAWAY_RULE_HINT}</Text>");
  });

  it('the online game and the spectator title themselves by the room\'s variant and rank their result card by it', () => {
    const online = read('screens/FourPlayerOnlineGameScreen.tsx');
    expect(online).toContain('title={variantTitle(view.variant)}');
    expect(online).toContain('title={variantTitle(fourVariantOf(match))}'); // the loading header, before a view exists
    expect(online).toContain('<FourPlayerResultCard gameOver={view.gameOver} seats={view.seats} variant={view.variant} />');
    const spectator = read('screens/FourPlayerSpectatorScreen.tsx');
    expect(spectator).toContain('subtitle={`${variantTitle(view.variant)} · ${view.timeControlLabel}`}');
    expect(spectator).toContain('<FourPlayerResultCard gameOver={view.gameOver} seats={view.seats} variant={view.variant} />');
  });

  it('local screens still know nothing of the online files, and the variant type lives in the engine', () => {
    for (const file of ['screens/FourPlayerGameScreen.tsx', 'screens/FourPlayerSetupScreen.tsx']) {
      expect(read(file), file).not.toMatch(/fourPlayerOnline|FourPlayerOnline|api\/socket|fourPlayerWire/);
    }
    expect(read('logic/fourPlayer/state.ts')).toContain("export type FourVariant = 'ffa' | 'giveaway' | 'chaturaji';"); // Chaturaji W1 added the third value
    expect(read('logic/fourPlayerWire.ts')).toContain('export type { FourVariant };');
  });
});
