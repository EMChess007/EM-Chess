import { describe, expect, it } from 'vitest';
import type { PromotionPiece } from '../bughouse';
import type { BoardId } from '../bughouse/types';
import type { ReservePieceType } from '../crazyhouse';
import { NO_SELECTION, liveSelection, reduceSelection, type BoardPosition, type BoardSelection, type SelectionInput } from '../bughouseSelection';
import { mulberry32 } from './bughouseTestKit';

/**
 * BUGHOUSE W3b - the selection reducer of one board (HP12, rule 2), on hand-built positions: what a tap does, what completes an action, when a half-made action is dropped, and that the
 * instances of two boards never touch each other. The positions are stubs (a table of moves and drops), so every expectation is a literal.
 */
interface Table {
  fen?: string;
  active?: boolean;
  moves?: Record<string, { to: string; promotion?: PromotionPiece }[]>;
  drops?: Partial<Record<ReservePieceType, string[]>>;
}
const position = (t: Table = {}): BoardPosition => ({
  fen: t.fen ?? 'F1',
  active: t.active ?? true,
  movesFrom: (square) => t.moves?.[square] ?? [],
  dropSquares: (piece) => t.drops?.[piece] ?? [],
});
const TABLE: Table = {
  moves: {
    e2: [{ to: 'e3' }, { to: 'e4' }],
    d2: [{ to: 'd3' }, { to: 'd4' }],
    a7: [{ to: 'a8', promotion: 'q' }, { to: 'a8', promotion: 'r' }, { to: 'a8', promotion: 'b' }, { to: 'a8', promotion: 'n' }, { to: 'b8', promotion: 'q' }, { to: 'b8', promotion: 'n' }],
  },
  drops: { n: ['c3', 'f3'], p: ['a3'] },
};
const tapSquare = (square: string): SelectionInput => ({ kind: 'tapSquare', square });
const run = (board: BoardId, inputs: SelectionInput[], pos: BoardPosition = position(TABLE), from: BoardSelection = NO_SELECTION) => {
  let state = from;
  const commits = [];
  for (const input of inputs) {
    const step = reduceSelection(board, state, input, pos);
    state = step.state;
    if (step.commit) commits.push(step.commit);
  }
  return { state, commits };
};

describe('a piece is picked up and put down', () => {
  it('a tap on a piece that can move selects it; a tap on one of its squares plays the move and clears the selection', () => {
    const picked = run('A', [tapSquare('e2')]);
    expect(picked.state.selected).toEqual({ square: 'e2', fen: 'F1' });
    expect(picked.commits).toEqual([]);
    const played = run('A', [tapSquare('e2'), tapSquare('e4')]);
    expect(played.commits).toEqual([{ board: 'A', kind: 'move', from: 'e2', to: 'e4' }]);
    expect(played.state).toEqual(NO_SELECTION);
  });

  it('a tap on another piece that can move switches the selection; on an empty or immovable square it clears it; on the selected piece again it keeps it', () => {
    expect(run('A', [tapSquare('e2'), tapSquare('d2')]).state.selected?.square).toBe('d2');
    expect(run('A', [tapSquare('e2'), tapSquare('h5')]).state.selected).toBeNull();
    expect(run('A', [tapSquare('e2'), tapSquare('e2')]).state.selected?.square).toBe('e2');
    expect(run('A', [tapSquare('h5')]).state).toEqual(NO_SELECTION); // nothing to pick up
  });

  it('the commit names the board it came from (the board a reducer was made for)', () => {
    expect(run('B', [tapSquare('d2'), tapSquare('d3')]).commits[0].board).toBe('B');
    expect(run('A', [tapSquare('d2'), tapSquare('d3')]).commits[0].board).toBe('A');
  });

  it('a square that is not one of the piece\'s squares does not play: it selects there, or clears', () => {
    const r = run('A', [tapSquare('e2'), tapSquare('d3')]);
    expect(r.commits).toEqual([]);
    expect(r.state.selected).toBeNull(); // d3 holds no movable piece
  });
});

