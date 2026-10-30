#!/usr/bin/env node
/**
 * THE ANDROID END-TO-END RUN (command #29, .github/workflows/android-e2e.yml): the app on a real Android emulator, driven with real touches, judged on its real renderer.
 *
 * Every Android-only bug of the last weeks (clipped text, touches one rank low, endless spinners, pockets over the board, piece colours) passed every check because every check ran in Chromium.
 * This run exists so the next one cannot: it is a required status check (TESTING.md section 45).
 *
 *   node scripts/android/e2e.mjs --profile small|large --phase static|online|offline --out DIR [--api http://localhost:3000] [--only id,id] [--skip-gallery]
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
import { EXTRA_SCREENS } from '../browser/android-matrix-screens-extra.mjs';
import { Device, PROFILES, sleep } from './lib/device.mjs';
import { byClass, findNodes, visibleWords } from './lib/hierarchy.mjs';
import { crashIssues, judgePieceCell, judgeSelection, markerFromWords, narrowestLabel, orientationFromA1, parseGalleryLabel, parseTextFit, selectedSquares, squareRect, textIssues, cornerColour } from './lib/checks.mjs';
import { decodePng } from './lib/png.mjs';

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
  console.error('usage: e2e.mjs --profile small|large --phase static|online|offline --out DIR [--api URL] [--only id,id] [--skip-gallery]');
  process.exit(2);
}
const OUT = join(arg('out', 'android-e2e-out'), `${profile.id}-${phase}`);
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
    const nodes = await dev.dump();
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
const phoneScreens = () => [...SCREENS, ...EXTRA_SCREENS].filter((s) => !s.fixture && !s.pieceTheme && (!ONLY || ONLY.has(s.id)));

async function judgeGamePieces(dev, screen) {
  const { nodes, png } = await dev.look();
  const cells = [];
  for (const n of nodes) {
    if (!n.bounds) continue;
    // a Bughouse cell: testID "A-e2", label "e2, board A, White Pawn, ..."
    if (/^[AB]-[a-h][1-8]$/.test(n.id)) {
      const marker = markerFromWords(n.desc);
      if (marker) cells.push({ marker, rect: { x: n.bounds.x1, y: n.bounds.y1, w: n.bounds.w, h: n.bounds.h }, where: n.id });
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
  const issues = [];
  if (cells.length === 0) issues.push('no piece found on the screen at all');
  const seen = new Set(cells.map((c) => c.marker));
  if (screen.pieces.allKinds) for (const c of ['w', 'b']) for (const k of 'pnbrqk') if (!seen.has(c + k)) issues.push(`${c + k} is not on the screen`);
  for (const c of cells) {
    if (c.rect.x < 0 || c.rect.y < 0 || c.rect.x + c.rect.w > png.width || c.rect.y + c.rect.h > png.height) continue;
    const problem = judgePieceCell(png, c.rect, c.marker);
    // a bot may have moved a piece between the tree and the photograph: an empty cell is inconclusive on a screen with live bots, a wrong colour never is
    if (problem && !(screen.pieces.liveBots && problem.includes('no piece found'))) issues.push(`${c.where}: ${problem}`);
  }
  return { issues, count: cells.length };
}

async function screens(dev) {
  for (const s of phoneScreens()) {
    await scenario(dev, `screen ${s.id}`, async () => {
      await toHome(dev);
      await dev.runSteps(s.steps);
      await sleep(1200);
      const nodes = await dev.dump();
      const issues = [...crashIssues(nodes), ...textIssues(nodes, dev.display).map((i) => `${i.kind}: "${i.text}" - ${i.detail}`)];
      let note = `${nodes.length} nodes`;
      const narrow = narrowestLabel(nodes);
      if (narrow) note += `, narrowest label "${narrow.text}" ${narrow.ratio.toFixed(2)}`;
      if (s.pieces && s.pieces.mode === 'bw') {
        const verdict = await judgeGamePieces(dev, s);
        issues.push(...verdict.issues);
        note += `, ${verdict.count} pieces judged`;
      }
      await dev.snapshot(`screen-${s.id}`);
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
/** 4 themes x (48 large cells + 5 board themes x 2 squares x 12 game-size cells): a run that judged fewer did not see the whole gallery. */
const GALLERY_CELLS = 4 * (48 + 5 * 2 * 12);
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
        if (b.y1 < viewport.y1 || b.y2 > viewport.y2 || b.x1 < 0 || b.x2 > png.width) continue; // only a cell that is wholly on screen
        if (judged.has(n.desc)) continue;
        judged.add(n.desc);
        fresh++;
        const id = GALLERY_THEMES[parsed.theme];
        if (id === undefined) {
          issues.push(`unknown piece theme "${parsed.theme}" in the gallery`);
          continue;
        }
        const problem = judgePieceCell(png, { x: b.x1, y: b.y1, w: b.w, h: b.h }, parsed.marker, themeAssets(id));
        perTheme[id] = (perTheme[id] ?? 0) + 1;
        if (problem) issues.push(`${n.desc}: ${problem}`);
      }
      if (page % 8 === 0) await dev.snapshot(`gallery-${page}`);
      stuck = fresh === 0 ? stuck + 1 : 0;
      dev.swipe(dev.display.w / 2, viewport.y2 - 40, dev.display.w / 2, viewport.y1 + 60, 900);
      await sleep(500);
    }
    if (judged.size < GALLERY_CELLS) issues.push(`only ${judged.size} of ${GALLERY_CELLS} gallery cells were seen and judged`);
    record('piece gallery pixels', issues, `${judged.size} cells judged: ${JSON.stringify(perTheme)}`);
  });
}

