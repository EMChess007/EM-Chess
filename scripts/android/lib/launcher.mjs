/**
 * The launcher icon, judged from the phone's own screen (command #35). `iconAssets.test.ts` proves the files app.json names; this proves what Android DOES with them: the installed APK's
 * entry in the launcher's app list is photographed and its pixels are judged, so a wrong path, a missing adaptive layer or a build that still ships the old icon fails here.
 *
 * Pure functions over a decoded screenshot (`{ width, height, data }` RGBA) and the bounds of the launcher entry (the icon on top, the label under it), unit-tested in launcherIcon.test.ts against
 * the real generated art rendered through a circle and a squircle mask. What the new icon looks like on ANY launcher mask: a mostly DARK shape (the tile), a bright GREEN ring and a SILVER
 * ring. What the old one looked like: a cream crown on a GREEN tile (no dark, no bright green, no silver). What the default Android icon looks like: a lot of light green (no dark).
 * The icon's own box is found from the pixels (everything that differs from the launcher's background), so the launcher's cell size and icon size do not matter.
 */

const at = (png, x, y) => {
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
};

export const isDark = ([r, g, b]) => r + g + b < 100;
export const isBrightGreen = ([r, g, b]) => g > 140 && g > r + 50 && g > b + 60;
export const isSilver = ([r, g, b]) => r > 175 && g > 175 && b > 175 && Math.max(r, g, b) - Math.min(r, g, b) < 40;
/** The old tile: a mid green (#2e6f4f ... lighter at the top left). */
export const isOldTileGreen = ([r, g, b]) => g > 85 && g < 175 && r < 95 && b < 135 && g > r + 25 && g > b + 5;

/** The part of a launcher entry that holds the icon: the entry is the icon with its label under it, so the icon is the top, as wide as the entry is (at most). */
export function iconSquare(bounds, labelShare = 0.3) {
  const side = Math.max(8, Math.min(bounds.w, Math.round(bounds.h * (1 - labelShare))));
  return { x: Math.round(bounds.cx - side / 2), y: bounds.y1, side };
}

/** The launcher's background near the entry: the median colour of small patches at the entry's top corners and the middle of its sides. */
export function backgroundOf(png, bounds) {
  const spots = [
    [bounds.x1 + 2, bounds.y1 + 2],
    [bounds.x2 - 5, bounds.y1 + 2],
    [bounds.x1 + 2, bounds.y1 + Math.round(bounds.h * 0.35)],
    [bounds.x2 - 5, bounds.y1 + Math.round(bounds.h * 0.35)],
  ];
  const samples = [];
  for (const [sx, sy] of spots) {
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const x = Math.min(png.width - 1, Math.max(0, sx + dx));
        const y = Math.min(png.height - 1, Math.max(0, sy + dy));
        samples.push(at(png, x, y));
      }
    }
  }
  return [0, 1, 2].map((c) => samples.map((s) => s[c]).sort((a, b) => a - b)[Math.floor(samples.length / 2)]);
}

/** Counts over the icon's own box, as shares of its pixels. Null when nothing differs from the background (no icon at all). */
export function measureIcon(png, bounds) {
  const { x, y, side } = iconSquare(bounds);
  const bg = backgroundOf(png, bounds);
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(png.width, x + side);
  const y1 = Math.min(png.height, y + side);
  let left = Infinity;
  let top = Infinity;
  let right = -1;
  let bottom = -1;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const p = at(png, xx, yy);
      if (Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) <= 60) continue;
      left = Math.min(left, xx);
      right = Math.max(right, xx);
      top = Math.min(top, yy);
      bottom = Math.max(bottom, yy);
    }
  }
  if (right < 0) return null;
  let dark = 0;
  let green = 0;
  let silver = 0;
  let oldGreen = 0;
  let total = 0;
  for (let yy = top; yy <= bottom; yy++) {
    for (let xx = left; xx <= right; xx++) {
      const p = at(png, xx, yy);
      total += 1;
      if (isDark(p)) dark += 1;
      if (isBrightGreen(p)) green += 1;
      // (the launcher's own background is silver on a light launcher: the corners of the box round a circle are not the ring)
      if (isSilver(p) && Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 60) silver += 1;
      if (isOldTileGreen(p)) oldGreen += 1;
    }
  }
  return { box: { left, top, right, bottom }, background: bg, total, dark: dark / total, green: green / total, silver: silver / total, oldGreen: oldGreen / total };
}

/**
 * The verdict: an array of issue texts, empty when the icon on screen is the new one. The limits are literals, measured on the generated art rendered through a circle and a squircle (see
 * launcherIcon.test.ts for the measured numbers): dark share (the tile; the old icon: 0), bright green and silver (the ring; the old icon: none), old tile green, and a ceiling for the green.
 */
export function judgeLauncherIcon(png, bounds) {
  const m = measureIcon(png, bounds);
  if (m === null) return ['no icon: the launcher entry shows nothing but the background'];
  const issues = [];
  const pct = (v) => `${(v * 100).toFixed(1)} %`;
  if (m.dark < 0.3) issues.push(`the icon is not the dark tile: ${pct(m.dark)} dark pixels (needs 30 %)`);
  if (m.green < 0.008) issues.push(`no green ring: ${pct(m.green)} bright green pixels (needs 0.8 %)`);
  if (m.silver < 0.005) issues.push(`no silver ring: ${pct(m.silver)} silver pixels (needs 0.5 %)`);
  if (m.oldGreen >= 0.05) issues.push(`the old green tile is still there: ${pct(m.oldGreen)} old-green pixels`);
  if (m.green > 0.25) issues.push(`too much bright green for the knight icon (${pct(m.green)}): a default icon?`);
  return issues;
}
