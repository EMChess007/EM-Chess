import {
  BUGHOUSE_TIME_CONTROLS,
  createMatch,
  settle,
  seatPlace,
  type BoardId,
  type BughouseAction,
  type BughouseMatch,
  type BughouseSeat,
  type SettleOutcome,
} from '../bughouse';
import { RefMatch, type RefOutcome } from './bughouseReferenceModel';
import { mulberry32 } from './fourPlayerGoldenKit';

export { mulberry32 };

const BOARD_NAME: BoardId[] = ['A', 'B'];

/** The text a comparison with the reference model looks at - the same fields, in the same order, as RefMatch.describe(). */
export function describeEngine(m: BughouseMatch): string {
  const parts: string[] = [`seq ${m.seq} now ${m.nowMs}`];
  for (const board of BOARD_NAME) {
    const f = m.boards[board].fen.split(' ');
    parts.push(`${board} ${f[0]} ${f[1]} ${f[2]} promoted ${m.boards[board].promoted.join(',')} plies ${m.boards[board].plies} verdict ${JSON.stringify({ status: m.verdicts[board].status, turn: m.verdicts[board].turn, inCheck: m.verdicts[board].inCheck, stuck: m.verdicts[board].stuck })}`);
  }
  parts.push(`pockets ${m.pockets.map((p) => `${p.p}${p.n}${p.b}${p.r}${p.q}`).join('|')}`);
  parts.push(`clocks ${m.clocks.map((c) => `${c.remainingMs}/${c.runningSince}/${c.startSeq}`).join('|')}`);
  const r = m.result;
  parts.push(`result ${JSON.stringify(r === null ? null : 'voided' in r ? { voided: true, reason: r.reason } : { winnerTeam: r.winnerTeam, reason: r.reason, board: r.board, loserSeat: r.loserSeat })}`);
  return parts.join('\n');
}

export const moveKey = (m: { from: string; to: string; promotion?: string }) => `${m.from}${m.to}${m.promotion ?? ''}`;
export const dropKey = (d: { piece: string; square: string }) => `${d.piece}@${d.square}`;

export interface DriverStep {
  input: { seat: any; action: any } | null;
  now: number;
}

/**
 * The next input of a seeded random match. Mostly a legal move or drop for a seat whose turn it is - legal according to the REFERENCE MODEL's lists (chessops), so the engine must
 * accept everything the model says is playable; the other direction, and every list, is compared by the model test itself. Captures and drops are preferred so that pockets fill and
 * empty. Otherwise a hostile request of a kind the engine must refuse (wrong board, not your turn, a drop with nothing in the pocket, an occupied square, a move from an empty square,
 * garbage), now and then a timer firing (null) or a resignation; and a time step that is usually small, sometimes zero, sometimes large enough to let a flag fall.
 */
export function nextStep(rng: () => number, m: BughouseMatch, model: RefMatch): DriverStep {
  const tc = m.timeControl.initialMs;
  const advance = rng() < 0.02 ? Math.floor(rng() * (tc / 3)) : rng() < 0.3 ? 0 : Math.floor(rng() * 900);
  const now = m.nowMs + advance;
  const roll = rng();
  if (roll < 0.015) return { input: null, now };
  const toMove = ([0, 1, 2, 3] as BughouseSeat[]).filter((s) => m.verdicts[seatPlace(s).board].turn === seatPlace(s).color);
  const seat = roll < 0.9 && toMove.length > 0 ? toMove[Math.floor(rng() * toMove.length)] : (Math.floor(rng() * 4) as BughouseSeat);
  const place = seatPlace(seat);
  if (roll > 0.998) return { input: { seat, action: { kind: 'resign' } }, now };
  if (roll > 0.9) return { input: hostile(rng, m, seat), now };
  // a seat that is not on the move has nothing to do: let time pass
  if (m.verdicts[place.board].turn !== place.color) return { input: null, now: now + Math.floor(rng() * 1500) };
  const b = place.board === 'A' ? 0 : 1;
  const drops = model.legalDropKeys(b);
  if (drops.length > 0 && rng() < 0.45) {
    const key = drops[Math.floor(rng() * drops.length)];
    return { input: { seat, action: { kind: 'drop', board: place.board, piece: key[0], square: key.slice(2) } as BughouseAction }, now };
  }
  let moves = model.legalMoveKeys(b);
  if (moves.length === 0) {
    if (drops.length === 0) return { input: null, now: now + Math.floor(rng() * 1500) }; // stuck: time passes
    const key = drops[Math.floor(rng() * drops.length)];
    return { input: { seat, action: { kind: 'drop', board: place.board, piece: key[0], square: key.slice(2) } as BughouseAction }, now };
  }
  if (rng() < 0.6) {
    // prefer a capture: the destination square is occupied in the position the engine holds
    const placement = m.boards[place.board].fen.split(' ')[0];
    const occupied = (square: string) => {
      const rank = placement.split('/')[8 - Number(square[1])];
      let file = 0;
      for (const ch of rank) {
        if (/\d/.test(ch)) file += Number(ch);
        else {
          if (file === square.charCodeAt(0) - 97) return true;
          file++;
        }
      }
      return false;
    };
    const captures = moves.filter((k) => occupied(k.slice(2, 4)));
    if (captures.length > 0) moves = captures;
  }
  const key = moves[Math.floor(rng() * moves.length)];
  return { input: { seat, action: { kind: 'move', board: place.board, from: key.slice(0, 2), to: key.slice(2, 4), ...(key.length === 5 ? { promotion: key[4] } : {}) } }, now };
}

