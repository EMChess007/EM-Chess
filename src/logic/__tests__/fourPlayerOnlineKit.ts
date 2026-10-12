import { expect } from 'vitest';
import { viewFromMatch, viewFromRoom, applyFourState, type FourOnlineView } from '../fourPlayerOnline';
import { chooseBotMove, findLegalMove, initialState, moveLabel, parseSquare, playMove, resign, serialize, squareName, type FourPlayerState, type GameEvent, type Move, type Seat } from '../fourPlayer';
import { clocksToWireMs, type FourActor, type FourGameOverPayload, type FourMatchFoundPayload, type FourRoomState, type FourSeats, type FourStatePayload } from '../fourPlayerWire';

/**
 * Shared test kit for the 4 Player Online client tests: a SERVER SIMULATOR built on the real engine (the same playMove / resign / serialize the
 * real server's mirror runs), so every payload a test feeds the client is exactly what the server would send - never a hand-typed snapshot.
 * Not a test file itself (vitest only runs *.test.ts).
 */

// --- Server simulator ---------------------------------------------------------------------------------------------------------------

export const ROOM = 'room-0001';
export const OTHER_ROOM = 'room-0002';
export const T0 = 1_000_000;

export function rngFrom(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const NAMES = ['Ana', 'Ben', 'Cy', 'Di'];
export function seatsOf(over: Partial<Record<number, Partial<FourSeats[number]>>> = {}): FourSeats {
  return [0, 1, 2, 3].map((seat) => ({ seat: seat as Seat, kind: 'human' as const, name: NAMES[seat], connected: true, ...(over[seat] ?? {}) })) as FourSeats;
}

export class ServerSim {
  state: FourPlayerState = initialState();
  seq = 0;
  clocks: number[] = [300, 300, 300, 300];
  log: { seat: Seat; text: string }[] = [];
  readonly events: GameEvent[] = [];
  readonly rng: () => number;
  constructor(seed = 1) {
    this.rng = rngFrom(seed);
  }

  match(seat: Seat): FourMatchFoundPayload {
    return {
      roomId: ROOM,
      seat,
      playerToken: 'token-' + seat,
      seats: seatsOf(),
      timeControl: { initialSeconds: 300, incrementSeconds: 0 },
      timeControlLabel: '5 | 0',
      state: serialize(initialState()),
      clocksMs: clocksToWireMs([300, 300, 300, 300]),
      seq: 0,
    };
  }

  /** What `four_rejoin` / `four_spectate_game` would answer right now. */
  room(): FourRoomState {
    return {
      roomId: ROOM,
      seats: seatsOf(),
      timeControl: { initialSeconds: 300, incrementSeconds: 0 },
      timeControlLabel: '5 | 0',
      seq: this.seq,
      state: serialize(this.state),
      clocksMs: clocksToWireMs(this.clocks),
      log: this.log.map((entry) => ({ ...entry })),
    };
  }

  private payload(actor: FourActor, move: Move | null, mover: Seat, events: GameEvent[]): FourStatePayload {
    this.seq += 1;
    this.events.push(...events);
    return {
      roomId: ROOM,
      seq: this.seq,
      actor,
      move: move ? { seat: mover, from: squareName(move.from), to: squareName(move.to), label: moveLabel(move) } : null,
      events,
      state: serialize(this.state),
      clocksMs: clocksToWireMs(this.clocks),
    };
  }

  play(move: Move, actor: FourActor = 'human'): FourStatePayload {
    const mover = this.state.turn;
    const applied = playMove(this.state, move, this.rng);
    this.state = applied.state;
    this.clocks[mover] = Math.max(0, this.clocks[mover] - 1);
    this.log.push({ seat: mover, text: moveLabel(move) });
    return this.payload(actor, move, mover, applied.events);
  }

  bot(): FourStatePayload {
    const move = chooseBotMove(this.state, 1200, this.rng);
    if (!move) throw new Error('the simulator\'s bot has no move: the game should have ended');
    return this.play(move, 'bot');
  }

  resignSeat(seat: Seat): FourStatePayload {
    const applied = resign(this.state, seat, this.rng);
    this.state = applied.state;
    return this.payload('resign', null, seat, applied.events);
  }

  /** Bots play until it is `seat`'s turn (or the game ends). */
  untilTurn(seat: Seat): FourStatePayload[] {
    const out: FourStatePayload[] = [];
    while (!this.state.result && this.state.turn !== seat) out.push(this.bot());
    return out;
  }

  over(reason: FourGameOverPayload['reason'] = this.state.result?.reason ?? 'elimination'): FourGameOverPayload {
    return {
      roomId: ROOM,
      reason,
      winners: reason === 'abandoned' ? [] : [...(this.state.result?.winners ?? [0])],
      scores: [...this.state.score],
      state: serialize(this.state),
    };
  }
}

export const mv = (state: FourPlayerState, from: string, to: string, promotion?: number): Move => {
  const seat = state.turn;
  const move = findLegalMove(state, seat, parseSquare(from), parseSquare(to), promotion);
  if (!move) throw new Error(`test setup: ${from}-${to} is not legal for seat ${seat}`);
  return move;
};

export function freshView(seat: Seat | null = 0, sim = new ServerSim()): { sim: ServerSim; view: FourOnlineView } {
  const view = seat === null ? viewFromRoom(sim.room(), null, T0) : viewFromMatch(sim.match(seat), T0);
  if (!view) throw new Error('test setup: view');
  return { sim, view };
}

/** Feeds payloads in order; every one must be adopted. */
export function feedAll(view: FourOnlineView, payloads: FourStatePayload[], now = T0): FourOnlineView {
  let current = view;
  for (const payload of payloads) {
    const result = applyFourState(current, payload, now);
    expect(result.outcome, `seq ${payload.seq}`).toBe('applied');
    current = result.view;
  }
  return current;
}

/** The first 5 states of a game: Red e2-e4 then Blue, Yellow, Green, Red answer (seq 1..5), as a real room would broadcast. */
export function firstFive(sim: ServerSim): FourStatePayload[] {
  const payloads = [sim.play(mv(sim.state, 'e2', 'e4'))];
  payloads.push(...[sim.bot(), sim.bot(), sim.bot(), sim.bot()]);
  return payloads;
}

export const authoritative = (view: FourOnlineView) => ({ text: serialize(view.state), seq: view.seq, clocks: [...view.clocksMs], log: view.log.map((l) => `${l.seat}:${l.text}`) });
