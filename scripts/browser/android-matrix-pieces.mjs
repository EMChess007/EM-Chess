/**
 * The piece-colour check of the Android device matrix (command #27b): the PIXELS of a drawn piece, on both square colours.
 *
 * Found on a real phone: the black king was drawn white (the pieces were font glyphs and the phone's fallback font decided what "black" looked like). A test of the code cannot see that; a
 * look at the rendered pixels can. For every kind of piece on the screen (a piece is an element marked `data-piece="<colour><type>"`, or `data-seat-piece="<seat>:<type>"` on the 4-seat
 * boards) one cell per square colour is photographed, the colour of the piece is read from its pixels (the commonest colour that is not the square's own), and it must be the piece's ink:
 * near-white for a white piece, near-black for a black one, the seat's colour for a seat's piece. A screen that declares `bothSquares` must also show every kind on two different square colours.
 *
 * The analysis is pure (`analyseCell`, `expectedInk`, `inkMatches`) and unit-tested with synthetic images (androidMatrixPieces.test.ts); `checkPieceColours` drives the browser.
 */

/** The ink of the built-in pieces and of the four seats' pieces, as the app draws them (src/components/pieceArt.ts, src/logic/fourPlayer/board.ts SEAT_COLORS). Literals on purpose. */
export const INK = {
  w: [0xfa, 0xfa, 0xfa],
  b: [0x1d, 0x1d, 0x1d],
  seat: [
    [0xd3, 0x2f, 0x2f],
    [0x19, 0x76, 0xd2],
    [0xf9, 0xa8, 0x25],
    [0x2e, 0x7d, 0x32],
  ],
};

/** How far (largest channel difference) a piece's measured colour may be from its ink: antialiasing and scaling blur the fill a little, the outline never reaches the middle of a piece. */
export const INK_TOLERANCE = 40;
/** A pixel counts as part of the piece when it differs from the square's colour by more than this. */
const BACKGROUND_DISTANCE = 48;
/** Fewer piece pixels than this fraction of the cell means the piece is not there (or too small to judge). */
const MIN_PIECE_FRACTION = 0.1;

const distance = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/**
 * What an image of one cell says: the square's colour (the top-left pixel), the colour of the piece (the commonest 32-step bin among the pixels unlike the square, averaged) and the
 * fraction of the cell the piece covers. `png` is {width, height, data} with RGBA bytes.
 */
export function analyseCell(png) {
  const { width, height, data } = png;
  const at = (x, y) => [data[(y * width + x) * 4], data[(y * width + x) * 4 + 1], data[(y * width + x) * 4 + 2]];
  const background = at(1, 1);
  const bins = new Map();
  let candidates = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = at(x, y);
      if (distance(pixel, background) <= BACKGROUND_DISTANCE) continue;
      candidates++;
      const key = `${pixel[0] >> 5},${pixel[1] >> 5},${pixel[2] >> 5}`;
      const bin = bins.get(key) ?? { n: 0, sum: [0, 0, 0] };
      bin.n++;
      for (let c = 0; c < 3; c++) bin.sum[c] += pixel[c];
      bins.set(key, bin);
    }
  }
  let best = null;
  for (const bin of bins.values()) if (best === null || bin.n > best.n) best = bin;
  const piece = best === null ? null : best.sum.map((s) => Math.round(s / best.n));
  return { background, piece, fraction: candidates / (width * height) };
}

/** The ink a piece must have, from its marker: "wk" / "bq" (colour + type) or "2:n" (seat + type). Null for a marker nobody knows. */
export function expectedInk(marker) {
  if (/^[wb][pnbrqk]$/.test(marker)) return INK[marker[0]];
  const seat = /^([0-3]):[pnbrqk]$/.exec(marker);
  return seat ? INK.seat[Number(seat[1])] : null;
}

export const inkMatches = (measured, ink) => measured !== null && distance(measured, ink) <= INK_TOLERANCE;

/** The verdict on one photographed cell: an issue text, or null. */
export function judgeCell(marker, png) {
  const ink = expectedInk(marker);
  if (ink === null) return `unknown piece marker "${marker}"`;
  const { piece, fraction } = analyseCell(png);
  if (piece === null || fraction < MIN_PIECE_FRACTION) return `${marker}: no piece found in its cell (covers ${(fraction * 100).toFixed(1)} %)`;
  if (!inkMatches(piece, ink)) return `${marker}: drawn rgb(${piece.join(',')}), expected rgb(${ink.join(',')}) +-${INK_TOLERANCE}`;
  return null;
}

/**
 * Runs the check in a page. `mode` is 'bw' (data-piece), 'seat' (data-seat-piece); `bothSquares`: every kind seen must be seen on two different square colours; `allKinds`: the twelve
 * (bw) kinds must all be on screen. Returns a list of {kind: 'piece-colour', el, detail}. `PNG` is pngjs's.
 */
