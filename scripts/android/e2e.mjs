#!/usr/bin/env node
/**
 * THE ANDROID END-TO-END RUN (command #29, .github/workflows/android-e2e.yml): the app on a real Android emulator, driven with real touches, judged on its real renderer.
 *
 * Every Android-only bug of the last weeks (clipped text, touches one rank low, endless spinners, pockets over the board, piece colours) passed every check because every check ran in Chromium.
 * This run exists so the next one cannot: it is a required status check (TESTING.md section 45).
 *
 *   node scripts/android/e2e.mjs --profile small|large --phase static|online|offline --out DIR [--api http://localhost:3000] [--only id,id] [--skip-gallery] [--parts a,b] [--shard i/n] [--tag name]
 *
 *   phase static   (no backend running): every main screen, the on-device text-fit probe, the Piece gallery pixel check, real taps on the 2-player board and on both Bughouse boards
 *   phase online   (backend + the Bughouse buddy running): register, log in through the keyboard, queue for an online Bughouse game, play moves, resign, see the result
 *   phase offline  (the backend STOPPED, the account still signed in): every screen that loads data says "Can't reach the server" within 8 s and shows no spinner
 *
 * Profiles: `small` = 360 x 640 dp at font scale 1.3 (the cramped phone), `large` = the emulator's own large screen at 1.0. Failures never stop the run: every check is recorded, the run ends
 * with a list and a non-zero exit code if any failed, and every screen's screenshot and accessibility tree are saved for the artifact.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SCREENS } from '../browser/android-matrix-screens.mjs';
// Bughouse's screens live in an optional file (a branch without Bughouse has none): the run then covers the screens it has.
const EXTRA_SCREENS = await import('../browser/android-matrix-screens-extra.mjs').then((m) => m.EXTRA_SCREENS, () => []);
import { Device, PROFILES, sleep } from './lib/device.mjs';
import { Chess } from 'chess.js';
import { Beacon } from './lib/beacon.mjs';
import { PHONE_BUDGET, judgePerf, latenciesOf, scaledBudget, summarize, windowStats } from './lib/perf.mjs';
import { exitStatus, judgeHealth, labelAttempt, measureDump, measureInput } from './lib/health.mjs';
import { byClass, findNodes, visibleWords } from './lib/hierarchy.mjs';
import { boardFromScreenshot, darkSquareMeasure, startPositionMarkers, crashIssues, judgePieceCell, judgeSelection, LIGHT_SHARE_BY_THEME, lightShareOfCell, markerFromWords, narrowestLabel, orientationFromA1, parseGalleryLabel, parseTextFit, selectedSquares, squareRect, textIssues, cornerColour } from './lib/checks.mjs';
import { crop, decodePng, encodePng, shrink } from './lib/png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');

// --- arguments ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
const args = process.argv.slice(2);
const arg = (name, fallback = undefined) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const profile = PROFILES[arg('profile', '')];
const phase = arg('phase', '');
if (!profile || !['static', 'online', 'offline'].includes(phase)) {
  console.error('usage: e2e.mjs --profile small|large --phase static|online|offline --out DIR [--api URL] [--only id,id] [--skip-gallery] [--parts a,b] [--shard i/n] [--tag name]');
  process.exit(2);
}
// --parts: which checks of the static phase this run does (the workflow runs them in parallel jobs); --shard i/n: this run's share of the screens; --tag: a suffix for the output folder
const PARTS = new Set(arg('parts', 'screens,textfit,gallery,touch2p,touchbug,touchinset,perf').split(','));
const SHARD = (() => {
  const m = /^(\d+)\/(\d+)$/.exec(arg('shard', '1/1'));
  if (!m || Number(m[1]) < 1 || Number(m[1]) > Number(m[2])) {
    console.error('--shard takes i/n with 1 <= i <= n');
    process.exit(2);
  }
  return { index: Number(m[1]) - 1, count: Number(m[2]) };
})();
// --attempt 2: the second run of a slice whose first run failed on a SLOW runner (run-on-emulator.sh, scripts/android/lib/health.mjs); it writes to its own folder so the digest shows both
const ATTEMPT = Number(arg('attempt', '1')) === 2 ? 2 : 1;
const OUT = join(arg('out', 'android-e2e-out'), `${profile.id}-${phase}${arg('tag') ? `-${arg('tag')}` : ''}${ATTEMPT === 2 ? '-retry' : ''}`);
const API = arg('api', 'http://localhost:3000');
const ONLY = arg('only') ? new Set(arg('only').split(',')) : null;
mkdirSync(OUT, { recursive: true });

// --- results ------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const results = [];
const logLines = [];
const log = (message) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${message}`;
  console.log(line);
  logLines.push(line);
};
/** Records a check: `issues` is a list of problem texts; empty = pass. */
function record(name, issues, note = '') {
  const ok = issues.length === 0;
  results.push({ name, ok, issues, note });
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${note ? ` (${note})` : ''}${ok ? '' : `\n         ${issues.slice(0, 12).join('\n         ')}${issues.length > 12 ? `\n         ... and ${issues.length - 12} more` : ''}`}`);
}
/** Runs one scenario; an exception is a failed check with the tree and a screenshot saved, never the end of the run. */
async function scenario(dev, name, body) {
  const t0 = Date.now();
  try {
    await body();
  } catch (e) {
    record(name, [`exception: ${e.message}`]);
    try {
      log(`PNG64 exception-${name.replace(/\W+/g, '_')} ${encodePng(shrink(dev.screenshot(), 3)).toString('base64')}`);
    } catch {
      /* no screenshot */
    }
    await dev.snapshot(`FAILED-${name.replace(/[^\w.-]+/g, '_')}`).catch(() => {});
  }
  log(`  (${name}: ${Math.round((Date.now() - t0) / 1000)} s)`);
}

// --- navigation ------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const TABS = ['Home', 'Puzzles', 'Analysis', 'More'];
const onTabs = (nodes) => TABS.every((t) => findNodes(nodes, { text: t }).length > 0);
let relaunches = 0;

/** Back to the Home tab: the app has no Android back handling, so use its own "‹ Back" / "‹ Menu" links; a dialog or a game in progress is cleared by starting the app afresh. */
async function toHome(dev) {
  for (let i = 0; i < 6; i++) {
    // (a screen whose tree cannot be read - a game that keeps repainting - is left by starting the app afresh)
    const nodes = await dev.current().catch(() => null);
    if (nodes === null) break;
    if (onTabs(nodes) && findNodes(nodes, { id: 'button1' }).length === 0) {
      const home = findNodes(nodes, { text: 'Home' }).sort((a, b) => b.bounds.y1 - a.bounds.y1)[0];
      dev.tap(home.bounds.cx, home.bounds.cy);
      await sleep(700);
      return;
    }
    const back = nodes.filter((n) => n.text.startsWith('‹') && n.bounds).sort((a, b) => a.bounds.y1 - b.bounds.y1)[0];
    if (!back || i >= 3) break;
    dev.tap(back.bounds.cx, back.bounds.cy);
    await sleep(800);
  }
  relaunches++;
  await dev.relaunch();
  await dev.waitHome(120_000);
}

// --- the screens ------------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** Screens whose steps need a test-only web fixture or a piece theme set through the page: the Piece gallery covers every theme on the phone itself. */
/**
 * THE SCREENS OF A RUN. The job has a budget of about 25 minutes and a screen costs 20 - 60 s on the CI emulator (every screen of the accessibility tree takes several seconds, the Play menu
 * is a long scroll), so a pull-request run covers the CORE screens - every kind of screen the user named: Home, the Play menu, a setup, a time control, the 2-player, 4-player, Chaturaji and
 * Bughouse (local) games, Puzzles, Analysis, More, Diagnostics - on the small phone, and the board and tab screens on the large one. `--all` (a manual run of the workflow) adds every other
 * screen of the web matrix's lists (rules sheets, the More sub-screens, the other setups).
 */
const CORE_SCREENS = new Set(['home', 'play-menu', 'time-control', 'game-2p', 'ffa-setup', 'game-ffa', 'chaturaji-setup', 'game-chaturaji', 'puzzles', 'analysis', 'more', 'more-diagnostics', 'bughouse-setup', 'bughouse-game-single', 'bughouse-game-passplay', 'bughouse-game-dual']);
const LARGE_SCREENS = new Set(['home', 'play-menu', 'game-2p', 'ffa-setup', 'game-ffa', 'game-chaturaji', 'puzzles', 'analysis', 'more', 'more-diagnostics', 'bughouse-setup', 'bughouse-game-single', 'bughouse-game-dual']);
/** Screens that cannot be driven through the tree: the accessibility tree of the 2-player game screen lags the screen (the photograph is right), so its Options menu cannot be found; the menu's text is checked by the web matrix. */
const TREE_LAGS = new Set(['game-2p-options']);
/**
 * The two-board setups with four humans are REFUSED on a 360 x 640 dp phone, by design (W3a: "This seat setup needs a larger screen. Turn the device to landscape, or put every human on one
 * board."): the run checks that the refusal is what the small phone shows, and plays those games on the large one.
 */
const SMALL_REFUSES = new Map([['bughouse-game-dual', 'bughouse-start'], ['bughouse-game-dual-teammates', 'bughouse-start']]);
const REFUSAL_TEXT = 'This seat setup needs a larger screen';
const phoneScreens = () =>
  [...SCREENS, ...EXTRA_SCREENS]
    .filter((s) => !s.fixture && !s.pieceTheme && !s.webOnly && !TREE_LAGS.has(s.id))
    .filter((s) => (ONLY ? ONLY.has(s.id) : flag('all') || (profile.id === 'small' ? CORE_SCREENS.has(s.id) : LARGE_SCREENS.has(s.id))))
    .map((s) => {
      const stop = profile.id === 'small' ? SMALL_REFUSES.get(s.id) : undefined;
      if (!stop) return s;
      const cut = s.steps.findIndex((step) => step.id === stop);
      return { ...s, steps: s.steps.slice(0, cut), expectText: REFUSAL_TEXT, pieces: undefined, title: `${s.title} (refused on this window)` };
    })
    // `--shard 1/2`: every n-th screen of the list, so the screens of one profile can run in parallel jobs (the same order everywhere)
    .filter((_, index) => index % SHARD.count === SHARD.index);

/**
 * The web matrix finds "the second Classic" in document order; on the phone only what is on screen exists, so that is "the Classic under the heading Local". The headings of the cards on the
 * Play menu (PlayModeSelectScreen) by the order the web steps count them in.
 */
const POSITION_HEADINGS = { Classic: ['Bots', 'Local', 'Engine vs Engine'], 'Setup Chess': ['Bots', 'Local'], Local: [null, '4 Player Giveaway'] };
/**
 * Cards near the end of the Play menu: swipe to the bottom WITHOUT reading the screen between swipes (a tree costs several seconds on the CI emulator, and finding the Bughouse card
 * by looking after each swipe took a minute), then back up to the card. The bottom of the list shows Bughouse, Engine vs Engine and the Board Editor.
 */
const BLIND = { 'Bughouse local': { down: 9 }, 'Bughouse online': { down: 9 }, 'Bughouse play with a friend': { down: 9 }, 'Bughouse join with a code': { down: 9 }, 'Bughouse rules': { down: 9 }, 'bughouse-rules-link': { down: 9 }, 'Chaturaji local': { down: 9, up: 1 }, 'chaturaji-rules-link': { down: 9, up: 1 } };
function phoneStep(step) {
  const headings = step.text === undefined ? undefined : POSITION_HEADINGS[step.text];
  const positioned = step.nth !== undefined && headings?.[step.nth] ? { text: step.text, below: headings[step.nth] } : step;
  const blind = BLIND[step.label ?? step.id];
  return blind ? { ...positioned, blind } : positioned;
}

/** Every piece of the boards the app reports (the beacon: the position as a FEN, the board's rectangle in screen pixels, its orientation) as a cell to judge. */
function cellsFromBeacon(dev) {
  const cells = [];
  for (const channel of ['state-board-2p', 'state-board-A', 'state-board-B']) {
    const s = dev.beacon.get(channel);
    if (!s || !s.rect || typeof s.fen !== 'string') continue;
    const board = rectOfState(s);
    const rows = s.fen.split(' ')[0].replace(/\[.*\]/, '').split('/');
    rows.forEach((row, r) => {
      let file = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) file += Number(ch);
        else if (/[a-zA-Z]/.test(ch)) {
          const square = 'abcdefgh'[file] + (8 - r);
          const marker = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toLowerCase();
          const rr = squareRect(board, s.orientation ?? 'w', square);
          cells.push({ marker, rect: { x: rr.x, y: rr.y, w: rr.w, h: rr.h }, where: `${channel.replace('state-board-', 'board ')} ${marker} on ${square} (from the app's position)`, badge: channel !== 'state-board-2p' && marker[1] === 'k' });
          file++;
        }
      }
    });
  }
  return cells;
}

