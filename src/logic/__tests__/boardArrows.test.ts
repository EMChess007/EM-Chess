import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addSquareArrow, EMPTY_ARROW_BOOK, hasMarks, NO_MARKS, stepArrowTouches, toggleSquareHighlight, type ArrowBook, type ArrowEvent } from '../boardArrows';
import { LONG_PRESS_MS, MOVE_THRESHOLD_PX } from '../boardGestures';

/**
 * FINGER-DRAWN ARROWS, the pure rules (command #32; logic/boardArrows.ts): the marks as squares, and the arming of each finger by identifier. The numbers the gesture is built on are written as
 * literals here (a test that read them from the module under test could never kill a mutant of them).
 */
const root = join(__dirname, '../../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('the gesture constants', () => {
  it('a hold is 400 ms and a tap may drift 10 px, the same for every board', () => {
    expect(LONG_PRESS_MS).toBe(400);
    expect(MOVE_THRESHOLD_PX).toBe(10);
  });
});

describe('marks', () => {
  it('adds arrows in order, the same arrow twice twice, and ignores a degenerate one', () => {
    let m = addSquareArrow(NO_MARKS, 'e2', 'e4');
    m = addSquareArrow(m, 'e2', 'e4');
    m = addSquareArrow(m, 'g1', 'f3');
    expect(m.arrows).toEqual([
      { from: 'e2', to: 'e4' },
      { from: 'e2', to: 'e4' },
      { from: 'g1', to: 'f3' },
    ]);
    expect(addSquareArrow(m, 'e2', 'e2')).toBe(m);
    expect(addSquareArrow(m, null, 'e2')).toBe(m);
    expect(addSquareArrow(m, 'e2', null)).toBe(m);
  });

  it('toggles a highlight and tells whether anything is drawn', () => {
    const on = toggleSquareHighlight(NO_MARKS, 'c2');
    expect(on.highlights).toEqual(['c2']);
    expect(hasMarks(on)).toBe(true);
    expect(toggleSquareHighlight(on, 'c2').highlights).toEqual([]);
    expect(hasMarks(NO_MARKS)).toBe(false);
    expect(toggleSquareHighlight(on, null)).toBe(on);
  });
});

/** Feeds events one after another and returns the last outcome and the book. */
function run(events: ArrowEvent[], book: ArrowBook = EMPTY_ARROW_BOOK) {
  let outcome: ReturnType<typeof stepArrowTouches>['outcome'] = null;
  for (const event of events) {
    const step = stepArrowTouches(book, event);
    book = step.book;
    outcome = step.outcome;
  }
  return { book, outcome };
}
const cell = (row: number, col: number) => ({ row, col });
const at = (x: number, y: number) => ({ x, y });

describe('arming a finger', () => {
  it('hold + drag to another cell + lift = an arrow between the two cells', () => {
    const { outcome, book } = run([
      { kind: 'start', id: '1', at: at(10, 10), cell: cell(0, 0) },
      { kind: 'arm', id: '1' },
      { kind: 'move', id: '1', at: at(100, 10) },
      { kind: 'end', id: '1', at: at(100, 10), cell: cell(0, 3) },
    ]);
    expect(outcome).toEqual({ kind: 'arrow', from: cell(0, 0), to: cell(0, 3) });
    expect(book).toEqual({});
  });

  it('hold + travel + lift on the cell it began on = a highlight', () => {
    const { outcome } = run([
      { kind: 'start', id: '1', at: at(10, 10), cell: cell(2, 2) },
      { kind: 'arm', id: '1' },
      { kind: 'move', id: '1', at: at(60, 10) },
      { kind: 'end', id: '1', at: at(21, 10), cell: cell(2, 2) },
    ]);
    expect(outcome).toEqual({ kind: 'highlight', cell: cell(2, 2) });
  });

  it('a quick tap (never armed) draws nothing: the tap layer owns it', () => {
    expect(run([{ kind: 'start', id: '1', at: at(10, 10), cell: cell(0, 0) }, { kind: 'end', id: '1', at: at(10, 10), cell: cell(0, 0) }]).outcome).toBeNull();
  });

  it('a hold that never moves is the ordinary tap, not an arrow and not a mark', () => {
    expect(run([{ kind: 'start', id: '1', at: at(10, 10), cell: cell(0, 0) }, { kind: 'arm', id: '1' }, { kind: 'end', id: '1', at: at(14, 10), cell: cell(0, 0) }]).outcome).toBeNull();
  });

  it('a finger that drifted before the hold was over can never arm', () => {
    const { outcome, book } = run([
      { kind: 'start', id: '1', at: at(10, 10), cell: cell(0, 0) },
      { kind: 'move', id: '1', at: at(25, 10) },
      { kind: 'arm', id: '1' },
      { kind: 'end', id: '1', at: at(100, 10), cell: cell(0, 3) },
    ]);
    expect(outcome).toBeNull();
    expect(book).toEqual({});
  });

  it('a wobble inside the drift (10 px) before the hold does not stop it arming; 11 px does', () => {
    const still = run([{ kind: 'start', id: '1', at: at(0, 0), cell: cell(0, 0) }, { kind: 'move', id: '1', at: at(10, 0) }, { kind: 'arm', id: '1' }]).book['1'];
    expect([still.armed, still.drifted]).toEqual([true, false]);
    const gone = run([{ kind: 'start', id: '1', at: at(0, 0), cell: cell(0, 0) }, { kind: 'move', id: '1', at: at(11, 0) }, { kind: 'arm', id: '1' }]).book['1'];
    expect([gone.armed, gone.drifted]).toEqual([false, true]);
  });

  it('an armed finger keeps drawing however far it travels (it never drifts after arming)', () => {
    const { book } = run([{ kind: 'start', id: '1', at: at(0, 0), cell: cell(0, 0) }, { kind: 'arm', id: '1' }, { kind: 'move', id: '1', at: at(300, 0) }]);
    expect([book['1'].armed, book['1'].drifted]).toEqual([true, false]);
  });

  it('two fingers are independent: one draws, the other taps', () => {
    let step = run([
      { kind: 'start', id: '1', at: at(0, 0), cell: cell(0, 0) },
      { kind: 'start', id: '2', at: at(500, 500), cell: cell(5, 5) },
      { kind: 'arm', id: '1' },
    ]);
    step = run([{ kind: 'end', id: '2', at: at(500, 500), cell: cell(5, 5) }], step.book);
    expect(step.outcome).toBeNull();
    expect(Object.keys(step.book)).toEqual(['1']);
    step = run([{ kind: 'end', id: '1', at: at(90, 0), cell: cell(0, 3) }], step.book);
    expect(step.outcome).toEqual({ kind: 'arrow', from: cell(0, 0), to: cell(0, 3) });
  });

  it('an identifier the book never saw, and a cancelled finger, change nothing', () => {
    expect(run([{ kind: 'end', id: '9', at: at(0, 0), cell: cell(0, 0) }]).outcome).toBeNull();
    expect(run([{ kind: 'arm', id: '9' }]).book).toEqual({});
    const { book, outcome } = run([{ kind: 'start', id: '1', at: at(0, 0), cell: cell(0, 0) }, { kind: 'arm', id: '1' }, { kind: 'cancel', id: '1' }, { kind: 'end', id: '1', at: at(90, 0), cell: cell(0, 3) }]);
    expect(book).toEqual({});
    expect(outcome).toBeNull();
  });
});

