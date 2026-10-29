#!/usr/bin/env node
/**
 * The Android device matrix (TESTING.md "Android device matrix"): every screen of the app in a real Chromium, under every combination of window size, text scale, font, display
 * zoom, theme and system-bar insets in android-matrix-def.mjs, checked for clipped text, sideways page scroll, controls cut off or overlapping, touch targets under 44 dp, board cells
 * under their minimum and content inside the system bars (android-matrix-checks.mjs). A screen the run cannot reach is a failure, not a skip.
 *
 *   node scripts/browser/android-matrix.mjs --profile mini             4 combinations, for the edit-and-rerun loop (never a gate)
 *   node scripts/browser/android-matrix.mjs --profile quick            PR profile: each axis at its extremes (about 20 combinations per screen)
 *   node scripts/browser/android-matrix.mjs --profile full             all 720 combinations per screen (the nightly; about an hour with 3 workers)
 *   node scripts/browser/android-matrix.mjs --profile sweep            every size under every system-bar profile
 *   node scripts/browser/android-matrix.mjs --self-test                the checks against a fixture with every defect on purpose (no app, no server)
 *   --screens home,game-2p     only these screens          --out DIR   where results.json, the screenshots and the contact sheets go
 *   --workers 3                parallel browser contexts   --sheets    also write the contact sheet of every screen
 *   BASE_URL=http://127.0.0.1:19071 uses a dev server you started (kills nothing); otherwise it starts its OWN `expo start --web` on a free port and kills it by PID.
 *
 * Settings (none secret): E2E_BROWSER_PATH (the Chromium executable; /opt/pw-browsers/chromium on the cloud VM). `playwright-core` is resolved from <app>/backend/node_modules.
 * It never touches :3000, :8081, :8082 or a deployed server: the screens it visits need no backend (a guest, Local games).
 *
 * Text scale, the theme and the font are set the way a phone sets them: `window.__EM_TEXT_SCALE__` (a development-build-only switch, src/logic/typography.ts), the app's own persisted
 * theme setting, and a stylesheet that replaces every font family; window size, display zoom and insets are CDP emulation (Emulation.setDeviceMetricsOverride /
 * setSafeAreaInsetsOverride) applied live. Exit code 0 = every screen reached and every check passed.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_CHECKS_SOURCE } from './android-matrix-checks.mjs';
import { comboId, CRITERIA, fullCombos, insetSweep, insetsFor, miniCombos, quickCombos, SCREEN_SIZES, viewportFor, FONTS } from './android-matrix-def.mjs';
import { allScreens } from './android-matrix-screens.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..', '..');
// playwright-core is not an app dependency: it comes from the sibling backend checkout (cloud sessions, the laptop) or, in the app's own CI, from `npm i --no-save playwright-core`.
const playwrightCore = (() => {
  for (const base of [path.join(appDir, 'backend', 'package.json'), path.join(appDir, 'package.json')]) {
    try {
      return createRequire(base)('playwright-core');
    } catch {
      /* not there: try the next place */
    }
  }
  throw new Error('playwright-core was not found in <app>/backend/node_modules or <app>/node_modules (npm i --no-save playwright-core)');
})();
const { chromium } = playwrightCore;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PROFILE = option('profile', 'quick');
const OUT_DIR = option('out', path.join(tmpdir(), 'android-matrix'));
const WORKERS = Number(option('workers', '3'));
const ONLY = option('screens', '') ? option('screens', '').split(',') : null;
mkdirSync(OUT_DIR, { recursive: true });

const NAV_VIEWPORT = { width: 412, height: 915 };
// data-matrix-exempt: a control that is small on purpose (AppPressable `compact`). A native Switch is a platform control: its row is the touch target, the 40 x 20 track is not.
const exempt = ['[data-matrix-exempt]', 'input[type="checkbox"]', '[data-testid^="thumb-"]'];

// --- servers --------------------------------------------------------------------------------------------------------------------------------------
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
  await waitForHttp(`http://127.0.0.1:${port}/`, 240000);
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

// --- the page ---------------------------------------------------------------------------------------------------------------------------------------
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 120)))));