async function judgeGamePieces(dev, screen) {
  const { nodes, png } = await dev.look().catch(() => ({ nodes: [], png: dev.screenshot() })); // (a screen with live bots has no readable tree: the app's position stands in for it)
  const cells = [];
  for (const n of nodes) {
    if (!n.bounds) continue;
    // a Bughouse cell: testID "A-e2", label "e2, board A, White Pawn, ..."
    if (/^[AB]-[a-h][1-8]$/.test(n.id)) {
      const marker = markerFromWords(n.desc);
      if (marker) cells.push({ marker, rect: { x: n.bounds.x1, y: n.bounds.y1, w: n.bounds.w, h: n.bounds.h }, where: n.id, badge: marker[1] === "k" });
    }
  }
  if (cells.length === 0) {
    // the 2-player board: each piece is labelled "white king" and is 90 % of its cell, centred
    for (const n of nodes) {
      const m = /^(white|black) (pawn|knight|bishop|rook|queen|king)$/.exec(n.desc);
      if (!m || !n.bounds || n.bounds.w < 10) continue;
      const side = n.bounds.w / 0.9;
      cells.push({ marker: markerFromWords(n.desc), rect: { x: n.bounds.cx - side / 2, y: n.bounds.cy - side / 2, w: side, h: side }, where: `${n.desc} at ${n.bounds.x1},${n.bounds.y1}` });
    }
  }
  // The board is a group for the accessibility service (it takes touches), so its pieces are not in the tree: the APP says where they are (its position and the board's rectangle, the beacon)
  if (cells.length === 0) cells.push(...cellsFromBeacon(dev));
  if (cells.length === 0 && ['game-2p', 'bughouse-game-single', 'bughouse-game-passplay'].includes(screen.id)) {
    // the tree of this screen can lag the screen: read the board from the PHOTOGRAPH and judge the pieces of the start position where they stand
    const grid = boardFromScreenshot(png);
    if (grid) for (const [square, marker] of Object.entries(startPositionMarkers())) cells.push({ marker, rect: squareRect(grid, 'w', square), where: `${marker} on ${square} (board read from the photograph)` });
  }
  const issues = [];
  if (cells.length === 0) issues.push('no piece found on the screen at all');
  const seen = new Set(cells.map((c) => c.marker));
  if (screen.pieces.allKinds) for (const c of ['w', 'b']) for (const k of 'pnbrqk') if (!seen.has(c + k)) issues.push(`${c + k} is not on the screen`);
  for (const c of cells) {
    if (c.rect.x < 0 || c.rect.y < 0 || c.rect.x + c.rect.w > png.width || c.rect.y + c.rect.h > png.height) continue;
    // a cell the scroll view clips has a sliver of a box (20 x 0 px): it is not on the screen, there is nothing to judge
    if (c.rect.w < 10 || c.rect.h < 10) continue;
    const problem = judgePieceCell(png, c.rect, c.marker, null, undefined, c.badge === true);
    // a bot may have moved a piece between the tree and the photograph: an empty cell is inconclusive on a screen with live bots, a wrong colour never is
    if (problem && !(screen.pieces.liveBots && problem.includes('no piece found'))) issues.push(`${c.where}: ${problem}`);
  }
  return { issues, count: cells.length };
}

async function screens(dev) {
  for (const s of phoneScreens()) {
    await scenario(dev, `screen ${s.id}`, async () => {
      await toHome(dev);
      dev.beacon.forgetAll(); // what the boards report from here on is this screen's
      await dev.runSteps(s.steps.map(phoneStep));
      await sleep(600);
      // A screen where bots keep playing never gives uiautomator an idle UI ("could not get idle state"): its tree cannot be read, and the check says so instead of failing for it - the pieces are judged
      // from the app's own position (the beacon), the text by the on-device text-fit probe and the web matrix.
      let treeNote = '';
      const nodes = await dev.dump().catch((e) => {
        if (!s.pieces?.liveBots) throw e;
        treeNote = ' | tree not readable while bots keep playing (' + String(e.message).slice(0, 60) + ')';
        return [];
      });
      const issues = [...crashIssues(nodes), ...textIssues(nodes, dev.display).map((i) => `${i.kind}: "${i.text}" - ${i.detail}`)];
      let note = `${nodes.length} nodes${treeNote}`;
      const narrow = narrowestLabel(nodes);
      if (narrow) note += `, narrowest label "${narrow.text}" ${narrow.ratio.toFixed(2)}`;
      note += ` | on screen: ${visibleWords(nodes, 14).join(' / ')}`;
      if (s.expectText) {
        // the sentence sits under the seat rows: scroll to it
        const said = await dev.find({ startsWith: s.expectText }).then(() => true, () => false);
        if (!said) issues.push(`the screen does not say "${s.expectText}"`);
      }
      if (s.pieces && s.pieces.mode === 'bw') {
        const verdict = await judgeGamePieces(dev, s);
        issues.push(...verdict.issues);
        note += `, ${verdict.count} pieces judged`;
      }
      await dev.snapshot(`screen-${s.id}`);
      // a failed screen is also PRINTED (a third of its size, base64: `base64 -d` makes a PNG) - the log is the one place every reader of a run can reach
      if (issues.length > 0) log(`PNG64 screen-${s.id} ${encodePng(shrink(dev.screenshot(), 3)).toString('base64')}`);
      record(`screen ${s.id}`, issues, note);
    });
  }
}

// --- the text-fit probe ----------------------------------------------------------------------------------------------------------------------------------------------------------------
async function textFit(dev) {
  await scenario(dev, 'text-fit probe', async () => {
    await toHome(dev);
    await dev.runSteps([{ text: 'More' }, { text: 'Diagnostics' }, { id: 'run-text-fit-check' }]);
    let verdict = null;
    for (let i = 0; i < 10 && !verdict; i++) {
      await sleep(1000);
      const nodes = await dev.dump();
      verdict = parseTextFit(nodes.flatMap((n) => [n.text, n.desc]).filter(Boolean));
      if (!verdict) dev.scrollDown();
    }
    await dev.snapshot('text-fit');
    if (!verdict) return record('text-fit probe', ['the probe never wrote its lines to the diagnostic log']);
    const issues = [...verdict.mismatches.map((l) => l.trim())];
    if (verdict.bundledFontMissing) issues.push('the bundled font is NOT loaded on the phone');
    record('text-fit probe', issues, verdict.lines[0]?.replace('[TextFit] ', ''));
  });
}

// --- the Piece gallery ----------------------------------------------------------------------------------------------------------------------------------------------------------------
const GALLERY_THEMES = { Classic: 'default', Cburnett: 'cburnett', Merida: 'merida', 'Chess with Checkers': 'checkers' };
/** 4 themes x (24 large cells: 2 colours x 2 squares x 6 kinds, + 5 board themes x 2 squares x 12 game-size cells): a run that judged fewer did not see the whole gallery. */
const GALLERY_CELLS = 4 * (24 + 5 * 2 * 12);
const assetCache = new Map();
function themeAssets(id) {
  if (id === 'default') return null;
  if (!assetCache.has(id)) {
    const assets = {};
    for (const colour of 'wb') for (const kind of 'pnbrqk') assets[colour + kind] = decodePng(readFileSync(join(REPO, 'assets', 'pieces', id, `${colour}${kind}.png`)));
    assetCache.set(id, assets);
  }
  return assetCache.get(id);
}

function parseAnyGalleryLabel(label) {
  const game = parseGalleryLabel(label);
  if (game) return game;
  const large = /^(.+): (white|black) (pawn|knight|bishop|rook|queen|king) on a (light|dark) square$/.exec(label);
  return large ? { theme: large[1], board: 'active', marker: markerFromWords(`${large[2]} ${large[3]}`), square: large[4] } : null;
}

