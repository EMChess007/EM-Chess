/**
 * Bughouse ONLINE (W4): one client session with one room, as a plain class around a socket - the twin of `fourPlayerOnlineSession.ts`. The rules are in the pure view
 * (`bughouseOnline.ts`); this decides WHEN to send what: one action in flight, a `bug_rejoin` after a gap or a reconnect, a rejoin that gets no answer, a refusal that becomes a sentence.
 * It is free of React and of the real socket (a `BugSocket` is what Socket.IO's client satisfies and the tests fake) and of sounds (injected `effects`).
 *
 * EVERY NETWORK WAIT HAS A HARD LIMIT (CHECKLIST 6b, the #27 pattern): moves, drops, resign and the rejoin go through `emitWithin` (`api/socketAck.ts`, 6 s). An answer that does not come is
 * "Can't reach the server" in words, ONE `[BughouseOnline]` line in the Diagnostic Log, and a way out: the action is retried by the person (the board is live again), the rejoin by `retry()`.
 *
 * THE SERVER DECIDES. Nothing here changes the board: the view is replaced only by a `bug_state`, a `bug_game_over` or a rejoin. A refused action leaves the position as it is and shows why.
 */
import type { Socket } from 'socket.io-client';
import { emitWithin, type AckResult } from '../api/socketAck';
import {
  actionAcked,
  actionFailed,
  adoptRejoin,
  applyBugState,
  applyGameOver,
  applySeatUpdate,
  beginAction,
  beginResync,
  endResync,
  isOver,
  refusalText,
  viewFromMatchFound,
  type BughouseOnlineAction,
  type BughouseOnlineView,
} from './bughouseOnline';
import { classifyBugRejoinAck, type BugAck, type BugGameOverPayload, type BugMatchFoundPayload, type BugRejoinAck, type BugSeatUpdatePayload, type BugStatePayload } from './bughouse/wire';

export type BughouseConnection = 'connected' | 'reconnecting' | 'unavailable';

export type BughouseOnlineRole = { match: BugMatchFoundPayload; resume: boolean };

