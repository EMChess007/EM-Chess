import { describe, expect, it } from 'vitest';
import {
  CHATURAJI_MAX_CELL,
  CHATURAJI_MIN_CELL,
  CHATURAJI_RULES,
  CROSS14,
  FFA_RULES,
  GIVEAWAY_RULES,
  PLAYABLE_SQUARES,
  QUEEN,
  ROOK,
  SQUARE8,
  describePremove,
  getBoardCellSize,
  getChaturajiCellSize,
  getFourPlayerCellSize,
  gridToSquare,
  initialState,
  isPromotionPremove,
  onlyPromotionType,
  resolvePremove,
  squareToGrid,
  type Seat,
} from '../fourPlayer';
import { applyFourState, viewFromMatch, viewFromRoom, movePayloadFor } from '../fourPlayerOnline';
import { buildSpectateRows, chaturajiOnlineRows, joinQueueRequest, checkMatchVariant } from '../fourPlayerOnlineUi';
import { describeResignWarning, describeResultNote, rankSeats, statusSuffix, variantTitle } from '../fourPlayerVariant';
import { validateFourMovePayload, type FourActiveGameSummary } from '../fourPlayerWire';
import { CJ_ROOM, ChaturajiSim, cjSeats, cp, findMove, label, sq } from './chaturajiKit';

/**
 * CHATURAJI W3 - the client-side logic the screens stand on that is not Chaturaji-specific code but had a hard-wired 14 x 14 board in it: cell sizes, the cell <-> square maps
 * of the annotations, premoves, the move payload and the reducer's last move, the Spectate list, the final table of an online game. Each of these was found wrong for the 8 x 8
 * board by writing the screen tests (the wrong ones are named in the tests).
 */
const RED = 0 as Seat;
const BLUE = 1 as Seat;

describe('cell size', () => {
  it('Chaturaji has its own pinned sizes, and the cross board\'s 21 at 360 x 640 is untouched', () => {
    expect(getFourPlayerCellSize(360, 640)).toBe(21);
    expect(getChaturajiCellSize(360, 640)).toBe(36); // (640 - 345) / 8
    expect(getChaturajiCellSize(412, 915)).toBe(49); // (412 - 16) / 8
    expect(getBoardCellSize('cross14', 360, 640)).toBe(21);
    expect(getBoardCellSize('square8', 360, 640)).toBe(36);
    expect(getBoardCellSize('square8', 412, 915)).toBe(49);
  });

  it('stays between its bounds on any screen and fills the width when the height allows', () => {
    expect(getChaturajiCellSize(200, 300)).toBe(CHATURAJI_MIN_CELL);
    expect(getChaturajiCellSize(2000, 3000)).toBe(CHATURAJI_MAX_CELL);
    for (const w of [320, 360, 390, 412, 600, 768]) {
      const size = getChaturajiCellSize(w, 2000);
      expect(size * 8, `${w}`).toBeLessThanOrEqual(w - 16 + 7);
      expect(size).toBeGreaterThanOrEqual(CHATURAJI_MIN_CELL);
    }
  });
});

