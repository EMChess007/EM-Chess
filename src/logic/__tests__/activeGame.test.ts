import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_GAME_TTL_MS,
  isResumable,
  parseActiveGame,
  serializeActiveGame,
  type ActiveOnlineGame,
} from '../activeGame';

// The online game the player is in survives a page reload / app kill: App.tsx saves it, refreshes a heartbeat, restores it on start and the
// game screens rejoin the seat with the saved token. Server twin: backend/scripts/test-rejoin-persist.mjs (real sockets, a genuinely new process).

const TOKEN = '11111111-2222-3333-4444-555555555555';
const OTHER_TOKEN = '99999999-8888-7777-6666-555555555555';

const two: ActiveOnlineGame = {
  kind: 'twoPlayer',
  userId: 'user-1',
  match: {
    roomId: 'room-1',
    color: 'b',
    playerToken: TOKEN,
    opponent: { userId: 'user-2' },
    timeControl: { initialSeconds: 300, incrementSeconds: 2 },
    isChess960: false,
    isKingOfTheHill: false,
    isThreeCheck: false,
    isSetupChess: false,
    isFogOfWar: true,
    isGiveaway: false,
    isAtomic: false,
    isDuckChess: false,
    isSpellChess: false,
    isHorde: false,
    isCrazyhouse: false,
    fen: '8/8/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    whiteMs: 300000,
    blackMs: 300000,
    visibleSquares: ['a2'],
  },
};
const four: ActiveOnlineGame = {
  kind: 'fourPlayer',
  userId: 'user-1',
  match: { roomId: 'room-4', variant: 'giveaway', seat: 2, playerToken: TOKEN, seats: [{ kind: 'human' }, { kind: 'human' }, { kind: 'human' }, { kind: 'human' }], timeControl: {}, timeControlLabel: '5 min', state: '{"turn":0}', clocksMs: {}, seq: 0 } as never,
  timeControl: { id: 'x', label: '5 min', initialSeconds: 300, incrementSeconds: 0, category: 'blitz' } as never,
};

const bughouse: ActiveOnlineGame = {
  kind: 'bughouse',
  userId: 'user-1',
  match: {
    roomId: 'room-b',
    seat: 3,
    playerToken: TOKEN,
    seats: [1, 2, 3, 4].map((n) => ({ seat: n - 1, kind: 'human', name: `p${n}`, connected: true })),
    timeControl: { initialMs: 60000, incrementMs: 0 },
    timeControlLabel: '1 min',
    state: 'bughouse-text',
    serverNowMs: 5,
    seq: 0,
  } as never,
  timeControl: { id: 'bullet-1', label: '1 min', initialSeconds: 60, incrementSeconds: 0, category: 'bullet' } as never,
};

