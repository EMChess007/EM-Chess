import { useCallback, useEffect, useRef, useState } from 'react';
import { connectSocket, disconnectSocket } from '../api/socket';
import { logDiagnostic } from './diagnosticLog';
import { BughouseOnlineSession, initialSessionState, type SendOutcome, type BugSocket, type BughouseOnlineRole, type BughouseSessionEffects, type BughouseSessionState } from './bughouseOnlineSession';
import type { BughouseOnlineAction } from './bughouseOnline';
import { triggerGameEndHaptics, triggerMoveHaptics } from './haptics';
import { playMoveSound } from './moveSounds';

/** How often the clocks and the grace countdowns are redrawn (the clock text has a tenth of a second under 10 s; 4 times a second is smooth enough and cheap). */
const TICK_MS = 250;

const REAL_EFFECTS: BughouseSessionEffects = {
  now: () => Date.now(),
  moveSound: () => {
    playMoveSound(null);
    triggerMoveHaptics(null);
  },
  gameEnded: triggerGameEndHaptics,
  log: logDiagnostic,
};

/**
 * The React side of an online Bughouse game (W4): a thin wrapper that owns a `BughouseOnlineSession` for the lifetime of the screen, mirrors its state into React state and ticks a clock so
 * the cosmetic countdowns redraw. Everything that matters is in the session and the pure view, tested against a fake socket. The socket is the app's singleton (`connectSocket`): the connection
 * that queued the player carries the game, because the server finds a seat by socket. `leave()` drops it (the server then starts its 45 s grace for the seat).
 */
export function useBughouseOnlineGame(authToken: string | null, role: BughouseOnlineRole) {
  const roomId = 'spectate' in role ? role.spectate.roomId : role.match.roomId;
  const [state, setState] = useState<BughouseSessionState>(() => initialSessionState(role, Date.now()));
  const [now, setNow] = useState(() => Date.now());
  const sessionRef = useRef<BughouseOnlineSession | null>(null);

  useEffect(() => {
    const session = new BughouseOnlineSession(connectSocket(authToken) as unknown as BugSocket, role, REAL_EFFECTS);
    sessionRef.current = session;
    const unsubscribe = session.subscribe(setState);
    session.start();
    return () => {
      unsubscribe();
      session.stop();
      sessionRef.current = null;
    };
    // The room and token are fixed for this screen's lifetime (set once by the caller).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, roomId]);

  const live = state.view !== null && state.view.match.result === null && state.view.gameOver === null;
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [live]);

  const sendAction = useCallback((action: BughouseOnlineAction) => sessionRef.current?.sendAction(action), []);
  const resign = useCallback((onError: (message: string) => void) => sessionRef.current?.resign(onError), []);
  const retry = useCallback(() => sessionRef.current?.retry(), []);
  const leave = useCallback(() => {
    sessionRef.current?.stopSpectating();
    disconnectSocket();
  }, []);
  const sendQuick = useCallback((code: number, done: (outcome: SendOutcome) => void) => sessionRef.current?.sendQuick(code, done), []);
  const sendChat = useCallback((text: string, done: (outcome: SendOutcome) => void) => sessionRef.current?.sendChat(text, done), []);

  return { ...state, now, sendAction, resign, retry, leave, sendQuick, sendChat };
}
