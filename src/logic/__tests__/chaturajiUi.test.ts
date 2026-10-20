import { describe, expect, it } from 'vitest';
import { CHATURAJI_RULES, SEAT_NAMES, legalMoves, listPieces, playMove, resign, type FourPlayerState, type Seat } from '../fourPlayer';
import {
  KING_ATTACKED_PILL,
  chaturajiRulesSheet,
  chaturajiResultRows,
  describeGain,
  formatGain,
  lastStandingBonus,
  scoreGains,
  seatStatusOf,
  showKingAttackedPill,
} from '../chaturajiUi';
import { NO_BONUS_RULES, cp, findMove, label, playGame } from './chaturajiKit';

/**
 * CHATURAJI W3 - the pure logic behind the screens (src/logic/chaturajiUi.ts): the "+N" at a seat, the status of a seat, the final table with its points breakdown, and the
 * rules sheet. The points are the ENGINE's: every figure below is read off a real `playMove`, never typed from the rules text, and the rules sheet is checked against what the
 * engine actually pays.
 */
const RED = 0 as Seat;
const BLUE = 1 as Seat;
const YELLOW = 2 as Seat;
const GREEN = 3 as Seat;
const KINGS = ['rK@a1', 'bK@a8', 'yK@h8', 'gK@h1'];

/** What each seat scored when the mover plays `text` in `state`: the gains the screens show. */
const gainsOf = (state: FourPlayerState, text: string) => scoreGains(state.score, playMove(state, findMove(state, text), () => 0).state.score);

describe('the "+N" at a seat is the difference of two engine scores', () => {
  it('a capture is worth the piece: pawn 1, knight 3, bishop 5, boat 5, and a king 3', () => {
    for (const [piece, points] of [['bP', 1], ['bN', 3], ['bB', 5], ['bR', 5]] as const) {
      const state = cp(['rK@a1', 'rR@d4', `${piece}@d6`, 'bK@a8', 'yK@h8', 'gK@h1'], { turn: RED });
      expect(gainsOf(state, 'd4xd6'), piece).toEqual([{ seat: RED, points }]);
    }
    const king = cp(['rK@a1', 'rR@d4', 'bK@d6', 'yK@h8', 'gK@h1'], { turn: RED });
    expect(gainsOf(king, 'd4xd6')).toEqual([{ seat: RED, points: 3 }]);
  });

  it('a check fork is +1 for two kings and +5 for three, and a quiet move scores nothing', () => {
    const two = cp(['rK@a1', 'rN@c5', 'bK@d6', 'yK@f6', 'gK@h1', 'rP@a2'], { turn: RED });
    expect(gainsOf(two, 'c5-e4')).toEqual([{ seat: RED, points: 1 }]);
    expect(gainsOf(two, 'a2-a3')).toEqual([]);
    const three = cp(['rK@a1', 'rN@f3', 'bK@b5', 'yK@c6', 'gK@e6'], { turn: RED });
    expect(gainsOf(three, 'f3-d4')).toEqual([{ seat: RED, points: 5 }]);
  });

  it('a capture that also forks scores both, as one gain at the seat', () => {
    const state = cp(['rK@a1', 'rN@c5', 'bP@e4', 'bK@d6', 'yK@f6', 'gK@h1'], { turn: RED });
    expect(gainsOf(state, 'c5xe4')).toEqual([{ seat: RED, points: 2 }]);
  });

  it('capturing a dead (eliminated) piece scores nothing, so nothing is shown', () => {
    const state = cp(['rK@a1', 'rR@d4', 'bP@d6', 'bK@a8', 'yK@h8', 'gK@h1'], { turn: RED, status: ['active', 'frozen', 'active', 'active'] });
    expect(gainsOf(state, 'd4xd6')).toEqual([]);
  });

  it('the last move of a game that ends with kings left on the board shows the bonus in the same gain: 3 for the king + 3 for each king still walking', () => {
    const state = cp(['rK@a1', 'rR@d4', 'bK@a8', 'yK@h8', 'gK@d8'], { turn: RED, status: ['active', 'dead-king', 'dead-king', 'active'] });
    const next = playMove(state, findMove(state, 'd4xd8'), () => 0).state;
    expect(next.result?.reason).toBe('elimination');
    expect(scoreGains(state.score, next.score)).toEqual([{ seat: RED, points: 9 }]);
  });

  it('only increases count, the order is by seat, and the label and the sentence read well', () => {
    expect(scoreGains([5, 0, 3, 3], [5, 1, 6, 2])).toEqual([{ seat: BLUE, points: 1 }, { seat: YELLOW, points: 3 }]); // a decrease is ignored
    expect(scoreGains([0, 0, 0, 0], [0, 0, 0, 0])).toEqual([]);
    expect(formatGain(3)).toBe('+3');
    expect(describeGain({ seat: GREEN, points: 1 })).toBe('Green scored 1 point');
    expect(describeGain({ seat: RED, points: 5 })).toBe('Red scored 5 points');
  });
});

