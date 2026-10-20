import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppAlertHost from '../../components/AppAlert';
import { SEAT_NAMES, SQUARE8, type Seat, type FourPlayerState } from '../../logic/fourPlayer';
import { viewFromRoom, type FourOnlineView } from '../../logic/fourPlayerOnline';
import type { FourActiveGameSummary, FourSeats } from '../../logic/fourPlayerWire';
import { ChaturajiSim, cjSeats, cp, findMove } from '../../logic/__tests__/chaturajiKit';
import { cellOf, seatCard, tapMove, tapSquare } from '../../test/domKit';
import type { TimeControl } from '../../types/timeControl';

/**
 * CHATURAJI W3 - the ONLINE screens, rendered for real. The socket is the only thing replaced: `useFourPlayerOnlineGame` is a harness the test drives with views built by the
 * client's own reducer (`viewFromRoom`) from a server simulator on the real engine, so every snapshot, seat list and game-over payload is exactly what a server sends. What is
 * checked is what the player sees: the board, the clocks, the points, the statuses, the bot-takeover badge, the "+N" at the seat that scored, the result.
 */
const harness = vi.hoisted(() => ({
  hook: null as unknown,
  sockets: [] as unknown[],
  listed: [] as unknown[],
}));
vi.mock('../../logic/useFourPlayerOnlineGame', () => ({ useFourPlayerOnlineGame: () => harness.hook }));
vi.mock('../../api/socket', () => ({
  connectSocket: () => harness.sockets[harness.sockets.length - 1],
  disconnectSocket: vi.fn(),
}));

import FourPlayerMatchmakingScreen from '../FourPlayerMatchmakingScreen';
import FourPlayerOnlineGameScreen from '../FourPlayerOnlineGameScreen';
import FourPlayerSpectatorScreen from '../FourPlayerSpectatorScreen';
import SpectateListScreen from '../SpectateListScreen';

const RED = 0 as Seat;
const T0 = 1_700_000_000_000;
const KINGS = ['rK@a1', 'bK@a8', 'yK@h8', 'gK@h1'];

interface HookOverrides {
  connection?: 'connected' | 'reconnecting' | 'unavailable';
  problem?: string | null;
}

const setHook = (view: FourOnlineView | null, over: HookOverrides = {}) => {
  const calls = { sendMove: vi.fn(), resign: vi.fn(), leave: vi.fn(), sendChat: vi.fn(), markChatRead: vi.fn() };
  harness.hook = {
    view,
    connection: over.connection ?? 'connected',
    problem: over.problem ?? null,
    chat: [],
    chatUnread: 0,
    boardKey: 0,
    now: view?.clocksAt ?? T0,
    ...calls,
  };
  return calls;
};

const matchOf = (sim: ChaturajiSim, seat: Seat = RED) => sim.match(seat);
const viewOf = (sim: ChaturajiSim, seat: Seat | null = RED, seats?: FourSeats): FourOnlineView => {
  const room = sim.room();
  const view = viewFromRoom(seats ? { ...room, seats } : room, seat, T0);
  if (!view) throw new Error('the simulator produced a room the client cannot read');
  return view;
};

const renderPlayer = (view: FourOnlineView, callbacks: { onExit?: () => void; onPlayAgain?: () => void } = {}) => {
  const sim = new ChaturajiSim();
  const calls = setHook(view);
  const utils = render(
    <>
      <FourPlayerOnlineGameScreen authToken="t" match={matchOf(sim)} resume onExit={callbacks.onExit ?? (() => {})} onPlayAgain={callbacks.onPlayAgain ?? (() => {})} />
      <AppAlertHost />
    </>
  );
  return { ...utils, calls };
};

beforeEach(() => {
  vi.useFakeTimers();
  harness.sockets.length = 0;
});

/** What a cell must say for the engine state it shows: "e4, Red knight" or "eliminated Blue pawn", or just the square for an empty one. */
function expectedCellStart(state: FourPlayerState, square: number): string {
  const name = SQUARE8.squareName(square);
  const code = state.cells[square];
  if (code <= 0) return name;
  const seat = (code >> 4) as Seat;
  return `${name}, ${state.status[seat] === 'active' ? '' : 'eliminated '}${SEAT_NAMES[seat]}`;
}

