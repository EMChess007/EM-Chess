import { describe, expect, it } from 'vitest';
import { freezeClockText, isClockReading } from '../AppText';

/**
 * In the Android end-to-end build the digits of a clock reading are frozen at 0:00 (AppText.tsx, command #30), so the text never changes and `uiautomator dump` can reach an idle UI on a
 * game screen. This pins what counts as a clock reading: every clock the app draws, and nothing a user reads.
 */
describe('isClockReading', () => {
  it('accepts the readings of the clocks', () => {
    for (const reading of ['5:00', '0:59', '12:34', '1:00:00', '0:05.3', '59.9', ' 4:59 ']) expect(isClockReading(reading), reading).toBe(true);
    expect(isClockReading(['4', ':', '09'])).toBe(true);
    // the local screens write the player and the clock in one Text ("White: 4:59"): the label counts, a number elsewhere in a sentence does not
    for (const label of ['White: 4:59', 'Black: 0:05.3', 'Black - 1:00:00', ['White', ': 5:00'], 'Guest 12:00']) expect(isClockReading(label), JSON.stringify(label)).toBe(true);
    expect(isClockReading('10:30 pm tomorrow')).toBe(false);
    expect(isClockReading(459)).toBe(false); // a bare number is a score or a count, not a clock
  });

  it('refuses everything else', () => {
    for (const text of ['', 'Resign', 'White to move', '5 min', '3 | 2', '1.5x', 'Move 12:', 'Rating 1:2:3:4', 'Score 10:5', '12:345']) expect(isClockReading(text), text).toBe(false);
    expect(isClockReading(undefined)).toBe(false);
    expect(isClockReading(['4', { a: 1 }, '09'])).toBe(false);
    expect(isClockReading(null)).toBe(false);
  });
});

describe('freezeClockText', () => {
  it('replaces the digits of a clock at the end of a label with 0:00 and touches nothing else', () => {
    expect(freezeClockText('White: 4:59')).toBe('White: 0:00');
    expect(freezeClockText('4:59.8')).toBe('0:00');
    expect(freezeClockText('Black - 1:00:00 ')).toBe('Black - 0:00 ');
    expect(freezeClockText('59.9')).toBe('0:00');
    expect(freezeClockText(['White', ': 12:07'])).toEqual(['White', ': 0:00']);
    expect(freezeClockText('Resign')).toBe('Resign');
    expect(freezeClockText(['Move ', 12])).toEqual(['Move ', 12]);
    expect(freezeClockText(undefined)).toBeUndefined();
    // a frozen reading is still a reading, and is stable: freezing it again changes nothing
    expect(isClockReading(freezeClockText('White: 4:59'))).toBe(true);
    expect(freezeClockText(freezeClockText('White: 4:59'))).toBe('White: 0:00');
  });
});
