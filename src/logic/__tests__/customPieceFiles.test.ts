import { describe, expect, it } from 'vitest';
import { hasDataUriImages, isDataUri, migrateDataUriImages, removePieceImages, splitDataUri, writePieceImages, type PieceFileStore } from '../customPieceFiles';

/**
 * A CUSTOM PIECE THEME AS FILES (command #27d): the 12 picked images are written one file each under piece-themes/<theme id>/, the record keeps the file URIs, and a data URI is never what a phone's
 * Image is handed. The store is a memory one here; pieceFileStore.ts (expo-file-system) is the phone's. The ids, the folder names and the extensions are literals.
 */
const KEYS = ['wk', 'wq', 'wr', 'wb', 'wn', 'wp', 'bk', 'bq', 'br', 'bb', 'bn', 'bp'];

function memoryStore(options: { failOn?: string } = {}) {
  const files = new Map<string, string>();
  const removed: string[] = [];
  const store: PieceFileStore = {
    async writeBase64(dir, name, base64) {
      if (options.failOn === name) throw new Error('disk full');
      const uri = `file:///app/piece-themes/${dir}/${name}`;
      files.set(uri, base64);
      return uri;
    },
    async removeDirectory(dir) {
      removed.push(dir);
      for (const uri of [...files.keys()]) if (uri.startsWith(`file:///app/piece-themes/${dir}/`)) files.delete(uri);
    },
  };
  return { store, files, removed };
}

const draft = (): Record<string, string> => Object.fromEntries(KEYS.map((key, i) => [key, `data:image/png;base64,PAYLOAD${i}`]));

describe('splitDataUri', () => {
  it('takes the extension and the bare payload of a PNG or WebP data URI, and nothing else', () => {
    expect(splitDataUri('data:image/png;base64,AAA=')).toEqual({ extension: 'png', base64: 'AAA=' });
    expect(splitDataUri('data:image/webp;base64,BBB=')).toEqual({ extension: 'webp', base64: 'BBB=' });
    expect(splitDataUri('data:image/jpeg;base64,CCC=')).toBeNull();
    expect(splitDataUri('file:///a.png')).toBeNull();
    expect(isDataUri('data:image/png;base64,AAA=')).toBe(true);
    expect(isDataUri('file:///a.png')).toBe(false);
    expect(isDataUri(7)).toBe(false);
  });
});

describe('writePieceImages', () => {
  it('writes one file per piece under the theme\'s own folder and returns the file URIs, never a data URI', async () => {
    const { store, files } = memoryStore();
    const out = await writePieceImages('custom-1-abc', draft(), store);
    expect(Object.keys(out).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) {
      expect(out[key], key).toBe(`file:///app/piece-themes/custom-1-abc/${key}.png`);
      expect(isDataUri(out[key]), key).toBe(false);
    }
    expect(files.size).toBe(12);
    expect(files.get('file:///app/piece-themes/custom-1-abc/bk.png')).toBe('PAYLOAD6');
    expect(files.get('file:///app/piece-themes/custom-1-abc/wk.png')).toBe('PAYLOAD0');
  });

  it('two themes never share a file URI (the path carries the theme id)', async () => {
    const { store } = memoryStore();
    const a = await writePieceImages('custom-1-aaa', draft(), store);
    const b = await writePieceImages('custom-2-bbb', draft(), store);
    expect(new Set([...Object.values(a), ...Object.values(b)]).size).toBe(24);
  });

  it('keeps a WebP as a .webp file', async () => {
    const { store } = memoryStore();
    const out = await writePieceImages('t', { ...draft(), wk: 'data:image/webp;base64,ZZZ=' }, store);
    expect(out.wk).toBe('file:///app/piece-themes/t/wk.webp');
  });

  it('an image that is already a file URI is kept as it is', async () => {
    const { store, files } = memoryStore();
    const out = await writePieceImages('t', { ...draft(), wk: 'file:///elsewhere/wk.png' }, store);
    expect(out.wk).toBe('file:///elsewhere/wk.png');
    expect(files.size).toBe(11);
  });

  it('a failure part way removes the theme\'s folder and throws: a theme is never left half on disk', async () => {
    const { store, files, removed } = memoryStore({ failOn: 'bq.png' });
    await expect(writePieceImages('custom-9-zzz', draft(), store)).rejects.toThrow('disk full');
    expect(removed).toEqual(['custom-9-zzz']);
    expect(files.size).toBe(0);
  });

  it('refuses a picked image that is neither a PNG / WebP data URI nor a file, and a bundled asset id', async () => {
    const { store, removed } = memoryStore();
    await expect(writePieceImages('t', { ...draft(), wk: 'data:image/jpeg;base64,QQ==' }, store)).rejects.toThrow('wk');
    await expect(writePieceImages('t', { ...draft(), wk: 12 }, store)).rejects.toThrow('wk');
    expect(removed).toEqual(['t', 't']);
  });
});

describe('migrating an old record (data URIs) into files', () => {
  it('moves a record that holds data URIs, and says there is nothing to move for one that holds files', async () => {
    const { store, files } = memoryStore();
    expect(hasDataUriImages(draft())).toBe(true);
    const moved = await migrateDataUriImages('old-1', draft(), store);
    expect(moved).not.toBeNull();
    expect(Object.values(moved as Record<string, string>).every((uri) => uri.startsWith('file:///app/piece-themes/old-1/'))).toBe(true);
    expect(files.size).toBe(12);
    expect(hasDataUriImages(moved as Record<string, string>)).toBe(false);
    expect(await migrateDataUriImages('old-1', moved as Record<string, string>, store)).toBeNull();
  });

  it('a record that holds SOME data URIs and some files is old too: the data URIs move, the files stay', async () => {
    const { store, files } = memoryStore();
    const mixed = { ...draft(), wk: 'file:///elsewhere/wk.png' };
    expect(hasDataUriImages(mixed)).toBe(true);
    expect(hasDataUriImages({ wk: 'file:///a.png', bk: 'file:///b.png' })).toBe(false);
    const moved = (await migrateDataUriImages('old-3', mixed, store)) as Record<string, string>;
    expect(moved.wk).toBe('file:///elsewhere/wk.png');
    expect(moved.bk).toBe('file:///app/piece-themes/old-3/bk.png');
    expect(files.size).toBe(11);
  });

  it('a failed move leaves the old record as it is (null), with nothing half written', async () => {
    const { store, files } = memoryStore({ failOn: 'wp.png' });
    expect(await migrateDataUriImages('old-2', draft(), store)).toBeNull();
    expect(files.size).toBe(0);
  });
});

describe('removePieceImages', () => {
  it('removes exactly that theme\'s folder, and a store that throws is not an error', async () => {
    const { store, files, removed } = memoryStore();
    await writePieceImages('keep', draft(), store);
    await writePieceImages('drop', draft(), store);
    await removePieceImages('drop', store);
    expect(removed).toEqual(['drop']);
    expect(files.size).toBe(12);
    await expect(removePieceImages('x', { writeBase64: async () => '', removeDirectory: async () => Promise.reject(new Error('gone')) })).resolves.toBeUndefined();
  });
});