describe('the status of a seat is what the engine says', () => {
  it('playing, attacked (a threat, not a check), walking king, out - and nothing is "attacked" once the game is over', () => {
    const attacked = cp(['rK@d1', 'bR@d8', 'bK@a8', 'yK@h8', 'gK@h1'], { turn: RED });
    expect(seatStatusOf(attacked, RED)).toEqual({ kind: 'attacked', text: 'king attacked' });
    expect(seatStatusOf(attacked, BLUE)).toEqual({ kind: 'active', text: null });
    const mixed = cp([...KINGS, 'rP@a2'], { turn: RED, status: ['active', 'dead-king', 'frozen', 'active'] });
    expect(seatStatusOf(mixed, BLUE)).toEqual({ kind: 'walking', text: 'king walking' });
    expect(seatStatusOf(mixed, YELLOW)).toEqual({ kind: 'out', text: 'out' });
    expect(seatStatusOf(mixed, RED)).toEqual({ kind: 'active', text: null });
    // the game ends at the ply cap with Yellow's boat still aiming at Red's king: a live rival attacks it, and still nothing is announced once the game is over
    const over = cp(['rK@a1', 'rR@d4', 'bK@d8', 'yK@h8', 'yR@a8', 'gK@h1'], { turn: RED, ply: 999 });
    expect(seatStatusOf(over, RED).kind).toBe('attacked'); // before the last move it is announced
    const ended = playMove(over, findMove(over, 'd4xd8'), () => 0).state;
    expect(ended.result?.reason).toBe('cap');
    for (const seat of [RED, BLUE, YELLOW, GREEN] as Seat[]) expect(seatStatusOf(ended, seat).kind, `seat ${seat}`).not.toBe('attacked');
  });

  it('an attacked king is attacked by a LIVE rival only: an eliminated seat\'s boat is a wall, not a threat', () => {
    const state = cp(['rK@d1', 'bR@d8', 'bK@a8', 'yK@h8', 'gK@h1'], { turn: RED, status: ['active', 'frozen', 'active', 'active'] });
    expect(seatStatusOf(state, RED).kind).toBe('active');
  });

  it('the pill shows for the viewer\'s own attacked king only, and says nothing about having to answer', () => {
    const state = cp(['rK@d1', 'bR@d8', 'bK@a8', 'yK@h8', 'gK@h1'], { turn: BLUE });
    expect(showKingAttackedPill(state, RED)).toBe(true);
    expect(showKingAttackedPill(state, BLUE)).toBe(false);
    expect(showKingAttackedPill(state, null)).toBe(false); // a spectator
    expect(KING_ATTACKED_PILL).toMatch(/can be captured/);
    expect(KING_ATTACKED_PILL).not.toMatch(/must|move out|get out|escape|illegal/i);
  });
});

