import { describe, expect, it } from 'vitest';
import { isClockReading } from '../AppText';

/**
 * In the Android end-to-end build a text that is only a clock reading is hidden from the accessibility event stream (AppText.tsx, command #30), so `uiautomator dump` can reach an idle UI on a
 * game screen. This pins what counts as a clock reading: every clock the app draws, and nothing a user reads.
 */
describe('isClockReading', () => {
  it('accepts the readings of the clocks', () => {
    for (const reading of ['5:00', '0:59', '12:34', '1:00:00', '0:05.3', '59.9', ' 4:59 ']) expect(isClockReading(reading), reading).toBe(true);
    expect(isClockReading(['4', ':', '09'])).toBe(true);
    expect(isClockReading(459)).toBe(false); // a bare number is a score or a count, not a clock
  });

  it('refuses everything else', () => {
    for (const text of ['', 'Resign', 'White to move', '5 min', '3 | 2', '1.5x', 'Move 12:', 'Rating 1:2:3:4', 'Score 10:5', '12:345']) expect(isClockReading(text), text).toBe(false);
    expect(isClockReading(undefined)).toBe(false);
    expect(isClockReading(['4', { a: 1 }, '09'])).toBe(false);
    expect(isClockReading(null)).toBe(false);
  });
});
