import { describe, expect, it } from 'vitest';
import {
  evalToWhiteFillPercent,
  evalToWinPercent,
  evaluationToComparable,
  formatEvaluation,
  formatEvaluationCompact,
  toWhitePerspective,
} from '../analysis';

describe('evaluationToComparable', () => {
  it('returns the cp value unchanged for a centipawn evaluation', () => {
    expect(evaluationToComparable({ type: 'cp', value: 150 })).toBe(150);
    expect(evaluationToComparable({ type: 'cp', value: -80 })).toBe(-80);
  });

  it('a closer mate for the side to move compares as strictly better than a farther one', () => {
    const mateIn2 = evaluationToComparable({ type: 'mate', value: 2 });
    const mateIn8 = evaluationToComparable({ type: 'mate', value: 8 });
    expect(mateIn2).toBeGreaterThan(mateIn8);
  });

  it('being mated is always worse than any ordinary centipawn score, however bad', () => {
    const beingMatedIn2 = evaluationToComparable({ type: 'mate', value: -2 });
    const terribleCp = evaluationToComparable({ type: 'cp', value: -9000 });
    expect(beingMatedIn2).toBeLessThan(terribleCp);
  });

  it('any mate-for-me score beats any ordinary centipawn score, however good', () => {
    const mateIn10 = evaluationToComparable({ type: 'mate', value: 10 });
    const greatCp = evaluationToComparable({ type: 'cp', value: 9000 });
    expect(mateIn10).toBeGreaterThan(greatCp);
  });
});

describe('toWhitePerspective', () => {
  it('leaves an evaluation unchanged when it is already White to move', () => {
    const evaluation = { type: 'cp' as const, value: 120 };
    expect(toWhitePerspective(evaluation, 'w')).toEqual(evaluation);
  });

  it('flips the sign when the side to move is Black', () => {
    expect(toWhitePerspective({ type: 'cp', value: 120 }, 'b')).toEqual({ type: 'cp', value: -120 });
    expect(toWhitePerspective({ type: 'mate', value: 3 }, 'b')).toEqual({ type: 'mate', value: -3 });
  });
});

describe('formatEvaluation / formatEvaluationCompact', () => {
  it('formats a centipawn score as signed pawns with one decimal', () => {
    expect(formatEvaluation({ type: 'cp', value: 230 })).toBe('+2.3');
    expect(formatEvaluation({ type: 'cp', value: -40 })).toBe('-0.4');
    expect(formatEvaluation({ type: 'cp', value: 0 })).toBe('0.0'); // zero gets no "+" prefix
  });

  it('formats mate scores distinctly from centipawns, both long and compact forms', () => {
    expect(formatEvaluation({ type: 'mate', value: 3 })).toBe('Mate in 3');
    expect(formatEvaluation({ type: 'mate', value: -3 })).toBe('-Mate in 3');
    expect(formatEvaluation({ type: 'mate', value: 0 })).toBe('#');

    expect(formatEvaluationCompact({ type: 'mate', value: 3 })).toBe('M3');
    expect(formatEvaluationCompact({ type: 'mate', value: -3 })).toBe('-M3');
    expect(formatEvaluationCompact({ type: 'cp', value: 230 })).toBe('+2.3');
  });
});

describe('evalToWinPercent', () => {
  it('a dead-even position is exactly 50%', () => {
    expect(evalToWinPercent(0)).toBeCloseTo(50, 5);
  });

  it('is monotonically increasing in the evaluation (strictly better eval -> strictly higher win%)', () => {
    const samples = [-5000, -1000, -200, 0, 200, 1000, 5000];
    const winPercents = samples.map(evalToWinPercent);
    for (let i = 1; i < winPercents.length; i++) {
      expect(winPercents[i]).toBeGreaterThan(winPercents[i - 1]);
    }
  });

  it('saturates toward 0/100 for huge (effectively-mate) values without ever exceeding the range', () => {
    expect(evalToWinPercent(100000)).toBeLessThanOrEqual(100);
    expect(evalToWinPercent(100000)).toBeGreaterThan(99);
    expect(evalToWinPercent(-100000)).toBeGreaterThanOrEqual(0);
    expect(evalToWinPercent(-100000)).toBeLessThan(1);
  });
});

describe('evalToWhiteFillPercent', () => {
  it('a real forced mate saturates to exactly 0 or 100, not just "close"', () => {
    expect(evalToWhiteFillPercent({ type: 'mate', value: 4 })).toBe(100);
    expect(evalToWhiteFillPercent({ type: 'mate', value: -4 })).toBe(0);
  });

  it('a dead-even position (mate value 0, meaning stalemate-ish/no mate) is exactly 50', () => {
    expect(evalToWhiteFillPercent({ type: 'mate', value: 0 })).toBe(50);
  });

  it('an ordinary centipawn evaluation goes through the same logistic curve as evalToWinPercent', () => {
    expect(evalToWhiteFillPercent({ type: 'cp', value: 300 })).toBeCloseTo(evalToWinPercent(300), 5);
  });
});
