/**
 * Darkens the six BLACK pieces of the Merida theme (command #28).
 *
 *   node scripts/darken-merida-black.mjs            rewrites the six black Merida entries of src/data/pieceSets.json (and nothing else), then run generate-piece-assets.mjs
 *   node scripts/darken-merida-black.mjs --check    writes nothing; exits 1 when an entry still has a light body
 *
 * WHY. The Merida black set came from the original drawings, where the "black" piece is dark shapes AND broad white-to-grey bands (the king's whole crown rim, the rook's three bands, the
 * queen's three bands). On a phone at game size the bands are most of what the eye sees, so the black king read as a white king with a dark crown (a screenshot of the Piece gallery, command #28).
 * A black piece's body must be dark: every channel of every pixel is capped at CAP (76 of 255, a dark grey), so the bands stay as faint detail lines and no part of a black
 * piece can read light. The outlines (already dark) and the alpha channel are untouched. The cap is idempotent: a second run changes nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(appDir, 'src', 'data', 'pieceSets.json');
const check = process.argv.includes('--check');
export const CAP = 76;
const KEYS = ['bk', 'bq', 'br', 'bb', 'bn', 'bp'];

const sets = JSON.parse(readFileSync(file, 'utf8'));
let light = 0;
for (const key of KEYS) {
  const uri = sets.merida[key];
  const png = PNG.sync.read(Buffer.from(uri.replace('data:image/png;base64,', ''), 'base64'));
  let changed = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      if (png.data[i + c] > CAP) {
        png.data[i + c] = CAP;
        changed++;
      }
    }
  }
  if (changed > 0) light++;
  if (!check) sets.merida[key] = 'data:image/png;base64,' + PNG.sync.write(png).toString('base64');
}
if (check) {
  if (light > 0) {
    console.error(`${light} black Merida piece(s) still have a light body`);
    process.exit(1);
  }
} else {
  writeFileSync(file, JSON.stringify(sets));
  console.log('black Merida pieces darkened');
}
