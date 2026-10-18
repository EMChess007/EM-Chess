import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { START_FEN } from '../../types/chess';
import type { GameHistoryEntry } from '../../types/history';
import { ChessEngine, type ChessEngineOptions } from '../ChessEngine';
import { initialCrazyhouseState } from '../crazyhouse';
import { getGameOutcome } from '../gameResult';
import { describeEndReason } from '../gameOutcomeText';
import { isThreefoldRepetition, repetitionCount, repetitionKey } from '../repetition';
import { historyRepetitionKeys, isRepetitionDraw } from '../repetitionHistory';
import { initialSpellChessState } from '../spellChess';

// Threefold repetition: the same position three times (not necessarily in a row), same side to move, same castling rights, same en
// passant possibility - plus each variant's hidden state - is an automatic draw in every two-player mode. The screens derive it from
// their history (so it survives the per-render FEN rebuild and Undo); the server keeps the same list in the room. Server twin:
// backend/scripts/test-repetition.mjs (no-drift, every mode through RoomManager, rejoin, parity).

const SHUFFLE: [string, string][] = [['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8']];

/** A history built the way the screens build it: a fresh engine from the previous FEN for every ply (so chess.js never sees a repetition). */
function play(initialFen: string, plies: [string, string][], options: ChessEngineOptions = {}, pseudo = false): GameHistoryEntry[] {
  const history: GameHistoryEntry[] = [];
  let fen = initialFen;
  for (const [from, to] of plies) {
    const engine = new ChessEngine(fen, options);
    const move = pseudo ? engine.movePseudoLegal(from, to) : engine.move(from, to);
    if (!move) throw new Error(`illegal ${from}${to} in ${fen}`);
    history.push({ move, fenBefore: fen, fenAfter: engine.getFen() });
    fen = engine.getFen();
  }
  return history;
}
const cycles = (n: number) => Array.from({ length: n }, () => SHUFFLE).flat();

describe('the key: what is "the same position"', () => {
  const base = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';
  it('ignores the move clocks, includes the side to move and the castling rights', () => {
    expect(repetitionKey(base)).toBe(repetitionKey(base.replace(' 0 1', ' 31 77')));
    expect(repetitionKey(base)).not.toBe(repetitionKey(base.replace(' w ', ' b ')));
    expect(repetitionKey(base)).not.toBe(repetitionKey(base.replace('KQkq', 'Kkq')));
    expect(repetitionKey(base)).not.toBe(repetitionKey(base.replace('KQkq', '-')));
  });

  it('en passant counts only when a capture is available', () => {
    const none = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    expect(repetitionKey(none)).toBe(repetitionKey(none.replace(' e3 ', ' - ')));
    const capturable = 'rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    expect(repetitionKey(capturable)).not.toBe(repetitionKey(capturable.replace(' e3 ', ' - ')));
    const white = 'rnbqkbnr/pppp1ppp/8/3Pp3/8/8/PPP1PPPP/RNBQKBNR w KQkq e6 0 1';
    expect(repetitionKey(white)).not.toBe(repetitionKey(white.replace(' e6 ', ' - ')));
    // the capturing pawn may stand on EITHER side of the pushed pawn
    const rightNeighbour = 'rnbqkbnr/pppp1ppp/8/8/4Pp2/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    expect(repetitionKey(rightNeighbour)).not.toBe(repetitionKey(rightNeighbour.replace(' e3 ', ' - ')));
    // a pawn of the WRONG colour beside the pushed pawn captures nothing
    const wrongColour = 'rnbqkbnr/pppppppp/8/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq e3 0 1';
    expect(repetitionKey(wrongColour)).toBe(repetitionKey(wrongColour.replace(' e3 ', ' - ')));
  });

  it('counts every second entry only, itself included', () => {
    expect(repetitionCount(['a', 'b', 'a', 'b', 'a'])).toBe(3);
    expect(repetitionCount(['x', 'o', 'x', 'p', 'x'])).toBe(3);
    expect(repetitionCount(['x', 'x', 'x'])).toBe(2);
    expect(isThreefoldRepetition(['a', 'b', 'a', 'b'])).toBe(false);
    expect(isThreefoldRepetition([])).toBe(false);
  });
});

