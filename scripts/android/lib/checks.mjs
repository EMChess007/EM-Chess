/**
 * The judgements of the Android end-to-end driver (command #29), all PURE (a tree, a screenshot in, an issue text out) so `androidE2e.test.ts` proves with synthetic inputs that each one
 * reports what it claims - the old Android-only bugs among them (a clipped label, a black king drawn white, a touch one rank low).
 */
import { analyseCell, bodyLuminance, BLACK_BODY_MAX, judgeCell, judgeImageCell } from '../../browser/android-matrix-pieces.mjs';
import { crop } from './png.mjs';

export const PACKAGE = 'com.emchess.app';

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * The narrowest a one-word label may be, as width / (letters x height): Inter at ordinary line heights is 0.35 - 0.45, "Hom" for "Home" (the phone's clip of command #20) is 0.30. The limit
 * is deliberately low (a narrow word like "Filter" is 0.29 and must not fail); the on-device text-fit probe (below) is the sharp instrument, this is the net for every other label.
 */
export const MIN_WIDTH_PER_LETTER = 0.2;
/** The tallest a one-line label's box may be for the narrowness check (dp); the first emulator run met a 41 dp seat badge whose "Yellow" box was square. */
export const MAX_LABEL_HEIGHT_DP = 36;

/**
 * Problems with the TEXT on a screen, from its tree: a text box with no size, a text that runs out of the window sideways, a one-word label far too narrow for its letters.
 * `screen` is { w, h, scale? } in pixels (scale = density / 160). Returns [{ kind, text, detail }].
 */
export function textIssues(nodes, screen) {
  const issues = [];
  for (const n of nodes) {
    if (!n.text || n.cls.endsWith('EditText') || n.bounds === null) continue;
    const { w, h, x1, x2 } = n.bounds;
    // A box with no positive size is a text the scroll view has moved out of sight (uiautomator reports its bounds clipped to nothing, even negative): not on the screen, nothing to judge.
    if (w <= 0 || h <= 0) continue;
    if (x1 < -1 || x2 > screen.w + 1) issues.push({ kind: 'outside', text: n.text, detail: `box x ${x1}..${x2} in a window ${screen.w} px wide` });
    const letters = n.text.length;
    // a label is one line: a box taller than a line (36 dp) is a container around it, not the label's own box
    const oneLine = h / (screen.scale ?? 1) <= MAX_LABEL_HEIGHT_DP;
    if (oneLine && /^\S+$/.test(n.text) && letters >= 4 && letters <= 16 && w / (letters * h) < MIN_WIDTH_PER_LETTER) {
      issues.push({ kind: 'narrow', text: n.text, detail: `${w}x${h} px for ${letters} letters (${(w / (letters * h)).toFixed(2)} per letter, minimum ${MIN_WIDTH_PER_LETTER})` });
    }
  }
  return issues;
}

/** The smallest width-per-letter ratio of the one-word labels on a screen (printed, so the minimum can be tuned from real data). */
export function narrowestLabel(nodes) {
  let worst = null;
  for (const n of nodes) {
    if (!n.text || n.cls.endsWith('EditText') || !n.bounds || n.bounds.h <= 0 || !/^\S+$/.test(n.text) || n.text.length < 4) continue;
    const ratio = n.bounds.w / (n.text.length * n.bounds.h);
    if (worst === null || ratio < worst.ratio) worst = { text: n.text, ratio };
  }
  return worst;
}

/** The text-fit probe's lines (More > Diagnostics > "Run text-fit check") from the log on screen: the verdict per font, or null while it has not reported. */
export function parseTextFit(words) {
  const lines = words.flatMap((w) => w.split('\n')).filter((l) => l.includes('[TextFit]'));
  const fonts = lines.filter((l) => /\] (app|system) font:/.test(l));
  if (fonts.length < 2) return null;
  return {
    lines,
    mismatches: fonts.filter((l) => l.includes('MISMATCH')),
    bundledFontMissing: lines.some((l) => l.includes('NOT loaded')),
  };
}

