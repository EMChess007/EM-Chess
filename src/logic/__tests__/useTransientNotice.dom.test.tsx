import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePremove } from '../usePremove';
import { NOTICE_TTL_MS, hasNotice, useExpiringNotice, useTransientNotice } from '../useTransientNotice';

/**
 * Transient notices (command #34): "Premove was no longer legal — cancelled." stayed on the phone for dozens of moves. A one-off message goes at the next
 * move by either side OR after a few seconds, whichever comes first. The harnesses below are the 2-player screens' own pattern (a boolean + the FEN as the
 * epoch) and the 4-seat one (usePremove + the ply); no wall-clock: fake timers only.
 */
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

let setFen: (fen: string) => void = () => {};
let show: () => void = () => {};

/** The 2-player pattern: `premoveInvalid` is a boolean the screen sets when the premove failed, the epoch is the FEN. */
function TwoPlayerHarness() {
  const [fen, setFenState] = useState('fen-0');
  const [invalid, setInvalid] = useState(false);
  setFen = setFenState;
  show = () => setInvalid(true);
  useTransientNotice(invalid, fen, () => setInvalid(false));
  return <div>{invalid ? <span data-testid="notice">Premove was no longer legal — cancelled.</span> : null}</div>;
}

const present = () => screen.queryByTestId('notice') !== null;
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('useTransientNotice', () => {
  it('a notice is shown, stays for the whole time to live minus a tick, and is gone at NOTICE_TTL_MS', () => {
    render(<TwoPlayerHarness />);
    act(() => show());
    expect(present()).toBe(true);
    advance(4999);
    expect(present()).toBe(true);
    advance(1);
    expect(present()).toBe(false);
  });

  it('the time to live is five seconds - a literal, not the module\'s own constant', () => {
    expect(NOTICE_TTL_MS).toBe(5000);
  });

  it('a move by either side (the position changed) removes it at once', () => {
    render(<TwoPlayerHarness />);
    act(() => show());
    advance(1000);
    expect(present()).toBe(true);
    act(() => setFen('fen-1'));
    expect(present()).toBe(false);
  });

  it('dozens of moves later nothing is left (the phone bug: it never cleared)', () => {
    render(<TwoPlayerHarness />);
    act(() => show());
    for (let i = 1; i <= 30; i++) act(() => setFen(`fen-${i}`));
    expect(present()).toBe(false);
  });

  it('a notice that is set in the SAME render as a move survives that move and goes at the next one', () => {
    render(<TwoPlayerHarness />);
    act(() => {
      setFen('fen-1'); // the move that gave the turn back ...
      show(); // ... and the premove that failed against it
    });
    expect(present()).toBe(true);
    act(() => setFen('fen-2'));
    expect(present()).toBe(false);
  });

  it('a notice that is shown again restarts its timer', () => {
    render(<TwoPlayerHarness />);
    act(() => show());
    advance(3000);
    expect(present()).toBe(true);
    act(() => setFen('fen-1')); // gone
    expect(present()).toBe(false);
    act(() => show());
    advance(4999);
    expect(present()).toBe(true);
    advance(1);
    expect(present()).toBe(false);
  });

  it('a move that happens when there is no notice changes nothing, and a timer that was cancelled does not fire later', () => {
    render(<TwoPlayerHarness />);
    act(() => setFen('fen-1'));
    act(() => show());
    act(() => setFen('fen-2'));
    expect(present()).toBe(false);
    advance(10_000);
    expect(present()).toBe(false);
  });

  it('hasNotice: null, undefined, false and the empty string mean nothing; everything else is a notice', () => {
    expect([null, undefined, false, ''].map(hasNotice)).toEqual([false, false, false, false]);
    expect(['x', true, 0, 'Premove'].map(hasNotice)).toEqual([true, true, true, true]);
  });
});

let setEpoch: (n: number) => void = () => {};
let setError: (text: string | null) => void = () => {};
function ExpiringHarness() {
  const [epoch, setEpochState] = useState(0);
  const [error, setErrorState] = useState<string | null>(null);
  setEpoch = setEpochState;
  setError = setErrorState;
  const shown = useExpiringNotice(error, epoch);
  return <div>{shown !== null ? <span data-testid="error">{shown}</span> : null}</div>;
}

describe('useExpiringNotice (a message that lives outside the screen)', () => {
  it('shows the owner\'s text, hides it after the time to live and after a move, and shows the same text again once its owner clears and sets it again', () => {
    render(<ExpiringHarness />);
    act(() => setError('Not your turn.'));
    expect(screen.getByTestId('error').textContent).toBe('Not your turn.');
    advance(5000);
    expect(screen.queryByTestId('error')).toBeNull();
    // the owner still holds the text: it stays hidden (it was dismissed) until the owner clears it
    advance(60_000);
    expect(screen.queryByTestId('error')).toBeNull();
    act(() => setError(null));
    act(() => setError('Not your turn.'));
    expect(screen.getByTestId('error').textContent).toBe('Not your turn.');
    act(() => setEpoch(1));
    expect(screen.queryByTestId('error')).toBeNull();
  });
});

/** The 4-seat pattern: usePremove with the ply as the epoch. */
let setPly: (n: number) => void = () => {};
let setMine: (b: boolean) => void = () => {};
let queueIt: () => void = () => {};
function FourSeatHarness() {
  const [ply, setPlyState] = useState(0);
  const [mine, setMineState] = useState(false);
  setPly = setPlyState;
  setMine = setMineState;
  const { cancelReason, queue } = usePremove<string, string>({
    isMyTurn: mine,
    canStillPlay: true,
    gameOver: false,
    resolve: () => null, // never legal: the premove is always cancelled when the turn comes
    play: () => {},
    epoch: ply,
  });
  queueIt = () => queue('a2-a3');
  return <div>{cancelReason ? <span data-testid="cancel">{cancelReason}</span> : null}</div>;
}

describe('usePremove (the 4-seat games)', () => {
  it('an illegal premove notice raised ON my turn is gone at the next ply (before, it stayed until I moved)', () => {
    render(<FourSeatHarness />);
    act(() => queueIt());
    act(() => setMine(true)); // the turn comes: the premove is checked and cancelled
    expect(screen.getByTestId('cancel').textContent).toBe('illegal');
    act(() => setPly(1));
    expect(screen.queryByTestId('cancel')).toBeNull();
  });

  it('... or after the time to live when nobody moves', () => {
    render(<FourSeatHarness />);
    act(() => queueIt());
    act(() => setMine(true));
    expect(screen.getByTestId('cancel')).toBeTruthy();
    advance(5000);
    expect(screen.queryByTestId('cancel')).toBeNull();
  });
});
