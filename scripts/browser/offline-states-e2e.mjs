#!/usr/bin/env node
/**
 * Browser end-to-end for the offline states (offline-states branch): the real web build in a real Chromium, a logged-in account, and a real local server that is switched between
 * "refused", "accepts and never answers", "sends the headers and stalls", "stalls halfway through the body" and "works" while the page is open - plus a build whose backend address
 * is a non-routable one (10.255.255.1).
 *
 * For every failure it asserts, on the screens that load from the server (Home's Stats and Recent Games, the Analysis list, the leaderboard):
 *   - "Can't reach the server" with a Retry button is on screen within 8 s of the screen appearing (the wall clock is only the bound that turns a hang into a failure);
 *   - after the server is switched back to working, Retry shows the real data.
 * The measured times are printed as a table. Exit code 0 = everything held.
 *
 *   node scripts/browser/offline-states-e2e.mjs [--only refused,blackhole,...]
 *
 * It starts its OWN `expo start --web` builds (one per backend address: the address is baked into the bundle) on free ports and its OWN servers; it never touches :3000, :8081,
 * :8082 or a deployed backend, uses no real account (the session is a made-up one planted in the page's local storage), and kills only the processes it started, after checking
 * their command line. Settings: E2E_BROWSER_PATH (the Chromium executable). `playwright-core` is resolved from <app>/backend/node_modules, as the device matrix does.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSwitchable } from './offline-servers.mjs';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const playwrightCore = (() => {
  for (const base of [path.join(appDir, 'backend', 'package.json'), path.join(appDir, 'package.json')]) {
    try {
      return createRequire(base)('playwright-core');
    } catch {
      /* try the next place */
    }
  }
  throw new Error('playwright-core was not found in <app>/backend/node_modules or <app>/node_modules (npm i --no-save playwright-core)');
})();
const { chromium } = playwrightCore;

const BOUND_MS = 8000;
const BUILD_WAIT_MS = 300000;
const NON_ROUTABLE = 'http://10.255.255.1:3000';
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const SESSION = JSON.stringify({ token: 'e2e-made-up-token', user: { id: 'u1', email: 'e2e@example.invalid', username: 'e2e', createdAt: '2026-01-01T00:00:00Z' } });

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}
async function waitForHttp(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${url} did not answer within ${ms} ms`);
}

/** Starts a web build whose API address is `apiUrl`; returns { base, stop }. Only the process group it spawned is ever signalled, and only after its command line is checked. */
async function startBuild(apiUrl) {
  const port = await freePort();
  if ([3000, 8081, 8082].includes(port)) throw new Error(`refusing port ${port}`);
  const child = spawn('npx', ['expo', 'start', '--web', '--clear', '--port', String(port)], {
    cwd: appDir,
    env: { ...process.env, CI: '1', EXPO_OFFLINE: '1', EXPO_NO_TELEMETRY: '1', EXPO_PUBLIC_API_URL: apiUrl },
    detached: true,
    stdio: 'ignore',
  });
  const stop = () => {
    let cmdline = '';
    try {
      cmdline = readFileSync(`/proc/${child.pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
    } catch {
      /* already gone */
    }
    if (cmdline.includes('expo') && cmdline.includes(String(port))) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* gone */
      }
    } else if (cmdline) {
      console.log(`not killing pid ${child.pid}: its command line is not ours (${cmdline.slice(0, 80)})`);
    }
  };
  try {
    await waitForHttp(`http://127.0.0.1:${port}/`, BUILD_WAIT_MS);
  } catch (error) {
    stop();
    throw error;
  }
  return { base: `http://127.0.0.1:${port}`, stop };
}

const rows = [];
let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures++;
}

/** Waits for `locator` to be visible; returns the ms it took (or null after BOUND_MS). */
async function appearsWithin(locator) {
  const startedAt = Date.now();
  try {
    await locator.first().waitFor({ state: 'visible', timeout: BOUND_MS });
    return Date.now() - startedAt;
  } catch {
    return null;
  }
}

