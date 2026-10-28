#!/usr/bin/env node
/**
 * Bughouse W3b - the TWO-FINGER browser check of the dual-board Local layout (BUGHOUSE_SPEC.md HP12), on the app's own Expo DEV web server and a real Chromium.
 *
 *   node scripts/browser/bughouse-dual-touch.mjs                       (starts its own `expo start --web` on a free port, kills it by PID at the end)
 *   BASE_URL=http://localhost:19062 node scripts/browser/bughouse-dual-touch.mjs     (uses a server you started; kills nothing)
 *
 * Settings (all optional, none secret): E2E_BROWSER_PATH (the Chromium executable, the cloud VM: /opt/pw-browsers/chromium), OUT_DIR (where the screenshots go; default
 * <tmp>/bughouse-dual-touch), VIEWPORTS ("412x915,360x740,800x360"). `playwright-core` is resolved from the sibling backend checkout (<app>/backend/node_modules, which the cloud setup and the
 * backend's browser suite already install); it is not an app dependency.
 *
 * It NEVER touches :3000, :8081, :8082 or a deployed backend: the Local game needs no server at all (the dev build's API calls are not made on this path), and a server it starts itself runs
 * on a port the OS hands out. Playwright's own `touchscreen.tap` is single-touch, so the fingers are real CDP `Input.dispatchTouchEvent` events with two `touchPoints`.
 *
 * What it checks at every viewport (412 x 915 and 360 x 740 stacked, 800 x 360 side by side) with four humans (every board on move at once, both boards pass-and-play):
 *   layout     both boards the same size, inside the window, no page overflow, nothing clipped;
 *   overlap    a touch on A and a touch on B overlapping in time: both select, a touch on one never cancels the other's selection;
 *   moves      two moves at the same moment, one per board, both commit;
 *   crossing   a touch that starts on A and ends on B is ignored on both boards;
 *   dead zone  a touch in the gutter between the boards, and one in the margin beside a board, is ignored (and clears nothing);
 *   20 taps    ten pairs of overlapping taps, alternating select / deselect on the two boards, every step checked;
 *   controls   a single finger on Rules still works after all of it (the responder system is intact), and the page logs no error from OUR code;
 *   overlay    (portrait) rotating below the minimum covers the boards, the clocks keep running, rotating back removes it.
 * Exit code 0 = every check passed. The report is printed as JSON lines; screenshots are saved to OUT_DIR.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..', '..');
const requireFromBackend = createRequire(path.join(appDir, 'backend', 'package.json'));
const { chromium } = requireFromBackend('playwright-core');

const OUT_DIR = process.env.OUT_DIR || path.join(tmpdir(), 'bughouse-dual-touch');
mkdirSync(OUT_DIR, { recursive: true });
const VIEWPORTS = (process.env.VIEWPORTS || '412x915,360x740,800x360').split(',').map((v) => {
  const [width, height] = v.split('x').map(Number);
  return { width, height };
});

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(JSON.stringify({ ok, name, ...(detail ? { detail } : {}) }));
}

// --- the dev server (its own, on a free port, killed by PID with the command line proven first) -------------------------------------------------------
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
let server = null;
async function startServer() {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  const port = await freePort();
  if ([3000, 8081, 8082].includes(port)) throw new Error(`refusing port ${port}`);
  const child = spawn('npx', ['expo', 'start', '--web', '--port', String(port)], { cwd: appDir, env: { ...process.env, CI: '1', EXPO_OFFLINE: '1', EXPO_NO_TELEMETRY: '1' }, detached: true, stdio: 'ignore' });
  server = { pid: child.pid, port };
  await waitForHttp(`http://127.0.0.1:${port}/`, 180000);
  return `http://127.0.0.1:${port}`;
}
function stopServer() {
  if (!server) return;
  // Only what this script started: the process group of the child it spawned, and only after its command line is seen to be the expo start on OUR port.
  let cmdline = '';
  try {
    cmdline = readFileSync(`/proc/${server.pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
  } catch {
    /* already gone (or not Linux): nothing to prove, nothing to kill */
  }
  if (cmdline.includes('expo') && cmdline.includes(String(server.port))) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      /* gone */
    }
  } else if (cmdline) {
    console.log(`not killing pid ${server.pid}: its command line is not ours (${cmdline.slice(0, 80)})`);
  }
}