export async function checkPieceColours(page, PNG, { mode, bothSquares = false, allKinds = false }) {
  const attribute = mode === 'seat' ? 'data-seat-piece' : 'data-piece';
  const issues = [];
  // The "rotate the device" layer covers the boards (the window is below the minimum): the person sees no piece, so there is none to judge (the rectangle checks treat it the same way).
  if ((await page.locator('[data-testid="rotate-overlay"]').count()) > 0) return issues;
  const found = await page.$$eval(
    `[${attribute}]`,
    (els, attr) =>
      els.map((el, index) => {
        // the cell is the nearest ancestor labelled with a square name ("e8, board A, ..."); the piece's own label ("black king") is not it
        let cell = el;
        while (cell && !/^[a-n]\d+(,|$)/.test(cell.getAttribute('aria-label') || '')) cell = cell.parentElement;
        const label = (cell && cell.getAttribute('aria-label')) || '';
        const square = /^([a-n])(\d+)/.exec(label);
        const parity = square ? (square[1].charCodeAt(0) - 97 + Number(square[2])) % 2 : 0;
        const r = el.getBoundingClientRect();
        // a thumbnail's cells are 12 dp: too small to read a colour from (the thumbnail draws the same PieceIcon as every board)
        const inThumbnail = Boolean(el.closest('[data-testid^="thumb-"]'));
        return { index, marker: el.getAttribute(attr), parity, visible: r.width > 0 && r.height > 0 && !inThumbnail, board: label.includes('board B') ? 'B' : 'A' };
      }),
    attribute,
  );
  const visible = found.filter((f) => f.visible);
  if (allKinds && mode === 'bw') {
    const seen = new Set(visible.map((f) => f.marker));
    for (const colour of ['w', 'b']) for (const type of ['p', 'n', 'b', 'r', 'q', 'k']) if (!seen.has(colour + type)) issues.push({ kind: 'piece-colour', el: 'page', detail: `${colour + type} is not on the screen` });
  }
  // one cell per (marker, board, square parity)
  const picked = new Map();
  for (const f of visible) {
    const key = `${f.marker}|${f.board}|${f.parity}`;
    if (!picked.has(key)) picked.set(key, f);
  }
  const handles = await page.$$(`[${attribute}]`);
  const backgrounds = new Map();
  const photographed = new Map();
  for (const f of picked.values()) {
    const handle = handles[f.index];
    const cell = (
      await handle.evaluateHandle((el) => {
        let node = el;
        while (node && !/^[a-n]\d+(,|$)/.test(node.getAttribute('aria-label') || '')) node = node.parentElement;
        return node || el;
      })
    ).asElement();
    if (cell === null) continue;
    await cell.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    // a clip of the page, not `element.screenshot()`: that waits for the element to be "stable", which a board that bots are playing on never is
    const box = await cell.boundingBox();
    if (box === null) continue;
    // Bots keep playing on a screen with bots: the piece that was in this cell when the cell was chosen may have moved away before the photograph. The marker is read again after it, and a
    // cell whose piece changed meanwhile is not judged (a stale photograph, not a wrong colour).
    // A photograph that shows a problem is taken up to three times: a bot's move landing during it is gone in the next one, a wrong colour is still there.
    const markerNow = () => handle.getAttribute(attribute).catch(() => null);
    let png = null;
    let problem = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if ((await markerNow()) !== f.marker) {
        png = null;
        break;
      }
      const shot = await page.screenshot({ clip: box, timeout: 8000 }).catch(() => null);
      if (shot === null || (await markerNow()) !== f.marker) {
        png = null;
        break;
      }
      png = PNG.sync.read(shot);
      problem = judgeCell(f.marker, png);
      if (problem === null) break;
      await page.waitForTimeout(60);
    }
    if (png === null) continue;
    if (problem !== null) issues.push({ kind: 'piece-colour', el: `${f.marker} on board ${f.board}`, detail: problem });
    const bg = analyseCell(png).background.join(',');
    if (!photographed.has(f.marker)) photographed.set(f.marker, []);
    photographed.get(f.marker).push(`${f.board}:${f.parity}:${png.width}x${png.height}`);
    if (!backgrounds.has(f.marker)) backgrounds.set(f.marker, new Set());
    backgrounds.get(f.marker).add(bg);
  }
  if (bothSquares) {
    for (const [marker, set] of backgrounds) {
      if (set.size < 2) issues.push({ kind: 'piece-colour', el: marker, detail: `${marker} was only photographed on one square colour (${[...set].join(' | ')}; photographed: ${photographed.get(marker)?.join(', ')})` });
    }
  }
  return issues;
}
