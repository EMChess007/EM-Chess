import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChallengeScreen from '../ChallengeScreen';
import SpectatorGameScreen from '../SpectatorGameScreen';
import TournamentScreen from '../TournamentScreen';
import TournamentStandingsScreen from '../TournamentStandingsScreen';

/**
 * The screens that wait for a socket answer end in "Can't reach the server" (offline-states branch). A socket that never connects never acknowledges an emit, so these screens spun,
 * or sat blank, for ever. The socket is replaced by one that records every `timeout(ms).emit(...)` and lets the test answer it like socket.io does (`(err, ack)`); the screens are
 * the real ones. The real socket against a real, silent server is checked for the Spectate list in offlineScreens.dom.test.tsx.
 */
interface Request {
  ms: number;
  event: string;
  payload: unknown;
  answer: (err: unknown, ack?: unknown) => void;
}
const { requests, handlers, fake } = vi.hoisted(() => {
  const requests: Request[] = [];
  const handlers: Record<string, (payload: unknown) => void> = {};
  const fake = {
    on: (event: string, handler: (payload: unknown) => void) => {
      handlers[event] = handler;
    },
    off: () => {},
    emit: () => {},
    timeout: (ms: number) => ({
      emit: (event: string, payload: unknown, answer: (err: unknown, ack?: unknown) => void) => {
        requests.push({ ms, event, payload, answer });
      },
    }),
  };
  return { requests, handlers, fake };
});
vi.mock('../../api/socket', () => ({ connectSocket: () => fake, getSocket: () => fake, disconnectSocket: vi.fn() }));

const USER = { id: 'u1', email: 'a@b.c', username: 'ann', createdAt: '2026-01-01T00:00:00Z' };
const timedOut = () => new Error('operation has timed out');
const last = () => requests[requests.length - 1];

beforeEach(() => {
  requests.length = 0;
});

describe('Tournament standings', () => {
  const renderStandings = () => render(<TournamentStandingsScreen authToken="t" authUser={USER} tournamentId="T1" onEnterGame={() => {}} onExit={() => {}} />);

  it('asks with a 6000 ms deadline, shows a spinner, then "Can\'t reach the server" with Retry; Retry asks again', () => {
    renderStandings();
    expect(requests).toHaveLength(1);
    expect(last().event).toBe('get_tournament_standings');
    expect(last().payload).toEqual({ tournamentId: 'T1' });
    expect(last().ms).toBe(6000);
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    act(() => last().answer(timedOut()));
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
    expect(screen.getByText("Can't reach the server")).toBeTruthy();
    fireEvent.click(screen.getByTestId('load-failed-retry'));
    expect(requests).toHaveLength(2);
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.queryByText("Can't reach the server")).toBeNull();
  });

  it('the server\'s own refusal keeps its words (no Retry button for it)', () => {
    renderStandings();
    act(() => last().answer(null, { ok: false, error: 'Tournament not found' }));
    expect(screen.getByText('Tournament not found')).toBeTruthy();
    expect(screen.queryByTestId('load-failed-retry')).toBeNull();
  });
});

describe('Spectator game', () => {
  const renderSpectator = () => render(<SpectatorGameScreen authToken="t" roomId="R1" whiteUsername="w" blackUsername="b" onExit={() => {}} />);

  it('asks with a 6000 ms deadline; no answer ends in "Can\'t reach the server" with Retry, which asks again', () => {
    renderSpectator();
    expect(requests).toHaveLength(1);
    expect(last().event).toBe('spectate_game');
    expect(last().payload).toEqual({ roomId: 'R1' });
    expect(last().ms).toBe(6000);
    act(() => last().answer(timedOut()));
    expect(screen.getByText("Can't reach the server")).toBeTruthy();
    fireEvent.click(screen.getByTestId('load-failed-retry'));
    expect(requests).toHaveLength(2);
    expect(screen.queryByText("Can't reach the server")).toBeNull();
  });

  it('the server\'s own refusal keeps its words', () => {
    renderSpectator();
    act(() => last().answer(null, { ok: false, error: 'Game not found' }));
    expect(screen.getByText('Game not found')).toBeTruthy();
    expect(screen.queryByTestId('load-failed-retry')).toBeNull();
  });
});

