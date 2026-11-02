import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUG_ROOM_CLIENT_EVENT_NAMES,
  BUG_ROOM_CODE_ALPHABET,
  BUG_ROOM_CODE_LENGTH,
  BUG_ROOM_NOT_FOUND_MESSAGE,
  BUG_ROOM_SERVER_EVENT_NAMES,
  BUG_ROOM_TTL_MS,
  bugRoomCooldownMessage,
  bugRoomInviteLink,
  codeFromInviteText,
  filterBugRoomCodeInput,
  normalizeBugRoomCode,
  validateBugRoomCreate,
  validateBugRoomJoin,
  validateBugRoomStart,
  type BugFriendRoomView,
} from '../bughouse/roomWire';
import { canFindOpponents, canStartWithBots, closedText, formatRoomCountdown, inviteCodeFromPath, inviteMessage, roomHeadline, roomSecondsLeft, roomSlots, timeControlOfMatch } from '../bughouseFriendRoomUi';

/**
 * BUGHOUSE FRIEND ROOMS, the pure part on the app side (W6): the code rules, the validators, the wording and the small decisions of the Room / Join screens. The numbers the server and the
 * client must agree on are literals here (the wire file is mirrored, and the backend has its own copy of these checks).
 */
const view = (over: Partial<BugFriendRoomView> = {}): BugFriendRoomView => ({ code: 'K7M2PQ', timeControl: { initialMs: 180000, incrementMs: 0 }, timeControlLabel: '3 min', youAre: 'host', hostName: 'Ann', friendName: null, phase: 'open', expiresInMs: 600000, ...over });

