import { describe, expect, it } from 'vitest';
import {
  FFA_RULES,
  HARD_MAX_PLIES,
  applyMoveRaw,
  chooseBotMove,
  eliminateSeat,
  findLegalMove,
  initialState,
  isDeadPosition,
  isInCheck,
  legalMoves,
  listPieces,
  parseSquare,
  playMove,
  resign,
  squareName,
  stateFromPieces,
  type Applied,
  type FourPlayerState,
  type GameEvent,
  type Seat,
} from '../fourPlayer';

const RED = 0;
const BLUE = 1;
const YELLOW = 2;
const GREEN = 3;
const first = () => 0; // an rng that always picks the first candidate

/** The current seat plays from -> to (which must be legal). */
function play(state: FourPlayerState, from: string, to: string, rng: () => number = first): Applied {
  const move = findLegalMove(state, state.turn, parseSquare(from), parseSquare(to));
  if (!move) throw new Error(`illegal in this position: ${from}-${to} for seat ${state.turn} (${listPieces(state).join(' ')})`);
  return playMove(state, move, rng);
}
const eliminations = (events: GameEvent[]) => events.filter((e): e is Extract<GameEvent, { kind: 'eliminated' }> => e.kind === 'eliminated');

describe('turn order and the lazy resolution of checkmate', () => {
  // SCENARIO 1 — a pending mate dissolves when an intervening player removes the threat.
  it('1. a mate against Yellow that Red creates is NOT decided until Yellow\'s turn: Blue, in between, captures the checker and Yellow lives', () => {
    const start = stateFromPieces(['rK@h1', 'rR@d1', 'bK@a8', 'bB@g11', 'yK@h14', 'yP@g13', 'yP@h13', 'yP@i13', 'gK@n7']);
    const afterRed = play(start, 'd1', 'd14');
    // Yellow is checkmated on the board right now — but nothing has been decided: Blue is to move and Yellow is still active.
    expect(afterRed.state.turn).toBe(BLUE);
    expect(afterRed.state.status[YELLOW]).toBe('active');
    expect(isInCheck(afterRed.state, YELLOW)).toBe(true);
    expect(legalMoves(afterRed.state, YELLOW)).toHaveLength(0);
    expect(eliminations(afterRed.events)).toHaveLength(0);
    // Blue captures the rook on d14 with its bishop: the mate is gone.
    const afterBlue = play(afterRed.state, 'g11', 'd14');
    expect(afterBlue.state.turn).toBe(YELLOW);
    expect(afterBlue.state.status).toEqual(['active', 'active', 'active', 'active']);
    expect(isInCheck(afterBlue.state, YELLOW)).toBe(false);
    expect(legalMoves(afterBlue.state, YELLOW).length).toBeGreaterThan(0);
    expect(afterBlue.state.score).toEqual([0, 5, 0, 0]);
    expect(eliminations(afterBlue.events)).toHaveLength(0);
  });

  // SCENARIO 2 — an intervening player delivers the mate: the credit goes to the most recent attacker.
  it('2. Red sets up a mate on Yellow but Blue (who moves before Yellow) also attacks the king: Yellow falls at ITS turn and Blue is credited, not Red', () => {
    const start = stateFromPieces(['rK@h1', 'rR@k1', 'bK@a8', 'bR@d9', 'yK@h14', 'yP@g13', 'yP@h13', 'yP@i13', 'gK@n7']);
    const afterRed = play(start, 'k1', 'k14');
    expect(afterRed.state.status[YELLOW]).toBe('active'); // pending
    const afterBlue = play(afterRed.state, 'd9', 'd14');
    const [mate] = eliminations(afterBlue.events);
    expect(mate).toMatchObject({ seat: YELLOW, reason: 'checkmate', credit: BLUE });
    expect(afterBlue.state.score).toEqual([0, 20, 0, 0]);
    expect(afterBlue.state.status[YELLOW]).toBe('dead-king');
    expect(afterBlue.state.turn).toBe(GREEN); // Yellow's turn was consumed; play moves on to Green
  });

  it('2b. with only Red attacking the king, the same mate credits Red even though Blue moved in between', () => {
    const start = stateFromPieces(['rK@h1', 'rR@k1', 'bK@a8', 'yK@h14', 'yP@g13', 'yP@h13', 'yP@i13', 'gK@n7']);
    const afterBlue = play(play(start, 'k1', 'k14').state, 'a8', 'a7');
    expect(eliminations(afterBlue.events)).toEqual([expect.objectContaining({ seat: YELLOW, reason: 'checkmate', credit: RED })]);
    expect(afterBlue.state.score).toEqual([20, 0, 0, 0]);
  });

  // SCENARIO 3 — eliminating a seat turns its pieces dead, which lifts the checks it was giving.
  it('3. Blue is checkmated at its turn; its rook, which was checking Green, goes dead — Green is no longer in check by the time it moves', () => {
    const start = stateFromPieces(['rK@h1', 'rR@d11', 'bK@a8', 'bP@b7', 'bP@b8', 'bP@b9', 'bR@e7', 'yK@h14', 'gK@n7']);
    expect(isInCheck(start, GREEN)).toBe(true); // Blue's rook attacks the Green king along rank 7
    const afterRed = play(start, 'd11', 'a11');
    expect(eliminations(afterRed.events)).toEqual([expect.objectContaining({ seat: BLUE, reason: 'checkmate', credit: RED })]);
    expect(afterRed.state.turn).toBe(YELLOW); // Blue is skipped
    const afterYellow = play(afterRed.state, 'h14', 'g14');
    expect(afterYellow.state.turn).toBe(GREEN);
    expect(isInCheck(afterYellow.state, GREEN)).toBe(false); // the rook is dead: it blocks, it does not attack
    expect(listPieces(afterYellow.state)).toContain('bR@e7'); // ...but it is still on the board
  });

  // SCENARIO 4 — elimination consumes the turn; the dead king starts walking on a LATER turn.
  it('4. the elimination uses up the eliminated seat\'s turn (no move is made for it), and a king with nowhere to go freezes on its next turn', () => {
    const start = stateFromPieces(['rK@h1', 'rR@d11', 'bK@a8', 'bP@b7', 'bP@b8', 'bP@b9', 'bR@e7', 'yK@h14', 'gK@n7']);
    const afterRed = play(start, 'd11', 'a11');
    expect(afterRed.events.filter((e) => e.kind === 'deadKingMove')).toHaveLength(0);
    expect(afterRed.state.ply).toBe(start.ply + 1); // only Red's move was played
    const afterYellow = play(afterRed.state, 'h14', 'g14');
    const afterGreen = play(afterYellow.state, 'n7', 'n6');
    expect(afterGreen.state.turn).toBe(RED);
    // Red moves; Blue's turn comes round: the dead king is boxed in by its own pawns and the rook's line, so it freezes.
    const afterRed2 = play(afterGreen.state, 'h1', 'h2');
    expect(afterRed2.events.some((e) => e.kind === 'frozen' && e.seat === BLUE)).toBe(true);
    expect(afterRed2.state.status[BLUE]).toBe('frozen');
    expect(afterRed2.state.score).toEqual(afterGreen.state.score); // freezing a dead king scores nothing
  });

  it('4b. a dead king with room to move walks one random legal step to an EMPTY square each time its turn comes round', () => {
    const start = stateFromPieces(['rK@h1', 'rP@e2', 'bK@d8', 'yK@g14', 'gK@n7'], { status: ['active', 'dead-king', 'active', 'active'] });
    const stepped = play(start, 'e2', 'e3', first);
    const walk = stepped.events.find((e) => e.kind === 'deadKingMove');
    expect(walk).toMatchObject({ kind: 'deadKingMove', seat: BLUE });
    if (walk?.kind === 'deadKingMove') {
      expect(walk.move.captured).toBe(0);
      expect(stepped.state.kings[BLUE]).toBe(walk.move.to);
    }
    expect(stepped.state.turn).toBe(YELLOW); // the walk did not stop the turn from moving on to the next live seat
    // A different rng picks a different step (the choice really is random, not fixed).
    const other = play(start, 'e2', 'e3', () => 0.99).events.find((e) => e.kind === 'deadKingMove');
    expect(other?.kind === 'deadKingMove' && walk?.kind === 'deadKingMove' ? other.move.to !== walk.move.to : false).toBe(true);
  });

  // SCENARIO 5 — one move mates two seats; each falls at its own turn, both credited to the mover.
  it('5. a single Red knight move checkmates Blue AND Yellow; both are eliminated, in turn order, +20 each, and play passes to Green', () => {
    const start = stateFromPieces([
      'rK@h1', 'rN@e9',
      'bK@a11', 'bN@a10', 'bN@b10', 'bR@b11',
      'yK@d12', 'yN@c11', 'yN@d11', 'yN@d13', 'yB@e11', 'yN@e12', 'yN@e13',
      'gK@n7',
    ]);
    expect(isInCheck(start, BLUE)).toBe(false);
    expect(isInCheck(start, YELLOW)).toBe(false);
    const result = play(start, 'e9', 'c10');
    expect(eliminations(result.events).map((e) => [e.seat, e.reason, e.credit])).toEqual([
      [BLUE, 'checkmate', RED],
      [YELLOW, 'checkmate', RED],
    ]);
    expect(result.state.score[RED]).toBe(40);
    expect(result.state.status).toEqual(['active', 'dead-king', 'dead-king', 'active']);
    expect(result.state.turn).toBe(GREEN);
    expect(result.state.result).toBeNull(); // two seats are still active
  });

  // SCENARIO 6 — stalemate.
  it('6. a stalemated seat is eliminated at its turn: it scores +20 and every other active seat +10', () => {
    const start = stateFromPieces(['rK@h1', 'rR@e10', 'rR@m4', 'bK@a8', 'yK@g14', 'gK@n11'], { turn: YELLOW });
    expect(isInCheck(start, GREEN)).toBe(false);
    expect(legalMoves(start, GREEN)).toHaveLength(0); // boxed in, not in check
    const afterYellow = play(start, 'g14', 'g13');
    expect(eliminations(afterYellow.events)).toEqual([expect.objectContaining({ seat: GREEN, reason: 'stalemate', credit: null })]);
    expect(afterYellow.state.score).toEqual([10, 10, 10, 20]);
    expect(afterYellow.state.status[GREEN]).toBe('dead-king');
    expect(afterYellow.state.turn).toBe(RED);
  });

  // SCENARIO 7 — the game ends, mid-cycle, the moment the third seat is eliminated; the winner is the highest SCORE, not the survivor.
  it('7. the third elimination ends the game at once (dead kings still walk on the way); the winner is the highest score of all four', () => {
    const pieces = ['rK@h1', 'rN@k8', 'bK@a8', 'yK@g14', 'gK@n11', 'gN@n10', 'gN@m10', 'gN@m11'];
    const base = { turn: RED as Seat, status: ['active', 'dead-king', 'dead-king', 'active'] as const };
    const survivorWins = play(stateFromPieces(pieces, { ...base, status: [...base.status], score: [10, 3, 4, 2] }), 'k8', 'm9');
    expect(eliminations(survivorWins.events)).toEqual([expect.objectContaining({ seat: GREEN, reason: 'checkmate', credit: RED })]);
    expect(survivorWins.state.result).toEqual({ winners: [RED], reason: 'elimination' });
    expect(survivorWins.state.status).toEqual(['active', 'dead-king', 'dead-king', 'dead-king']);
    expect(survivorWins.events.filter((e) => e.kind === 'deadKingMove')).toHaveLength(2); // Blue's and Yellow's kings still took their steps first
    expect(survivorWins.events[survivorWins.events.length - 1].kind).toBe('gameOver');
    // Blue is ahead on points although it is dead: Blue wins.
    const deadWins = play(stateFromPieces(pieces, { ...base, status: [...base.status], score: [10, 50, 4, 2] }), 'k8', 'm9');
    expect(deadWins.state.result?.winners).toEqual([BLUE]);
    // A tie is shared.
    const tie = play(stateFromPieces(pieces, { ...base, status: [...base.status], score: [10, 30, 4, 2] }), 'k8', 'm9');
    expect(tie.state.result?.winners).toEqual([RED, BLUE]);
    // After the game is over nothing more happens.
    expect(playMove(survivorWins.state, legalMoves({ ...survivorWins.state, result: null }, RED)[0]).events).toEqual([]);
  });

  // SCENARIO 8 — dead pieces: block, are capturable for nothing, never attack.
  it('8. once a seat is eliminated its pieces block lines and can be captured for 0 points, but never attack', () => {
    // Blue's bishop checks Red's king; Blue resigns: the check disappears, the bishop stays, and capturing it scores nothing.
    const start = stateFromPieces(['rK@h1', 'rR@h8', 'bB@e4', 'bK@a8', 'yK@g14', 'gK@n7'], { turn: RED });
    expect(isInCheck(start, RED)).toBe(true);
    const out = resign(start, BLUE);
    expect(out.state.status[BLUE]).toBe('dead-king');
    expect(isInCheck(out.state, RED)).toBe(false);
    expect(listPieces(out.state)).toContain('bB@e4');
    const rook = stateFromPieces(['rK@h1', 'rR@h4', 'bB@e4', 'bK@a8', 'yK@g14', 'gK@n7'], { turn: RED, status: ['active', 'dead-king', 'active', 'active'] });
    const take = applyMoveRaw(rook, findLegalMove(rook, RED, parseSquare('h4'), parseSquare('e4'))!);
    expect(take.score[RED]).toBe(0);
    // A dead rook between a live rook and a king shields the king.
    const shield = stateFromPieces(['rK@h1', 'bR@h5', 'yR@h12', 'bK@a8', 'yK@k14', 'gK@n7'], { status: ['active', 'dead-king', 'active', 'active'] });
    expect(isInCheck(shield, RED)).toBe(false);
  });
});