async function gallery(dev) {
  await scenario(dev, 'piece gallery pixels', async () => {
    await toHome(dev);
    await dev.runSteps([{ text: 'More' }, { text: 'Diagnostics' }, { id: 'open-piece-gallery' }]);
    await sleep(1500);
    const judged = new Set();
    const issues = [];
    const perTheme = {};
    const failuresBy = {};
    const lightByTheme = {};
    let stuck = 0;
    for (let page = 0; page < 120 && stuck < 3; page++) {
      const { nodes, png } = await dev.look();
      const viewport = nodes.filter((n) => n.scrollable && n.bounds).sort((a, b) => b.bounds.h * b.bounds.w - a.bounds.h * a.bounds.w)[0]?.bounds ?? { y1: 0, y2: png.height, x1: 0, x2: png.width };
      let fresh = 0;
      for (const n of nodes) {
        if (!n.desc || !n.bounds) continue;
        const parsed = parseAnyGalleryLabel(n.desc);
        if (!parsed) continue;
        const b = n.bounds;
        // only a cell that is wholly on screen: a cell the scroll view clips has a short box (the tree reports the visible part), and every cell is square
        if (b.y1 < viewport.y1 || b.y2 > viewport.y2 || b.x1 < 0 || b.x2 > png.width || Math.abs(b.w - b.h) > 2) continue;
        if (judged.has(n.desc)) continue;
        judged.add(n.desc);
        fresh++;
        const id = GALLERY_THEMES[parsed.theme];
        if (id === undefined) {
          issues.push(`unknown piece theme "${parsed.theme}" in the gallery`);
          continue;
        }
        const problem = judgePieceCell(png, { x: b.x1, y: b.y1, w: b.w, h: b.h }, parsed.marker, themeAssets(id), LIGHT_SHARE_BY_THEME[id]);
        // the light share of every black cell is recorded (the first run of a new judge is read from these numbers): worst per theme, printed at the end of the gallery
        if (parsed.marker[0] === 'b') {
          const measured = lightShareOfCell(png, { x: b.x1, y: b.y1, w: b.w, h: b.h });
          lightByTheme[id] = Math.max(lightByTheme[id] ?? 0, measured);
        }
        perTheme[id] = (perTheme[id] ?? 0) + 1;
        if (problem) {
          issues.push(`${n.desc}: ${problem}`);
          const group = `${id} ${parsed.marker[0] === 'w' ? 'white' : 'black'} on ${parsed.square}`;
          failuresBy[group] = (failuresBy[group] ?? 0) + 1;
          // the first failure of each group is printed as a PNG (the log is the only way out of the runner): decode with `base64 -d`
          if (failuresBy[group] === 1) log(`PNG64 ${n.desc} ${encodePng(crop(png, { x: b.x1, y: b.y1, w: b.w, h: b.h })).toString('base64')}`);
        }
      }
      if (page % 8 === 0) await dev.snapshot(`gallery-${page}`);
      stuck = fresh === 0 ? stuck + 1 : 0;
      // about 55 % of the viewport per page, slowly: pages overlap, and a cell the first page clipped at its edge is whole in the next
      const span = viewport.y2 - viewport.y1;
      dev.swipe(dev.display.w / 2, viewport.y1 + span * 0.8, dev.display.w / 2, viewport.y1 + span * 0.25, 900);
      await sleep(500);
    }
    // (the measured numbers are kept in the log whatever the verdict: a judge is calibrated against them - TESTING.md section 45)
    log(`gallery: the largest light share of a BLACK piece per theme, as photographed: ${JSON.stringify(Object.fromEntries(Object.entries(lightByTheme).map(([k, v]) => [k, Number(v.toFixed(3))])))} (limits ${JSON.stringify(LIGHT_SHARE_BY_THEME)})`);
    if (judged.size < GALLERY_CELLS) issues.push(`only ${judged.size} of ${GALLERY_CELLS} gallery cells were seen and judged`);
    if (Object.keys(failuresBy).length > 0) issues.unshift(`failed cells by group: ${JSON.stringify(failuresBy)}`);
    record('piece gallery pixels', issues, `${judged.size} cells judged: ${JSON.stringify(perTheme)}; largest light share of a black piece per theme ${JSON.stringify(Object.fromEntries(Object.entries(lightByTheme).map(([k, v]) => [k, Number(v.toFixed(3))])))} against the limits ${JSON.stringify(LIGHT_SHARE_BY_THEME)}`);
  });
}

// --- touches ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
async function boardNode(dev, id) {
  const nodes = await dev.waitFor(`the board ${id}`, (list) => list.some((n) => (n.id === id || n.desc === id) && n.bounds && n.bounds.w > 50), 30_000);
  const node = nodes.find((n) => (n.id === id || n.desc === id) && n.bounds && n.bounds.w > 50);
  return node.bounds;
}

/** A board's rectangle as the beacon reports it (screen pixels, `measureInWindow` x the density) in the shape the judges take. */
function rectOfState(state) {
  const { x, y, w, h } = state.rect;
  return { x1: x, y1: y, x2: x + w, y2: y + h, w, h, cx: Math.round(x + w / 2), cy: Math.round(y + h / 2) };
}

/** The piece on a square of a FEN ("P", "n", ... or null). */
function pieceOnSquare(fen, square) {
  const rows = fen.split(' ')[0].split('/');
  const row = rows[8 - Number(square[1])];
  let col = 0;
  for (const ch of row) {
    if (/\d/.test(ch)) col += Number(ch);
    else {
      if (col === square.charCodeAt(0) - 97) return ch;
      col++;
    }
  }
  return null;
}

/** Waits (bounded) for the board's channel to say `selected` is `target`; returns the state it said it in, or null. */
const waitSelected = (dev, channel, target, ms) => dev.beacon.waitFor(channel, (s) => s.selected === target, ms);

/**
 * Real touches at the computed middle of squares of the 2-player board: each must leave exactly that square selected (the bug of command #26 was a tap one rank low). The app SAYS what it
 * selected (the beacon: `selected` of `state-board-2p`) and the photograph shows it; the two must agree.
 *
 * The first run (command #29) found that the board took not one of seven `adb input tap`s. Each square is therefore touched first with `input tap` (down and up in the same millisecond) and,
 * when the app does not answer, again with a touch that LASTS 90 ms (`input swipe x y x y 90`, what a finger does), and the app's gesture counters (grant / release / tap, `gestures-board`)
 * say what reached it: nothing at all (the touch never arrived), a grant without a release, or a tap that resolved to another cell. The verdict is in the note of the check; the check fails when
 * even the lasting touch is not understood. A lasting touch is what the rest of the run uses on this board.
 */
async function touches2p(dev) {
  await scenario(dev, 'touch: 2-player board', async () => {
    await toHome(dev);
    dev.beacon.forget('state-board-2p');
    await dev.runSteps([{ text: 'Play' }, { text: 'Classic', below: 'Local' }, { text: '5 min' }]);
    const issues = [];
    let state = await dev.beacon.waitFor('state-board-2p', (s) => s.rect && s.rect.w > 50, 40_000);
    let board = null;
    let source = 'beacon';
    let rectNote = '';
    if (state) board = rectOfState(state);
    else {
      // no rectangle from the app (a build without the beacon, or a rectangle that never arrived): the tree, then the photograph
      source = 'tree';
      try {
        board = await boardNode(dev, 'chess-board');
      } catch {
        const found = boardFromScreenshot(dev.screenshot());
        if (found) {
          board = found;
          source = 'photograph';
        } else throw new Error(`the 2-player board is not reported by the app, nor in the tree, nor in the photograph (dark squares: ${JSON.stringify(darkSquareMeasure(dev.screenshot()))})`);
      }
      // the app may have reported the position and the selection without a rectangle (the rectangle is only the geometry): the touches are then still judged by what the app says
      const reportedState = dev.beacon.get('state-board-2p');
      if (reportedState === null) issues.push('the app reported no state for the board (no beacon): the board was found without it');
      else {
        log(`the app's state for the 2-player board came without a rectangle: ${JSON.stringify(reportedState)}; the board was found in the ${source}`);
        state = reportedState;
        rectNote = ' (the app reported no rectangle)';
      }
    }
    if (Math.abs(board.w - board.h) > 2) issues.push(`the board is not square: ${board.w}x${board.h}`);
    const orientation = () => dev.beacon.get('state-board-2p')?.orientation ?? 'w';
    const counters = () => ({ grant: 0, tap: 0, release: 0, arrow: 0, highlight: 0, ignore: 0, terminate: 0, ...(dev.beacon.get('gestures-board') ?? {}) });
    const verdicts = { tap: 0, press: 0, neither: 0 };
    const notes = [];
    for (const target of ['e2', 'b1', 'g1', 'a2', 'h2', 'd1', 'a1', 'h1', 'c2', 'f2']) {
      const r = squareRect(board, orientation(), target);
      const before = counters();
      let worked = null;
      for (const method of ['tap', 'press']) {
        if (method === 'tap') dev.tap(r.cx, r.cy);
        else dev.press(r.cx, r.cy, 90);
        if (state && (await waitSelected(dev, 'state-board-2p', target, 1800))) {
          worked = method;
          break;
        }
        if (!state) {
          await sleep(450);
          if (!judgeSelection(dev.screenshot(), board, orientation(), target)) {
            worked = method;
            break;
          }
        }
      }
      const after = counters();
      const delta = Object.fromEntries(Object.keys(after).map((k) => [k, after[k] - before[k]]).filter(([, v]) => v !== 0));
      verdicts[worked ?? 'neither']++;
      if (worked !== 'tap') notes.push(`${target}: ${worked === null ? 'NOT selected by tap or press' : 'only the lasting touch worked'}; the app saw ${JSON.stringify(delta)}, last release ${JSON.stringify(dev.beacon.get('gestures-board')?.lastRelease ?? null)}`);
      if (worked === null) {
        issues.push(`touched ${target} (tap, then a 90 ms press): the app selected ${JSON.stringify(dev.beacon.get('state-board-2p')?.selected ?? null)}; its gesture counters moved by ${JSON.stringify(delta)}`);
        continue;
      }
      // the app says it is selected: the photograph must show the same square (the cell the app draws and the cell computed from the rectangle agree)
      await sleep(350);
      const problem = judgeSelection(dev.screenshot(), board, orientation(), target);
      if (problem) issues.push(`${problem} (the app said ${target} is selected)`);
      dev.press(r.cx, r.cy, 90); // the same square again clears the selection
      if (state) await dev.beacon.waitFor('state-board-2p', (s) => s.selected === null, 1800);
      else await sleep(350);
    }
    // a whole move: e2 then e4 (lasting touches); the app's position must have the pawn on e4 and Black to move, and both squares carry the last-move highlight
    const e2 = squareRect(board, orientation(), 'e2');
    dev.press(e2.cx, e2.cy, 90);
    if (state) await waitSelected(dev, 'state-board-2p', 'e2', 2500);
    else await sleep(400);
    const e4 = squareRect(board, orientation(), 'e4');
    dev.press(e4.cx, e4.cy, 90);
    let moved = null;
    if (state) {
      moved = await dev.beacon.waitFor('state-board-2p', (s) => pieceOnSquare(s.fen, 'e4') === 'P' && s.turn === 'b', 4000);
      if (!moved) issues.push(`after e2 then e4 the app's position is "${dev.beacon.get('state-board-2p')?.fen}", not a pawn on e4 with Black to move`);
    }
    await sleep(900);
    let after = dev.screenshot();
    let colour = (rect) => cornerColour(after, rect);
    const yellow = (c) => c && Math.abs(c[0] - 0xf7) < 16 && Math.abs(c[1] - 0xec) < 16 && Math.abs(c[2] - 0x74) < 24;
    const lastMoveShown = (o) => yellow(colour(squareRect(board, o, 'e2'))) && yellow(colour(squareRect(board, o, 'e4')));
    // Command #30 saw, on the EMULATOR only, the ORIGIN square of the last move drawn yellow and the DESTINATION not, although the app's own state says lastMove = e2, e4. Command #32: on the
    // real phone (Blackview Fort 200, Android 36) BOTH squares are highlighted, so it is not an app bug and is no longer reported as a finding; it stays UNPROVEN as an emulator artefact
    // (TESTING.md section 48: the photograph can precede the repaint of the destination square on the software renderer). The check therefore fails only when the app's state is wrong or
    // NEITHER square is drawn - the app's state is what it judges, the phone is what proves the drawing.
    const originShown = (o) => yellow(colour(squareRect(board, o, 'e2')));
    // The piece slides for a moment (and the emulator is slow): look again for up to 4 s before calling the highlight missing, and say how long it took.
    let waitedMs = 0;
    while (!lastMoveShown('w') && !lastMoveShown('b') && waitedMs < 3000) {
      await sleep(500);
      waitedMs += 500;
      after = dev.screenshot();
      colour = (rect) => cornerColour(after, rect);
    }
    if (waitedMs > 0) log(`2-player last-move highlight: ${lastMoveShown('w') || lastMoveShown('b') ? 'shown' : 'NOT shown'} after ${900 + waitedMs} ms`);
    const appLastMove = dev.beacon.get('state-board-2p')?.lastMove;
    const destinationMissing = !lastMoveShown('w') && !lastMoveShown('b') && (originShown('w') || originShown('b'));
    if (destinationMissing) log('emulator rendering note (not an app finding, the phone shows both squares): the origin e2 is drawn yellow and the destination e4 is not yet (the app says lastMove ' + JSON.stringify(appLastMove) + ')');
    if (!lastMoveShown('w') && !lastMoveShown('b') && !(destinationMissing && JSON.stringify(appLastMove) === '["e2","e4"]')) {
      const hex = (c) => (c ? `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}` : 'none');
      const seen = ['w', 'b'].map((o) => `${o}: e2 ${hex(colour(squareRect(board, o, 'e2')))} e4 ${hex(colour(squareRect(board, o, 'e4')))}`).join('; ');
      issues.push(`after e2-e4 the last-move highlight (#f7ec74) is not on e2 and e4: corner colours ${seen}; the app says lastMove ${JSON.stringify(dev.beacon.get('state-board-2p')?.lastMove ?? null)}, orientation ${orientation()}, selected now: ${selectedSquares(after, board, 'w').join(',') || 'none'}`);
    }
    await dev.snapshot('touch-2p');
    // the finding about the tap, kept in the log whatever the verdict
    log(`2-player board touches: ${JSON.stringify(verdicts)} (tap = input tap worked, press = only the 90 ms touch worked, neither = not selected at all)`);
    for (const n of notes) log(`  ${n}`);
    record('touch: 2-player board', issues, `board ${board.w}x${board.h} px at ${board.x1},${board.y1} (from the ${source}${rectNote});${JSON.stringify(verdicts)}${destinationMissing ? ' - emulator rendering note: the destination highlight was not drawn (the phone draws both)' : ''}${verdicts.press > 0 ? ' - input tap alone was not understood' : ''}`);
  });
}

