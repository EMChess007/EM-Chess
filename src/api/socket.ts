import { io, type Socket } from 'socket.io-client';
import { API_BASE_URL } from './client';

let socket: Socket | null = null;

/**
 * Connects (or returns the already-connected) singleton Socket.IO client for the multiplayer
 * layer. Deliberately a module-level singleton, not per-screen state: the backend identifies
 * a player's seat in a game room by socket.id, so the SAME connection must survive the
 * MatchmakingScreen -> OnlineGameScreen transition — tearing it down and recreating it between
 * screens would look like a disconnect to the server.
 */
export function connectSocket(authToken: string | null): Socket {
  if (!socket) {
    socket = io(API_BASE_URL, {
      transports: ['websocket'],
      auth: authToken ? { token: authToken } : {},
    });
  }
  return socket;
}

/** The active socket — throws if connectSocket() hasn't been called yet, since every online
 * screen is only ever reached after MatchmakingScreen has already connected one. */
export function getSocket(): Socket {
  if (!socket) {
    throw new Error('[socket] getSocket() called before connectSocket() — no active connection.');
  }
  return socket;
}

/** Fully tears down the connection — call when leaving the online flow back to the menu
 * (cancelling matchmaking, or after a finished game), not between its own screens. */
export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