async function applyCombo(page, cdp, combo) {
  const vp = viewportFor(combo.size, combo.zoom);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: combo.zoom, mobile: false, screenWidth: vp.width, screenHeight: vp.height });
  const insets = insetsFor(combo.insetProfile, combo.size);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
  const css = combo.font.family ? `*{font-family:${combo.font.family},sans-serif !important}` : '';
  await page.evaluate((text) => {
    let style = document.getElementById('matrix-font');
    if (!style) {
      style = document.createElement('style');
      style.id = 'matrix-font';
      document.head.appendChild(style);
    }
    style.textContent = text;
  }, css);
  await settle(page);
  return { vp, insets };
}

function checkOptions(screen, insets) {
  return { insets, minTarget: CRITERIA.minTouchTarget, minGlyphContrast: CRITERIA.minGlyphContrast, clipTolerance: CRITERIA.clipTolerance, minBoardCell: CRITERIA.minBoardCell, boardKind: screen.boardKind ?? null, exempt };
}

async function runChecks(page, screen, insets) {
  return page.evaluate(`(${PAGE_CHECKS_SOURCE})(${JSON.stringify(checkOptions(screen, insets))})`);
}

async function openContext(browser, scale, theme) {
  const context = await browser.newContext({ viewport: null, hasTouch: true, isMobile: false, deviceScaleFactor: undefined });
  await context.addInitScript(
    ({ scale, theme }) => {
      window.__EM_TEXT_SCALE__ = scale;
      try {
        localStorage.setItem('settings:colorSchemeMode', theme);
      } catch {
        /* storage blocked: the default theme is used and the run says so through the screenshot */
      }
    },
    { scale, theme },
  );
  return context;
}

async function navigate(page, cdp, baseUrl, screen) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...NAV_VIEWPORT, deviceScaleFactor: 1, mobile: false });
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.getByText('Play', { exact: true }).first().waitFor({ timeout: 240000 });
  for (const step of screen.steps) {
    if (step.text) await page.getByText(step.text, { exact: true }).nth(step.nth ?? 0).click({ timeout: 15000 });
    else if (step.label) await page.locator(`[aria-label="${step.label}"]`).first().click({ timeout: 15000 });
    else if (step.id) await page.locator(`[data-testid="${step.id}"]`).first().click({ timeout: 15000 });
    else if (step.wait) await page.waitForTimeout(step.wait);
    await page.waitForTimeout(450);
  }
}

// --- the contact sheet ----------------------------------------------------------------------------------------------------------------------------
/** The fixed set of snapshots every screen's contact sheet shows (a scale and a theme need a fresh page, so they are grouped like the combos). */
const SHEET = [
  { size: '320x568', scale: 1.0, font: 'app', zoom: 1.0, theme: 'light', insetProfile: 'gesture-cutout' },
  { size: '360x740', scale: 1.0, font: 'app', zoom: 1.0, theme: 'light', insetProfile: 'gesture-cutout' },
  { size: '412x915', scale: 1.0, font: 'app', zoom: 1.0, theme: 'dark', insetProfile: 'gesture-cutout' },
  { size: '360x740', scale: 1.3, font: 'dejavu', zoom: 1.15, theme: 'light', insetProfile: 'three-button' },
  { size: '360x640', scale: 2.0, font: 'dejavu', zoom: 1.3, theme: 'dark', insetProfile: 'three-button' },
  { size: '600x960', scale: 1.0, font: 'app', zoom: 1.0, theme: 'light', insetProfile: 'none' },
  { size: '740x360', scale: 1.0, font: 'app', zoom: 1.0, theme: 'light', insetProfile: 'gesture-cutout' },
].map((s) => ({ ...s, size: SCREEN_SIZES.find((z) => z.id === s.size), font: FONTS.find((f) => f.id === s.font) }));

function sheetHtml(title, tiles) {
  const cells = tiles
    .map((t) => `<figure><img src="data:image/png;base64,${t.png.toString('base64')}"><figcaption>${t.caption}<br><b style="color:${t.issues ? '#b00020' : '#1b7a3a'}">${t.issues ? t.issues + ' issue(s)' : 'pass'}</b></figcaption></figure>`)
    .join('');
  return `<!doctype html><meta charset="utf-8"><style>body{font:12px sans-serif;margin:8px;background:#ddd}h1{font-size:16px}div{display:flex;gap:10px;align-items:flex-start}figure{margin:0;background:#fff;padding:6px}img{display:block;max-height:560px;width:auto}figcaption{margin-top:4px;max-width:260px}</style><h1>${title}</h1><div>${cells}</div>`;
}