describe('every board of the app takes the gesture (the audit of command #32, pinned by a scan)', () => {
  const screensWithTwoPlayerBoard: [string, boolean][] = [
    ['src/screens/LocalGameScreen.tsx', true],
    ['src/screens/BotGameScreen.tsx', true],
    ['src/screens/OnlineGameScreen.tsx', true],
    ['src/screens/SpectatorGameScreen.tsx', true],
    ['src/screens/EngineVsEngineGameScreen.tsx', true],
    ['src/screens/AnalysisScreen.tsx', true],
    ['src/screens/DailyPuzzleScreen.tsx', false], // a puzzle: an arrow would be a hint
    ['src/screens/PuzzleRushScreen.tsx', false],
  ];
  it.each(screensWithTwoPlayerBoard)('%s %s', (file, wanted) => {
    const source = read(file);
    const board = source.slice(source.indexOf('<ChessBoard'));
    const props = board.slice(0, board.indexOf('/>'));
    expect(/\benableAnnotations\b/.test(props)).toBe(wanted);
  });

  it.each(['src/screens/FourPlayerGameScreen.tsx', 'src/screens/FourPlayerOnlineGameScreen.tsx', 'src/screens/FourPlayerSpectatorScreen.tsx'])('%s draws on the 4-seat board (4 Player Chess, 4P Giveaway, Chaturaji)', (file) => {
    const source = read(file);
    const board = source.slice(source.indexOf('<FourPlayerBoard'));
    expect(/\benableAnnotations\b/.test(board.slice(0, board.indexOf('/>')))).toBe(true);
  });

  it('Bughouse: both boards of the one game screen (local, online and spectator) get their marks, and the board takes the gesture on any turn', () => {
    const screen = read('src/screens/BughouseGameScreen.tsx');
    expect(screen).toContain('useBoardMarks(match.boards.A.fen)');
    expect(screen).toContain('useBoardMarks(match.boards.B.fen)');
    expect(screen).toContain("marks={board === 'A' ? marksA : marksB}");
    const board = read('src/components/BughouseBoard.tsx');
    expect(board).toContain('enableAnnotations: annotate');
    expect(board).toContain('const gridTouched = interactive || annotate;');
    expect(read('src/components/BughouseBoardBlock.tsx')).toContain('onArrow: props.rawTouch && props.marks');
  });

  it('the marks are cleared by a move on their own board and by nothing else (the hook is the shared one)', () => {
    const hook = read('src/components/useBoardMarks.ts');
    expect(hook).toContain('useClearAnnotationsOnMove(epoch');
    expect(read('src/screens/BughouseGameScreen.tsx')).not.toMatch(/useBoardMarks\([^)]*(turn|clock|seq)/i);
  });
});