/**
 * FINGER-DRAWN ARROWS on the 2-player board (command #32), straight after the e2-e4 of the touch check: Black is to move, and two arrows are drawn - one from a Black piece, one from a White
 * piece (ANY turn, several at once) - by a finger held and dragged (`drawArrow`). The app reports the number of arrows on the board (beacon `arrows`): 2 after the drawing, the position and the
 * selection unchanged (drawing never moves or selects), and 0 after a move is played (e7-e5) - the arrows stay until a move.
 */
async function arrows2p(dev) {
  const name = 'touch: 2-player arrows';
  await scenario(dev, name, async () => {
    const issues = [];
    const state0 = await dev.beacon.waitFor('state-board-2p', (s) => s.rect && s.rect.w > 50 && s.turn === 'b', 8000);
    if (!state0) return record(name, ['the 2-player board is not at the position after e2-e4 (the touch check before it did not leave it there)']);
    await sleep(2500); // the strip of moves appeared with the first move and the board moved down: wait for its last rectangle
    const latest = dev.beacon.get('state-board-2p');
    const board = rectOfState(latest);
    const o = latest.orientation ?? 'w';
    const at = (square) => squareRect(board, o, square);
    const draw = (from, to) => dev.drawArrow(at(from).cx, at(from).cy, at(to).cx, at(to).cy);
    const fen = latest.fen;
    draw('b8', 'c6'); // Black's idea, on Black's own turn
    draw('g1', 'f3'); // White's idea, on the opponent's turn: ANY turn
    const two = await dev.beacon.waitFor('state-board-2p', (s) => s.arrows === 2, 6000);
    const after = dev.beacon.get('state-board-2p');
    if (!two) issues.push(`two arrows were drawn by held-and-dragged fingers: the app counts ${after?.arrows ?? 'none'}`);
    if (after?.fen !== fen) issues.push(`drawing arrows changed the position: "${fen}" -> "${after?.fen}"`);
    if (after?.selected) issues.push(`drawing arrows selected ${after.selected}`);
    if (two) {
      // a move clears them (and the move still works after drawing): e7 then e5
      dev.press(at('e7').cx, at('e7').cy, 90);
      await waitSelected(dev, 'state-board-2p', 'e7', 2500);
      dev.press(at('e5').cx, at('e5').cy, 90);
      const cleared = await dev.beacon.waitFor('state-board-2p', (s) => s.arrows === 0 && s.fen !== fen, 5000);
      if (!cleared) issues.push(`after the move e7-e5 the arrows were not cleared (arrows ${dev.beacon.get('state-board-2p')?.arrows}, position "${dev.beacon.get('state-board-2p')?.fen}")`);
    }
    await dev.snapshot('touch-2p-arrows');
    record(name, issues, `arrows ${after?.arrows ?? 'none'} after two drawings, cleared by a move: ${issues.length === 0}`);
  });
}

/** Both Bughouse boards: a touch at the computed middle of e2 on EACH board must select it there, the app must say the same, and the other board's selection must stay. */
async function touchesBughouse(dev, inset = false) {
  const name = inset ? 'touch: Bughouse boards (status bar inset)' : 'touch: Bughouse boards';
  await scenario(dev, name, async () => {
    // four humans on two boards need more than a 360 x 640 dp window (the setup refuses them, checked by the screens above): the two-board touches run on the large phone
    if (profile.id === 'small') return record(name, [], 'skipped on the small phone: the two-board setup is refused there by design');
    // THE PHONE'S FRAME (command #30): the emulator is edge-to-edge, so the window frame and the app's root frame coincide and the reverted fix of #26 (a touch origin read in the window
    // frame) still passed. With the inset the APK runs with its root view BELOW the status bar, like the phone that showed the bug, and the app itself reports the offset (checked below).
    if (inset) {
      await dev.setFitSystemWindows(true);
      await dev.waitHome(180_000);
    }
    try {
      await touchesBughouseBody(dev, name, inset);
    } finally {
      if (inset) await dev.setFitSystemWindows(false);
    }
  });
}

async function touchesBughouseBody(dev, name, inset) {
  {
    await toHome(dev);
    dev.beacon.forget('state-board-A');
    dev.beacon.forget('state-board-B');
    await dev.runSteps([{ text: 'Play' }, { label: 'Bughouse local' }, { id: 'preset-four' }, { id: 'bughouse-start' }, { text: '3 min' }]);
    const issues = [];
    const states = {};
    const boards = {};
    for (const b of ['A', 'B']) {
      states[b] = await dev.beacon.waitFor(`state-board-${b}`, (s) => s.rect && s.rect.w > 50, 40_000);
      if (states[b]) boards[b] = rectOfState(states[b]);
      else {
        boards[b] = await boardNode(dev, `board-${b}`);
        issues.push(`board ${b}: the app reported no state (no beacon): found in the tree`);
      }
    }
    // the layout of a game screen settles for a few seconds after the first report (the boards can shrink when the bars arrive): touch only boards that have been quiet, at their last rectangle
    if (states.A && states.B) {
      const quiet = await dev.beacon.settled(['state-board-A', 'state-board-B']);
      if (!quiet) log('the boards were still reporting a new rectangle 30 s after the game started: touching at the last one');
    }
    const orientation = {};
    for (const b of ['A', 'B']) orientation[b] = dev.beacon.get(`state-board-${b}`)?.orientation ?? 'w';
    const picked = {};
    for (const b of ['A', 'B']) {
      const latest = dev.beacon.get(`state-board-${b}`);
      if (states[b] && latest?.rect?.w > 50) boards[b] = rectOfState(latest);
      // the square of a pawn that may move now: e2 for White to move, e7 for Black (the app's own fen says who is to move)
      const fen = dev.beacon.get(`state-board-${b}`)?.fen ?? '';
      const square = fen.split(' ')[1] === 'b' ? 'e7' : 'e2';
      picked[b] = square;
      const r = squareRect(boards[b], orientation[b], square);
      dev.press(r.cx, r.cy, 90);
      if (states[b]) {
        const said = await waitSelected(dev, `state-board-${b}`, square, 2500);
        if (!said) issues.push(`board ${b}: touched ${square}, the app selected ${JSON.stringify(dev.beacon.get(`state-board-${b}`)?.selected ?? null)}`);
      } else await sleep(600);
      const problem = judgeSelection(dev.screenshot(), boards[b], orientation[b], square);
      if (problem) issues.push(`board ${b}: ${problem}`);
    }
    // both selections are alive together, in the app and on the screen
    const png = dev.screenshot();
    for (const b of ['A', 'B']) {
      const now = selectedSquares(png, boards[b], orientation[b]);
      if (now.length !== 1 || now[0] !== picked[b]) issues.push(`board ${b}: with both boards touched the selection is ${now.join(',') || 'empty'}, expected ${picked[b]}`);
      const said = dev.beacon.get(`state-board-${b}`)?.selected;
      if (states[b] && said !== picked[b]) issues.push(`board ${b}: with both boards touched the app says ${JSON.stringify(said ?? null)} is selected, expected ${picked[b]}`);
    }
    // FINGER-DRAWN ARROWS on the two Bughouse boards (command #32; edge-to-edge run only): a held-and-dragged finger draws an arrow on a board on ANY turn, the arrows are per board, drawing
    // changes no selection and no position, and a move on a board clears THAT board's arrows only. Board B gets one arrow, board A two; then a move is played on A (its picked pawn goes two
    // squares): A must report 0 arrows, B still 1 and still its selection.
    if (!inset && states.A && states.B) {
      const latest = (b) => dev.beacon.get(`state-board-${b}`);
      for (const b of ['A', 'B']) if (latest(b)?.rect?.w > 50) boards[b] = rectOfState(latest(b));
      const rect = (b, square) => squareRect(boards[b], orientation[b], square);
      const drawOn = (b, from, to) => dev.drawArrow(rect(b, from).cx, rect(b, from).cy, rect(b, to).cx, rect(b, to).cy);
      const white = (b) => latest(b)?.fen?.split(' ')[1] !== 'b';
      const pair = (b, n) => (white(b) ? [['g1', 'f3'], ['b1', 'c3']] : [['g8', 'f6'], ['b8', 'c6']])[n];
      const fenA = latest('A')?.fen;
      const fenB = latest('B')?.fen;
      drawOn('B', ...pair('B', 0));
      drawOn('A', ...pair('A', 0));
      drawOn('A', ...pair('A', 1));
      const drawn = await dev.beacon.waitFor('state-board-A', (s) => s.arrows === 2, 8000);
      const drawnB = await dev.beacon.waitFor('state-board-B', (s) => s.arrows === 1, 4000);
      if (!drawn || !drawnB) issues.push(`arrows: two were drawn on board A and one on board B, the app counts A ${latest('A')?.arrows ?? 'none'} and B ${latest('B')?.arrows ?? 'none'}`);
      for (const b of ['A', 'B']) if (latest(b)?.selected !== picked[b]) issues.push(`board ${b}: drawing arrows changed the selection ${picked[b]} -> ${JSON.stringify(latest(b)?.selected ?? null)}`);
      if (latest('A')?.fen !== fenA || latest('B')?.fen !== fenB) issues.push('drawing arrows changed a position');
      if (drawn && drawnB) {
        // the move: the picked pawn of A two squares forward (e2-e4 or e7-e5)
        const target = white('A') ? 'e4' : 'e5';
        dev.press(rect('A', target).cx, rect('A', target).cy, 90);
        const cleared = await dev.beacon.waitFor('state-board-A', (s) => s.arrows === 0 && s.fen !== fenA, 5000);
        if (!cleared) issues.push(`arrows: after a move on board A its arrows were not cleared (A ${latest('A')?.arrows}, position "${latest('A')?.fen}")`);
        else if (latest('B')?.arrows !== 1) issues.push(`arrows: a move on board A changed board B's arrows (${latest('B')?.arrows}, expected 1)`);
      }
    }
    // the frame the run was in: the app's root view in the window (0 = edge-to-edge). With the inset it must be a status bar's height, or the run is not in the phone's frame at all.
    const offsets = Object.fromEntries(['A', 'B'].map((b) => [b, dev.beacon.get(`state-board-${b}`)?.rect?.rootOffsetY ?? null]));
    if (inset) {
      // (one board's report is enough: the second board's `measure` has come back as NaN on this emulator, the first one's is exact)
      const best = Math.max(...Object.values(offsets).map((v) => (typeof v === 'number' ? v : -1)));
      if (!(best >= 24)) issues.push(`the app's root view is ${best} px below the window's top: the run is NOT in the phone's frame (the inset did not take effect)`);
    }
    await dev.snapshot(inset ? 'touch-bughouse-inset' : 'touch-bughouse');
    // what each board's touch layer SAW (the app's counters): touches that never arrived, or arrived and resolved to another cell
    const layer = Object.fromEntries(['A', 'B'].map((b) => {
      const g = dev.beacon.get(`gestures-touch-${b}`) ?? {};
      return [b, { start: g.startEvent ?? 0, end: g.endEvent ?? 0, tapCell: g.tapCell ?? 0, tapDead: g.tapDead ?? 0, lastEvent: g.lastEvent ?? null, lastTap: g.lastTap ?? null }];
    }));
    if (issues.length > 0) issues.unshift(`touch layer: ${JSON.stringify(layer)}`);
    record(name, issues, `${inset ? 'root view below the status bar' : 'edge-to-edge'}: root offset ${JSON.stringify(offsets)} px; orientations ${JSON.stringify(orientation)}, picked ${JSON.stringify(picked)}, rectangles ${JSON.stringify(Object.fromEntries(Object.entries(boards).map(([k, v]) => [k, `${v.w}x${v.h} at ${v.x1},${v.y1}`])))}`);
  }
}