// --- the run ----------------------------------------------------------------------------------------------------------------------------------------
function combosFor(profile) {
  if (profile === 'full') return fullCombos();
  if (profile === 'sweep') return insetSweep();
  if (profile === 'mini') return miniCombos();
  return quickCombos();
}

function groupByPage(combos) {
  const groups = new Map();
  for (const combo of combos) {
    const key = `${combo.scale}|${combo.theme}`;
    if (!groups.has(key)) groups.set(key, { scale: combo.scale, theme: combo.theme, combos: [] });
    groups.get(key).combos.push(combo);
  }
  return [...groups.values()];
}

async function runGroup(browser, baseUrl, group, screens, record, sheets) {
  const context = await openContext(browser, group.scale, group.theme);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    for (const screen of screens) {
      try {
        await navigate(page, cdp, baseUrl, screen);
      } catch (error) {
        record({ screen: screen.id, scale: group.scale, theme: group.theme, unreachable: String(error.message).split('\n')[0] });
        continue;
      }
      for (const combo of group.combos) {
        const { insets } = await applyCombo(page, cdp, combo);
        const issues = await runChecks(page, screen, insets);
        record({ screen: screen.id, combo: comboId(combo), issues });
        if (sheets) {
          const wanted = SHEET.find((s) => s.size.id === combo.size.id && s.scale === combo.scale && s.font.id === combo.font.id && s.zoom === combo.zoom && s.theme === combo.theme && s.insetProfile === combo.insetProfile);
          if (wanted) sheets.push({ screen: screen.id, combo, issues: issues.length, png: await page.screenshot() });
        }
      }
    }
  } finally {
    await context.close();
  }
  if (pageErrors.length) record({ screen: '(page)', combo: `${group.scale}|${group.theme}`, issues: [{ kind: 'pageerror', el: '-', detail: pageErrors[0].slice(0, 200) }] });
}

async function mainRun() {
  // Screens that exist only on another branch (Bughouse, on paired/bughouse) live in android-matrix-screens-extra.mjs there; the file is optional.
  const extra = await import('./android-matrix-screens-extra.mjs').then(
    (m) => m.EXTRA_SCREENS,
    () => [],
  );
  const screens = allScreens(extra).filter((s) => !ONLY || ONLY.includes(s.id));
  const base = await startServer();
  console.log(`[matrix] ${PROFILE}: ${screens.length} screens at ${base}`);
  const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || undefined, args: ['--no-sandbox'] });
  const combos = combosFor(PROFILE);
  const groups = groupByPage(combos);
  // The contact sheets need their fixed snapshots whatever the profile: they join the groups as extra combinations.
  const sheetCombos = flag('sheets') ? SHEET.map((s) => ({ ...s, insetProfile: s.insetProfile })) : [];
  for (const sc of sheetCombos) {
    const key = `${sc.scale}|${sc.theme}`;
    let group = groups.find((g) => `${g.scale}|${g.theme}` === key);
    if (!group) {
      group = { scale: sc.scale, theme: sc.theme, combos: [] };
      groups.push(group);
    }
    if (!group.combos.some((c) => comboId(c) === comboId(sc))) group.combos.push(sc);
  }
  const results = [];
  const sheets = flag('sheets') ? [] : null;
  const record = (r) => results.push(r);
  let next = 0;
  const started = Date.now();
  const worker = async () => {
    while (next < groups.length) {
      const group = groups[next++];
      await runGroup(browser, base, group, screens, record, sheets);
      console.log(`[matrix] page group scale ${group.scale} / ${group.theme} done (${group.combos.length} combos, ${Math.round((Date.now() - started) / 1000)} s)`);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.max(1, WORKERS) }, worker));
  } finally {
    await browser.close();
    stopServer();
  }
  report(screens, results);
  if (sheets) await writeSheets(sheets);
}

