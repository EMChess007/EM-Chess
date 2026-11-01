import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ChessBoard from '../ChessBoard';

/**
 * The 2-player board (Local, Bot, Online, Spectator, Engine vs Engine, Analysis; command #32): the arrow gesture works on ANY turn - `disabled` (the opponent's turn, a spectator, a finished game, a lost
 * connection) gates MOVES, never the gesture - several arrows stay, and they are cleared when the position changes (a move was played) and at no other time. The seam of domSetup.ts hands the test the
 * options the gesture hook was given (what it would call after a real long-press drag).
 */
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
type Options = { enableAnnotations: boolean; onArrow: (a: { row: number; col: number }, b: { row: number; col: number }) => void; onHighlight: (c: { row: number; col: number }) => void };
const options = (): Options => (globalThis as unknown as { __boardGestures: Options }).__boardGestures;
const arrows = (): number => screen.getByTestId('chess-board').querySelectorAll('[data-svg="Polygon"]').length;
const marked = (): number => screen.getByTestId('chess-board').querySelectorAll('[data-svg="Rect"]').length;

describe('2-player board arrows', () => {
  it.each([false, true])('a disabled=%s board takes arrows: several stay, a mark toggles', (disabled) => {
    render(<ChessBoard fen={START} onMove={() => {}} disabled={disabled} enableAnnotations />);
    expect(options().enableAnnotations).toBe(true);
    act(() => options().onArrow({ row: 6, col: 4 }, { row: 4, col: 4 }));
    act(() => options().onArrow({ row: 0, col: 6 }, { row: 2, col: 5 }));
    expect(arrows()).toBe(2);
    act(() => options().onHighlight({ row: 3, col: 3 }));
    expect(marked()).toBe(1);
    act(() => options().onHighlight({ row: 3, col: 3 }));
    expect(marked()).toBe(0);
  });

  it('a board without the flag draws no arrows (puzzles)', () => {
    render(<ChessBoard fen={START} onMove={() => {}} disabled />);
    expect(options().enableAnnotations).toBe(false);
  });

  it('a move (the position changed) clears every arrow and mark; a rerender with the SAME position clears none', () => {
    const { rerender } = render(<ChessBoard fen={START} onMove={() => {}} disabled enableAnnotations />);
    act(() => options().onArrow({ row: 6, col: 4 }, { row: 4, col: 4 }));
    act(() => options().onHighlight({ row: 3, col: 3 }));
    rerender(<ChessBoard fen={START} onMove={() => {}} disabled={false} enableAnnotations />); // the turn changed hands in the screen, the position did not
    expect([arrows(), marked()]).toEqual([1, 1]);
    rerender(<ChessBoard fen={AFTER_E4} onMove={() => {}} disabled enableAnnotations />);
    expect([arrows(), marked()]).toEqual([0, 0]);
  });
});