// --- performance (command #33) -------------------------------------------------------------------------------------------------------------------------------------------------------
/** The next report of the app's performance probe (src/dev/e2ePerf.ts; every 500 ms), at least 300 ms after `after`'s. */
const nextPerf = (dev, after = null) => dev.beacon.waitFor('perf', (s) => after === null || s.now > after.now + 300, 10_000);

/**
 * THE PERFORMANCE BUDGET (command #33, TESTING.md section 49; scripts/android/lib/perf.mjs has the numbers and the arithmetic). The phone lagged and no check could say so. This plays a real
 * game against a bot (Kiddo, White, 3 min) and a local Bughouse game with four humans (both clocks running) and reads from the app's own stopwatch how long each input took to reach the
 * drawn frame, and how late the JavaScript thread ran: a tap that selects, a tap that moves, the bot's reply, a Bughouse tap; a held-and-dragged arrow; six idle seconds of each game
 * (the clocks only). The run FAILS when a 95th percentile or the longest gap is over the budget scaled by the runner's health - labelled RUNNER or APP like every other failure.
 */
async function perf(dev) {
  const name = 'performance: taps, bot reply, arrows, Bughouse clocks';
  await scenario(dev, name, async () => {
    const samples = { select: [], move: [], botReply: [], bugTap: [] };
    const windows = [];
    const notes = [];
    const pushSamples = (report, from) => {
      for (const kind of Object.keys(samples)) samples[kind].push(...latenciesOf(report, kind, from).map((l) => l.frameMs));
    };

    // ---- 2-player against a bot -----------------------------------------------------------------------------------------------------------------------------------------------------
    await toHome(dev);
    dev.beacon.forget('state-board-2p');
    dev.beacon.forget('perf');
    await dev.runSteps([{ text: 'Play' }, { text: 'Classic', nth: 0 }, { text: 'Kiddo' }, { text: 'White' }, { text: '3 min' }]);
    const first = await dev.beacon.waitFor('state-board-2p', (s) => s.rect && s.rect.w > 50, 40_000);
    if (!first) throw new Error('the 2-player board against the bot reported no state');
    await dev.beacon.settled(['state-board-2p'], 3000, 20_000);
    const start2p = await nextPerf(dev);
    if (!start2p) throw new Error('the app sent no performance report: the probe is not in this build (EXPO_PUBLIC_E2E)');
    const game = (state) => new Chess(state.fen);
    for (let ply = 0; ply < 8; ply++) {
      const state = await dev.beacon.waitFor('state-board-2p', (s) => s.fen.split(' ')[1] === 'w' && s.rect && s.rect.w > 50, 30_000);
      if (!state) {
        notes.push(`the bot did not answer in 30 s before ply ${ply + 1}`);
        break;
      }
      const moves = game(state).moves({ verbose: true }).filter((m) => m.piece !== 'k' && !m.promotion);
      if (moves.length === 0) break;
      const move = moves[(ply * 5) % moves.length];
      const board = rectOfState(state);
      const o = state.orientation ?? 'w';
      const from = squareRect(board, o, move.from);
      dev.press(from.cx, from.cy, 90);
      if (!(await waitSelected(dev, 'state-board-2p', move.from, 4000))) {
        notes.push(`ply ${ply + 1}: touching ${move.from} did not select it`);
        continue;
      }
      const to = squareRect(board, o, move.to);
      dev.press(to.cx, to.cy, 90);
      await dev.beacon.waitFor('state-board-2p', (s) => s.fen !== state.fen, 4000);
    }
    // the bot's last reply, then a held-and-dragged arrow three times (the gesture that waits 400 ms: it must not freeze the thread), then six idle seconds
    const settled = await dev.beacon.waitFor('state-board-2p', (s) => s.fen.split(' ')[1] === 'w' && s.rect && s.rect.w > 50, 30_000);
    if (settled) {
      const board = rectOfState(settled);
      const o = settled.orientation ?? 'w';
      const at = (sq) => squareRect(board, o, sq);
      const a0 = await nextPerf(dev);
      dev.drawArrow(at('g1').cx, at('g1').cy, at('f3').cx, at('f3').cy);
      dev.drawArrow(at('b1').cx, at('b1').cy, at('c3').cx, at('c3').cy);
      dev.drawArrow(at('d2').cx, at('d2').cy, at('d4').cx, at('d4').cy);
      const a1 = await nextPerf(dev, a0);
      if (a0 && a1) windows.push({ name: '2-player: three drawn arrows', stats: windowStats(a0, a1) });
      const i0 = await nextPerf(dev, a1);
      await sleep(6000);
      const i1 = await nextPerf(dev, i0);
      if (i0 && i1) windows.push({ name: '2-player: six idle seconds (clocks running)', idle: true, stats: windowStats(i0, i1) });
    }
    const end2p = await nextPerf(dev);
    if (end2p) pushSamples(end2p, start2p.now);

    // ---- Bughouse, four humans, both clocks running -----------------------------------------------------------------------------------------------------------------------------------
    // (the small phone refuses four humans on two boards by design: this part needs the large one)
    if (profile.id === 'small') {
      notes.push('Bughouse part skipped on the small phone (it refuses four humans on two boards)');
    } else {
      await toHome(dev);
      dev.beacon.forget('state-board-A');
      dev.beacon.forget('state-board-B');
      await dev.runSteps([{ text: 'Play' }, { label: 'Bughouse local' }, { id: 'preset-four' }, { id: 'bughouse-start' }, { text: '3 min' }]);
      const states = {};
      for (const b of ['A', 'B']) states[b] = await dev.beacon.waitFor(`state-board-${b}`, (s) => s.rect && s.rect.w > 50, 40_000);
      if (!states.A || !states.B) throw new Error('the Bughouse boards reported no state');
      await dev.beacon.settled(['state-board-A', 'state-board-B']);
      const b0 = await nextPerf(dev);
      await sleep(8000);
      const b1 = await nextPerf(dev, b0);
      if (b0 && b1) windows.push({ name: 'Bughouse (4 humans): eight idle seconds, both clocks running', idle: true, stats: windowStats(b0, b1) });
      const plies = ['e2e4', 'e7e5', 'g1f3', 'b8c6'];
      const t0 = await nextPerf(dev, b1);
      for (const b of ['A', 'B']) {
        for (const ply of plies) {
          const latest = dev.beacon.get(`state-board-${b}`);
          const board = rectOfState(latest);
          const o = latest.orientation ?? 'w';
          const from = squareRect(board, o, ply.slice(0, 2));
          dev.press(from.cx, from.cy, 90);
          if (!(await waitSelected(dev, `state-board-${b}`, ply.slice(0, 2), 4000))) {
            notes.push(`board ${b}: touching ${ply.slice(0, 2)} did not select it`);
            continue;
          }
          const to = squareRect(board, o, ply.slice(2));
          dev.press(to.cx, to.cy, 90);
          await dev.beacon.waitFor(`state-board-${b}`, (s) => s.selected === null && s.fen !== latest.fen, 4000);
        }
      }
      const t1 = await nextPerf(dev, t0);
      if (t0 && t1) {
        windows.push({ name: 'Bughouse (4 humans): sixteen taps on the two boards', stats: windowStats(t0, t1) });
        pushSamples(t1, t0.now);
      }
    }

    const budget = scaledBudget(health);
    const issues = judgePerf({ samples, windows }, budget, profile.id === 'small' ? { select: 4, move: 4, botReply: 3, bugTap: 0 } : undefined);
    const line = (label, values) => `${label}: ${summarize(values)}`;
    const numbers = [line('select', samples.select), line('move', samples.move), line('botReply', samples.botReply), line('bugTap', samples.bugTap), ...windows.map((w) => `${w.name}: wall ${w.stats.wallMs} ms, thread ${Math.round(w.stats.busyShare * 100)} % late, longest gap ${w.stats.maxStallMs} ms, gaps>=100 ${w.stats.stalls100}, >=250 ${w.stats.stalls250}`)];
    log(`performance (frame times to the drawn picture; budget scaled x${(budget.selectP95Ms / PHONE_BUDGET.selectP95Ms).toFixed(1)} = select ${budget.selectP95Ms} / move ${budget.moveP95Ms} / bot ${budget.botReplyP95Ms} / bug ${budget.bugTapP95Ms} ms, gap ${budget.stallMs} ms):`);
    for (const n of numbers) log(`  ${n}`);
    for (const n of notes) log(`  note: ${n}`);
    writeFileSync(join(OUT, 'perf.json'), JSON.stringify({ budget, samples, windows, notes }, null, 1));
    await dev.snapshot('perf');
    const found = [...issues, ...notes.filter((n) => /did not select|did not answer/.test(n)).map((n) => `input: ${n}`)];
    // (the digest prints a passing check's note and a failing check's issues: a failure carries the numbers too, so one short log has everything the budget was judged on)
    if (found.length > 0) found.push(`numbers: ${numbers.join(' | ')}`);
    record(name, found, numbers.join(' | '));
  });
}

