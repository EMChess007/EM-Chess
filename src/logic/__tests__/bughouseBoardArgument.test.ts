import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  BOARD_IDS,
  BUGHOUSE_SEATS,
  boardSquareKey,
  opponentOnBoard,
  otherBoard,
  parseBoardSquareKey,
  partnerOf,
  seatAt,
  seatPlace,
  type BoardId,
  type BughouseColor,
  type BughouseSeat,
} from '../bughouse';

/**
 * The empty Bughouse module (BUGHOUSE_SPEC.md W0): the board and the seat map, and the pattern every later helper follows - THE BOARD IS A REQUIRED ARGUMENT. Constants are
 * written as literals below (a check that reads the table from the module under mutation can never kill a mutant of it).
 */
describe('the seat map (BUGHOUSE_SPEC.md section 1.1, B20)', () => {
  it('seat 0 = Board A White, 1 = A Black, 2 = B White, 3 = B Black; Team 1 = seats 0 + 3, Team 2 = seats 1 + 2', () => {
    expect(seatPlace(0)).toEqual({ board: 'A', color: 'w', team: 1, partner: 3 });
    expect(seatPlace(1)).toEqual({ board: 'A', color: 'b', team: 2, partner: 2 });
    expect(seatPlace(2)).toEqual({ board: 'B', color: 'w', team: 2, partner: 1 });
    expect(seatPlace(3)).toEqual({ board: 'B', color: 'b', team: 1, partner: 0 });
  });

  it('partner(0) = 3, partner(3) = 0, partner(1) = 2, partner(2) = 1; a partner is on the other board, plays the other colour and shares the team', () => {
    expect([0, 1, 2, 3].map((s) => partnerOf(s as BughouseSeat))).toEqual([3, 2, 1, 0]);
    for (const seat of BUGHOUSE_SEATS) {
      const mine = seatPlace(seat);
      const theirs = seatPlace(partnerOf(seat));
      expect(theirs.board).not.toBe(mine.board);
      expect(theirs.color).not.toBe(mine.color);
      expect(theirs.team).toBe(mine.team);
      expect(partnerOf(partnerOf(seat))).toBe(seat);
    }
  });

  it('the opponent on a board is the other seat of that board, and seatAt is the inverse of the table', () => {
    expect([0, 1, 2, 3].map((s) => opponentOnBoard(s as BughouseSeat))).toEqual([1, 0, 3, 2]);
    expect(seatAt('A', 'w')).toBe(0);
    expect(seatAt('A', 'b')).toBe(1);
    expect(seatAt('B', 'w')).toBe(2);
    expect(seatAt('B', 'b')).toBe(3);
    for (const seat of BUGHOUSE_SEATS) expect(seatAt(seatPlace(seat).board, seatPlace(seat).color)).toBe(seat);
  });

  it('there are exactly two boards and four seats', () => {
    expect([...BOARD_IDS]).toEqual(['A', 'B']);
    expect([...BUGHOUSE_SEATS]).toEqual([0, 1, 2, 3]);
    expect(otherBoard('A')).toBe('B');
    expect(otherBoard('B')).toBe('A');
  });
});

describe('a square key always names its board', () => {
  it('"A:e4" and "B:e4" are different squares', () => {
    expect(boardSquareKey('A', 'e4')).toBe('A:e4');
    expect(boardSquareKey('B', 'e4')).toBe('B:e4');
    expect(boardSquareKey('A', 'e4')).not.toBe(boardSquareKey('B', 'e4'));
  });

  it('round-trips, and refuses anything that is not a board-qualified square', () => {
    for (const board of BOARD_IDS) for (const square of ['a1', 'h8', 'e4']) expect(parseBoardSquareKey(boardSquareKey(board, square))).toEqual({ board, square });
    for (const junk of ['e4', 'A:', 'A:i4', 'A:e9', 'C:e4', 'a:e4', 'A:e4 ', ' A:e4', 'xA:e4', 'AA:e4', '', 'A:e44']) expect(parseBoardSquareKey(junk), junk).toBeNull();
  });

  it('a typed call must name the board (compile-time: these lines must stay type errors)', () => {
    // @ts-expect-error the board is required
    expect(() => boardSquareKey('e4')).not.toThrow();
    // @ts-expect-error the board is required
    expect(() => seatAt('w')).not.toThrow();
    const board: BoardId = 'A';
    const color: BughouseColor = 'b';
    expect(seatAt(board, color)).toBe(1);
  });
});

/** The parameters of every exported function of src/logic/bughouse/*.ts (the rule is scanned, not remembered). */
function exportedFunctions(): { file: string; name: string; params: { name: string; type: string; optional: boolean; hasDefault: boolean }[] }[] {
  const dir = `${__dirname}/../bughouse`;
  const found: { file: string; name: string; params: { name: string; type: string; optional: boolean; hasDefault: boolean }[] }[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const sf = ts.createSourceFile(file, readFileSync(`${dir}/${file}`, 'utf8'), ts.ScriptTarget.ES2022, true);
    sf.forEachChild((node) => {
      if (ts.isFunctionDeclaration(node) && node.name && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        found.push({
          file,
          name: node.name.text,
          params: node.parameters.map((p) => ({ name: p.name.getText(sf), type: p.type?.getText(sf) ?? '', optional: Boolean(p.questionToken), hasDefault: Boolean(p.initializer) })),
        });
      }
    });
  }
  return found;
}