describe('a promotion waits for its choice', () => {
  it('a move onto the far rank asks for the piece, offering exactly the pieces the position allows, queen first', () => {
    const asked = run('A', [tapSquare('a7'), tapSquare('a8')]);
    expect(asked.commits).toEqual([]);
    expect(asked.state.promotion).toEqual({ from: 'a7', to: 'a8', choices: ['q', 'r', 'b', 'n'], fen: 'F1' });
    expect(run('A', [tapSquare('a7'), tapSquare('b8')]).state.promotion?.choices).toEqual(['q', 'n']); // a position that allows only two
  });

  it('choosing a piece plays the move with it and clears everything; choosing with nothing waiting does nothing', () => {
    const done = run('B', [tapSquare('a7'), tapSquare('a8'), { kind: 'choosePromotion', piece: 'n' }]);
    expect(done.commits).toEqual([{ board: 'B', kind: 'move', from: 'a7', to: 'a8', promotion: 'n' }]);
    expect(done.state).toEqual(NO_SELECTION);
    expect(run('A', [{ kind: 'choosePromotion', piece: 'q' }]).commits).toEqual([]);
  });

  it('cancelling drops the choice and keeps the piece picked up; a tap on a square gives the choice up too', () => {
    const cancelled = run('A', [tapSquare('a7'), tapSquare('a8'), { kind: 'cancelPromotion' }]);
    expect(cancelled.state.promotion).toBeNull();
    expect(cancelled.state.selected?.square).toBe('a7');
    const tapped = run('A', [tapSquare('a7'), tapSquare('a8'), tapSquare('e2')]);
    expect(tapped.state.promotion).toBeNull();
    expect(tapped.state.selected?.square).toBe('e2');
    expect(tapped.commits).toEqual([]);
  });

  it('a pocket tap while a choice waits gives the choice up as well', () => {
    const r = run('A', [tapSquare('a7'), tapSquare('a8'), { kind: 'pickPocket', piece: 'n' }]);
    expect(r.state.promotion).toBeNull();
    expect(r.state.picked?.piece).toBe('n');
  });
});

describe('a pocket piece is picked up and dropped', () => {
  it('a tap on a chip lifts it (and puts down any picked-up piece); a second tap on the same chip puts it back; another chip replaces it', () => {
    const lifted = run('A', [tapSquare('e2'), { kind: 'pickPocket', piece: 'n' }]);
    expect(lifted.state.picked).toEqual({ piece: 'n', fen: 'F1' });
    expect(lifted.state.selected).toBeNull();
    expect(run('A', [{ kind: 'pickPocket', piece: 'n' }, { kind: 'pickPocket', piece: 'n' }]).state.picked).toBeNull();
    expect(run('A', [{ kind: 'pickPocket', piece: 'n' }, { kind: 'pickPocket', piece: 'p' }]).state.picked?.piece).toBe('p');
  });

  it('a chip with no legal square cannot be lifted', () => {
    const r = run('A', [{ kind: 'pickPocket', piece: 'q' }]);
    expect(r.state).toEqual(NO_SELECTION);
  });

  it('a tap on one of the squares the position offers drops the piece (the commit says which piece, where, on which board)', () => {
    const r = run('B', [{ kind: 'pickPocket', piece: 'n' }, tapSquare('f3')]);
    expect(r.commits).toEqual([{ board: 'B', kind: 'drop', piece: 'n', square: 'f3' }]);
    expect(r.state).toEqual(NO_SELECTION);
  });

  it('a tap on any other square puts the piece back, and then does what a tap does (picks up a piece there)', () => {
    const r = run('A', [{ kind: 'pickPocket', piece: 'n' }, tapSquare('e2')]);
    expect(r.commits).toEqual([]);
    expect(r.state.picked).toBeNull();
    expect(r.state.selected?.square).toBe('e2');
  });
});

