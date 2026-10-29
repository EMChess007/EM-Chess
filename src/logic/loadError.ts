/** What a screen that loads from the server says when the load failed (Home's stats, the Analysis list, the leaderboard, ...). */
export const SERVER_UNREACHABLE_MESSAGE = "Can't reach the server";

/**
 * A request that never got an answer (ApiError status 0: no connection, the retries ran out, or the answer stalled and timed out) is "Can't reach the server"; a request the
 * server answered with an error keeps the server's own words; anything else gets the screen's fallback. Duck-typed on `status` so this file does not import the api client.
 */
export function loadErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const { status, message } = err as { status: unknown; message?: unknown };
    if (status === 0) return SERVER_UNREACHABLE_MESSAGE;
    if (typeof status === 'number' && typeof message === 'string' && message.length > 0) return message;
  }
  return fallback;
}
