import { describe, expect, it } from 'vitest';
import { fitStackedCell, STACKED_BOARD_ROWS } from '../bughouseLayout';

/**
 * The stacked two-board layout sizes its boards from the room the scroll view really has (Bughouse polish). `fitStackedCell(current, viewportHeight, contentHeight, maxByWidth, floor)`:
 * `current` plus whole cells for the free space (16 board rows share it), never above what the width allows, never below `floor`. The numbers are literals.
 */
describe('fitStackedCell', () => {
  it('there are 16 board rows in the stacked layout', () => {
    expect(STACKED_BOARD_ROWS).toBe(16);
  });

  it('content that fits exactly keeps its cell', () => {
    expect(fitStackedCell(30, 600, 600, 43, 28)).toBe(30);
  });

  it('free space is spent in whole cells of 16 px: 15 px buys nothing, 16 buys one, 45 buy two', () => {
    expect(fitStackedCell(30, 615, 600, 43, 28)).toBe(30);
    expect(fitStackedCell(30, 616, 600, 43, 28)).toBe(31);
    expect(fitStackedCell(30, 645, 600, 43, 28)).toBe(32);
  });

  it('content that overflows takes a cell back for every started 16 px: 1 px over is one cell, 12 px over (the measured chrome gap) is one, 17 px over is two', () => {
    expect(fitStackedCell(31, 740, 741, 43, 28)).toBe(30);
    expect(fitStackedCell(31, 740, 752, 43, 28)).toBe(30);
    expect(fitStackedCell(31, 740, 757, 43, 28)).toBe(29);
  });

  it('never wider than the window allows', () => {
    expect(fitStackedCell(40, 2000, 600, 43, 28)).toBe(43);
    expect(fitStackedCell(43, 600, 600, 43, 28)).toBe(43);
  });

  it('never below the floor: when even the floor does not fit the screen scrolls', () => {
    expect(fitStackedCell(30, 500, 900, 43, 28)).toBe(28);
  });

  it('a floor below the table cell (a window the table already calls too small) is kept, not raised to 28', () => {
    expect(fitStackedCell(26, 668, 672, 43, 26)).toBe(26);
  });

  it('a window narrower than the floor is limited by its width', () => {
    expect(fitStackedCell(20, 900, 600, 20, 28)).toBe(20);
  });

  it('one step reaches the answer: the chrome does not depend on the cell', () => {
    const chrome = 300;
    const viewport = 784;
    const first = fitStackedCell(31, viewport, 16 * 31 + chrome, 43, 28);
    expect(first).toBe(30);
    expect(fitStackedCell(first, viewport, 16 * first + chrome, 43, 28)).toBe(30);
  });
});