/** The part of a Socket.IO client the session uses (so a test can fake it). */
export interface BugSocket {
  connected: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, handler: (...args: any[]) => void): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: string, handler: (...args: any[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
  timeout(ms: number): { emit(event: string, payload: object, cb: (err: unknown, ack?: unknown) => void): unknown };
  io: { on(event: string, handler: () => void): unknown; off(event: string, handler: () => void): unknown };
}

/** Sound, the clock and the log, injected so the session needs no React Native module. */
export interface BughouseSessionEffects {
  now(): number;
  /** A move or a drop was heard (someone else's, or the player's own once the server confirmed it). */
  moveSound(): void;
  gameEnded(): void;
  log(message: string): void;
}

export interface BughouseSessionState {
  view: BughouseOnlineView | null;
  connection: BughouseConnection;
  /** Why there is no usable game, or why the room could not be read again ("Can't reach the server"); null when all is well. */
  problem: string | null;
  /** Bumped when the position may have changed under the board's half-made selection (a rejoin): the screen re-keys on it. */
  boardKey: number;
}

export const CANT_REACH = "Can't reach the server.";
const UNEXPECTED_REPLY = 'Unexpected reply from the server.';

export function initialSessionState(role: BughouseOnlineRole, now: number): BughouseSessionState {
  const view = viewFromMatchFound(role.match, now);
  return {
    view,
    connection: role.resume ? 'reconnecting' : 'connected',
    problem: view ? null : 'The game could not be read from the server.',
    boardKey: 0,
  };
}

export class BughouseOnlineSession {
  private current: BughouseSessionState;
  private subscriber: ((state: BughouseSessionState) => void) | null = null;
  private disposed = false;
  private readonly roomId: string;
  private readonly handlers: { event: string; fn: (...args: never[]) => void }[] = [];
  private reconnectHandler: (() => void) | null = null;

  constructor(
    private readonly socket: BugSocket,
    private readonly role: BughouseOnlineRole,
    private readonly effects: BughouseSessionEffects
  ) {
    this.roomId = role.match.roomId;
    this.current = initialSessionState(role, effects.now());
  }

  get state(): BughouseSessionState {
    return this.current;
  }

  subscribe(listener: (state: BughouseSessionState) => void): () => void {
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
    listen('bug_state', (payload: BugStatePayload) => this.onState(payload));
    listen('bug_seat_update', (payload: BugSeatUpdatePayload) => this.onSeatUpdate(payload));
    listen('bug_game_over', (payload: BugGameOverPayload) => this.onGameOver(payload));
    listen('disconnect', () => this.onDisconnect());
    this.reconnectHandler = () => this.guard('reconnect', () => this.onReconnect());
    this.socket.io.on('reconnect', this.reconnectHandler);
    // A screen reopened for a game in progress: read the room now.
    if (this.role.resume) this.startResync();
  }

  stop(): void {
    this.disposed = true;
    for (const { event, fn } of this.handlers) this.socket.off(event, fn as never);
    this.handlers.length = 0;
    if (this.reconnectHandler) this.socket.io.off('reconnect', this.reconnectHandler);
    this.reconnectHandler = null;
  }

  // --- State plumbing ------------------------------------------------------------------------------------------------------------

  /** Every request that waits for an answer goes through here: `emitWithin`, 6 s, then `{ unreachable: true }` (CHECKLIST 6b). */
  private within<T>(event: string, payload: unknown, done: (result: AckResult<T>) => void): void {
    emitWithin<T>(this.socket as unknown as Pick<Socket, 'timeout'>, event, payload, done);
  }

  private patch(change: Partial<BughouseSessionState>): void {
    if (this.disposed) return;
    this.current = { ...this.current, ...change };
    this.subscriber?.(this.current);
  }
  private setView(view: BughouseOnlineView | null): void {
    if (view !== this.current.view) this.patch({ view });
  }
  /** Runs a socket callback so that nothing it does can throw out of it. */
  private guard(what: string, fn: () => void, onFail?: () => void): void {
    try {
      fn();
    } catch (error) {
      try {
        this.effects.log(`[BughouseOnline] ${what} handler failed and was dropped: ${error instanceof Error ? error.message : String(error)}`);
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

  private onState(payload: BugStatePayload): void {
    const view = this.current.view;
    if (!view) return;
    const result = applyBugState(view, payload, this.effects.now());
    this.setView(result.view);
    if (result.outcome === 'applied') {
      // The very sound of a commit: the player's own action is heard when the server confirms it, like everyone else's.
      if (Array.isArray(payload.events) && payload.events.some((e) => e.kind === 'move' || e.kind === 'drop')) this.effects.moveSound();
      if (result.view.match.result !== null) this.effects.gameEnded();
    }
    if (result.resync) {
      this.effects.log(`[BughouseOnline] ${result.outcome} at seq ${String(payload?.seq)} (have ${view.match.seq}); asking the server for the room ${this.roomId}`);
      this.startResync();
    }
  }

  private onSeatUpdate(payload: BugSeatUpdatePayload): void {
    const view = this.current.view;
    if (view) this.setView(applySeatUpdate(view, payload, this.effects.now()));
  }

  private onGameOver(payload: BugGameOverPayload): void {
    const view = this.current.view;
    if (!view) return;
    const next = applyGameOver(view, payload, this.effects.now());
    if (next === view) return;
    this.patch({ view: next, connection: 'connected', problem: null });
    if (view.match.result === null && view.gameOver === null) this.effects.gameEnded();
  }

  private onDisconnect(): void {
    const view = this.current.view;
    if (view && isOver(view)) return;
    this.effects.log(`[BughouseOnline] own connection dropped (room ${this.roomId})`);
    this.patch({ connection: 'reconnecting' });
  }

  private onReconnect(): void {
    const view = this.current.view;
    if (view && isOver(view)) {
      this.patch({ connection: 'connected' });
      return;
    }
    this.effects.log(`[BughouseOnline] own connection restored, rejoining (room ${this.roomId})`);
    this.startResync();
  }

  // --- Resync (rejoin) -----------------------------------------------------------------------------------------------------------

  /** The person's "Retry" after a rejoin that got no answer. */
  retry(): void {
    this.startResync();
  }

  private startResync(): void {
    const view = this.current.view;
    if (!view) return;
    const begun = beginResync(view);
    if (!begun.send) return;
    this.setView(begun.view);
    this.emitRejoin();
  }

  private emitRejoin(): void {
    const gone = (error: string) => {
      const view = this.current.view;
      this.patch({ view: view ? endResync(view) : view, connection: 'unavailable', problem: error });
    };
    const noAnswer = () => {
      const view = this.current.view;
      this.effects.log(`[BughouseOnline] bug_rejoin was not answered (room ${this.roomId})`);
      this.patch({ view: view ? endResync(view) : view, connection: this.socket.connected ? 'connected' : 'reconnecting', problem: CANT_REACH });
    };
    this.within<BugRejoinAck>('bug_rejoin', { roomId: this.roomId, playerToken: this.role.match.playerToken }, (result) =>
      this.guard('bug_rejoin ack', () => this.onRejoinAnswer(result, gone, noAnswer), noAnswer)
    );
  }

  private onRejoinAnswer(result: AckResult<BugRejoinAck>, gone: (error: string) => void, noAnswer: () => void): void {
    if (this.disposed) return;
    const view = this.current.view;
    if (!view) return;
    if (isOver(view)) {
      // a live bug_game_over landed while this request was in flight: the result is on screen and nothing here may touch it
      this.patch({ view: endResync(view), connection: 'connected', problem: null });
      return;
    }
    if (result.unreachable) return noAnswer();
    if (typeof result.ack !== 'object' || result.ack === null) return gone(UNEXPECTED_REPLY);
    const outcome = classifyBugRejoinAck(result.ack);
    this.effects.log(`[BughouseOnline] bug_rejoin ${outcome.kind === 'unavailable' ? `failed: ${outcome.error}` : outcome.kind} (room ${this.roomId})`);
    if (outcome.kind === 'finished') {
      const ended = applyGameOver(view, outcome.gameOver, this.effects.now());
      if (ended === view) return gone(UNEXPECTED_REPLY);
      this.patch({ view: ended, connection: 'connected', problem: null });
    } else if (outcome.kind === 'unavailable') {
      gone(typeof outcome.error === 'string' ? outcome.error : UNEXPECTED_REPLY);
    } else {
      const adopted = adoptRejoin(view, outcome.state, this.effects.now());
      if (adopted.outcome === 'invalid') return gone('The game could not be read from the server.');
      this.patch({ view: adopted.view, connection: 'connected', problem: null, boardKey: this.current.boardKey + 1 });
    }
  }

  // --- The player's actions ------------------------------------------------------------------------------------------------------

  /** Sends a move or a drop. The board does NOT change here: the server's snapshot does. A refusal or silence ends the wait with a sentence. */
  sendAction(action: BughouseOnlineAction): void {
    const view = this.current.view;
    if (!view || this.current.connection !== 'connected') return;
    const begun = beginAction(view, action);
    this.setView(begun.view);
    if (begun.id === null || begun.payload === null) return;
    const id = begun.id;
    const event = action.kind === 'move' ? 'bug_move' : 'bug_drop';
    this.within<BugAck<{ seq: number }>>(event, begun.payload, (result) =>
      this.guard(`${event} ack`, () => {
        const latest = this.current.view;
        if (!latest) return;
        if (result.unreachable) {
          this.effects.log(`[BughouseOnline] ${event} was not answered (room ${this.roomId})`);
          this.setView(actionFailed(latest, id, `${CANT_REACH} Your ${action.kind} may not have gone through: check the board and try again.`));
          // Silence means we do not know whether the server applied it: read the room again.
          this.startResync();
          return;
        }
        const reply = result.ack;
        if (!reply || typeof reply !== 'object' || !('ok' in reply)) {
          this.setView(actionFailed(latest, id, UNEXPECTED_REPLY));
          return;
        }
        if (!reply.ok) {
          this.effects.log(`[BughouseOnline] ${event} refused (room ${this.roomId}): ${reply.reason}`);
          this.setView(actionFailed(latest, id, refusalText(reply.reason)));
          return;
        }
        this.setView(actionAcked(latest, id));
      })
    );
  }

  resign(onError: (message: string) => void): void {
    const view = this.current.view;
    if (!view || isOver(view)) return;
    this.within<BugAck>('bug_resign', { roomId: view.roomId }, (result) => {
      if (result.unreachable) {
        this.effects.log(`[BughouseOnline] bug_resign was not answered (room ${this.roomId})`);
        onError(`${CANT_REACH} Try again.`);
      } else if (result.ack && typeof result.ack === 'object' && 'ok' in result.ack && !result.ack.ok) {
        onError(refusalText(result.ack.reason));
      }
    });
  }
}