describe('a half-made action belongs to the position of its board', () => {
  it('it is dropped when the board changes (another FEN), whoever changed it, and kept while the board stays', () => {
    const picked = run('A', [tapSquare('e2'), { kind: 'pickPocket', piece: 'n' }, tapSquare('a7'), tapSquare('a8')]).state;
    expect(liveSelection(picked, position({ ...TABLE, fen: 'F1' }))).toBe(picked);
    expect(liveSelection(picked, position({ ...TABLE, fen: 'F2' }))).toEqual(NO_SELECTION);
    const selected = run('A', [tapSquare('e2')]).state;
    expect(liveSelection(selected, position({ ...TABLE, fen: 'F2' }))).toEqual(NO_SELECTION);
  });

  it('each part is judged on its own FEN: a selection made earlier than the pick is dropped when only it is stale', () => {
    const mixed: BoardSelection = { selected: { square: 'e2', fen: 'OLD' }, picked: { piece: 'n', fen: 'F1' }, promotion: null };
    expect(liveSelection(mixed, position(TABLE))).toEqual({ selected: null, picked: { piece: 'n', fen: 'F1' }, promotion: null });
    const other: BoardSelection = { selected: { square: 'e2', fen: 'F1' }, picked: { piece: 'n', fen: 'OLD' }, promotion: { from: 'a7', to: 'a8', choices: ['q'], fen: 'OLD' } };
    expect(liveSelection(other, position(TABLE))).toEqual({ selected: { square: 'e2', fen: 'F1' }, picked: null, promotion: null });
  });

  it('an input on a stale selection starts from nothing: the old picked-up piece does not play on the new position', () => {
    const stale: BoardSelection = { selected: { square: 'e2', fen: 'OLD' }, picked: null, promotion: null };
    const r = reduceSelection('A', stale, tapSquare('e4'), position(TABLE));
    expect(r.commit).toBeNull();
    expect(r.state).toEqual(NO_SELECTION);
  });

  it('when no human may act (the turn passed to a bot, the match ended) nothing is kept and nothing is accepted', () => {
    const busy = run('A', [tapSquare('e2')]).state;
    const locked = position({ ...TABLE, active: false });
    expect(liveSelection(busy, locked)).toEqual(NO_SELECTION);
    for (const input of [tapSquare('e4'), tapSquare('e2'), { kind: 'pickPocket', piece: 'n' }, { kind: 'choosePromotion', piece: 'q' }, { kind: 'cancelPromotion' }] as SelectionInput[]) {
      const step = reduceSelection('A', busy, input, locked);
      expect(step.commit, JSON.stringify(input)).toBeNull();
      expect(step.state, JSON.stringify(input)).toEqual(NO_SELECTION);
    }
  });
});

describe('two boards, two reducers: no input of one is ever seen by the other', () => {
  const inputs: SelectionInput[] = [
    tapSquare('e2'), tapSquare('e4'), tapSquare('d2'), tapSquare('d3'), tapSquare('h5'), tapSquare('a7'), tapSquare('a8'), tapSquare('b8'),
    { kind: 'pickPocket', piece: 'n' }, { kind: 'pickPocket', piece: 'p' }, { kind: 'pickPocket', piece: 'q' }, { kind: 'choosePromotion', piece: 'q' }, { kind: 'choosePromotion', piece: 'n' }, { kind: 'cancelPromotion' },
    tapSquare('f3'), tapSquare('c3'), tapSquare('a3'),
  ];

  it('over 200 seeded interleavings, each board ends where it would have ended alone, with the same commits, whatever the other board was doing', () => {
    const rng = mulberry32(2024);
    for (let round = 0; round < 200; round++) {
      const stream: { board: BoardId; input: SelectionInput }[] = [];
      for (let i = 0; i < 24; i++) stream.push({ board: rng() < 0.5 ? 'A' : 'B', input: inputs[Math.floor(rng() * inputs.length)] });
      // both boards together, each event routed to its own reducer, the positions differ (B's FEN is another one) so a mix-up would show
      const positions: Record<BoardId, BoardPosition> = { A: position({ ...TABLE, fen: 'FA' }), B: position({ ...TABLE, fen: 'FB', drops: { n: ['g1'] } }) };
      const together: Record<BoardId, BoardSelection> = { A: NO_SELECTION, B: NO_SELECTION };
      const commitsTogether: Record<BoardId, unknown[]> = { A: [], B: [] };
      for (const { board, input } of stream) {
        const step = reduceSelection(board, together[board], input, positions[board]);
        together[board] = step.state;
        if (step.commit) commitsTogether[board].push(step.commit);
      }
      for (const board of ['A', 'B'] as const) {
        const alone = run(board, stream.filter((e) => e.board === board).map((e) => e.input), positions[board]);
        expect(together[board], `round ${round}, board ${board}`).toEqual(alone.state);
        expect(commitsTogether[board], `round ${round}, board ${board}`).toEqual(alone.commits);
      }
    }
  });
});