// --- the page ------------------------------------------------------------------------------------------------------------------------------------
async function openGame(browser, baseUrl, viewport, options = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...(options.mouse ? {} : { hasTouch: true, isMobile: true }) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 160)}`);
  });
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.getByText('Play', { exact: true }).first().click({ timeout: 120000 });
  await page.locator('[aria-label="Bughouse local"]').click();
  await page.locator('[data-testid="preset-four"]').click();
  await page.locator('[data-testid="bughouse-start"]').click();
  await page.getByText('3 min', { exact: true }).first().click();
  await page.waitForSelector('[data-testid="block-A"]');
  return { context, page, errors };
}

const cdpOf = async (context, page) => context.newCDPSession(page);
const boxOf = async (page, testId) => page.locator(`[data-testid="${testId}"]`).boundingBox();
async function centre(page, testId) {
  const box = await boxOf(page, testId);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
const touch = (cdp, type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
const pt = (id, p) => ({ x: p.x, y: p.y, id });
/** How many squares of a board offer a move or a drop right now. */
const offered = (page, board) => page.locator(`[data-testid^="${board}-"][aria-label*="can move here"], [data-testid^="${board}-"][aria-label*="can drop here"]`).count();
const labelOf = async (page, testId) => (await page.locator(`[data-testid="${testId}"]`).getAttribute('aria-label')) ?? '';

async function tap(cdp, page, board, square, id = 1) {
  const p = await centre(page, `${board}-${square}`);
  await touch(cdp, 'touchStart', [pt(id, p)]);
  await touch(cdp, 'touchEnd', []);
}
/** Down on a, down on b, up a, up b. */
async function twoFingers(cdp, page, a, b) {
  const pa = await centre(page, `${a[0]}-${a[1]}`);
  const pb = await centre(page, `${b[0]}-${b[1]}`);
  await touch(cdp, 'touchStart', [pt(1, pa)]);
  await touch(cdp, 'touchStart', [pt(1, pa), pt(2, pb)]);
  await touch(cdp, 'touchEnd', [pt(1, pa)]);
  await touch(cdp, 'touchEnd', []);
}

async function scenario(browser, baseUrl, viewport) {
  const tag = `${viewport.width}x${viewport.height}`;
  const { context, page, errors } = await openGame(browser, baseUrl, viewport);
  const cdp = await cdpOf(context, page);
  const landscape = viewport.width > viewport.height;

  // layout
  const a = await boxOf(page, 'board-A');
  const b = await boxOf(page, 'board-B');
  const dims = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: window.innerWidth, ih: window.innerHeight, bodyScrollH: document.body.scrollHeight }));
  check(`${tag} layout: both boards are the same size`, Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5, `A ${a.width}x${a.height}, B ${b.width}x${b.height}`);
  check(`${tag} layout: ${landscape ? 'side by side' : 'stacked'}`, landscape ? Math.abs(a.y - b.y) < 2 && b.x > a.x : Math.abs(a.x - b.x) < 2 && b.y > a.y, `A (${a.x},${a.y}) B (${b.x},${b.y})`);
  check(`${tag} layout: the boards are fully inside the window`, a.x >= 0 && b.x + b.width <= viewport.width + 0.5 && a.y >= 0 && b.y + b.height <= viewport.height + 0.5, `window ${viewport.width}x${viewport.height}`);
  check(`${tag} layout: the cell is at least 28 px`, a.width / 8 >= 28, `${a.width / 8} px`);
  check(`${tag} layout: no horizontal page overflow`, dims.sw <= dims.iw, JSON.stringify(dims));
  const blocks = await Promise.all(['block-A', 'block-B'].map((id) => boxOf(page, id)));
  check(`${tag} layout: both blocks (bars, clocks, board, status) fit the window height`, blocks.every((bl) => bl.y >= 0 && bl.y + bl.height <= viewport.height + 0.5), blocks.map((bl) => `${Math.round(bl.y)}..${Math.round(bl.y + bl.height)}`).join(' / '));
  const controlBoxes = await Promise.all(['bughouse-rules', 'bughouse-autoflip', 'bughouse-resign-team-1', 'bughouse-resign-team-2'].map((id) => boxOf(page, id)));
  check(`${tag} layout: every control (Rules, turn, both Resign) is fully on screen, none clipped`, controlBoxes.every((c) => c && c.x >= 0 && c.x + c.width <= viewport.width + 0.5 && c.y >= 0 && c.y + c.height <= viewport.height), controlBoxes.map((c) => c && `${Math.round(c.x)}..${Math.round(c.x + c.width)}`).join(' '));
  await page.screenshot({ path: path.join(OUT_DIR, `${tag}-1-start.png`) });

  // overlapping touches: both select, neither cancels the other
  await twoFingers(cdp, page, ['A', 'e2'], ['B', 'd2']);
  const [oa, ob] = [await offered(page, 'A'), await offered(page, 'B')];
  check(`${tag} overlap: two overlapping touches select a piece on EACH board`, oa === 2 && ob === 2, `A offers ${oa}, B offers ${ob}`);
  await tap(cdp, page, 'A', 'a2', 3);
  check(`${tag} overlap: a touch on A does not clear the selection on B`, (await offered(page, 'B')) === 2, `B offers ${await offered(page, 'B')}`);
  await tap(cdp, page, 'B', 'a2', 4);
  check(`${tag} overlap: a touch on B does not clear the selection on A`, (await offered(page, 'A')) === 2, `A offers ${await offered(page, 'A')}`);
  await page.screenshot({ path: path.join(OUT_DIR, `${tag}-2-two-selections.png`) });

  // two moves at the same moment
  await twoFingers(cdp, page, ['A', 'a4'], ['B', 'a4']);
  const [pa, pb] = [await labelOf(page, 'A-a4'), await labelOf(page, 'B-a4')];
  check(`${tag} moves: two moves at the same moment (one per board) both commit`, /White pawn/.test(pa) && /White pawn/.test(pb), `${pa} | ${pb}`);

  // black to move on both boards now: a touch that starts on A and ends on B
  const before = [await offered(page, 'A'), await offered(page, 'B')];
  const from = await centre(page, 'A-e7');
  const to = await centre(page, 'B-e7');
  await touch(cdp, 'touchStart', [pt(5, from)]);
  for (let i = 1; i <= 4; i++) await touch(cdp, 'touchMove', [pt(5, { x: from.x + ((to.x - from.x) * i) / 4, y: from.y + ((to.y - from.y) * i) / 4 })]);
  await touch(cdp, 'touchEnd', []);
  check(`${tag} crossing: a touch that starts on A and ends on B is ignored on both boards`, (await offered(page, 'A')) === before[0] && (await offered(page, 'B')) === before[1], `A ${before[0]}->${await offered(page, 'A')}, B ${before[1]}->${await offered(page, 'B')}`);

  // select on A, then touch the dead zone and the margin: nothing changes
  await tap(cdp, page, 'A', 'e7', 6);
  const selectedA = await offered(page, 'A');
  const blockA = await boxOf(page, 'block-A');
  const blockB = await boxOf(page, 'block-B');
  const gutter = landscape ? { x: (blockA.x + blockA.width + blockB.x) / 2, y: a.y + a.height / 2 } : { x: a.x + a.width / 2, y: (blockA.y + blockA.height + blockB.y) / 2 };
  const gap = landscape ? blockB.x - (blockA.x + blockA.width) : blockB.y - (blockA.y + blockA.height);
  await touch(cdp, 'touchStart', [pt(7, gutter)]);
  await touch(cdp, 'touchEnd', []);
  check(`${tag} dead zone: a touch in the gutter (${gap.toFixed(0)} px wide) changes nothing`, (await offered(page, 'A')) === selectedA && selectedA > 0, `A offers ${await offered(page, 'A')}`);
  const margin = landscape ? { x: a.x - 3, y: a.y + a.height / 2 } : { x: a.x + a.width + 3, y: a.y + a.height / 2 };
  if (margin.x > 0 && margin.x < viewport.width) {
    await touch(cdp, 'touchStart', [pt(8, margin)]);
    await touch(cdp, 'touchEnd', []);
    check(`${tag} dead zone: a touch just beside the board changes nothing`, (await offered(page, 'A')) === selectedA, `A offers ${await offered(page, 'A')}`);
  }
  await tap(cdp, page, 'A', 'h4', 9); // an empty square: clears A
  check(`${tag} dead zone: an ordinary tap on an empty square still clears (the dead zone is not just "everything is ignored")`, (await offered(page, 'A')) === 0);

  // twenty taps in quick alternation (ten overlapping pairs): odd pairs pick up a pawn on each board, even pairs put it down on an empty square
  let steps = 0;
  let allOk = true;
  const files = 'abcde';
  for (let i = 0; i < 5; i++) {
    await twoFingers(cdp, page, ['A', `${files[i]}7`], ['B', `${files[i]}7`]);
    const up = (await offered(page, 'A')) === 2 && (await offered(page, 'B')) === 2;
    await twoFingers(cdp, page, ['A', 'h4'], ['B', 'h4']);
    const down = (await offered(page, 'A')) === 0 && (await offered(page, 'B')) === 0;
    steps += 4;
    allOk = allOk && up && down;
  }
  check(`${tag} 20 taps: ten overlapping pairs alternating select / deselect, every step right on both boards`, allOk && steps === 20, `${steps} taps`);

  // the responder system is intact: a single finger on a control
  await page.locator('[data-testid="bughouse-rules"]').tap();
  const sheet = await page.locator('[data-testid="bughouse-rules-sheet"]').count();
  check(`${tag} controls: a single finger on Rules still works after two-finger play`, sheet === 1);
  if (sheet === 1) await page.locator('[data-testid="bughouse-rules-close"]').tap();

  // a finished match: resign, nothing is touchable
  const ourErrors = errors.filter((e) => !/Cannot find single active touch/.test(e) && !/DevTools|favicon|textShadow|deprecated/i.test(e));
  check(`${tag} the page logged no error from our code`, ourErrors.length === 0, ourErrors.slice(0, 3).join(' || '));
  const responderNoise = errors.filter((e) => /Cannot find single active touch/.test(e)).length;
  if (responderNoise > 0) console.log(JSON.stringify({ note: `${tag}: react-native-web's own responder system logged "Cannot find single active touch" ${responderNoise} time(s) on multi-touch (a dev-only console.error, no effect on play)` }));

  if (!landscape) {
    // rotating below the minimum covers the boards; the clocks keep running; rotating back removes it
    const clocks = async () => (await Promise.all(['A-white', 'A-black', 'B-white', 'B-black'].map((k) => page.locator(`[data-testid="clock-${k}"]`).textContent()))).join(' ');
    const clockBefore = await clocks();
    await page.setViewportSize({ width: 360, height: 640 });
    await page.waitForSelector('[data-testid="rotate-overlay"]', { timeout: 5000 });
    const covering = await page.evaluate(() => {
      const cell = document.querySelector('[data-testid="A-e2"]');
      if (!cell) return 'no cell';
      const r = cell.getBoundingClientRect();
      const top = document.elementFromPoint(Math.min(r.x + r.width / 2, window.innerWidth - 1), Math.min(r.y + r.height / 2, window.innerHeight - 1));
      return top && top.closest('[data-testid="rotate-overlay"]') ? 'overlay' : top ? top.getAttribute('data-testid') || top.tagName : 'nothing';
    });
    await page.screenshot({ path: path.join(OUT_DIR, `${tag}-3-rotate-overlay.png`) });
    await page.waitForTimeout(2300);
    const clockAfter = await clocks();
    check(`${tag} overlay: below the minimum the overlay is what a finger would hit, and the clocks keep running`, covering === 'overlay' && clockBefore !== clockAfter, `hit: ${covering}; clock ${clockBefore} -> ${clockAfter}`);
    await page.setViewportSize(viewport);
    await page.waitForFunction(() => !document.querySelector('[data-testid="rotate-overlay"]'), null, { timeout: 5000 });
    check(`${tag} overlay: rotating back removes it`, (await page.locator('[data-testid="rotate-overlay"]').count()) === 0);
  }
  await page.screenshot({ path: path.join(OUT_DIR, `${tag}-4-end.png`) });
  await context.close();
}