describe('the board is a required argument (scanned over src/logic/bughouse)', () => {
  const fns = exportedFunctions();

  it('the scan finds the module\'s functions (W0\'s seven and W1\'s engine)', () => {
    const names = fns.map((f) => f.name);
    for (const name of ['boardSquareKey', 'opponentOnBoard', 'otherBoard', 'parseBoardSquareKey', 'partnerOf', 'seatAt', 'seatPlace', 'createMatch', 'applyAction', 'settle', 'legalMovesOn', 'legalDropsOn', 'legalActions', 'pocketOfSeat', 'clockOfSeat', 'serializeMatch', 'deserializeMatch', 'resolvePremove', 'judgeBoard', 'conservationProblems']) expect(names, name).toContain(name);
    expect(names.length).toBeGreaterThan(40);
  });

  it('no parameter of type BoardId is optional or has a default', () => {
    for (const fn of fns) for (const p of fn.params) if (/\bBoardId\b/.test(p.type)) expect(p.optional || p.hasDefault, `${fn.name}(${p.name})`).toBe(false);
  });

  // The one exception is the INVERSE of a board-qualified key: it is handed the key ("A:e4"), which already names its board, and returns the board.
  const KEY_PARSERS = new Set(['parseBoardSquareKey']);

  // W1: the helpers that pick "a" board, pocket or clock out of a match take the board or the SEAT (a seat names its board) as a required parameter. The rest are listed, and each list is
  // itself checked: LEAF helpers work on a value that carries its own identity (a clock, a pocket, a chess.js position) and know no board at all; MATCH_WIDE functions act on the whole
  // match or return every clock / flag with its board attached.
  const LEAF = new Set(['boardCrazyhouse', 'playDrop', 'dropNotation', 'isRunning', 'deadlineOf', 'remainingAt', 'afterMove', 'started', 'frozen']);
  const MATCH_WIDE = new Set(['runningClocks', 'dueFlag', 'settle', 'applyAction', 'finishMatch', 'voidMatch', 'conservationProblems', 'serializeMatch', 'snapshotOf', 'createMatch']);
  const namesBoardData = (f: { name: string }) => /square|cell|pocket|reserve|clock/i.test(f.name) && !KEY_PARSERS.has(f.name);

  it('every function whose name mentions a square, cell, pocket, reserve or clock takes a REQUIRED board (BoardId) or seat (BughouseSeat) - or is one of the listed leaf / match-wide helpers', () => {
    for (const fn of fns.filter(namesBoardData)) {
      if (LEAF.has(fn.name) || MATCH_WIDE.has(fn.name)) continue;
      const named = fn.params.some((p) => /^(BoardId|BughouseSeat)$/.test(p.type) && !p.optional && !p.hasDefault);
      expect(named, `${fn.name}(${fn.params.map((p) => `${p.name}: ${p.type}`).join(', ')}) names a board, pocket or clock without a board or seat`).toBe(true);
    }
  });

  it('the listed exceptions exist, and no leaf helper knows a board; no function takes a BughouseMatch first and then names no board or seat unless it is match-wide', () => {
    const names = new Set(fns.map((f) => f.name));
    for (const name of [...LEAF, ...MATCH_WIDE]) expect(names.has(name), `${name} is listed but does not exist`).toBe(true);
    for (const fn of fns.filter((f) => LEAF.has(f.name))) expect(fn.params.some((p) => /\bBoardId\b/.test(p.type)), `${fn.name} is a leaf helper`).toBe(false);
    const matchFirst = fns.filter((f) => f.params[0]?.type === 'BughouseMatch' && !MATCH_WIDE.has(f.name));
    expect(matchFirst.length).toBeGreaterThan(5);
    for (const fn of matchFirst) {
      const named = fn.params.slice(1).some((p) => /^(BoardId|BughouseSeat)$/.test(p.type) && !p.optional && !p.hasDefault);
      expect(named, `${fn.name} takes a match and names no board or seat`).toBe(true);
    }
  });

  it('the exception is only a parser of a board-qualified key: one parameter, named key, returning the board with the square', () => {
    for (const name of KEY_PARSERS) {
      const fn = fns.find((f) => f.name === name);
      expect(fn?.params.map((p) => `${p.name}:${p.type}`)).toEqual(['key:string']);
    }
    expect(parseBoardSquareKey('B:h8')).toEqual({ board: 'B', square: 'h8' });
  });

  it('no function in the module has a default value for any parameter that names a board, square, pocket or clock', () => {
    for (const fn of fns) for (const p of fn.params) if (/board|square|pocket|clock/i.test(p.name)) expect(p.hasDefault, `${fn.name}(${p.name})`).toBe(false);
  });
});
