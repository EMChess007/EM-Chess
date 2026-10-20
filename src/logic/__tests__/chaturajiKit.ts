import { CHATURAJI_RULES, SQUARE8, initialState, legalMoves, moveLabelOn, playMove, resign, serialize, stateFromPieces, type FourPlayerRules, type FourPlayerState, type GameEvent, type Move, type PositionOptions, type Seat } from '../fourPlayer';
import { chooseChaturajiBotMove } from '../fourPlayer';
import { clocksToWireMs, type FourActor, type FourGameOverPayload, type FourMatchFoundPayload, type FourRoomState, type FourSeats, type FourStatePayload } from '../fourPlayerWire';
import { mulberry32 } from './fourPlayerGoldenKit';

/**
 * Shared test kit for the Chaturaji screens and client (W3): hand-built positions, a SERVER SIMULATOR on the real engine that talks the 8 x 8 board (squares named on it, the
 * promotion field of the move set, the end-of-game payload with the engine's own scores), and seeded whole games with resignations. Not a test file itself.
 */

export const CJ_ROOM = 'cj-room-0001';
export const CJ_NAMES = ['Ana', 'Ben', 'Cy', 'Di'];
export const cp = (pieces: string[], options: PositionOptions = {}): FourPlayerState => stateFromPieces(pieces, { rules: CHATURAJI_RULES, ...options });
export const label = (move: Move | null): string => (move ? moveLabelOn(move, SQUARE8) : '-');
export const sq = (name: string): number => SQUARE8.parseSquare(name);
export const findMove = (state: FourPlayerState, text: string): Move => {
  const move = legalMoves(state, state.turn).find((m) => label(m) === text);
  if (!move) throw new Error(`no legal move ${text} for seat ${state.turn}`);
  return move;
};

export function cjSeats(over: Partial<Record<number, Partial<FourSeats[number]>>> = {}): FourSeats {
  return [0, 1, 2, 3].map((seat) => ({ seat: seat as Seat, kind: 'human' as const, name: CJ_NAMES[seat], connected: true, ...(over[seat] ?? {}) })) as FourSeats;
}

export class ChaturajiSim {
  state: FourPlayerState;
  seq = 0;
  clocks: number[] = [300, 300, 300, 300];
  log: { seat: Seat; text: string }[] = [];
  readonly rng: () => number;
  constructor(seed = 1, start?: FourPlayerState) {
    this.state = start ?? initialState(CHATURAJI_RULES);
    this.rng = mulberry32(seed);
  }

  match(seat: Seat): FourMatchFoundPayload {
    return {
      roomId: CJ_ROOM,
      variant: 'chaturaji',
      seat,
      playerToken: 'token-' + seat,
      seats: cjSeats(),
      timeControl: { initialSeconds: 300, incrementSeconds: 0 },
      timeControlLabel: '5 | 0',
      state: serialize(this.state),
      clocksMs: clocksToWireMs(this.clocks),
      seq: 0,
    };
  }

  room(): FourRoomState {
    return {
      roomId: CJ_ROOM,
      variant: 'chaturaji',
      seats: cjSeats(),
      timeControl: { initialSeconds: 300, incrementSeconds: 0 },
      timeControlLabel: '5 | 0',
      seq: this.seq,
      state: serialize(this.state),
      clocksMs: clocksToWireMs(this.clocks),
      log: this.log.map((entry) => ({ ...entry })),
    };
  }

  private payload(actor: FourActor, move: Move | null, mover: Seat, events: GameEvent[], promoted: boolean): FourStatePayload {
    this.seq += 1;
    return {
      roomId: CJ_ROOM,
      seq: this.seq,
      actor,
      move: move
        ? { seat: mover, from: SQUARE8.squareName(move.from), to: SQUARE8.squareName(move.to), label: label(move), ...(promoted ? { promotion: 'r' as const } : {}) }
        : null,
      events,
      state: serialize(this.state),
      clocksMs: clocksToWireMs(this.clocks),
    };
  }

  play(move: Move, actor: FourActor = 'human'): FourStatePayload {
    const mover = this.state.turn;
    const applied = playMove(this.state, move, this.rng);
    this.state = applied.state;
    this.log.push({ seat: mover, text: label(move) });
    return this.payload(actor, move, mover, applied.events, (move.flags & 4) !== 0);
  }

  bot(elo = 1500): FourStatePayload {
    const move = chooseChaturajiBotMove(this.state, elo, this.rng);
    if (!move) throw new Error('the simulator\'s bot has no move');
    return this.play(move, 'bot');
  }

  resignSeat(seat: Seat): FourStatePayload {
    const applied = resign(this.state, seat, this.rng);
    this.state = applied.state;
    return this.payload('resign', null, seat, applied.events, false);
  }

  over(reason: FourGameOverPayload['reason'] = this.state.result?.reason ?? 'elimination'): FourGameOverPayload {
    return {
      roomId: CJ_ROOM,
      reason,
      winners: reason === 'abandoned' ? [] : [...(this.state.result?.winners ?? [0])],
      scores: [...this.state.score],
      state: serialize(this.state),
    };
  }
}

/** Rules identical to Chaturaji's except for the end-of-game bonus: replaying a game under both says exactly what the bonus paid. */
export const NO_BONUS_RULES: FourPlayerRules = { ...CHATURAJI_RULES, options: { ...CHATURAJI_RULES.options!, lastStandingKingBonus: 0 } };

export interface PlayedGame {
  /** Every position, the first included (positions[i + 1] is positions[i] after step i). */
  positions: FourPlayerState[];
  /** The same game replayed under NO_BONUS_RULES (same moves, same rng draws): the engine's own answer to "what did the bonus pay?". */
  withoutBonus: FourPlayerState;
  /** For each step, the events the engine produced. */
  events: GameEvent[][];
}

/**
 * A seeded whole game of bots with seats resigning at set plies, played in lockstep under the real rules and under NO_BONUS_RULES. Every game ends (the engine's ply cap is
 * the backstop); the caller picks the ones it needs by their result.
 */
export function playGame(seed: number, resignations: readonly { ply: number; seat: Seat }[] = []): PlayedGame {
  const botDraw = mulberry32(seed);
  const draw = mulberry32(seed + 1); // the engine's randomness (dead-king walks), one stream for the real game and an identical one for the twin
  const drawTwin = mulberry32(seed + 1);
  let state = initialState(CHATURAJI_RULES);
  let twin = initialState(NO_BONUS_RULES);
  const positions = [state];
  const events: GameEvent[][] = [];
  const elos = [600, 1200, 1500, 1000];
  for (let step = 0; step < 1500 && !state.result; step++) {
    const due = resignations.find((r) => r.ply === step && state.status[r.seat] === 'active');
    if (due) {
      const a = resign(state, due.seat, draw);
      const b = resign(twin, due.seat, drawTwin);
      state = a.state;
      twin = b.state;
      events.push(a.events);
    } else {
      const move = chooseChaturajiBotMove(state, elos[state.turn], botDraw);
      if (!move) break;
      const a = playMove(state, move, draw);
      const b = playMove(twin, move, drawTwin);
      state = a.state;
      twin = b.state;
      events.push(a.events);
    }
    positions.push(state);
  }
  return { positions, withoutBonus: twin, events };
}