async function mouseScenario(browser, baseUrl) {
  const { context, page } = await openGame(browser, baseUrl, { width: 412, height: 915 }, { mouse: true });
  const a = await centre(page, 'A-e2');
  await page.mouse.click(a.x, a.y);
  check('mouse (desktop): a click on a piece selects it on the dual layout', (await offered(page, 'A')) === 2);
  const b = await centre(page, 'B-d2');
  await page.mouse.click(b.x, b.y);
  check('mouse (desktop): a click on board B leaves board A selected', (await offered(page, 'A')) === 2 && (await offered(page, 'B')) === 2);
  await context.close();
}

let exitCode = 1;
try {
  const baseUrl = await startServer();
  console.log(JSON.stringify({ note: `app at ${baseUrl}`, ownServer: Boolean(server) }));
  const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || undefined, headless: true });
  try {
    for (const viewport of VIEWPORTS) await scenario(browser, baseUrl, viewport);
    await mouseScenario(browser, baseUrl);
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ summary: `${results.length - failed.length} of ${results.length} checks passed`, failed: failed.map((f) => f.name), screenshots: OUT_DIR }));
  exitCode = failed.length === 0 ? 0 : 1;
} catch (error) {
  console.error(error);
} finally {
  stopServer();
}
process.exit(exitCode);
