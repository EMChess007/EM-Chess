import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VariantSelector from '../../components/VariantSelector';
import TournamentScreen from '../TournamentScreen';
import TournamentStandingsScreen from '../TournamentStandingsScreen';

/**
 * Command #65: a tournament can be created in every 2-player variant the online picker offers (Setup Chess excepted), the lobby and the standings
 * name the variant, and a match opens the right game. The socket is a recording stand-in (same shape as offlineSockets.dom.test.tsx); the screens are the real ones.
 */
interface Request {
  event: string;
  payload: Record<string, unknown>;
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
    timeout: () => ({
      emit: (event: string, payload: Record<string, unknown>, answer: (err: unknown, ack?: unknown) => void) => {
        requests.push({ event, payload, answer });
      },
    }),
  };
  return { requests, handlers, fake };
});
vi.mock('../../api/socket', () => ({ connectSocket: () => fake, getSocket: () => fake, disconnectSocket: vi.fn() }));

const USER = { id: 'u1', email: 'a@b.c', username: 'ann', createdAt: '2026-01-01T00:00:00Z' };
const last = () => requests[requests.length - 1];

// Literals on purpose: the chip label the user taps, the wire flag that must be true, the name the lobby / standings show.
const TOURNAMENT_VARIANTS: { label: string; flag: string; name: string }[] = [
  { label: 'Classic', flag: '', name: 'Classic' },
  { label: 'Chess960', flag: 'isChess960', name: 'Chess960' },
  { label: 'King of the Hill', flag: 'isKingOfTheHill', name: 'King of the Hill' },
  { label: 'Three- Check', flag: 'isThreeCheck', name: 'Three-Check' },
  { label: 'Fog of War', flag: 'isFogOfWar', name: 'Fog of War' },
  { label: 'Giveaway', flag: 'isGiveaway', name: 'Giveaway' },
  { label: 'Atomic', flag: 'isAtomic', name: 'Atomic' },
  { label: 'Duck Chess', flag: 'isDuckChess', name: 'Duck Chess' },
  { label: 'Spell Chess', flag: 'isSpellChess', name: 'Spell Chess' },
  { label: 'Horde', flag: 'isHorde', name: 'Horde' },
  { label: 'Racing Kings', flag: 'isRacingKings', name: 'Racing Kings' },
  { label: 'Torpedo', flag: 'isTorpedo', name: 'Torpedo' },
  { label: 'Knightmate', flag: 'isKnightmate', name: 'Knightmate' },
  { label: 'Crazyhouse', flag: 'isCrazyhouse', name: 'Crazyhouse' },
];
const ALL_FLAGS = ['isChess960', 'isKingOfTheHill', 'isThreeCheck', 'isSetupChess', 'isFogOfWar', 'isGiveaway', 'isAtomic', 'isDuckChess', 'isSpellChess', 'isHorde', 'isRacingKings', 'isTorpedo', 'isKnightmate', 'isCrazyhouse'];

const renderTournament = () => render(<TournamentScreen authToken="t" authUser={USER} onEnterStandings={() => {}} onBack={() => {}} />);
const openCreateForm = () => {
  fireEvent.click(screen.getByText('Create Tournament'));
  fireEvent.change(screen.getByPlaceholderText('Friday Night Blitz'), { target: { value: 'Cup' } });
};

beforeEach(() => {
  requests.length = 0;
});
afterEach(() => cleanup());