function report(screens, results) {
  writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 1));
  let failedScreens = 0;
  console.log('\nscreen                      combos  failed  unreachable  kinds');
  for (const screen of screens) {
    const rows = results.filter((r) => r.screen === screen.id);
    const unreachable = rows.filter((r) => r.unreachable);
    const ran = rows.filter((r) => r.combo);
    const failed = ran.filter((r) => r.issues.length > 0);
    const kinds = {};
    for (const r of failed) for (const i of r.issues) kinds[i.kind] = (kinds[i.kind] || 0) + 1;
    if (failed.length || unreachable.length) failedScreens++;
    console.log(`${screen.id.padEnd(27)} ${String(ran.length).padStart(6)} ${String(failed.length).padStart(7)} ${String(unreachable.length).padStart(12)}  ${JSON.stringify(kinds)}`);
  }
  const pageErrors = results.filter((r) => r.screen === '(page)');
  for (const r of pageErrors) console.log(`page error in ${r.combo}: ${r.issues[0].detail}`);
  // the distinct defects, with how many combinations each hit
  const distinct = new Map();
  for (const r of results) {
    if (!r.combo) continue;
    for (const i of r.issues) {
      const key = `${r.screen} | ${i.kind} | ${i.el} | ${i.detail.replace(/\d+/g, 'N')}`;
      distinct.set(key, (distinct.get(key) || 0) + 1);
    }
  }
  const top = [...distinct.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(option('top', '60')));
  console.log(`\n${distinct.size} distinct defects (top ${top.length}):`);
  for (const [key, n] of top) console.log(`${String(n).padStart(5)}x  ${key}`);
  const total = results.filter((r) => r.combo).length;
  const bad = results.filter((r) => r.combo && r.issues.length).length + results.filter((r) => r.unreachable).length + pageErrors.length;
  console.log(`\n${total} screen x combination checks, ${bad} failed, ${failedScreens} of ${screens.length} screens affected`);
  process.exitCode = bad === 0 ? 0 : 1;
}

async function writeSheets(sheets) {
  const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || undefined, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 2200, height: 700 } });
    const byScreen = new Map();
    for (const s of sheets) {
      if (!byScreen.has(s.screen)) byScreen.set(s.screen, []);
      byScreen.get(s.screen).push(s);
    }
    mkdirSync(path.join(OUT_DIR, 'sheets'), { recursive: true });
    for (const [screen, tiles] of byScreen) {
      tiles.sort((a, b) => a.combo.size.width - b.combo.size.width || a.combo.scale - b.combo.scale);
      const html = sheetHtml(`${screen}`, tiles.map((t) => ({ png: t.png, issues: t.issues, caption: `${t.combo.size.id} dp, text x${t.combo.scale}, ${t.combo.font.id} font, zoom ${t.combo.zoom}, ${t.combo.theme}, ${t.combo.insetProfile}` })));
      await page.setContent(html);
      await page.screenshot({ path: path.join(OUT_DIR, 'sheets', `${screen}.png`), fullPage: true });
    }
    console.log(`[matrix] ${byScreen.size} contact sheets in ${path.join(OUT_DIR, 'sheets')}`);
  } finally {
    await browser.close();
  }
}