// --- online --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
async function register() {
  const tag = randomBytes(4).toString('hex');
  const account = { email: `e2e-${profile.id}-${tag}@example.test`, username: `e2e${profile.id}${tag}`, password: `Pw${randomBytes(6).toString('hex')}` };
  const res = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(account) });
  if (res.status !== 201) throw new Error(`register answered ${res.status}`);
  return account;
}

async function login(dev, account) {
  await dev.clearData();
  dev.launch();
  await dev.waitHome(180_000);
  await dev.runSteps([{ text: 'More' }, { text: 'Log in / Sign up' }]);
  const nodes = await dev.waitFor('the login form', (list) => byClass(list, 'EditText').length >= 2, 20_000);
  const [email, password] = byClass(nodes, 'EditText');
  dev.tap(email.bounds.cx, email.bounds.cy);
  await sleep(300);
  dev.type(account.email);
  dev.tap(password.bounds.cx, password.bounds.cy);
  await sleep(300);
  dev.type(account.password);
  await sleep(300);
  // The soft keyboard may cover the button, and the Back key would leave the app (it did, in the first run that reached this point): the form scrolls, so the button is scrolled up
  // above the keyboard (the top 55 % of the window) and tapped there. The lowest "Log In" is the button, the other is the title.
  let button = null;
  for (let i = 0; i < 5 && button === null; i++) {
    const candidates = findNodes(await dev.dump(), { text: 'Log In' }).sort((a, b) => b.bounds.y1 - a.bounds.y1);
    if (candidates.length >= 2) button = candidates[0];
    else dev.swipe(dev.display.w / 2, dev.display.h * 0.5, dev.display.w / 2, dev.display.h * 0.2, 500);
    await sleep(500);
  }
  if (button === null) throw new Error('the Log In button is not reachable above the keyboard');
  dev.tap(button.bounds.cx, button.bounds.cy);
  await dev.waitFor('the signed-in More screen', (list) => onTabs(list) && findNodes(list, { text: 'Log out' }).length + findNodes(list, { text: 'Log Out' }).length + findNodes(list, { text: 'Logout' }).length > 0, 40_000);
}

async function online(dev) {
  let account;
  await scenario(dev, 'online: sign in through the keyboard', async () => {
    account = await register();
    await login(dev, account);
    await dev.snapshot('online-signed-in');
    record('online: sign in through the keyboard', []);
  });
  if (!account) return null;

  // The two first buddies play a game of their own (backend.sh): it is in the Spectate list under "Bughouse"; the phone watches it, can touch nothing, and leaves.
  await scenario(dev, 'online: spectate a Bughouse game', async () => {
    // (the buddies' game is random play between bots: it can END between the list and the tap - the screen then says "The game was not found or has already ended" (a run of command #33 saw it):
    // that is a game that is gone, not an app finding, so the list is opened again, up to three times)
    let row = null;
    let reported = null;
    for (let spectateTry = 0; spectateTry < 3 && reported === null; spectateTry++) {
    await toHome(dev);
    await dev.runSteps([{ text: 'Play' }, { text: 'Spectate a live game ›' }]);
    row = null;
    for (let attempt = 0; attempt < 14 && row === null; attempt++) {
      const nodes = await dev.waitFor('the Spectate list', (list) => list.some((n) => n.text === 'Refresh' || n.text.startsWith('No games')), 20_000);
      row = nodes.find((n) => n.id.startsWith('spectate-bughouse-') && n.bounds) ?? null;
      if (row === null) {
        const refresh = findNodes(nodes, { text: 'Refresh' })[0];
        await sleep(6000); // the buddies' game starts after the 30 s fill wait
        if (refresh) dev.tap(refresh.bounds.cx, refresh.bounds.cy);
        await sleep(1500);
      }
    }
    if (row === null) return record('online: spectate a Bughouse game', ['no Bughouse game in the Spectate list after 80 s']);
    await dev.snapshot('spectate-list');
    dev.beacon.forget('state-board-A');
    dev.tap(row.bounds.cx, row.bounds.cy);
    // The board is read from the app's own report (the beacon: its rectangle in screen pixels), then the PHOTOGRAPH confirms it: the board must be on it (a "rotate the device" layer would dim
    // it, and the board's exact square colours would not be found), a tap on it selects nothing - the app says so too - and the Resign control and the team bar are not drawn.
    reported = await dev.beacon.waitFor('state-board-A', (s) => s.rect && s.rect.w > 50, 40_000);
    if (reported === null) {
      const shown = await dev.dump().catch(() => []);
      if (!shown.some((n) => /not found or has already ended/.test(n.text))) break; // some other reason: judged below
      log(`the watched game had already ended when it was opened (try ${spectateTry + 1} of 3): looking for another`);
    }
    }
    let board = reported ? rectOfState(reported) : null;
    for (let i = 0; i < 20 && board === null; i++) {
      await sleep(2000);
      board = boardFromScreenshot(dev.screenshot());
    }
    const issues = [];
    if (!reported) issues.push('the spectator screen reported no board state (no beacon)');
    if (board === null) issues.push('the spectator screen never showed a board (dimmed by a layer, or not opened)');
    else {
      const spectatorOrientation = reported?.orientation ?? 'w';
      for (const square of ['e2', 'e7', 'd2', 'd7']) {
        const r = squareRect(board, spectatorOrientation, square);
        dev.press(r.cx, r.cy, 90);
        await sleep(350);
      }
      await sleep(500);
      const spectatorSelected = dev.beacon.get('state-board-A')?.selected;
      if (reported && spectatorSelected) issues.push(`a spectator's touch made the app select ${spectatorSelected}`);
      const after = dev.screenshot();
      if (selectedSquares(after, board, 'w').length > 0) issues.push(`a spectator's tap selected ${selectedSquares(after, board, 'w').join(',')}`);
    }
    await dev.snapshot('spectator');
    log(`PNG64 spectator ${encodePng(shrink(dev.screenshot(), 3)).toString('base64')}`);
    record('online: spectate a Bughouse game', issues, board ? `board ${board.w}x${board.h} px read from the photograph` : 'no board');
  });

  await scenario(dev, 'online: Bughouse game', async () => {
    dev.dumpAttempts = 8; // a live game screen is "not idle" for seconds at a time: read it patiently (restored below, whatever happens)
    dev.dumpGapMs = 1500;
    try {
      const progress = { issues: [] };
      try {
        await onlineGame(dev, account, progress);
      } catch (e) {
        // an exception hides what the check had already found: say it first
        if (progress.issues.length > 0) e.message = `already found: ${progress.issues.join(' ; ').slice(0, 900)} || ${e.message}`;
        throw e;
      }
    } finally {
      dev.dumpAttempts = undefined;
      dev.dumpGapMs = undefined;
    }
  });
  await friendRoom(dev);
  return account;
}

/**
 * BUGHOUSE FRIEND ROOM (command #32, W6), the host's side on the phone against the run's own backend: Play > Bughouse > Play with a friend > 5 min opens a room (a 6-character code, the friend
 * slot waiting, the countdown); a FRIEND (a second logged-in account, `backend.sh friend <code>`, a socket.io client that joins the room) enters and the slot says so; "Start with bots" starts
 * the match with the two bots on the other team, and the game screen's boards appear (the app's own report). The text checks run on the room screen in both states.
 */
async function friendRoom(dev) {
  const name = 'online: friend room';
  await scenario(dev, name, async () => {
    await toHome(dev);
    dev.beacon.forgetAll();
    const issues = [];
    await dev.runSteps([{ text: 'Play' }, { label: 'Bughouse play with a friend' }, { text: '5 min' }]);
    const created = await dev.waitFor('the room code', (list) => list.some((n) => n.id === 'bughouse-room-code' && /^[A-HJKMNP-Z2-9]{6}$/.test(n.text)), 40_000, 1200);
    const code = created.find((n) => n.id === 'bughouse-room-code').text;
    issues.push(...crashIssues(created), ...textIssues(created, dev.display).map((i) => `${i.kind}: "${i.text}" - ${i.detail}`));
    const slot = (list, id) => list.find((n) => n.id === id)?.text ?? '';
    if (slot(created, 'bughouse-room-slot-2') !== 'Friend: waiting') issues.push(`the free friend slot reads "${slot(created, 'bughouse-room-slot-2')}", not "Friend: waiting"`);
    if (!created.some((n) => n.id === 'bughouse-room-countdown' && /The code works for \d+:\d\d/.test(n.text))) issues.push('no countdown of the code\'s life on the room screen');
    await dev.snapshot('friend-room-waiting');
    execFileSync('bash', ['scripts/android/backend.sh', 'friend', code], { stdio: 'inherit' });
    const joined = await dev.waitFor('the friend in the room', (list) => /^Friend: friend/.test(slot(list, 'bughouse-room-slot-2')), 40_000, 1500);
    issues.push(...textIssues(joined, dev.display).map((i) => `${i.kind}: "${i.text}" - ${i.detail}`));
    await dev.snapshot('friend-room-joined');
    const bots = joined.find((n) => n.id === 'bughouse-room-bots' && n.bounds);
    if (!bots) issues.push('no "Start with bots" button once the friend is in');
    else {
      dev.beacon.forget('state-board-A');
      dev.beacon.forget('state-board-B');
      dev.tap(bots.bounds.cx, bots.bounds.cy);
      const game = await dev.beacon.waitFor('state-board-B', (s) => typeof s.fen === 'string', 60_000);
      if (!game) issues.push('Start with bots: the game screen did not appear (no board reported within 60 s)');
    }
    record(name, issues, `the room code was read from the screen and given to the friend buddy; the match started with bots`);
  });
}

