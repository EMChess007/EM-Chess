import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import GameHistoryScreen from '../GameHistoryScreen';
import HomeScreen from '../HomeScreen';
import LeaderboardScreen from '../LeaderboardScreen';
import SpectateListScreen from '../SpectateListScreen';

/**
 * THE SCREENS AGAINST A REAL, MISBEHAVING SERVER (offline-states branch). loadFailed.dom.test.tsx replaces the api client; this file does not: the real client, the real fetch and
 * the real clock, pointed at a real local server that is refused / accepts and never answers / sends the headers and stalls / stalls halfway through the body. Home's stats and
 * recent games, the Analysis list and the leaderboard must each say "Can't reach the server" with Retry inside 8 s, and Retry must work once the server is back. The Spectate list
 * (a socket.io request) must do the same through the real socket.
 *
 * The wall clock appears only as the bound that turns a hang into a failure; the waits end on the screen showing the state.
 */
const { server } = await vi.hoisted(async () => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  const { startSwitchable } = await import('../../../scripts/browser/offline-servers.mjs');
  const started = await startSwitchable('blackhole');
  process.env.EXPO_PUBLIC_API_URL = started.origin; // honoured because this is a development build (apiBaseUrl.ts)
  return { server: started };
});
vi.mock('expo-constants', () => ({ default: { expoConfig: { hostUri: undefined }, expoGoConfig: undefined } }));
vi.mock('../../logic/diagnosticLog', () => ({ logDiagnostic: vi.fn() }));
vi.mock('../../logic/pgnShare', () => ({ sharePgn: vi.fn() }));

const BOUND_MS = 8000;
const FAILURES = ['refused', 'blackhole', 'headersThenStall', 'bodyStalls'] as const;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(async () => {
  await server.close();
});

const renderLoads = () =>
  render(
    <>
      <HomeScreen authToken="token" onPlay={() => {}} onOpenPuzzles={() => {}} onOpenAnalysis={() => {}} onOpenStreak={() => {}} onAnalyzeGame={() => {}} />
      <GameHistoryScreen authToken="token" onAnalyze={() => {}} onAuthPress={() => {}} />
      <LeaderboardScreen authToken="token" onBack={() => {}} />
    </>,
  );

describe.each(FAILURES)('Home, the Analysis list and the leaderboard against a server that is: %s', (failure) => {
  it('each shows "Can\'t reach the server" inside 8 s, and Retry works once the server is back', async () => {
    await server.setMode(failure);
    const startedAt = performance.now();
    renderLoads();
    // Home's two sections + the Analysis list + the leaderboard.
    await waitFor(() => expect(screen.getAllByText("Can't reach the server")).toHaveLength(4), { timeout: BOUND_MS });
    const ms = Math.round(performance.now() - startedAt);
    console.info(`[offline-timing] screens, ${failure}: all four error states after ${ms} ms`);
    expect(ms).toBeLessThan(BOUND_MS);
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
    expect(screen.queryByText('Games Played')).toBeNull(); // not a false "0 games"

    await server.setMode('ok');
    fireEvent.click(screen.getByTestId('home-stats-failed-retry'));
    await waitFor(() => expect(screen.getByText('Games Played')).toBeTruthy(), { timeout: BOUND_MS });
    fireEvent.click(screen.getAllByTestId('load-failed-retry')[0]);
    fireEvent.click(screen.getAllByTestId('load-failed-retry')[0]);
    await waitFor(() => expect(screen.getByText('magnus')).toBeTruthy(), { timeout: BOUND_MS }); // the leaderboard's row, from the server that is back
    expect(screen.queryAllByText("Can't reach the server")).toHaveLength(0);
    expect(screen.getAllByText('Bot (ELO 1200)').length).toBeGreaterThan(0); // the Analysis list and Home's recent games
  });
});

describe('the Spectate list (a socket.io request) against a server that never answers', () => {
  it('says "Can\'t reach the server" with Retry inside 8 s', async () => {
    await server.setMode('blackhole');
    const startedAt = performance.now();
    render(<SpectateListScreen authToken="token" onWatch={() => {}} onWatchFour={() => {}} onBack={() => {}} />);
    expect(screen.getAllByRole('progressbar').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText("Can't reach the server")).toBeTruthy(), { timeout: BOUND_MS });
    const ms = Math.round(performance.now() - startedAt);
    console.info(`[offline-timing] spectate list (socket), blackhole: error state after ${ms} ms`);
    expect(ms).toBeLessThan(BOUND_MS);
    expect(screen.getByTestId('load-failed-retry')).toBeTruthy();
  });
});
