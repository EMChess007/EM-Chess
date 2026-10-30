import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppAlertHost from '../../components/AppAlert';
import { createMatch, serializeMatch, settle, type BughouseMatch, type BughouseSeat } from '../../logic/bughouse';
import type { BoardId } from '../../logic/bughouse/types';
import type { BugMatchFoundPayload, BugSeats, BugStatePayload } from '../../logic/bughouse/wire';
import { FakeBugSocket } from '../../test/fakeBugSocket';
import { tapBoardSquare } from '../../test/domKit';
import BughouseOnlineGameScreen from '../BughouseOnlineGameScreen';

/**
 * W5, PREMOVES ON THE ONLINE GAME SCREEN, RENDERED (BUGHOUSE_SPEC.md HP3 / 5.5): while the opponent is to move, a tap on my piece and a tap on a square queue ONE premove (drawn on the board);
 * NOTHING is sent until the snapshot that gives me the turn arrives, and then it is sent as an ordinary bug_move; Cancel removes it; one that became illegal is dropped with its sentence.
 * The real screen, the real engine's snapshots, a fake socket, fake timers.
 */
const fake = vi.hoisted(() => ({ socket: null as unknown }));
vi.mock('../../api/socket', () => ({ connectSocket: () => fake.socket, disconnectSocket: () => undefined }));
vi.mock('../../logic/moveSounds', () => ({ playMoveSound: vi.fn() }));
vi.mock('../../logic/haptics', () => ({ triggerMoveHaptics: vi.fn(), triggerGameEndHaptics: vi.fn() }));
vi.mock('../../logic/diagnosticLog', () => ({ logDiagnostic: vi.fn() }));

const TC = { initialMs: 60000, incrementMs: 0 };
const ROOM = 'room-p';
const SEATS: BugSeats = [0, 1, 2, 3].map((seat) => ({ seat, kind: 'human', name: `P${seat}`, connected: true })) as unknown as BugSeats;
let socket: FakeBugSocket;
beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  socket = new FakeBugSocket();
  fake.socket = socket;
});
afterEach(() => vi.restoreAllMocks());

const start = (): BughouseMatch => createMatch({ timeControl: TC, roomNumber: 2, startMs: 0 });
const whitePlays = (match: BughouseMatch, from: string, to: string, now: number) => {
  const out = settle(match, { seat: 0 as BughouseSeat, action: { kind: 'move', board: 'A', from, to } }, now);
  if (out.kind !== 'applied') throw new Error(`not applied: ${out.kind}`);
  return out;
};
const found = (): BugMatchFoundPayload => ({ roomId: ROOM, seat: 1, playerToken: 'tok', seats: SEATS, timeControl: TC, timeControlLabel: '1 min', state: serializeMatch(start()), serverNowMs: 0, seq: 0 });
const stateOf = (outcome: { match: BughouseMatch; events: unknown[] }, serverNowMs: number): BugStatePayload => ({
  roomId: ROOM,
  seq: outcome.match.seq,
  events: outcome.events as BugStatePayload['events'],
  state: serializeMatch(outcome.match),
  serverNowMs,
});
const renderGame = () =>
  render(
    <>
      <BughouseOnlineGameScreen authToken="t" match={found()} resume={false} onExit={() => {}} onPlayAgain={() => {}} />
      <AppAlertHost />
    </>,
  );
const labelOf = (board: BoardId, square: string): string => screen.getByTestId(`${board}-${square}`).getAttribute('aria-label') ?? '';
/** I am Black on Board A: the board is drawn with Black at the bottom. */
const tap = (square: string) => tapBoardSquare('A', square, 'b');
const fire = (event: string, payload?: unknown) => act(() => socket.fire(event, payload));

describe('a premove while the opponent is to move', () => {
  it('two taps queue ONE premove, drawn on the board, and NOTHING is sent', () => {
    renderGame();
    tap('e7');
    tap('e5');
    expect(labelOf('A', 'e7')).toContain('premove from');
    expect(labelOf('A', 'e5')).toContain('premove to');
    expect(screen.getByTestId('premove-ghost-A')).toBeTruthy();
    expect(screen.getByTestId('bughouse-premove-cancel')).toBeTruthy();
    expect(socket.pending('bug_move')).toHaveLength(0);
    // a second premove REPLACES the first (queue length one)
    tap('d7');
    tap('d5');
    expect(labelOf('A', 'e5')).not.toContain('premove');
    expect(labelOf('A', 'd7')).toContain('premove from');
    expect(labelOf('A', 'd5')).toContain('premove to');
    expect(socket.pending('bug_move')).toHaveLength(0);
  });

  it('is sent as an ordinary bug_move exactly when the snapshot that gives me the turn arrives, and the marks go', () => {
    renderGame();
    tap('e7');
    tap('e5');
    // a snapshot of the OTHER board does not give me the turn: still nothing sent (not exercised by a bot here: the room is quiet)
    expect(socket.pending('bug_move')).toHaveLength(0);
    fire('bug_state', stateOf(whitePlays(start(), 'e2', 'e4', 2000), 2000));
    const sent = socket.pending('bug_move');
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toMatchObject({ roomId: ROOM, board: 'A', from: 'e7', to: 'e5' });
    expect(labelOf('A', 'e7')).not.toContain('premove');
    expect(screen.queryByTestId('bughouse-premove-cancel')).toBeNull();
    expect(screen.queryByTestId('bughouse-premove-notice')).toBeNull();
  });

  it('Cancel removes it: the turn then comes and nothing is sent', () => {
    renderGame();
    tap('e7');
    tap('e5');
    fireEvent.click(screen.getByTestId('bughouse-premove-cancel'));
    expect(labelOf('A', 'e5')).not.toContain('premove');
    fire('bug_state', stateOf(whitePlays(start(), 'e2', 'e4', 2000), 2000));
    expect(socket.pending('bug_move')).toHaveLength(0);
  });

  it('one that is no longer legal is dropped with its sentence and is not sent', () => {
    renderGame();
    tap('f8');
    tap('c5'); // the bishop is blocked by its own pawn: not legal now, not legal then
    expect(labelOf('A', 'c5')).toContain('premove to');
    fire('bug_state', stateOf(whitePlays(start(), 'e2', 'e4', 2000), 2000));
    expect(socket.pending('bug_move')).toHaveLength(0);
    expect(screen.getByTestId('bughouse-premove-notice').textContent).toBe('The premove is no longer legal.');
    expect(labelOf('A', 'c5')).not.toContain('premove');
  });

  it('a premove is not made with the opponent\'s pieces or from an empty square', () => {
    renderGame();
    tap('e2'); // White's pawn
    tap('e4');
    tap('e5'); // empty
    expect(screen.queryByTestId('bughouse-premove-cancel')).toBeNull();
    expect(socket.pending('bug_move')).toHaveLength(0);
  });
});
