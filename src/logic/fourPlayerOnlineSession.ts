/**
 * 4 Player Chess ONLINE — one client session with one room (FOUR_PLAYER_ONLINE_SPEC.md §8), as a plain class around a socket.
 *
 * WHY A CLASS AND NOT JUST THE HOOK. The rules are in the pure reducer (`fourPlayerOnline.ts`), but the part that decides WHEN to send what
 * — one `four_rejoin` per gap, a rollback plus a re-read when a move gets no answer, a reconnect, a resumed screen, a spectator's first
 * load — is exactly the kind of thing that breaks quietly and that a project without a React Native renderer cannot otherwise test. So it
 * lives here, free of React and of the real socket (it takes a `FourSocket`, which Socket.IO's client satisfies and the tests fake) and
 * of the sound / haptics modules (injected as `effects`). `useFourPlayerOnlineGame` is a thin React wrapper that subscribes to it.
 *
 * It holds a `FourSessionState` (the reducer's view plus the connection, the chat and a few UI counters) and replaces it, as a new object,
 * on every change, calling the one subscriber. Nothing in a handler may throw out of it: a malformed event from the server is logged and
 * dropped, never an uncaught exception in a socket callback.
 *
 * The rejoin token is the `match` the session was given. App.tsx also persists it (activeGameStorage.ts), so an app restart or a web refresh
 * reopens the screen with `resume: true` and rejoins the seat (it used to forfeit the seat to a bot).
 */

import { moveLabel, type Move } from './fourPlayer';
import {
  adoptSnapshot,
  applyFourState,
  applyGameOver,
  applySeatUpdate,
  beginMove,
  beginResync,
  failResync,
  moveAcked,
  movePayloadFor,
  moveRejected,
  viewFromMatch,
  viewFromRoom,
  type FourOnlineView,
} from './fourPlayerOnline';
import { appendChat, type FourChatEntry } from './fourPlayerOnlineUi';
import {
  classifyFourRejoinAck,
  normalizeFourChatText,
  type FourAck,
  type FourChatMessagePayload,
  type FourGameOverPayload,
  type FourMatchFoundPayload,
  type FourRejoinAck,
  type FourSeatUpdatePayload,
  type FourSpectateState,
  type FourStatePayload,
} from './fourPlayerWire';

/** How long the server gets to answer a move / rejoin / spectate request (the 2-player screen's number). */
export const FOUR_ACK_TIMEOUT_MS = 8000;

export type FourOnlineRole =
  /** A seated player. `resume` = the screen was reopened for a game already in progress ("Return to your game"): rejoin straight away. */
  | { kind: 'player'; match: FourMatchFoundPayload; resume: boolean }
  | { kind: 'spectator'; roomId: string };

const UNEXPECTED_REPLY = 'Unexpected reply from the server.';

export type FourConnection = 'connected' | 'reconnecting' | 'unavailable';

