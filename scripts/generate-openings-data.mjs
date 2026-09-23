#!/usr/bin/env node
// Generates src/data/openings.json from the Lichess opening book
// (https://github.com/lichess-org/chess-openings — CC0 / public domain, the exact same
// ECO-based dataset lichess.org itself uses for its opening explorer and live opening names).
//
// One-time/occasional generation step, not part of the app's runtime or build — run manually
// (`node scripts/generate-openings-data.mjs`) whenever refreshing the data from a newer copy of
// the upstream a.tsv..e.tsv files (expected in ./tmp-openings-src/ next to this script's project
// root; see README.md at the upstream repo for how to obtain them).
//
// Output format: a single JSON object mapping each named position's EPD (FEN without the
// halfmove/fullmove counters — i.e. board + side to move + castling rights + en passant square)
// to a [eco, name] tuple. Keying by *position* rather than by move-sequence-so-far means
// transpositions (reaching the same named position via a different move order) are still
// recognized, matching how lichess's own opening explorer works against this same dataset.
import { Chess } from 'chess.js';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const SOURCE_DIR = path.join(PROJECT_ROOT, 'tmp-openings-src');
const OUT_FILE = path.join(PROJECT_ROOT, 'src', 'data', 'openings.json');

const VOLUME_FILES = ['a', 'b', 'c', 'd', 'e'];

function parseSanTokens(pgn) {
  return pgn
    .split(/\s+/)
    .map((tok) => tok.trim())
    .filter((tok) => tok.length > 0)
    .filter((tok) => !/^\d+\.+$/.test(tok))
    .map((tok) => tok.replace(/^\d+\.+/, ''))
    .filter((tok) => tok.length > 0);
}

function toEpd(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

const result = {};
let totalRows = 0;
let skipped = 0;
let collisions = 0;

for (const volume of VOLUME_FILES)
{
  const text = readFileSync(path.join(SOURCE_DIR, `${volume}.tsv`), 'utf8');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  const [, ...rows] = lines; // drop header row

  for (const row of rows) {
    totalRows++;
    const [eco, name, pgn] = row.split('\t');
    if (!eco || !name || !pgn) {
      skipped++;
      continue;
    }

    const chess = new Chess();
    let ok = true;
    for (const san of parseSanTokens(pgn)) {
      try {
        chess.move(san);
      } catch {
        ok = false;
        break;
      }
    }
    if (!ok) {
      console.warn(`[openings] could not replay ${eco} "${name}": ${pgn}`);
      skipped++;
      continue;
    }

    const epd = toEpd(chess.fen());
    if (Object.prototype.hasOwnProperty.call(result, epd)) {
      collisions++;
      continue; // keep the first (earliest/shallowest) entry for this exact position
    }
    result[epd] = [eco, name];
  }
}

writeFileSync(OUT_FILE, JSON.stringify(result));

const entryCount = Object.keys(result).length;
const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
console.log(`Read ${totalRows} rows across ${VOLUME_FILES.length} volumes.`);
console.log(`Skipped ${skipped} unparseable rows, ${collisions} position collisions.`);
console.log(`Wrote ${entryCount} opening entries (${(bytes / 1024).toFixed(1)} KB) to ${OUT_FILE}`);
