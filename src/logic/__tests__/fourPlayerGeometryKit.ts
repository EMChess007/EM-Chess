/**
 * The GEOMETRY IDENTITY fixture (CHATURAJI_SPEC.md sections 8.2 and 11), recorded BEFORE Chaturaji W0 touched the engine.
 *
 * W0 extracts the board geometry (size, the playable mask, the ray / knight / king tables, forward direction, display rotation, square names, the
 * start layout) out of module-level constants into a `Geometry` object, and the 14x14 cross board becomes ONE geometry among future ones. The 4 Player
 * Chess / Giveaway guarantee is that the cross board's numbers do not change by a single byte. `recordGeometrySections()` reads everything geometric
 * through the engine's PUBLIC exports and returns one canonical text per section; the test hashes them against `fixtures/fourPlayerGeometryGolden.json`
 * (recorded from the code before the extraction). Because it reads only what the engine exported before the extraction, it keeps working unchanged
 * after it - and a section that moves says exactly which table moved.
 *
 *   backend/node_modules/.bin/tsx src/logic/__tests__/fourPlayerGeometryKit.ts --record     (only for a deliberate geometry change)
 */
import {
  CASTLES,
  CELLS,
  DIRECTIONS,
  FFA_PROMOTION_COORD,
  FFA_RULES,
  FORWARD,
  GIVEAWAY_RULES,
  KING_START_SQUARE,
  KING_TARGETS,
  KNIGHT_TARGETS,
  PAWN_START_COORD,
  PLAYABLE_SQUARES,
  RAYS,
  ROOK_START_BIT,
  SIZE,
  VALID,
  fileOf,
  forwardCoord,
  fromDisplay,
  index,
  initialState,
  isPlayable,
  parseSquare,
  pawnCaptureSquares,
  rankOf,
  serialize,
  squareName,
  stepForward,
  toDisplay,
  type Seat,
} from '../fourPlayer';
import { sha256 } from './fourPlayerGoldenKit';

const SEATS: Seat[] = [0, 1, 2, 3];
const list = (xs: ArrayLike<number>): string => Array.from(xs).join(',');

export function recordGeometrySections(): Record<string, string> {
  const sections: Record<string, string> = {};
  sections.constants = JSON.stringify({ SIZE, CELLS, PAWN_START_COORD, FFA_PROMOTION_COORD, DIRECTIONS, FORWARD });
  sections.valid = list(VALID);
  sections.playable = list(PLAYABLE_SQUARES);
  sections.rays = RAYS.map((ray, i) => `${i}:${list(ray)}`).join('|');
  sections.knight = KNIGHT_TARGETS.map((t, i) => `${i}:${list(t)}`).join('|');
  sections.king = KING_TARGETS.map((t, i) => `${i}:${list(t)}`).join('|');

  const coords: string[] = [];
  for (let file = -2; file < SIZE + 2; file++) for (let rank = -2; rank < SIZE + 2; rank++) coords.push(`${file},${rank}:${isPlayable(file, rank) ? 1 : 0}`);
  sections.isPlayable = coords.join('|');

  const names: string[] = [];
  for (let sq = 0; sq < CELLS; sq++) names.push(`${sq}:${fileOf(sq)},${rankOf(sq)},${index(fileOf(sq), rankOf(sq))},${VALID[sq] ? squareName(sq) : '-'},${VALID[sq] ? parseSquare(squareName(sq)) : parseSquare('zz')}`);
  for (const bad of ['', 'a0', 'a15', 'o1', 'a1', 'n14', 'd3', 'c3', 'k11', 'l11', 'z9', 'a', '12']) names.push(`parse(${bad})=${parseSquare(bad)}`);
  sections.names = names.join('|');

  const seatTables: string[] = [];
  for (const seat of SEATS) {
    for (let sq = 0; sq < CELLS; sq++) {
      if (!VALID[sq]) continue;
      seatTables.push(`${seat}/${sq}:${forwardCoord(seat, sq)},${stepForward(seat, sq)},${stepForward(seat, sq, 2)},${list(pawnCaptureSquares(seat, sq))}`);
    }
  }
  sections.seatTables = seatTables.join('|');

  const display: string[] = [];
  for (const view of SEATS) {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const [dx, dy] = toDisplay(x, y, view);
        display.push(`${view}/${x},${y}:${dx},${dy},${fromDisplay(dx, dy, view).join(',')}`);
      }
    }
  }
  sections.display = display.join('|');

  sections.layout = JSON.stringify({ KING_START_SQUARE, CASTLES, ROOK_START_BIT: [...ROOK_START_BIT.entries()] });
  sections.startFfa = serialize(initialState(FFA_RULES));
  sections.startGiveaway = serialize(initialState(GIVEAWAY_RULES));
  return sections;
}

export const recordGeometryHashes = (): Record<string, string> =>
  Object.fromEntries(Object.entries(recordGeometrySections()).map(([name, text]) => [name, sha256(text)]));

// `--record`: rewrite the fixture from the CURRENT code.
if (process.argv.includes('--record') && process.argv[1]?.includes('fourPlayerGeometryKit')) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { writeFileSync, mkdirSync } = require('node:fs') as typeof import('node:fs');
  mkdirSync(`${__dirname}/fixtures`, { recursive: true });
  writeFileSync(`${__dirname}/fixtures/fourPlayerGeometryGolden.json`, JSON.stringify(recordGeometryHashes(), null, 1) + '\n');
  console.log(`recorded ${Object.keys(recordGeometryHashes()).length} geometry sections`);
}
