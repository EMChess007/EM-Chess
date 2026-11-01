import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MoveListStrip, { MOVE_LINE_HEIGHT, MOVE_STRIP_MIN_HEIGHT } from '../MoveListStrip';
import { declaredStyle } from '../../test/domKit';

/**
 * The horizontal move list above the board (command #32): the move NUMBER and the move sit on ONE line, vertically centred, in every screen that shows it (Local, Bot, Online, Spectator, Engine vs
 * Engine all use this one component). On the phone the moves sat at the TOP of the strip and the numbers lower, because the move's Pressable had the 44 dp touch-target floor inside a 36 dp strip
 * (the text at the top of a 44 dp box, the number centred in the row). jsdom has no layout, so the rendered test pins what makes the centres equal - the two texts have one size and ONE line
 * height, the move's box does not exceed the strip (no 44 dp floor), the row is centre-aligned - and the REAL measurement (the two centres within 1 dp) is the device matrix's `moveList` check
 * on the screen `game-2p-moves` (scripts/browser/android-matrix.mjs, in the quick profile).
 */
const moves = [{ san: 'd4' }, { san: 'Nf6' }, { san: 'e4' }, { san: 'Nxe4' }, { san: 'Nf3' }, { san: 'd6' }];

describe('MoveListStrip', () => {
  it('draws a number before every white move, and every move, with a test id per ply', () => {
    render(<MoveListStrip moves={moves} selectedIndex={5} autoScroll onSelectMove={() => {}} />);
    expect(['0', '2', '4'].map((i) => screen.getByTestId(`movelist-number-${i}`).textContent)).toEqual(['1.', '2.', '3.']);
    expect(['0', '1', '2', '3', '4', '5'].map((i) => screen.getByTestId(`movelist-san-${i}`).textContent)).toEqual(['d4', 'Nf6', 'e4', 'Nxe4', 'Nf3', 'd6']);
    expect(screen.queryByTestId('movelist-number-1')).toBeNull();
  });

  it('the number and the move have the same size and the same line height, so the same vertical centre in a centred row', () => {
    render(<MoveListStrip moves={moves} selectedIndex={-1} autoScroll={false} onSelectMove={() => {}} />);
    const number = declaredStyle(screen.getByTestId('movelist-number-0'));
    const move = declaredStyle(screen.getByTestId('movelist-san-0').querySelector('div,span') as HTMLElement);
    expect(MOVE_LINE_HEIGHT).toBe(18);
    expect(number['font-size']).toBe('13px');
    expect(move['font-size']).toBe('13px');
    expect(number['line-height']).toBe('18px');
    expect(move['line-height']).toBe('18px');
  });

  it('the move button is compact (no 44 dp floor inside the 36 dp strip) and the strip only has a minimum height, so it grows with the text', () => {
    render(<MoveListStrip moves={moves} selectedIndex={-1} autoScroll={false} onSelectMove={() => {}} />);
    const button = declaredStyle(screen.getByTestId('movelist-san-0'));
    expect(button['min-height']).not.toBe('44px'); // (react-native-web's own reset is 0px; the floor of AppPressable is what must be absent)
    expect(button['min-width']).not.toBe('44px');
    expect(button['justify-content']).toBe('center');
    expect(MOVE_STRIP_MIN_HEIGHT).toBe(36);
    expect(screen.getByTestId('movelist-san-0').getAttribute('data-matrix-exempt')).toBe('1');
  });

  it('a tap on a move reports its ply', () => {
    const select = vi.fn();
    render(<MoveListStrip moves={moves} selectedIndex={5} autoScroll onSelectMove={select} />);
    fireEvent.click(screen.getByTestId('movelist-san-3'));
    expect(select).toHaveBeenCalledWith(3);
  });

  it('shows nothing before the first move', () => {
    const { container } = render(<MoveListStrip moves={[]} selectedIndex={-1} autoScroll onSelectMove={() => {}} />);
    expect(container.textContent).toBe('');
  });
});