/** The app crashed, hung or shows an error screen / a system dialog on top of it. */
export function crashIssues(nodes) {
  const issues = [];
  const bad = /keeps stopping|isn't responding|has stopped|Unable to load script|Unhandled JS Exception|Render Error|Invariant Violation|ReferenceError|TypeError:|Could not connect to development server/i;
  for (const n of nodes) {
    for (const w of [n.text, n.desc]) if (w && bad.test(w)) issues.push(`error on screen: "${w.slice(0, 120)}"`);
  }
  const top = nodes.find((n) => n.pkg);
  if (top && top.pkg !== PACKAGE) issues.push(`another app is on top: ${top.pkg}`);
  return [...new Set(issues)];
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Boards and touches
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const FILES = 'abcdefgh';

/** The rectangle of `square` ("e2") on a board whose grid is `board` ({x1, y1, w}), seen from `orientation` ('w': white at the bottom). Pixels. */
export function squareRect(board, orientation, square) {
  const cell = board.w / 8;
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  const col = orientation === 'w' ? file : 7 - file;
  const row = orientation === 'w' ? 8 - rank : rank - 1;
  const x = board.x1 + col * cell;
  const y = board.y1 + row * cell;
  return { x, y, w: cell, h: cell, cx: Math.round(x + cell / 2), cy: Math.round(y + cell / 2) };
}

/** Which way a board faces, from where its a1 cell is: 'w' (a1 bottom-left) or 'b' (top-right). */
export function orientationFromA1(board, a1) {
  return a1.cx < board.x1 + board.w / 2 && a1.cy > board.y1 + board.h / 2 ? 'w' : 'b';
}

/** The colour of a selected square, as a literal (Square.tsx / BughouseBoard.tsx '#a2d149'). */
export const SELECTED_RGB = [0xa2, 0xd1, 0x49];
const near = (a, b, tolerance) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) <= tolerance;

/** The mean colour of a small patch near a cell's top-left corner (a piece covers 90 % of its cell, a legal-move dot sits in the middle, so the corner is the square's own colour). */
export function cornerColour(png, rect, inset = 3, size = 3) {
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = Math.round(rect.x) + inset + x;
      const py = Math.round(rect.y) + inset + y;
      if (px < 0 || py < 0 || px >= png.width || py >= png.height) continue;
      const i = (py * png.width + px) * 4;
      sum[0] += png.data[i];
      sum[1] += png.data[i + 1];
      sum[2] += png.data[i + 2];
      n++;
    }
  }
  return n === 0 ? null : sum.map((s) => Math.round(s / n));
}

export const isSelectedColour = (colour) => colour !== null && near(colour, SELECTED_RGB, 14);

/** Every square of a board that is drawn selected, read from a screenshot. */
export function selectedSquares(png, board, orientation) {
  const out = [];
  for (const file of FILES) {
    for (let rank = 1; rank <= 8; rank++) {
      const square = file + rank;
      if (isSelectedColour(cornerColour(png, squareRect(board, orientation, square)))) out.push(square);
    }
  }
  return out;
}

/** The squares a tap on the middle of `target` must leave selected: exactly it. An issue text, or null. */
export function judgeSelection(png, board, orientation, target) {
  const selected = selectedSquares(png, board, orientation);
  if (selected.length === 1 && selected[0] === target) return null;
  return `tapped ${target}, the board shows ${selected.length === 0 ? 'nothing selected' : `${selected.join(', ')} selected`}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const KINDS = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };

/** "white king" / "Black Queen" -> "wk" / "bq", or null. */
export function markerFromWords(words) {
  const m = /\b(white|black)\s+(pawn|knight|bishop|rook|queen|king)\b/i.exec(words);
  return m ? m[1][0].toLowerCase() + KINDS[m[2].toLowerCase()] : null;
}

/** A gallery cell's label: "Merida on the Ocean board: black king on a dark square". */
export function parseGalleryLabel(label) {
  const m = /^(.+) on the (.+) board: (white|black) (pawn|knight|bishop|rook|queen|king) on a (light|dark) square$/.exec(label);
  return m ? { theme: m[1], board: m[2], marker: m[3][0] + KINDS[m[4]], square: m[5] } : null;
}

/**
 * The verdict on one cell of a screenshot: a vector piece by its ink, an image piece by looking like its own asset (`assets`: { wk: image, ... }; the piece fills 85 % of the cell,
 * centred). `cell` is the rectangle of the SQUARE in the screenshot. Returns an issue text or null.
 */
export function judgePieceCell(screenshot, cell, marker, assets = null) {
  // The cell is cropped 2 px inside the bounds the tree gives: the judges take the square's colour from the crop's top-left pixel, and a bound off by one pixel (cells that touch, a light row
  // under a dark one) would put a neighbour's colour there (the first emulator run judged every black piece on a light square as "blank" for that reason).
  const inset = CELL_INSET_PX;
  const png = crop(screenshot, { x: cell.x + inset, y: cell.y + inset, w: cell.w - 2 * inset, h: cell.h - 2 * inset });
  if (png.width < 8 || png.height < 8) return `${marker}: the cell is ${png.width}x${png.height} px, too small to judge`;
  if (assets === null) return judgeCell(marker, png);
  const rect = { x: cell.w * 0.075 - inset, y: cell.h * 0.075 - inset, w: cell.w * 0.85, h: cell.h * 0.85 };
  return judgeImageCell(marker, png, assets, rect);
}

export const CELL_INSET_PX = 2;

export { analyseCell, bodyLuminance, BLACK_BODY_MAX };
