import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/**
 * BUGHOUSE W3b - HP9 and HP12 for the files W3b added (the AST scan; AGENTS.md "rules learned"): the board is a REQUIRED argument of every helper that names a square, a cell, a pocket, a
 * selection or a touch target; a commit always says which board it came from; and nothing at screen level listens to touches or presses (no backdrop handler, no "tap elsewhere to deselect",
 * no responder system on the boards). The W3a scan (bughouseUiBoardArgument.test.ts) is unchanged.
 */
const ROOT = `${__dirname}/../..`;
const NEW_LOGIC = ['logic/bughouseSelection.ts', 'logic/boardTouches.ts'];
const EXTENDED_LOGIC = ['logic/bughouseLayout.ts', 'logic/bughouseView.ts'];
const NEW_HOOKS = ['components/useBoardTouches.ts', 'components/useBoardSelection.ts'];
const ALL = [...NEW_LOGIC, ...EXTENDED_LOGIC, ...NEW_HOOKS];
/** The helpers W3b added to the extended files (the rest of those files is covered by the W3a scan). */
const ADDED_TO_EXTENDED = new Set(['dualBoardPlan', 'dualBoardOrientation', 'needsRotateOverlay', 'premovesAllowed']);

const source = (file: string) => ts.createSourceFile(file, readFileSync(`${ROOT}/${file}`, 'utf8'), ts.ScriptTarget.ES2022, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

interface Fn {
  file: string;
  name: string;
  params: { name: string; type: string; optional: boolean; hasDefault: boolean }[];
}
function exportedFunctions(files: string[]): Fn[] {
  const found: Fn[] = [];
  for (const file of files) {
    const sf = source(file);
    sf.forEachChild((node) => {
      if (ts.isFunctionDeclaration(node) && node.name && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        found.push({ file, name: node.name.text, params: node.parameters.map((p) => ({ name: p.name.getText(sf), type: p.type?.getText(sf) ?? '', optional: Boolean(p.questionToken), hasDefault: Boolean(p.initializer) })) });
      }
    });
  }
  return found;
}
const fns = exportedFunctions(ALL);
const byName = new Map(fns.map((f) => [f.name, f]));
/** An options object whose REQUIRED `board` property is pinned below (`BoardTouchOptions`). */
const OPTIONS_WITH_BOARD = new Set(['BoardTouchOptions']);
const requiredBoard = (f: Fn) => f.params.some((p) => !p.optional && !p.hasDefault && (/^BoardId$/.test(p.type) || OPTIONS_WITH_BOARD.has(p.type)));

describe('the board is a required argument of every helper W3b added that names board data', () => {
  it('the scan finds the helpers', () => {
    for (const name of ['reduceSelection', 'liveSelection', 'useBoardSelection', 'useBoardTouches', 'stepTouches', 'gridTapCell', 'insideGrid', 'dualBoardPlan', 'dualBoardOrientation', 'needsRotateOverlay', 'premovesAllowed']) expect(byName.has(name), name).toBe(true);
  });

  it('the helpers that name a board\'s selection, plan or orientation take a REQUIRED BoardId', () => {
    for (const name of ['reduceSelection', 'useBoardSelection', 'dualBoardPlan', 'dualBoardOrientation']) {
      const fn = byName.get(name)!;
      expect(requiredBoard(fn), `${name}(${fn.params.map((p) => `${p.name}: ${p.type}`).join(', ')})`).toBe(true);
    }
  });

  it('no parameter of type BoardId in the new files is optional or has a default', () => {
    for (const fn of fns) for (const p of fn.params) if (/\bBoardId\b/.test(p.type)) expect(p.optional || p.hasDefault, `${fn.name}(${p.name})`).toBe(false);
  });

  it('every other exported function of the new files that names a square, cell, pocket, reserve, clock, board or selection takes a board - or is one of the listed helpers that work on ONE board\'s own pixels or on no board at all', () => {
    // pure pixel geometry of one grid / one book of touches / window-size or whole-match questions: they are handed one board's numbers, they never name a board
    const NO_BOARD = new Set(['gridTapCell', 'insideGrid', 'stepTouches', 'liveSelection', 'needsRotateOverlay', 'premovesAllowed', 'localOfTouch', 'fingerCell']);
    const NAMES_BOARD_DATA = /square|cell|pocket|reserve|clock|board|selection|touch/i;
    for (const fn of fns) {
      if (!NAMES_BOARD_DATA.test(fn.name)) continue;
      if (EXTENDED_LOGIC.includes(fn.file) && !ADDED_TO_EXTENDED.has(fn.name)) continue; // the W3a helpers: covered by the W3a scan
      if (NO_BOARD.has(fn.name)) continue;
      expect(requiredBoard(fn), `${fn.name}(${fn.params.map((p) => `${p.name}: ${p.type}`).join(', ')}) names board data without a board`).toBe(true);
    }
  });

  it('the listed exceptions exist and really take no board (so the list cannot hide a helper that should have one)', () => {
    for (const name of ['gridTapCell', 'insideGrid', 'stepTouches', 'liveSelection', 'needsRotateOverlay', 'premovesAllowed', 'localOfTouch', 'fingerCell']) {
      expect(byName.has(name), `${name} is listed but does not exist`).toBe(true);
      expect(byName.get(name)!.params.some((p) => /\bBoardId\b/.test(p.type)), name).toBe(false);
    }
  });
});

describe('what a board reports carries its board', () => {
  it('every commit of the selection reducer says which board it is for (a required `board: BoardId` on each member of the union)', () => {
    const sf = source('logic/bughouseSelection.ts');
    let members = 0;
    sf.forEachChild((node) => {
      if (ts.isTypeAliasDeclaration(node) && node.name.text === 'SelectionCommit' && ts.isUnionTypeNode(node.type)) {
        for (const member of node.type.types) {
          members++;
          expect(ts.isTypeLiteralNode(member)).toBe(true);
          const board = (member as ts.TypeLiteralNode).members.find((m) => m.name?.getText(sf) === 'board') as ts.PropertySignature | undefined;
          expect(board, member.getText(sf)).toBeDefined();
          expect(board!.questionToken).toBeUndefined();
          expect(board!.type!.getText(sf)).toBe('BoardId');
        }
      }
    });
    expect(members).toBe(2);
  });

  it('the touch layer is made for a board (a required `board`) and every callback it reports through takes the board first', () => {
    const sf = source('components/useBoardTouches.ts');
    let seen = false;
    sf.forEachChild((node) => {
      if (ts.isInterfaceDeclaration(node) && node.name.text === 'BoardTouchOptions') {
        seen = true;
        const member = (name: string) => node.members.find((m) => m.name?.getText(sf) === name) as ts.PropertySignature;
        expect(member('board').questionToken).toBeUndefined();
        expect(member('board').type!.getText(sf)).toBe('BoardId');
        for (const callback of ['onTapCell', 'onTapChip', 'onTapPromotion']) expect(member(callback).type!.getText(sf), callback).toMatch(/^\(board: BoardId, /);
      }
    });
    expect(seen).toBe(true);
  });

  it('the screen routes every dual input through a function that takes the board, and makes one selection instance per board', () => {
    const screen = readFileSync(`${ROOT}/screens/BughouseGameScreen.tsx`, 'utf8');
    expect(screen).toMatch(/const dualInput = \(board: BoardId, input: SelectionInput\)/);
    expect(screen).toMatch(/useBoardSelection\('A'\)/);
    expect(screen).toMatch(/useBoardSelection\('B'\)/);
    expect(screen).toMatch(/const selectionOf = \(board: BoardId\)/);
  });
});

describe('no screen-level touch handling (HP12 rules 1 and 5)', () => {
  const HANDLER = /^(onTouch\w*|onPointer\w*|onResponder\w*|onStartShouldSetResponder\w*|onMoveShouldSetResponder\w*|onPress\w*|onClick|onMouse\w*)$/;

  it('no View or ScrollView of the game screen carries a touch, pointer, responder, press or click handler: nothing outside a board can change a board\'s selection', () => {
    const sf = source('screens/BughouseGameScreen.tsx');
    const offenders: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(sf);
        if (tag === 'View' || tag === 'ScrollView') {
          for (const attr of node.attributes.properties) {
            if (ts.isJsxAttribute(attr) && HANDLER.test(attr.name.getText(sf))) offenders.push(`${tag} ${attr.name.getText(sf)}`);
            if (ts.isJsxSpreadAttribute(attr)) offenders.push(`${tag} spreads ${attr.expression.getText(sf)}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(offenders).toEqual([]);
  });

  it('the touch layer and the selection hook use no PanResponder, no responder property and no Pressable', () => {
    for (const file of ['components/useBoardTouches.ts', 'components/useBoardSelection.ts', 'logic/boardTouches.ts', 'logic/bughouseSelection.ts']) {
      const code = readFileSync(`${ROOT}/${file}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/PanResponder|onStartShouldSetResponder|onMoveShouldSetResponder|onResponder|Pressable|panHandlers/);
    }
  });

  it('a board that takes raw touches wires them INSTEAD of the PanResponder handlers, never next to them', () => {
    const board = readFileSync(`${ROOT}/components/BughouseBoard.tsx`, 'utf8');
    // the grid listens itself in the browser; on a phone its transparent overlay carries the same touch props (so the touches arrive in the grid's own frame) and the grid none
    expect(board).toMatch(/\{\.\.\.\(touches \? \(surface \? \{\} : touches\.gridProps\) : interactive \? gestures\.panHandlers : \{\}\)\}/);
    expect(board).toContain('{...touches.surfaceProps}');
  });

  it('the dual chips and the promotion buttons are plain Views with a board\'s touch props, not Pressables', () => {
    const block = readFileSync(`${ROOT}/components/BughouseBoardBlock.tsx`, 'utf8');
    expect(block).toMatch(/touches\.chipProps\(chip\.piece\)/);
    expect(block).toMatch(/touches\.promotionProps\(choice\)/);
    expect(block).toMatch(/touches\.promotionProps\('cancel'\)/);
  });
});
