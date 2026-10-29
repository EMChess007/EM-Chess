// Mutation set for the sign-in on a sleeping server and the read screens' "Server is starting up…" (command #27b, branch fix/offline-states): the patient auth policy, Cancel, the one
// request in flight, the register guard, the diagnostic lines (src/api/client.ts), the screens' hook, the in-place message, and the read-screen retry plan.
//
//   MUTATION_ROOT=<this repository> node <harness>/scripts/mutation/run.cjs scripts/mutation/configs/sign-in.config.cjs        (chunks of at most 20 mutants; `--chunk N` runs one)
//
// The in-repo harness (scripts/mutation) lives on paired/bughouse until master has it; `MUTATION_ROOT` names the checkout to mutate (the harness only ever READS the root and mutates a
// copy). The suites: the policy to the millisecond with fake timers (apiAuthPolicy), the plan (serverStartup), the screens with a real local server (signInWaking.dom, 7 s holds) and
// the failed-load block (serverStarting.dom, loadFailed.dom). The 40 s / 60 s real-server run (apiAuthRealServers.test.ts) is NOT in this command: it takes minutes per run.
// A name that says EQUIVALENT cannot change behaviour; the test named in it pins why.
const C = 'src/api/client.ts';
const H = 'src/logic/useSignInRequest.ts';
const W = 'src/components/SignInWaiting.tsx';
const L = 'src/components/LoadFailed.tsx';
const P = 'src/logic/serverStartup.ts';
const LI = 'src/screens/LoginScreen.tsx';
const RE = 'src/screens/RegisterScreen.tsx';

