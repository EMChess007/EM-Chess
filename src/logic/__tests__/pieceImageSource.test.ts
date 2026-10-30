import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pieceImageSource } from '../../components/pieceImageSource';

/**
 * WHAT AN <Image> IS HANDED (command #27d): a bundled asset id goes in as it is, a file URI as `{ uri }`, and no board builds that object itself (one place decides it). A data URI is never
 * what a phone's Image receives for a piece: the source scan below reads every shipped file.
 */
describe('pieceImageSource', () => {
  it('a bundled asset id is the source as it is', () => {
    expect(pieceImageSource(7)).toBe(7);
    expect(pieceImageSource(123456)).toBe(123456);
  });

  it('a file URI is { uri }', () => {
    expect(pieceImageSource('file:///data/user/0/app/files/piece-themes/custom-1-a/wk.png')).toEqual({ uri: 'file:///data/user/0/app/files/piece-themes/custom-1-a/wk.png' });
    expect(pieceImageSource('/assets/pieces/merida/bk.png')).toEqual({ uri: '/assets/pieces/merida/bk.png' });
  });
});

describe('the shipped source', () => {
  const root = process.cwd();
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (name === '__tests__' || name === 'generated' || name === 'node_modules') continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name)) files.push(full);
    }
  };
  walk(path.join(root, 'src'));

  it('no screen or board builds a piece\'s { uri } itself: they all go through pieceImageSource', () => {
    const offenders = files.filter((file) => !file.endsWith('pieceImageSource.ts') && /uri:\s*(images|imageUri|theme\.images|pieceImages|piecePreviews)/.test(readFileSync(file, 'utf8')));
    expect(offenders.map((file) => path.relative(root, file))).toEqual([]);
  });

  it('the files that draw a piece image import pieceImageSource', () => {
    for (const file of ['src/components/Piece.tsx', 'src/components/FourPlayerBoard.tsx', 'src/screens/ThemeSelectScreen.tsx']) {
      const source = readFileSync(path.join(root, file), 'utf8');
      expect(source, file).toContain("from './pieceImageSource'".replace('./', file.startsWith('src/components') ? './' : '../components/'));
      expect(source, file).toContain('pieceImageSource(');
    }
  });

  it('nothing hands a data: URI to a piece image: no source file builds one for the registry or the theme record', () => {
    const offenders = files.filter((file) => /readFileAsDataUri\(/.test(readFileSync(file, 'utf8'))).map((file) => path.relative(root, file));
    // the only reader is the form's DRAFT (the picked bytes), which writes files on save
    expect(offenders.sort()).toEqual(['src/logic/fileReading.ts', 'src/screens/ThemeSelectScreen.tsx']);
  });
});
