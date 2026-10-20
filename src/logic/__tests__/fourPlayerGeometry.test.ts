import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { recordGeometryHashes, recordGeometrySections } from './fourPlayerGeometryKit';

/**
 * The geometry identity gate (CHATURAJI_SPEC.md sections 8.2 and 11): the 14x14 cross board's tables, mask, forward directions, display rotation,
 * square names and start layout, read through the engine's public exports, hash to what was recorded BEFORE Chaturaji W0 extracted the geometry
 * into an object. The sections are hashed separately so a failure names the table that moved. See fourPlayerGeometryKit.ts.
 */
const golden: Record<string, string> = JSON.parse(readFileSync(`${__dirname}/fixtures/fourPlayerGeometryGolden.json`, 'utf8'));

describe('cross-board geometry is byte-identical to the recorded one', () => {
  const hashes = recordGeometryHashes();

  it('the fixture and the kit cover the same sections', () => {
    expect(Object.keys(hashes).sort()).toEqual(Object.keys(golden).sort());
  });

  it.each(Object.keys(golden))('section %s', (name) => {
    expect(hashes[name]).toBe(golden[name]);
  });

  it('sanity: the recorded tables are the ones the board comment describes (14x14, 160 playable squares, 196 cells)', () => {
    const sections = recordGeometrySections();
    expect(sections.constants).toContain('"SIZE":14');
    expect(sections.constants).toContain('"CELLS":196');
    expect(sections.playable.split(',')).toHaveLength(160);
    expect(sections.valid.split(',').filter((v) => v === '1')).toHaveLength(160);
  });
});
