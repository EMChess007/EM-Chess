// Mutation set for the Android text-fit work (branch fix/android-text-fit): the font / line-height / font-scale rules (src/logic/typography.ts), their application (components/AppText.tsx,
// AppPressable.tsx), the failed-load message and Retry, the request deadline that covers the body (api/client.ts), the on-device probe's thresholds and the scrolling game body.
//
//   MUTATION_ROOT=<this repository> npm run mutate -- scripts/mutation/configs/text-fit.config.cjs        (chunks of at most 20 mutants; `--chunk N` runs one)
//
// The in-repo harness (scripts/mutation) lives on paired/bughouse until master has it; `MUTATION_ROOT` names the checkout to mutate, so the harness of one branch can mutate the code of
// another (the harness only ever READS the root and mutates a copy). The suites: typography / loadError / the request deadline / the scans (logic project) and the rendered AppText,
// AppPressable and load-failed screens (dom project). A name that says EQUIVALENT is proved by a test that pins the proof (typography.test.ts, "a weight it does not understand").
const T = 'src/logic/typography.ts';
const t = (name, find, replace) => [name, T, find, replace];
const A = 'src/components/AppText.tsx';
const P = 'src/components/AppPressable.tsx';
const L = 'src/logic/loadError.ts';
const C = 'src/api/client.ts';
const Q = 'src/logic/textFitProbe.ts';
const H = 'src/screens/HomeScreen.tsx';
const G = 'src/components/GameScreenBody.tsx';