async function onlineGame(dev, account, progress = { issues: [] }) {
  {
    await toHome(dev);
    dev.beacon.forgetAll(); // (the spectated game above also had boards: what arrives from here on is this game's)
    execFileSync('bash', ['scripts/android/backend.sh', 'buddy'], { stdio: 'inherit' }); // the phone's own opponent: one human + one buddy
    await dev.runSteps([{ text: 'Play' }, { label: 'Bughouse online' }, { text: '5 min' }]);
    // (the buddy is already waiting: the match can start before the first tree after the tap is read, so a game screen is as good an answer as the queue screen)
    const queued = await dev.waitFor('the queue screen or the game', (list) => list.some((n) => n.id === 'bughouse-queue' || n.id.startsWith('bughouse-queue-') || n.id === 'board-A' || n.id === 'bughouse-online-intro'), 30_000);
    const onQueue = queued.some((n) => n.id === 'bughouse-queue' || n.id.startsWith('bughouse-queue-'));
    await dev.snapshot(onQueue ? 'online-queue' : 'online-queue-skipped');
    const queueIssues = [...crashIssues(queued), ...textIssues(queued, dev.display).map((i) => `${i.kind}: "${i.text}" - ${i.detail}`)];
    record('online: queue screen', queueIssues, onQueue ? '' : 'the match had already started when the screen was read (the buddy was waiting): the text checks ran on the game screen');
    // the buddy (a second human) is already queued: bots fill the other seats after the fill timer
    // (the match starts when the app's boards say so; the tree then gives the seat line)
    const started = await dev.beacon.waitFor('state-board-B', (s) => typeof s.fen === 'string', 150_000);
    const game = await dev.waitFor('the match to start', (list) => list.some((n) => n.id === 'board-A') && list.some((n) => n.id === 'board-B'), started ? 60_000 : 150_000, 1500);
    await sleep(1500);
    const intro = (await dev.dump()).find((n) => n.id === 'bughouse-online-intro')?.text ?? '';
    const seat = /Board ([AB]) · (White|Black) · Team (\d)/.exec(intro);
    const issues = progress.issues;
    issues.push(...crashIssues(game));
    if (!seat) {
      issues.push(`no seat line ("You: Board A · White · Team 1 ...") on the screen: "${intro}"`);
      return record('online: Bughouse game', issues);
    }
    const [, board, colour] = seat;
    // the boards' rectangles and positions come from the app (the beacon); the tree is the fallback
    const myChannel = `state-board-${board}`;
    const mine = await dev.beacon.waitFor(myChannel, (s) => s.rect && s.rect.w > 50, 30_000);
    const boards = {};
    for (const b of ['A', 'B']) {
      const s = b === board ? mine : await dev.beacon.waitFor(`state-board-${b}`, (st) => st.rect && st.rect.w > 50, 15_000);
      boards[b] = s ? rectOfState(s) : await boardNode(dev, `board-${b}`);
    }
    if (!mine) issues.push('the app reported no state for my board (no beacon)');
    const orientation = mine?.orientation ?? (colour === 'White' ? 'w' : 'b');
    const myTurn = colour === 'White' ? 'w' : 'b';
    const plan = colour === 'White' ? [['e2', 'e4'], ['d2', 'd4'], ['g1', 'f3']] : [['e7', 'e5'], ['d7', 'd5'], ['g8', 'f6']];
    let moves = 0;
    let premoveSeen = false;
    for (const [index, [from, to]] of plan.entries()) {
      // the SECOND move is made as a PREMOVE: right after the first one, while the opponent is to move (W5). If the opponent has already answered, it is just an ordinary move.
      const premoving = index === 1;
      if (!premoving) {
        // the app's own position says whose move it is (the side to move of the FEN of my board)
        const turn = await dev.beacon.waitFor(myChannel, (s) => s.fen.split(' ')[1] === myTurn, 90_000);
        if (!turn) {
          issues.push(`never my turn on board ${board}: the app's position stayed "${dev.beacon.get(myChannel)?.fen}"`);
          break;
        }
      }
      const f = squareRect(boards[board], orientation, from);
      const t = squareRect(boards[board], orientation, to);
      dev.press(f.cx, f.cy, 90);
      if (!(await waitSelected(dev, myChannel, from, 2500))) issues.push(`touched ${from}: the app selected ${JSON.stringify(dev.beacon.get(myChannel)?.selected ?? null)}`);
      dev.press(t.cx, t.cy, 90);
      if (premoving) {
        await sleep(500);
        const marked = await dev.dump().then((list) => list.find((n) => n.id === `${board}-${to}`)?.desc ?? '', () => '');
        premoveSeen = marked.includes('premove to');
      }
      // the server decides: the piece appears on `to` when its snapshot arrives (the app's position shows it)
      const shown = await dev.beacon.waitFor(myChannel, (s) => ['P', 'N', 'p', 'n'].includes(pieceOnSquare(s.fen, to) ?? ''), 12_000);
      if (shown) moves++;
      else if (premoving) log(`the premove ${from}-${to} did not execute (the opponent's move may have made it illegal or cancelled it): not a failure`);
      else issues.push(`my move ${from}-${to} never showed: the app's position is "${dev.beacon.get(myChannel)?.fen}"`);
    }
    await dev.snapshot('online-game');
    if (moves === 0) issues.push('no move of mine reached the server and back');
    log(`premove drawn while waiting: ${premoveSeen} (false only if the opponent had already answered)`);

    // the Resign control opens its dialog (appAlert: a native dialog with Cancel / Resign), Cancel keeps the game. Checked HERE, while the game is certainly running: a 5 minute game can end
    // on time (the human's clock runs while the run is busy) before the final Resign step at the end of this scenario.
    // The question is the app's OWN overlay (src/components/AppAlert.tsx), not a system dialog: its message is a TextView, and its buttons are plain pressables with a TextView inside (no Button
    // class, no testID) - the first runs of this check looked for a "Button" and never saw the dialog. Found by the message, the buttons by their words below it.
    const RESIGN_MESSAGE = 'Your team loses the game.';
    const isResignDialog = (list) => list.some((n) => n.text === RESIGN_MESSAGE && n.bounds);
    const dialogButton = (list, word) => {
      const message = list.find((n) => n.text === RESIGN_MESSAGE && n.bounds);
      return message ? findNodes(list, { text: word }).filter((n) => n.bounds.y1 >= message.bounds.y2 - 2).sort((a, b) => a.bounds.y1 - b.bounds.y1)[0] ?? null : null;
    };
    try {
      await dev.runSteps([{ id: 'bughouse-resign' }]);
      const early = await dev.waitFor('the Resign dialog', isResignDialog, 40_000);
      const cancel = dialogButton(early, 'Cancel');
      if (!cancel) issues.push('the Resign dialog has no Cancel button below its question');
      if (cancel) dev.tap(cancel.bounds.cx, cancel.bounds.cy);
      else dev.key(4);
      await sleep(1200);
      const after = await dev.dump().catch(() => []);
      if (isResignDialog(after)) issues.push('the Resign dialog did not close on Cancel');
    } catch (e) {
      issues.push('the Resign control did not open its dialog: ' + String(e.message).slice(0, 220));
    }

    // the team bar: the Quick grid (ten buttons) and the team-chat panel with its "only your partner sees this" header
    // (the bar sits under the boards: on the cramped phone it is below the fold, so the finder scrolls to it)
    await dev.find({ id: 'bughouse-quick' });
    const bar = await dev.dump();
    issues.push(...textIssues(bar, dev.display).map((i) => `team bar ${i.kind}: "${i.text}" - ${i.detail}`));
    // (the grid is looked at after the tap, and the control is tapped again if it is not open: the tap is a toggle, so it is only repeated when the tree says the grid is closed. The nodes are
    // tapped where the tree has them - no scrolling search with a game that keeps repainting.)
    let grid = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      await dev.runSteps([{ id: 'bughouse-quick' }]);
      grid = await dev.dump().catch(() => []);
      if (grid.some((n) => n.id === 'bughouse-quick-8')) break;
      log(`the Quick grid was not open after tap ${attempt}; words on screen: ${visibleWords(grid, 25).join(' | ')}`);
    }
    for (let code = 0; code < 10; code++) if (!grid.some((n) => n.id === `bughouse-quick-${code}`)) issues.push(`the Quick grid has no button ${code}`);
    issues.push(...textIssues(grid, dev.display).map((i) => `Quick grid ${i.kind}: "${i.text}" - ${i.detail}`));
    await dev.snapshot('online-quick-grid');
    const quick8 = grid.find((n) => n.id === 'bughouse-quick-8' && n.bounds);
    if (quick8) dev.tap(quick8.bounds.cx, quick8.bounds.cy);
    await sleep(1200);
    const afterQuick = await dev.dump().catch(() => []);
    // sent (nothing to show the sender), or refused in words (the buddy's partner may be a bot): either way the grid is closed and no error screen is up
    if (afterQuick.some((n) => n.id === 'bughouse-quick-grid')) issues.push('the Quick grid did not close after a message');
    const chatButton = await dev.find({ id: 'bughouse-chat' }, { scrolls: 4 }).catch((e) => {
      issues.push('the Team chat control was not found: ' + String(e.message).slice(0, 160));
      return null;
    });
    if (chatButton) dev.tap(chatButton.bounds.cx, chatButton.bounds.cy);
    const chat = await dev.dump().catch(() => []);
    const header = chat.find((n) => n.id === 'bughouse-team-chat-header')?.text ?? '';
    if (header !== 'Team chat - only your partner sees this') issues.push(`the team-chat header says "${header}"`);
    issues.push(...textIssues(chat, dev.display).map((i) => `team chat ${i.kind}: "${i.text}" - ${i.detail}`));
    await dev.snapshot('online-team-chat');
    await dev.runSteps([{ id: 'bughouse-chat' }]).catch(() => {}); // (closes the panel; the restart below does not need it)

    // an app restart in the middle of the game: the app walks back into the seat by itself (the persisted rejoin)
    dev.stop();
    await sleep(800);
    dev.launch();
    try {
      const back = await dev.waitFor('the game after a restart', (list) => list.some((n) => n.id === 'board-A') && (list.find((n) => n.id === 'bughouse-online-intro')?.text ?? '') === intro, 150_000, 2000);
      issues.push(...crashIssues(back));
    } catch (e) {
      issues.push(`after an app restart the game did not come back: ${e.message.slice(0, 200)}`);
      await dev.snapshot('FAILED-restart');
      await dev.waitHome(120_000).catch(() => {});
    }
    // THE CONNECTION LOST IN THE MIDDLE OF THE GAME AND BACK (Bughouse W7, command #33): airplane mode on for a few seconds, then off. The app must say it is reconnecting (noted, not required: an
    // emulator may keep the old socket alive for a while), and once the network is back the board must be there again WITHOUT the banner; the Resign step below then proves the connection is
    // live again (it needs the server's answer and the server's result). Only a screen that never recovers is a finding.
    try {
      dev.sh('cmd connectivity airplane-mode enable');
      let sawBanner = false;
      for (let i = 0; i < 8 && !sawBanner; i++) {
        await sleep(1500);
        const tree = await dev.dump().catch(() => []);
        sawBanner = tree.some((n) => n.id === 'bughouse-online-reconnecting' || /trying to reconnect/i.test(n.text));
      }
      dev.sh('cmd connectivity airplane-mode disable');
      const t0 = Date.now();
      await dev.waitFor('the game after the connection is back', (list) => list.some((n) => n.id === 'board-A') && !list.some((n) => n.id === 'bughouse-online-reconnecting' || /trying to reconnect/i.test(n.text)), 150_000, 3000);
      log(`connection lost mid-game and back: the app ${sawBanner ? 'SAID it was reconnecting' : 'did not show the reconnecting line (the emulator kept the socket)'}; the board was back without the banner ${Math.round((Date.now() - t0) / 1000)} s after the network returned`);
    } catch (e) {
      issues.push(`after the connection was lost in the middle of the game and came back, the game did not recover: ${String(e.message).slice(0, 200)}`);
      await dev.snapshot('FAILED-reconnect');
    } finally {
      try {
        dev.sh('cmd connectivity airplane-mode disable');
      } catch {
        /* the phone is gone: the run reports it */
      }
    }
    // resign: the control asks "Resign?" (appAlert: a native dialog with Cancel / Resign), the dialog's button sends it, the server's snapshot ends the match. The result is any sign of a finished game:
    // a node whose id starts with game-over, or words like won / lost / resigned (the card sits UNDER the boards, below the fold on the small phone: the finder scrolls to it).
    // (a 5 minute game can END ON TIME before this point - the human's clock runs while the run is busy elsewhere: then the control is disabled and the result is already on the screen)
    const finished = (list) => list.find((n) => /^game-over/.test(n.id) || /\b(won|wins|lost|resigned|game over)\b/i.test(n.text));
    let confirmed = false;
    let lastError = '';
    const alreadyOver = (await dev.dump().catch(() => [])).find((n) => /^game-over/.test(n.id));
    if (alreadyOver) log('the game had already ended before the final Resign step (' + (alreadyOver.text || alreadyOver.id) + '): the Resign dialog was checked earlier, with Cancel');
    // (right after the restart the screen is up but the game may not be "live" yet - the app ignores the control until its first snapshot is back - so the tap is repeated until the dialog opens)
    for (let attempt = 1; attempt <= 4 && !confirmed && !alreadyOver; attempt++) {
      try {
        await dev.runSteps([{ id: 'bughouse-resign' }]);
        const dialog = await dev.waitFor('the Resign dialog', isResignDialog, 40_000);
        const confirm = dialogButton(dialog, 'Resign');
        if (!confirm) throw new Error('the Resign dialog has no Resign button below its question');
        dev.tap(confirm.bounds.cx, confirm.bounds.cy);
        confirmed = true;
        if (attempt > 1) log(`the Resign dialog opened at the ${attempt}th tap`);
      } catch (e) {
        lastError = String(e.message).slice(0, 220);
        await sleep(3000);
      }
    }
    if (!confirmed && !alreadyOver) issues.push('the Resign dialog did not open after 4 taps: ' + lastError);
    if (confirmed || alreadyOver) {
      let found = alreadyOver ?? null;
      try {
        found = await dev.waitFor('the result', finished, 30_000, 1000);
      } catch {
        // (the result was not on the screen for 30 s: the finder scrolled to it - which is itself the finding of command #33)
        found = await dev.find({ id: 'game-over-headline' }).catch(() => null);
        issues.push('the result card was below the visible screen: it was only found by scrolling');
      }
      if (found) log('result: ' + (found.text || found.id));
      else issues.push('no sign of a finished game 30 s after the dialog was confirmed (no game-over node, no won / lost / resigned text, even after scrolling)');
      // THE RESULT CARD MUST BE ON SCREEN WITHOUT SCROLLING (command #33): the phone showed "Team 2 wins" below the visible screen and the player had to scroll to find it. The screen scrolls to the
      // card by itself when a result arrives; the finder above may have scrolled too, so wait, look at the tree as it is NOW, and require the headline and both buttons fully inside the window.
      if (found) {
        await sleep(1500);
        const tree = await dev.dump().catch(() => []);
        for (const id of ['game-over-headline', 'bughouse-rematch', 'bughouse-menu']) {
          const node = tree.find((n) => n.id === id && n.bounds);
          if (!node) issues.push(`the result card's "${id}" is not on the screen (the tree has no such visible node: the card is below the fold)`);
          else if (node.bounds.y1 < 0 || node.bounds.y2 > dev.display.h || node.bounds.x1 < 0 || node.bounds.x2 > dev.display.w) issues.push(`the result card's "${id}" is cut off: bounds y ${node.bounds.y1}-${node.bounds.y2} in a window of ${dev.display.h} px`);
        }
      }
    }
    await dev.snapshot('online-result');
    record('online: Bughouse game', issues, `${moves} moves played as ${colour} on board ${board}`);
  }
}