describe('the variant state is compared as a SET and credited to the right side', () => {
  it('promoted squares are the same position whatever order they were collected in', () => {
    const one = { reserve: { w: { q: 0, r: 0, b: 0, n: 0, p: 0 }, b: { q: 0, r: 0, b: 0, n: 0, p: 0 } }, promoted: ['a1', 'c8'] };
    const two = { ...one, promoted: ['c8', 'a1'] };
    expect(repetitionKey(START_FEN, { crazyhouse: one })).toBe(repetitionKey(START_FEN, { crazyhouse: two }));
  });

  it('Three-Check: a check is credited to the side that gave it - a checking move ("+") and a mating move ("#") alike', () => {
    const entry = (san: string, fenAfter: string) => ({ move: { from: '', to: '', san }, fenBefore: '', fenAfter });
    const fenW = '4k3/8/8/8/8/8/8/R3K3 b - - 0 1';
    const fenB = '4k3/8/8/8/8/8/8/R3K3 w - - 0 2';
    const keys = historyRepetitionKeys(START_FEN, [entry('Qh5+', fenW), entry('Nc6', fenB), entry('Qxf7#', fenW)], { threeCheck: true });
    expect(keys[0]).toBe(repetitionKey(START_FEN, { checks: { w: 0, b: 0 } }));
    expect(keys[1]).toBe(repetitionKey(fenW, { checks: { w: 1, b: 0 } }));
    expect(keys[2]).toBe(repetitionKey(fenB, { checks: { w: 1, b: 0 } }));
    expect(keys[3]).toBe(repetitionKey(fenW, { checks: { w: 2, b: 0 } }));
    const black = historyRepetitionKeys(START_FEN, [entry('e4', fenW), entry('Bb4+', fenB)], { threeCheck: true });
    expect(black[2]).toBe(repetitionKey(fenB, { checks: { w: 0, b: 1 } }));
  });
});

describe('Nf3 Nf6 Ng1 Ng8 x3, rebuilt from the FEN every ply (exactly what the screens do)', () => {
  const modes: [string, ChessEngineOptions, boolean][] = [
    ['Classic', {}, false],
    ['King of the Hill', {}, false],
    ['Three-Check', {}, false],
    ['Fog of War', { skipValidation: true }, true],
    ['Giveaway', { skipValidation: true, giveaway: true }, true],
    ['Atomic', { atomic: true }, false],
    ['Crazyhouse', { crazyhouse: true }, false],
    ['Spell Chess', { spellChess: true, skipValidation: true }, false],
  ];
  it.each(modes)('%s: a draw exactly on the third occurrence (ply 8), not before', (_name, options, pseudo) => {
    const full = play(START_FEN, cycles(2), options, pseudo);
    expect(full).toHaveLength(8);
    for (let n = 0; n < 8; n++) expect(isRepetitionDraw(START_FEN, full.slice(0, n), {})).toBe(false);
    expect(isRepetitionDraw(START_FEN, full, {})).toBe(true);
  });

  it('chess.js itself cannot see it on a rebuilt engine - which is why the history is used', () => {
    const history = play(START_FEN, cycles(2));
    expect(new ChessEngine(history[7].fenAfter).getStatus()).toBe('playing');
  });
});

describe('Undo across a repetition (the answer is derived from the history)', () => {
  it('taking the third occurrence back un-draws the game; replaying it draws again', () => {
    const history = play(START_FEN, cycles(2));
    expect(isRepetitionDraw(START_FEN, history, {})).toBe(true);
    const undone = history.slice(0, -1);
    expect(isRepetitionDraw(START_FEN, undone, {})).toBe(false);
    // a different move after the undo - no repetition
    const other = [...undone, ...play(undone[undone.length - 1].fenAfter, [['b8', 'c6']])];
    expect(isRepetitionDraw(START_FEN, other, {})).toBe(false);
    // the same move again
    const again = [...undone, ...play(undone[undone.length - 1].fenAfter, [['f6', 'g8']])];
    expect(isRepetitionDraw(START_FEN, again, {})).toBe(true);
  });

  it('counts positions from before an Undo-and-different-line correctly (only the current line counts)', () => {
    const line = play(START_FEN, [...cycles(1), ['b1', 'c3'], ['b8', 'c6']]); // start position visited twice, then a new line
    expect(isRepetitionDraw(START_FEN, line, {})).toBe(false);
  });
});

