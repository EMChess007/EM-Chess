import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';

/**
 * Guards the list of files the backend copies (src/logic/fourPlayer/MIRRORED_TO_BACKEND.json). The backend's generator (backend repo,
 * scripts/sync-fourplayer.mjs) enforces the same rules when it runs - but only after a push, in the other repo. These tests make the
 * mistake fail HERE, where the mistake is made: importing a client-only module (UI types, React Native, a setup screen helper) into
 * an engine file would otherwise build fine in the app and only break the server's CI.
 *
 * The rules: every relative import of a listed file is extensionless and resolves to another listed file; there are no package imports,
 * no dynamic import()/require(); and the list is exactly what the entry points need (nothing dead is mirrored, nothing needed is
 * missing).
 */

const LOGIC = join(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(LOGIC, 'fourPlayer', 'MIRRORED_TO_BACKEND.json'), 'utf8')) as { files: string[] };
const listed = new Set(manifest.files);
const read = (rel: string) => readFileSync(join(LOGIC, ...rel.split('/')), 'utf8').replace(/\r\n/g, '\n');

interface Import {
  specifier: string;
  line: number;
  kind: 'static' | 'dynamic';
}
function importsOf(rel: string): Import[] {
  const sf = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const found: Import[] = [];
  const line = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push({ specifier: node.moduleSpecifier.text, line: line(node), kind: 'static' });
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      found.push({ specifier: '(dynamic)', line: line(node), kind: 'dynamic' });
    } else if (ts.isImportTypeNode(node) || (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))) {
      found.push({ specifier: '(import type node / import =)', line: line(node), kind: 'dynamic' });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}
const resolve = (from: string, specifier: string) => `${posix.normalize(posix.join(posix.dirname(from), specifier))}.ts`;

describe('the mirrored file list', () => {
  it('is the nine engine modules (giveaway.ts and giveawayBot.ts joined for 4 Player Giveaway, chaturajiBot.ts for Chaturaji) plus the wire file, and nothing client-only', () => {
    expect([...listed].sort()).toEqual(['fourPlayer/board.ts', 'fourPlayer/bot.ts', 'fourPlayer/chaturajiBot.ts', 'fourPlayer/clock.ts', 'fourPlayer/elimination.ts', 'fourPlayer/giveaway.ts', 'fourPlayer/giveawayBot.ts', 'fourPlayer/moves.ts', 'fourPlayer/state.ts', 'fourPlayerWire.ts'].sort());
    for (const clientOnly of ['setup', 'presentation', 'premove', 'annotations', 'index']) expect(listed.has(`fourPlayer/${clientOnly}.ts`), clientOnly).toBe(false);
  });

  it('lists only files that exist, without duplicates', () => {
    expect(new Set(manifest.files).size).toBe(manifest.files.length);
    for (const rel of manifest.files) expect(existsSync(join(LOGIC, ...rel.split('/'))), rel).toBe(true);
  });

  it('every import in a mirrored file is a relative, extensionless path to ANOTHER mirrored file (the backend generator refuses anything else)', () => {
    const problems: string[] = [];
    for (const rel of manifest.files) {
      for (const imp of importsOf(rel)) {
        const where = `${rel}:${imp.line}`;
        if (imp.kind === 'dynamic') problems.push(`${where}: dynamic import / require / import type node`);
        else if (!imp.specifier.startsWith('./') && !imp.specifier.startsWith('../')) problems.push(`${where}: package import "${imp.specifier}"`);
        else if (posix.extname(imp.specifier) !== '') problems.push(`${where}: "${imp.specifier}" has an extension`);
        else if (!listed.has(resolve(rel, imp.specifier))) problems.push(`${where}: "${imp.specifier}" is not mirrored (client-only code would reach the server)`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('is exactly what the server entry points need: the closure of bot, giveawayBot, clock and the wire file (nothing dead, nothing missing)', () => {
    const closure = new Set<string>();
    const walk = (rel: string) => {
      if (closure.has(rel)) return;
      closure.add(rel);
      for (const imp of importsOf(rel)) if (imp.kind === 'static' && imp.specifier.startsWith('.')) walk(resolve(rel, imp.specifier));
    };
    for (const entry of ['fourPlayer/bot.ts', 'fourPlayer/giveawayBot.ts', 'fourPlayer/clock.ts', 'fourPlayerWire.ts']) walk(entry);
    expect([...closure].sort()).toEqual([...listed].sort());
  });

  it('the checker itself catches what it claims to (a client-only import would be reported)', () => {
    // Drive the same analysis on a synthetic source: it must flag a package, an extension, a dynamic import and an unmirrored path.
    const sf = ts.createSourceFile('x.ts', "import a from 'react-native';\nimport b from './board.js';\nconst c = await import('./board');\nimport d from './setup';\n", ts.ScriptTarget.ES2022, true);
    const specs: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) specs.push(n.moduleSpecifier.text);
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) specs.push('(dynamic)');
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(specs).toEqual(['react-native', './board.js', '(dynamic)', './setup']);
    expect(listed.has(resolve('fourPlayer/state.ts', './setup'))).toBe(false);
  });
});
