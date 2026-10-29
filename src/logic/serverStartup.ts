/**
 * What a screen that LOADS from the server does when the answer never comes and the app points at the online backend (command #27b).
 *
 * The deployed backend (Render's free tier) is asleep after a quiet period and takes "50 seconds or more" to wake. A load is bounded at 6 s on purpose (src/api/client.ts: a person
 * whose laptop backend is off must see "Can't reach the server" in 6 s), so on the sleeping server the first load fails - and would stay failed until the person pressed Retry
 * a few times. Here the failed load says "Server is starting up…" instead and tries again by itself, a few times, until about one minute after the first failure; then it gives up with
 * the usual "Can't reach the server" and Retry. A Retry the person presses starts a new minute. On the LAN / local backend (a laptop that is simply off) nothing changes: 6 s, the
 * message, Retry.
 *
 * Pure: the clock is an argument. LoadFailed (components/LoadFailed.tsx) is the only caller; it remembers the episode by its test id because a failed load unmounts it and the next
 * failure mounts a new one.
 */
export const STARTING_UP_MESSAGE = 'Server is starting up…';

/** From the first failure of an episode to the last automatic try. Each try is itself bounded at 6 s, so the last one ends at about 64 s after the screen was opened. */
export const AUTO_RETRY_WINDOW_MS = 60000;

/** The wait before the 1st, 2nd, 3rd and 4th automatic try: a few tries, spaced further apart as the server has been given more time to boot. */
export const AUTO_RETRY_DELAYS_MS: readonly number[] = [3000, 6000, 10000, 15000];

export interface StartupEpisode {
  firstFailureAt: number;
  lastFailureAt: number;
  retries: number;
}

/** The delay before the next automatic try, or null when the episode has used its tries or its minute. */
export function nextAutoRetryDelay(episode: StartupEpisode, now: number): number | null {
  const delay = AUTO_RETRY_DELAYS_MS[episode.retries];
  if (delay === undefined) return null;
  if (now - episode.firstFailureAt + delay >= AUTO_RETRY_WINDOW_MS) return null;
  return delay;
}

const episodes = new Map<string, StartupEpisode>();

/** A load failed (the screen mounted its failure state): the episode of this load, a new one when the last failure is older than a minute (the server answered in between, or the person left). */
export function noteFailure(key: string, now: number): StartupEpisode {
  const known = episodes.get(key);
  if (known && now - known.lastFailureAt <= AUTO_RETRY_WINDOW_MS) {
    known.lastFailureAt = now;
    return known;
  }
  const fresh: StartupEpisode = { firstFailureAt: now, lastFailureAt: now, retries: 0 };
  episodes.set(key, fresh);
  return fresh;
}

/** An automatic try is about to start. */
export function noteAutoRetry(key: string): void {
  const known = episodes.get(key);
  if (known) known.retries++;
}

/** The person pressed Retry (or left): the next failure starts a new episode with a new minute. */
export function endEpisode(key: string): void {
  episodes.delete(key);
}
