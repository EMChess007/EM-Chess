import { describe, expect, it } from 'vitest';
import { AUTO_RETRY_DELAYS_MS, AUTO_RETRY_WINDOW_MS, endEpisode, nextAutoRetryDelay, noteAutoRetry, noteFailure, STARTING_UP_MESSAGE } from '../serverStartup';

/**
 * The read screens' policy for a sleeping online server (command #27b), as numbers. Literals on purpose: a test that read them from the module could never fail when they change.
 *   the first failure of an episode: "Server is starting up…"; automatic tries after 3, 6, 10 and 15 s; none that would start at or after 60 s from the first failure;
 *   then the plain "Can't reach the server" with Retry. A Retry the person presses (or a failure more than a minute after the last) starts a new episode.
 */
describe('the numbers', () => {
  it('the words, the window and the four waits', () => {
    expect(STARTING_UP_MESSAGE).toBe('Server is starting up…');
    expect(AUTO_RETRY_WINDOW_MS).toBe(60000);
    expect([...AUTO_RETRY_DELAYS_MS]).toEqual([3000, 6000, 10000, 15000]);
  });
});

describe('nextAutoRetryDelay', () => {
  const at = (retries: number, firstFailureAt = 0) => ({ firstFailureAt, lastFailureAt: firstFailureAt, retries });

  it('walks 3000, 6000, 10000, 15000 ms and then stops, as each try fails 6 s after it starts', () => {
    expect(nextAutoRetryDelay(at(0), 0)).toBe(3000);
    expect(nextAutoRetryDelay(at(1), 9000)).toBe(6000);
    expect(nextAutoRetryDelay(at(2), 21000)).toBe(10000);
    expect(nextAutoRetryDelay(at(3), 37000)).toBe(15000);
    expect(nextAutoRetryDelay(at(4), 58000)).toBeNull();
  });

  it('a try that would START at or after 60000 ms from the first failure is not made (59999 yes, 60000 no)', () => {
    expect(nextAutoRetryDelay(at(3), 44999)).toBe(15000);
    expect(nextAutoRetryDelay(at(3), 45000)).toBeNull();
    expect(nextAutoRetryDelay(at(0), 56999)).toBe(3000);
    expect(nextAutoRetryDelay(at(0), 57000)).toBeNull();
  });

  it('counts from the FIRST failure, not from the latest one: a latest failure at 58000 ms of an episode that began at 0 has no try left', () => {
    expect(nextAutoRetryDelay({ firstFailureAt: 0, lastFailureAt: 58000, retries: 0 }, 58000)).toBeNull();
    expect(nextAutoRetryDelay({ firstFailureAt: 0, lastFailureAt: 40000, retries: 1 }, 55000)).toBeNull(); // 55000 + 6000 >= 60000
    expect(nextAutoRetryDelay({ firstFailureAt: 0, lastFailureAt: 40000, retries: 1 }, 53999)).toBe(6000);
  });

  it('counts from the FIRST failure of the episode, not from now', () => {
    expect(nextAutoRetryDelay(at(0, 100000), 100000)).toBe(3000);
    expect(nextAutoRetryDelay(at(0, 100000), 157000)).toBeNull();
    expect(nextAutoRetryDelay(at(0, 100000), 156999)).toBe(3000);
  });
});

describe('the episode of a screen', () => {
  it('starts at the first failure and is the same object for the next failures within a minute of each other', () => {
    const first = noteFailure('test-a', 1000);
    expect(first).toEqual({ firstFailureAt: 1000, lastFailureAt: 1000, retries: 0 });
    noteAutoRetry('test-a');
    const second = noteFailure('test-a', 10000);
    expect(second).toBe(first);
    expect(second).toEqual({ firstFailureAt: 1000, lastFailureAt: 10000, retries: 1 });
    endEpisode('test-a');
  });

  it('a failure exactly 60000 ms after the last one is still the same episode; 60001 ms starts a new one', () => {
    noteFailure('test-b', 0);
    noteAutoRetry('test-b');
    expect(noteFailure('test-b', 60000)).toEqual({ firstFailureAt: 0, lastFailureAt: 60000, retries: 1 });
    expect(noteFailure('test-b', 120001)).toEqual({ firstFailureAt: 120001, lastFailureAt: 120001, retries: 0 });
    endEpisode('test-b');
  });

  it('Retry (endEpisode) starts a new one at once, and only for its own screen', () => {
    noteFailure('test-c', 0);
    noteFailure('test-d', 0);
    noteAutoRetry('test-c');
    noteAutoRetry('test-d');
    endEpisode('test-c');
    expect(noteFailure('test-c', 5)).toEqual({ firstFailureAt: 5, lastFailureAt: 5, retries: 0 });
    expect(noteFailure('test-d', 5)).toEqual({ firstFailureAt: 0, lastFailureAt: 5, retries: 1 });
    endEpisode('test-c');
    endEpisode('test-d');
  });

  it('an automatic try for a screen nobody has noted changes nothing', () => {
    noteAutoRetry('test-never-noted');
    expect(noteFailure('test-never-noted', 7)).toEqual({ firstFailureAt: 7, lastFailureAt: 7, retries: 0 });
    endEpisode('test-never-noted');
  });
});
