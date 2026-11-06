import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChessBoard from '../../components/ChessBoard';
import type { SeatConfig, SeatController } from '../../logic/fourPlayer/setup';
import { mulberry32 } from '../../logic/__tests__/bughouseTestKit';
import { allRenderCounts, renderCount, resetRenderCounts } from '../../test/renderCounter';
import { tapBoardSquare } from '../../test/domKit';
import BughouseGameScreen from '../BughouseGameScreen';

vi.mock('../../components/Square', async (importOriginal) => (await import('../../test/renderCounter')).countModule('Square', await importOriginal()));
vi.mock('../../components/Piece', async (importOriginal) => (await import('../../test/renderCounter')).countModule('Piece', await importOriginal()));
vi.mock('../../components/BughouseBoard', async (importOriginal) => (await import('../../test/renderCounter')).countModule('BughouseBoard', await importOriginal()));
vi.mock('../../components/BughouseBoardBlock', async (importOriginal) => (await import('../../test/renderCounter')).countModule('BughouseBoardBlock', await importOriginal()));

/**
 * THE RENDER BUDGET (command #33, the lag on the phone). A phone lags when the JavaScript thread re-renders what did not change: command #32's report was "the game lags" in a 2-player
 * game against a bot and in a local Bughouse game, and the measured cause was exactly that - a clock tick (every 200 ms in Bughouse) or one tap re-rendered all 64 squares (and every
 * piece's SVG) of one or both boards. This file COUNTS renders (src/test/renderCounter.tsx; no clock is read) and pins how many an interaction may cost.
 */
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const options = (): { onTap: (c: { row: number; col: number }) => void } => (globalThis as unknown as { __boardGestures: { onTap: (c: { row: number; col: number }) => void } }).__boardGestures;

describe('the 2-player board', () => {
  beforeEach(() => resetRenderCounts());

  it('selecting a piece re-renders only the squares whose picture changed (the piece, its targets), never all 64', () => {
    render(<ChessBoard fen={START} onMove={() => {}} enableAnnotations />);
    expect(renderCount('Square')).toBe(64); // the first draw is all of them
    resetRenderCounts();
    act(() => options().onTap({ row: 6, col: 4 })); // e2
    const afterSelect = renderCount('Square');
    console.log('2-player: squares rendered by selecting e2', afterSelect, JSON.stringify(allRenderCounts()));
    expect(afterSelect).toBeLessThanOrEqual(3); // e2 itself, e3 and e4 (the two legal-move dots)
    resetRenderCounts();
    act(() => options().onTap({ row: 6, col: 4 })); // e2 again: deselect
    expect(renderCount('Square')).toBeLessThanOrEqual(3);
  });

  it('an arrow drawn by a finger re-renders no square', () => {
    render(<ChessBoard fen={START} onMove={() => {}} enableAnnotations />);
    resetRenderCounts();
    const gestures = (globalThis as unknown as { __boardGestures: { onArrow: (a: { row: number; col: number }, b: { row: number; col: number }) => void } }).__boardGestures;
    act(() => gestures.onArrow({ row: 6, col: 4 }, { row: 4, col: 4 }));
    console.log('2-player: squares rendered by drawing an arrow', renderCount('Square'));
    expect(renderCount('Square')).toBe(0);
  });

  it('the parent re-rendering with the same position (a clock tick) re-renders nothing', () => {
    const onMove = () => {};
    const { rerender } = render(<ChessBoard fen={START} onMove={onMove} enableAnnotations />);
    resetRenderCounts();
    for (let i = 0; i < 5; i++) rerender(<ChessBoard fen={START} onMove={onMove} enableAnnotations />);
    expect(renderCount('Square')).toBe(0);
  });
});

const H: SeatController = { kind: 'human' };
const B: SeatController = { kind: 'bot', elo: 1200 };
const cfg = (a: string): SeatConfig => [a[0] === 'H' ? H : B, a[1] === 'H' ? H : B, a[2] === 'H' ? H : B, a[3] === 'H' ? H : B];
const TC3 = { initialMs: 180000, incrementMs: 0 };

describe('the local Bughouse screen', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
  const mount = (seats: string) => render(<BughouseGameScreen seats={cfg(seats)} timeControl={TC3} onExit={() => {}} rng={mulberry32(11)} clock={() => Date.now()} />);

  it.each(['HBBB', 'HHHH'])('%s: a clock tick (200 ms) re-renders neither board nor any piece; only the clock texts change', (seats) => {
    mount(seats);
    advance(0);
    const clockText = (id: string) => screen.getByTestId(id).textContent;
    const before = clockText('clock-A-white');
    resetRenderCounts();
    advance(200);
    advance(200); // (the bots think for 450 ms: still nothing but the clocks moves)
    console.log(`bughouse ${seats}: renders over two 200 ms ticks`, JSON.stringify(allRenderCounts()));
    expect(renderCount('BughouseBoard')).toBe(0);
    expect(renderCount('BughouseBoardBlock')).toBe(0);
    expect(renderCount('Piece')).toBe(0);
    advance(1000);
    expect(clockText('clock-A-white')).not.toBe(before); // and the clocks DID move
  });

  it('a tap that selects a piece re-renders one board, not both, and no piece that did not change', () => {
    mount('HBBB');
    advance(0);
    resetRenderCounts();
    tapBoardSquare('A', 'e2', 'w');
    console.log('bughouse HBBB: renders for selecting e2', JSON.stringify(allRenderCounts()));
    expect(renderCount('BughouseBoardBlock')).toBeLessThanOrEqual(1); // the board that was touched; the other block's props did not change
    expect(renderCount('BughouseBoard')).toBeLessThanOrEqual(1);
    expect(renderCount('Piece')).toBeLessThanOrEqual(2); // the picked piece's own cell, never the 64 of the two boards
  });

  it('the bots moving on the other board do not re-render the board a human is looking at', () => {
    mount('HBBB');
    advance(0);
    resetRenderCounts();
    for (let i = 0; i < 25; i++) advance(200); // five seconds, one act per tick so the bots' effects re-arm: several bot moves
    // every bot move changes the match, so a block MAY re-render for a real change - but never once per tick: 25 ticks, a handful of moves
    console.log('bughouse HBBB: renders over 5 s of play', JSON.stringify(allRenderCounts()));
    expect(renderCount('BughouseBoardBlock')).toBeLessThanOrEqual(20);
    expect(screen.getByTestId('block-A')).toBeTruthy();
  });
});
