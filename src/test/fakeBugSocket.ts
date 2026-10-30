import type { BugSocket } from '../logic/bughouseOnlineSession';

type Cb = (err: unknown, ack?: unknown) => void;

/**
 * A fake Socket.IO client for the online Bughouse tests (the session's, the queue screen's and the game screen's): it records every request that waits for an answer (event, payload, the limit it
 * was given) and every plain emit, delivers server events on demand and answers - or deliberately does NOT answer - when the test says so. No timers: an answer that never comes is `silence`.
 */
export class FakeBugSocket implements BugSocket {
  connected = true;
  handlers = new Map<string, Set<(...args: never[]) => void>>();
  managerHandlers = new Map<string, Set<() => void>>();
  /** every request that waits for an answer: the event, its payload, the limit it was given and the callback that answers it */
  asked: { event: string; payload: unknown; ms: number; cb: Cb }[] = [];
  /** every plain emit (no answer awaited) */
  plain: { event: string; args: unknown[] }[] = [];
  on(event: string, handler: (...args: never[]) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return this;
  }
  off(event: string, handler: (...args: never[]) => void) {
    this.handlers.get(event)?.delete(handler);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    this.plain.push({ event, args });
    return this;
  }
  timeout(ms: number) {
    return { emit: (event: string, payload: object, cb: Cb) => void this.asked.push({ event, payload, ms, cb }) };
  }
  io = {
    on: (event: string, handler: () => void) => {
      if (!this.managerHandlers.has(event)) this.managerHandlers.set(event, new Set());
      this.managerHandlers.get(event)!.add(handler);
    },
    off: (event: string, handler: () => void) => void this.managerHandlers.get(event)?.delete(handler),
  };
  /** delivers a server event to every listener */
  fire(event: string, payload?: unknown) {
    for (const h of [...(this.handlers.get(event) ?? [])]) (h as (p: unknown) => void)(payload);
  }
  fireManager(event: string) {
    for (const h of [...(this.managerHandlers.get(event) ?? [])]) h();
  }
  /** answers the oldest unanswered request for `event` */
  answer(event: string, ack: unknown) {
    const index = this.asked.findIndex((a) => a.event === event);
    if (index < 0) throw new Error(`no pending ${event}`);
    const [req] = this.asked.splice(index, 1);
    req.cb(null, ack);
    return req;
  }
  /** the oldest request for `event` gets no answer: socket.io's own timeout error */
  silence(event: string) {
    const index = this.asked.findIndex((a) => a.event === event);
    if (index < 0) throw new Error(`no pending ${event}`);
    const [req] = this.asked.splice(index, 1);
    req.cb(new Error('operation has timed out'));
  }
  pending(event: string) {
    return this.asked.filter((a) => a.event === event);
  }
  listenerCount(event: string) {
    return this.handlers.get(event)?.size ?? 0;
  }
}
