import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toRatingCategory } from '../rating';
import { isUnlimitedClock, playerClockText } from '../time';
import { TIME_CONTROLS, categoryForInitialSeconds, getTimeControlsByCategory } from '../timeControls';

// The server's "no clock" sentinel (backend/src/game/rooms.ts initialClockMs) — it must never reach the screen.
const SENTINEL_MS = Number.MAX_SAFE_INTEGER;

describe('No time limit — clock text', () => {
  it('recognises an unlimited control by initialSeconds <= 0', () => {
    expect(isUnlimitedClock(0)).toBe(true);
    expect(isUnlimitedClock(1)).toBe(false);
    expect(isUnlimitedClock(300)).toBe(false);
  });

  it('shows just the name when there is no time limit — never the sentinel as a clock', () => {
    expect(playerClockText('You', SENTINEL_MS, 0)).toBe('You');
    expect(playerClockText('Opponent', SENTINEL_MS - 12_000, 0)).toBe('Opponent');
  });

  it('keeps "Name: m:ss" for every timed control', () => {
    expect(playerClockText('You', 300_000, 300)).toBe('You: 5:00');
    expect(playerClockText('Opponent', 59_000, 60)).toBe('Opponent: 0:59');
    expect(playerClockText('You', 3_725_000, 3600)).toBe('You: 1:02:05');
  });
});

describe('No time limit — preset', () => {
  it('is a single preset with no clock and no increment, in its own category', () => {
    const presets = getTimeControlsByCategory('unlimited');
    expect(presets).toHaveLength(1);
    expect(presets[0]).toMatchObject({ label: 'No time limit', initialSeconds: 0, incrementSeconds: 0 });
  });

  it('is the only preset with initialSeconds 0, so the server-side category lookup is unambiguous', () => {
    expect(TIME_CONTROLS.filter((tc) => tc.initialSeconds === 0)).toHaveLength(1);
    expect(categoryForInitialSeconds(0)).toBe('unlimited');
  });

  it('is unrated: it has no rating category', () => {
    expect(toRatingCategory('unlimited')).toBeNull();
  });
});

describe('No time limit — wiring (no React Native renderer available)', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '../../', rel), 'utf8').replace(/\r\n/g, '\n');

  it('the Play Online screen offers No time limit but not Daily', () => {
    const screen = read('screens/OnlineTimeControlSelectScreen.tsx');
    expect(screen).toContain("{ category: 'unlimited', label: 'No time limit' }");
    expect(screen).not.toContain("category: 'daily'");
  });

  it('the Online game screen never ticks or formats a clock for an unlimited game', () => {
    const online = read('screens/OnlineGameScreen.tsx');
    expect(online).toContain("connectionState !== 'connected' || isUnlimitedClock(match.timeControl.initialSeconds)");
    expect(online).toContain('playerClockText(opponentName, opponentMs, match.timeControl.initialSeconds)');
    expect(online).toContain('playerClockText(myName, myMs, match.timeControl.initialSeconds)');
    expect(online).not.toContain('formatTime(');
  });

  it('the spectator screen hides the clock too', () => {
    const spectator = read('screens/SpectatorGameScreen.tsx');
    expect(spectator).toContain('playerClockText(blackUsername, state.blackMs, state.timeControl.initialSeconds)');
    expect(spectator).toContain('playerClockText(whiteUsername, state.whiteMs, state.timeControl.initialSeconds)');
    expect(spectator).not.toContain('formatTime(');
  });

  it('the Challenge and Tournament screens are unchanged (no unlimited section)', () => {
    expect(read('screens/ChallengeScreen.tsx')).not.toContain("'unlimited'");
    expect(read('screens/TournamentScreen.tsx')).not.toContain("category: 'unlimited'");
  });
});