// --- touches ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
async function boardNode(dev, id) {
  const nodes = await dev.waitFor(`the board ${id}`, (list) => list.some((n) => (n.id === id || n.desc === id) && n.bounds && n.bounds.w > 50), 30_000);
  const node = nodes.find((n) => (n.id === id || n.desc === id) && n.bounds && n.bounds.w > 50);
  return node.bounds;
}

/** Real taps at the computed middle of squares of the 2-player board: each must leave exactly that square selected (the bug of command #26 was a tap one rank low). */
async function touches2p(dev) {
  await scenario(dev, 'touch: 2-player board', async () => {
    await toHome(dev);
    await dev.runSteps([{ text: 'Play' }, { text: 'Classic', nth: 1 }, { text: '5 min' }]);
    await sleep(1200);
    const board = await boardNode(dev, 'chess-board');
    const issues = [];
    if (Math.abs(board.w - board.h) > 2) issues.push(`the board is not square: ${board.w}x${board.h}`);
    for (const target of ['e2', 'b1', 'g1', 'a2', 'h2', 'd1', 'a1', 'h1', 'c2', 'f2']) {
      const r = squareRect(board, 'w', target);
      dev.tap(r.cx, r.cy);
      await sleep(450);
      const problem = judgeSelection(dev.screenshot(), board, 'w', target);
      if (problem) issues.push(problem);
      dev.tap(r.cx, r.cy); // the same square again clears the selection
      await sleep(350);
    }
    // a whole move: e2 then e4, and both squares carry the last-move highlight
    const e2 = squareRect(board, 'w', 'e2');
    const e4 = squareRect(board, 'w', 'e4');
    dev.tap(e2.cx, e2.cy);
    await sleep(400);
    dev.tap(e4.cx, e4.cy);
    await sleep(900);
    const after = dev.screenshot();
    const colour = (rect) => cornerColour(after, rect);
    const yellow = (c) => c && Math.abs(c[0] - 0xf7) < 16 && Math.abs(c[1] - 0xec) < 16 && Math.abs(c[2] - 0x74) < 24;
    const lastMoveShown = (orientation) => yellow(colour(squareRect(board, orientation, 'e2'))) && yellow(colour(squareRect(board, orientation, 'e4')));
    if (!lastMoveShown('w') && !lastMoveShown('b')) issues.push(`after e2-e4 the last-move highlight is not on e2 and e4 (selected now: ${selectedSquares(after, board, 'w').join(',') || 'none'})`);
    await dev.snapshot('touch-2p');
    record('touch: 2-player board', issues, `board ${board.w}x${board.h} px at ${board.x1},${board.y1}`);
  });
}

