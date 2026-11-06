// Mutation set for command #35 (Parts B and C), SERVER side: the generalised friend-room manager (friendRooms.ts: Bughouse's two members, the 4-seat games' four), the 4-seat room handlers, the
// Daily / unlimited rules of the 2-player server and of the 4-seat rooms. The harness is this repository's; the repository mutated is the BACKEND's. Run from the app repository:
//   npm run mutate -- scripts/mutation/configs/friend-rooms-generic.config.cjs
// The command runs the Bughouse friend-room suite (W6's 110 checks, which the generalisation must keep green), the 4-seat friend-room suite (manager + real sockets), and the 4-seat rooms suite
// (No time limit / Daily). A mutant is killed by ANY of them. Every mutant is killed or carries "EQUIVALENT" and the reason in its name.
const F = 'src/game/friendRooms.ts';
const H = 'src/game/fourPlayerHandlers.ts';
const R = 'src/game/fourPlayerRooms.ts';
const S = 'src/game/rooms.ts';
const C = 'src/game/fourPlayerConfig.ts';
const m = (name, file, find, replace) => [name, file, find, replace];
const f = (name, find, replace) => m(name, F, find, replace);

const mutants = [
  // --- the generic manager ---------------------------------------------------------------------------------------------------------------------
  f('create: a guest may open a room', "    if (host.userId === null) return bugRefusal('invalidRequest', this.messages.login);\n    this.dropExpired();", '    this.dropExpired();'),
  f('create: a second room per user', ' || this.byUser.has(host.userId)) return bugRefusal(\'invalidRequest\', this.messages.haveRoom);\n    if (this.deps.isBusy(host.socketId))', ') return bugRefusal(\'invalidRequest\', this.messages.haveRoom);\n    if (this.deps.isBusy(host.socketId))'),
  f('create: a busy socket may open a room', "    if (this.deps.isBusy(host.socketId)) return bugRefusal('invalidRequest', this.messages.busy);\n    if (this.rooms.size", '    if (this.rooms.size'),
  f('create: the cap is off by one', 'if (this.rooms.size >= this.capacity)', 'if (this.rooms.size > this.capacity)'),
  f('create: the room is not expired-swept first', '    this.dropExpired();\n    if (this.bySocket', '    if (this.bySocket'),
  f('join: a guest may join', "    if (caller.userId === null) return bugRefusal('invalidRequest', this.messages.login);\n    if (this.bySocket.has(caller.socketId) || this.byUser.has(caller.userId))", '    if (this.bySocket.has(caller.socketId) || this.byUser.has(caller.userId!))'),
  f('join: a member of a room may join another', ' || this.byUser.has(caller.userId)) return bugRefusal(\'invalidRequest\', this.messages.haveRoom);\n    if (this.deps.isBusy(caller.socketId))', ') return bugRefusal(\'invalidRequest\', this.messages.haveRoom);\n    if (this.deps.isBusy(caller.socketId))'),
  f('join: a busy socket may join', "    if (this.deps.isBusy(caller.socketId)) return bugRefusal('invalidRequest', this.messages.busy);\n    const keys", '    const keys'),
  f('join: the limiter is not asked', "    const verdict = this.limiter.check(keys);\n    if (!verdict.allowed) return bugRefusal('rateLimited', bugRoomCooldownMessage(verdict.retryAfterMs));\n", ''),
  f('join: a failed guess is not counted', '      this.limiter.recordFailure(keys);\n      return bugRefusal', '      return bugRefusal'),
  f('join: a full room takes one more', 'room.friends.length + 1 >= this.deps.maxMembers', 'room.friends.length + 1 > this.deps.maxMembers'),
  f('join: a full room takes two more (the limit is not the family\'s)', 'room.friends.length + 1 >= this.deps.maxMembers', 'room.friends.length + 1 >= this.deps.maxMembers + 1'),
  f('join: a queued room can be joined', " || room.phase !== 'open') {\n      this.limiter.recordFailure(keys);", ') {\n      this.limiter.recordFailure(keys);'),
  f('join: the host joins their own room (EQUIVALENT: the socket and the user are already mapped to the room, so the earlier "already have an open room" answer is what the host gets; pinned in test-four-friend-rooms.mjs)', ' || room.host.socketId === caller.socketId) return bugRefusal(\'invalidRequest\', this.messages.own);', ') return bugRefusal(\'invalidRequest\', this.messages.own);'),
  f('join: the joiner is not mapped to the room', '    this.bySocket.set(caller.socketId, room.code);\n    this.byUser.set(caller.userId, room.code);\n    this.notifyOthers', '    this.notifyOthers'),
  f('join: nobody is told a friend came', '    this.notifyOthers(room, caller.socketId);\n    return { ok: true, room: this.viewOf(room, \'friend\') };', '    return { ok: true, room: this.viewOf(room, \'friend\') };'),
  f('leave: the host leaving does not delete the room', '    if (room.host.socketId === socketId) {\n      this.delete(room);', '    if (room.host.socketId === socketId) {'),
  f('leave: the friends are not told the host left', "      for (const friend of room.friends) this.deps.notifyClosed(friend.socketId, 'hostLeft');", ''),
  f('leave: a friend leaving does not free the slot', '      this.forget(room.friends[index]);\n      room.friends.splice(index, 1);', '      this.forget(room.friends[index]);'),
  f('leave: a friend leaving is not remembered as gone', '      this.forget(room.friends[index]);\n      room.friends.splice', '      room.friends.splice'),
  f('leave: nobody is told a friend left', '    this.notifyAll(room);\n  }\n\n  /** The matchmaker cancelled', '  }\n\n  /** The matchmaker cancelled'),
  f('start: a friend may start', "    if (room.host.socketId !== socketId) return bugRefusal('invalidRequest', this.messages.notHost);", ''),
  f('start: the host may start alone', "      if (room.friends.length === 0) return bugRefusal('invalidRequest', this.messages.noFriend);\n      try {", '      try {'),
  f('start: the friends are not seated', 'this.deps.startWithBots([room.host, ...room.friends], room.timeControl, room.label, room.extra)', 'this.deps.startWithBots([room.host], room.timeControl, room.label, room.extra)'),
  f('start: the room survives its game', "      this.delete(room);\n      return { ok: true, outcome: 'started' };", "      return { ok: true, outcome: 'started' };"),
  f('start: a queue start works without a pair queue', "    if (enqueue === undefined) return bugRefusal('invalidRequest', 'Invalid request.');\n", ''),
  f('life: a room never expires', 'return this.timers.now() - room.createdAt >= this.ttlMs;', 'return false;'),
  f('life: a room expires one millisecond late', 'return this.timers.now() - room.createdAt >= this.ttlMs;', 'return this.timers.now() - room.createdAt > this.ttlMs;'),
  f('life: expiry does not tell the friends', "    for (const friend of room.friends) this.deps.notifyClosed(friend.socketId, 'expired');", ''),
  f('life: expiry does not tell the host', "    this.deps.notifyClosed(room.host.socketId, 'expired');\n", ''),
  f('life: the sweep forgets the limiter', '    this.limiter.sweep();\n    return n;', '    return n;'),
  f('view: the expiry countdown is not reduced by the time spent', 'Math.max(0, room.createdAt + this.ttlMs - this.timers.now())', 'Math.max(0, this.ttlMs)'),
  f('constructor: a room of five is accepted', 'deps.maxMembers > 4', 'deps.maxMembers > 5'),
  f('constructor: a room of one is accepted', 'deps.maxMembers < 2', 'deps.maxMembers < 1'),
  f('code: the code has no alphabet', 'code += BUG_ROOM_CODE_ALPHABET[this.randomInt(BUG_ROOM_CODE_ALPHABET.length)];', "code += 'A';"),
  // --- the 4-seat handlers -----------------------------------------------------------------------------------------------------------------------
  m('four handlers: the room is created without the variant', H, 'friendRooms.create(caller, parsed.value.timeControl, parsed.value.variant)', "friendRooms.create(caller, parsed.value.timeControl, 'ffa')"),
  m('four handlers: a room member may queue', H, "            : friendRooms.viewFor(socket.id) !== null\n              ? { ok: false, error: 'Leave your friend room first, or start from it.' }\n              : null;", '            : null;'),
  m('four handlers: a disconnect does not leave the room', H, '        friendRooms.disconnect(socket.id); // first: it settles the room before the plain queue leave below', '        void 0;'),
  m('four handlers: bots are not made for the empty seats', H, 'Array.from({ length: 4 - humans.length }', 'Array.from({ length: 0 }'),
  m('four handlers: the seats are not shuffled', H, 'const seats = shuffled([...humans, ...bots], randomInt) as FourSeatSetups;', 'const seats = [...humans, ...bots] as FourSeatSetups;'),
  m('four handlers: start is always the host\'s mode "queue"', H, "friendRooms.start(socket.id, 'bots')", "friendRooms.start(socket.id, 'queue')"),
  // --- Daily and No time limit --------------------------------------------------------------------------------------------------------------------
  m('four rooms: a No time limit room has a running clock', R, 'timeControl.value.initialSeconds > 0),', 'true),'),
  m('four rooms: the clock timer is armed for a disabled clock', R, "if (room.status !== 'active' || room.state.result || !room.clock.enabled) return;", "if (room.status !== 'active' || room.state.result) return;"),
  m('four config: No time limit bots think at bullet speed', C, 'return initialSeconds > 0 && initialSeconds <= FOUR_BULLET_MAX_INITIAL_SECONDS', 'return initialSeconds <= FOUR_BULLET_MAX_INITIAL_SECONDS'),
  m('rooms: a Daily game forfeits on a disconnect', S, '    if (isDailyTimeControl(room.timeControl)) return;\n', ''),
  m('rooms: Daily starts at two days', S, 'export const DAILY_MIN_SECONDS = 86_400;', 'export const DAILY_MIN_SECONDS = 172_800;'),
  m('rooms: Daily starts at an hour', S, 'export const DAILY_MIN_SECONDS = 86_400;', 'export const DAILY_MIN_SECONDS = 3_600;'),
  m('server: a clock of any length is accepted', 'src/game/socketHandlers.ts', '    tc.initialSeconds <= 14 * 86_400 &&\n', ''),
  m('server: a clock of 15 days is accepted', 'src/game/socketHandlers.ts', 'tc.initialSeconds <= 14 * 86_400', 'tc.initialSeconds <= 15 * 86_400'),
];

module.exports = {
  root: require('node:path').resolve(__dirname, '..', '..', '..', 'backend'),
  copy: ['src', 'scripts', 'package.json', 'tsconfig.json', 'prisma', '.env', '.env.example'],
  junction: ['node_modules'],
  cmd: 'npx tsx scripts/test-bughouse-friend-rooms.mjs && npx tsx scripts/test-four-friend-rooms.mjs && npx tsx scripts/test-fourplayer-rooms.mjs && npx tsx scripts/test-unlimited.mjs',
  mutants,
  mutantTimeoutMs: 120_000,
  baselineTimeoutMs: 240_000,
};