describe('the final table and its breakdown', () => {
  it('ranks by points (ties by seat), marks the winners and shows where the last seat standing\'s points came from', () => {
    const state = cp(['rK@a1', 'rR@d4', 'bK@a8', 'yK@h8', 'gK@d8'], { turn: RED, status: ['active', 'dead-king', 'dead-king', 'active'], score: [2, 0, 0, 4] });
    const final = playMove(state, findMove(state, 'd4xd8'), () => 0).state;
    const rows = chaturajiResultRows(final, final.score, final.result!.winners, final.result!.reason);
    expect(rows.map((r) => [r.place, r.seat, r.total, r.bonus, r.fromPlay, r.winner])).toEqual([
      [1, RED, 11, 6, 5, true], // 2 + 3 for the king + 6 for the two walking kings
      [2, GREEN, 4, 0, 4, false],
      [3, BLUE, 0, 0, 0, false],
      [4, YELLOW, 0, 0, 0, false],
    ]);
    expect(rows[0].detail).toBe('11 points — 5 from play + 6 for 2 kings left');
    expect(rows[1].detail).toBe('4 points');
    expect(rows[3].detail).toBe('0 points');
  });

  it('the winner is by points, not by survival: the last seat standing can lose', () => {
    const state = cp(['rK@a1', 'rR@d4', 'gK@d8'], { turn: RED, status: ['active', 'frozen', 'frozen', 'active'], score: [0, 0, 0, 20] });
    const final = playMove(state, findMove(state, 'd4xd8'), () => 0).state;
    const rows = chaturajiResultRows(final, final.score, final.result!.winners, final.result!.reason);
    expect(final.result!.winners).toEqual([GREEN]);
    expect(rows[0]).toMatchObject({ seat: GREEN, winner: true, total: 20 });
    expect(rows.find((r) => r.seat === RED)).toMatchObject({ winner: false, total: 3, bonus: 0 }); // no king left to pay the bonus for
  });

  it('a tie is shared and listed by seat; "1 king" and "1 point" are singular', () => {
    const state = cp(['rK@a1', 'bK@a8'], { status: ['active', 'dead-king', 'frozen', 'frozen'], score: [4, 0, 0, 0] });
    const rows = chaturajiResultRows({ ...state, status: ['active', 'dead-king', 'frozen', 'frozen'] }, [4, 4, 0, 0], [RED, BLUE], 'cap');
    expect(rows.map((r) => [r.seat, r.winner])).toEqual([[RED, true], [BLUE, true], [YELLOW, false], [GREEN, false]]);
    const one = cp(['rK@a1', 'bK@a8'], { status: ['active', 'dead-king', 'frozen', 'frozen'], score: [1, 0, 0, 0] });
    const solo = chaturajiResultRows(one, [4, 0, 0, 0], [RED], 'elimination');
    expect(solo[0]).toMatchObject({ bonus: 3, fromPlay: 1 });
    expect(solo[0].detail).toBe('4 points — 1 from play + 3 for 1 king left');
  });

  it('no bonus at the cap, none for a seat that is not alone, none when no king is left', () => {
    const state = cp(['rK@a1', 'bK@a8', 'yK@h8'], { status: ['active', 'dead-king', 'active', 'frozen'] });
    expect(lastStandingBonus(state, 'cap')).toBeNull(); // the cap pays nothing
    expect(lastStandingBonus(state, 'elimination')).toBeNull(); // two seats still active
    const alone = cp(['rK@a1', 'bK@a8', 'yK@h8'], { status: ['active', 'dead-king', 'dead-king', 'frozen'] });
    expect(lastStandingBonus(alone, 'elimination')).toEqual({ seat: RED, kings: 2, points: 6 });
    const none = cp(['rK@a1'], { status: ['active', 'frozen', 'frozen', 'frozen'] });
    expect(lastStandingBonus(none, 'elimination')).toBeNull();
    const abandoned = cp(['rK@a1', 'bK@a8'], { status: ['active', 'dead-king', 'frozen', 'frozen'] });
    expect(lastStandingBonus(abandoned, 'abandoned')).toBeNull();
  });

  it('PROPERTY: on whole seeded games the bonus the table reports is exactly what the ENGINE paid (the same game replayed with the bonus switched off), and nothing else differs', () => {
    let withBonus = 0;
    let withoutResult = 0;
    for (let seed = 1; seed <= 36; seed++) {
      const game = playGame(seed, [
        { ply: 6 + (seed % 7), seat: BLUE },
        { ply: 16 + (seed % 9), seat: YELLOW },
        ...(seed % 3 === 0 ? [{ ply: 30 + (seed % 11), seat: GREEN as Seat }] : []),
      ]);
      const final = game.positions[game.positions.length - 1];
      const twin = game.withoutBonus;
      expect(final.result, `seed ${seed}`).not.toBeNull();
      expect(twin.result?.reason, `seed ${seed}: the twin ends the same way`).toBe(final.result!.reason);
      // EQUIVALENT-MUTANT PREMISE (W5 mutation re-run, "the bonus for every seat, not only the last": `last.length === 1` -> `>= 1` in elimination.ts endGame): an 'elimination' ending is
      // only ever reached with AT MOST ONE active seat (the one caller is `activeSeats(state).length <= 1`), so the two conditions cannot differ. This pins the premise on whole games.
      if (final.result!.reason === 'elimination') expect(final.status.filter((s) => s === 'active').length, `seed ${seed}: an elimination ending leaves at most one active seat`).toBeLessThanOrEqual(1);
      const rows = chaturajiResultRows(final, final.score, final.result!.winners, final.result!.reason);
      for (const row of rows) {
        const engineBonus = final.score[row.seat] - twin.score[row.seat];
        expect(row.bonus, `seed ${seed}, ${SEAT_NAMES[row.seat]}`).toBe(engineBonus);
        expect(row.fromPlay + row.bonus).toBe(row.total);
      }
      if (rows.some((r) => r.bonus > 0)) withBonus++;
      else withoutResult++;
    }
    expect(withBonus, 'the property saw games that pay a bonus').toBeGreaterThanOrEqual(6);
    expect(withoutResult, 'and games that do not').toBeGreaterThanOrEqual(1);
  });
});

