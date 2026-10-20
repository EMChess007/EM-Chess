import { describe, expect, it } from 'vitest';
import { SQUARE8, legalMoves, squareName as crossSquareName, type Seat } from '../fourPlayer';
import { applyFourState, movePayloadFor, viewFromMatch } from '../fourPlayerOnline';
import { validateFourMovePayload } from '../fourPlayerWire';
import { CJ_ROOM, ChaturajiSim, cp } from './chaturajiKit';

/**
 * CHATURAJI W4 - the regression the browser end-to-end exists for, as a fast unit test: no online helper may name a square of an 8 x 8 game with the CROSS board's names.
 * W3 found that `movePayloadFor` (without the rules) and the reducer's last move did exactly that, so every online Chaturaji move went to the wrong square; the socket-level
 * end-to-end could not see it because it has its own client. This walks whole seeded Chaturaji games and, at EVERY position, for EVERY legal move of the seat to move,
 * checks both directions an online move travels: the client's payload names the squares on the 8 x 8 board (and the server's validator accepts them against that board),
 * and the state the server answers with is read back into the same squares by the reducer. A helper that falls back to the cross board's spelling fails at the first move.
 */
const SEEDS = [11, 23, 47];
const MAX_PLIES = 60;

describe('the online helpers name squares on the room\'s own 8 x 8 board, for every legal move of whole games', () => {
  it('the payload for each legal move is the engine\'s 8 x 8 spelling, accepted by the server\'s validator, and the reducer reads the answer back to the same squares', () => {
    let moves = 0;
    let promotions = 0;
    let distinguishing = 0; // moves whose cross-board spelling differs from the 8 x 8 one: the test can tell the two apart
    for (const seed of SEEDS) {
      const game = new ChaturajiSim(seed);
      for (let ply = 0; ply < MAX_PLIES && !game.state.result; ply++) {
        const mover = game.state.turn as Seat;
        for (const move of legalMoves(game.state, mover)) {
          const payload = movePayloadFor(CJ_ROOM, move, game.state.rules);
          const from = SQUARE8.squareName(move.from);
          const to = SQUARE8.squareName(move.to);
          expect(payload.from, `seed ${seed} ply ${ply} from`).toBe(from);
          expect(payload.to, `seed ${seed} ply ${ply} to`).toBe(to);
          expect(validateFourMovePayload(payload, () => SQUARE8).ok, `seed ${seed} ply ${ply} ${from}-${to}`).toBe(true);
          if (crossSquareName(move.from) !== from || crossSquareName(move.to) !== to) distinguishing++;

          // the way back: the server's four_state for this move, read by the reducer
          const branch = new ChaturajiSim(seed, game.state);
          const view = viewFromMatch(branch.match(mover), 1000);
          expect(view, `seed ${seed} ply ${ply}`).not.toBeNull();
          const applied = applyFourState(view!, branch.play(move), 1100);
          expect(applied.outcome, `seed ${seed} ply ${ply} ${from}-${to}`).toBe('applied');
          expect(applied.view.lastMove?.from, `seed ${seed} ply ${ply} last move from`).toBe(move.from);
          expect(applied.view.lastMove?.to, `seed ${seed} ply ${ply} last move to`).toBe(move.to);
          if ((move.flags & 4) !== 0) {
            promotions++;
            expect(payload.promotion).toBe('r'); // a boat: the only promotion in Chaturaji
            expect(applied.view.lastMove?.promoted).toBe(true);
          }
          moves++;
        }
        game.bot();
      }
    }
    expect(moves).toBeGreaterThan(1000); // the walk really covered whole games
    expect(distinguishing).toBeGreaterThan(moves / 2); // and most squares are spelt differently on the cross board, so a fallback to it cannot pass unnoticed
    console.info(`chaturajiOnlineSquares: ${moves} legal moves over ${SEEDS.length} games, ${promotions} promotions, ${distinguishing} that the cross board would spell differently`);
  });

  it('a promotion goes out as a boat on the 8 x 8 squares, for a pawn of every seat on every square it can promote from, and comes back as "promoted"', () => {
    const KINGS = ['rK@a1', 'bK@a8', 'yK@h8', 'gK@h1'];
    const kingSquares = new Set(['a1', 'a8', 'h8', 'h1']);
    const letters = ['r', 'b', 'y', 'g'];
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      let promoting = 0;
      for (let square = 0; square < 64; square++) {
        const name = SQUARE8.squareName(square);
        if (kingSquares.has(name)) continue;
        const state = cp([...KINGS, `${letters[seat]}P@${name}`], { turn: seat });
        for (const move of legalMoves(state, seat).filter((m) => (m.flags & 4) !== 0)) {
          promoting++;
          expect(movePayloadFor(CJ_ROOM, move, state.rules), `seat ${seat} ${name}`).toEqual({ roomId: CJ_ROOM, from: SQUARE8.squareName(move.from), to: SQUARE8.squareName(move.to), promotion: 'r' });
          const branch = new ChaturajiSim(1, state);
          const applied = applyFourState(viewFromMatch(branch.match(seat), 1000)!, branch.play(move), 1100);
          expect(applied.view.lastMove, `seat ${seat} ${name}`).toEqual({ from: move.from, to: move.to, promoted: true });
        }
      }
      expect(promoting, `seat ${seat} has promotions`).toBeGreaterThan(0);
    }
  });

  it('without the room\'s rules the payload is the cross board\'s spelling: the helper cannot be called "by accident" and still pass the walk above', () => {
    const game = new ChaturajiSim(5);
    const move = legalMoves(game.state, game.state.turn as Seat)[0];
    const wrong = movePayloadFor(CJ_ROOM, move);
    const right = movePayloadFor(CJ_ROOM, move, game.state.rules);
    expect(`${wrong.from}${wrong.to}`).not.toBe(`${right.from}${right.to}`);
    expect(wrong.from).toBe(crossSquareName(move.from));
  });
});
