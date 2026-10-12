import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FOUR_CLIENT_EVENT_NAMES, FOUR_SERVER_EVENT_NAMES, validateFourTimeControl } from '../fourPlayerWire';
import { TIME_CONTROLS } from '../timeControls';

/**
 * The glue of 4 Player Online that has no React Native renderer to test it: the hook, the screens, the menu and App.tsx. The project's
 * convention for this (see fourPlayerApp.test.ts, screenTouches.test.ts) is to pin the wiring at source level, and the behaviour
 * itself lives in the pure files that fourPlayerOnline.test.ts / fourPlayerOnlineUi.test.ts cover. What is pinned here is what a typo
 * or a careless edit would silently break: event names (the app's socket is untyped, so a misspelt string compiles), who may send what,
 * and that the server stays the only authority.
 */

const SRC = join(__dirname, '../..');
const read = (relative: string): string => readFileSync(join(SRC, relative), 'utf8').replace(/\r\n/g, '\n');
const app = readFileSync(join(SRC, '../App.tsx'), 'utf8').replace(/\r\n/g, '\n');

const ONLINE_FILES = [
  'logic/useFourPlayerOnlineGame.ts',
  'logic/fourPlayerOnlineSession.ts',
  'screens/FourPlayerMatchmakingScreen.tsx',
  'screens/FourPlayerOnlineGameScreen.tsx',
  'screens/FourPlayerSpectatorScreen.tsx',
  'screens/SpectateListScreen.tsx',
];

