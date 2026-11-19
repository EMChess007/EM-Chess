/**
 * THE BOARD EDITOR'S GRID, read from the accessibility tree (command #55). The editor's 64 squares each have the label "e4, empty" / "e1, white king" (components `editorSquareLabel`);
 * on a 360 dp phone they once wrapped after 7 squares (AppPressable's 44 dp floor grew each 41 dp square) and the board overlapped "Starting Position / Clear Board". The judgement is
 * pure (the nodes come from hierarchy.mjs `parseHierarchy`), unit-tested in androidEditorGrid.test.ts, run on the emulator by e2e.mjs `boardEditorGrid`.
 */
import { findNodes } from './hierarchy.mjs';

const SQUARE_LABEL = /^([a-h])([1-8]), (empty|(?:white|black) (?:king|queen|rook|bishop|knight|pawn))$/;
/** Pixels of tolerance for the rounding of bounds (two squares of one column may differ by a pixel). */
const TOLERANCE = 2;

/** The squares of the editor in the dump: [{ square, file, rank, bounds }], one per label (a label printed twice for a nested node counts once). */
export function editorSquares(nodes) {
  const seen = new Map();
  for (const n of nodes) {
    const m = n.bounds && n.bounds.w > 0 && n.bounds.h > 0 ? SQUARE_LABEL.exec(n.desc) : null;
    if (m && !seen.has(`${m[1]}${m[2]}`)) seen.set(`${m[1]}${m[2]}`, { square: `${m[1]}${m[2]}`, file: m[1].charCodeAt(0) - 97, rank: Number(m[2]), bounds: n.bounds });
  }
  return [...seen.values()];
}

const overlap = (a, b) => Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > TOLERANCE && Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > TOLERANCE;

/** Everything wrong with the editor's grid on this screen; [] when the 64 squares are 8 distinct columns x 8 rows, equal in size, and none overlaps the toolbar's buttons. */
export function checkEditorGrid(nodes) {
  const issues = [];
  const squares = editorSquares(nodes);
  if (squares.length !== 64) {
    issues.push(`${squares.length} editor squares are in the accessibility tree, not 64 (missing: ${missingSquares(squares).join(' ') || 'none'})`);
    if (squares.length === 0) return issues;
  }
  // columns: every file has ONE x (within the rounding), and the 8 files are in order, left to right
  const colX = [];
  for (let file = 0; file < 8; file++) {
    const xs = squares.filter((s) => s.file === file).map((s) => s.bounds.x1);
    if (xs.length === 0) continue;
    if (Math.max(...xs) - Math.min(...xs) > TOLERANCE) issues.push(`file ${'abcdefgh'[file]} is not one column: its squares start at x = ${[...new Set(xs)].join(', ')}`);
    colX.push(Math.min(...xs));
  }
  for (let i = 1; i < colX.length; i++) if (colX[i] - colX[i - 1] <= TOLERANCE) issues.push(`files are not 8 distinct columns: x = ${colX.join(', ')}`);
  // rows: every rank has ONE y, and rank 8 is the top row
  const rowY = [];
  for (let rank = 8; rank >= 1; rank--) {
    const ys = squares.filter((s) => s.rank === rank).map((s) => s.bounds.y1);
    if (ys.length === 0) continue;
    if (Math.max(...ys) - Math.min(...ys) > TOLERANCE) issues.push(`rank ${rank} is not one row: its squares start at y = ${[...new Set(ys)].join(', ')}`);
    rowY.push(Math.min(...ys));
  }
  for (let i = 1; i < rowY.length; i++) if (rowY[i] - rowY[i - 1] <= TOLERANCE) issues.push(`ranks are not 8 distinct rows (rank 8 on top): y = ${rowY.join(', ')}`);
  // equal squares, none overlapping another
  const sizes = squares.flatMap((s) => [s.bounds.w, s.bounds.h]);
  if (Math.max(...sizes) - Math.min(...sizes) > TOLERANCE) issues.push(`the squares are not all the same size: ${Math.min(...sizes)} to ${Math.max(...sizes)} px`);
  for (let i = 0; i < squares.length; i++) {
    for (let j = i + 1; j < squares.length; j++) {
      if (overlap(squares[i].bounds, squares[j].bounds)) issues.push(`${squares[i].square} and ${squares[j].square} overlap`);
    }
  }
  // the board stays above the toolbar buttons
  const boardBottom = Math.max(...squares.map((s) => s.bounds.y2));
  for (const text of ['Starting Position', 'Clear Board']) {
    const button = findNodes(nodes, { text })[0];
    if (!button) issues.push(`the "${text}" button is not on the screen`);
    else if (boardBottom - button.bounds.y1 > TOLERANCE) issues.push(`the board (bottom y = ${boardBottom}) overlaps the "${text}" button (top y = ${button.bounds.y1})`);
  }
  return issues;
}

function missingSquares(squares) {
  const have = new Set(squares.map((s) => s.square));
  const missing = [];
  for (const f of 'abcdefgh') for (let r = 1; r <= 8; r++) if (!have.has(`${f}${r}`)) missing.push(`${f}${r}`);
  return missing.slice(0, 12);
}
