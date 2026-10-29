import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/**
 * BUGHOUSE W3a - HP9 for the SCREENS (the AST scan; AGENTS.md "rules learned"): no helper that names a square, a cell, a pocket or a clock may default to a board, and nothing in the
 * Bughouse UI may reach for the cross board's (or the 4-seat games') square helpers. W0 pinned this for `src/logic/bughouse`; this pins it for the files W3a added.
 */
const ROOT = `${__dirname}/../..`;
const LOGIC = ['logic/bughouseLayout.ts', 'logic/bughouseView.ts', 'logic/bughouseLocal.ts', 'logic/bughouseRulesSheet.ts'];
const UI = ['components/BughouseBoard.tsx', 'components/BughouseBoardBlock.tsx', 'components/BughouseRulesSheet.tsx', 'screens/BughouseSetupScreen.tsx', 'screens/BughouseGameScreen.tsx', ...LOGIC];

const source = (file: string) => ts.createSourceFile(file, readFileSync(`${ROOT}/${file}`, 'utf8'), ts.ScriptTarget.ES2022, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

interface Fn {
  file: string;
  name: string;
  params: { name: string; type: string; optional: boolean; hasDefault: boolean }[];
}
function exportedFunctions(): Fn[] {
  const found: Fn[] = [];
  for (const file of LOGIC) {
    const sf = source(file);
    sf.forEachChild((node) => {
      if (ts.isFunctionDeclaration(node) && node.name && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        found.push({ file, name: node.name.text, params: node.parameters.map((p) => ({ name: p.name.getText(sf), type: p.type?.getText(sf) ?? '', optional: Boolean(p.questionToken), hasDefault: Boolean(p.initializer) })) });
      }
      // exported arrow functions: `export const f = (a: T): R => ...`
      if (ts.isVariableStatement(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
            found.push({ file, name: decl.name.text, params: decl.initializer.parameters.map((p) => ({ name: p.name.getText(sf), type: p.type?.getText(sf) ?? '', optional: Boolean(p.questionToken), hasDefault: Boolean(p.initializer) })) });
          }
        }
      }
    });
  }
  return found;
}

describe('the board is a required argument (scanned over the W3a logic files)', () => {
  const fns = exportedFunctions();
  // Screen-wide NUMBERS (the size of a cell, how many fit), not names of a board's square: they depend on the window, not on a board.
  const WINDOW_SIZES = new Set(['stackedDualCell', 'sideBySideDualCell', 'getBughouseDualCellSize', 'getBughouseMainCellSize', 'getBughouseSideCellSize', 'fitStackedCell']);
  // A number to text: it names no board data, it draws a clock value it is given.
  const TEXT_OF_A_VALUE = new Set(['formatBughouseClock']);
  const namesBoardData = (f: Fn) => /square|cell|pocket|reserve|clock/i.test(f.name);

  it('the scan finds the helpers', () => {
    const names = fns.map((f) => f.name);
    for (const name of ['boardCellToSquare', 'boardSquareToCell', 'dropSquares', 'pocketChips', 'checkedKingSquare', 'boardOrientation', 'touchSeat', 'boardStatusLine', 'kingBadge', 'gameOverSummary', 'deriveBughouseLayout', 'bughouseSetupGate', 'localStep', 'dueBotSeats']) expect(names, name).toContain(name);
  });

  it('no parameter of type BoardId or BughouseSeat is optional or has a default', () => {
    for (const fn of fns) for (const p of fn.params) if (/\b(BoardId|BughouseSeat)\b/.test(p.type)) expect(p.optional || p.hasDefault, `${fn.name}(${p.name})`).toBe(false);
  });

  it('every function whose name mentions a square, cell, pocket, reserve or clock takes a REQUIRED board or seat - or is a listed window-size / value-to-text helper', () => {
    for (const fn of fns.filter(namesBoardData)) {
      if (WINDOW_SIZES.has(fn.name) || TEXT_OF_A_VALUE.has(fn.name)) continue;
      const named = fn.params.some((p) => /^(BoardId|BughouseSeat)$/.test(p.type) && !p.optional && !p.hasDefault);
      expect(named, `${fn.name}(${fn.params.map((p) => `${p.name}: ${p.type}`).join(', ')}) names board data without a board or seat`).toBe(true);
    }
  });

  it('the listed exceptions exist and really take no board (so the list cannot hide a helper that should have one)', () => {
    const byName = new Map(fns.map((f) => [f.name, f]));
    for (const name of [...WINDOW_SIZES, ...TEXT_OF_A_VALUE]) {
      expect(byName.has(name), `${name} is listed but does not exist`).toBe(true);
      expect(byName.get(name)!.params.some((p) => /\b(BoardId|BughouseSeat)\b/.test(p.type)), `${name}`).toBe(false);
    }
  });

  it('no parameter that names a board, square, pocket or clock has a default value', () => {
    for (const fn of fns) for (const p of fn.params) if (/board|square|pocket|clock/i.test(p.name)) expect(p.hasDefault, `${fn.name}(${p.name})`).toBe(false);
  });
});

describe('the Bughouse UI uses no cross-board or 4-seat square helper', () => {
  it('no Bughouse file imports the 4-seat index or names SIZE / squareName / parseSquare / fromDisplay / getFourPlayerCellSize / geometryOf', () => {
    const forbidden = /\b(SIZE|VALID|squareName|parseSquare|fromDisplay|getFourPlayerCellSize|getChaturajiCellSize|geometryOf|moveLabel)\b/;
    for (const file of UI) {
      const sf = source(file);
      sf.forEachChild((node) => {
        if (ts.isImportDeclaration(node)) {
          const from = (node.moduleSpecifier as ts.StringLiteral).text;
          // the 4-seat SEAT CONFIG (setup.ts: human / bot per seat) and the bot roster names are shared on purpose; the 4-seat board code is not
          if (/fourPlayer(\/index)?$/.test(from)) throw new Error(`${file} imports the 4-seat index (${from})`);
          for (const element of node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) ? node.importClause.namedBindings.elements : []) {
            expect(forbidden.test(element.name.text), `${file} imports ${element.name.text}`).toBe(false);
          }
        }
      });
    }
  });

  it('a test id or label that names a SQUARE also names its BOARD (scanned in the components and screens)', () => {
    for (const file of UI.filter((f) => f.endsWith('.tsx'))) {
      const sf = source(file);
      const visit = (node: ts.Node) => {
        if (ts.isJsxAttribute(node) && /^(testID|accessibilityLabel)$/.test(node.name.getText(sf)) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isTemplateExpression(node.initializer.expression)) {
          const text = node.initializer.expression.getText(sf);
          if (/\$\{\s*square\s*\}/.test(text)) expect(/\$\{\s*(place\.)?board\s*\}/.test(text), `${file}: ${text} names a square but not its board`).toBe(true);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  });

  it('the gesture seam is filed under the board (several boards on one screen must not share a gesture slot)', () => {
    const board = readFileSync(`${ROOT}/components/BughouseBoard.tsx`, 'utf8');
    expect(board).toMatch(/seamKey:\s*board/);
  });
});