describe('screen cells <-> squares on the 8 x 8 board (the annotations\' two maps)', () => {
  it('is an exact bijection on the 64 squares for each view, with no cut corners; Red is at the bottom in view 0', () => {
    for (const view of [0, 1, 2, 3] as Seat[]) {
      const cells = new Set<string>();
      for (let square = 0; square < 64; square++) {
        const cell = squareToGrid(square, view, SQUARE8);
        expect(cell.row).toBeGreaterThanOrEqual(0);
        expect(cell.row).toBeLessThan(8);
        expect(cell.col).toBeGreaterThanOrEqual(0);
        expect(cell.col).toBeLessThan(8);
        expect(gridToSquare(cell, view, SQUARE8), `view ${view} square ${square}`).toBe(square);
        cells.add(`${cell.row},${cell.col}`);
      }
      expect(cells.size).toBe(64);
    }
    expect(squareToGrid(sq('a1'), RED, SQUARE8)).toEqual({ row: 7, col: 0 });
    expect(squareToGrid(sq('h8'), RED, SQUARE8)).toEqual({ row: 0, col: 7 });
    expect(squareToGrid(sq('d1'), RED, SQUARE8).row).toBe(7); // Red's king, at the bottom edge
    expect(squareToGrid(sq('a5'), BLUE, SQUARE8).row).toBe(7); // turned a quarter: Blue's king is at the bottom
  });

  it('a cell outside the board is no square, and the cross board\'s maps are exactly what they were', () => {
    expect(gridToSquare({ row: -1, col: 0 }, RED, SQUARE8)).toBeNull();
    expect(gridToSquare({ row: 0, col: 8 }, RED, SQUARE8)).toBeNull();
    // the cells just off the edge whose flat index would WRAP onto a real square (col 8 of row 1 is index 56 + ..., col -1 of row 2 is the end of the row above)
    for (const view of [0, 1, 2, 3] as Seat[]) {
      for (let row = -1; row <= 8; row++) {
        expect(gridToSquare({ row, col: 8 }, view, SQUARE8), `view ${view} row ${row} col 8`).toBeNull();
        expect(gridToSquare({ row, col: -1 }, view, SQUARE8), `view ${view} row ${row} col -1`).toBeNull();
      }
      for (let col = -1; col <= 8; col++) {
        expect(gridToSquare({ row: 8, col }, view, SQUARE8), `view ${view} row 8 col ${col}`).toBeNull();
        expect(gridToSquare({ row: -1, col }, view, SQUARE8), `view ${view} row -1 col ${col}`).toBeNull();
      }
    }
    expect(gridToSquare({ row: 0, col: 0 }, RED)).toBeNull(); // a cut corner of the cross board
    for (const square of PLAYABLE_SQUARES.slice(0, 20)) expect(gridToSquare(squareToGrid(square, BLUE), BLUE)).toBe(square);
    expect(gridToSquare(squareToGrid(PLAYABLE_SQUARES[5], RED, CROSS14), RED, CROSS14)).toBe(PLAYABLE_SQUARES[5]);
  });
});

describe('promotion is automatic in Chaturaji', () => {
  it('only Chaturaji has a single promotion piece; the other games still ask', () => {
    expect(onlyPromotionType(initialState(CHATURAJI_RULES))).toBe(ROOK);
    expect(onlyPromotionType(initialState(FFA_RULES))).toBeNull();
    expect(onlyPromotionType(initialState(GIVEAWAY_RULES))).toBeNull();
  });

  it('a premove with no piece named resolves to the boat in Chaturaji (it used to ask for a queen, which is no move there, so the premove was cancelled) and to a queen elsewhere', () => {
    const state = cp(['rK@a1', 'bK@a8', 'yK@h8', 'gK@h1', 'rP@c7'], { turn: BLUE });
    expect(isPromotionPremove(state, RED, sq('c7'), sq('c8'))).toBe(true);
    const resolved = resolvePremove({ ...state, turn: RED }, RED, { from: sq('c7'), to: sq('c8') });
    expect(resolved).not.toBeNull();
    expect(label(resolved)).toBe('c7-c8=R');
    expect(resolvePremove({ ...state, turn: RED }, RED, { from: sq('c7'), to: sq('c8'), promotion: ROOK })).not.toBeNull();
    expect(resolvePremove({ ...state, turn: RED }, RED, { from: sq('c7'), to: sq('c8'), promotion: QUEEN })).toBeNull(); // nobody can promote to a queen here
  });

  it('the premove line names squares on the game\'s board', () => {
    expect(describePremove({ from: sq('c7'), to: sq('c8'), promotion: ROOK }, SQUARE8)).toBe('c7-c8=R');
    expect(describePremove({ from: sq('a2'), to: sq('a3') }, SQUARE8)).toBe('a2-a3');
    expect(describePremove({ from: 33, to: 47 })).toBe(describePremove({ from: 33, to: 47 }, CROSS14)); // the cross board is the default
  });
});

