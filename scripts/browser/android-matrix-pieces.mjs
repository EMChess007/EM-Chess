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

/**
 * The BODY of a black piece must be dark (command #28): the median luminance (0-255) of the pixels that are not the square's own colour, at most BLACK_BODY_MAX. The commonest colour (analyseCell)
 * is blind to a body that is half light bands (Merida's black king) and the mean is moved by an outline; the median of everything the piece covers says what the eye sees at game size.
 * A white piece has no counterpart: its outline is most of its pixels in some sets.
 */
export const BLACK_BODY_MAX = 90;

export function bodyLuminance(png) {
  const { width, height, data } = png;
  const background = [data[(1 * width + 1) * 4], data[(1 * width + 1) * 4 + 1], data[(1 * width + 1) * 4 + 2]];
  const values = [];
  for (let i = 0; i < width * height; i++) {
    const pixel = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
    if (distance(pixel, background) <= BACKGROUND_DISTANCE) continue;
    values.push(0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2]);
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

/** The issue text for a black piece whose body reads light, or null. */
function lightBodyIssue(marker, png) {
  if (marker[0] !== 'b' || !/^b[pnbrqk]$/.test(marker)) return null;
  const body = bodyLuminance(png);
  return body !== null && body > BLACK_BODY_MAX ? `${marker}: the body reads light (median luminance ${Math.round(body)}, limit ${BLACK_BODY_MAX})` : null;
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
  return lightBodyIssue(marker, png);
}

// --- an IMAGE theme (Cburnett, Merida, Chess with Checkers: command #27c) -----------------------------------------------------------------------------------------------------------
// A vector piece has ONE exact ink, so its colour is the commonest colour of its pixels. An image piece has none: in Cburnett and Merida the white queen, bishop and rook are mostly DARK outline
// pixels (their commonest colour is black), and the black king has white lines. A colour threshold would be wrong in both directions, so an image piece is judged by LOOKING LIKE its own asset:
// the asset (src/data/pieceSets.json, a PNG) is drawn into the rectangle the page gave the piece, over the square's own colour, and the photographed cell must be nearer to it than to the other
// eleven assets of the theme - in particular nearer than to the other colour's piece of the same kind.

/** Cells are compared as means over BLOCK x BLOCK pixels: scaling and antialiasing move single pixels, not the shape and tone of a piece. */
export const IMAGE_BLOCK = 8;
/**
 * The largest mean difference (0-255, per channel, over the blocks of the cell) an image piece may have from its own asset. It is the net for a piece that is not there or not where the page said;
 * the COLOUR verdict does not depend on it (the nearest asset must be of the piece's colour). Real photographs of a correct piece are 1 - 7 from their asset.
 */
export const IMAGE_MAX_DISTANCE = 15;

/** An asset drawn into `rect` ({x, y, w, h}, in the cell's pixels) over `background`: the box-filtered image, composited. Returns {width, height, data} with opaque RGBA. */
export function expectedCell(asset, background, width, height, rect) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u0 = ((x - rect.x) / rect.w) * asset.width;
      const u1 = ((x + 1 - rect.x) / rect.w) * asset.width;
      const v0 = ((y - rect.y) / rect.h) * asset.height;
      const v1 = ((y + 1 - rect.y) / rect.h) * asset.height;
      let sum = [0, 0, 0];
      let alpha = 0;
      let n = 0;
      for (let v = Math.max(0, Math.floor(v0)); v < Math.min(asset.height, Math.ceil(v1)); v++) {
        for (let u = Math.max(0, Math.floor(u0)); u < Math.min(asset.width, Math.ceil(u1)); u++) {
          const i = (v * asset.width + u) * 4;
          const a = asset.data[i + 3] / 255;
          sum[0] += asset.data[i] * a;
          sum[1] += asset.data[i + 1] * a;
          sum[2] += asset.data[i + 2] * a;
          alpha += a;
          n++;
        }
      }
      // the part of this pixel the image does not cover shows the square
      const covered = n === 0 ? 0 : n / Math.max(1, (Math.ceil(u1) - Math.floor(u0)) * (Math.ceil(v1) - Math.floor(v0)));
      const per = n === 0 ? 0 : 1 / n;
      const a = alpha * per * covered;
      const out = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) data[out + c] = Math.round(sum[c] * per * covered + background[c] * (1 - a));
      data[out + 3] = 255;
    }
  }
  return { width, height, data };
}

