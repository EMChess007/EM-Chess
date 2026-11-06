import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppAlertHost from '../../components/AppAlert';
import { createMatch, remainingAt, serializeMatch, settle, type BughouseAction, type BughouseMatch, type BughouseSeat } from '../../logic/bughouse';
import type { BoardId } from '../../logic/bughouse/types';
import type { BugGameOverPayload, BugMatchFoundPayload, BugRejoinAck, BugSeats, BugStatePayload } from '../../logic/bughouse/wire';
import { CANT_REACH } from '../../logic/bughouseOnlineSession';
import { formatBughouseClock, gameOverSummary } from '../../logic/bughouseView';
import { FakeBugSocket } from '../../test/fakeBugSocket';
import { setWindowSize, tapBoardSquare } from '../../test/domKit';
import BughouseOnlineGameScreen from '../BughouseOnlineGameScreen';

/**
 * ONLINE BUGHOUSE, THE GAME SCREEN RENDERED (W4): the real screen - the Local game screen's own boards, pockets and layouts, given the SERVER's match - on a fake socket, with real engine
 * snapshots. What the boards show is compared with the engine's match; the screen never plays a move itself (a tap is SENT and the board changes when the server's snapshot arrives);
 * the clocks are the server's instant estimated from the snapshot; every wait has an answer or a sentence and a Retry. Fake timers, no wall clock.
 */
const fake = vi.hoisted(() => ({ socket: null as unknown, disconnect: null as unknown }));
vi.mock('../../api/socket', () => ({ connectSocket: () => fake.socket, disconnectSocket: () => (fake.disconnect as () => void)() }));
vi.mock('../../logic/moveSounds', () => ({ playMoveSound: vi.fn() }));
vi.mock('../../logic/haptics', () => ({ triggerMoveHaptics: vi.fn(), triggerGameEndHaptics: vi.fn() }));
vi.mock('../../logic/diagnosticLog', () => ({ logDiagnostic: vi.fn() }));

const TC = { initialMs: 60000, incrementMs: 0 };
const ROOM = 'room-1';
const SEATS: BugSeats = [
  { seat: 0, kind: 'human', name: 'Ana', connected: true },
  { seat: 1, kind: 'bot', botReason: 'fill', name: 'Bot (Amateur)', connected: true },
  { seat: 2, kind: 'bot', botReason: 'fill', name: 'Bot (Beginner)', connected: true },
  { seat: 3, kind: 'human', name: 'Ben', connected: true },
];

let socket: FakeBugSocket;
let disconnected: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  socket = new FakeBugSocket();
  disconnected = vi.fn();
  fake.socket = socket;
  fake.disconnect = disconnected;
});
afterEach(() => {
  vi.restoreAllMocks();
});

const start = (): BughouseMatch => createMatch({ timeControl: TC, roomNumber: 2, startMs: 0 });
const play = (match: BughouseMatch, seat: BughouseSeat, action: BughouseAction, now: number) => {
  const outcome = settle(match, { seat, action }, now);
  if (outcome.kind !== 'applied' && outcome.kind !== 'flag') throw new Error(`not applied: ${outcome.kind}`);
  return outcome;
};
const found = (seat: BughouseSeat = 0, match: BughouseMatch = start()): BugMatchFoundPayload => ({ roomId: ROOM, seat, playerToken: 'tok', seats: SEATS, timeControl: TC, timeControlLabel: '1 min', state: serializeMatch(match), serverNowMs: 0, seq: 0 });
const stateOf = (outcome: { match: BughouseMatch; events: unknown[] }, serverNowMs: number): BugStatePayload => ({ roomId: ROOM, seq: outcome.match.seq, events: outcome.events as BugStatePayload['events'], state: serializeMatch(outcome.match), serverNowMs });
const roomAck = (match: BughouseMatch, serverNowMs: number): BugRejoinAck => ({ ok: true, state: { roomId: ROOM, seat: 0, seats: SEATS, timeControl: TC, timeControlLabel: '1 min', seq: match.seq, state: serializeMatch(match), serverNowMs, log: [] } });