/** Both Bughouse boards: a tap at the computed middle of e2 on EACH board must select it there (the legal squares are labelled "can move here"), and the other board's selection must stay. */
async function touchesBughouse(dev) {
  await scenario(dev, 'touch: Bughouse boards', async () => {
    await toHome(dev);
    await dev.runSteps([{ text: 'Play' }, { label: 'Bughouse local' }, { id: 'preset-four' }, { id: 'bughouse-start' }, { text: '3 min' }]);
    await sleep(1500);
    const boards = {};
    for (const b of ['A', 'B']) boards[b] = await boardNode(dev, `board-${b}`);
    const issues = [];
    const nodes = await dev.dump();
    const orientation = {};
    for (const b of ['A', 'B']) {
      const a1 = nodes.find((n) => n.id === `${b}-a1`)?.bounds;
      if (!a1) {
        issues.push(`board ${b}: the a1 cell is not in the tree`);
        continue;
      }
      orientation[b] = orientationFromA1(boards[b], a1);
      // the cell the app drew and the cell computed from the board's rectangle must be the same place
      const computed = squareRect(boards[b], orientation[b], 'a1');
      if (Math.abs(computed.cx - a1.cx) > 3 || Math.abs(computed.cy - a1.cy) > 3) issues.push(`board ${b}: a1 is drawn at ${a1.cx},${a1.cy} but the grid puts it at ${computed.cx},${computed.cy}`);
    }
    const picked = {};
    for (const b of ['A', 'B']) {
      if (!orientation[b]) continue;
      // the square of a pawn that may move now: e2 for White to move, e7 for Black
      const mover = (await dev.dump()).find((n) => n.id === `status-${b}`)?.text ?? '';
      const square = mover.startsWith('Black') ? 'e7' : 'e2';
      picked[b] = square;
      const r = squareRect(boards[b], orientation[b], square);
      dev.tap(r.cx, r.cy);
      await sleep(600);
      const { nodes: after, png } = await dev.look();
      const problem = judgeSelection(png, boards[b], orientation[b], square);
      if (problem) issues.push(`board ${b}: ${problem}`);
      const hints = after.filter((n) => n.id.startsWith(`${b}-`) && n.desc.includes('can move here')).length;
      if (hints === 0) issues.push(`board ${b}: after tapping ${square} no square is labelled "can move here"`);
    }
    // both selections are alive together
    if (orientation.A && orientation.B) {
      const png = dev.screenshot();
      for (const b of ['A', 'B']) {
        const now = selectedSquares(png, boards[b], orientation[b]);
        if (now.length !== 1 || now[0] !== picked[b]) issues.push(`board ${b}: with both boards touched the selection is ${now.join(',') || 'empty'}, expected ${picked[b]}`);
      }
    }
    await dev.snapshot('touch-bughouse');
    record('touch: Bughouse boards', issues, `orientations ${JSON.stringify(orientation)}, picked ${JSON.stringify(picked)}`);
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
  // the soft keyboard may cover the button: close it when it is up
  if (/mInputShown=true/.test(dev.sh('dumpsys input_method | grep -o "mInputShown=[a-z]*" | head -1'))) dev.key(4);
  await sleep(500);
  const buttons = findNodes(await dev.dump(), { text: 'Log In' }).sort((a, b) => b.bounds.y1 - a.bounds.y1);
  dev.tap(buttons[0].bounds.cx, buttons[0].bounds.cy); // the lowest "Log In" is the button, the other is the title
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
  if (!account) return;

  // The two first buddies play a game of their own (backend.sh): it is in the Spectate list under "Bughouse"; the phone watches it, can touch nothing, and leaves.
  await scenario(dev, 'online: spectate a Bughouse game', async () => {
    await toHome(dev);
    await dev.runSteps([{ text: 'Play' }, { text: 'Spectate a live game ›' }]);
    let row = null;
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
    dev.tap(row.bounds.cx, row.bounds.cy);
    const watching = await dev.waitFor('the spectator screen', (list) => list.some((n) => n.id === 'board-A') && list.some((n) => n.id === 'board-B'), 30_000, 1000);
    await sleep(1200);
    const issues = [...crashIssues(watching), ...textIssues(watching, dev.display).map((i) => `${i.kind}: "${i.text}" - ${i.detail}`)];
    const intro = (await dev.dump()).find((n) => n.id === 'bughouse-online-intro')?.text ?? '';
    if (!intro.startsWith('Watching:')) issues.push(`the strip above the boards does not say "Watching:": "${intro}"`);
    const nodes = await dev.dump();
    if (nodes.some((n) => n.id === 'bughouse-resign' || n.id.startsWith('bughouse-resign-team'))) issues.push('a spectator has a Resign control');
    if (nodes.some((n) => n.id === 'bughouse-team-bar')) issues.push('a spectator has the Quick / Team chat bar');
    // a tap on a board selects nothing
    const boardA = await boardNode(dev, 'board-A');
    const a1 = nodes.find((n) => n.id === 'A-a1')?.bounds;
    const orientation = a1 ? orientationFromA1(boardA, a1) : 'w';
    for (const square of ['e2', 'e7', 'd2', 'd7']) {
      const r = squareRect(boardA, orientation, square);
      dev.tap(r.cx, r.cy);
      await sleep(350);
    }
    const after = await dev.look();
    if (selectedSquares(after.png, boardA, orientation).length > 0) issues.push(`a spectator's tap selected ${selectedSquares(after.png, boardA, orientation).join(',')}`);
    await dev.snapshot('spectator');
    record('online: spectate a Bughouse game', issues, intro.slice(0, 80));
  });

  await scenario(dev, 'online: Bughouse game', async () => {
    await toHome(dev);
    execFileSync('bash', ['scripts/android/backend.sh', 'buddy'], { stdio: 'inherit' }); // the phone's own opponent: one human + one buddy
    await dev.runSteps([{ text: 'Play' }, { label: 'Bughouse online' }, { text: '1 min' }]);
    const queued = await dev.waitFor('the queue screen', (list) => list.some((n) => n.id === 'bughouse-queue' || n.id.startsWith('bughouse-queue-')), 20_000);
    await dev.snapshot('online-queue');
    const queueIssues = [...crashIssues(queued), ...textIssues(queued, dev.display).map((i) => `${i.kind}: "${i.text}" - ${i.detail}`)];
    record('online: queue screen', queueIssues);
    // the buddy (a second human) is already queued: bots fill the other seats after the fill timer
    const game = await dev.waitFor('the match to start', (list) => list.some((n) => n.id === 'board-A') && list.some((n) => n.id === 'board-B'), 150_000, 1500);
    await sleep(1500);
    const intro = (await dev.dump()).find((n) => n.id === 'bughouse-online-intro')?.text ?? '';
    const seat = /Board ([AB]) · (White|Black) · Team (\d)/.exec(intro);
    const issues = [...crashIssues(game)];
    if (!seat) {
      issues.push(`no seat line ("You: Board A · White · Team 1 ...") on the screen: "${intro}"`);
      return record('online: Bughouse game', issues);
    }
    const [, board, colour] = seat;
    const boards = { A: await boardNode(dev, 'board-A'), B: await boardNode(dev, 'board-B') };
    const nodes = await dev.dump();
    const a1 = nodes.find((n) => n.id === `${board}-a1`)?.bounds;
    const orientation = a1 ? orientationFromA1(boards[board], a1) : colour === 'White' ? 'w' : 'b';
    const plan = colour === 'White' ? [['e2', 'e4'], ['d2', 'd4'], ['g1', 'f3']] : [['e7', 'e5'], ['d7', 'd5'], ['g8', 'f6']];
    let moves = 0;
    let premoveSeen = false;
    for (const [index, [from, to]] of plan.entries()) {
      // the SECOND move is made as a PREMOVE: right after the first one, while the opponent is to move (W5). If the opponent has already answered, it is just an ordinary move.
      const premoving = index === 1;
      if (!premoving) {
        try {
          await dev.waitFor(`my turn on board ${board}`, (list) => (list.find((n) => n.id === `status-${board}`)?.text ?? '').startsWith(colour) || list.some((n) => n.id === 'game-over'), 90_000, 1200);
        } catch (e) {
          issues.push(`never my turn on board ${board}: ${e.message.slice(0, 160)}`);
          break;
        }
      }
      if ((await dev.dump()).some((n) => n.id === 'game-over')) break;
      const f = squareRect(boards[board], orientation, from);
      const t = squareRect(boards[board], orientation, to);
      dev.tap(f.cx, f.cy);
      await sleep(500);
      dev.tap(t.cx, t.cy);
      if (premoving) {
        await sleep(500);
        const marked = (await dev.dump()).find((n) => n.id === `${board}-${to}`)?.desc ?? '';
        premoveSeen = marked.includes('premove to');
      }
      // the server decides: the piece appears on `to` when its snapshot arrives
      try {
        await dev.waitFor(`${from}-${to} to show on board ${board}`, (list) => /(White|Black) (Pawn|Knight)/.test(list.find((n) => n.id === `${board}-${to}`)?.desc ?? ''), 12_000, 700);
        moves++;
      } catch (e) {
        issues.push(`my move ${from}-${to} never showed: ${e.message.slice(0, 160)}`);
      }
    }
    await dev.snapshot('online-game');
    if (moves === 0) issues.push('no move of mine reached the server and back');
    log(`premove drawn while waiting: ${premoveSeen} (false only if the opponent had already answered)`);

    // the team bar: the Quick grid (ten buttons) and the team-chat panel with its "only your partner sees this" header
    const bar = await dev.waitFor('the Quick / Team chat bar', (list) => list.some((n) => n.id === 'bughouse-quick'), 15_000);
    issues.push(...textIssues(bar, dev.display).map((i) => `team bar ${i.kind}: "${i.text}" - ${i.detail}`));
    await dev.runSteps([{ id: 'bughouse-quick' }]);
    const grid = await dev.dump();
    for (let code = 0; code < 10; code++) if (!grid.some((n) => n.id === `bughouse-quick-${code}`)) issues.push(`the Quick grid has no button ${code}`);
    issues.push(...textIssues(grid, dev.display).map((i) => `Quick grid ${i.kind}: "${i.text}" - ${i.detail}`));
    await dev.snapshot('online-quick-grid');
    await dev.runSteps([{ id: 'bughouse-quick-8' }]);
    await sleep(1200);
    const afterQuick = await dev.dump();
    // sent (nothing to show the sender), or refused in words (the buddy's partner may be a bot): either way the grid is closed and no error screen is up
    if (afterQuick.some((n) => n.id === 'bughouse-quick-grid')) issues.push('the Quick grid did not close after a message');
    await dev.runSteps([{ id: 'bughouse-chat' }]);
    const chat = await dev.dump();
    const header = chat.find((n) => n.id === 'bughouse-team-chat-header')?.text ?? '';
    if (header !== 'Team chat - only your partner sees this') issues.push(`the team-chat header says "${header}"`);
    issues.push(...textIssues(chat, dev.display).map((i) => `team chat ${i.kind}: "${i.text}" - ${i.detail}`));
    await dev.snapshot('online-team-chat');
    await dev.runSteps([{ id: 'bughouse-chat' }]);

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
    // resign: the control, then the dialog's button
    await dev.runSteps([{ id: 'bughouse-resign' }]);
    const dialog = await dev.waitFor('the Resign dialog', (list) => findNodes(list, { text: 'resign', ci: true, button: true }).length > 0, 10_000);
    const confirm = findNodes(dialog, { text: 'resign', ci: true, button: true }).sort((a, b) => b.bounds.y1 - a.bounds.y1)[0];
    dev.tap(confirm.bounds.cx, confirm.bounds.cy);
    try {
      const over = await dev.waitFor('the result', (list) => list.find((n) => n.id === 'game-over-headline')?.text, 30_000, 1000);
      log(`result: ${over}`);
    } catch (e) {
      issues.push(`no result after resigning: ${e.message.slice(0, 200)}`);
    }
    await dev.snapshot('online-result');
    record('online: Bughouse game', issues, `${moves} moves played as ${colour} on board ${board}`);
  });
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
  await dev.waitHome(180_000);
  for (const [name, steps] of cases) {
    await scenario(dev, `offline: ${name}`, async () => {
      if (name !== 'Home') await toHome(dev);
      const t0 = Date.now();
      if (name === 'Home') {
        await dev.relaunch();
        await dev.waitFor('the tab bar', onTabs, 90_000, 500);
      } else {
        for (const step of steps) await dev.tapStep(step, 150);
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
const started = Date.now();
try {
  log(`android-e2e: profile ${profile.id} (${profile.title}), phase ${phase}, output ${OUT}`);
  dev.applyProfile(profile);
  if (phase === 'static') {
    dev.clearData();
    dev.launch();
    await dev.waitHome(300_000);
    await screens(dev);
    await textFit(dev);
    if (!flag('skip-gallery')) await gallery(dev);
    await touches2p(dev);
    await touchesBughouse(dev);
  } else if (phase === 'online') {
    await online(dev);
  } else {
    await offline(dev);
  }
} catch (e) {
  record('run', [`the run itself failed: ${e.stack || e.message}`]);
  await dev.snapshot('FAILED-run').catch(() => {});
}
writeFileSync(join(OUT, 'logcat.txt'), dev.logcat(800));
writeFileSync(join(OUT, 'run.log'), logLines.join('\n'));
const failed = results.filter((r) => !r.ok);
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ profile: profile.id, phase, seconds: Math.round((Date.now() - started) / 1000), relaunches, results }, null, 1));
log(`android-e2e ${profile.id}/${phase}: ${results.length - failed.length} passed, ${failed.length} failed in ${Math.round((Date.now() - started) / 1000)} s (${relaunches} relaunches)`);
for (const f of failed) log(`  FAILED: ${f.name}`);
process.exit(failed.length > 0 ? 1 : 0);
