import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { backgroundOf, judgeLauncherIcon, measureIcon } from '../../../scripts/android/lib/launcher.mjs';
import { decodePng, solid } from '../../../scripts/android/lib/png.mjs';

/**
 * THE LAUNCHER-ICON JUDGE (command #35, scripts/android/lib/launcher.mjs). android-e2e photographs the installed APK's entry in the launcher's app list and judges its pixels with this module; here
 * it is proved on synthetic launcher screens built from the REAL generated art (assets/android-icon-foreground.png over the adaptive background colour, cut by a circle and by a squircle mask, as a
 * launcher does), on a light and a dark launcher, plus the two icons it must reject: the OLD one (a cream crown on a green tile) and a default light-green robot-like icon. Limits are literals.
 */
type Png = { width: number; height: number; data: Uint8Array };
const foreground = decodePng(readFileSync(path.join(process.cwd(), 'assets', 'android-icon-foreground.png'))) as Png;
const BACKGROUND_COLOUR = [10, 12, 13];

/** The launcher entry: `iconPx` wide icon centred at the top of a W x H cell with a "label" (dark marks) under it. Returns the screenshot and the entry's bounds. */
function launcherScreen(paintIcon: (u: number, v: number) => [number, number, number] | null, { background, iconPx = 158, cellW = 216, cellH = 270 }: { background: [number, number, number]; iconPx?: number; cellW?: number; cellH?: number }) {
  const screen = solid(cellW + 80, cellH + 80, [...background, 255]) as Png;
  const cellX = 40;
  const cellY = 40;
  const left = cellX + Math.round((cellW - iconPx) / 2);
  const top = cellY + 8;
  for (let y = 0; y < iconPx; y++) {
    for (let x = 0; x < iconPx; x++) {
      const colour = paintIcon((x + 0.5) / iconPx, (y + 0.5) / iconPx);
      if (colour === null) continue;
      screen.data.set([colour[0], colour[1], colour[2], 255], ((top + y) * screen.width + left + x) * 4);
    }
  }
  // the label: dark (or light on a dark launcher) marks under the icon, which the judge must not count
  const ink: [number, number, number] = background[0] > 128 ? [20, 20, 20] : [235, 235, 235];
  for (let y = cellY + cellH - 40; y < cellY + cellH - 26; y++) for (let x = cellX + 40; x < cellX + cellW - 40; x++) if ((x + y) % 3 !== 0) screen.data.set([...ink, 255], (y * screen.width + x) * 4);
  const bounds = { x1: cellX, y1: cellY, x2: cellX + cellW, y2: cellY + cellH, w: cellW, h: cellH, cx: cellX + cellW / 2, cy: cellY + cellH / 2 };
  return { screen, bounds };
}

/** The adaptive icon as a launcher draws it: the centre 72 / 108 of the canvas is visible, the foreground over the background colour, cut by `shape`. */
function adaptive(shape: 'circle' | 'squircle') {
  return (u: number, v: number): [number, number, number] | null => {
    const dx = u * 2 - 1;
    const dy = v * 2 - 1;
    const inside = shape === 'circle' ? dx * dx + dy * dy <= 1 : Math.pow(Math.abs(dx), 4) + Math.pow(Math.abs(dy), 4) <= 1;
    if (!inside) return null;
    const sx = Math.min(1023, Math.max(0, Math.round(512 + dx * 341.5)));
    const sy = Math.min(1023, Math.max(0, Math.round(512 + dy * 341.5)));
    const at = (sy * 1024 + sx) * 4;
    const a = foreground.data[at + 3] / 255;
    return [0, 1, 2].map((c) => Math.round(foreground.data[at + c] * a + BACKGROUND_COLOUR[c] * (1 - a))) as [number, number, number];
  };
}

/** The old icon: a cream crown on the green tile. */
const oldIcon = (u: number, v: number): [number, number, number] | null => {
  const inside = Math.pow(Math.abs(u * 2 - 1), 4) + Math.pow(Math.abs(v * 2 - 1), 4) <= 1;
  if (!inside) return null;
  const crown = u > 0.3 && u < 0.7 && v > 0.3 && v < 0.7 && (Math.round(v * 40) % 3 === 0 || Math.abs(u - 0.5) < 0.05);
  return crown ? [240, 228, 200] : [58 + Math.round((1 - u) * 20), 130 + Math.round((1 - v) * 15), 95];
};
/** A default, light-green icon with a white shape. */
const robot = (u: number, v: number): [number, number, number] | null => (Math.hypot(u - 0.5, v - 0.5) <= 0.5 ? (Math.hypot(u - 0.5, v - 0.55) < 0.22 ? [255, 255, 255] : [61, 220, 132]) : null);

const LAUNCHERS: Array<[string, [number, number, number]]> = [
  ['a light launcher', [236, 236, 236]],
  ['a dark launcher', [31, 31, 36]],
];

describe.each(LAUNCHERS)('on %s', (_name, background) => {
  it.each(['circle', 'squircle'] as const)('the new icon through a %s mask passes, at the cell sizes of a phone and of a tablet', (shape) => {
    for (const [iconPx, cellW, cellH] of [[158, 216, 270], [120, 160, 210], [230, 300, 360]] as const) {
      const { screen, bounds } = launcherScreen(adaptive(shape), { background, iconPx, cellW, cellH });
      expect(judgeLauncherIcon(screen, bounds), `${shape} ${iconPx}`).toEqual([]);
    }
  });

  it('the OLD icon (a cream crown on a green tile) fails with the old-green and the missing-ring reasons', () => {
    const { screen, bounds } = launcherScreen(oldIcon, { background });
    const issues = judgeLauncherIcon(screen, bounds).join(' | ');
    expect(issues).toContain('old green tile is still there');
    expect(issues).toContain('no green ring');
  });

  it('a default light-green icon fails (too much green, no dark tile)', () => {
    const { screen, bounds } = launcherScreen(robot, { background });
    const issues = judgeLauncherIcon(screen, bounds).join(' | ');
    expect(issues).toContain('too much bright green');
    expect(issues).toContain('not the dark tile');
  });

  it('an entry that shows nothing but the launcher background is reported as no icon', () => {
    const { screen, bounds } = launcherScreen(() => null, { background });
    expect(judgeLauncherIcon(screen, bounds)).toEqual(['no icon: the launcher entry shows nothing but the background']);
  });
});

describe('what the judge measures (printed so a limit can be re-derived)', () => {
  it('the new icon through a circle on a light launcher: dark / green / silver shares of its own box', () => {
    const { screen, bounds } = launcherScreen(adaptive('circle'), { background: [236, 236, 236] });
    const m = measureIcon(screen, bounds);
    expect(m).not.toBeNull();
    expect(backgroundOf(screen, bounds)).toEqual([236, 236, 236]);
    // measured (circle, light launcher): dark 59.7 %, green 4.5 %, silver 0.95 %, old green 1.6 % - against the limits dark 30 %, green 0.8 %, silver 0.5 %, old green 5 %
    expect(m!.dark).toBeGreaterThan(0.5);
    expect(m!.green).toBeGreaterThan(0.03);
    expect(m!.silver).toBeGreaterThan(0.006);
    expect(m!.oldGreen).toBeLessThan(0.03);
  });
});
