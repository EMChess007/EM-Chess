import { act, fireEvent, render, screen } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoadFailed from '../../components/LoadFailed';
import { endEpisode } from '../../logic/serverStartup';

/**
 * A READ SCREEN ON THE SLEEPING ONLINE SERVER (command #27b), rendered. The harness stands in for a screen: while "loading" it shows a spinner for 6 s (the load budget, which
 * always fails here), then mounts LoadFailed again - exactly what Home, the leaderboard and the Analysis list do on a Retry. Fake timers; nothing waits on the wall clock.
 *
 *   online backend:  "Server is starting up…", automatic tries 3, 6, 10 and 15 s after each failure, then "Can't reach the server" + Retry; Retry always works.
 *   local backend:   "Can't reach the server" + Retry, no automatic try, ever.
 */
const UNREACHABLE = "Can't reach the server";
const STARTING = 'Server is starting up…';

function Screen({ online, message = UNREACHABLE, id = 'read-test', onLoad }: { online: boolean; message?: string; id?: string; onLoad: () => void }) {
  const [loading, setLoading] = useState(false);
  const retry = useCallback(() => {
    onLoad();
    setLoading(true);
    setTimeout(() => setLoading(false), 6000); // the load budget, always spent
  }, [onLoad]);
  return loading ? <span data-testid="spinner">loading</span> : <LoadFailed message={message} onRetry={retry} testID={id} online={online} />;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  endEpisode('read-test');
});

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('on the online backend', () => {
  it('says the server is starting up, and tries again after 3 s', async () => {
    const onLoad = vi.fn();
    render(<Screen online onLoad={onLoad} />);
    expect(screen.getByText(STARTING)).toBeTruthy();
    expect(screen.queryByText(UNREACHABLE)).toBeNull();
    expect(screen.getByTestId('read-test-retry')).toBeTruthy(); // manual Retry stays
    await advance(2999);
    expect(onLoad).not.toHaveBeenCalled();
    await advance(1);
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('spinner')).toBeTruthy();
  });

  it('tries four times in all - after 3, 6, 10 and 15 s - and then settles on "Can\'t reach the server" with Retry', async () => {
    const onLoad = vi.fn();
    render(<Screen online onLoad={onLoad} />);
    // failure 0 at t=0; try 1 at 3 s (fails at 9 s); try 2 at 15 s (fails at 21 s); try 3 at 31 s (fails at 37 s); try 4 at 52 s (fails at 58 s)
    await advance(3000);
    expect(onLoad).toHaveBeenCalledTimes(1);
    await advance(6000);
    expect(screen.getByText(STARTING)).toBeTruthy(); // the second failure is also "starting up"
    await advance(6000);
    expect(onLoad).toHaveBeenCalledTimes(2);
    await advance(6000);
    await advance(10000);
    expect(onLoad).toHaveBeenCalledTimes(3);
    await advance(6000);
    await advance(15000);
    expect(onLoad).toHaveBeenCalledTimes(4);
    await advance(6000); // the fifth failure: the minute is spent
    expect(screen.getByText(UNREACHABLE)).toBeTruthy();
    expect(screen.queryByText(STARTING)).toBeNull();
    expect(screen.getByTestId('read-test-retry')).toBeTruthy();
    await advance(120000);
    expect(onLoad).toHaveBeenCalledTimes(4); // and it stays
  });

  it('a Retry the person presses starts a new minute: four more automatic tries', async () => {
    const onLoad = vi.fn();
    render(<Screen online onLoad={onLoad} />);
    // React commits between the steps (a remounted block schedules its own timer), so the minute is walked step by step
    for (const [wait, failsAfter] of [[3000, 6000], [6000, 6000], [10000, 6000], [15000, 6000]]) {
      await advance(wait);
      await advance(failsAfter);
    }
    expect(onLoad).toHaveBeenCalledTimes(4);
    expect(screen.getByText(UNREACHABLE)).toBeTruthy();
    fireEvent.click(screen.getByTestId('read-test-retry'));
    expect(onLoad).toHaveBeenCalledTimes(5);
    await advance(6000); // fails again: a new episode
    expect(screen.getByText(STARTING)).toBeTruthy();
    await advance(3000);
    expect(onLoad).toHaveBeenCalledTimes(6);
  });

  it('a screen that re-renders with a new Retry function does not restart the timer, and the NEW function is the one that is called', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<Screen online onLoad={first} />);
    await advance(2000);
    view.rerender(<Screen online onLoad={second} />);
    await advance(999);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    await advance(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('leaving the screen cancels the automatic try', async () => {
    const onLoad = vi.fn();
    const view = render(<Screen online onLoad={onLoad} />);
    view.unmount();
    await advance(10000);
    expect(onLoad).not.toHaveBeenCalled();
  });

  it('an answer from the server ("Couldn\'t load your games") is not a sleeping server: its words, no automatic try', async () => {
    const onLoad = vi.fn();
    render(<Screen online message="Couldn't load your games" onLoad={onLoad} />);
    expect(screen.getByText("Couldn't load your games")).toBeTruthy();
    await advance(60000);
    expect(onLoad).not.toHaveBeenCalled();
  });
});

describe('on the local / LAN backend', () => {
  it('keeps "Can\'t reach the server" and never tries by itself', async () => {
    const onLoad = vi.fn();
    render(<Screen online={false} onLoad={onLoad} />);
    expect(screen.getByText(UNREACHABLE)).toBeTruthy();
    expect(screen.queryByText(STARTING)).toBeNull();
    await advance(120000);
    expect(onLoad).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('read-test-retry'));
    expect(onLoad).toHaveBeenCalledTimes(1);
  });
});
