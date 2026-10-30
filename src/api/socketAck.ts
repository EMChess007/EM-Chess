import type { Socket } from 'socket.io-client';

/**
 * An acknowledged socket request with a deadline (offline-states branch). `socket.emit(event, payload, ack)` on a socket that never connects (the laptop is off, a firewall drops
 * the packets) buffers the event and NEVER calls `ack`: the screen's spinner then outlives everything. `socket.timeout(ms).emit(...)` calls the ack with an error instead, and
 * that is the only form a screen that waits for a server's answer may use (a scan test, offlineStates.test.ts, pins it).
 *
 * The deadline matches the HTTP client's (REQUEST_DEADLINE_MS, src/api/client.ts): "Can't reach the server" within 8 s whatever fails. It is declared here too, as a literal the
 * mutation tests pin, so this file imports nothing from the client (and so nothing native).
 */
export const SOCKET_ACK_DEADLINE_MS = 6000;

/** What `ackWithin` calls back with: the server's answer, or `unreachable` when no answer came in time. */
export type AckResult<T> = { unreachable: false; ack: T } | { unreachable: true };

/** `socket.emit(event, payload)` that answers within SOCKET_ACK_DEADLINE_MS: `done` gets the ack, or `{ unreachable: true }` when none came. `done` runs exactly once. */
export function emitWithin<T>(socket: Pick<Socket, 'timeout'>, event: string, payload: unknown, done: (result: AckResult<T>) => void, ms: number = SOCKET_ACK_DEADLINE_MS): void {
  socket.timeout(ms).emit(event, payload, (err: unknown, ack?: T) => {
    if (err || ack === undefined) done({ unreachable: true });
    else done({ unreachable: false, ack });
  });
}
