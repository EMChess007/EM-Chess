/** True for "No time limit" — an online game with no clock, shown without one (the server keeps a constant
 * sentinel for the remaining time, which must never be formatted). */
export function isUnlimitedClock(initialSeconds: number): boolean {
  return initialSeconds <= 0;
}

/** A player's clock line: "Name: m:ss", or just "Name" when the game has no time limit. */
export function playerClockText(name: string, ms: number, initialSeconds: number): string {
  return isUnlimitedClock(initialSeconds) ? name : `${name}: ${formatTime(ms / 1000)}`;
}

/** Formats a seconds count as "m:ss" or "h:mm:ss" for clock displays. */
export function formatTime(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