module.exports = {
  root: process.env.MUTATION_ROOT || undefined,
  copy: ['src', 'assets', 'scripts/browser', 'App.tsx', 'package.json', 'tsconfig.json', 'vitest.config.mts'],
  junction: ['node_modules'],
  cmd:
    'npx vitest run src/logic/__tests__/apiAuthPolicy.test.ts src/logic/__tests__/serverStartup.test.ts src/logic/__tests__/apiRequestDeadline.test.ts src/screens/__tests__/serverStarting.dom.test.tsx src/screens/__tests__/signInWaking.dom.test.tsx src/screens/__tests__/loadFailed.dom.test.tsx',
  mutantTimeoutMs: 6 * 60 * 1000,
  mutants: [
    // --- the numbers ---
    ['auth: the sign-in has 30 s', C, 'export const AUTH_DEADLINE_MS = 60000;', 'export const AUTH_DEADLINE_MS = 30000;'],
    ['auth: the waking notice comes at 6 s', C, 'export const AUTH_WAKING_NOTICE_MS = 5000;', 'export const AUTH_WAKING_NOTICE_MS = 6000;'],
    ['auth: the waking notice comes at once', C, 'setTimeout(options.onWaking, AUTH_WAKING_NOTICE_MS)', 'setTimeout(options.onWaking, 0)'],
    ['auth: one try may last only 6 s', C, 'attemptMs: AUTH_DEADLINE_MS,', 'attemptMs: 6000,'],
    ['auth: one retry only', C, 'retryDelaysMs: [1000, 2000, 4000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000],', 'retryDelaysMs: [1000],'],
    ['auth: the first wait is 3 s', C, 'retryDelaysMs: [1000, 2000, 4000,', 'retryDelaysMs: [3000, 2000, 4000,'],
    ['auth: the waits stop growing at 4 s', C, '4000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000],', '4000, 4000, 4000, 4000, 4000, 4000, 4000, 4000, 4000],'],
    ['auth: a 502 is an answer', C, 'retryStatuses: [502, 503, 504],', 'retryStatuses: [503, 504],'],
    ['auth: a 503 is an answer', C, 'retryStatuses: [502, 503, 504],', 'retryStatuses: [502, 504],'],
    ['auth: a 504 is an answer', C, 'retryStatuses: [502, 503, 504],', 'retryStatuses: [502, 503],'],
    ['auth: a 500 is a failed try', C, 'retryStatuses: [502, 503, 504],', 'retryStatuses: [500, 502, 503, 504],'],
    ['auth: a 404 is a failed try', C, 'retryStatuses: [502, 503, 504],', 'retryStatuses: [404, 502, 503, 504],'],
    ['auth: no gateway status is retried', C, 'if (policy.retryStatuses?.includes(result.response.status))', 'if (false && policy.retryStatuses?.includes(result.response.status))'],
    ['auth: the sign-in uses the load policy', C, 'const policy = options.auth ? AUTH_POLICY : options.background', 'const policy = options.background'],
    ['auth: the sign-in uses the background policy', C, 'const policy = options.auth ? AUTH_POLICY : options.background ? BACKGROUND_POLICY', 'const policy = options.auth ? BACKGROUND_POLICY : options.background ? BACKGROUND_POLICY'],
    ['auth: a gateway that never recovers says another thing', C, "'The server is still starting up. Please try again in a moment.'", "'Request failed.'"],
    ['auth: the minute running out says the load text', C, "'The server did not answer in a minute. It may still be starting up - please try again.'", "'Request timed out. The server took too long to respond.'"],
    // --- the diagnostic lines ---
    ['log: no line per failed try', C, 'logEachAttempt: true,', 'logEachAttempt: false,'],
    ['log: the failed tries are not described', C, 'logAttempt?.(describeFailure(err));', ''],
    ['log: a cancel is not written down', C, '      logDiagnostic(`[api] ${method} ${hostOf(API_BASE_URL)}${path.split(\'?\')[0]} cancelled by the person,', '      void (`[api] ${method} ${hostOf(API_BASE_URL)}${path.split(\'?\')[0]} cancelled by the person,'],
    ['log: a gateway status is described as a network error', C, 'if (err instanceof GatewayStatus) return `HTTP ${err.status}`;', ''],
    // --- the waking notice ---
    ['auth: the notice timer is left running', C, '    clearTimeout(wakingTimer);', ''],
    ['auth: the notice is asked for by loads too', C, 'const wakingTimer = options.auth && options.onWaking ?', 'const wakingTimer = options.onWaking ?'],
    // --- Cancel ---
    ['cancel: the signal is not handed to the tries', C, 'options.auth ? options.signal : undefined,', 'undefined,'],
    ['cancel: the try is not aborted', C, '      controller.abort();\n      reject(new CancelledError());', '      reject(new CancelledError());'],
    ['cancel: the call does not end', C, '      reject(new CancelledError());\n    };\n    if (cancel.aborted)', '    };\n    if (cancel.aborted)'],
    ['cancel: a cancellation is retried as a failed try', C, '      if (err instanceof CancelledError) throw err;\n      lastError = err;', '      lastError = err;'],
    ['cancel: an already cancelled call still sends', C, "    if (cancel?.aborted) throw new CancelledError();\n    console.log(`[api/client]", "    console.log(`[api/client]"],
    ['cancel: the wait between tries cannot be cancelled', C, 'if (wait > 0) await pause(wait, cancel);', 'if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));'],
    ['cancel: the wait does not stop at once', C, '    const onCancel = () => {\n      clearTimeout(id);\n      reject(new CancelledError());', '    const onCancel = () => {\n      reject(new CancelledError());'],
    ['cancel: the try listener is never removed', C, "    if (cancel && onCancel) cancel.removeEventListener('abort', onCancel);\n", ''],
    ['cancel: the wait listener is never removed', C, "      cancel?.removeEventListener('abort', onCancel);\n      resolve();", '      resolve();'],
    ['cancel: the cancellation has no name', C, "    super(0, 'Cancelled.');\n    this.name = 'CancelledError';", "    super(0, 'Cancelled.');"],
    // --- one request in flight ---
    ['one: a second sign-in is not refused', C, "if (authSlot !== null) throw new ApiError(0, 'A sign-in is already in progress. Please wait for it, or cancel it first.');", ''],
    ['one: the slot is never released', C, '  const release = () => {\n    if (authSlot === slot) authSlot = null;\n  };', '  const release = () => {};'],
    ['one: the slot is not freed by Cancel itself', C, "  call?.signal?.addEventListener('abort', release, { once: true });\n", ''],
    ['one: the slot of an older sign-in is freed by a newer one', C, 'if (authSlot === slot) authSlot = null;', 'authSlot = null;'],
    ['one: the session check is not through the slot', C, "getMe: (token: string, call?: AuthCallOptions) => authRequest<AuthUser>('GET', '/users/me', undefined, token, call),", "getMe: (token: string) => request<AuthUser>('/users/me', { token }),"],
    // --- register ---
    ['register: a 409 after a lost answer is not retried as a log in', C, '(registerMayHaveCreated.has(key) || err.earlierTryFailed)', 'false'],
    ['register: only the earlier call is remembered, not the earlier try', C, '(registerMayHaveCreated.has(key) || err.earlierTryFailed)', 'registerMayHaveCreated.has(key)'],
    ['register: only the earlier try counts, not the earlier call', C, '(registerMayHaveCreated.has(key) || err.earlierTryFailed)', 'err.earlierTryFailed'],
    ['register: every 409 tries a log in', C, 'failed.earlierTryFailed = tally.tries > 1;', 'failed.earlierTryFailed = true;'],
    ['register: the first try already counts as an earlier try', C, 'failed.earlierTryFailed = tally.tries > 1;', 'failed.earlierTryFailed = tally.tries > 0;'],
    ['register: a 5xx counts as an answer', C, 'err.status >= 400 && err.status < 500;', 'err.status >= 400 && err.status <= 500;'],
    ['register: a 4xx counts as lost', C, 'err.status >= 400 && err.status < 500;', 'err.status >= 401 && err.status < 500;'],
    ['register: a 400 counts as lost', C, 'err.status >= 400 && err.status < 500;', 'err.status > 400 && err.status < 500;'],
    ['register: the guard is never set', C, 'if (!answered) registerMayHaveCreated.add(key);', 'if (false) registerMayHaveCreated.add(key);'],
    ['register: an answer does not clear the guard', C, '    else registerMayHaveCreated.delete(key);\n    throw err;', '    throw err;'],
    ['register: a success does not clear the guard', C, '    registerMayHaveCreated.delete(key);\n    return response;', '    return response;'],
    ['register: a guard log in that fails keeps the guard', C, '        registerMayHaveCreated.delete(key);\n        throw err; // not the account this person made', '        throw err; // not the account this person made'],
    ['register: a cancel during the guard log in becomes the 409', C, 'if (isCancelled(loginErr)) throw loginErr;', ''],
    ['register: the guard log in sends the username as the email', C, "'/auth/login', { email, password }, undefined, call);\n        registerMayHaveCreated.delete(key);", "'/auth/login', { email: username, password }, undefined, call);\n        registerMayHaveCreated.delete(key);"],
    ['register: the guard key ignores the username', C, 'return `${email.trim().toLowerCase()}|${username.trim().toLowerCase()}`;', 'return `${email.trim().toLowerCase()}|`;'],
    ['register: the guard key ignores the email', C, 'return `${email.trim().toLowerCase()}|${username.trim().toLowerCase()}`;', 'return `|${username.trim().toLowerCase()}`;'],
    ['register: the guard key is case sensitive', C, 'return `${email.trim().toLowerCase()}|${username.trim().toLowerCase()}`;', 'return `${email.trim()}|${username.trim().toLowerCase()}`;'],
    ['register: no line says the account was found', C, "logDiagnostic('[api] register: the account from the earlier try already exists, signed in with it instead');", ''],
    ['register: the 409 carries the new status when the sign in fails', C, '        throw err; // not the account this person made', '        throw loginErr; // not the account this person made'],
    // --- the screens' hook and message ---
    ['hook: Cancel does nothing', H, '    controllerRef.current?.abort();\n  }, []);', '  }, []);'],
    ['hook: leaving the screen does not cancel', H, '    () => {\n      controllerRef.current?.abort();\n    },', '    () => {},'],
    ['hook: the notice never shows', H, 'onWaking: () => setWaking(true)', 'onWaking: () => setWaking(false)'],
    ['hook: the notice stays after the answer', H, '      if (controllerRef.current === controller) controllerRef.current = null;\n      setWaking(false);', '      if (controllerRef.current === controller) controllerRef.current = null;'],
    ['hook: the signal is not handed on', H, '{ signal: controller.signal, onWaking', '{ onWaking'],
    ['hook: EQUIVALENT (the finally clears the notice of the run before it; pinned by signInWaking.dom: a second sign-in after a Cancel shows no stale message)', H, '    controllerRef.current = controller;\n    setWaking(false);', '    controllerRef.current = controller;'],
    ['waiting: the message is another', W, "'Waking up the server… this can take up to a minute'", "'Please wait'"],
    ['waiting: the message shows at once', W, '{waking && (', '{(\n'],
    ['waiting: no Cancel', W, '<Pressable style={styles.cancel} onPress={onCancel}', '<Pressable style={styles.cancel} onPress={() => {}}'],
    ['login: Cancel shows an error', LI, 'if (!isCancelled(e)) setError(', 'if (true) setError('],
    ['login: no Cancel while it waits', LI, '{loading && <SignInWaiting waking={signIn.waking} onCancel={signIn.cancel} />}', ''],
    ['login: the notice is never given', LI, '<SignInWaiting waking={signIn.waking}', '<SignInWaiting waking={false}'],
    ['register screen: Cancel shows an error', RE, 'if (!isCancelled(e)) setError(', 'if (true) setError('],
    ['register screen: no Cancel while it waits', RE, '{loading && <SignInWaiting waking={signIn.waking} onCancel={signIn.cancel} />}', ''],
    // --- the read screens: the plan ---
    ['plan: the minute is 2 minutes', P, 'export const AUTO_RETRY_WINDOW_MS = 60000;', 'export const AUTO_RETRY_WINDOW_MS = 120000;'],
    ['plan: the first wait is 4 s', P, '[3000, 6000, 10000, 15000]', '[4000, 6000, 10000, 15000]'],
    ['plan: the second wait is 7 s', P, '[3000, 6000, 10000, 15000]', '[3000, 7000, 10000, 15000]'],
    ['plan: the third wait is 11 s', P, '[3000, 6000, 10000, 15000]', '[3000, 6000, 11000, 15000]'],
    ['plan: the last wait is 16 s', P, '[3000, 6000, 10000, 15000]', '[3000, 6000, 10000, 16000]'],
    ['plan: a fifth try', P, '[3000, 6000, 10000, 15000]', '[3000, 6000, 10000, 15000, 15000]'],
    ['plan: a try may start AT the end of the minute', P, 'if (now - episode.firstFailureAt + delay >= AUTO_RETRY_WINDOW_MS) return null;', 'if (now - episode.firstFailureAt + delay > AUTO_RETRY_WINDOW_MS) return null;'],
    ['plan: the minute is not checked', P, 'if (now - episode.firstFailureAt + delay >= AUTO_RETRY_WINDOW_MS) return null;', ''],
    ['plan: the minute counts from now', P, 'if (now - episode.firstFailureAt + delay >= AUTO_RETRY_WINDOW_MS) return null;', 'if (now - now + delay >= AUTO_RETRY_WINDOW_MS) return null;'],
    ['plan: the minute counts from the last failure', P, 'if (now - episode.firstFailureAt + delay >= AUTO_RETRY_WINDOW_MS) return null;', 'if (now - episode.lastFailureAt + delay >= AUTO_RETRY_WINDOW_MS) return null;'],
    ['plan: tries are not limited to four', P, '  if (delay === undefined) return null;\n', '  if (delay === undefined) return 15000;\n'],
    ['plan: an episode older than a minute is continued', P, 'now - known.lastFailureAt <= AUTO_RETRY_WINDOW_MS', 'now - known.lastFailureAt <= AUTO_RETRY_WINDOW_MS * 100'],
    ['plan: an episode of exactly a minute is over', P, 'now - known.lastFailureAt <= AUTO_RETRY_WINDOW_MS', 'now - known.lastFailureAt < AUTO_RETRY_WINDOW_MS'],
    ['plan: a failure does not renew the episode', P, '    known.lastFailureAt = now;\n    return known;', '    return known;'],
    ['plan: a try is not counted', P, '  if (known) known.retries++;', ''],
    ['plan: a try is counted twice', P, '  if (known) known.retries++;', '  if (known) known.retries += 2;'],
    ['plan: Retry does not end the episode', P, '  episodes.delete(key);\n}', '}'],
    ['plan: Retry ends every episode', P, '  episodes.delete(key);\n}', '  episodes.clear();\n}'],
    // --- the failed-load block ---
    ['block: any message waits for the server', L, "message === SERVER_UNREACHABLE_MESSAGE && (online ?? isOnlineBackend())", '(online ?? isOnlineBackend())'],
    ['block: the local backend waits for the server', L, "message === SERVER_UNREACHABLE_MESSAGE && (online ?? isOnlineBackend())", 'message === SERVER_UNREACHABLE_MESSAGE'],
    ['block: the block never asks the client whether it is online', L, "(online ?? isOnlineBackend())", '(online ?? true)'],
    ['block: the episode is never noted', L, 'nextAutoRetryDelay(noteFailure(testID, now), now)', 'nextAutoRetryDelay({ firstFailureAt: now, lastFailureAt: now, retries: 0 }, now)'],
    ['block: the automatic try is not counted', L, '      noteAutoRetry(testID);\n', ''],
    ['block: the automatic try does not retry', L, '      retryRef.current();\n', ''],
    ['block: leaving does not stop the timer', L, '    return () => clearTimeout(id);', '    return undefined;'],
    ['block: Retry does not start a new minute', L, '    endEpisode(testID);\n    onRetry();', '    onRetry();'],
    ['block: Retry does nothing', L, '    endEpisode(testID);\n    onRetry();', '    endEpisode(testID);'],
    ['block: the message is always the plain one', L, 'autoDelay !== null ? STARTING_UP_MESSAGE : message', 'message'],
    ['block: the retry function is read once', L, '  retryRef.current = onRetry;', ''],
  ],
};