/** The part of a Socket.IO client the session uses (so a test can fake it). */
export interface FourSocket {
  connected: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, handler: (...args: any[]) => void): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: string, handler: (...args: any[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
  timeout(ms: number): { emit(event: string, payload: object, cb: (err: unknown, ack?: unknown) => void): unknown };
  io: { on(event: string, handler: () => void): unknown; off(event: string, handler: () => void): unknown };
}

/** Sounds, haptics, the clock and the log, injected so the session needs no React Native module. */
export interface FourSessionEffects {
  now(): number;
  /** A move was made / heard: `san` is the move's label, `captured` set for a capture. */
  moveSound(move: { san: string; captured?: 'p' }): void;
  gameEnded(): void;
  log(message: string): void;
}

export interface FourSessionState {
  view: FourOnlineView | null;
  connection: FourConnection;
  /** Why there is no usable game: an unreadable snapshot, a refused spectate, "game not found". */
  problem: string | null;
  chat: FourChatEntry[];
  chatUnread: number;
  /** Bumped when the position may have changed under the board's selection (a rollback, a rejoin): the screen re-keys the board with it. */
  boardKey: number;
}

export function initialSessionState(role: FourOnlineRole, now: number): FourSessionState {
  const view = role.kind === 'player' ? viewFromMatch(role.match, now) : null;
  return {
    view,
    connection: role.kind === 'player' && role.resume ? 'reconnecting' : 'connected',
    problem: role.kind === 'player' && !view ? 'The game could not be read from the server.' : null,
    chat: [],
    chatUnread: 0,
    boardKey: 0,
  };
}

export class FourOnlineSession {
  private current: FourSessionState;
  private subscriber: ((state: FourSessionState) => void) | null = null;
  private disposed = false;
  private readonly roomId: string;
  private readonly handlers: { event: string; fn: (...args: never[]) => void }[] = [];
  private reconnectHandler: (() => void) | null = null;

  constructor(
    private readonly socket: FourSocket,
    private readonly role: FourOnlineRole,
    private readonly effects: FourSessionEffects
  ) {
    this.roomId = role.kind === 'player' ? role.match.roomId : role.roomId;
    this.current = initialSessionState(role, effects.now());
  }

  get state(): FourSessionState {
    return this.current;
  }

  subscribe(listener: (state: FourSessionState) => void): () => void {
    this.subscriber = listener;
    return () => {
      if (this.subscriber === listener) this.subscriber = null;
    };
  }

  // --- Lifecycle -----------------------------------------------------------------------------------------------------------------

  start(): void {
    const listen = <T>(event: string, fn: (payload: T) => void) => {
      const guarded = (payload: T) => this.guard(event, () => fn(payload));
      this.handlers.push({ event, fn: guarded as unknown as (...args: never[]) => void });
      this.socket.on(event, guarded);
    };
    listen('four_state', (payload: FourStatePayload) => this.onState(payload));
    listen('four_seat_update', (payload: FourSeatUpdatePayload) => this.onSeatUpdate(payload));
    listen('four_game_over', (payload: FourGameOverPayload) => this.onGameOver(payload));
    listen('four_chat_message', (payload: FourChatMessagePayload) => this.onChat(payload));
    listen('disconnect', () => this.onDisconnect());
    this.reconnectHandler = () => this.guard('reconnect', () => this.onReconnect());
    this.socket.io.on('reconnect', this.reconnectHandler);

    // A spectator's first load, or a screen reopened for a game in progress: read the room now.
    if (this.role.kind === 'spectator' || this.role.resume) this.startResync();
  }

  /** Stops listening; answers still in flight are ignored. A spectator also tells the server it left. */
  stop(): void {
    this.disposed = true;
    for (const { event, fn } of this.handlers) this.socket.off(event, fn as never);
    this.handlers.length = 0;
    if (this.reconnectHandler) this.socket.io.off('reconnect', this.reconnectHandler);
    this.reconnectHandler = null;
    if (this.role.kind === 'spectator') this.socket.emit('four_stop_spectating', {});
  }

  // --- State plumbing ------------------------------------------------------------------------------------------------------------

  private patch(change: Partial<FourSessionState>): void {
    if (this.disposed) return;
    this.current = { ...this.current, ...change };
    this.subscriber?.(this.current);
  }
  private setView(view: FourOnlineView | null): void {
    if (view !== this.current.view) this.patch({ view });
  }
  /** Runs a socket callback so that nothing it does can throw out of it. `onFail` undoes what the callback was in the middle of (a resync
   * flag that would otherwise stay set for ever). */
  private guard(what: string, fn: () => void, onFail?: () => void): void {
    try {
      fn();
    } catch (error) {
      // Neither the log nor the recovery may stop the other: a throwing logger must not leave a resync flag set.
      try {
        this.effects.log(`[FourPlayerOnline] ${what} handler failed and was dropped: ${error instanceof Error ? error.message : String(error)}`);
      } catch {
        // nothing more can be done
      }
      try {
        onFail?.();
      } catch {
        // nothing more can be done
      }
    }
  }

  // --- Server events -------------------------------------------------------------------------------------------------------------

  private onState(payload: FourStatePayload): void {
    const view = this.current.view;
    if (!view || !payload || typeof payload !== 'object') return;
    const result = applyFourState(view, payload, this.effects.now());
    this.setView(result.view);
    if (result.outcome === 'applied') {
      const mover = payload.move;
      // The player's own move was already heard when it was made; everyone else's is heard now.
      if (mover && mover.seat !== view.mySeat) this.effects.moveSound({ san: mover.label, ...(mover.label.includes('x') ? { captured: 'p' as const } : {}) });
      if (result.view.state.result) this.effects.gameEnded();
    }
    if (result.resync) {
      this.effects.log(`[FourPlayerOnline] ${result.outcome} at seq ${payload.seq} (have ${view.seq}); asking the server for the room ${this.roomId}`);
      this.emitResync();
    }
  }

  private onSeatUpdate(payload: FourSeatUpdatePayload): void {
    const view = this.current.view;
    if (view && payload && typeof payload === 'object') this.setView(applySeatUpdate(view, payload, this.effects.now()));
  }

  private onGameOver(payload: FourGameOverPayload): void {
    const view = this.current.view;
    if (!view || !payload || typeof payload !== 'object') return;
    const next = applyGameOver(view, payload);
    if (next === view) return;
    this.patch({ view: next, connection: 'connected' });
    // A game that ended by a final state was already announced when that state arrived; only an ending with no such state (abandoned) is new here.
    if (!view.state.result) this.effects.gameEnded();
  }

  private onChat(payload: FourChatMessagePayload): void {
    if (!payload || typeof payload !== 'object' || typeof payload.text !== 'string' || typeof payload.name !== 'string') return;
    const fromSeat = payload.fromSeat === 0 || payload.fromSeat === 1 || payload.fromSeat === 2 || payload.fromSeat === 3 ? payload.fromSeat : null;
    this.patch({ chat: appendChat(this.current.chat, { fromSeat, name: payload.name, text: payload.text, mine: false }), chatUnread: this.current.chatUnread + 1 });
  }

  private onDisconnect(): void {
    if (this.current.view?.gameOver) return;
    this.effects.log(`[FourPlayerOnline] own connection dropped (room ${this.roomId})`);
    this.patch({ connection: 'reconnecting' });
  }

  private onReconnect(): void {
    // The result is already on screen: nothing to rejoin, and nothing the server says may disturb it.
    if (this.current.view?.gameOver) {
      this.patch({ connection: 'connected' });
      return;
    }
    this.effects.log(`[FourPlayerOnline] own connection restored, rejoining (room ${this.roomId})`);
    this.startResync();
  }

  // --- Resync (rejoin / spectate again) ----------------------------------------------------------------------------------------------

  /** Starts a resync from nothing (a reconnect, a resumed screen, an unconfirmed move): one request at a time. */
  private startResync(): void {
    const view = this.current.view;
    if (!view) {
      this.emitResync(); // a spectator's first load
      return;
    }
    const begun = beginResync(view);
    if (!begun.send) return;
    this.setView(begun.view);
    this.emitResync();
  }

  /** Sends the whole-room request (rejoin for a player, spectate again for a spectator). The caller has already marked the resync. */
  private emitResync(): void {
    const gone = (error: string) => {
      const view = this.current.view;
      this.patch({ view: view ? failResync(view) : view, connection: 'unavailable', problem: error });
    };
    const noAnswer = () => {
      const view = this.current.view;
      this.patch({ view: view ? failResync(view) : view, connection: this.socket.connected ? 'connected' : 'reconnecting' });
    };

    if (this.role.kind === 'player') {
      const token = this.role.match.playerToken;
      this.socket.timeout(FOUR_ACK_TIMEOUT_MS).emit('four_rejoin', { roomId: this.roomId, playerToken: token }, (err, ack) =>
        this.guard('four_rejoin ack', () => {
          if (this.disposed) return;
          const view = this.current.view;
          if (!view) return;
          if (view.gameOver) {
            // a live four_game_over landed while this request was in flight: the result is on screen and nothing here may touch it
            this.patch({ connection: 'connected' });
            return;
          }
          if (err || !ack) {
            noAnswer();
            return;
          }
          if (typeof ack !== 'object') {
            gone(UNEXPECTED_REPLY);
            return;
          }
          const outcome = classifyFourRejoinAck(ack as FourRejoinAck);
          this.effects.log(`[FourPlayerOnline] four_rejoin ${outcome.kind === 'unavailable' ? `failed: ${outcome.error}` : outcome.kind} (room ${this.roomId})`);
          if (outcome.kind === 'finished') {
            const ended = applyGameOver(view, outcome.gameOver);
            if (ended === view) gone(UNEXPECTED_REPLY); // a result the client cannot read
            else this.patch({ view: ended, connection: 'connected' });
          } else if (outcome.kind === 'unavailable') {
            gone(typeof outcome.error === 'string' ? outcome.error : UNEXPECTED_REPLY);
          } else {
            const adopted = adoptSnapshot(view, outcome.state, this.effects.now());
            if (adopted.outcome === 'invalid') gone('The game could not be read from the server.');
            else this.patch({ view: adopted.view, connection: 'connected', boardKey: this.current.boardKey + 1 });
          }
        }, noAnswer)
      );
      return;
    }

    this.socket.timeout(FOUR_ACK_TIMEOUT_MS).emit('four_spectate_game', { roomId: this.roomId }, (err, ack) =>
      this.guard('four_spectate_game ack', () => {
        if (this.disposed) return;
        const view = this.current.view;
        if (err || !ack) {
          if (view) noAnswer();
          else this.patch({ problem: 'The server did not answer. Go back and try again.', connection: this.socket.connected ? 'connected' : 'reconnecting' });
          return;
        }
        if (typeof ack !== 'object') {
          gone(UNEXPECTED_REPLY);
          return;
        }
        const reply = ack as FourAck<{ state: FourSpectateState }>;
        if (!reply.ok) {
          gone(typeof reply.error === 'string' ? reply.error : UNEXPECTED_REPLY);
          return;
        }
        if (!view) {
          const first = viewFromRoom(reply.state, null, this.effects.now());
          if (first) this.patch({ view: first, connection: 'connected', problem: null });
          else gone('The game could not be read from the server.');
        } else {
          const adopted = adoptSnapshot(view, reply.state, this.effects.now());
          this.patch({ view: adopted.outcome === 'invalid' ? failResync(view) : adopted.view, connection: 'connected' });
        }
      }, noAnswer)
    );
  }

  // --- The player's actions ------------------------------------------------------------------------------------------------------

  /** Plays `move`: shown at once, sent, and rolled back (with a message) if the server refuses; silence rolls back and re-reads the room. */
  sendMove(move: Move): void {
    const view = this.current.view;
    if (!view || this.current.connection !== 'connected') return;
    const begun = beginMove(view, move);
    if (begun.id === null) return;
    const id = begun.id;
    this.setView(begun.view);
    this.effects.moveSound({ san: moveLabel(move), ...(move.captured ? { captured: 'p' as const } : {}) });
    this.socket.timeout(FOUR_ACK_TIMEOUT_MS).emit('four_make_move', movePayloadFor(view.roomId, move), (err, ack) =>
      this.guard('four_make_move ack', () => {
        const latest = this.current.view;
        if (!latest) return;
        const reply = ack as FourAck<{ seq: number }> | undefined;
        if (err || !reply || !reply.ok) {
          const text = reply && !reply.ok ? reply.error : 'The move was not confirmed by the server.';
          this.effects.log(`[FourPlayerOnline] four_make_move rejected (room ${view.roomId}): ${text}`);
          const rejected = moveRejected(latest, id, text);
          this.patch({ view: rejected.view, boardKey: rejected.rolledBack ? this.current.boardKey + 1 : this.current.boardKey });
          // Silence means we do not know whether the server applied it: read the room again.
          if (!reply) this.startResync();
          return;
        }
        // EQUIVALENT-MUTANT NOTE (mutation set W5, "session: ack never clears"): this is a belt-and-braces call. Every way `view.seq` can reach
        // `reply.seq` (an adopted state, or a NEWER whole-room answer) already clears `pending`, and an answer of the SAME seq is only ever older
        // than the ack of the move still in flight, so the condition inside `moveAcked` cannot hold here. The reducer-level `moveAcked` is tested directly.
        this.setView(moveAcked(latest, id, reply.seq));
      })
    );
  }

  resign(onError: (message: string) => void): void {
    const view = this.current.view;
    if (!view || view.mySeat === null) return;
    this.socket.timeout(FOUR_ACK_TIMEOUT_MS).emit('four_resign', { roomId: view.roomId }, (err, ack) => {
      const reply = ack as FourAck | undefined;
      if (err || !reply) onError('The server did not answer.');
      else if (!reply.ok) onError(reply.error);
    });
  }

  sendChat(text: string): void {
    const view = this.current.view;
    const normalized = normalizeFourChatText(text);
    if (!view || view.mySeat === null || !normalized.ok) return;
    this.patch({ chat: appendChat(this.current.chat, { fromSeat: null, name: 'You', text: normalized.value, mine: true }) });
    this.socket.timeout(FOUR_ACK_TIMEOUT_MS).emit('four_send_chat', { roomId: view.roomId, text: normalized.value }, (_err, ack) => {
      const reply = ack as FourAck | undefined;
      if (reply && !reply.ok) this.effects.log(`[FourPlayerOnline] chat refused: ${reply.error}`);
    });
  }

  markChatRead(): void {
    if (this.current.chatUnread !== 0) this.patch({ chatUnread: 0 });
  }
}
