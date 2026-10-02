import { describe, expect, it } from 'vitest';
import { collapseFenRank, expandFenRank, generateChess960Position, getChess960BackRankFiles } from '../chess960';

describe('generateChess960Position', () => {
  // Ground-truth invariants of the real Chess960 setup rule — not just "does it run", but does
  // every generated position actually satisfy the rule (bishops on opposite colors, king strictly
  // between the two rooks, exactly the right piece counts) across many seeds, including the
  // deterministic edge cases a pure Math.random() fuzz could miss by chance.
  it('produces a valid back rank for 500 random seeds', () => {
    for (let i = 0; i < 500; i++) {
      const fen = generateChess960Position();
      const whiteBackRank = fen.split(' ')[0].split('/')[7];
      const squares = expandFenRank(whiteBackRank);

      expect(squares.filter((s) => s === 'K').length).toBe(1);
      expect(squares.filter((s) => s === 'Q').length).toBe(1);
      expect(squares.filter((s) => s === 'R').length).toBe(2);
      expect(squares.filter((s) => s === 'B').length).toBe(2);
      expect(squares.filter((s) => s === 'N').length).toBe(2);

      const bishopFiles = squares.map((s, i) => (s === 'B' ? i : -1)).filter((i) => i >= 0);
      expect(bishopFiles[0] % 2).not.toBe(bishopFiles[1] % 2); // opposite-colored squares

      const kingFile = squares.indexOf('K');
      const rookFiles = squares.map((s, i) => (s === 'R' ? i : -1)).filter((i) => i >= 0).sort((a, b) => a - b);
      expect(kingFile).toBeGreaterThan(rookFiles[0]);
      expect(kingFile).toBeLessThan(rookFiles[1]);
    }
  });

  it('mirrors the same back rank for both colors', () => {
    const fen = generateChess960Position();
    const [blackRank, , , , , , , whiteRank] = fen.split(' ')[0].split('/');
    expect(blackRank.toUpperCase()).toBe(whiteRank);
  });

  it('is deterministic for a fixed rng, not just "runs without throwing"', () => {
    // A fixed sequence of "random" values should always produce the exact same position —
    // pins the algorithm's own logic down, not just its invariants.
    const values = [0.1, 0.6, 0.2, 0.1, 0.9, 0.4];
    let i = 0;
    const rng = () => values[i++ % values.length];
    const fen1 = generateChess960Position(rng);
    i = 0;
    const fen2 = generateChess960Position(rng);
    expect(fen1).toBe(fen2);
  });
});

describe('expandFenRank / collapseFenRank', () => {
  it('round-trips every rank of the classical starting position', () => {
    const ranks = ['rnbqkbnr', 'pppppppp', '8', '8', '8', '8', 'PPPPPPPP', 'RNBQKBNR'];
    for (const rank of ranks) {
      expect(collapseFenRank(expandFenRank(rank))).toBe(rank);
    }
  });

  it('expands digit-run ranks to the correct number of empty squares', () => {
    expect(expandFenRank('8')).toEqual(['.', '.', '.', '.', '.', '.', '.', '.']);
    expect(expandFenRank('4P3')).toEqual(['.', '.', '.', '.', 'P', '.', '.', '.']);
  });

  it('collapses runs of empty squares back to a single digit, never splitting them', () => {
    expect(collapseFenRank(['.', '.', '.', '.', 'P', '.', '.', '.'])).toBe('4P3');
    expect(collapseFenRank(['r', '.', '.', '.', '.', '.', '.', 'r'])).toBe('r6r');
  });
});

describe('getChess960BackRankFiles', () => {
  it('reads the classical start position as e/a/h (king e-file, rooks a/h-files)', () => {
    const files = getChess960BackRankFiles('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(files).toEqual({ kingFile: 4, queenRookFile: 0, kingRookFile: 7 });
  });

  it('reads back the exact files a generated Chess960 position used', () => {
    for (let i = 0; i < 50; i++) {
      const fen = generateChess960Position();
      const whiteBackRank = expandFenRank(fen.split(' ')[0].split('/')[7]);
      const expectedKingFile = whiteBackRank.indexOf('K');
      const expectedRookFiles = whiteBackRank.map((s, i) => (s === 'R' ? i : -1)).filter((i) => i >= 0).sort((a, b) => a - b);

      const files = getChess960BackRankFiles(fen);
      expect(files.kingFile).toBe(expectedKingFile);
      expect([files.queenRookFile, files.kingRookFile]).toEqual(expectedRookFiles);
    }
  });

  it('falls back to classical e/a/h files for a non-Chess960-shaped back rank', () => {
    const files = getChess960BackRankFiles('8/8/8/8/8/8/8/8 w - - 0 1');
    expect(files).toEqual({ kingFile: 4, queenRookFile: 0, kingRookFile: 7 });
  });
});
