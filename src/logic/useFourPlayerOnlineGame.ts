import { useCallback, useEffect, useRef, useState } from 'react';
import { connectSocket, disconnectSocket } from '../api/socket';
import { type Move } from './fourPlayer';
import { logDiagnostic } from './diagnosticLog';
import { FourOnlineSession, initialSessionState, type FourOnlineRole, type FourSessionEffects, type FourSessionState, type FourSocket } from './fourPlayerOnlineSession';
import { triggerGameEndHaptics, triggerMoveHaptics } from './haptics';
import { playMoveSound } from './moveSounds';

export type { FourConnection, FourOnlineRole } from './fourPlayerOnlineSession';

/** How often the cosmetic clocks and the grace countdown are redrawn. */
const TICK_MS = 250;

const REAL_EFFECTS: FourSessionEffects = {
  now: () => Date.now(),
  moveSound: (move) => {
    playMoveSound(move);
    triggerMoveHaptics(move);
  },
  gameEnded: triggerGameEndHaptics,
  log: logDiagnostic,
};

/**
 * The React side of an online 4 Player game, for a player or a spectator (FOUR_PLAYER_ONLINE_SPEC.md §8). Everything that matters is in
 * `FourOnlineSession` (what to send and when, on top of the pure reducer in `fourPlayerOnline.ts`) and is unit-tested there against a fake
 * socket; this hook only owns the session for the lifetime of the screen, mirrors its state into React state, and ticks a clock so the
 * cosmetic countdowns redraw a few times a second. The socket is the app's singleton (`connectSocket`): the same connection that queued
 * the player must carry the game, because the server finds a seat by socket.
 *
 * `leave()` drops that connection (the server then starts the 45 s grace for the seat). A spectator's connection is dropped when the
 * screen unmounts, as in the 2-player spectator screen.
 */
export function useFourPlayerOnlineGame(authToken: string | null, role: FourOnlineRole) {
  const roomId = role.kind === 'player' ? role.match.roomId : role.roomId;
  const [state, setState] = useState<FourSessionState>(() => initialSessionState(role, Date.now()));
  const [now, setNow] = useState(() => Date.now());
  const sessionRef = useRef<FourOnlineSession | null>(null);

  useEffect(() => {
    const session = new FourOnlineSession(connectSocket(authToken) as unknown as FourSocket, role, REAL_EFFECTS);
    sessionRef.current = session;
    const unsubscribe = session.subscribe(setState);
    session.start();
    return () => {
      unsubscribe();
      session.stop();
      sessionRef.current = null;
      if (role.kind === 'spectator') disconnectSocket();
    };
    // The room and token are fixed for this screen's lifetime (set once by the caller).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, roomId]);

  // Cosmetic clocks and the grace countdown: redraw a few times a second while the game is on.
  const live = state.view !== null && !state.view.gameOver;
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [live]);

  const sendMove = useCallback((move: Move) => sessionRef.current?.sendMove(move), []);
  const resign = useCallback((onError: (message: string) => void) => sessionRef.current?.resign(onError), []);
  const sendChat = useCallback((text: string) => sessionRef.current?.sendChat(text), []);
  const markChatRead = useCallback(() => sessionRef.current?.markChatRead(), []);
  const leave = useCallback(() => disconnectSocket(), []);

  return { ...state, now, sendMove, resign, sendChat, markChatRead, leave };
}