/** The means of an image over IMAGE_BLOCK x IMAGE_BLOCK blocks, RGB. */
function blockMeans(image) {
  const bw = Math.ceil(image.width / IMAGE_BLOCK);
  const bh = Math.ceil(image.height / IMAGE_BLOCK);
  const out = new Float64Array(bw * bh * 3);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let n = 0;
      for (let y = by * IMAGE_BLOCK; y < Math.min(image.height, (by + 1) * IMAGE_BLOCK); y++) {
        for (let x = bx * IMAGE_BLOCK; x < Math.min(image.width, (bx + 1) * IMAGE_BLOCK); x++) {
          const i = (y * image.width + x) * 4;
          for (let c = 0; c < 3; c++) out[(by * bw + bx) * 3 + c] += image.data[i + c];
          n++;
        }
      }
      for (let c = 0; c < 3; c++) out[(by * bw + bx) * 3 + c] /= n;
    }
  }
  return out;
}

/** The mean absolute per-channel difference of two images of the same size, over their blocks (0 = identical, 255 = black against white). */
export function imageDistance(a, b) {
  const x = blockMeans(a);
  const y = blockMeans(b);
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]);
  return sum / x.length;
}

/** The distance of a photographed cell from every asset of the theme drawn into `rect`: { 'wk': 4.1, 'bk': 61.7, ... }. The square's colour is the photograph's top-left pixel. */
export function imageDistances(png, assets, rect) {
  const background = [png.data[(1 * png.width + 1) * 4], png.data[(1 * png.width + 1) * 4 + 1], png.data[(1 * png.width + 1) * 4 + 2]];
  const out = {};
  for (const [key, asset] of Object.entries(assets)) out[key] = imageDistance(png, expectedCell(asset, background, png.width, png.height, rect));
  return out;
}

/**
 * The verdict on one photographed cell of an image theme: an issue text, or null. The piece must be nearest to an asset of ITS colour (the bug of command #27c is a colour) and within
 * IMAGE_MAX_DISTANCE of its own. Which KIND of a colour it is nearest to is not a verdict: in a disc theme (Chess with Checkers) the six white pieces are one disc with a small glyph and
 * a single pixel of scaling decides which is nearest; the key -> asset mapping is pinned by pieceThemes.test.ts and pieceThemes.dom.test.tsx instead.
 */
export function judgeImageCell(marker, png, assets, rect) {
  if (!/^[wb][pnbrqk]$/.test(marker)) return `unknown piece marker "${marker}"`;
  if (!assets[marker]) return `${marker}: the theme has no image for it`;
  const distances = imageDistances(png, assets, rect);
  const ranked = Object.entries(distances).sort((a, b) => a[1] - b[1]);
  const [nearest, nearestDistance] = ranked[0];
  const own = distances[marker];
  const swapped = distances[(marker[0] === 'w' ? 'b' : 'w') + marker[1]];
  if (nearest[0] !== marker[0]) return `${marker}: drawn like ${nearest} (distance ${nearestDistance.toFixed(1)}), not like its own image (${own.toFixed(1)}); the other colour's ${marker[1]} is at ${swapped.toFixed(1)}`;
  if (own > IMAGE_MAX_DISTANCE) return `${marker}: ${own.toFixed(1)} away from its own image (limit ${IMAGE_MAX_DISTANCE})`;
  return lightBodyIssue(marker, png);
}

/**
 * Runs the check in a page. `mode` is 'bw' (data-piece), 'seat' (data-seat-piece); `assets` ({ wk: {width, height, data}, ... }, the active piece theme's images decoded) switches the
 * colour judgement to an image theme (judgeImageCell); `bothSquares`: every kind seen must be seen on two different square colours; `allKinds`: the twelve
 * (bw) kinds must all be on screen. Returns a list of {kind: 'piece-colour', el, detail}. `PNG` is pngjs's.
 */
