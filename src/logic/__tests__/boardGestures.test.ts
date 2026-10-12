import { describe, expect, it } from 'vitest';
import { LONG_PRESS_MS, MOVE_THRESHOLD_PX, decideRelease, pixelToCell } from '../boardGestures';

const start = { row: 6, col: 4 };
const elsewhere = { row: 4, col: 4 };

describe('pixelToCell (shared by the 8 x 8 and the 14 x 14 board)', () => {
  it('maps pixels to the cell under them, row from the top and col from the left', () => {
    expect(pixelToCell(0, 0, 44, 8, 8)).toEqual({ row: 0, col: 0 });
    expect(pixelToCell(43.9, 43.9, 44, 8, 8)).toEqual({ row: 0, col: 0 });
    expect(pixelToCell(44, 44, 44, 8, 8)).toEqual({ row: 1, col: 1 });
    expect(pixelToCell(217, 442 - 158, 44, 8, 8)).toEqual({ row: 6, col: 4 });
    expect(pixelToCell(25 * 13 + 1, 25 * 7 + 3, 25, 14, 14)).toEqual({ row: 7, col: 13 });
  });

  it('clamps a finger that slips off the board onto the nearest edge cell, using the grid it was given', () => {
    expect(pixelToCell(-20, -5, 44, 8, 8)).toEqual({ row: 0, col: 0 });
    expect(pixelToCell(9999, 9999, 44, 8, 8)).toEqual({ row: 7, col: 7 });
    expect(pixelToCell(9999, 9999, 25, 14, 14)).toEqual({ row: 13, col: 13 }); // not a hard-coded 8
    expect(pixelToCell(9999, 0, 25, 14, 14)).toEqual({ row: 0, col: 13 });
  });
});

describe('what a finished touch means (decideRelease)', () => {
  it('a stationary release is a tap on the cell it ended on, however long it was held', () => {
    expect(decideRelease({ armed: false, distance: 0, startCell: start, endCell: start })).toEqual({ kind: 'tap', cell: start });
    // The old bug: a slow tap (held past the long-press time, so the arrow was "armed") was swallowed as an annotation.
    expect(decideRelease({ armed: true, distance: 0, startCell: start, endCell: start })).toEqual({ kind: 'tap', cell: start });
    expect(decideRelease({ armed: true, distance: 3, startCell: start, endCell: elsewhere })).toEqual({ kind: 'tap', cell: elsewhere });
  });

  it('the tap threshold is inclusive: exactly MOVE_THRESHOLD_PX is still a tap, anything more is a drag', () => {
    expect(MOVE_THRESHOLD_PX).toBe(10);
    expect(decideRelease({ armed: true, distance: MOVE_THRESHOLD_PX, startCell: start, endCell: elsewhere }).kind).toBe('tap');
    expect(decideRelease({ armed: true, distance: MOVE_THRESHOLD_PX + 0.01, startCell: start, endCell: elsewhere }).kind).toBe('arrow');
    expect(decideRelease({ armed: false, distance: MOVE_THRESHOLD_PX + 0.01, startCell: start, endCell: elsewhere }).kind).toBe('ignore');
  });

  it('a long-press-drag released on another cell is an arrow from where it started to where it ended', () => {
    expect(decideRelease({ armed: true, distance: 80, startCell: start, endCell: elsewhere })).toEqual({ kind: 'arrow', from: start, to: elsewhere });
  });

  it('a long-press that wandered but came back to its own cell is a highlight on that cell', () => {
    expect(decideRelease({ armed: true, distance: 40, startCell: start, endCell: start })).toEqual({ kind: 'highlight', cell: start });
  });

  it('a drag that never armed (too fast: a scroll or swipe) does nothing — it never acts on the cell it happened to end on', () => {
    expect(decideRelease({ armed: false, distance: 120, startCell: start, endCell: elsewhere })).toEqual({ kind: 'ignore' });
    expect(decideRelease({ armed: false, distance: 120, startCell: start, endCell: start })).toEqual({ kind: 'ignore' });
  });

  it('the long-press delay is long enough that an ordinary quick tap never arms', () => {
    expect(LONG_PRESS_MS).toBe(400);
  });
});