describe('the record', () => {
  it('round-trips all three kinds, token included', () => {
    expect(parseActiveGame(serializeActiveGame(two))).toEqual(two);
    expect(parseActiveGame(serializeActiveGame(four))).toEqual(four);
    expect(parseActiveGame(serializeActiveGame(bughouse))).toEqual(bughouse);
    expect(parseActiveGame(serializeActiveGame({ ...two, returnToTournamentId: 't-1' }))).toMatchObject({ returnToTournamentId: 't-1' });
  });

  it('keeps everything the screen needs to rebuild the game: the starting FEN, the variant flags, the clocks', () => {
    const back = parseActiveGame(serializeActiveGame(two));
    expect(back?.kind === 'twoPlayer' && back.match.fen).toBe(two.kind === 'twoPlayer' ? two.match.fen : '');
    expect(back?.kind === 'twoPlayer' && back.match.isFogOfWar).toBe(true);
    expect(back?.kind === 'twoPlayer' && back.match.color).toBe('b');
  });

  it.each([
    ['nothing', null],
    ['an empty string', ''],
    ['not JSON', '{oops'],
    ['an array', '[]'],
    ['no user', JSON.stringify({ kind: 'twoPlayer', match: two.kind === 'twoPlayer' ? two.match : {} })],
    ['no token', JSON.stringify({ ...two, match: { ...(two.kind === 'twoPlayer' ? two.match : {}), playerToken: '' } })],
    ['no room', JSON.stringify({ ...two, match: { ...(two.kind === 'twoPlayer' ? two.match : {}), roomId: undefined } })],
    ['a 2-player record without a starting position', JSON.stringify({ ...two, match: { ...(two.kind === 'twoPlayer' ? two.match : {}), fen: undefined } })],
    ['a 4 Player record without a snapshot', JSON.stringify({ ...four, match: { ...(four.kind === 'fourPlayer' ? four.match : {}), state: undefined } })],
    ['a Bughouse record without a snapshot', JSON.stringify({ ...bughouse, match: { ...(bughouse.kind === 'bughouse' ? bughouse.match : {}), state: undefined } })],
    ['a Bughouse record with three seats', JSON.stringify({ ...bughouse, match: { ...(bughouse.kind === 'bughouse' ? bughouse.match : {}), seats: [{}, {}, {}] } })],
    ['a Bughouse record with a seat of 4', JSON.stringify({ ...bughouse, match: { ...(bughouse.kind === 'bughouse' ? bughouse.match : {}), seat: 4 } })],
    ['a Bughouse record with a fractional seat', JSON.stringify({ ...bughouse, match: { ...(bughouse.kind === 'bughouse' ? bughouse.match : {}), seat: 1.5 } })],
    ['a Bughouse record without a time control', JSON.stringify({ ...bughouse, timeControl: undefined })],
    ['an unknown kind', JSON.stringify({ ...two, kind: 'threePlayer' })],
    ['an unknown kind carrying a 4 Player-shaped match', JSON.stringify({ ...four, kind: 'threePlayer' })],
    ['a 2-player record without a colour', JSON.stringify({ ...two, match: { ...(two.kind === 'twoPlayer' ? two.match : {}), color: undefined } })],
  ])('refuses %s (null, never a throw)', (_name, raw) => {
    expect(parseActiveGame(raw as string | null)).toBeNull();
  });
});

describe('when the app walks back in', () => {
  const now = 1_000_000_000;
  it('only for the same account, and only when the app was seen in the game recently', () => {
    expect(isResumable(two, now - 5_000, 'user-1', now)).toBe(true);
    expect(isResumable(two, now - ACTIVE_GAME_TTL_MS, 'user-1', now)).toBe(true);
    expect(isResumable(two, now - ACTIVE_GAME_TTL_MS - 1, 'user-1', now)).toBe(false);
    expect(isResumable(two, now - 5_000, 'user-2', now)).toBe(false);
    expect(isResumable(two, now - 5_000, null, now)).toBe(false);
    expect(isResumable(two, null, 'user-1', now)).toBe(false);
    expect(isResumable(two, Number.NaN, 'user-1', now)).toBe(false);
    expect(isResumable(null, now, 'user-1', now)).toBe(false);
  });

  it('the window covers the server grace (45 s) plus the 5 minutes a result is kept', () => {
    expect(ACTIVE_GAME_TTL_MS).toBeGreaterThanOrEqual(45_000 + 5 * 60 * 1000);
  });
});

// --- the storage module, against in-memory stand-ins for SecureStore / AsyncStorage ---------------------------------------------------
const secure = new Map<string, string>();
const plain = new Map<string, string>();
const logged: string[] = [];
let platform = 'ios';
vi.mock('react-native', () => ({ Platform: { get OS() { return platform; } } }));
vi.mock('expo-secure-store', () => ({
  setItemAsync: async (k: string, v: string) => void secure.set(k, v),
  getItemAsync: async (k: string) => secure.get(k) ?? null,
  deleteItemAsync: async (k: string) => void secure.delete(k),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    setItem: async (k: string, v: string) => void plain.set(k, v),
    getItem: async (k: string) => plain.get(k) ?? null,
    removeItem: async (k: string) => void plain.delete(k),
  },
}));
vi.mock('../diagnosticLog', () => ({ logDiagnostic: (m: string) => logged.push(m) }));

