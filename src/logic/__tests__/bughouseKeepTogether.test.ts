import { describe, expect, it } from 'vitest';
import { keepTogether, seatRowLabel } from '../bughouseLayout';

/**
 * On a real phone the Bughouse setup row "Board A · White · Team 1" wrapped as "Team" / "1". What is DRAWN now goes through `keepTogether`: the space between "Team" / "Board" and its
 * number or letter is a no-break space (U+00A0, written as an escape here so the test shows it). The data (`seatRowLabel(...).text`, accessibility labels) keeps ordinary spaces.
 */
describe('keepTogether: "Team 1" and "Board A" never break across lines', () => {
  it('turns the space after Team / Board into a no-break space when a letter or digit follows', () => {
    expect(keepTogether('Board A · White · Team 1')).toBe('Board A · White · Team 1');
    expect(keepTogether('Resign ◆ Team 2')).toBe('Resign ◆ Team 2');
    expect(keepTogether('Team 1 is Board A White and Board B Black; Team 2 is the rest')).toBe('Team 1 is Board A White and Board B Black; Team 2 is the rest');
  });

  it('leaves every other space alone (the row can still wrap at the dots)', () => {
    expect(keepTogether('Team players')).toBe('Team players'); // a word, not a number or a board letter
    expect(keepTogether('Board games and Teams 1')).toBe('Board games and Teams 1');
    expect(keepTogether('A · B')).toBe('A · B');
    expect(keepTogether('')).toBe('');
  });

  it('the seat labels themselves keep ordinary spaces (the accessibility label and the tests read them)', () => {
    expect(seatRowLabel(0).text).toBe('Board A · White · Team 1');
    expect(seatRowLabel(0).text).not.toContain(' ');
  });
});