const renderGame = (over: Partial<Parameters<typeof BughouseOnlineGameScreen>[0]> = {}) => {
  const onExit = vi.fn();
  const onPlayAgain = vi.fn();
  const utils = render(
    <>
      <BughouseOnlineGameScreen authToken="t" match={found()} resume={false} onExit={onExit} onPlayAgain={onPlayAgain} {...over} />
      <AppAlertHost />
    </>
  );
  return { ...utils, onExit, onPlayAgain };
};
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const fire = (event: string, payload?: unknown) => act(() => socket.fire(event, payload));
const answer = (event: string, ack: unknown) => act(() => void socket.answer(event, ack));
const silence = (event: string) => act(() => void socket.silence(event));
const labelOf = (board: BoardId, square: string): string => screen.getByTestId(`${board}-${square}`).getAttribute('aria-label') ?? '';
const text = (id: string): string => screen.getByTestId(id).textContent ?? '';
const E4A = { kind: 'move', board: 'A', from: 'e2', to: 'e4' } as const;
const first = play(start(), 0, E4A, 2000);

describe('the screen', () => {
  it('says where I sit and who my partner is, and shows both boards from the engine\'s start position', () => {
    renderGame();
    expect(text('bughouse-online-intro')).toBe('You: Board A · White · Team 1 · Partner: Ben (Board B · Black)');
    const match = start();
    for (const board of ['A', 'B'] as BoardId[]) {
      expect(labelOf(board, 'e1')).toContain('White king');
      expect(labelOf(board, 'e2')).toContain('White pawn');
      expect(labelOf(board, 'e7')).toContain('Black pawn');
      expect(labelOf(board, 'e4')).toBe(`e4, board ${board}`);
    }
    expect(match.boards.A.fen).toBe(match.boards.B.fen);
    expect(screen.getByText('Online · 1 min')).toBeTruthy();
    expect(screen.queryByTestId('bughouse-rematch')).toBeNull();
  });

  it('names the seats from the SERVER: "(you)", the bots by their names, the partner', () => {
    renderGame();
    expect(screen.getAllByText(/Ana \(you\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Bot \(Amateur\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Ben/).length).toBeGreaterThan(0);
  });

  it('is the Local screen\'s layout: my board large and the partner\'s as a thumbnail in a phone window, two boards side by side in a landscape one', () => {
    const { unmount } = renderGame();
    expect(screen.getByTestId('layout-thumbnail')).toBeTruthy();
    unmount();
    setWindowSize(800, 360);
    renderGame();
    expect(screen.getByTestId('layout-side-by-side')).toBeTruthy();
  });
});

describe('a move is SENT, never played here', () => {
  it('two taps send bug_move (room, board, squares, the seq it was chosen on); the board is unchanged until the server\'s snapshot arrives', () => {
    renderGame();
    tapBoardSquare('A', 'e2', 'w');
    tapBoardSquare('A', 'e4', 'w');
    const [req] = socket.pending('bug_move');
    expect(req.payload).toEqual({ roomId: 'room-1', board: 'A', from: 'e2', to: 'e4', baseSeq: 0 });
    expect(req.ms).toBe(6000);
    expect(labelOf('A', 'e2')).toContain('White pawn');
    expect(labelOf('A', 'e4')).toBe('e4, board A');
    answer('bug_move', { ok: true, seq: 1 });
    expect(labelOf('A', 'e4')).toBe('e4, board A'); // acked, still not shown: only the snapshot moves a piece
    fire('bug_state', stateOf(first, 2000));
    expect(labelOf('A', 'e4')).toContain('White pawn');
    expect(labelOf('A', 'e2')).toBe('e2, board A');
  });

  it('while the move waits for its ack a second one is not sent', () => {
    renderGame();
    tapBoardSquare('A', 'e2', 'w');
    tapBoardSquare('A', 'e4', 'w');
    tapBoardSquare('A', 'd2', 'w');
    tapBoardSquare('A', 'd4', 'w');
    expect(socket.pending('bug_move')).toHaveLength(1);
  });

  it('on the opponent\'s turn nothing is sent (the board is not mine to touch)', () => {
    renderGame();
    fire('bug_state', stateOf(first, 2000)); // Black to move on A
    tapBoardSquare('A', 'd2', 'w');
    tapBoardSquare('A', 'd4', 'w');
    expect(socket.asked).toHaveLength(0);
  });

  it('a refusal shows its sentence and the position stays the server\'s', () => {
    renderGame();
    tapBoardSquare('A', 'e2', 'w');
    tapBoardSquare('A', 'e4', 'w');
    answer('bug_move', { ok: false, error: 'Illegal', reason: 'illegalMove' });
    expect(text('bughouse-online-action-error')).toBe('That move is not legal.');
    expect(labelOf('A', 'e2')).toContain('White pawn');
    // the board is live again
    tapBoardSquare('A', 'd2', 'w');
    tapBoardSquare('A', 'd4', 'w');
    expect(socket.pending('bug_move')).toHaveLength(1);
  });

  it('SILENCE: "Can\'t reach the server", and the room is read again (bug_rejoin, 6 s)', () => {
    renderGame();
    tapBoardSquare('A', 'e2', 'w');
    tapBoardSquare('A', 'e4', 'w');
    silence('bug_move');
    expect(text('bughouse-online-action-error')).toContain(CANT_REACH);
    expect(socket.pending('bug_rejoin')).toHaveLength(1);
    expect(socket.pending('bug_rejoin')[0].ms).toBe(6000);
  });

  it('the partner\'s board (the thumbnail) follows the stream: a move there, played by the partner, appears', () => {
    renderGame();
    const second = play(first.match, 2, { kind: 'move', board: 'B', from: 'd2', to: 'd4' }, 2500);
    fire('bug_state', stateOf(first, 2000));
    fire('bug_state', stateOf(second, 2500));
    expect(labelOf('B', 'd4')).toContain('White pawn');
    expect(labelOf('B', 'd2')).toBe('d2, board B');
    expect(labelOf('A', 'e4')).toContain('White pawn');
  });
});

describe('clocks: the server\'s instant, estimated from the snapshot', () => {
  it('the running clock counts from the snapshot\'s serverNowMs plus the LOCAL time since it arrived; a stopped clock is frozen', () => {
    renderGame();
    expect(text('clock-A-white')).toBe(formatBughouseClock(60000));
    advance(5000); // 5 s of the local clock: the match is at server instant 5000
    const m0 = start();
    expect(text('clock-A-white')).toBe(formatBughouseClock(remainingAt(m0.clocks[0], 5000)));
    expect(text('clock-A-white')).toBe('0:55');
    expect(text('clock-A-black')).toBe('1:00');
    // a snapshot: White moved at server instant 7000; this client got it 5 s after mount
    const moved = play(start(), 0, E4A, 7000);
    fire('bug_state', stateOf(moved, 7000));
    expect(text('clock-A-white')).toBe(formatBughouseClock(remainingAt(moved.match.clocks[0], 7000)));
    expect(text('clock-A-white')).toBe('0:53');
    advance(3000);
    expect(text('clock-A-white')).toBe('0:53'); // White's clock stopped when White moved
    expect(text('clock-A-black')).toBe(formatBughouseClock(remainingAt(moved.match.clocks[1], 10000)));
    expect(text('clock-A-black')).toBe('0:57');
  });
});

describe('connection and rejoin', () => {
  it('a dropped connection says so and the board cannot be touched; the reconnect rejoins with the token and the banner goes', () => {
    renderGame();
    fire('disconnect');
    expect(text('bughouse-online-reconnecting')).toBe('Connection lost — trying to reconnect…');
    tapBoardSquare('A', 'e2', 'w');
    tapBoardSquare('A', 'e4', 'w');
    expect(socket.pending('bug_move')).toHaveLength(0);
    act(() => socket.fireManager('reconnect'));
    expect(socket.pending('bug_rejoin')[0].payload).toEqual({ roomId: 'room-1', playerToken: 'tok' });
    answer('bug_rejoin', roomAck(first.match, 2500));
    expect(screen.queryByTestId('bughouse-online-reconnecting')).toBeNull();
    expect(labelOf('A', 'e4')).toContain('White pawn'); // the room as the server holds it
  });

  it('a rejoin with no answer shows "Can\'t reach the server" with a Retry that asks again; the answer then clears it', () => {
    renderGame();
    fire('disconnect');
    act(() => socket.fireManager('reconnect'));
    silence('bug_rejoin');
    expect(text('bughouse-online-problem')).toContain(CANT_REACH);
    fireEvent.click(screen.getByTestId('bughouse-online-retry'));
    expect(socket.pending('bug_rejoin')).toHaveLength(1);
    answer('bug_rejoin', roomAck(start(), 0));
    expect(screen.queryByTestId('bughouse-online-problem')).toBeNull();
  });

  it('a game the server no longer has: its words and a way out', () => {
    const { onExit } = renderGame();
    fire('disconnect');
    act(() => socket.fireManager('reconnect'));
    answer('bug_rejoin', { ok: false, error: 'Game not found.', reason: 'noGame' });
    expect(text('bughouse-online-unavailable')).toBe('Game not found.');
    fireEvent.click(screen.getByTestId('bughouse-online-leave'));
    expect(onExit).toHaveBeenCalledWith(false);
    expect(disconnected).toHaveBeenCalledTimes(1);
  });

  it('a screen reopened for a game in progress (resume) rejoins at once', () => {
    renderGame({ resume: true });
    expect(socket.pending('bug_rejoin')).toHaveLength(1);
    expect(screen.getByTestId('bughouse-online-reconnecting')).toBeTruthy();
  });
});

describe('leaving and resigning', () => {
  it('leaving a live game asks first; Stay stays, Leave drops the connection and reports a seat that can still be reclaimed', () => {
    const { onExit } = renderGame();
    fireEvent.click(screen.getByText('‹ Menu'));
    expect(screen.getByText('Leave the game?')).toBeTruthy();
    fireEvent.click(screen.getByText('Stay'));
    expect(onExit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('‹ Menu'));
    fireEvent.click(screen.getByText('Leave'));
    expect(onExit).toHaveBeenCalledWith(true);
    expect(disconnected).toHaveBeenCalledTimes(1);
  });

  it('Resign asks, then sends bug_resign (6 s); a refusal is shown in words', () => {
    renderGame();
    fireEvent.click(screen.getByTestId('bughouse-resign'));
    expect(screen.getByText('Your team loses the game.')).toBeTruthy();
    fireEvent.click(screen.getAllByText('Resign').at(-1)!);
    const [req] = socket.pending('bug_resign');
    expect(req.payload).toEqual({ roomId: 'room-1' });
    expect(req.ms).toBe(6000);
    answer('bug_resign', { ok: false, error: 'x', reason: 'over' });
    expect(text('bughouse-online-resign-error')).toBe('The game is over.');
  });

  it('Cancel in the Resign question sends nothing', () => {
    renderGame();
    fireEvent.click(screen.getByTestId('bughouse-resign'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(socket.asked).toHaveLength(0);
  });
});

describe('the result', () => {
  const resigned = settle(start(), { seat: 1, action: { kind: 'resign' } }, 3000);

  it('shows the game-over card the ENGINE\'s result says; "Play again" and "Back to menu" are there; the boards stop listening', () => {
    const { onExit, onPlayAgain } = renderGame();
    fire('bug_state', stateOf(resigned as { match: BughouseMatch; events: unknown[] }, 3000));
    fire('bug_game_over', { roomId: ROOM, result: resigned.match.result!, state: serializeMatch(resigned.match) } satisfies BugGameOverPayload);
    const summary = gameOverSummary(resigned.match)!;
    expect(text('game-over-headline')).toBe(summary.headline);
    expect(text('game-over-detail')).toBe(summary.detail);
    expect(screen.getByTestId('bughouse-rematch').textContent).toBe('Play again');
    tapBoardSquare('A', 'e2', 'w');
    tapBoardSquare('A', 'e4', 'w');
    expect(socket.asked).toHaveLength(0);
    fireEvent.click(screen.getByTestId('bughouse-rematch'));
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('bughouse-menu'));
    expect(onExit).toHaveBeenCalledWith(false);
  });

  it('a result that only bug_game_over carried (no final snapshot yet) still ends the screen', () => {
    renderGame();
    fire('bug_game_over', { roomId: ROOM, result: resigned.match.result!, state: 'unreadable' } satisfies BugGameOverPayload);
    expect(screen.getByTestId('game-over')).toBeTruthy();
  });

  it('leaving a finished game needs no question', () => {
    const { onExit } = renderGame();
    fire('bug_game_over', { roomId: ROOM, result: resigned.match.result!, state: serializeMatch(resigned.match) });
    fireEvent.click(screen.getByText('‹ Menu'));
    expect(screen.queryByText('Leave the game?')).toBeNull();
    expect(onExit).toHaveBeenCalledWith(false);
  });
});

describe('an unreadable match', () => {
  it('shows the problem and a way back instead of a board', () => {
    const { onExit } = renderGame({ match: { ...found(), state: 'garbage' } });
    expect(screen.getByText('The game could not be read from the server.')).toBeTruthy();
    fireEvent.click(screen.getByText('‹ Menu'));
    expect(onExit).toHaveBeenCalledWith(false);
  });
});