describe('an online Chaturaji game restored from a rejoin snapshot', () => {
  // A game in progress: Red (me) active, Blue active but played by a bot that took over, Yellow resigned (a walking king), Green's king was captured.
  const start = cp(['rK@a1', 'rR@d4', 'rP@c5', 'bK@a8', 'bP@b5', 'yK@h8', 'yP@e7', 'gK@h1', 'gP@g2'], { turn: RED, status: ['active', 'active', 'dead-king', 'frozen'], score: [7, 3, 0, 5], ply: 31 });
  const seats = cjSeats({ 1: { kind: 'bot', botReason: 'takeover', connected: true }, 3: { connected: false, graceMsLeft: 20_000 } });

  it('shows the board exactly as the snapshot says, the points and clocks of the seats, who plays what, and every status', () => {
    const sim = new ChaturajiSim(1, start);
    sim.clocks = [250, 100, 0, 59];
    const view = viewOf(sim, RED, seats);
    renderPlayer(view);
    // the board: every one of the 64 squares agrees with the engine state (grey for the eliminated seats' pieces)
    for (let square = 0; square < 64; square++) {
      const cell = screen.getByLabelText(new RegExp(`^${SQUARE8.squareName(square)}(,|$)`));
      expect(cell.getAttribute('aria-label')!.startsWith(expectedCellStart(view.state, square)), SQUARE8.squareName(square)).toBe(true);
    }
    expect(screen.getByLabelText('Chaturaji board')).toBeTruthy();
    // the seat cards: points from the snapshot, clocks from the server's figures, status words
    expect(seatCard(0).textContent).toContain('Ana (you)');
    expect(seatCard(0).textContent).toContain('7');
    expect(seatCard(0).textContent).toContain('4:10');
    expect(seatCard(1).textContent).toContain('Ben');
    expect(seatCard(1).textContent).toContain('bot playing'); // a seat a bot took over keeps the human's name and says so
    expect(seatCard(1).textContent).toContain('3');
    expect(seatCard(2).textContent).toContain('king walking');
    expect(seatCard(2).textContent).toContain('0:00');
    expect(seatCard(3).textContent).toContain('out');
    expect(seatCard(3).textContent).toContain('5');
    expect(screen.getByText('Your move')).toBeTruthy();
    expect(screen.queryByTestId('result-card')).toBeNull();
  });

  it('a human who dropped off shows "offline" with the grace countdown, then comes back as the human (the bot badge goes)', () => {
    const sim = new ChaturajiSim(1, cp(KINGS, { turn: RED }));
    const away = cjSeats({ 1: { connected: false, graceMsLeft: 30_000 } });
    const first = renderPlayer(viewOf(sim, RED, away));
    expect(seatCard(1).textContent).toMatch(/offline · 30s/);
    first.unmount();
    const taken = cjSeats({ 1: { kind: 'bot', botReason: 'takeover', connected: true } });
    setHook(viewOf(sim, RED, taken));
    const { unmount } = render(<FourPlayerOnlineGameScreen authToken="t" match={matchOf(sim)} resume onExit={() => {}} onPlayAgain={() => {}} />);
    expect(screen.getAllByText('bot playing').length).toBeGreaterThan(0);
    unmount();
    setHook(viewOf(sim, RED, cjSeats()));
    render(<FourPlayerOnlineGameScreen authToken="t" match={matchOf(sim)} resume onExit={() => {}} onPlayAgain={() => {}} />);
    expect(screen.queryByText('bot playing')).toBeNull();
    expect(screen.queryByText(/offline/)).toBeNull();
  });

  it('the status line, the pill and the rules button: my king attacked shows the pill (not a red check), and the other seats\' threats are theirs', () => {
    const sim = new ChaturajiSim(1, cp(['rK@d1', 'rP@a2', 'bR@d8', 'bK@b7', 'yK@h6', 'gK@h2'], { turn: 1 }));
    renderPlayer(viewOf(sim, RED));
    expect(screen.getByTestId('king-attacked-pill').textContent).toBe('Your king is attacked — it can be captured');
    expect(cellOf('d1').getAttribute('aria-label')).toContain('king attacked');
    expect(screen.queryByText(/in check/i)).toBeNull();
    fireEvent.click(screen.getByText('Rules'));
    expect(screen.getByText('How to play Chaturaji')).toBeTruthy();
  });

  it('a spectator\'s seat has no pill, however many kings are attacked', () => {
    const sim = new ChaturajiSim(1, cp(['rK@d1', 'rP@a2', 'bR@d8', 'bK@b7', 'yK@h6', 'gK@h2'], { turn: 1 }));
    setHook(viewOf(sim, null));
    render(<FourPlayerSpectatorScreen authToken={null} roomId="r" onExit={() => {}} />);
    expect(screen.queryByTestId('king-attacked-pill')).toBeNull();
    expect(screen.getByLabelText('Chaturaji board')).toBeTruthy();
    expect(seatCard(0).textContent).toContain('king attacked'); // the seat card still says it for the watcher
  });
});