describe('the rules sheet says what the engine does', () => {
  const text = chaturajiRulesSheet()
    .flatMap((s) => s.lines)
    .join('\n');

  it('its capture values are what a capture really scores', () => {
    const m = /Pawn (\d+) · Knight (\d+) · King (\d+) · Bishop (\d+) · Boat (\d+)/.exec(text);
    expect(m, 'the points line is there').not.toBeNull();
    const sheet = { bP: Number(m![1]), bN: Number(m![2]), bK: Number(m![3]), bB: Number(m![4]), bR: Number(m![5]) };
    for (const [piece, points] of Object.entries(sheet)) {
      const state = cp(['rK@a1', 'rR@d4', `${piece}@d6`, 'yK@h8', 'gK@h1', ...(piece === 'bK' ? [] : ['bK@a8'])], { turn: RED }); // Blue's king is the victim itself when the piece is one
      expect(gainsOf(state, 'd4xd6'), piece).toEqual([{ seat: RED, points }]);
    }
  });

  it('its fork and bonus values are what the engine pays', () => {
    const two = /two kings with one piece: \+(\d+)/.exec(text);
    const three = /three: \+(\d+)/.exec(text);
    const bonus = /scores \+(\d+) for every other king/.exec(text);
    expect([two, three, bonus].every((x) => x !== null)).toBe(true);
    expect(gainsOf(cp(['rK@a1', 'rN@c5', 'bK@d6', 'yK@f6', 'gK@h1'], { turn: RED }), 'c5-e4')).toEqual([{ seat: RED, points: Number(two![1]) }]);
    expect(gainsOf(cp(['rK@a1', 'rN@f3', 'bK@b5', 'yK@c6', 'gK@e6'], { turn: RED }), 'f3-d4')).toEqual([{ seat: RED, points: Number(three![1]) }]);
    const state = cp(['rK@a1', 'rR@d4', 'bK@a8', 'yK@h8', 'gK@d8'], { turn: RED, status: ['active', 'dead-king', 'dead-king', 'active'] });
    const final = playMove(state, findMove(state, 'd4xd8'), () => 0).state;
    expect(final.score[RED] - 3 - Number(bonus![1]) * 2).toBe(0); // 3 for the king + the sheet's figure for each of the two walking kings
  });

  it('every figure is read from the rules it is given, each from its own constant (distinct numbers, so no two can be mixed up)', () => {
    const odd = { ...CHATURAJI_RULES, maxPlies: 777, options: { ...CHATURAJI_RULES.options!, kingPoints: 4, forkPoints: { double: 2, triple: 7 }, lastStandingKingBonus: 9 } };
    const oddText = chaturajiRulesSheet(odd).flatMap((s) => s.lines).join('\n');
    expect(oddText).toContain('King 4');
    expect(oddText).toContain('scores 4 points and puts the whole army out');
    expect(oddText).toContain('Attack two kings with one piece: +2. Attack three: +7.');
    expect(oddText).toContain('+9 for every other king');
    expect(oddText).toContain('after 777 moves');
    const noFork = chaturajiRulesSheet({ ...odd, options: { ...odd.options, forkPoints: null } }).flatMap((s) => s.lines).join('\n');
    expect(noFork).not.toMatch(/Attack two kings/);
  });

  it('it names the rules that matter: the order, the boat, Capture the King, no answer to check, the automatic promotion, the walking king, the end', () => {
    expect(text).toContain('Red → Blue → Yellow → Green');
    expect(text).toMatch(/Boat: moves like a rook/);
    expect(text).toMatch(/kings must be captured/);
    expect(text).toMatch(/never has to be answered/);
    expect(text).toMatch(/becomes a boat, automatically/);
    expect(text).toMatch(/king keeps walking/);
    expect(text).toMatch(new RegExp(`after ${CHATURAJI_RULES.maxPlies} moves`));
    expect(chaturajiRulesSheet().map((s) => s.title)).toEqual(['The set-up', 'The pieces', 'Capture the King', 'Points', 'Leaving the game', 'The end']);
  });

  it('everything it says about moves is true in the engine: no double step, a king may stay attacked, a pawn promotes to a boat only', () => {
    const start = cp([...KINGS, 'rP@c2'], { turn: RED });
    expect(findMove(start, 'c2-c3')).toBeDefined();
    expect(() => findMove(start, 'c2-c4')).toThrow(); // there is no double step
    const attacked = cp(['rK@d1', 'rP@a2', 'bR@d8', 'bK@a7', 'yK@h8', 'gK@h1'], { turn: RED });
    expect(findMove(attacked, 'a2-a3')).toBeDefined(); // the attacked king is ignored
    const promoting = cp([...KINGS, 'rP@c7'], { turn: RED });
    const promoted = playMove(promoting, findMove(promoting, 'c7-c8=R'), () => 0).state;
    expect(listPieces(promoted)).toContain('rT@c8'); // a promoted boat (a promoted rook)
    expect(() => findMove(promoting, 'c7-c8=Q')).toThrow();
    expect(legalMoves(promoting, RED).filter((m) => label(m).startsWith('c7-c8')).map(label)).toEqual(['c7-c8=R']); // the only promotion there is
  });
});

describe('the engine is not changed by being asked: replaying under no-bonus rules is the same game', () => {
  it('NO_BONUS_RULES differs from CHATURAJI_RULES in exactly the bonus', () => {
    expect({ ...NO_BONUS_RULES.options, lastStandingKingBonus: CHATURAJI_RULES.options!.lastStandingKingBonus }).toEqual(CHATURAJI_RULES.options);
    expect(NO_BONUS_RULES.options!.lastStandingKingBonus).toBe(0);
    // sanity of the kit: a resignation twin diverges only in score at the end
    const state = cp(KINGS, { turn: RED });
    expect(resign(state, BLUE, () => 0).state.status[BLUE]).toBe('dead-king');
  });
});
