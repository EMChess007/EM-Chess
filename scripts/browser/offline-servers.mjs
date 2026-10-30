import http from 'node:http';
import net from 'node:net';

/**
 * REAL local servers that fail the way a laptop that is off, firewalled or half-dead fails on a phone (offline-states branch). Plain JavaScript so that the node and rendered
 * tests (apiOfflineRealServers.test.ts, offlineScreens.dom.test.tsx) and the browser end-to-end run (offline-states-e2e.mjs) start the very same servers.
 *
 * A mock of fetch cannot model these: the retries, the connect wait, the headers wait and the body wait are exactly what made the real phone spin for 45 s, and fake timers
 * skipped all of that waiting.
 *
 *   refused           nothing listens on the port: the connection is refused at once
 *   blackhole         the TCP connection is accepted and the request is read, but the server never answers (what a firewall that drops packets looks like once connected)
 *   headersThenStall  the headers (200, JSON) arrive, then the body never does
 *   bodyStalls        the headers and HALF of the JSON arrive, then nothing
 *   nonRoutable       10.255.255.1: a packet to it is never answered (or the network says "unreachable")
 *   dns               a host name that does not resolve (RFC 6761: `.invalid` never does)
 *
 * `serving` switches a stalling server to answering normally, which is what "the server is back" means for the Retry button.
 *
 * @typedef {'refused' | 'blackhole' | 'headersThenStall' | 'bodyStalls' | 'nonRoutable' | 'dns'} FailureKind
 * @typedef {'blackhole' | 'headersThenStall' | 'bodyStalls' | 'ok'} HttpBehaviour
 * @typedef {'ok' | 'refused' | 'blackhole' | 'headersThenStall' | 'bodyStalls'} ServerMode
 * @typedef {{ origin: string, serving(): Promise<void>, close(): Promise<void> }} TestServer
 * @typedef {{ origin: string, port: number, setMode(mode: ServerMode): Promise<void>, close(): Promise<void> }} SwitchableServer
 */

/** @type {readonly FailureKind[]} */
export const FAILURE_KINDS = ['refused', 'blackhole', 'headersThenStall', 'bodyStalls', 'nonRoutable', 'dns'];

export const GAMES_BODY = [
  { id: 'g1', userId: 'u1', opponentType: 'bot', opponentElo: 1200, result: '1-0', pgn: '1. e4 e5', timeControl: '5+0', isChess960: false, playedAt: '2026-10-01T10:00:00Z' },
];
export const LEADERBOARD_BODY = { entries: [{ rank: 1, userId: 'u9', username: 'magnus', rating: 2800 }], me: null };

/** @param {string | undefined} url */
function bodyFor(url) {
  return url?.startsWith('/users/leaderboard') ? LEADERBOARD_BODY : GAMES_BODY;
}

/** A browser page on another origin needs these on every answer, the preflight included (the app's real backend sends them too). */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

/** @param {net.Server} server @param {number} [port] @returns {Promise<number>} */
function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(/** @type {net.AddressInfo} */ (server.address()).port));
  });
}

/** @param {net.Server} server @param {Set<net.Socket>} sockets @returns {() => Promise<void>} */
function closing(server, sockets) {
  return () =>
    new Promise((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    });
}

/**
 * One server on one port whose behaviour for a request can be switched from `mode` to normal.
 * @param {HttpBehaviour} mode @param {number} [port]
 * @returns {Promise<TestServer & { port: number }>}
 */
async function startHttp(mode, port = 0) {
  /** @type {HttpBehaviour} */
  let behaviour = mode;
  /** @type {Set<net.Socket>} */
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    if (behaviour === 'blackhole') return; // accepted, read, never answered
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS); // the CORS preflight of a browser: answered, so the request behind it is what stalls
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', ...CORS });
    if (behaviour === 'headersThenStall') {
      res.flushHeaders();
      return;
    }
    const json = JSON.stringify(bodyFor(req.url));
    if (behaviour === 'bodyStalls') {
      res.write(json.slice(0, Math.floor(json.length / 2)));
      return;
    }
    res.end(json);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  const actualPort = await listen(server, port);
  return {
    port: actualPort,
    origin: `http://127.0.0.1:${actualPort}`,
    serving: async () => {
      behaviour = 'ok';
      for (const socket of sockets) socket.destroy(); // the stalled requests of the failed attempt go away
    },
    close: closing(server, sockets),
  };
}

/** A port nothing listens on: bound once to learn a free port, then released. */
async function closedPort() {
  const probe = net.createServer();
  const port = await listen(probe);
  await new Promise((resolve) => probe.close(() => resolve(undefined)));
  return port;
}

/** @param {FailureKind} kind @returns {Promise<TestServer>} */
export async function startFailing(kind) {
  if (kind === 'blackhole' || kind === 'headersThenStall' || kind === 'bodyStalls') return startHttp(kind);
  if (kind === 'refused') {
    const port = await closedPort();
    /** @type {(TestServer & { port: number }) | null} */
    let revived = null;
    return {
      origin: `http://127.0.0.1:${port}`,
      // The server "starts" on the very port the client already failed against.
      serving: async () => {
        revived = await startHttp('ok', port);
      },
      close: async () => {
        await revived?.close();
      },
    };
  }
  // Addresses that never answer or never resolve: nothing to start, and nothing that can come back at that address.
  const origin = kind === 'nonRoutable' ? 'http://10.255.255.1:3000' : 'http://em-chess-no-such-host.invalid:3000';
  return { origin, serving: async () => {}, close: async () => {} };
}

/** A server that answers properly from the start. @returns {Promise<TestServer>} */
export async function startWorking() {
  return startHttp('ok');
}

/**
 * ONE address whose behaviour changes while the app is running: the laptop being switched off and on again.
 * @param {ServerMode} [initial] @param {number} [port] @returns {Promise<SwitchableServer>}
 */
export async function startSwitchable(initial = 'ok', port = 0) {
  /** @type {(TestServer & { port: number }) | null} */
  let current = null;
  let boundPort = port;
  /** @param {ServerMode} mode */
  const apply = async (mode) => {
    await current?.close();
    current = null;
    if (mode === 'refused') return;
    current = await startHttp(mode, boundPort);
    boundPort = current.port;
  };
  await apply(initial);
  if (!current) boundPort = boundPort || (await closedPort()); // started as "refused": learn a free port first, then leave it closed
  return {
    origin: `http://127.0.0.1:${boundPort}`,
    get port() {
      return boundPort;
    },
    setMode: apply,
    close: async () => {
      await current?.close();
      current = null;
    },
  };
}