describe('Tournament create / join / start', () => {
  const renderTournament = () => render(<TournamentScreen authToken="t" authUser={USER} onEnterStandings={() => {}} onBack={() => {}} />);

  it('Join: asks with a 6000 ms deadline; no answer says "Can\'t reach the server"; the server\'s refusal keeps its words', () => {
    renderTournament();
    fireEvent.click(screen.getByText('Join by Code'));
    fireEvent.change(screen.getByPlaceholderText('ABC123'), { target: { value: 'ZZZ999' } });
    fireEvent.click(screen.getByText('Join'));
    expect(last().event).toBe('join_tournament');
    expect(last().payload).toEqual({ code: 'ZZZ999' });
    expect(last().ms).toBe(6000);
    act(() => last().answer(timedOut()));
    expect(screen.getByText("Can't reach the server")).toBeTruthy();
    fireEvent.click(screen.getByText('Join')); // pressing Join again is the retry
    expect(requests).toHaveLength(2);
    expect(screen.queryByText("Can't reach the server")).toBeNull();
    act(() => last().answer(null, { ok: false, error: 'No such tournament' }));
    expect(screen.getByText('No such tournament')).toBeTruthy();
  });

  it('Create: asks with a 6000 ms deadline; no answer says "Can\'t reach the server"', () => {
    renderTournament();
    fireEvent.click(screen.getByText('Create Tournament'));
    fireEvent.change(screen.getByPlaceholderText('Friday Night Blitz'), { target: { value: 'Friday' } });
    fireEvent.click(screen.getAllByText(/^\d/)[0]); // the first time control preset
    expect(last().event).toBe('create_tournament');
    expect((last().payload as { name: string }).name).toBe('Friday');
    expect(last().ms).toBe(6000);
    act(() => last().answer(timedOut()));
    expect(screen.getByText("Can't reach the server")).toBeTruthy();
  });

  it('Create: the server\'s answer opens the lobby (the happy path still works through the deadline form)', () => {
    renderTournament();
    fireEvent.click(screen.getByText('Create Tournament'));
    fireEvent.change(screen.getByPlaceholderText('Friday Night Blitz'), { target: { value: 'Friday' } });
    fireEvent.click(screen.getAllByText(/^\d/)[0]);
    act(() => last().answer(null, { ok: true, code: 'ABC123', tournamentId: 'T9' }));
    expect(screen.getByText('ABC123')).toBeTruthy();
    expect(screen.getByText('Start Tournament')).toBeTruthy();
  });

  it('Start: no answer stops the spinner and says "Can\'t reach the server"', () => {
    renderTournament();
    fireEvent.click(screen.getByText('Create Tournament'));
    fireEvent.change(screen.getByPlaceholderText('Friday Night Blitz'), { target: { value: 'Friday' } });
    fireEvent.click(screen.getAllByText(/^\d/)[0]);
    act(() => last().answer(null, { ok: true, code: 'ABC123', tournamentId: 'T9' }));
    // Start needs 3 players: the server's lobby update brings them in.
    act(() =>
      handlers.tournament_lobby_update({
        id: 'T9',
        code: 'ABC123',
        name: 'Friday',
        timeControl: { initialSeconds: 180, incrementSeconds: 0 },
        isChess960: false,
        isKingOfTheHill: false,
        isThreeCheck: false,
        status: 'lobby',
        creatorUserId: 'u1',
        participants: [
          { userId: 'u1', username: 'ann' },
          { userId: 'u2', username: 'bo' },
          { userId: 'u3', username: 'cy' },
        ],
      }),
    );
    fireEvent.click(screen.getByText('Start Tournament'));
    expect(last().event).toBe('start_tournament');
    expect(last().payload).toEqual({ tournamentId: 'T9' });
    expect(last().ms).toBe(6000);
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    act(() => last().answer(timedOut()));
    expect(screen.getByText("Can't reach the server")).toBeTruthy();
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
    expect(screen.getByText('Start Tournament')).toBeTruthy(); // the button is back: pressing it again is the retry
  });
});

describe('Challenge create / join', () => {
  const renderChallenge = () => render(<ChallengeScreen authToken="t" onMatchFound={() => {}} onSetupChessPaired={() => {}} onBack={() => {}} />);

  it('Join: asks with a 6000 ms deadline; no answer says "Can\'t reach the server"; the server\'s refusal keeps its words', () => {
    renderChallenge();
    fireEvent.click(screen.getByText('Join by Code'));
    fireEvent.change(screen.getByPlaceholderText('ABC123'), { target: { value: 'QQQ111' } });
    fireEvent.click(screen.getByText('Join'));
    expect(last().event).toBe('join_challenge');
    expect(last().payload).toEqual({ code: 'QQQ111' });
    expect(last().ms).toBe(6000);
    act(() => last().answer(timedOut()));
    expect(screen.getByText("Can't reach the server")).toBeTruthy();
    fireEvent.click(screen.getByText('Join'));
    act(() => last().answer(null, { ok: false, error: 'Code expired' }));
    expect(screen.getByText('Code expired')).toBeTruthy();
  });

  it('Create: asks with a 6000 ms deadline; no answer says "Can\'t reach the server"; the answer shows the code', () => {
    renderChallenge();
    fireEvent.click(screen.getByText('Create Challenge'));
    fireEvent.click(screen.getAllByText(/^\d/)[0]);
    expect(last().event).toBe('create_challenge');
    expect(last().ms).toBe(6000);
    act(() => last().answer(timedOut()));
    expect(screen.getByText("Can't reach the server")).toBeTruthy();
    fireEvent.click(screen.getAllByText(/^\d/)[0]);
    act(() => last().answer(null, { ok: true, code: 'XYZ789' }));
    expect(screen.getByText('XYZ789')).toBeTruthy();
  });
});