describe('moving online', () => {
  it('a tap-to-move sends the engine\'s move for the room (and a promotion goes without a question)', () => {
    const sim = new ChaturajiSim(1, cp([...KINGS, 'rP@c7', 'rR@a4'], { turn: RED }));
    const { calls } = renderPlayer(viewOf(sim, RED));
    tapSquare('a4');
    expect(screen.queryAllByLabelText(/can move here/).length).toBeGreaterThan(5); // the boat's moves, from the engine
    tapSquare('a4');
    tapMove('c7', 'c8');
    expect(screen.queryByText('Queen')).toBeNull();
    expect(calls.sendMove).toHaveBeenCalledTimes(1);
    const sent = calls.sendMove.mock.calls[0][0] as { from: number; to: number; flags: number };
    expect([SQUARE8.squareName(sent.from), SQUARE8.squareName(sent.to)]).toEqual(['c7', 'c8']);
    expect(sent.flags & 4).toBe(4); // a promotion
  });

  it('it is not my turn: a tap is a premove, not a move, and the line names squares on the 8 x 8 board', () => {
    const sim = new ChaturajiSim(1, cp([...KINGS, 'rP@c7', 'bP@b5'], { turn: 1 }));
    const { calls } = renderPlayer(viewOf(sim, RED));
    tapMove('c7', 'c8');
    expect(calls.sendMove).not.toHaveBeenCalled();
    expect(screen.getByText(/Premove queued: c7-c8=R/)).toBeTruthy();
  });
});

describe('the "+N" of a seat that scored, from the server\'s consecutive snapshots', () => {
  it('shows the points the server\'s score went up by, at that seat, and drops them after a moment', () => {
    const sim = new ChaturajiSim(1, cp(['rK@a1', 'rR@d4', 'bP@d6', 'bK@a8', 'yK@h8', 'gK@h1'], { turn: RED }));
    const before = viewOf(sim, RED);
    setHook(before);
    const { rerender } = render(<FourPlayerOnlineGameScreen authToken="t" match={matchOf(sim)} resume onExit={() => {}} onPlayAgain={() => {}} />);
    expect(screen.queryByTestId('gain-0')).toBeNull(); // the first snapshot is only remembered
    sim.play(findMove(sim.state, 'd4xd6'));
    const after = viewOf(sim, RED);
    expect(after.state.score[0]).toBe(1);
    setHook(after);
    rerender(<FourPlayerOnlineGameScreen authToken="t" match={matchOf(sim)} resume onExit={() => {}} onPlayAgain={() => {}} />);
    expect(screen.getByTestId('gain-0').textContent).toBe(`+${after.state.score[0]}`);
    expect(screen.getByTestId('seat-0').textContent).toContain('1');
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.queryByTestId('gain-0')).toBeNull();
  });

  it('a catch-up after lost messages (a long jump of the position) announces nothing, and neither does a restored game', () => {
    const early = new ChaturajiSim(1, cp(['rK@a1', 'rR@d4', 'bP@d6', 'bK@a8', 'yK@h8', 'gK@h1'], { turn: RED, ply: 3, score: [0, 0, 0, 0] }));
    setHook(viewOf(early, RED));
    const { rerender } = render(<FourPlayerOnlineGameScreen authToken="t" match={matchOf(early)} resume onExit={() => {}} onPlayAgain={() => {}} />);
    const later = new ChaturajiSim(1, cp(['rK@a1', 'rR@d4', 'bK@a8', 'yK@h8', 'gK@h1'], { turn: RED, ply: 40, score: [6, 0, 2, 0] }));
    setHook(viewOf(later, RED));
    rerender(<FourPlayerOnlineGameScreen authToken="t" match={matchOf(early)} resume onExit={() => {}} onPlayAgain={() => {}} />);
    expect(screen.queryByTestId('gain-0')).toBeNull();
    expect(screen.queryByTestId('gain-2')).toBeNull();
    expect(seatCard(0).textContent).toContain('6'); // the score itself is the snapshot's
  });
});

