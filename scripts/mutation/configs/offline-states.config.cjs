// Mutation set for the offline states (branch fix/offline-states): the request budget and its retries (src/api/client.ts), the diagnostic line, the socket answer deadline
// (src/api/socketAck.ts), and how the screens that wait for a socket answer use it (Tournament standings / create / join / start, Spectator game, Challenge create / join), plus the
// tab bar's icon inks.
//
//   MUTATION_ROOT=<this repository> node <harness>/scripts/mutation/run.cjs scripts/mutation/configs/offline-states.config.cjs        (chunks of at most 20 mutants; `--chunk N` runs one)
//
// The in-repo harness (scripts/mutation) lives on paired/bughouse until master has it; `MUTATION_ROOT` names the checkout to mutate (the harness only ever READS the root and mutates a
// copy). The suites: the request budget to the millisecond with fake timers, the socket deadline, the tab icons (logic project) and the screens with a recording socket (dom project).
// The REAL clock against real servers (apiOfflineRealServers.test.ts, offlineScreens.dom.test.tsx, the browser end-to-end) is NOT in this command: it takes minutes per run.
// A name that says EQUIVALENT cannot change behaviour; the test named in it pins why.
const C = 'src/api/client.ts';
const S = 'src/api/socketAck.ts';
const TS = 'src/screens/TournamentStandingsScreen.tsx';
const SG = 'src/screens/SpectatorGameScreen.tsx';
const T = 'src/screens/TournamentScreen.tsx';
const CH = 'src/screens/ChallengeScreen.tsx';
const B = 'src/components/BottomTabBar.tsx';

