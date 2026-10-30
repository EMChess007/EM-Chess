/**
 * The Android device matrix, defined ONCE (TESTING.md "Android device matrix"; CHECKLIST.md: every new or changed screen must pass it).
 *
 * The browser runner (android-matrix.mjs) and the vitest pin (src/logic/__tests__/androidMatrixDef.test.ts) both read this file, so the numbers cannot drift apart.
 * Everything here is data or a pure function: no browser, no network.
 *
 * Why a web matrix for an Android bug: the clipping the user saw on a phone is a measure-versus-draw mismatch the browser cannot reproduce, but the browser CAN prove that every
 * layout has room for text that is wider (a wide fallback font), taller (a larger font scale) and in a smaller window (display size) than the one the layout was drawn for.
 * That is what makes the app tolerant of whatever the phone's metrics turn out to be.
 */

/** Window sizes in dp (CSS px at device scale 1): phones from very small to large, small and large tablets, and two landscape phones. */
export const SCREEN_SIZES = [
  { id: '320x568', width: 320, height: 568, note: 'very small phone' },
  { id: '360x640', width: 360, height: 640, note: 'small phone' },
  { id: '360x740', width: 360, height: 740, note: 'common phone' },
  { id: '393x852', width: 393, height: 852, note: 'Pixel-class phone' },
  { id: '412x915', width: 412, height: 915, note: 'large phone' },
  { id: '480x1000', width: 480, height: 1000, note: 'very large phone' },
  { id: '600x960', width: 600, height: 960, note: 'small tablet' },
  { id: '800x1280', width: 800, height: 1280, note: 'tablet' },
  { id: '740x360', width: 740, height: 360, note: 'landscape phone' },
  { id: '915x412', width: 915, height: 412, note: 'landscape large phone' },
];

/** Android's "Font size" setting goes from 0.85 to 2.0 (the app caps what it honours, see src/logic/typography.ts; the check passes at 2.0 either way). */
export const TEXT_SCALES = [0.85, 1.0, 1.15, 1.3, 1.5, 2.0];

/** `app` is the bundled Inter; `dejavu` replaces EVERY font with DejaVu Sans, which is much wider: it stands for an OEM system font with larger metrics. */
export const FONTS = [
  { id: 'app', family: null },
  { id: 'dejavu', family: "'DejaVu Sans'" },
];

/** Android's "Display size" (screen zoom): the window has the same physical pixels at a higher density, so fewer dp. Emulated with the device scale factor AND the smaller window. */
export const DISPLAY_ZOOMS = [1.0, 1.15, 1.3];

export const THEMES = ['light', 'dark'];

/** Android never lets the smallest window side go below 320 dp, whatever the display size. */
export const MIN_SMALLEST_WIDTH_DP = 320;

/**
 * System bar / display cutout insets (dp) per profile and orientation, applied with CDP `Emulation.setSafeAreaInsetsOverride`:
 *   none            the window is the screen;
 *   gesture-cutout  a notch / punch-hole (top 48 in portrait, the long side's left edge in landscape) and the 24 dp gesture-navigation strip;
 *   three-button    the status bar (24) and the 48 dp three-button navigation bar (bottom in portrait, right edge in landscape).
 */
export const INSET_PROFILES = {
  none: { portrait: { top: 0, bottom: 0, left: 0, right: 0 }, landscape: { top: 0, bottom: 0, left: 0, right: 0 } },
  'gesture-cutout': { portrait: { top: 48, bottom: 24, left: 0, right: 0 }, landscape: { top: 0, bottom: 24, left: 48, right: 0 } },
  'three-button': { portrait: { top: 24, bottom: 48, left: 0, right: 0 }, landscape: { top: 0, bottom: 0, left: 0, right: 48 } },
};
export const INSET_PROFILE_IDS = Object.keys(INSET_PROFILES);

/** The pass criteria that are numbers. */
export const CRITERIA = {
  /** Smallest side of a control, dp. */
  minTouchTarget: 44,
  /** Smallest contrast ratio of an icon's ink against its background (WCAG 1.4.11 non-text contrast). */
  minGlyphContrast: 3,
  /** Sub-pixel tolerance for "text is outside its box". */
  clipTolerance: 1.5,
  /** Cell sizes (px) the board gates allow, by game kind (boardSize.ts, fourPlayer/presentation.ts, BUGHOUSE_SPEC.md): a smaller cell means the size gate / scrolling must apply. */
  minBoardCell: { twoPlayer: 24, fourPlayer: 20, chaturaji: 28, bughouse: 28, bughouseStandard: 20 },
};