describe('the end of an online game', () => {
  it('shows the server\'s result: the ranking, the bonus explained, the reason, Play again and Back to menu', () => {
    const sim = new ChaturajiSim(1, cp(['rK@a1', 'rR@d4', 'bK@a8', 'yK@h8', 'gK@d8'], { turn: RED, status: ['active', 'dead-king', 'dead-king', 'active'], score: [2, 0, 0, 1] }));
    sim.play(findMove(sim.state, 'd4xd8'));
    const over = sim.over();
    const view = { ...viewOf(sim, RED), gameOver: over };
    const onPlayAgain = vi.fn();
    const onExit = vi.fn();
    renderPlayer(view, { onPlayAgain, onExit });
    expect(screen.getByText('Game over — Red wins')).toBeTruthy();
    expect(screen.getByTestId(`result-score-0`).textContent).toBe(String(over.scores[0]));
    expect(screen.getByTestId('result-detail-0').textContent).toBe('11 points — 5 from play + 6 for 2 kings left');
    expect(screen.getByText(/Three players eliminated/)).toBeTruthy();
    fireEvent.click(screen.getByText('Play again'));
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Back to menu'));
    expect(onExit).toHaveBeenCalledWith(false);
  });

  it('an abandoned game has no table, only the note', () => {
    const sim = new ChaturajiSim(1, cp(KINGS, { turn: RED }));
    renderPlayer({ ...viewOf(sim, RED), gameOver: sim.over('abandoned') });
    expect(screen.getByText('Game abandoned — no result')).toBeTruthy();
    expect(screen.queryByTestId('result-score-0')).toBeNull();
    expect(screen.getByText(/Every human player left/)).toBeTruthy();
  });

  it('leaving a live seat asks first; resigning explains the walking king', () => {
    const sim = new ChaturajiSim(1, cp(KINGS, { turn: RED }));
    const { calls } = renderPlayer(viewOf(sim, RED));
    fireEvent.click(screen.getByText('Resign'));
    expect(screen.getByText(/its king keeps walking at random/)).toBeTruthy();
    fireEvent.click(screen.getAllByText('Resign').at(-1)!);
    expect(calls.resign).toHaveBeenCalledTimes(1);
  });
});