module.exports = {
  root: process.env.MUTATION_ROOT || undefined,
  copy: ['src', 'assets', 'scripts/browser', 'App.tsx', 'package.json', 'tsconfig.json', 'vitest.config.mts'],
  junction: ['node_modules'],
  cmd:
    'npx vitest run src/logic/__tests__/apiRequestDeadline.test.ts src/logic/__tests__/socketAck.test.ts src/logic/__tests__/tabIcons.test.ts src/logic/__tests__/loadError.test.ts src/screens/__tests__/offlineSockets.dom.test.tsx src/screens/__tests__/loadFailed.dom.test.tsx',
  mutantTimeoutMs: 4 * 60 * 1000,
  mutants: [
    // --- the request budget ---
    ['client: the load budget is 10 x longer', C, 'export const REQUEST_DEADLINE_MS = 6000;', 'export const REQUEST_DEADLINE_MS = 60000;'],
    ['client: the quick retry waits 3 s', C, 'retryDelaysMs: [1000] }', 'retryDelaysMs: [3000] }'],
    ['client: a load has no retry', C, 'retryDelaysMs: [1000] }', 'retryDelaysMs: [] }'],
    ["client: a load's one try may last only 3 s (the retry after a hang)", C, 'attemptMs: REQUEST_DEADLINE_MS, retryDelaysMs', 'attemptMs: 3000, retryDelaysMs'],
    ["client: a load's whole budget is 60 s", C, 'totalMs: REQUEST_DEADLINE_MS, attemptMs', 'totalMs: 60000, attemptMs'],
    ['client: the patient total is 30 s', C, 'totalMs: 45000,', 'totalMs: 30000,'],
    ['client: the patient try is 6 s', C, 'attemptMs: 12000,', 'attemptMs: 6000,'],
    ['client: the patient policy has one retry', C, 'retryDelaysMs: [3000, 6000] }', 'retryDelaysMs: [3000] }'],
    ['client: the request is not told which policy to use', C, 'options.background ? BACKGROUND_POLICY : INTERACTIVE_POLICY', 'INTERACTIVE_POLICY'],
    ['client: the rating sync is not a background write', C, 'body: { category, rating }, background: true }', 'body: { category, rating } }'],
    ['client: the game save is not a background write', C, 'body: game, token, background: true }', 'body: game, token }'],
    ['client: the puzzle mark is not a background write', C, '      background: true,\n', ''],
    // --- the tries ---
    ['client: the budget check lets a spent budget try again', C, 'if (remaining <= 0) break;', 'if (remaining < 0) break;'],
    ['client: a retry gets the full try time, not what is left', C, 'Math.min(policy.attemptMs, remaining)', 'policy.attemptMs'],
    ['client: a retry waits its full delay, not what is left', C, 'Math.min(policy.retryDelaysMs[attempt], policy.totalMs - (Date.now() - startedAt))', 'policy.retryDelaysMs[attempt]'],
    ['client: EQUIVALENT (a delay of 0 ms ends the loop at once either way; pinned by "a body that never arrives ... one try only")', C, 'if (wait > 0) await', 'if (wait >= 0) await'],
    ['client: EQUIVALENT (past the last retry the delay is NaN and NaN > 0 is false; pinned by the patient policy test: 3 tries, over at 45000 ms)', C, 'if (attempt < policy.retryDelaysMs.length) {', 'if (attempt <= policy.retryDelaysMs.length) {'],
    ['client: the tries are not counted', C, 'tally.tries++;', ''],
    ['client: the last error is forgotten', C, '      lastError = err;\n', ''],
    // --- the abort and the body ---
    ['client: the timer does not abort the request', C, 'controller.abort();', ''],
    ['client: fetch is not given the signal', C, '{ ...init, signal: controller.signal }', '{ ...init }'],
    ['client: the timer is left running', C, '    clearTimeout(timeoutId);', ''],
    ['client: the deadline does not cover the body', C, '      timedOut,\n    ]);', '    ]);'],
    ['client: headers that arrived are not noticed', C, 'gotHeaders = true;', 'gotHeaders = false;'],
    ['client: the phase is swapped', C, "gotHeaders ? 'body' : 'headers'", "gotHeaders ? 'headers' : 'body'"],
    // --- the diagnostic line ---
    ['log: the line says "no response" for a stalled body', C, "err.phase === 'headers' ? 'no response' : 'the body stalled'", "err.phase === 'headers' ? 'the body stalled' : 'no response'"],
    ['log: the query string is kept', C, "path.split('?')[0]", 'path'],
    ['log: "try" and "tries" are swapped', C, "attempts === 1 ? 'try' : 'tries'", "attempts === 1 ? 'tries' : 'try'"],
    ['log: an error message is cut at 61', C, 'err.message.slice(0, 60)', 'err.message.slice(0, 61)'],
    ['log: an HTTP error is not logged', C, 'logFailure(method, path, `HTTP ${response.status}`, startedAt, tally.tries);', ''],
    ['log: the host keeps its path', C, '[^/?#]+', '[^/]+'],
    ['log: no host is named "x"', C, "?? 'unknown'", "?? 'x'"],
    // --- the socket deadline ---
    ['socket: the deadline is 60 s', S, 'export const SOCKET_ACK_DEADLINE_MS = 6000;', 'export const SOCKET_ACK_DEADLINE_MS = 60000;'],
    ['socket: the default deadline is 12 s', S, 'ms: number = SOCKET_ACK_DEADLINE_MS', 'ms: number = 12000'],
    ['socket: a given deadline is ignored', S, 'socket.timeout(ms)', 'socket.timeout(SOCKET_ACK_DEADLINE_MS)'],
    ['socket: a missing answer is not unreachable when there is no error', S, 'if (err || ack === undefined) done', 'if (err && ack === undefined) done'],
    ['socket: a falsy answer is unreachable', S, '|| ack === undefined)', '|| !ack)'],
    ['socket: no answer is handed on as an answer', S, 'done({ unreachable: true });', 'done({ unreachable: false, ack: ack as T });'],
    // --- the screens ---
    ['standings: the unreachable text is another', TS, 'setError(SERVER_UNREACHABLE_MESSAGE);', "setError('Could not load');"],
    ['standings: Retry does not ask again', TS, '}, [tournamentId, reloadTick]);', '}, [tournamentId]);'],
    ['standings: no Retry button', TS, 'error === SERVER_UNREACHABLE_MESSAGE ? (', 'false ? ('],
    ['standings: a late answer is not ignored', TS, 'if (cancelled) return;', ''],
    ['spectator: the unreachable text is another', SG, 'setError(SERVER_UNREACHABLE_MESSAGE);', "setError('Could not load');"],
    ['spectator: Retry does not ask again', SG, '}, [roomId, reloadTick]);', '}, [roomId]);'],
    ['spectator: no Retry button', SG, 'error === SERVER_UNREACHABLE_MESSAGE ? (', 'false ? ('],
    ['spectator: Retry keeps the old error', SG, '    setError(null);\n', ''],
    ['tournament: join says another text', T, 'setError(SERVER_UNREACHABLE_MESSAGE); // pressing Join again is the retry', "setError('Could not join');"],
    ['tournament: create says another text', T, 'setError(SERVER_UNREACHABLE_MESSAGE); // choosing the time control again is the retry', "setError('Could not create');"],
    ['tournament: start says another text', T, 'setError(SERVER_UNREACHABLE_MESSAGE); // pressing Start again is the retry', "setError('Could not start');"],
    ['tournament: start keeps spinning when unreachable', T, '      setStarting(false);\n      if (result.unreachable) {', '      if (result.unreachable) {'],
    ['challenge: join says another text', CH, 'setError(SERVER_UNREACHABLE_MESSAGE); // pressing Join again is the retry', "setError('Could not join');"],
    ['challenge: create says another text', CH, 'setError(SERVER_UNREACHABLE_MESSAGE); // choosing the time control again is the retry', "setError('Could not create');"],
    // --- the tab bar ---
    ['tabs: the inactive icons use the muted grey (below 3:1 on white)', B, 'colors.textSecondary', 'colors.textMuted'],
    ['tabs: the active icon uses the secondary colour', B, 'isActive ? colors.text : colors.textSecondary', 'isActive ? colors.textSecondary : colors.textSecondary'],
  ],
};
