import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePng } from '../../../scripts/android/lib/png.mjs';

/**
 * THE APP ICONS (command #35). The user's new icon (a black knight with a green / silver ring on a dark rounded square) is the ONE source, assets/brand/em-chess-icon-source.png; every other file is made
 * from it by scripts/brand/generate-icons.py and nothing here reads a number from that script (every expectation is a literal). What is pinned:
 *   - every icon path app.json configures EXISTS and has the size Expo / Android / iOS expect (icon 1024, adaptive foreground and monochrome 1024, the splash image 1024, the favicon 48),
 *   - the adaptive icon is a COLOUR background (no leftover image of the old icon) and its colour is the tile's dark, the splash uses the same colour,
 *   - the look: the new icon is dark with a green ring (the old one was a cream crown on green: a regression to it fails the corner and the green-ring checks),
 *   - Android's 66 dp safe circle: everything visible in the foreground and in the monochrome icon lies inside the circle of 66 / 108 of the canvas (a launcher's mask never cuts it),
 *   - the splash plugin is configured (SDK 58 has no top-level `splash` for native: without `expo-splash-screen` the app has NO splash image at all).
 * `scripts/android/e2e.mjs` shows the same files from the other side: the launcher's app list of the installed APK (an artifact) with a pixel check of the icon.
 */
const root = process.cwd();
const appJson = JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8')) as {
  expo: {
    icon: string;
    splash?: { image?: string; resizeMode?: string; backgroundColor?: string };
    android: { adaptiveIcon: Record<string, string> };
    web: { favicon: string };
    plugins: Array<string | [string, Record<string, unknown>]>;
  };
};
const expo = appJson.expo;
const png = (relative: string) => {
  const file = path.join(root, relative.replace(/^\.\//, ''));
  expect(existsSync(file), `${relative} exists`).toBe(true);
  return decodePng(readFileSync(file)) as { width: number; height: number; data: Uint8Array };
};
const px = (image: { width: number; data: Uint8Array }, x: number, y: number) => {
  const at = (y * image.width + x) * 4;
  return { r: image.data[at], g: image.data[at + 1], b: image.data[at + 2], a: image.data[at + 3] };
};
const splash = expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen') as [string, Record<string, string | number>] | undefined;

describe('the configured icon files exist and have the right size', () => {
  it('icon, adaptive foreground and monochrome, the splash image: 1024 x 1024; the favicon: 48 x 48; the source picture: 1254 x 1254', () => {
    expect(expo.icon).toBe('./assets/icon.png');
    expect(expo.android.adaptiveIcon.foregroundImage).toBe('./assets/android-icon-foreground.png');
    expect(expo.android.adaptiveIcon.monochromeImage).toBe('./assets/android-icon-monochrome.png');
    expect(expo.web.favicon).toBe('./assets/favicon.png');
    expect(splash?.[1].image).toBe('./assets/splash-icon.png');
    for (const file of [expo.icon, expo.android.adaptiveIcon.foregroundImage, expo.android.adaptiveIcon.monochromeImage, String(splash?.[1].image)]) {
      const image = png(file);
      expect([image.width, image.height], file).toEqual([1024, 1024]);
    }
    const favicon = png(expo.web.favicon);
    expect([favicon.width, favicon.height]).toEqual([48, 48]);
    const source = png('./assets/brand/em-chess-icon-source.png');
    expect([source.width, source.height]).toEqual([1254, 1254]);
  });

  it('the adaptive icon has a colour background and no background image (the old image is gone); the splash has the same colour', () => {
    expect(expo.android.adaptiveIcon.backgroundColor).toBe('#0a0c0d');
    expect('backgroundImage' in expo.android.adaptiveIcon).toBe(false);
    expect(existsSync(path.join(root, 'assets', 'android-icon-background.png'))).toBe(false);
    expect(splash, 'the expo-splash-screen plugin is configured').toBeDefined();
    expect(splash?.[1].backgroundColor).toBe('#0a0c0d');
    expect(splash?.[1].resizeMode).toBe('contain');
    expect(Number(splash?.[1].imageWidth)).toBeGreaterThanOrEqual(150);
  });

  it('the top-level splash (Expo Go reads it for its loading screen) is also configured: same image, contain, the dark colour', () => {
    expect(expo.splash?.image).toBe('./assets/splash-icon.png');
    expect(expo.splash?.resizeMode).toBe('contain');
    expect(expo.splash?.backgroundColor).toBe('#0a0c0d');
  });

  it('the splash plugin is a declared dependency (the config plugin only exists when the package is installed)', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['expo-splash-screen']).toMatch(/^~58\./);
  });
});