describe('event names (the socket is untyped, so a typo would compile)', () => {
  const emitted = new Set<string>();
  const listened = new Set<string>();
  for (const file of ONLINE_FILES) {
    const text = read(file);
    for (const m of text.matchAll(/\.emit\(\s*'(four_[a-z_]+)'/g)) emitted.add(m[1]);
    for (const m of text.matchAll(/\.(?:on|off)\(\s*'(four_[a-z_]+)'/g)) listened.add(m[1]);
    for (const m of text.matchAll(/listen\(\s*'(four_[a-z_]+)'/g)) listened.add(m[1]); // the session's own helper for socket.on
  }

  it('every four_* string the client emits or listens for is a real event of the wire contract', () => {
    for (const name of emitted) expect(FOUR_CLIENT_EVENT_NAMES as readonly string[], `emits ${name}`).toContain(name);
    for (const name of listened) expect(FOUR_SERVER_EVENT_NAMES as readonly string[], `listens ${name}`).toContain(name);
  });

  it('the client uses every event it should: all six server events are heard, and every client event but none unused is sent', () => {
    expect([...listened].sort()).toStrictEqual([...FOUR_SERVER_EVENT_NAMES].sort());
    expect([...emitted].sort()).toStrictEqual([...FOUR_CLIENT_EVENT_NAMES].sort());
  });

  it('every listener that is registered is also removed (no leak across rooms)', () => {
    const session = read('logic/fourPlayerOnlineSession.ts');
    for (const name of FOUR_SERVER_EVENT_NAMES) {
      if (name === 'four_queue_update' || name === 'four_match_found') continue; // the matchmaking screen's
      expect(session, `listen ${name}`).toContain(`listen('${name}'`);
    }
    // every handler `listen` registers is kept in one list and removed from it by stop(); reconnect has its own pair
    expect(session).toContain('this.socket.on(event, guarded);');
    expect(session).toContain('for (const { event, fn } of this.handlers) this.socket.off(event, fn as never);');
    expect(session).toContain("this.socket.io.on('reconnect', this.reconnectHandler);");
    expect(session).toContain("this.socket.io.off('reconnect', this.reconnectHandler);");
    const queue = read('screens/FourPlayerMatchmakingScreen.tsx');
    for (const name of ['four_queue_update', 'four_match_found']) {
      expect(queue).toMatch(new RegExp(`socket\\.on\\('${name}'`));
      expect(queue).toMatch(new RegExp(`socket\\.off\\('${name}'`));
    }
    expect(queue).toContain("socket.io.on('reconnect', rejoinQueueOnReconnect)");
    expect(queue).toContain("socket.io.off('reconnect', rejoinQueueOnReconnect)");
  });
});

describe('the server stays the only authority', () => {
  it('no online screen or the hook runs the rules itself: no playMove / resign / chooseBotMove / clockTick (only the pure view functions)', () => {
    for (const file of ONLINE_FILES.filter((f) => f !== 'screens/SpectateListScreen.tsx')) {
      const text = read(file);
      for (const forbidden of [/(?<![A-Za-z])playMove[(]/, /chooseBotMove/, /clockTick/, /(?<![A-Za-z])initialState[(]/, /setTimeout[(]/]) expect(text, `${file}: ${forbidden}`).not.toMatch(forbidden);
      expect(text, file).not.toMatch(/import[^;]*\bresign\b[^;]*from '\.\.?\/(?:logic\/)?fourPlayer'/);
    }
    // the optimistic copy comes from the reducer (applyMoveRaw, no randomness), never from the screen
    expect(read('logic/fourPlayerOnline.ts')).toContain('applyMoveRaw(view.state, move)');
  });

  it('the board is playable only through canMove, and premoves always belong to the player\'s own seat', () => {
    const game = read('screens/FourPlayerOnlineGameScreen.tsx');
    expect(game).toContain('interactive={canMove(view, connected)}');
    expect(game).toContain('premoveSeat={mySeat ?? undefined}');
    expect(game).toContain('onMove={sendMove}');
    expect(game).toContain('play: sendMove,');
    expect(game).toContain('enableAnnotations');
    // a premove is only fired when a move could really be sent (not spent on a reconnect / resync / pending move)
    expect(game).toContain("const myTurnReady = !!view && mySeat !== null && view.state.turn === mySeat && connected && !view.resyncing && !view.pending;");
    expect(game).toContain('isMyTurn: myTurnReady,');
    // premoves resolve against the authority, not the optimistic copy
    expect(game).toContain('resolvePremove(view.state, mySeat, intent)');
  });

  it('a move is only emitted after beginMove accepted it, and a refusal or silence goes through moveRejected', () => {
    const session = read('logic/fourPlayerOnlineSession.ts');
    expect(session).toContain('const begun = beginMove(view, move);');
    expect(session).toContain('if (begun.id === null) return;');
    expect(session).toContain("this.current.connection !== 'connected'");
    expect(session).toContain('moveRejected(latest, id, text)');
    expect(session).toContain('movePayloadFor(view.roomId, move)');
    expect(session).toContain('if (!reply) this.startResync();'); // no answer = unknown outcome = read the room again
    expect(session).toContain('export const FOUR_ACK_TIMEOUT_MS = 8000;');
  });

  it('a gap sends the rejoin through the reducer\'s own verdict (result.resync), once', () => {
    const session = read('logic/fourPlayerOnlineSession.ts');
    expect(session).toContain('const result = applyFourState(view, payload, this.effects.now());');
    expect(session).toContain('if (result.resync) {');
    expect(session).toContain("this.socket.timeout(FOUR_ACK_TIMEOUT_MS).emit('four_rejoin', { roomId: this.roomId, playerToken: token }");
  });

  it('the hook is only the React wrapper: it builds the session around the app\'s one socket and holds no protocol logic', () => {
    const hook = read('logic/useFourPlayerOnlineGame.ts');
    expect(hook).toContain('new FourOnlineSession(connectSocket(authToken) as unknown as FourSocket, role, REAL_EFFECTS)');
    expect(hook).not.toMatch(/socket\.(on|off|emit|timeout)\(/);
    expect(hook).toContain('const leave = useCallback(() => disconnectSocket(), []);');
  });
});

describe('spectators', () => {
  it('can read the chat but the screen never offers a way to write, move, resign or premove', () => {
    const spectator = read('screens/FourPlayerSpectatorScreen.tsx');
    expect(spectator).toContain('<FourPlayerChatPanel messages={chat} />'); // no onSend prop = read-only
    for (const forbidden of ['sendMove', 'sendChat', 'resign', 'usePremove', 'premoveSeat', 'onSend']) expect(spectator, forbidden).not.toContain(forbidden);
    expect(spectator).toContain('interactive={false}');
    expect(spectator).toContain("kind: 'spectator'");
  });

  it('the hook sends nothing for a spectator but the spectate request and the stop on leaving', () => {
    const session = read('logic/fourPlayerOnlineSession.ts');
    expect(session).toContain("this.socket.timeout(FOUR_ACK_TIMEOUT_MS).emit('four_spectate_game', { roomId: this.roomId }");
    expect(session).toContain("this.socket.emit('four_stop_spectating', {});");
    expect(session).toContain('if (!view || view.mySeat === null || !normalized.ok) return;'); // sendChat
    expect(session).toContain('if (!view || view.mySeat === null) return;'); // resign
  });

  it('spectating needs no account: the app passes the (possibly null) token straight through, and the list is reachable without login', () => {
    expect(app).toContain("onSpectate={() => setScreen({ name: 'spectateList', token: authSession?.token ?? null })}");
    expect(app).toContain("| { name: 'fourPlayerSpectate'; token: string | null; roomId: string }");
    expect(app).toContain("onWatchFour={(game) => setScreen({ name: 'fourPlayerSpectate', token, roomId: game.roomId })}");
    expect(read('screens/FourPlayerSpectatorScreen.tsx')).toContain('authToken: string | null;');
  });

  it('an older server without 4 Player support cannot hide or hang the head-to-head list', () => {
    const list = read('screens/SpectateListScreen.tsx');
    expect(list).toContain("socket.timeout(FOUR_LIST_TIMEOUT_MS).emit('four_list_active_games'");
    expect(list).toContain('if (!err && ack && ack.ok) fourGames = ack.games;');
    expect(list).toContain('request !== requestRef.current'); // a slow older Refresh cannot overwrite a newer list
  });
});

describe('entry, queue and leaving', () => {
  it('the Online button on the 4 Player card is behind the login gate, next to the untouched Free-for-All', () => {
    const menu = read('screens/PlayModeSelectScreen.tsx');
    expect(menu).toContain('const handleFourPlayerOnline = requireLogin(onFourPlayerOnline);');
    expect(menu).toContain('onPress={handleFourPlayerOnline}');
    expect(menu).toContain('label="Online"');
    expect(menu).toContain('onPress={onFourPlayer}');
    expect(menu).toContain('label="Free-for-All"');
    expect(app).toContain("onFourPlayerOnline={() => authSession && setScreen({ name: 'fourPlayerOnlineTimeControl', token: authSession.token })}");
  });

  it('the picker leaves out Daily and No time limit, and every preset it does offer is accepted by the server\'s validator', () => {
    expect(app).toContain("excludeCategories={['daily', 'unlimited']}");
    const offered = TIME_CONTROLS.filter((tc) => tc.category !== 'daily' && tc.category !== 'unlimited');
    expect(offered.length).toBeGreaterThanOrEqual(10);
    for (const tc of offered) {
      expect(validateFourTimeControl({ initialSeconds: tc.initialSeconds, incrementSeconds: tc.incrementSeconds }).ok, tc.id).toBe(true);
    }
    // ...and the two that are left out are exactly the ones it would refuse
    for (const tc of TIME_CONTROLS.filter((t) => t.category === 'daily' || t.category === 'unlimited')) {
      expect(validateFourTimeControl({ initialSeconds: tc.initialSeconds, incrementSeconds: tc.incrementSeconds }).ok, tc.id).toBe(false);
    }
  });

  it('the queue screen validates with the shared validator, leaves the queue when it goes away, and says so when the server never answers', () => {
    const queue = read('screens/FourPlayerMatchmakingScreen.tsx');
    expect(queue).toContain('validateFourJoinQueue(');
    expect(queue).toContain("if (stillQueuedRef.current) socket.emit('four_leave_queue', {});");
    expect(queue).toContain('const JOIN_ACK_TIMEOUT_MS = 10_000;');
    expect(queue).toContain('may not be available on this server yet');
    expect(queue).toContain('fillSecondsLeft(');
  });

  it('leaving a live seat asks first with the decided wording, then drops the connection and offers "Return to your game"', () => {
    const game = read('screens/FourPlayerOnlineGameScreen.tsx');
    expect(game).toContain('appAlert(LEAVE_GAME_TITLE, LEAVE_GAME_MESSAGE, [');
    expect(game).toContain("{ text: 'Leave', style: 'destructive', onPress: () => leaveNow(true) },");
    expect(game).toContain('leave();\n    onExit(resumable);');
    expect(app).toContain('setFourResume(resumable ? { token, match, timeControl } : null);');
    expect(app).toContain('fourResume && authSession?.token === fourResume.token');
    expect(app).toContain('resume: true');
    // an in-memory token only (decision: match the 2-player screen; no persistence in W5)
    for (const file of ONLINE_FILES) expect(read(file), file).not.toMatch(/AsyncStorage|localStorage|SecureStore/);
    expect(app).toContain('const [fourResume, setFourResume] = useState<{ token: string; match: FourMatchFoundPayload; timeControl: TimeControl } | null>(null);');
  });

  it('after the game: Play again re-queues for the same time control and Back to menu forgets the game', () => {
    const game = read('screens/FourPlayerOnlineGameScreen.tsx');
    expect(game).toContain('onPress={onPlayAgain}');
    expect(game).toContain('onPress={() => leaveNow(false)}');
    expect(app).toContain("setScreen({ name: 'fourPlayerMatchmaking', token, timeControl });");
  });

  it('local 4 Player is untouched: its screens do not know the online files exist', () => {
    for (const file of ['screens/FourPlayerGameScreen.tsx', 'screens/FourPlayerSetupScreen.tsx', 'logic/useFourPlayerClock.ts']) {
      const text = read(file);
      expect(text, file).not.toMatch(/fourPlayerOnline|FourPlayerOnline|api\/socket|fourPlayerWire/);
    }
  });
});