export function orientationOf(size) {
  return size.width > size.height ? 'landscape' : 'portrait';
}

/** The window in dp for a size at a display zoom: the same physical pixels at a higher density, but never below the 320 dp smallest width. */
export function viewportFor(size, zoom) {
  const short = Math.min(size.width, size.height);
  const k = Math.max(1, Math.min(zoom, short / MIN_SMALLEST_WIDTH_DP));
  return { width: Math.round(size.width / k), height: Math.round(size.height / k) };
}

export function insetsFor(profileId, size) {
  return INSET_PROFILES[profileId][orientationOf(size)];
}

/**
 * Every combination of the five axes (sizes x text scales x fonts x display zooms x themes = 720). The system-bar profile is not a sixth full axis (that would triple the run):
 * `insetProfileOf` hands each combination one of the three profiles so every profile is spread over every axis value, and `insetSweep` runs all sizes x all profiles on top.
 */
export function insetProfileOf(sizeIndex, scaleIndex) {
  return INSET_PROFILE_IDS[(sizeIndex + scaleIndex) % INSET_PROFILE_IDS.length];
}

export function fullCombos() {
  const out = [];
  SCREEN_SIZES.forEach((size, si) => {
    TEXT_SCALES.forEach((scale, ti) => {
      FONTS.forEach((font) => {
        DISPLAY_ZOOMS.forEach((zoom) => {
          THEMES.forEach((theme) => {
            out.push({ size, scale, font, zoom, theme, insetProfile: insetProfileOf(si, ti) });
          });
        });
      });
    });
  });
  return out;
}

/** The inset sweep: every size under every system-bar profile, at the default scale / font / zoom / theme. */
export function insetSweep() {
  const out = [];
  for (const size of SCREEN_SIZES) {
    for (const insetProfile of INSET_PROFILE_IDS) {
      out.push({ size, scale: 1.0, font: FONTS[0], zoom: 1.0, theme: 'light', insetProfile });
    }
  }
  return out;
}

/**
 * The quick profile for pull requests (a few minutes): each axis at its extremes and its middle with the others at default, plus the corners that hurt most (small window x
 * wide font x 2.0 scale x 1.3 zoom, both themes). The full 720 run is the nightly's job and the one a screen's author runs before the PR when the screen's layout changed.
 */
export function quickCombos() {
  const base = { size: SCREEN_SIZES[2], scale: 1.0, font: FONTS[0], zoom: 1.0, theme: 'light', insetProfile: 'gesture-cutout' };
  const out = [base];
  for (const size of [SCREEN_SIZES[0], SCREEN_SIZES[1], SCREEN_SIZES[4], SCREEN_SIZES[6], SCREEN_SIZES[7], SCREEN_SIZES[8], SCREEN_SIZES[9]]) out.push({ ...base, size });
  for (const scale of [0.85, 1.3, 2.0]) out.push({ ...base, scale });
  out.push({ ...base, font: FONTS[1] });
  for (const zoom of [1.15, 1.3]) out.push({ ...base, zoom });
  out.push({ ...base, theme: 'dark' });
  out.push({ ...base, insetProfile: 'three-button' });
  out.push({ ...base, size: SCREEN_SIZES[0], scale: 2.0, font: FONTS[1], zoom: 1.3, theme: 'dark', insetProfile: 'three-button' });
  out.push({ ...base, size: SCREEN_SIZES[8], scale: 2.0, font: FONTS[1], zoom: 1.3, theme: 'light', insetProfile: 'gesture-cutout' });
  return out;
}

/** A handful of combinations for the edit-run loop while fixing a screen (never a gate). */
export function miniCombos() {
  const base = { size: SCREEN_SIZES[2], scale: 1.0, font: FONTS[0], zoom: 1.0, theme: 'light', insetProfile: 'gesture-cutout' };
  return [
    base,
    { ...base, size: SCREEN_SIZES[0], scale: 1.3, font: FONTS[1] },
    { ...base, size: SCREEN_SIZES[8] },
    { ...base, size: SCREEN_SIZES[4], scale: 2.0, theme: 'dark', insetProfile: 'three-button' },
  ];
}

export function comboId(c) {
  return `${c.size.id}|x${c.scale}|${c.font.id}|z${c.zoom}|${c.theme}|${c.insetProfile}`;
}
