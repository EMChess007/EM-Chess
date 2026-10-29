#!/usr/bin/env node
/**
 * Moves every `Text`, `TextInput` and `Pressable` import in the app from react-native to the app's own components (src/components/AppText.tsx, AppPressable.tsx), which carry the bundled
 * font, the line height, the font-scale cap and the 44 dp touch-target floor (TESTING.md "Android text fit and the Android device matrix", CHECKLIST 6b).
 *
 *   node scripts/codemod-app-components.mjs            rewrite the files that still import them from react-native
 *   node scripts/codemod-app-components.mjs --check    only list them (exit 1 when there are some)
 *
 * It exists for the day a branch written before this change (paired/bughouse) is merged with master: its files import the react-native ones, `textFit.test.ts` fails on them, and this
 * rewrites them in one go. Idempotent: a file that is already converted is left alone. It edits only the `import { ... } from 'react-native';` statement and adds the two app imports.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const own = new Set(['AppText.tsx', 'AppPressable.tsx', 'TextFitProbe.tsx'].map((name) => path.join(root, 'src', 'components', name)));

const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'backend' || name === '.git' || name === '__tests__') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(name)) files.push(p);
  }
}
walk(path.join(root, 'src'));
files.push(path.join(root, 'App.tsx'));

const relativeImport = (from, to) => {
  let rel = path.relative(path.dirname(from), to).replace(/\.tsx$/, '').split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
};

const pending = [];
for (const file of files) {
  if (own.has(file)) continue;
  let source = readFileSync(file, 'utf8');
  const statement = /import\s*\{([^}]*)\}\s*from\s*'react-native';/;
  const match = statement.exec(source);
  if (!match) continue;
  const names = match[1].split(',').map((s) => s.trim()).filter(Boolean);
  const texts = names.filter((n) => n === 'Text' || n === 'TextInput');
  const pressable = names.includes('Pressable');
  if (texts.length === 0 && !pressable) continue;
  pending.push(path.relative(root, file));
  if (check) continue;
  const kept = names.filter((n) => n !== 'Pressable' && n !== 'Text' && n !== 'TextInput');
  const lines = [];
  if (kept.length) lines.push(`import { ${kept.join(', ')} } from 'react-native';`);
  if (pressable) lines.push(`import { Pressable } from '${relativeImport(file, path.join(root, 'src/components/AppPressable.tsx'))}';`);
  if (texts.length) lines.push(`import { ${texts.join(', ')} } from '${relativeImport(file, path.join(root, 'src/components/AppText.tsx'))}';`);
  source = source.replace(statement, lines.join('\n'));
  writeFileSync(file, source);
}
console.log(`${pending.length} file(s) ${check ? 'still import Text / TextInput / Pressable from react-native' : 'rewritten'}${pending.length ? ':\n  ' + pending.join('\n  ') : ''}`);
process.exitCode = check && pending.length > 0 ? 1 : 0;