describe('positions that look identical but must NOT count', () => {
  it('castling rights: the kings walk out and back', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    const walk: [string, string][] = [['e1', 'e2'], ['e8', 'e7'], ['e2', 'e1'], ['e7', 'e8']];
    const history = play(fen, [...walk, ...walk]);
    // the placement is the start placement at plies 4 and 8, but with no rights it is a new position
    expect(isRepetitionDraw(fen, history, {})).toBe(false);
    expect(isRepetitionDraw(fen, play(fen, [...walk, ...walk, ...walk]).slice(0, 10), {})).toBe(true); // the position after ply 2 comes back at 6 and 10
  });

  it('en passant: the same placement with a capture available the first time', () => {
    const key1 = repetitionKey('rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    const key2 = repetitionKey('rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    expect(key1).not.toBe(key2);
  });

  it('Three-Check: the same placement after a different number of checks', () => {
    const fen = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';
    // Ra1-a8 gives check (1), the black king steps aside, the rook comes home, the king returns: same placement as the start, but 1 check
    const history = play(fen, [['a1', 'a8'], ['e8', 'e7'], ['a8', 'a1'], ['e7', 'e8'], ['a1', 'a8'], ['e8', 'e7'], ['a8', 'a1'], ['e7', 'e8']]);
    expect(historyRepetitionKeys(fen, history, { threeCheck: true })[8]).not.toBe(historyRepetitionKeys(fen, history, { threeCheck: true })[0]);
    expect(isRepetitionDraw(fen, history, { threeCheck: true })).toBe(false);
    // without the counters (the plain modes) the same game IS a draw on the third return - the counters are what keep them apart
    expect(isRepetitionDraw(fen, history, {})).toBe(true);
  });

  it('Crazyhouse: a different pocket / promoted square', () => {
    const history = play(START_FEN, cycles(2), { crazyhouse: true }).map((h) => ({ ...h, crazyhouse: initialCrazyhouseState() }));
    expect(isRepetitionDraw(START_FEN, history, { crazyhouse: true })).toBe(true);
    const withPocket = history.map((h, i) =>
      i === 3 ? { ...h, crazyhouse: { ...initialCrazyhouseState(), reserve: { w: { q: 0, r: 0, b: 0, n: 0, p: 1 }, b: { q: 0, r: 0, b: 0, n: 0, p: 0 } } } } : h
    );
    expect(isRepetitionDraw(START_FEN, withPocket, { crazyhouse: true })).toBe(false);
  });

  it('Duck: the duck square keeps the start position from recurring; a cycling duck draws on the third return', () => {
    const base = play(START_FEN, cycles(3), { skipValidation: true, duckChess: true, duckSquare: null }, true);
    const withDuck = (squares: string[]) => base.map((h, i) => ({ ...h, duckSquare: squares[i % squares.length] }));
    expect(isRepetitionDraw(START_FEN, withDuck(['a3', 'a6']).slice(0, 8), { duckChess: true })).toBe(false);
    expect(isRepetitionDraw(START_FEN, withDuck(['a3', 'a6']).slice(0, 9), { duckChess: true })).toBe(true);
    expect(isRepetitionDraw(START_FEN, withDuck(['a3', 'b3', 'c3', 'd3', 'a6', 'b6', 'c6', 'd6', 'a4', 'b4', 'c4', 'd4']), { duckChess: true })).toBe(false);
  });

  it('Spell Chess: charges, cooldowns, frozen squares and a pending jump', () => {
    const base = play(START_FEN, cycles(2), { spellChess: true, skipValidation: true });
    const fresh = base.map((h) => ({ ...h, spellState: initialSpellChessState() }));
    expect(isRepetitionDraw(START_FEN, fresh, { spellChess: true })).toBe(true);
    for (const mutate of [
      (s: ReturnType<typeof initialSpellChessState>) => { s.w.charges.freeze -= 1; },
      (s: ReturnType<typeof initialSpellChessState>) => { s.b.cooldowns.jump = 2; },
      (s: ReturnType<typeof initialSpellChessState>) => { s.pendingFreeze = { squares: ['e4'], restricts: 'w' }; },
      (s: ReturnType<typeof initialSpellChessState>) => { s.pendingJump = { square: 'c3', pliesLeft: 1 }; },
    ]) {
      const state = initialSpellChessState();
      mutate(state);
      const differs = fresh.map((h, i) => (i === 3 ? { ...h, spellState: state } : h));
      expect(isRepetitionDraw(START_FEN, differs, { spellChess: true })).toBe(false);
    }
  });
});

