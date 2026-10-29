import http from 'node:http';
import net from 'node:net';

/**
 * REAL local servers for the sign-in tests of command #27b: a backend that is asleep (a free-tier Render service) and wakes up after a while, one that never wakes, one that answers
 * with the gateway's 503 while it boots, and one whose register creates the account but loses the answer. Plain JavaScript like offline-servers.mjs so the node tests
 * (apiAuthRealServers.test.ts) and the rendered ones (signInWaking.dom.test.tsx) start the very same servers.
 *
 * It speaks the three routes the sign-in uses and keeps what the tests need to look at: every request it saw (`requests`), the most requests ever open at the same moment
 * (`maxConcurrent`: "never more than one sign-in in flight"), the accounts it created (`accounts`), and how many requests the client closed before they were answered (`abandoned`).
 *
 * A server's behaviour is data (`AuthBehaviour`) and can be changed while it runs (`set`): "the server wakes up" is `set({ answerAfterMs: 0 })`.
 *
 * @typedef {{
 *   answerAfterMs?: number,
 *   holdEachMs?: number,
 *   neverAnswer?: boolean,
 *   gateway503ForMs?: number,
 *   registerAnswerDelayMs?: number,
 *   dropFirstRegisterAnswer?: boolean,
 * }} AuthBehaviour
 *   answerAfterMs            requests that arrive before this many ms after the server started are held, then answered together (the cold start)
 *   holdEachMs               every request is held this long after it ARRIVES, then answered (a service that is slow, whatever the time since the server started)
 *   neverAnswer              the request is read and never answered
 *   gateway503ForMs          for this many ms after start every request gets an immediate 503 with an HTML body (what a gateway says while the service boots)
 *   registerAnswerDelayMs    a register creates the account at once and answers only after this long (the answer the client will have given up waiting for)
 *   dropFirstRegisterAnswer  the first register creates the account and then the connection is destroyed without an answer (a gateway that reset the connection)
 *
 * @typedef {{ method: string, url: string, at: number, body: Record<string, unknown> | null }} SeenRequest
 * @typedef {{
 *   origin: string,
 *   port: number,
 *   requests: SeenRequest[],
 *   readonly maxConcurrent: number,
 *   readonly abandoned: number,
 *   accounts: Map<string, { email: string, username: string, password: string }>,
 *   set(next: AuthBehaviour): void,
 *   close(): Promise<void>,
 * }} AuthServer
 */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

/** @param {net.Server} server @param {number} port @returns {Promise<number>} */
function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(/** @type {net.AddressInfo} */ (server.address()).port));
  });
}

/** A port nothing listens on: bound once to learn a free port, then released. */
export async function closedPort() {
  const probe = net.createServer();
  const port = await listen(probe, 0);
  await new Promise((resolve) => probe.close(() => resolve(undefined)));
  return port;
}