describe('resigning, timing out, the move cap and skipped seats', () => {
  it('resigning on your own turn passes the turn on; the seat is eliminated with no points for anyone', () => {
    const out = resign(initialState(), RED, first);
    expect(out.state.status[RED]).toBe('dead-king');
    expect(out.state.turn).toBe(BLUE);
    expect(out.state.score).toEqual([0, 0, 0, 0]);
    expect(out.events[0]).toMatchObject({ kind: 'eliminated', seat: RED, reason: 'resign', credit: null });
    // Red's castling rights go with it; the other seats keep theirs.
    expect(out.state.castling & 3).toBe(0);
    expect(out.state.castling >> 2).toBe(initialState().castling >> 2);
  });

  it('resigning off your turn does not disturb whose turn it is, and an inactive seat cannot resign again', () => {
    const out = resign(initialState(), YELLOW, first);
    expect(out.state.turn).toBe(RED);
    expect(out.state.status[YELLOW]).toBe('dead-king');
    expect(resign(out.state, YELLOW).events).toEqual([]);
  });

  it('timeout is the same elimination with its own reason', () => {
    const out = resign(initialState(), GREEN, first, 'timeout');
    expect(out.events[0]).toMatchObject({ kind: 'eliminated', seat: GREEN, reason: 'timeout' });
  });

  it('the third resignation ends the game and the highest score wins', () => {
    const state = stateFromPieces(['rK@h1', 'rP@e2', 'bK@a8', 'yK@g14', 'gK@n7'], { score: [4, 9, 1, 2], status: ['active', 'dead-king', 'active', 'active'] });
    const afterYellow = resign(state, YELLOW).state;
    expect(afterYellow.result).toBeNull();
    const afterGreen = resign(afterYellow, GREEN).state;
    expect(afterGreen.result).toEqual({ winners: [BLUE], reason: 'elimination' });
  });

  it('a resigned seat\'s walled-in king freezes on its next turn, and a frozen seat is skipped from then on', () => {
    let state = resign(initialState(), RED, first).state; // Red resigns; its king is boxed in by its own dead pieces
    state = play(state, 'b4', 'c4').state; // Blue
    state = play(state, 'g13', 'g12').state; // Yellow
    const afterGreen = play(state, 'm5', 'l5'); // Green; next comes Red's (dead) king: no moves at all
    expect(afterGreen.events.some((e) => e.kind === 'frozen' && e.seat === RED)).toBe(true);
    expect(afterGreen.state.status[RED]).toBe('frozen');
    expect(afterGreen.state.turn).toBe(BLUE);
    // Round again: Red is skipped silently.
    const round2 = play(play(play(afterGreen.state, 'b5', 'c5').state, 'h13', 'h12').state, 'm6', 'l6');
    expect(round2.state.turn).toBe(BLUE);
    expect(round2.events.filter((e) => e.kind === 'frozen')).toHaveLength(0);
  });

  it('the ply cap scores and ends the game', () => {
    const rules = { ...FFA_RULES, maxPlies: 5 };
    const state = stateFromPieces(['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7', 'yP@g13'], { ply: 4, rules, score: [3, 1, 7, 2] });
    const out = play(state, 'h1', 'h2');
    expect(out.state.result).toEqual({ winners: [YELLOW], reason: 'cap' });
    expect(out.events[out.events.length - 1].kind).toBe('gameOver');
  });

  describe('the hard ply ceiling: the last stop, independent of every other end-of-game rule', () => {
    // Two knights each can shuffle for ever and no mate is forced, so only the cap can end this game.
    const shufflers = ['rK@h1', 'rN@e3', 'bK@a8', 'bN@c6', 'yK@g14', 'yN@j12', 'gK@n7', 'gN@l9'];

    it('a game that nothing else can end is ended by the cap, exactly at maxPlies', () => {
      let state = stateFromPieces(shufflers, { rules: { ...FFA_RULES, maxPlies: 40 } });
      let steps = 0;
      for (; !state.result && steps < 200; steps++) state = playMove(state, legalMoves(state, state.turn)[0]).state;
      expect(state.result).toMatchObject({ reason: 'cap' });
      expect(state.ply).toBe(40);
    });

    it('maxPlies can be lowered but never lifted past HARD_MAX_PLIES: Infinity (or a huge number) still stops there', () => {
      for (const maxPlies of [Infinity, 1e9]) {
        const state = stateFromPieces(shufflers, { ply: HARD_MAX_PLIES - 1, rules: { ...FFA_RULES, maxPlies } });
        const out = playMove(state, legalMoves(state, state.turn)[0]);
        expect(out.state.result, String(maxPlies)).toMatchObject({ reason: 'cap' });
        expect(out.state.ply).toBe(HARD_MAX_PLIES);
      }
      expect(HARD_MAX_PLIES).toBeGreaterThan(FFA_RULES.maxPlies); // the ceiling never lowers the normal cap
      expect(HARD_MAX_PLIES).toBeLessThanOrEqual(10_000); // ...and is genuinely a ceiling: a 4-seat game is never allowed to run on past this
      const normal = stateFromPieces(shufflers, { ply: HARD_MAX_PLIES - 1 });
      expect(normal.rules.maxPlies).toBeLessThan(HARD_MAX_PLIES);
    });
  });

  describe('dead position: nothing but bare kings can ever be left (found by measuring real bot games)', () => {
    // Weak bots trade every piece (the 4-seat board has 60 non-king pieces); once all four are bare kings no checkmate can ever
    // happen again, and the game used to burn the whole ply cap doing nothing.
    const lastTrade = ['rK@h1', 'bK@a8', 'bB@h2', 'yK@g14', 'gK@n7'];

    it('the capture that leaves every active seat a bare king ends the game on the spot; the highest score wins', () => {
      const out = play(stateFromPieces(lastTrade), 'h1', 'h2');
      expect(out.state.result).toEqual({ winners: [RED], reason: 'deadPosition' });
      expect(out.state.score).toEqual([5, 0, 0, 0]);
      expect(out.events[out.events.length - 1]).toMatchObject({ kind: 'gameOver', result: { reason: 'deadPosition' } });
    });

    it('while any active seat still has a piece or pawn the game goes on', () => {
      for (const extra of ['gN@m5', 'yP@g13', 'bR@b5', 'gQ@n11']) {
        const out = play(stateFromPieces([...lastTrade, extra]), 'h1', 'h2');
        expect(out.state.result, extra).toBeNull();
      }
    });

    it('a promoted queen is a piece too', () => {
      const out = play(stateFromPieces([...lastTrade, 'gZ@n10']), 'h1', 'h2');
      expect(out.state.result).toBeNull();
    });

    it('dead pieces do not count: material owned by an eliminated seat is not a way to mate', () => {
      const state = stateFromPieces(['rK@h1', 'bK@a8', 'bR@b5', 'bP@b6', 'yK@g14', 'gK@n7'], { status: ['active', 'dead-king', 'active', 'active'] });
      const out = play(state, 'h1', 'h2');
      expect(out.state.result).toEqual({ winners: [RED, BLUE, YELLOW, GREEN], reason: 'deadPosition' }); // all tied on 0
    });

    it('an elimination that removes the last live material (resign, out of turn or not) ends the game as well', () => {
      const state = stateFromPieces(['rK@h1', 'rR@d1', 'bK@a8', 'yK@g14', 'gK@n7'], { turn: YELLOW });
      const out = resign(state, RED, first);
      expect(out.state.result).toMatchObject({ reason: 'deadPosition' });
      expect(out.events[out.events.length - 1].kind).toBe('gameOver');
    });

    it('a normal position with material is untouched, and the opening is not a dead position', () => {
      expect(isDeadPosition(initialState())).toBe(false);
      expect(isDeadPosition(stateFromPieces(lastTrade))).toBe(false); // the bishop is Blue's and Blue is active
      expect(isDeadPosition(stateFromPieces(['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7']))).toBe(true);
    });

    it('seeded games between the weakest bots now finish by themselves long before any cap', () => {
      const rules = { ...FFA_RULES, maxPlies: 6000 };
      for (const seed of [1, 2, 3, 4]) {
        let s = seed * 7919;
        const rng = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
        let state = initialState(rules);
        for (let guard = 0; !state.result && guard < 7000; guard++) state = playMove(state, chooseBotMove(state, 400, rng)!, rng).state; // bounded here too: never rely on the engine alone to stop
        expect(state.result, `seed ${seed} never finished`).not.toBeNull();
        expect(state.result!.reason, `seed ${seed} ended at ply ${state.ply}`).not.toBe('cap');
        expect(state.ply).toBeLessThan(2500);
      }
    }, 120_000);
  });

  it('eliminateSeat is a no-op for a seat that is not active or once the game is over', () => {
    const state = stateFromPieces(['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7'], { status: ['active', 'dead-king', 'active', 'active'] });
    expect(eliminateSeat(state, BLUE, 'resign')).toBe(state);
    const over = { ...state, result: { winners: [RED as Seat], reason: 'cap' as const } };
    expect(eliminateSeat(over, RED, 'resign')).toBe(over);
  });

  it('a normal full round passes the turn Red → Blue → Yellow → Green → Red', () => {
    let state = initialState();
    const order: Seat[] = [];
    const openers: [string, string][] = [['e2', 'e3'], ['b5', 'c5'], ['h13', 'h12'], ['m6', 'l6']];
    for (const [from, to] of openers) {
      order.push(state.turn);
      state = play(state, from, to).state;
    }
    expect(order).toEqual([RED, BLUE, YELLOW, GREEN]);
    expect(state.turn).toBe(RED);
    expect(state.ply).toBe(4);
    expect(squareName(parseSquare('e3'))).toBe('e3');
  });
});