describe('the result: one reason everywhere', () => {
  it('getGameOutcome reports a draw by repetition, behind every decisive result', () => {
    expect(getGameOutcome('playing', 'w', null, null, false, null, null, null, null, null, null, null, null, true)).toEqual({ over: true, result: '1/2-1/2', reason: 'repetition' });
    // a decisive result outranks it
    expect(getGameOutcome('playing', 'w', null, 'b', false, null, null, null, null, null, null, null, null, true)).toMatchObject({ reason: 'resignation' });
    expect(getGameOutcome('playing', 'w', 'b', null, false, null, null, null, null, null, null, null, null, true)).toMatchObject({ reason: 'timeout' });
    expect(getGameOutcome('playing', 'w', null, null, true, null, null, null, null, null, null, null, null, true)).toMatchObject({ reason: 'agreement' });
    expect(getGameOutcome('playing', 'w', null, null, false, null, null, 'b', null, null, null, null, null, true)).toMatchObject({ reason: 'fogOfWar' });
    expect(getGameOutcome('playing', 'w', null, null, false, null, null, null, null, null, null, null, null, false)).toEqual({ over: false });
  });

  it('is described the same way on every screen, including a game the server ended', () => {
    expect(describeEndReason('repetition')).toBe('by Repetition');
  });
});

describe('every screen uses it', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8').split('\r\n').join('\n');
  it.each(['LocalGameScreen', 'BotGameScreen'])('%s: derived from the history, ends the game, stops the clock, says "Draw by repetition"', (screen) => {
    const src = read('screens', `${screen}.tsx`);
    expect(src).toContain("import { isRepetitionDraw } from '../logic/repetitionHistory';");
    expect(src).toContain('isRepetitionDraw(initialFen, history, { threeCheck, crazyhouse, duckChess, spellChess })');
    expect(src).toContain('const engineGameOver = engineGameOverByRules || repetitionDraw;');
    expect(src).toContain("if (repetitionDraw) statusText = 'Draw by repetition';");
    expect(src).toMatch(/spellChessWinner,\n\s+hordeWinner,\n\s+repetitionDraw\n\s+\);/);
    expect(src).not.toContain('isAtomicThreefoldRepetition');
  });

  it('EngineVsEngineGameScreen: the same', () => {
    const src = read('screens', 'EngineVsEngineGameScreen.tsx');
    expect(src).toContain('isRepetitionDraw(initialFen, history, { threeCheck })');
    expect(src).toContain('useChessClock(timeControl, turn, engine.isGameOver() || repetitionDraw)');
    expect(src).toContain("if (repetitionDraw) statusText = 'Draw by repetition';");
    expect(src).toContain('threeCheckWinner, null, null, null, null, null, null, repetitionDraw)');
  });

  it("the Online wire types know the reason (the server's game_over)", () => {
    expect(read('types', 'multiplayer.ts')).toContain("  | 'repetition'");
  });
});
