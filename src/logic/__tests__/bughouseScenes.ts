import { emptyReserve, type Reserve } from '../crazyhouse';
import {
  BOARD_START_FEN,
  createMatch,
  fenOf,
  judgeBoardState,
  openBoard,
  seatAt,
  seatPlace,
  settle,
  type BoardId,
  type BoardState,
  type BughouseAction,
  type BughouseMatch,
  type BughouseSeat,
  type BughouseTimeControl,
  type SeatClock,
} from '../bughouse';

export const START = BOARD_START_FEN;

export interface SceneOptions {
  /** FEN of board A and of board B (default: the start position). The side to move gets a RUNNING clock. */
  a?: string;
  b?: string;
  /** Marks of promoted pieces on each board. */
  promotedA?: string[];
  promotedB?: string[];
  /** Pocket contents per seat (default empty). */
  pockets?: Partial<Record<BughouseSeat, Partial<Reserve>>>;
  timeControl?: BughouseTimeControl;
  roomNumber?: number;
  startMs?: number;
  /** Override single clocks (remainingMs / runningSince / startSeq), by seat. */
  clocks?: Partial<Record<BughouseSeat, Partial<SeatClock>>>;
  seq?: number;
}

/**
 * A hand-built match for a rule or a boundary: the positions given, the pockets given, the clock of the side to move on each board running since `startMs`. The positions need not
 * hold 64 pieces (the conservation invariant is for matches that START from the standard position); everything else is the engine's own state.
 */
export function scene(o: SceneOptions = {}): BughouseMatch {
  const timeControl = o.timeControl ?? { initialMs: 180000, incrementMs: 0 };
  const startMs = o.startMs ?? 1000;
  const base = createMatch({ timeControl, roomNumber: o.roomNumber ?? 0, startMs });
  const fens: Record<BoardId, string> = { A: o.a ?? START, B: o.b ?? START };
  const boards = {} as Record<BoardId, BoardState>;
  for (const board of ['A', 'B'] as const) {
    const chess = openBoard(fens[board]);
    if (chess === null) throw new Error(`scene: board ${board} is not a valid FEN: ${fens[board]}`);
    boards[board] = { fen: fenOf(chess), promoted: [...((board === 'A' ? o.promotedA : o.promotedB) ?? [])].sort(), plies: 0 };
  }
  const pockets: Reserve[] = [0, 1, 2, 3].map((seat) => ({ ...emptyReserve(), ...(o.pockets?.[seat as BughouseSeat] ?? {}) }));
  const verdicts = {
    A: judgeBoardState('A', boards.A, pockets[seatAt('A', 'w')], pockets[seatAt('A', 'b')]),
    B: judgeBoardState('B', boards.B, pockets[seatAt('B', 'w')], pockets[seatAt('B', 'b')]),
  };
  const clocks: SeatClock[] = [0, 1, 2, 3].map((seat) => {
    const place = seatPlace(seat as BughouseSeat);
    const running = verdicts[place.board].turn === place.color;
    return { remainingMs: timeControl.initialMs, runningSince: running ? startMs : null, startSeq: 0, ...(o.clocks?.[seat as BughouseSeat] ?? {}) };
  });
  return { ...base, seq: o.seq ?? 0, boards, pockets, clocks, verdicts };
}

/** Applies an action through the funnel and returns the new match, or throws with the reason - for the many places a scene just needs the move to happen. */
export function play(m: BughouseMatch, seat: BughouseSeat, action: BughouseAction, nowMs: number): BughouseMatch {
  const outcome = settle(m, { seat, action }, nowMs);
  if (outcome.kind !== 'applied') throw new Error(`expected the action to be applied, got ${outcome.kind}${outcome.kind === 'rejected' ? ` (${outcome.reason})` : ''}: ${JSON.stringify(action)}`);
  return outcome.match;
}

export const move = (board: BoardId, from: string, to: string, promotion?: 'q' | 'r' | 'b' | 'n'): BughouseAction => ({ kind: 'move', board, from, to, ...(promotion ? { promotion } : {}) });
export const drop = (board: BoardId, piece: 'p' | 'n' | 'b' | 'r' | 'q', square: string): BughouseAction => ({ kind: 'drop', board, piece, square });