// --- self-test --------------------------------------------------------------------------------------------------------------------------------------
async function selfTest() {
  const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || undefined, args: ['--no-sandbox'] });
  let failed = 0;
  const expect = (name, ok) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
    if (!ok) failed++;
  };
  try {
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 1, mobile: false });
    // The app's page: Expo's reset gives the body `overflow: hidden`, so only a scroller inside it can bring content into view.
    const fixture = (body) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;font:14px sans-serif;overflow:hidden;height:640px">${body}</body>`;
    const run = async (body, screen = {}, insets = { top: 0, bottom: 0, left: 0, right: 0 }) => {
      await page.setContent(fixture(body));
      return page.evaluate(`(${PAGE_CHECKS_SOURCE})(${JSON.stringify(checkOptions(screen, insets))})`);
    };
    const kinds = (issues) => new Set(issues.map((i) => i.kind));

    const clean = await run('<div style="padding:8px"><div>Hello world</div><div role="button" tabindex="0" style="width:120px;height:48px">Go</div></div>');
    expect('a clean page reports nothing', clean.length === 0);
    expect('text wider than its hidden box is a clip', kinds(await run('<div style="width:40px;overflow:hidden;white-space:nowrap">A long label that does not fit</div>')).has('clip'));
    expect('an ellipsis is a clip', kinds(await run('<div style="width:60px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">A long label that does not fit</div>')).has('clip'));
    expect('a wrapped second line cut by a fixed height is a clip', kinds(await run('<div style="width:60px;height:18px;overflow:hidden">Fog of War mode</div>')).has('clip'));
    expect('text cut by an ancestor is a clip', kinds(await run('<div style="width:50px;height:30px;overflow:hidden"><div style="width:200px;white-space:nowrap">too wide for the parent</div></div>')).has('clip'));
    expect('text outside the window is a clip', kinds(await run('<div style="position:absolute;left:340px;white-space:nowrap">runs off the right edge</div>')).has('clip'));
    expect('text in a sideways scroller is NOT a clip', !kinds(await run('<div style="width:200px;overflow-x:auto"><div style="width:600px;white-space:nowrap">a long strip of chips</div></div>')).has('clip'));
    expect('text below the window with nothing to scroll is a clip', kinds(await run('<div style="position:absolute;top:700px">cut off at the bottom</div>')).has('clip'));
    expect('text far down inside a vertical scroller is NOT a clip', !kinds(await run('<div style="height:640px;overflow-y:auto"><div style="height:2000px"><div style="margin-top:1500px">reached by scrolling</div></div></div>')).has('clip'));
    expect('text scrolled out of view under a fixed bar is not an overlap', !kinds(await run('<div style="height:600px;overflow-y:auto"><div style="height:1200px"><div style="margin-top:620px">hidden below the scroller</div></div></div><div style="position:fixed;bottom:0;height:40px;width:100%">Tab bar label</div>')).has('overlap'));
    expect('the page scrolling sideways is reported', kinds(await run('<div style="width:500px;height:10px;background:#ccc"></div>')).has('page-scroll'));
    expect('a 30 x 30 control is a small target', kinds(await run('<div role="button" tabindex="0" style="width:30px;height:30px">x</div>')).has('target'));
    expect('a 44 x 44 control is fine', !kinds(await run('<div role="button" tabindex="0" style="width:44px;height:44px">x</div>')).has('target'));
    expect('a control under a modal layer is not judged', !kinds(await run('<div role="button" tabindex="0" style="position:absolute;left:10px;top:10px;width:30px;height:30px">x</div><div style="position:fixed;inset:0;background:#0006"></div>')).has('target'));
    const underModal = kinds(await run('<div role="button" tabindex="0" style="position:absolute;left:400px;top:10px;width:30px;height:30px">x</div><div aria-modal="true" style="position:fixed;inset:0;background:#000a">Rotate the device</div>'));
    expect('everything outside a window-sized modal layer is not judged, even beyond the window\'s edge', !['offscreen', 'target', 'clip', 'inset', 'overlap'].some((kind) => underModal.has(kind)));
    const underLayerInRoot = kinds(await run('<div style="position:absolute;inset:0;background:#fff"><div role="button" tabindex="0" style="position:absolute;left:400px;top:10px;width:30px;height:30px">x</div></div><div style="position:fixed;inset:0;background:#000a">Rotate the device</div>'));
    expect('the layer is the last window-sized one, not an opaque positioned app root', !['offscreen', 'target', 'clip', 'inset', 'overlap'].some((kind) => underLayerInRoot.has(kind)));
    expect('a window-sized dismiss layer under a button is not an overlap', !kinds(await run('<div role="button" tabindex="0" style="position:fixed;inset:0"></div><div role="button" tabindex="0" style="position:absolute;left:80px;top:200px;width:120px;height:48px">OK</div>')).has('overlap'));
    expect('a square cell is exempt from the target rule', !kinds(await run('<div role="button" tabindex="0" aria-label="e4, White pawn" style="width:30px;height:30px">x</div>')).has('target'));
    expect('two overlapping controls are reported', kinds(await run('<div role="button" tabindex="0" style="position:absolute;left:10px;top:10px;width:100px;height:50px">a</div><div role="button" tabindex="0" style="position:absolute;left:60px;top:20px;width:100px;height:50px">b</div>')).has('overlap'));
    expect('two overlapping pieces of text are reported', kinds(await run('<div style="position:absolute;left:10px;top:10px">Overlapping words here</div><div style="position:absolute;left:10px;top:12px">Other words here</div>')).has('overlap'));
    expect('a control below the window with nothing to scroll is cut off', kinds(await run('<div role="button" tabindex="0" style="position:fixed;top:620px;width:100px;height:48px">a</div>')).has('offscreen'));
    expect('a control below the window inside a scroller is reachable', !kinds(await run('<div style="height:640px;overflow-y:auto"><div style="height:1200px"><div role="button" tabindex="0" style="margin-top:900px;width:100px;height:48px">a</div></div></div>')).has('offscreen'));
    expect('text under the top inset is reported', kinds(await run('<div style="padding-top:10px">under the notch</div>', {}, { top: 48, bottom: 0, left: 0, right: 0 })).has('inset'));
    expect('text below the top inset is fine', !kinds(await run('<div style="padding-top:60px">below the notch</div>', {}, { top: 48, bottom: 0, left: 0, right: 0 })).has('inset'));
    expect('a control inside the bottom inset is reported', kinds(await run('<div role="button" tabindex="0" style="position:fixed;bottom:0;width:100px;height:48px">a</div>', {}, { top: 0, bottom: 24, left: 0, right: 0 })).has('inset'));
    expect('a board cell under a layer (the rotate overlay) is not judged', !kinds(await run('<div aria-label="a1" style="position:absolute;left:10px;top:10px;width:12px;height:12px">.</div><div style="position:fixed;inset:0;background:#000a"></div>', { boardKind: 'twoPlayer' })).has('board-cell'));
    expect('a board cell inside an exempt thumbnail is not judged', !kinds(await run('<div data-testid="thumb-B"><div aria-label="a1" style="width:12px;height:12px">.</div></div>', { boardKind: 'twoPlayer' })).has('board-cell'));
    expect('a board cell under its minimum is reported', kinds(await run('<div aria-label="a1" style="width:12px;height:12px">.</div>', { boardKind: 'twoPlayer' })).has('board-cell'));
    expect('a board cell at its minimum is fine', !kinds(await run('<div aria-label="a1" style="width:24px;height:24px">.</div>', { boardKind: 'twoPlayer' })).has('board-cell'));
    const glyph = (ink, background, extra = '') => `<div style="background:${background}"><div data-matrix-glyph="1" style="${extra}"><svg width="24" height="24"><path d="M2 2 L20 20" stroke="${ink}" stroke-width="2" fill="none"/></svg></div></div>`;
    expect('a black icon on the dark bar (the old Home pawn) is a contrast defect', kinds(await run(glyph('#000000', '#121212'))).has('contrast'));
    expect('a light icon on the dark bar is fine', !kinds(await run(glyph('#efe6d8', '#121212'))).has('contrast'));
    expect('a dark icon on the white bar is fine', !kinds(await run(glyph('#3a2618', '#ffffff'))).has('contrast'));
    expect('the grey that is just under 3:1 on white (#999) is a contrast defect', kinds(await run(glyph('#999999', '#ffffff'))).has('contrast'));
    expect('a good ink made faint by opacity is a contrast defect', kinds(await run(glyph('#3a2618', '#ffffff', 'opacity:0.3'))).has('contrast'));
    expect('a see-through bar falls back to the white page', kinds(await run(glyph('#f0f0f0', 'transparent'))).has('contrast'));
    expect('a text glyph marked as an icon (no drawn ink) is a contrast defect', kinds(await run('<div data-matrix-glyph="1">♟</div>')).has('contrast'));
    expect('a page with no marked icon reports no contrast defect', !kinds(await run('<div>♟</div>')).has('contrast'));
  } finally {
    await browser.close();
  }
  console.log(failed === 0 ? '\nself-test: every defect is caught, nothing is invented' : `\nself-test: ${failed} check(s) FAILED`);
  process.exitCode = failed === 0 ? 0 : 1;
}

process.on('SIGINT', () => {
  stopServer();
  process.exit(130);
});

if (flag('self-test')) await selfTest();
else await mainRun().catch((error) => {
  stopServer();
  console.error(error);
  process.exitCode = 1;
});
