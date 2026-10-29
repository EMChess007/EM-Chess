import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';

/**
 * REAL local servers that fail the way a laptop that is off, firewalled or half-dead fails on a phone (offline-states branch). Not a test file; used by the node test
 * (apiOfflineRealServers.test.ts) and the rendered one (offlineScreens.dom.test.tsx). A mock of fetch cannot model these: the retries, the connect wait, the headers wait and the
 * body wait are exactly what made the real phone spin for 45 s, and fake timers skipped all of them.
 *
 *   refused           nothing listens on the port: the connection is refused at once
 *   blackhole         the TCP connection is accepted and the request is read, but the server never answers (what a firewall that drops packets looks like once connected)
 *   headersThenStall  the headers (200, JSON) arrive, then the body never does
 *   bodyStalls        the headers and HALF of the JSON arrive, then nothing
 *   nonRoutable       10.255.255.1: a packet to it is never answered (or the network says "unreachable")
 *   dns               a host name that does not resolve (RFC 6761: `.invalid` never does)
 *
 * `serving` switches a `stalling` server to answering normally, which is what "the server is back" means for the Retry button.
 */
export type FailureKind = 'refused' | 'blackhole' | 'headersThenStall' | 'bodyStalls' | 'nonRoutable' | 'dns';

export const FAILURE_KINDS: readonly FailureKind[] = ['refused', 'blackhole', 'headersThenStall', 'bodyStalls', 'nonRoutable', 'dns'];

export interface TestServer {
  origin: string;
  /** From now on answer every request properly (the server is back). */
  serving(): Promise<void>;
  close(): Promise<void>;
}

export const GAMES_BODY = [
  { id: 'g1', userId: 'u1', opponentType: 'bot', opponentElo: 1200, result: '1-0', pgn: '1. e4 e5', timeControl: '5+0', isChess960: false, playedAt: '2026-10-01T10:00:00Z' },
];
export const LEADERBOARD_BODY = { entries: [{ rank: 1, userId: 'u9', username: 'magnus', rating: 2800 }], me: null };

function bodyFor(url: string | undefined): unknown {
  return url?.startsWith('/users/leaderboard') ? LEADERBOARD_BODY : GAMES_BODY;
}

function listen(server: net.Server, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

function closing(server: net.Server, sockets: Set<net.Socket>): () => Promise<void> {
  return () =>
    new Promise((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    });
}

type HttpBehaviour = 'blackhole' | 'headersThenStall' | 'bodyStalls' | 'ok';

/** A browser page on another origin needs these on every answer, the preflight included (the app's real backend sends them too). */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

/** One server on one port whose behaviour for a request can be switched from `mode` to normal. */
async function startHttp(mode: HttpBehaviour, port = 0): Promise<TestServer & { port: number }> {
  let behaviour: HttpBehaviour = mode;
  const sockets = new Set<net.Socket>();
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
async function closedPort(): Promise<number> {
  const probe = net.createServer();
  const port = await listen(probe);
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

export async function startFailing(kind: FailureKind): Promise<TestServer> {
  if (kind === 'blackhole' || kind === 'headersThenStall' || kind === 'bodyStalls') return startHttp(kind);
  if (kind === 'refused') {
    const port = await closedPort();
    let revived: (TestServer & { port: number }) | null = null;
    const server = {
      origin: `http://127.0.0.1:${port}`,
      // The server "starts" on the very port the client already failed against.
      serving: async () => {
        revived = await startHttp('blackhole', port);
        await revived.serving();
      },
      close: async () => {
        await revived?.close();
      },
    };
    return server;
  }
  // Addresses that never answer or never resolve: nothing to start, and nothing that can come back at that address.
  const origin = kind === 'nonRoutable' ? 'http://10.255.255.1:3000' : 'http://em-chess-no-such-host.invalid:3000';
  return { origin, serving: async () => {}, close: async () => {} };
}

/** A server that answers properly from the start. */
export async function startWorking(): Promise<TestServer> {
  return startHttp('ok');
}

/** What a switchable server can be doing: answering, or one of the four failures that need a live port (a refused connection = nothing listening). */
export type ServerMode = 'ok' | 'refused' | 'blackhole' | 'headersThenStall' | 'bodyStalls';

export interface SwitchableServer {
  /** Stays the same for the server's whole life, whatever its mode: a client built against it never has to change address. */
  origin: string;
  port: number;
  setMode(mode: ServerMode): Promise<void>;
  close(): Promise<void>;
}

/** ONE address whose behaviour changes while the app is running: the laptop being switched off and on again. */
export async function startSwitchable(initial: ServerMode = 'ok', port = 0): Promise<SwitchableServer> {
  let current: (TestServer & { port: number }) | null = null;
  let boundPort = port;
  const apply = async (mode: ServerMode) => {
    await current?.close();
    current = null;
    if (mode === 'refused') return;
    current = await startHttp(mode, boundPort);
    boundPort = current.port;
  };
  await apply(initial);
  if (!current) {
    // Started as "refused": learn a free port first, then leave it closed.
    boundPort = await closedPort();
  }
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