async function freshPage(browser, base) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  await context.addInitScript((session) => {
    try {
      localStorage.setItem('auth_session', session);
    } catch {
      /* blocked: the run fails at the first assertion */
    }
  }, SESSION);
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'load' });
  await page.getByText('Play', { exact: true }).first().waitFor({ timeout: 240000 });
  return { context, page };
}

async function scenarios(browser, base, label, server) {
  const failing = label;
  // 1. Home: Stats and Recent Games
  if (server) await server.setMode(failing);
  let { context, page } = await freshPage(browser, base);
  const started = Date.now();
  const homeMs = await appearsWithin(page.getByTestId('home-stats-failed'));
  rows.push({ label, screen: 'Home (Stats + Recent)', ms: homeMs });
  check(`${label}: Home shows "Can't reach the server" + Retry within ${BOUND_MS} ms`, homeMs !== null, homeMs === null ? 'never' : `${homeMs} ms (page ready ${Date.now() - started} ms ago)`);
  if (server && homeMs !== null) {
    await server.setMode('ok');
    await page.getByTestId('home-stats-failed-retry').click();
    const ok = await appearsWithin(page.getByText('Games Played', { exact: true }));
    check(`${label}: Retry on Home shows the games once the server is back`, ok !== null);
  }
  // 2. The Analysis list
  if (server) await server.setMode(failing);
  await page.getByText('Analysis', { exact: true }).click();
  const analysisMs = await appearsWithin(page.getByTestId('load-failed'));
  rows.push({ label, screen: 'Analysis list', ms: analysisMs });
  check(`${label}: the Analysis list shows "Can't reach the server" + Retry within ${BOUND_MS} ms`, analysisMs !== null, analysisMs === null ? 'never' : `${analysisMs} ms`);
  if (server && analysisMs !== null) {
    await server.setMode('ok');
    await page.getByTestId('load-failed-retry').click();
    const ok = await appearsWithin(page.getByText('Bot (ELO 1200)', { exact: true }));
    check(`${label}: Retry on the Analysis list shows the games once the server is back`, ok !== null);
  }
  // 3. The leaderboard (More > View Leaderboard)
  if (server) await server.setMode(failing);
  await page.getByText('More', { exact: true }).click();
  await page.getByText('View Leaderboard', { exact: true }).click();
  const boardMs = await appearsWithin(page.getByTestId('load-failed'));
  rows.push({ label, screen: 'Leaderboard', ms: boardMs });
  check(`${label}: the leaderboard shows "Can't reach the server" + Retry within ${BOUND_MS} ms`, boardMs !== null, boardMs === null ? 'never' : `${boardMs} ms`);
  if (server && boardMs !== null) {
    await server.setMode('ok');
    await page.getByTestId('load-failed-retry').click();
    const ok = await appearsWithin(page.getByText('magnus', { exact: true }));
    check(`${label}: Retry on the leaderboard shows the table once the server is back`, ok !== null);
  }
  await context.close();
}

const MODES = ['refused', 'blackhole', 'headersThenStall', 'bodyStalls'].filter((m) => !ONLY || ONLY.includes(m));
const server = await startSwitchable('ok');
let build = null;
let browser = null;
try {
  browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || undefined, args: ['--no-sandbox'] });
  if (MODES.length > 0) {
    console.log(`[e2e] build against the switchable server ${server.origin}`);
    build = await startBuild(server.origin);
    for (const mode of MODES) await scenarios(browser, build.base, mode, server);
    build.stop();
    build = null;
  }
  if (!ONLY || ONLY.includes('nonRoutable')) {
    console.log(`[e2e] build against the non-routable address ${NON_ROUTABLE}`);
    build = await startBuild(NON_ROUTABLE);
    await scenarios(browser, build.base, 'nonRoutable', null);
  }
} finally {
  await browser?.close();
  build?.stop();
  await server.close();
}

console.log('\nfailure           screen                      time to "Can\'t reach the server"');
for (const row of rows) console.log(`${row.label.padEnd(17)} ${row.screen.padEnd(27)} ${row.ms === null ? 'NEVER (> 8000 ms)' : `${row.ms} ms`}`);
console.log(failures === 0 ? '\noffline-states e2e: every screen reached its error state in time and recovered' : `\noffline-states e2e: ${failures} check(s) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