describe('Tournament creation form', () => {
  it('offers every online variant chip except Setup Chess (and no From Position)', () => {
    renderTournament();
    openCreateForm();
    for (const v of TOURNAMENT_VARIANTS) expect(screen.queryByText(v.label), `${v.label} chip`).toBeTruthy();
    expect(screen.queryByText('Setup Chess')).toBeNull();
    expect(screen.queryByText(/From Position/i)).toBeNull();
    // Same source as online play: the chips the shared picker shows without any exclusion are exactly these + Setup Chess.
    cleanup();
    render(<VariantSelector value="classic" onChange={() => {}} />);
    expect(screen.queryByText('Setup Chess')).toBeTruthy();
    for (const v of TOURNAMENT_VARIANTS) expect(screen.queryByText(v.label), `${v.label} online chip`).toBeTruthy();
  });

  for (const v of TOURNAMENT_VARIANTS) {
    it(`${v.label}: create_tournament carries exactly that flag, and the lobby names the variant`, () => {
      renderTournament();
      openCreateForm();
      fireEvent.click(screen.getByText(v.label));
      fireEvent.click(screen.getAllByText(/^\d/)[0]); // the first time control preset
      expect(last().event).toBe('create_tournament');
      for (const flag of ALL_FLAGS) expect(last().payload[flag], `${flag} for ${v.label}`).toBe(flag === v.flag);
      expect(last().payload).not.toHaveProperty('initialFen');
      act(() => last().answer(null, { ok: true, code: 'ABC123', tournamentId: 'T9' }));
      expect(screen.getByText('ABC123')).toBeTruthy();
      expect(screen.getByText(v.name)).toBeTruthy();
    });
  }

  it('the lobby update from the server (another player joined) keeps naming the variant', () => {
    renderTournament();
    openCreateForm();
    fireEvent.click(screen.getByText('Fog of War'));
    fireEvent.click(screen.getAllByText(/^\d/)[0]);
    act(() => last().answer(null, { ok: true, code: 'ABC123', tournamentId: 'T9' }));
    act(() =>
      handlers.tournament_lobby_update({
        id: 'T9',
        code: 'ABC123',
        name: 'Cup',
        timeControl: { initialSeconds: 180, incrementSeconds: 0 },
        ...Object.fromEntries(ALL_FLAGS.map((f) => [f, f === 'isHorde'])),
        status: 'lobby',
        creatorUserId: 'u1',
        participants: [{ userId: 'u1', username: 'ann' }],
      }),
    );
    expect(screen.getByText('Horde')).toBeTruthy();
  });
});

describe('Tournament standings and match entry', () => {
  const standingsFor = (flag: string) => ({
    standings: [{ userId: 'u1', username: 'ann', points: 0, played: 0 }],
    status: 'active',
    yourNextMatch: null,
    ...Object.fromEntries(ALL_FLAGS.map((f) => [f, f === flag])),
  });

  for (const v of TOURNAMENT_VARIANTS.filter((x) => x.flag !== '')) {
    it(`${v.label}: the standings name the variant and tournament_match_ready opens a game of that variant`, () => {
      const onEnterGame = vi.fn();
      render(<TournamentStandingsScreen authToken="t" authUser={USER} tournamentId="T1" onEnterGame={onEnterGame} onExit={() => {}} />);
      act(() => last().answer(null, { ok: true, standings: standingsFor(v.flag) }));
      expect(screen.getByText(v.name)).toBeTruthy();
      act(() =>
        handlers.tournament_match_ready({
          roomId: 'R1',
          color: 'w',
          playerToken: 'tok',
          opponent: { userId: 'u2', username: 'bo' },
          timeControl: { initialSeconds: 180, incrementSeconds: 0 },
          ...Object.fromEntries(ALL_FLAGS.map((f) => [f, f === v.flag])),
          fen: 'start-fen',
          whiteMs: 180000,
          blackMs: 180000,
          visibleSquares: ['e2'],
        }),
      );
      expect(onEnterGame).toHaveBeenCalledTimes(1);
      const match = onEnterGame.mock.calls[0][0];
      for (const flag of ALL_FLAGS) expect(match[flag], `${flag} for ${v.label}`).toBe(flag === v.flag);
      expect(match.roomId).toBe('R1');
      expect(match.opponent).toEqual({ userId: 'u2' });
      expect(match.fen).toBe('start-fen');
      expect(match.visibleSquares).toEqual(['e2']);
    });
  }

  it('an older server that sends no variant flags is read as Classic', () => {
    render(<TournamentStandingsScreen authToken="t" authUser={USER} tournamentId="T1" onEnterGame={() => {}} onExit={() => {}} />);
    act(() => last().answer(null, { ok: true, standings: { standings: [], status: 'active', yourNextMatch: null } }));
    expect(screen.getByText('Classic')).toBeTruthy();
  });
});