module.exports = {
  root: process.env.MUTATION_ROOT || undefined,
  copy: ['src', 'assets', 'scripts/browser', 'App.tsx', 'package.json', 'tsconfig.json', 'vitest.config.mts'],
  junction: ['node_modules'],
  cmd:
    'npx vitest run src/logic/__tests__/typography.test.ts src/logic/__tests__/loadError.test.ts src/logic/__tests__/apiRequestDeadline.test.ts src/logic/__tests__/textFit.test.ts src/logic/__tests__/textFitProbe.test.ts src/logic/__tests__/spellChessLayout.test.ts src/components/__tests__/appText.dom.test.tsx src/screens/__tests__/loadFailed.dom.test.tsx --reporter=dot --bail=1',
  mutantTimeoutMs: 4 * 60 * 1000,
  mutants: [
    // --- which family draws a weight ---
    t('family: 800 is no longer extra bold', 'if (weight >= 800) return APP_FONT.extrabold;', 'if (weight >= 801) return APP_FONT.extrabold;'),
    t('family: 700 is no longer bold', 'if (weight >= 700) return APP_FONT.bold;', 'if (weight > 700) return APP_FONT.bold;'),
    t('family: 600 is no longer semibold', 'if (weight >= 600) return APP_FONT.semibold;', 'if (weight > 600) return APP_FONT.semibold;'),
    t('family: 500 is no longer medium', 'if (weight >= 500) return APP_FONT.medium;', 'if (weight > 500) return APP_FONT.medium;'),
    t('family: italic is not recognised', "if (fontStyle === 'italic') return APP_FONT.italic;", "if (fontStyle === 'oblique') return APP_FONT.italic;"),
    t('family: fonts that are not usable are used', 'if (!usable) return undefined;', 'if (usable) return undefined;'),
    t("family: the word 'bold' is 600", "fontWeight === 'bold' ? 700", "fontWeight === 'bold' ? 600"),
    t('family: an unreadable weight is regular (EQUIVALENT: NaN compares false with every threshold, so it reaches the final regular anyway)', 'if (!Number.isFinite(weight)) return APP_FONT.regular;', ''),
    // --- line height ---
    t('lineHeight: the default size is 15', 'export const DEFAULT_FONT_SIZE = 14;', 'export const DEFAULT_FONT_SIZE = 15;'),
    t('lineHeight: the floor is 1.2', 'export const MIN_LINE_HEIGHT_RATIO = 1.25;', 'export const MIN_LINE_HEIGHT_RATIO = 1.2;'),
    t('lineHeight: the default is 1.25', 'export const DEFAULT_LINE_HEIGHT_RATIO = 1.3;', 'export const DEFAULT_LINE_HEIGHT_RATIO = 1.25;'),
    t('lineHeight: the default is rounded down', 'return Math.ceil(size * DEFAULT_LINE_HEIGHT_RATIO);', 'return Math.floor(size * DEFAULT_LINE_HEIGHT_RATIO);'),
    t('lineHeight: the floor is rounded down', 'Math.max(lineHeight, Math.ceil(size * MIN_LINE_HEIGHT_RATIO))', 'Math.max(lineHeight, Math.floor(size * MIN_LINE_HEIGHT_RATIO))'),
    t('lineHeight: a roomy line is cut to the floor', 'Math.max(lineHeight, Math.ceil(size * MIN_LINE_HEIGHT_RATIO))', 'Math.min(lineHeight, Math.ceil(size * MIN_LINE_HEIGHT_RATIO))'),
    // --- the caps ---
    t('cap: body text may grow to 1.6', 'export const BODY_MAX_FONT_SIZE_MULTIPLIER = 1.5;', 'export const BODY_MAX_FONT_SIZE_MULTIPLIER = 1.6;'),
    t('cap: dense text may grow to 1.3', 'export const DENSE_MAX_FONT_SIZE_MULTIPLIER = 1.2;', 'export const DENSE_MAX_FONT_SIZE_MULTIPLIER = 1.3;'),
    t('cap: the cap is a floor', 'return Math.min(systemScale, cap);', 'return Math.max(systemScale, cap);'),
    // --- the test-only scale switch ---
    t('switch: honoured in a release build', 'if (!dev || os !== \'web\') return 1;', 'if (dev || os !== \'web\') return 1;'),
    t('switch: honoured on a device, ignored on web', 'if (!dev || os !== \'web\') return 1;', 'if (!dev || os === \'web\') return 1;'),
    t('switch: 0.4 is accepted', 'raw < 0.5', 'raw < 0.4'),
    t('switch: 3.5 is accepted', 'raw > 3', 'raw > 3.5'),
    t('switch: NaN is accepted', '!Number.isFinite(raw) || ', ''),
    // --- fitting a style ---
    t('fit: the scaled line height is rounded down', 'Math.ceil(lineHeight * scale)', 'Math.floor(lineHeight * scale)'),
    t('fit: a style with no size scales nothing', '(style.fontSize ?? DEFAULT_FONT_SIZE) * scale', 'style.fontSize! * scale'),
    t('fit: the size is scaled at scale 1 only', 'if (scale !== 1) {\n    out.fontSize', 'if (scale === 1) {\n    out.fontSize'),
    t('fit: a bundled family keeps the weight', "out.fontWeight = 'normal';", "out.fontWeight = undefined;"),
    t('fit: a family of its own is replaced', 'style.fontFamily ?? resolveFontFamily(style.fontWeight, style.fontStyle, usable)', 'resolveFontFamily(style.fontWeight, style.fontStyle, usable) ?? style.fontFamily'),
    t('fit: a family of its own loses its weight handling', 'if (style.fontFamily === undefined) {', 'if (style.fontFamily !== undefined) {'),
    // --- the components ---
    [ 'AppText: nested text gets its own line height', A, 'if (nested) {', 'if (!nested) {'],
    [ 'AppText: the cap default is not applied', A, 'const cap = maxFontSizeMultiplier ?? BODY_MAX_FONT_SIZE_MULTIPLIER;', 'const cap = maxFontSizeMultiplier ?? 100;'],
    [ 'AppText: the long-word break is on every platform', A, "platformOS() === 'web' ? WEB_BREAK_LONG_WORDS : null", "platformOS() !== 'web' ? WEB_BREAK_LONG_WORDS : null"],
    [ 'AppText: DenseText has no cap of its own', A, 'maxFontSizeMultiplier ?? DENSE_MAX_FONT_SIZE_MULTIPLIER', 'maxFontSizeMultiplier ?? BODY_MAX_FONT_SIZE_MULTIPLIER'],
    [ 'AppPressable: the floor is 40', P, 'export const MIN_TOUCH_TARGET = 44;', 'export const MIN_TOUCH_TARGET = 40;'],
    [ 'AppPressable: the style cannot override the floor', P, '([MIN_SIZE, style] as StyleProp<ViewStyle>)', '([style, MIN_SIZE] as StyleProp<ViewStyle>)'],
    [ 'AppPressable: compact does not opt out', P, 'if (compact) return', 'if (false as boolean) return'],
    // --- a failed load ---
    [ 'loadError: status 0 is not "cannot reach"', L, 'if (status === 0) return SERVER_UNREACHABLE_MESSAGE;', 'if (status === 1) return SERVER_UNREACHABLE_MESSAGE;'],
    [ 'loadError: an empty server message is shown', L, 'message.length > 0', 'message.length >= 0'],
    [ 'Home: Retry does not ask again', H, 'const retryGames = () => setReloadTick((tick) => tick + 1);', 'const retryGames = () => setReloadTick((tick) => tick);'],
    [ 'Home: the load does not depend on Retry', H, '}, [authToken, reloadTick]);', '}, [authToken]);'],
    [ 'Home: the error is not shown in Stats', H, 'gamesError ? (\n            <LoadFailed message={gamesError} onRetry={retryGames} testID="home-stats-failed" />', 'false ? (\n            <LoadFailed message={gamesError!} onRetry={retryGames} testID="home-stats-failed" />'],
    // --- the request deadline ---
    [ 'client: the deadline is 100 times longer', C, 'export const REQUEST_DEADLINE_MS = 6000;', 'export const REQUEST_DEADLINE_MS = 600000;'],
    [ 'client: the deadline does not cover the body', C, '      timedOut,\n    ]);', '    ]);'],
    // --- the on-device probe ---
    [ 'probe: a wrapped text is not a mismatch', Q, 'sample.lineCount > 1 || ', ''],
    [ 'probe: a text wider than its box by 5 is fine', Q, 'sample.textWidth > sample.boxWidth + 0.5', 'sample.textWidth > sample.boxWidth + 5'],
    // --- the scrolling game body ---
    [ 'GameScreenBody: it scrolls when everything fits', G, 'const overflowing = viewportHeight > 0 && contentHeight > viewportHeight + 1;', 'const overflowing = true;'],
    [ 'GameScreenBody: it never scrolls', G, 'scrollEnabled={overflowing}', 'scrollEnabled={false}'],
  ],
};