describe('the new look (a black knight with a green ring on a dark tile), not the old cream crown on green', () => {
  it('icon.png is opaque, dark in all four corners and in the middle of the left and right edges, and has green ring pixels', () => {
    const icon = png(expo.icon);
    for (const [x, y] of [[2, 2], [1021, 2], [2, 1021], [1021, 1021], [2, 512], [1021, 512]] as const) {
      const p = px(icon, x, y);
      expect(p.a, `alpha at ${x},${y}`).toBe(255);
      expect(p.r + p.g + p.b, `dark at ${x},${y}`).toBeLessThan(120);
    }
    let green = 0;
    let white = 0;
    for (let y = 0; y < 1024; y += 4) {
      for (let x = 0; x < 1024; x += 4) {
        const p = px(icon, x, y);
        if (p.g > 150 && p.g > p.r + 50 && p.g > p.b + 70) green += 1;
        if (p.r > 190 && p.g > 190 && p.b > 190) white += 1;
      }
    }
    // the ring is a clear green arc and a silver one: hundreds of sampled pixels each (the old crown icon has none that is green and bright)
    expect(green).toBeGreaterThan(400);
    expect(white).toBeGreaterThan(300);
  });

  it('the adaptive foreground is transparent at the corners and its visible artwork has the green ring', () => {
    const foreground = png(expo.android.adaptiveIcon.foregroundImage);
    for (const [x, y] of [[0, 0], [1023, 0], [0, 1023], [1023, 1023], [30, 512], [993, 512]] as const) expect(px(foreground, x, y).a, `corner ${x},${y}`).toBe(0);
    let green = 0;
    for (let y = 0; y < 1024; y += 4) {
      for (let x = 0; x < 1024; x += 4) {
        const p = px(foreground, x, y);
        if (p.a > 200 && p.g > 150 && p.g > p.r + 50 && p.g > p.b + 70) green += 1;
      }
    }
    expect(green).toBeGreaterThan(150);
  });
});

/** Every sampled pixel of a layer whose test says "visible" must lie inside the 66 dp circle (66 / 108 of the 1024 canvas = radius 312.9) of the canvas, with a little room for the soft edge. */
const farthestVisible = (image: { width: number; data: Uint8Array }, visible: (p: { r: number; g: number; b: number; a: number }) => boolean) => {
  let farthest = 0;
  for (let y = 0; y < image.width; y += 2) {
    for (let x = 0; x < image.width; x += 2) {
      if (!visible(px(image, x, y))) continue;
      farthest = Math.max(farthest, Math.hypot(x - 511.5, y - 511.5));
    }
  }
  return farthest;
};

describe("Android's 66 dp safe circle (a launcher's circle, squircle or teardrop mask must never cut the artwork)", () => {
  it('everything BRIGHT in the foreground (the ring, the highlights; the dark body is judged by the next test) is inside radius 330 of 1024 and the artwork nearly reaches the circle (so it is as large as is safe)', () => {
    const foreground = png(expo.android.adaptiveIcon.foregroundImage);
    const bright = farthestVisible(foreground, (p) => p.a > 128 && p.r + p.g + p.b > 330);
    expect(bright).toBeLessThanOrEqual(330);
    expect(bright).toBeGreaterThanOrEqual(270);
  });

  it('every visible pixel of the foreground, the dark body included, is inside radius 360 (the layer is transparent beyond its soft edge)', () => {
    const foreground = png(expo.android.adaptiveIcon.foregroundImage);
    expect(farthestVisible(foreground, (p) => p.a > 8)).toBeLessThanOrEqual(360);
  });

  it('the monochrome icon is one shape in the alpha channel inside radius 330, filling between 20 % and 55 % of the safe circle (a knight in a ring, not an empty or a solid disc; measured 41 %)', () => {
    const mono = png(expo.android.adaptiveIcon.monochromeImage);
    expect(farthestVisible(mono, (p) => p.a > 128)).toBeLessThanOrEqual(330);
    let visible = 0;
    let total = 0;
    for (let y = 0; y < 1024; y += 2) {
      for (let x = 0; x < 1024; x += 2) {
        if (Math.hypot(x - 511.5, y - 511.5) > 313) continue;
        total += 1;
        if (px(mono, x, y).a > 128) visible += 1;
      }
    }
    const share = visible / total;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.55);
    expect(px(mono, 0, 0).a).toBe(0);
  });
});

describe('the splash image', () => {
  it('is transparent around the artwork (it is drawn on the splash background colour) and has the knight in the middle', () => {
    const image = png(String(splash?.[1].image));
    for (const [x, y] of [[0, 0], [1023, 0], [0, 1023], [1023, 1023]] as const) expect(px(image, x, y).a).toBe(0);
    expect(px(image, 512, 560).a).toBe(255);
  });
});