describe('activeGameStorage', () => {
  beforeEach(() => {
    secure.clear();
    plain.clear();
    logged.length = 0;
    platform = 'ios';
    vi.resetModules();
  });
  const load = () => import('../../api/activeGameStorage');

  it('native: the token is in SecureStore, never in the plain storage; the heartbeat is a bare number', async () => {
    const { saveActiveGame } = await load();
    await saveActiveGame(two, 5_000);
    expect([...secure.keys()]).toEqual(['active_online_game']);
    expect(secure.get('active_online_game')).toContain(TOKEN);
    expect([...plain.entries()]).toEqual([['active_online_game_seen', '5000']]);
    expect([...plain.values()].join()).not.toContain(TOKEN);
  });

  it('web: no secure enclave - AsyncStorage holds the record, like the auth session', async () => {
    platform = 'web';
    const { saveActiveGame, loadResumableGame } = await load();
    await saveActiveGame(two, 5_000);
    expect(secure.size).toBe(0);
    expect(plain.get('active_online_game')).toContain(TOKEN);
    expect(await loadResumableGame('user-1', 6_000)).toEqual(two);
  });

  it('keys use only characters SecureStore accepts on Android', async () => {
    const { saveActiveGame } = await load();
    await saveActiveGame(four, 1);
    for (const key of [...secure.keys(), ...plain.keys()]) expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('a restart gets the game back: same account, recently seen', async () => {
    const first = await load();
    await first.saveActiveGame(two, 10_000);
    vi.resetModules(); // a new process: no in-memory state survives
    const second = await load();
    expect(await second.loadResumableGame('user-1', 40_000)).toEqual(two);
  });

  it('the heartbeat extends the window, and is a no-op for a game that was never saved or already cleared', async () => {
    const { saveActiveGame, touchActiveGame, loadResumableGame, clearActiveGame } = await load();
    await saveActiveGame(two, 0);
    await touchActiveGame('room-1', ACTIVE_GAME_TTL_MS);
    expect(await loadResumableGame('user-1', ACTIVE_GAME_TTL_MS + 10_000)).toEqual(two);
    await touchActiveGame('some-other-room', 10 * ACTIVE_GAME_TTL_MS);
    expect(plain.get('active_online_game_seen')).toBe(String(ACTIVE_GAME_TTL_MS));
    await clearActiveGame();
    await touchActiveGame('room-1', 99);
    expect(plain.has('active_online_game_seen')).toBe(false);
  });

  it('too old, or another account: nothing is offered and the dead secret is removed', async () => {
    const { saveActiveGame, loadResumableGame } = await load();
    await saveActiveGame(two, 0);
    expect(await loadResumableGame('user-1', ACTIVE_GAME_TTL_MS + 1)).toBeNull();
    expect(secure.size).toBe(0);
    await saveActiveGame(two, 0);
    expect(await loadResumableGame('user-2', 1_000)).toBeNull();
    expect(secure.size).toBe(0);
  });

  it('game over / resign / leave: clear removes both entries', async () => {
    const { saveActiveGame, clearActiveGame, loadResumableGame } = await load();
    await saveActiveGame(four, 1);
    await clearActiveGame();
    expect(secure.size + plain.size).toBe(0);
    expect(await loadResumableGame('user-1', 2)).toBeNull();
  });

  it('a broken store never throws', async () => {
    const { loadResumableGame, saveActiveGame, clearActiveGame } = await load();
    secure.set('active_online_game', '{garbage');
    expect(await loadResumableGame('user-1', 1)).toBeNull();
    await expect(saveActiveGame(two, 1)).resolves.toBeUndefined();
    await expect(clearActiveGame()).resolves.toBeUndefined();
  });

  it('the token is never logged', async () => {
    const { saveActiveGame, touchActiveGame, loadResumableGame, clearActiveGame } = await load();
    await saveActiveGame(two, 1);
    await touchActiveGame('room-1', 2);
    await loadResumableGame('user-1', 3);
    await loadResumableGame('user-9', 3);
    await clearActiveGame();
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join('\n')).not.toContain(TOKEN);
    expect(logged.join('\n')).not.toContain(OTHER_TOKEN);
  });
});

describe('the wiring', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', '..', ...p), 'utf8').split('\r\n').join('\n');

  it('App.tsx restores the game on start (only from the main screen, for the signed-in account), saves it, heartbeats it and clears it', () => {
    const app = read('App.tsx');
    expect(app).toContain("import { clearActiveGame, loadResumableGame, saveActiveGame, touchActiveGame } from './src/api/activeGameStorage';");
    expect(app).toContain('loadResumableGame(session.user.id)');
    expect(app).toContain("if (current.name !== 'main') return current;");
    expect(app).toContain("{ name: 'onlineGame', token: session.token, match: game.match, returnToTournamentId: game.returnToTournamentId, resume: true }");
    expect(app).toContain("{ name: 'fourPlayerOnlineGame', token: session.token, match: game.match, timeControl: game.timeControl, resume: true }");
    expect(app).toContain("void saveActiveGame({ kind: 'twoPlayer', userId: authSession.user.id, match: screen.match, returnToTournamentId: screen.returnToTournamentId });");
    expect(app).toContain("void saveActiveGame({ kind: 'fourPlayer', userId: authSession.user.id, match: screen.match, timeControl: screen.timeControl });");
    expect(app).toContain('setInterval(() => void touchActiveGame(liveGameRoomId), 20_000)');
    // cleared: game over (both kinds), leaving a 2-player game, a 4 Player exit without a live seat, playing again, logout
    expect(app.match(/onGameEnded=\{\(\) => void clearActiveGame\(\)\}/g)?.length).toBe(3);
    // Bughouse (W4b): restored, saved, offered as "Return to your game" and forgotten like the other two
    expect(app).toContain("if (game.kind === 'bughouse') return { name: 'bughouseOnlineGame', token: session.token, match: game.match, timeControl: game.timeControl, resume: true };");
    expect(app).toContain("void saveActiveGame({ kind: 'bughouse', userId: authSession.user.id, match: screen.match, timeControl: screen.timeControl });");
    expect(app).toContain('void clearActiveGame();\n          setBughouseResume(null);');
    expect(app).toContain('setBughouseResume(resumable ? { token, match, timeControl } : null);');
    expect(app).toContain('bughouseResume && authSession?.token === bughouseResume.token');
    expect(app).toContain("void clearActiveGame(); // leaving is a decision: the seat is not kept");
    expect(app).toContain('if (!resumable) void clearActiveGame();');
    expect(app).toContain('void clearActiveGame();\n          setFourResume(null);');
    expect(app).toContain('const handleLogout = () => {\n    void clearActiveGame();');
  });

  it('the 2-player screen rejoins on mount when resumed, with the same handshake as a restored connection, and reports the end', () => {
    const src = read('src', 'screens', 'OnlineGameScreen.tsx');
    expect(src).toContain("useState<'connected' | 'reconnecting' | 'unavailable'>(resume ? 'reconnecting' : 'connected')");
    expect(src).toContain('const handleReconnect = rejoinNow;');
    expect(src).toContain("socket.io.on('reconnect', handleReconnect);");
    expect(src).toContain("if (socket.connected) rejoinNow();\n      else socket.once('connect', rejoinNow);");
    expect(src).toContain("socket.off('connect', rejoinNow);");
    expect(src).toContain('gameOverHandledRef.current = true;\n      onGameEndedRef.current?.();');
    expect(src).toContain("setConnectionState('unavailable');\n            onGameEndedRef.current?.();");
  });

  it('the 4 Player screen reports the end (a result, or a game the server no longer has)', () => {
    const src = read('src', 'screens', 'FourPlayerOnlineGameScreen.tsx');
    expect(src).toContain("if (ended || connection === 'unavailable') onGameEnded?.();");
  });

  it('the Bughouse screen reports the end (a result, or a game the server no longer has) and the Play menu offers the way back', () => {
    const src = read('src', 'screens', 'BughouseOnlineGameScreen.tsx');
    expect(src).toContain("if (ended || connection === 'unavailable') onGameEnded?.();");
    const menu = read('src', 'screens', 'PlayModeSelectScreen.tsx');
    expect(menu).toContain('{onBughouseResume && (');
    expect(menu).toContain('onPress={onBughouseResume}');
  });

  it('nothing logs the token', () => {
    for (const file of [['App.tsx'], ['src', 'api', 'activeGameStorage.ts'], ['src', 'logic', 'activeGame.ts']]) {
      const text = read(...file);
      const logLines = text.split('\n').filter((l) => /logDiagnostic|console\./.test(l));
      expect(logLines.filter((l) => /playerToken|\.token|TOKEN/.test(l))).toEqual([]);
    }
  });
});
