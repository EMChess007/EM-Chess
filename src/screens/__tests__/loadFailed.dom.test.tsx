import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GameHistoryScreen from '../GameHistoryScreen';
import HomeScreen from '../HomeScreen';
import LeaderboardScreen from '../LeaderboardScreen';

/**
 * "Infinite spinner" fix (Android text-fit branch): when the backend cannot be reached, Home's Stats / Recent Games, the Analysis list and the leaderboard used to spin for ever (or, on
 * Home, show a silent "0 games"). After the client's own retries have failed they now say "Can't reach the server" and offer Retry. The api client is replaced; the screens are the real ones.
 */
const { listGames, getLeaderboard } = vi.hoisted(() => ({ listGames: vi.fn(), getLeaderboard: vi.fn() }));
vi.mock('../../api/client', () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { api: { listGames, getLeaderboard }, ApiError };
});

// Sharing a PGN needs the native clipboard module, which a test never reaches.
vi.mock('../../logic/pgnShare', () => ({ sharePgn: vi.fn() }));

const unreachable = () => Object.assign(new Error('Could not connect to the server.'), { status: 0 });
const GAME = { id: 'g1', userId: 'u1', opponentType: 'bot', opponentElo: 1200, result: '1-0', pgn: '1. e4 e5', timeControl: '5+0', isChess960: false, playedAt: '2026-10-01T10:00:00Z' };

beforeEach(() => {
  listGames.mockReset();
  getLeaderboard.mockReset();
});

/** Lets the pending promise chains of the screen settle (no timers involved). */
const flush = () => act(async () => {});

describe('Home', () => {
  const renderHome = () =>
    render(<HomeScreen authToken="token" onPlay={() => {}} onOpenPuzzles={() => {}} onOpenAnalysis={() => {}} onOpenStreak={() => {}} onAnalyzeGame={() => {}} />);

  it('shows a spinner while the games load, then "Can\'t reach the server" with Retry in BOTH sections when the load fails', async () => {
    let fail: (e: unknown) => void = () => {};
    listGames.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
    renderHome();
    expect(screen.getAllByRole('progressbar')).toHaveLength(2); // Stats and Recent Games
    expect(screen.queryByText("Can't reach the server")).toBeNull();
    fail(unreachable());
    await flush();
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
    expect(screen.getAllByText("Can't reach the server")).toHaveLength(2);
    expect(screen.getByTestId('home-stats-failed-retry')).toBeTruthy();
    expect(screen.getByTestId('home-recent-failed-retry')).toBeTruthy();
    expect(screen.queryByText('Games Played')).toBeNull(); // not a silent, false "0 games"
  });

  it('Retry asks the server again and shows the games when it answers', async () => {
    listGames.mockRejectedValueOnce(unreachable());
    renderHome();
    await flush();
    listGames.mockResolvedValueOnce([GAME]);
    fireEvent.click(screen.getByTestId('home-stats-failed-retry'));
    await flush();
    expect(listGames).toHaveBeenCalledTimes(2);
    expect(listGames).toHaveBeenLastCalledWith('token');
    expect(screen.queryByText("Can't reach the server")).toBeNull();
    expect(screen.getByText('Games Played')).toBeTruthy();
    expect(screen.getByText('Bot (ELO 1200)')).toBeTruthy();
  });

  it('a server error keeps the server\'s own words', async () => {
    listGames.mockRejectedValueOnce(Object.assign(new Error('Database is down'), { status: 500 }));
    renderHome();
    await flush();
    expect(screen.getAllByText('Database is down')).toHaveLength(2);
  });

  it('a guest sees the log-in placeholders and no request is made', () => {
    render(<HomeScreen authToken={null} onPlay={() => {}} onOpenPuzzles={() => {}} onOpenAnalysis={() => {}} onOpenStreak={() => {}} onAnalyzeGame={() => {}} />);
    expect(listGames).not.toHaveBeenCalled();
    expect(screen.getByText('Log in to track your stats.')).toBeTruthy();
  });
});

describe('the Analysis list (GameHistoryScreen)', () => {
  const renderHistory = () => render(<GameHistoryScreen authToken="token" onAnalyze={() => {}} onAuthPress={() => {}} />);

  it('says "Can\'t reach the server" with Retry, and Retry loads the list', async () => {
    listGames.mockRejectedValueOnce(unreachable());
    renderHistory();
    await flush();
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
    expect(screen.getByText("Can't reach the server")).toBeTruthy();
    listGames.mockResolvedValueOnce([GAME]);
    fireEvent.click(screen.getByTestId('load-failed-retry'));
    await flush();
    expect(listGames).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Can't reach the server")).toBeNull();
    expect(screen.getByText('Bot (ELO 1200)')).toBeTruthy();
  });

  it('Retry shows the spinner again while it waits', async () => {
    listGames.mockRejectedValueOnce(unreachable());
    renderHistory();
    await flush();
    listGames.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByTestId('load-failed-retry'));
    await flush();
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.queryByText("Can't reach the server")).toBeNull();
  });
});

describe('the leaderboard', () => {
  it('says "Can\'t reach the server" with Retry, and Retry loads the table', async () => {
    getLeaderboard.mockRejectedValueOnce(unreachable());
    render(<LeaderboardScreen authToken="token" onBack={() => {}} />);
    await flush();
    expect(screen.getByText("Can't reach the server")).toBeTruthy();
    getLeaderboard.mockResolvedValueOnce({ entries: [{ rank: 1, userId: 'u9', username: 'magnus', rating: 2800 }], me: null });
    fireEvent.click(screen.getByTestId('load-failed-retry'));
    await flush();
    expect(getLeaderboard).toHaveBeenCalledTimes(2);
    expect(screen.getByText('magnus')).toBeTruthy();
  });
});
