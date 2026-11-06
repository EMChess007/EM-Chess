import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openProgress, progressKey } from '../../../scripts/browser/android-matrix-progress.mjs';

/**
 * THE MATRIX'S RESUMABLE PROGRESS FILE (command #27d): a finished screen is written the moment it is done, a restart skips it and reads its results back, a file of another run is
 * refused, and a line cut short by a kill is ignored. Keys, headers and counts are literals.
 */
const dirs: string[] = [];
const fileIn = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'matrix-progress-'));
  dirs.push(dir);
  return path.join(dir, 'progress.jsonl');
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const HEADER = { profile: 'full', screens: ['home', 'piece-gallery'] };

describe('openProgress', () => {
  it('a new file gets the header line and nothing is done yet', () => {
    const file = fileIn();
    const progress = openProgress(file, HEADER);
    expect(progress.done.size).toBe(0);
    expect(progress.results).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe(`${JSON.stringify({ header: HEADER })}\n`);
  });

  it('save() writes the screen at once, and a restart skips it and reads its results back', () => {
    const file = fileIn();
    const first = openProgress(file, HEADER);
    first.save('1|light|home', [{ screen: 'home', combo: 'a', issues: [] }, { screen: 'home', combo: 'b', issues: [{ kind: 'clip' }] }]);
    expect(first.done.has('1|light|home')).toBe(true);
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2);
    const second = openProgress(file, HEADER);
    expect([...second.done]).toEqual(['1|light|home']);
    expect(second.results).toEqual([{ screen: 'home', combo: 'a', issues: [] }, { screen: 'home', combo: 'b', issues: [{ kind: 'clip' }] }]);
  });

  it('refuses a file that is a run of another profile or of another list of screens', () => {
    const file = fileIn();
    openProgress(file, HEADER);
    expect(() => openProgress(file, { ...HEADER, profile: 'quick' })).toThrow('delete it');
    expect(() => openProgress(file, { ...HEADER, screens: ['home'] })).toThrow('delete it');
  });

  it('refuses a file whose first line is not a header', () => {
    const file = fileIn();
    writeFileSync(file, 'not json\n');
    expect(() => openProgress(file, HEADER)).toThrow('no readable header');
  });

  it('ignores a last line cut short by a kill (its screen runs again) and a line of the wrong shape', () => {
    const file = fileIn();
    const first = openProgress(file, HEADER);
    first.save('1|light|home', [{ screen: 'home', combo: 'a', issues: [] }]);
    appendFileSync(file, '{"done":"1|light|piece-gall');
    appendFileSync(file, '\n{"done":5,"results":[]}\n');
    const second = openProgress(file, HEADER);
    expect([...second.done]).toEqual(['1|light|home']);
    expect(second.results).toHaveLength(1);
  });

  it('a broken line in the MIDDLE costs only its own screen: the finished screens after it are still read', () => {
    const file = fileIn();
    const first = openProgress(file, HEADER);
    first.save('1|light|home', [{ screen: 'home', combo: 'a', issues: [] }]);
    appendFileSync(file, '{"done":"1|light|piece-gall\n');
    first.save('1|dark|home', [{ screen: 'home', combo: 'b', issues: [] }]);
    const second = openProgress(file, HEADER);
    expect([...second.done]).toEqual(['1|light|home', '1|dark|home']);
    expect(second.results.map((r: { combo: string }) => r.combo)).toEqual(['a', 'b']);
  });

  it('the header line is never a finished screen: it has no "done" key, so reading from line 0 or 1 gives the same answer (the proof that the slice is equivalent)', () => {
    const file = fileIn();
    openProgress(file, HEADER);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(Object.keys(JSON.parse(lines[0]))).toEqual(['header']);
    expect(openProgress(file, HEADER).done.size).toBe(0);
    expect(openProgress(file, HEADER).results).toEqual([]);
  });

  it('an empty file is a new file', () => {
    const file = fileIn();
    writeFileSync(file, '');
    expect(openProgress(file, HEADER).done.size).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(`${JSON.stringify({ header: HEADER })}\n`);
  });
});

describe('progressKey', () => {
  it('is scale, theme and screen id, joined by bars', () => {
    expect(progressKey({ scale: 1.3, theme: 'dark' }, 'piece-gallery')).toBe('1.3|dark|piece-gallery');
  });
});
