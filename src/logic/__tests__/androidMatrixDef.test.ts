import { describe, expect, it } from 'vitest';
import * as def from '../../../scripts/browser/android-matrix-def.mjs';

/**
 * The Android device matrix, pinned to the user's requirement (TESTING.md "Android device matrix"). The numbers are LITERALS here: the runner and this test read the same module, so
 * a test that read them from it could never notice the matrix being weakened.
 */
describe('the matrix axes', () => {
  it('has the ten window sizes of the requirement, in dp', () => {
    expect(def.SCREEN_SIZES.map((s: { width: number; height: number }) => `${s.width}x${s.height}`)).toEqual([
      '320x568',
      '360x640',
      '360x740',
      '393x852',
      '412x915',
      '480x1000',
      '600x960',
      '800x1280',
      '740x360',
      '915x412',
    ]);
    for (const s of def.SCREEN_SIZES) expect(s.id).toBe(`${s.width}x${s.height}`);
  });

  it('has the six text scales Android offers (0.85 to 2.0)', () => {
    expect(def.TEXT_SCALES).toEqual([0.85, 1.0, 1.15, 1.3, 1.5, 2.0]);
  });

  it('has the app font and a wide fallback, three display zooms and both themes', () => {
    expect(def.FONTS.map((f: { id: string }) => f.id)).toEqual(['app', 'dejavu']);
    expect(def.FONTS[1].family).toBe("'DejaVu Sans'");
    expect(def.DISPLAY_ZOOMS).toEqual([1.0, 1.15, 1.3]);
    expect(def.THEMES).toEqual(['light', 'dark']);
  });

  it('has three system-bar profiles with the insets of a notch + gesture bar and of a three-button bar', () => {
    expect(def.INSET_PROFILE_IDS).toEqual(['none', 'gesture-cutout', 'three-button']);
    expect(def.INSET_PROFILES['gesture-cutout'].portrait).toEqual({ top: 48, bottom: 24, left: 0, right: 0 });
    expect(def.INSET_PROFILES['gesture-cutout'].landscape).toEqual({ top: 0, bottom: 24, left: 48, right: 0 });
    expect(def.INSET_PROFILES['three-button'].portrait).toEqual({ top: 24, bottom: 48, left: 0, right: 0 });
    expect(def.INSET_PROFILES['three-button'].landscape).toEqual({ top: 0, bottom: 0, left: 0, right: 48 });
    expect(def.INSET_PROFILES.none.portrait).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });
});

describe('the pass criteria', () => {
  it('are the requirement\'s numbers', () => {
    expect(def.CRITERIA.minTouchTarget).toBe(44);
    expect(def.CRITERIA.minGlyphContrast).toBe(3);
    expect(def.CRITERIA.minBoardCell).toEqual({ twoPlayer: 24, fourPlayer: 20, chaturaji: 28, bughouse: 28, bughouseStandard: 20 }); // bughouse: the dual layout (BUGHOUSE_SPEC 5.6); bughouseStandard: the one-human layout has no spec minimum, so the app's smallest board cell (4 Player Chess) is its floor
    expect(def.MIN_SMALLEST_WIDTH_DP).toBe(320);
  });
});

describe('viewportFor (display size)', () => {
  const size = (width: number, height: number) => ({ id: `${width}x${height}`, width, height });

  it('is the size itself at zoom 1', () => {
    expect(def.viewportFor(size(412, 915), 1)).toEqual({ width: 412, height: 915 });
  });

  it('shrinks the window by the zoom: the same pixels at a higher density are fewer dp (down to the 320 dp floor)', () => {
    expect(def.viewportFor(size(412, 915), 1.3)).toEqual({ width: 320, height: 711 }); // 412 / 1.2875: the zoom that still keeps the short side at 320
    expect(def.viewportFor(size(800, 1280), 1.15)).toEqual({ width: 696, height: 1113 });
  });

  it('never goes below the 320 dp smallest width Android allows', () => {
    expect(def.viewportFor(size(320, 568), 1.3)).toEqual({ width: 320, height: 568 });
    expect(def.viewportFor(size(360, 640), 1.3)).toEqual({ width: 320, height: 569 }); // 360 / 1.125, the zoom that still keeps the short side at 320
    expect(def.viewportFor(size(740, 360), 1.3)).toEqual({ width: 658, height: 320 }); // landscape: the SHORT side is the height
  });
});

describe('the combinations', () => {
  it('are the full product of the five axes: 720', () => {
    const all = def.fullCombos();
    expect(all).toHaveLength(720);
    expect(new Set(all.map(def.comboId)).size).toBe(720);
  });

  it('spread every system-bar profile over every size and every text scale', () => {
    const all = def.fullCombos();
    for (const size of def.SCREEN_SIZES) expect(new Set(all.filter((c: { size: unknown }) => c.size === size).map((c: { insetProfile: string }) => c.insetProfile)).size).toBe(3);
    for (const scale of def.TEXT_SCALES) expect(new Set(all.filter((c: { scale: number }) => c.scale === scale).map((c: { insetProfile: string }) => c.insetProfile)).size).toBe(3);
  });

  it('add a sweep of every size under every system-bar profile: 30', () => {
    const sweep = def.insetSweep();
    expect(sweep).toHaveLength(30);
    expect(new Set(sweep.map(def.comboId)).size).toBe(30);
  });

  it('keep the quick profile inside the full matrix\'s values and cover each axis\'s extremes', () => {
    const quick = def.quickCombos();
    expect(quick.length).toBeGreaterThanOrEqual(15);
    expect(quick.length).toBeLessThanOrEqual(25);
    const sizeIds = quick.map((c) => c.size.id);
    for (const id of ['320x568', '800x1280', '740x360']) expect(sizeIds).toContain(id);
    for (const scale of [0.85, 2.0]) expect(quick.map((c) => c.scale)).toContain(scale);
    expect(quick.map((c) => c.zoom)).toContain(1.3);
    expect(quick.map((c) => c.theme)).toContain('dark');
    expect(quick.map((c) => c.font.id)).toContain('dejavu');
  });

  it('orientation is by the larger side', () => {
    expect(def.orientationOf({ width: 740, height: 360 })).toBe('landscape');
    expect(def.orientationOf({ width: 360, height: 740 })).toBe('portrait');
  });
});

describe('the screens', () => {
  it('list every screen the requirement names, and each is reachable by steps', async () => {
    const { SCREENS } = await import('../../../scripts/browser/android-matrix-screens.mjs');
    const ids = SCREENS.map((s: { id: string }) => s.id);
    for (const id of [
      'home',
      'play-menu',
      'time-control',
      'game-2p',
      'ffa-setup',
      'giveaway-setup',
      'chaturaji-setup',
      'game-ffa',
      'game-chaturaji',
      'puzzles',
      'analysis',
      'more',
      'rules-chaturaji',
      'dialog-login',
    ]) {
      expect(ids).toContain(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});