describe('the queue and the Spectate list', () => {
  const fakeSocket = () => {
    const handlers = new Map<string, (payload: never) => void>();
    const emitted: { event: string; payload: unknown }[] = [];
    const socket = {
      on: (event: string, cb: (payload: never) => void) => void handlers.set(event, cb),
      off: (event: string) => void handlers.delete(event),
      emit: (event: string, payload: unknown, ack?: (response: unknown) => void) => {
        emitted.push({ event, payload });
        ack?.({ ok: true, games: [] }); // the 2-player calls answer with the ack alone
      },
      timeout: () => ({
        emit: (event: string, payload: unknown, ack?: (err: unknown, response?: unknown) => void) => {
          emitted.push({ event, payload });
          if (event === 'four_list_active_games') ack?.(null, { ok: true, games: harness.listed });
          else ack?.(null, { ok: true });
        },
      }),
      io: { on: () => {}, off: () => {} },
    };
    harness.sockets.push(socket);
    return { socket, handlers, emitted };
  };
  const TC: TimeControl = { id: 'b5', label: '5 min', initialSeconds: 300, incrementSeconds: 0, category: 'blitz' };

  it('queues for Chaturaji with the variant on the wire and the rule hint on screen, then plays the match it is given', () => {
    const { handlers, emitted } = fakeSocket();
    const onMatchFound = vi.fn();
    render(<FourPlayerMatchmakingScreen variant="chaturaji" authToken="t" timeControl={TC} onMatchFound={onMatchFound} onCancel={() => {}} />);
    expect(screen.getByText(/Chaturaji · 5 min/)).toBeTruthy();
    expect(screen.getByText(/A king must be captured; a check need not be answered/)).toBeTruthy();
    expect(emitted.find((e) => e.event === 'four_join_queue')?.payload).toMatchObject({ variant: 'chaturaji', timeControlLabel: '5 min' });
    act(() => handlers.get('four_queue_update')!({ queued: 2, fillInMs: 12_000 } as never));
    expect(screen.getByText('2 players waiting')).toBeTruthy();
    const sim = new ChaturajiSim();
    act(() => handlers.get('four_match_found')!(sim.match(RED) as never));
    expect(onMatchFound).toHaveBeenCalledTimes(1);
  });

  it('refuses a server that answers with another game: it leaves the seat and says so (the old-server safety)', () => {
    const { handlers, emitted } = fakeSocket();
    const onMatchFound = vi.fn();
    render(<FourPlayerMatchmakingScreen variant="chaturaji" authToken="t" timeControl={TC} onMatchFound={onMatchFound} onCancel={() => {}} />);
    const sim = new ChaturajiSim();
    const { variant: _unused, ...chessMatch } = sim.match(RED);
    void _unused;
    act(() => handlers.get('four_match_found')!(chessMatch as never)); // no variant = 4 Player Chess from an old server
    expect(onMatchFound).not.toHaveBeenCalled();
    expect(screen.getByText(/does not support Chaturaji/)).toBeTruthy();
    expect(emitted.some((e) => e.event === 'four_resign')).toBe(true);
  });

  it('lists a live Chaturaji game under its own header and opens it to watch', () => {
    const summary = (roomId: string, variant?: 'ffa' | 'chaturaji'): FourActiveGameSummary => ({ roomId, ...(variant ? { variant } : {}), timeControlLabel: '5 min', seats: cjSeats(), spectators: 0 }) as unknown as FourActiveGameSummary;
    harness.listed = [summary('c1', 'chaturaji'), summary('f1', 'ffa')];
    fakeSocket();
    const onWatchFour = vi.fn();
    render(<SpectateListScreen authToken={null} onWatch={() => {}} onWatchFour={onWatchFour} onBack={() => {}} />);
    expect(screen.getByText('Chaturaji')).toBeTruthy();
    expect(screen.getByText('4 Player Chess')).toBeTruthy();
    const rows = screen.getAllByText(/Ana · Ben · Cy · Di/);
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[1]); // the second list entry is the Chaturaji game: it sits below the Chess one only if the sections are in the documented order
    expect(onWatchFour).toHaveBeenCalledTimes(1);
    expect((onWatchFour.mock.calls[0][0] as { roomId: string }).roomId).toBe('c1');
  });
});

describe('what a spectator sees', () => {
  it('the clocks and the clock formatting come from the server figures', () => {
    const sim = new ChaturajiSim(1, cp(KINGS, { turn: RED }));
    sim.clocks = [3600, 61, 9.2, 0];
    setHook(viewOf(sim, null));
    render(<FourPlayerSpectatorScreen authToken={null} roomId="r" onExit={() => {}} />);
    expect(seatCard(0).textContent).toContain('1:00:00');
    expect(seatCard(1).textContent).toContain('1:01');
    expect(seatCard(2).textContent).toContain('0:10'); // rounded UP: never 0:00 while time is left
    expect(within(seatCard(3)).getByText('0:00')).toBeTruthy();
  });
});
