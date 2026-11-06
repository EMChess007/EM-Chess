#!/usr/bin/env node
/**
 * Calibrates the piece judges of the Android end-to-end run (command #30) WITHOUT an emulator: it draws every piece the way the app does (a vector piece in a browser, an image piece with the
 * judge's own compositor) on the light and the dark square of the board themes, for a chosen version of the art, and prints the judges' numbers.
 *
 *   node scripts/android/calibrate-pieces.mjs [--ref <git ref>] [--cell <px>] [--json]
 *
 * `--ref` draws the art of that commit (the files `src/components/pieceArt.ts`, `src/data/pieceSets.json` and `assets/pieces/**` as they were there); without it, the working tree.
 * The numbers per black piece: `light` (the share of the piece's pixels whose luminance is above LIGHT_PIXEL_MIN, android-matrix-pieces.mjs `lightShare`) and `median` (bodyLuminance).
 * The first emulator run (command #29) judged the OLD art (4cf8c46: a thick light outline on every black vector piece, a light-banded Merida) as correct, because the image judge compares a
 * photograph with the repository's own asset and the median is not moved by an outline; `light` is the number that tells old from new.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { bodyLuminance, expectedCell, lightShare } from '../browser/android-matrix-pieces.mjs';
import { decodePng } from './lib/png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const ref = arg('ref', null);
const CELL = Number(arg('cell', 54));

/** The board themes' square colours that matter for a black piece: the lightest, the darkest and the bluest (src/logic/boardThemes.ts). */
const SQUARES = { classicLight: [0xf0, 0xd9, 0xb5], classicDark: [0xb5, 0x88, 0x63], oceanLight: [0xde, 0xe3, 0xe6], oceanDark: [0x8c, 0xa2, 0xad], marbleLight: [0xe8, 0xe8, 0xe8] };

// --- the art of the chosen version -------------------------------------------------------------------------------------------------------------------------------------------------
const work = mkdtempSync(join(tmpdir(), 'calibrate-pieces-'));
const fileAt = (path) => (ref === null ? readFileSync(join(REPO, path)) : execFileSync('git', ['show', `${ref}:${path}`], { cwd: REPO, maxBuffer: 1 << 26 }));
const existsAt = (path) => (ref === null ? existsSync(join(REPO, path)) : (() => { try { execFileSync('git', ['cat-file', '-e', `${ref}:${path}`], { cwd: REPO, stdio: 'ignore' }); return true; } catch { return false; } })());
mkdirSync(join(work, 'art'), { recursive: true });
writeFileSync(join(work, 'art', 'pieceArt.ts'), fileAt('src/components/pieceArt.ts'));
const art = await import(pathToFileURL(join(work, 'art', 'pieceArt.ts')).href);

const rows = [];
const add = (kind, theme, marker, square, png) => {
  const light = lightShare(png);
  rows.push({ kind, theme, marker, square, light: Number(light.toFixed(3)), median: Math.round(bodyLuminance(png) ?? -1) });
};

// --- vector pieces, drawn by a browser ----------------------------------------------------------------------------------------------------------------------------------------------
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch(process.env.E2E_BROWSER_PATH ? { executablePath: process.env.E2E_BROWSER_PATH } : {});
const page = await browser.newPage({ viewport: { width: CELL + 20, height: CELL + 20 }, deviceScaleFactor: 1 });
for (const [squareName, rgb] of Object.entries(SQUARES)) {
  for (const colour of ['w', 'b']) {
    for (const kind of art.PIECE_SHAPE_TYPES) {
      const ink = art.pieceInk(colour);
      const paint = art.piecePathPaint(ink);
      const size = Math.round(CELL * 0.9);
      const paths = art.PIECE_PATHS[kind].map((d) => `<path d="${d}" fill="${paint.fill}" fill-rule="${paint.fillRule}" stroke="${paint.stroke}" stroke-width="${paint.strokeWidth}" stroke-linejoin="${paint.strokeLinejoin}" stroke-linecap="${paint.strokeLinecap}"/>`).join('');
      await page.setContent(`<body style="margin:0;background:rgb(${rgb.join(',')})"><div style="width:${CELL}px;height:${CELL}px;display:flex;align-items:center;justify-content:center;background:rgb(${rgb.join(',')})"><svg width="${size}" height="${size}" viewBox="0 0 100 100">${paths}</svg></div></body>`);
      const buffer = await page.screenshot({ clip: { x: 0, y: 0, width: CELL, height: CELL } });
      add('vector', 'Classic', colour + kind, squareName, decodePng(buffer));
    }
  }
}
await browser.close();

// --- image pieces, drawn with the judge's own compositor (the piece fills 85 % of the cell, centred) -------------------------------------------------------------------------------------
const themes = ['cburnett', 'merida', 'checkers'];
for (const theme of themes) {
  for (const [squareName, rgb] of Object.entries(SQUARES)) {
    for (const colour of ['w', 'b']) {
      for (const kind of 'pnbrqk') {
        const path = `assets/pieces/${theme}/${colour}${kind}.png`;
        if (!existsAt(path)) continue;
        const asset = decodePng(fileAt(path));
        const inset = CELL * 0.075;
        add('image', theme, colour + kind, squareName, expectedCell(asset, rgb, CELL, CELL, { x: inset, y: inset, w: CELL * 0.85, h: CELL * 0.85 }));
      }
    }
  }
}
rmSync(work, { recursive: true, force: true });

// --- the report ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
if (args.includes('--json')) {
  console.log(JSON.stringify(rows));
} else {
  console.log(`art: ${ref ?? 'working tree'}, cell ${CELL} px`);
  for (const group of ['vector Classic', ...themes.map((t) => `image ${t}`)]) {
    const [kind, theme] = group.split(' ');
    const black = rows.filter((r) => r.kind === kind && r.theme === (kind === 'vector' ? 'Classic' : theme) && r.marker[0] === 'b');
    const lights = black.map((r) => r.light);
    const worst = black.reduce((a, b) => (b.light > a.light ? b : a));
    console.log(`${group.padEnd(18)} black pieces: light share min ${Math.min(...lights).toFixed(3)} max ${Math.max(...lights).toFixed(3)} (worst ${worst.marker} on ${worst.square}); median luminance max ${Math.max(...black.map((r) => r.median))}`);
  }
}