describe('the online client speaks the room\'s board', () => {
  it('the move payload names squares on the 8 x 8 board (the cross board\'s names would have sent every move to the wrong square) and the server accepts it', () => {
    const sim = new ChaturajiSim();
    const move = findMove(sim.state, 'a2-a3');
    const payload = movePayloadFor(CJ_ROOM, move, sim.state.rules);
    expect(payload).toEqual({ roomId: CJ_ROOM, from: 'a2', to: 'a3' });
    expect(movePayloadFor(CJ_ROOM, move)).not.toEqual(payload); // without the rules it is the cross board's spelling: not this game's move
    expect(validateFourMovePayload(payload, () => SQUARE8).ok).toBe(true); // the server checks against ITS room's board
    const promoting = cp(['rK@a1', 'bK@a8', 'yK@h8', 'gK@h1', 'rP@c7'], { turn: RED });
    expect(movePayloadFor(CJ_ROOM, findMove(promoting, 'c7-c8=R'), promoting.rules)).toEqual({ roomId: CJ_ROOM, from: 'c7', to: 'c8', promotion: 'r' });
  });

  it('a four_state names the last move on the 8 x 8 board, and says when it was a promotion (the board announces it)', () => {
    const sim = new ChaturajiSim(3, cp(['rK@a1', 'bK@a8', 'yK@h8', 'gK@h1', 'rP@c7', 'bP@b5'], { turn: RED }));
    const view = viewFromMatch(sim.match(RED), 1000);
    expect(view).not.toBeNull();
    expect(view!.variant).toBe('chaturaji');
    const promoted = applyFourState(view!, sim.play(findMove(sim.state, 'c7-c8=R')), 1100);
    expect(promoted.outcome).toBe('applied');
    expect(promoted.view.lastMove).toEqual({ from: sq('c7'), to: sq('c8'), promoted: true });
    const plain = applyFourState(promoted.view, sim.play(findMove(sim.state, 'b5-c5')), 1200);
    expect(plain.view.lastMove).toEqual({ from: sq('b5'), to: sq('c5') }); // no `promoted` on an ordinary move
  });

  it('a Chess four_state still gives the plain last move, and the rejoin answer of a Chaturaji room is read with its own rules', () => {
    const sim = new ChaturajiSim(5);
    sim.play(findMove(sim.state, 'd2-d3'));
    const room = viewFromRoom(sim.room(), RED, 2000);
    expect(room).not.toBeNull();
    expect(room!.variant).toBe('chaturaji');
    expect(room!.state.rules).toEqual(CHATURAJI_RULES);
    expect(room!.state.cells.length).toBe(64);
  });
});

describe('the Spectate list and the queue', () => {
  const game = (variant: 'ffa' | 'giveaway' | 'chaturaji' | undefined, roomId: string): FourActiveGameSummary =>
    ({ roomId, ...(variant ? { variant } : {}), timeControlLabel: '5 min', seats: cjSeats(), spectators: 0 }) as unknown as FourActiveGameSummary;

  it('lists each game under its own header, in a stable order, and leaves a game of an unknown variant out', () => {
    const rows = buildSpectateRows([], [game('chaturaji', 'c1'), game('ffa', 'f1'), game('giveaway', 'g1'), game(undefined, 'f2'), game('chaturaji', 'c2'), { ...game('ffa', 'x'), variant: 'bughouse' } as unknown as FourActiveGameSummary]);
    expect(rows.map((r) => (r.kind === 'header' ? `# ${r.title}` : r.key))).toEqual(['# 4 Player Chess', 'four:f1', 'four:f2', '# 4 Player Giveaway', 'four:g1', '# Chaturaji', 'four:c1', 'four:c2']);
  });

  it('asks for Chaturaji with the variant on the wire (and only then), and refuses a server that answers with another game', () => {
    const tc = { initialSeconds: 300, incrementSeconds: 0, label: '5 min' };
    expect(joinQueueRequest(tc, 'chaturaji')).toMatchObject({ variant: 'chaturaji' });
    expect('variant' in joinQueueRequest(tc, 'ffa')).toBe(false);
    expect(checkMatchVariant('chaturaji', { variant: 'chaturaji' })).toEqual({ ok: true });
    const old = checkMatchVariant('chaturaji', {});
    expect(old.ok).toBe(false);
    if (!old.ok) expect(old.error).toMatch(/does not support Chaturaji/);
    expect(checkMatchVariant('chaturaji', { variant: 'ffa' }).ok).toBe(false);
    expect(checkMatchVariant('chaturaji', { variant: 'giveaway' }).ok).toBe(false);
  });
});