export async function checkPieceColours(page, PNG, { mode, bothSquares = false, allKinds = false, liveBots = false, assets = null }) {
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
        // A board whose cells carry no square name (the 2-player board) is told apart by the colour of the square under the piece: the nearest ancestor with a background of its own.
        let under = '';
        for (let node = el; node && !under; node = node.parentElement) {
          const bg = getComputedStyle(node).backgroundColor;
          if (bg && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(bg)) under = bg;
        }
        const parity = square ? (square[1].charCodeAt(0) - 97 + Number(square[2])) % 2 : under;
        const r = el.getBoundingClientRect();
        const c = cell ? cell.getBoundingClientRect() : r;
        // a thumbnail's cells are 12 dp: too small to read a colour from (the thumbnail draws the same PieceIcon as every board)
        const inThumbnail = Boolean(el.closest('[data-testid^="thumb-"]'));
        // where the piece sits inside its cell: an image piece is judged against its asset drawn into exactly this rectangle
        const rect = { x: r.x - c.x, y: r.y - c.y, w: r.width, h: r.height };
        return { index, marker: el.getAttribute(attr), parity, visible: r.width > 0 && r.height > 0 && !inThumbnail, board: label.includes('board B') ? 'B' : 'A', rect };
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
    // The page may have drawn fewer pieces between the listing and the handles (a bot's capture, a reflow): no handle, nothing to judge.
    if (!handle) continue;
    // A piece that a bot's move removed from the page is gone for good: its cell is simply not judged.
    const cell = (
      await handle
        .evaluateHandle((el) => {
          let node = el;
          while (node && !/^[a-n]\d+(,|$)/.test(node.getAttribute('aria-label') || '')) node = node.parentElement;
          return node || el;
        })
        .catch(() => null)
    )?.asElement();
    if (!cell) continue;
    await cell.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    // a clip of the page, not `element.screenshot()`: that waits for the element to be "stable", which a board that bots are playing on never is
    let box = await cell.boundingBox().catch(() => null);
    if (box === null) continue;
    // Bots keep playing on a screen with bots: the piece that was in this cell when the cell was chosen may have moved away before the photograph. The marker is read again after it, and a
    // cell whose piece changed meanwhile is not judged (a stale photograph, not a wrong colour).
    // A photograph that shows a problem is taken up to five times: a bot's move landing during it is gone in the next one, a wrong colour is still there.
    const markerNow = () => handle.getAttribute(attribute).catch(() => null);
    let png = null;
    let problem = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      if ((await markerNow()) !== f.marker) {
        png = null;
        break;
      }
      // the cell may have moved (a status line changed above it): its rectangle is read again for every photograph
      box = (await cell.boundingBox().catch(() => null)) ?? box;
      const shot = await page.screenshot({ clip: box, timeout: 8000 }).catch(() => null);
      if (shot === null || (await markerNow()) !== f.marker) {
        png = null;
        break;
      }
      png = PNG.sync.read(shot);
      // the photograph is at the cell's own pixel size unless the device scale is not 1: the rectangle is scaled with it
      const scale = png.width / box.width;
      problem = assets ? judgeImageCell(f.marker, png, assets, { x: f.rect.x * scale, y: f.rect.y * scale, w: f.rect.w * scale, h: f.rect.h * scale }) : judgeCell(f.marker, png);
      if (problem === null) break;
      await page.waitForTimeout(150);
    }
    if (png === null) continue;
    // On a screen where bots play, a photograph can catch the cell between two renders (an empty cell, never a wrong colour): there "no piece found" is inconclusive. Every screen without bots
    // (the all-pieces fixture, the four-human game) still treats an empty cell as a failure.
    if (liveBots && problem !== null && problem.includes('no piece found')) problem = null;
    if (problem !== null) issues.push({ kind: 'piece-colour', el: `${f.marker} on board ${f.board}`, detail: `${problem} [cell ${png.width}x${png.height}, at ${Math.round(box.x)},${Math.round(box.y)}]` });
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