function hostile(rng: () => number, m: BughouseMatch, seat: BughouseSeat): { seat: any; action: any } {
  const place = seatPlace(seat);
  const other: BoardId = place.board === 'A' ? 'B' : 'A';
  const pick = Math.floor(rng() * 8);
  const squares = ['a1', 'e2', 'e4', 'h8', 'd5', 'c3'];
  const sq = () => squares[Math.floor(rng() * squares.length)];
  switch (pick) {
    case 0:
      return { seat, action: { kind: 'move', board: other, from: 'e2', to: 'e4' } }; // the other board
    case 1:
      return { seat, action: { kind: 'move', board: place.board, from: sq(), to: sq() } }; // random squares: usually not a legal move
    case 2:
      return { seat, action: { kind: 'drop', board: place.board, piece: ['p', 'n', 'b', 'r', 'q'][Math.floor(rng() * 5)], square: sq() } }; // a drop the pocket may not hold
    case 3:
      return { seat, action: { kind: 'drop', board: place.board, piece: 'q', square: 'e1' } }; // an occupied square (or an empty pocket)
    case 4:
      return { seat, action: { kind: 'castle', board: place.board } }; // not an action
    case 5:
      return { seat: 7, action: { kind: 'resign' } }; // not a seat
    case 6:
      return { seat, action: { kind: 'move', board: place.board, from: 'z9', to: 'e4' } }; // not a square
    default:
      return { seat: (seat ^ 1) as BughouseSeat, action: { kind: 'move', board: m.verdicts.A.turn === 'w' ? 'A' : 'B', from: 'e7', to: 'e5' } }; // probably the wrong turn
  }
}

export interface RunStats {
  matches: number;
  commits: number;
  plies: number;
  captures: number;
  banks: number;
  drops: number;
  flags: number;
  mates: number;
  resigns: number;
  voids: number;
  rejected: number;
  stuckPositions: number;
  promotions: number;
  steps: number;
}

export const emptyStats = (): RunStats => ({ matches: 0, commits: 0, plies: 0, captures: 0, banks: 0, drops: 0, flags: 0, mates: 0, resigns: 0, voids: 0, rejected: 0, stuckPositions: 0, promotions: 0, steps: 0 });

export interface PairedRun {
  engine: BughouseMatch;
  model: RefMatch;
}

export function newPair(seed: number): PairedRun {
  const rng = mulberry32(seed);
  const tc = BUGHOUSE_TIME_CONTROLS[Math.floor(rng() * BUGHOUSE_TIME_CONTROLS.length)];
  const room = Math.floor(rng() * 1000);
  const start = Math.floor(rng() * 5000);
  return { engine: createMatch({ timeControl: tc, roomNumber: room, startMs: start }), model: new RefMatch(tc.initialMs, tc.incrementMs, room, start) };
}

/** Feeds one step to both and returns the engine's outcome and the model's. */
export function feed(pair: PairedRun, step: DriverStep): { engine: SettleOutcome; model: RefOutcome } {
  const engineOutcome = settle(pair.engine, step.input as any, step.now);
  const modelOutcome = pair.model.step(step.input, step.now);
  if (engineOutcome.kind === 'applied' || engineOutcome.kind === 'flag') pair.engine = engineOutcome.match;
  return { engine: engineOutcome, model: modelOutcome };
}