describe('the wire', () => {
  it('pins the code and the life as literals', () => {
    expect(BUG_ROOM_CODE_LENGTH).toBe(6);
    expect(BUG_ROOM_CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
    expect(BUG_ROOM_TTL_MS).toBe(600000);
    expect(BUG_ROOM_NOT_FOUND_MESSAGE).toBe('That code was not found or has expired.');
  });

  it('names exactly four client events and two server events, all bug_room_*', () => {
    expect([...BUG_ROOM_CLIENT_EVENT_NAMES]).toEqual(['bug_room_create', 'bug_room_join', 'bug_room_leave', 'bug_room_start']);
    expect([...BUG_ROOM_SERVER_EVENT_NAMES]).toEqual(['bug_room_update', 'bug_room_closed']);
  });

  it('reads codes the way a person writes them', () => {
    expect(normalizeBugRoomCode(' k7m-2pq ')).toBe('K7M2PQ');
    expect(normalizeBugRoomCode('K7M2P')).toBeNull();
    expect(normalizeBugRoomCode('K7M2P0')).toBeNull(); // no zero
    expect(normalizeBugRoomCode('K7M2PL')).toBeNull(); // no L
    expect(normalizeBugRoomCode(42)).toBeNull();
    expect(filterBugRoomCodeInput('k7m 2p0q1x99')).toBe('K7M2PQ');
    expect(codeFromInviteText('https://x.y/bughouse/join/k7m2pq')).toBe('K7M2PQ');
    expect(codeFromInviteText('see /bughouse/join/K7M2PQ?x=1')).toBe('K7M2PQ');
    expect(codeFromInviteText('nonsense')).toBeNull();
    expect(bugRoomInviteLink('https://app.example/', 'K7M2PQ')).toBe('https://app.example/bughouse/join/K7M2PQ');
  });

  it('validates the payloads, and a bad join says the ONE sentence', () => {
    expect(validateBugRoomCreate({ timeControl: { initialMs: 180000, incrementMs: 0 } }).ok).toBe(true);
    expect(validateBugRoomCreate({ timeControl: { initialMs: 5, incrementMs: 0 } }).ok).toBe(false);
    expect(validateBugRoomJoin({ code: 'k7m2pq' })).toEqual({ ok: true, value: { code: 'K7M2PQ' } });
    for (const bad of [undefined, null, {}, { code: 5 }, { code: 'short' }, 'K7M2PQ']) {
      const result = validateBugRoomJoin(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(BUG_ROOM_NOT_FOUND_MESSAGE);
    }
    expect(validateBugRoomStart({ mode: 'bots' }).ok && validateBugRoomStart({ mode: 'queue' }).ok).toBe(true);
    expect(validateBugRoomStart({ mode: 'x' }).ok).toBe(false);
  });

  it('words the cooldown in seconds and minutes, rounding up', () => {
    expect(bugRoomCooldownMessage(1)).toBe('Too many wrong codes. Try again in 1 second.');
    expect(bugRoomCooldownMessage(59000)).toBe('Too many wrong codes. Try again in 59 seconds.');
    expect(bugRoomCooldownMessage(300000)).toBe('Too many wrong codes. Try again in 5 minutes.');
  });
});

describe('the screens’ wording and decisions', () => {
  it('counts the code’s life down on the device’s own clock, never below zero', () => {
    expect(roomSecondsLeft({ expiresInMs: 600000 }, 1000, 1000)).toBe(600);
    expect(roomSecondsLeft({ expiresInMs: 600000 }, 1000, 61_000)).toBe(540);
    expect(roomSecondsLeft({ expiresInMs: 600000 }, 1000, 1500)).toBe(600); // 599.5 s rounds up
    expect(roomSecondsLeft({ expiresInMs: 1000 }, 1000, 99_000)).toBe(0);
    expect(roomSecondsLeft({ expiresInMs: 5000 }, 9000, 1000)).toBe(5); // a clock that went backwards does not add time
    expect([formatRoomCountdown(582), formatRoomCountdown(5), formatRoomCountdown(600), formatRoomCountdown(-3)]).toEqual(['9:42', '0:05', '10:00', '0:00']);
  });

  it('names the slots for the host and for the friend', () => {
    expect(roomSlots(view())).toEqual({ first: 'You (host)', second: 'Friend: waiting', friendWaiting: true });
    expect(roomSlots(view({ friendName: 'Bo' }))).toEqual({ first: 'You (host)', second: 'Friend: Bo', friendWaiting: false });
    expect(roomSlots(view({ youAre: 'friend', friendName: 'Bo' }))).toEqual({ first: 'Ann (host)', second: 'You', friendWaiting: false });
    expect(roomHeadline(view())).toBe('Your room · 3 min');
    expect(roomHeadline(view({ youAre: 'friend', friendName: 'Bo' }))).toBe('Room of Ann · 3 min · you are teammates');
  });

  it('lets only the host start, with bots only when the friend is in, and never while queued', () => {
    expect(canStartWithBots(view())).toBe(false);
    expect(canStartWithBots(view({ friendName: 'Bo' }))).toBe(true);
    expect(canStartWithBots(view({ friendName: 'Bo', phase: 'queued' }))).toBe(false);
    expect(canStartWithBots(view({ youAre: 'friend', friendName: 'Bo' }))).toBe(false);
    expect(canFindOpponents(view())).toBe(true); // alone: a solo queue entry
    expect(canFindOpponents(view({ friendName: 'Bo', phase: 'queued' }))).toBe(false);
    expect(canFindOpponents(view({ youAre: 'friend', friendName: 'Bo' }))).toBe(false);
  });

  it('writes the closed sentences and the invite', () => {
    expect(closedText('hostLeft')).toBe('The host closed the room.');
    expect(closedText('expired')).toBe('The room expired. Open a new one.');
    expect(inviteMessage('K7M2PQ', 'https://app.example')).toBe('Play Bughouse with me on EM-Chess! https://app.example/bughouse/join/K7M2PQ (code K7M2PQ)');
    expect(inviteMessage('K7M2PQ', null)).toContain('enter K7M2PQ');
    expect(inviteMessage('K7M2PQ', null)).not.toContain('http');
  });

  it('reads an invite code from the address the web app was opened with', () => {
    expect(inviteCodeFromPath('/bughouse/join/k7m2pq')).toBe('K7M2PQ');
    expect(inviteCodeFromPath('/bughouse/join/K7M-2PQ/')).toBe('K7M2PQ');
    expect(inviteCodeFromPath('/')).toBeNull();
    expect(inviteCodeFromPath('/bughouse/join/')).toBeNull();
    expect(inviteCodeFromPath('/other/bughouse/join/K7M2PQ')).toBeNull();
  });

  it('turns a room’s match into the app’s time-control record', () => {
    // (command #35: a control of the app's list comes back as the app's own preset)
    expect(timeControlOfMatch({ initialMs: 180000, incrementMs: 2000 }, '3 | 2')).toEqual({ id: 'blitz-3-2', label: '3 | 2', initialSeconds: 180, incrementSeconds: 2, category: 'blitz' });
    expect(timeControlOfMatch({ initialMs: 60000, incrementMs: 0 }, '1 min').category).toBe('bullet');
    expect(timeControlOfMatch({ initialMs: 0, incrementMs: 0 }, 'No time limit')).toMatchObject({ id: 'unlimited', category: 'unlimited' });
    expect(timeControlOfMatch({ initialMs: 7 * 86_400_000, incrementMs: 0 }, '7 days')).toMatchObject({ id: 'daily-7', category: 'daily', initialSeconds: 604800 });
    // a control the list does not have (an old room record) still becomes a record
    expect(timeControlOfMatch({ initialMs: 420000, incrementMs: 0 }, '7 min')).toEqual({ id: 'bughouse-room-420-0', label: '7 min', initialSeconds: 420, incrementSeconds: 0, category: 'blitz' });
  });
});

describe('the wiring (source scans)', () => {
  const root = join(__dirname, '../../..');
  const read = (path: string) => readFileSync(join(root, path), 'utf8');

  it('every request of the room screen waits through emitWithin, never a bare emit with a callback', () => {
    const source = read('src/screens/BughouseRoomScreen.tsx');
    for (const event of ['bug_room_create', 'bug_room_join', 'bug_room_start']) expect(source).toContain(`'${event}'`);
    expect(source.match(/emitWithin</g)?.length).toBe(3);
    expect(source).not.toMatch(/socket\.emit\([^)]*,\s*\(/);
  });

  it('a code never reaches the Diagnostic Log', () => {
    const source = read('src/screens/BughouseRoomScreen.tsx');
    for (const line of source.split('\n').filter((l) => l.includes('logDiagnostic('))) expect(line.split(' // ')[0]).not.toMatch(/\bcode\b|\$\{raw\}|room\.code/);
  });

  it('the menu offers both entries and the app opens an invite link', () => {
    const menu = read('src/screens/PlayModeSelectScreen.tsx');
    expect(menu).toContain('Bughouse play with a friend');
    expect(menu).toContain('Bughouse join with a code');
    expect(menu).toContain('requireLogin(onBughouseFriend)');
    const app = read('App.tsx');
    expect(app).toContain('inviteCodeFromPath(window.location.pathname)');
    expect(app).toContain("name: 'bughouseRoom'");
  });

  it('the mirror lists the room wire and the backend dependency order is unchanged', () => {
    const manifest = JSON.parse(read('src/logic/bughouse/MIRRORED_TO_BACKEND.json')) as { files: string[] };
    expect(manifest.files.slice(-2)).toEqual(['bughouse/wire.ts', 'bughouse/roomWire.ts']);
  });
});