/** @param {http.IncomingMessage} req @returns {Promise<Record<string, unknown> | null>} */
function readJson(req) {
  return new Promise((resolve) => {
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

/**
 * @param {AuthBehaviour} [initial] @param {number} [port] 0 = any free port
 * @returns {Promise<AuthServer>}
 */
export async function startAuthServer(initial = {}, port = 0) {
  /** @type {AuthBehaviour} */
  let behaviour = { ...initial };
  const startedAt = Date.now();
  /** @type {SeenRequest[]} */
  const requests = [];
  /** @type {Map<string, { email: string, username: string, password: string }>} */
  const accounts = new Map();
  /** @type {Set<net.Socket>} */
  const sockets = new Set();
  /** @type {Set<ReturnType<typeof setTimeout>>} */
  const timers = new Set();
  let open = 0;
  let maxConcurrent = 0;
  let abandoned = 0;
  let droppedOnce = false;

  /** @param {number} ms @param {() => void} run */
  const later = (ms, run) => {
    const id = setTimeout(() => {
      timers.delete(id);
      run();
    }, Math.max(0, ms));
    timers.add(id);
  };

  /** @param {http.ServerResponse} res @param {number} status @param {unknown} body */
  const send = (res, status, body) => {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(status, { 'content-type': 'application/json', ...CORS });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    open++;
    maxConcurrent = Math.max(maxConcurrent, open);
    let answered = false;
    const finish = () => {
      open--;
      if (!answered) abandoned++;
    };
    res.once('close', finish);
    const body = req.method === 'POST' ? await readJson(req) : null;
    requests.push({ method: req.method ?? '', url: req.url ?? '', at: Date.now() - startedAt, body });
    const url = req.url ?? '';
    const respond = () => {
      answered = true;
      route(res, url, req.method ?? '', body);
    };
    const sinceStart = Date.now() - startedAt;

    if (behaviour.gateway503ForMs !== undefined && sinceStart < behaviour.gateway503ForMs) {
      answered = true;
      res.writeHead(503, { 'content-type': 'text/html', ...CORS });
      res.end('<html><body>Service Unavailable - the service is starting</body></html>');
      return;
    }
    if (behaviour.neverAnswer) return; // read, never answered
    // asleep: nothing runs until the wake-up, then the held requests are served in the order they arrived
    if (behaviour.answerAfterMs !== undefined && sinceStart < behaviour.answerAfterMs) {
      later(behaviour.answerAfterMs - sinceStart, respond);
      return;
    }
    if (behaviour.holdEachMs !== undefined) {
      later(behaviour.holdEachMs, respond);
      return;
    }
    // register: the account exists from the moment the request arrives, whatever happens to the answer
    if (url === '/auth/register' && req.method === 'POST') {
      const created = createAccount(body);
      if (created === 'exists' || created === 'invalid') return respond();
      if (behaviour.dropFirstRegisterAnswer && !droppedOnce) {
        droppedOnce = true;
        answered = true;
        res.socket?.destroy();
        return;
      }
      if (behaviour.registerAnswerDelayMs !== undefined) {
        later(behaviour.registerAnswerDelayMs, () => {
          answered = true;
          send(res, 201, { token: `token-${created.email}`, user: publicUser(created) });
        });
        return;
      }
      answered = true;
      send(res, 201, { token: `token-${created.email}`, user: publicUser(created) });
      return;
    }
    respond();
  });

  /** @param {Record<string, unknown> | null} body */
  function createAccount(body) {
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!email || !username || password.length < 8) return /** @type {const} */ ('invalid');
    for (const account of accounts.values()) if (account.email === email || account.username === username) return /** @type {const} */ ('exists');
    const account = { email, username, password };
    accounts.set(email, account);
    return account;
  }

  /** @param {{ email: string, username: string }} account */
  function publicUser(account) {
    return { id: `user-${account.email}`, email: account.email, username: account.username, createdAt: '2026-10-01T10:00:00Z' };
  }

  /** @param {http.ServerResponse} res @param {string} url @param {string} method @param {Record<string, unknown> | null} body */
  function route(res, url, method, body) {
    if (url === '/auth/register' && method === 'POST') {
      const created = createAccount(body);
      if (created === 'invalid') return send(res, 400, { error: 'Invalid input' });
      if (created === 'exists') return send(res, 409, { error: 'Email or username already in use' });
      return send(res, 201, { token: `token-${created.email}`, user: publicUser(created) });
    }
    if (url === '/auth/login' && method === 'POST') {
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      const account = accounts.get(email) ?? (email === 'known@example.com' ? { email, username: 'known', password: 'password-1' } : undefined);
      if (!account || account.password !== body?.password) return send(res, 401, { error: 'Invalid email or password' });
      return send(res, 200, { token: `token-${account.email}`, user: publicUser(account) });
    }
    if (url === '/users/me' && method === 'GET') return send(res, 200, publicUser({ email: 'known@example.com', username: 'known' }));
    return send(res, 404, { error: 'not found' });
  }

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  const actualPort = await listen(server, port);
  return {
    origin: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    requests,
    get maxConcurrent() {
      return maxConcurrent;
    },
    get abandoned() {
      return abandoned;
    },
    accounts,
    set: (next) => {
      behaviour = { ...next };
    },
    close: () =>
      new Promise((resolve) => {
        for (const id of timers) clearTimeout(id);
        timers.clear();
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/**
 * A port that REFUSES connections until `ms` after this call, then starts a normal server on it: a laptop that is switched on while the app is already trying.
 * @param {number} ms @returns {Promise<{ origin: string, close(): Promise<void>, readonly server: AuthServer | null }>}
 */
export async function startRefusedThenServing(ms) {
  const port = await closedPort();
  /** @type {AuthServer | null} */
  let started = null;
  let closed = false;
  const id = setTimeout(async () => {
    if (!closed) started = await startAuthServer({}, port);
  }, ms);
  return {
    origin: `http://127.0.0.1:${port}`,
    get server() {
      return started;
    },
    close: async () => {
      closed = true;
      clearTimeout(id);
      await started?.close();
    },
  };
}