// --- offline --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const UNREACHABLE = "Can't reach the server";
/** Each data screen must say it within 8 s (+ the time one tree dump takes) and show no spinner after that. */
const OFFLINE_BOUND_MS = 8000;
const DUMP_SLACK_MS = 2500;

async function offline(dev) {
  const cases = [
    ['Home', []],
    ['Analysis list', [{ text: 'Analysis' }]],
    ['Leaderboard', [{ text: 'More' }, { text: 'View Leaderboard' }]],
    ['Spectate list', [{ text: 'Play' }, { text: 'Spectate a live game ›' }]],
  ];
  dev.stop();
  dev.launch();
  const first = await dev.waitHome(180_000);
  // Home's stats and the Analysis list load only for a signed-in account (the online phase's, kept in the app's storage); a guest still has the leaderboard and the Spectate list
  const signedIn = !first.some((n) => n.text.startsWith('Log in to track your stats'));
  for (const [name, steps] of cases) {
    await scenario(dev, `offline: ${name}`, async () => {
      if (!signedIn && (name === 'Home' || name === 'Analysis list')) return record(`offline: ${name}`, [], 'not signed in (see the online phase): this section is not shown to a guest, nothing to check');
      if (name !== 'Home') await toHome(dev);
      let t0 = Date.now();
      if (name === 'Home') {
        await dev.relaunch();
        await dev.waitFor('the tab bar', onTabs, 90_000, 500);
        t0 = Date.now(); // Home is up: the 8 s count from here (the first render of a development bundle takes 10 s of its own)
      } else {
        // the clock starts at the LAST tap: the steps before it (finding a button in a long list, a dump or two) are not the screen's time
        for (const step of steps.slice(0, -1)) await dev.tapStep(step, 150);
        const last = await dev.find(steps[steps.length - 1]);
        t0 = Date.now();
        dev.tap(last.bounds.cx, last.bounds.cy);
      }
      const nodes = await dev.waitFor(`"${UNREACHABLE}"`, (list) => findNodes(list, { text: UNREACHABLE }).length > 0, OFFLINE_BOUND_MS + DUMP_SLACK_MS, 400);
      const ms = Date.now() - t0;
      const spinners = nodes.filter((n) => n.cls.endsWith('ProgressBar'));
      const issues = [];
      if (ms > OFFLINE_BOUND_MS + DUMP_SLACK_MS) issues.push(`took ${ms} ms`);
      if (spinners.length > 0) issues.push(`${spinners.length} spinner(s) still on screen`);
      issues.push(...textIssues(nodes, dev.display).map((i) => `${i.kind}: "${i.text}" - ${i.detail}`));
      await dev.snapshot(`offline-${name.replace(/\W+/g, '_')}`);
      record(`offline: ${name}`, issues, `${ms} ms from the tap to the message`);
    });
  }
}

// --- main -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const dev = new Device({ outDir: OUT, log });
// the app's own account of its boards (src/dev/e2eBeacon.ts): the screens whose accessibility tree cannot be trusted are read from it
dev.beacon = await new Beacon().start();
const started = Date.now();
const health = { start: null, end: null };
try {
  log(`android-e2e: profile ${profile.id} (${profile.title}), phase ${phase}, output ${OUT}`);
  dev.applyProfile(profile);
  // the runner's health at the start of the slice (command #32): the input path and one dump of the idle screen the slice starts from
  health.start = { inputMs: measureInput(dev), dumpMs: await measureDump(dev) };
  log(`runner health at the start: input ${health.start.inputMs} ms, dump ${health.start.dumpMs} ms -> ${judgeHealth(health.start).slow ? `SLOW (${judgeHealth(health.start).reasons.join('; ')})` : 'ok'}`);
  if (phase === 'static') {
    dev.clearData();
    dev.launch();
    await dev.waitHome(300_000);
    if (PARTS.has('screens')) await screens(dev);
    if (PARTS.has('textfit')) await textFit(dev);
    // the gallery's pixels do not depend on the window: the cramped phone runs it, the large phone's budget goes to the screens
    if (PARTS.has('gallery') && !flag('skip-gallery') && profile.id === 'small') await gallery(dev);
    if (PARTS.has('touch2p')) {
      await touches2p(dev);
      await arrows2p(dev); // the same game screen, after e2-e4 (command #32)
    }
    if (PARTS.has('touchbug')) await touchesBughouse(dev, false);
    // the same two boards in the frame of the phone of command #26 (root view below the status bar): where the reverted fix fails
    if (PARTS.has('touchinset')) await touchesBughouse(dev, true);
    // the performance budget (command #33): its own slice, so the emulator is not busy with anything else
    if (PARTS.has('perf')) await perf(dev);
  } else if (phase === 'online') {
    const account = await online(dev);
    // Straight on to the offline states, in the same run: a fresh app (the game of the scenario above, still saved for a rejoin, would otherwise open at launch), signed in with the same
    // account while the backend is still up, then the backend is stopped and every data screen must say "Can't reach the server".
    try {
      dev.stop();
      dev.clearData();
      dev.launch();
      await dev.waitHome(180_000);
      if (account) await login(dev, account);
    } catch (e) {
      record('offline: sign in before the backend stops', [`exception: ${e.message}`]);
    }
    execFileSync('bash', ['scripts/android/backend.sh', 'stop'], { stdio: 'inherit' });
    await offline(dev);
  } else {
    await offline(dev);
  }
} catch (e) {
  record('run', [`the run itself failed: ${e.stack || e.message}`]);
  await dev.snapshot('FAILED-run').catch(() => {});
}
dev.beacon.stop();
// The floating gear button (command #34): every tree the run read, on every screen it visited, was judged for a tappable node inside the gear zone (device.mjs `noteGear`).
record('gear zone: no tappable element reaches the floating gear button', [...(dev.gearFindings?.values() ?? [])], `${dev.gearDumps ?? 0} screens read`);
// ... and at the end (the input path only: a dump of a live game screen is slow by nature)
try {
  health.end = { inputMs: measureInput(dev) };
} catch {
  /* the phone is gone: the start reading stands */
}
if (dev.dumpFailures) log(`accessibility dumps that failed: ${JSON.stringify(dev.dumpFailures)}`);
const failed = results.filter((r) => !r.ok);
const label = labelAttempt({ failed: failed.length > 0, health });
log(`runner health at the end: input ${health.end?.inputMs ?? 'n/a'} ms -> ${label === '' ? 'passed' : `FAILED, labelled ${label}${label === 'RUNNER' ? ' (the first attempt is repeated once by run-on-emulator.sh)' : ''}`}`);
writeFileSync(join(OUT, 'logcat.txt'), dev.logcat(800));
writeFileSync(join(OUT, 'run.log'), logLines.join('\n'));
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ profile: profile.id, phase, attempt: ATTEMPT, label, health, seconds: Math.round((Date.now() - started) / 1000), relaunches, dumpFailures: dev.dumpFailures ?? {}, results }, null, 1));
log(`android-e2e ${profile.id}/${phase}: ${results.length - failed.length} passed, ${failed.length} failed in ${Math.round((Date.now() - started) / 1000)} s (${relaunches} relaunches)`);
for (const f of failed) log(`  FAILED: ${f.name}`);
// 0 = passed, 3 = failed on a slow runner (retried once by the shell), 1 = failed on a healthy runner (an APP finding, never retried)
process.exit(exitStatus({ failed: failed.length > 0, health }));