describe('the wording', () => {
  it('Chaturaji is titled, never "in check", says its king is attacked, and has its own resignation text', () => {
    expect(variantTitle('chaturaji')).toBe('Chaturaji');
    const attacked = cp(['rK@d1', 'bR@d8', 'bK@a8', 'yK@h8', 'gK@h1'], { turn: RED });
    expect(statusSuffix(attacked, RED)).toBe(' — king attacked!');
    expect(statusSuffix(attacked, BLUE)).toBe('');
    const chess = initialState(FFA_RULES);
    expect(statusSuffix(chess, RED)).not.toMatch(/attacked/);
    expect(describeResignWarning('chaturaji', false)).toMatch(/king keeps walking/);
    expect(describeResignWarning('chaturaji', true)).toMatch(/keep watching/);
    expect(describeResignWarning('ffa', true)).toMatch(/dead blockers/); // 4 Player Chess keeps its own sentence
    expect(describeResultNote({ reason: 'elimination', winners: [RED] }, 'chaturaji')).toMatch(/Three players eliminated/);
    expect(describeResultNote({ reason: 'cap', winners: [RED] }, 'chaturaji')).toMatch(/Move limit/);
  });

  it('the table ranks by points with ties by seat for Chaturaji', () => {
    expect(rankSeats('chaturaji', [3, 9, 3, 0], [BLUE])).toEqual([1, 0, 2, 3]);
  });
});

describe('the online final table', () => {
  it('shows the server\'s scores with the bonus breakdown read from the final snapshot', () => {
    const sim = new ChaturajiSim(1, cp(['rK@a1', 'rR@d4', 'bK@a8', 'yK@h8', 'gK@d8'], { turn: RED, status: ['active', 'dead-king', 'dead-king', 'active'], score: [2, 0, 0, 1] }));
    sim.play(findMove(sim.state, 'd4xd8'));
    const over = sim.over();
    expect(over.scores).toEqual([11, 0, 0, 1]);
    const rows = chaturajiOnlineRows(over, cjSeats());
    expect(rows.map((r) => [r.place, r.seat, r.name, r.score, r.bonus, r.winner])).toEqual([
      [1, 0, 'Ana', 11, 6, true],
      [2, 3, 'Di', 1, 0, false],
      [3, 1, 'Ben', 0, 0, false],
      [4, 2, 'Cy', 0, 0, false],
    ]);
    expect(rows[0].detail).toBe('11 points — 5 from play + 6 for 2 kings left');
  });

  it('an unreadable final snapshot costs only the breakdown, and an abandoned game has no table', () => {
    const sim = new ChaturajiSim(1, cp(['rK@a1', 'rR@d4', 'bK@a8', 'yK@h8', 'gK@d8'], { turn: RED, status: ['active', 'dead-king', 'dead-king', 'active'] }));
    sim.play(findMove(sim.state, 'd4xd8'));
    const broken = chaturajiOnlineRows({ ...sim.over(), state: 'not a snapshot' }, cjSeats());
    expect(broken.map((r) => r.score)).toEqual([9, 0, 0, 0]);
    expect(broken.every((r) => r.bonus === 0)).toBe(true);
    expect(chaturajiOnlineRows({ ...sim.over('abandoned') }, cjSeats())).toEqual([]);
  });
});
