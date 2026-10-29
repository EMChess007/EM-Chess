import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Source scans that keep the Android text-fit work from being undone by the next screen somebody writes (branch fix/android-text-fit; src/logic/typography.ts has the story).
 * Every `Text`, `TextInput` and `Pressable` comes from the app's own components (AppText.tsx / AppPressable.tsx), because they are where the bundled font, the line height,
 * the font-scale cap and the 44 dp touch target live.
 */
const root = join(__dirname, '../../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'backend' || name === '.git' || name === '__tests__') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const files = [...walk(join(root, 'src')), join(root, 'App.tsx')];
const rel = (file: string) => relative(root, file).split('\\').join('/');

/** The names a file imports from 'react-native' (all of its import statements from it). */
function reactNativeImports(source: string): string[] {
  const names: string[] = [];
  for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'react-native';/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (name) names.push(name);
    }
  }
  return names;
}

describe('every Text, TextInput and Pressable is the app\'s own', () => {
  it('finds the source files (the scan is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("no file but AppText.tsx imports Text or TextInput from 'react-native'", () => {
    const offenders = files.filter((f) => !f.endsWith('components/AppText.tsx') && !f.endsWith('components/TextFitProbe.tsx') && reactNativeImports(readFileSync(f, 'utf8')).some((n) => n === 'Text' || n === 'TextInput'));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("no file but AppPressable.tsx imports Pressable from 'react-native'", () => {
    const offenders = files.filter((f) => !f.endsWith('components/AppPressable.tsx') && reactNativeImports(readFileSync(f, 'utf8')).some((n) => n === 'Pressable'));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('no file uses react-native\'s Animated.Text or the TouchableOpacity family (they would skip the app font and the touch-target floor)', () => {
    const offenders = files.filter((f) => /Animated\.Text|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback/.test(readFileSync(f, 'utf8')) && !f.endsWith('components/AppText.tsx'));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('AppText is the one place that sets a font family or the font-scale cap default', () => {
    const text = readFileSync(join(root, 'src/components/AppText.tsx'), 'utf8');
    expect(text).toContain('BODY_MAX_FONT_SIZE_MULTIPLIER');
    expect(text).toContain('fitTextStyle(');
    expect(text).toContain('maxFontSizeMultiplier={cap}');
  });
});

describe('no screen shrinks a label with adjustsFontSizeToFit', () => {
  // The browser ignores it (the word overflowed there) and an Android phone applies it to a text box measured with other glyph metrics - the cut "Chess96" of the device report.
  it('adjustsFontSizeToFit appears nowhere in the app', () => {
    const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // a comment may explain why it is gone
    const offenders = files.filter((f) => /adjustsFontSizeToFit/.test(code(f)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe('the bundled font', () => {
  it('ships every weight the families name, with its licence', () => {
    for (const file of ['Inter_400Regular.ttf', 'Inter_500Medium.ttf', 'Inter_600SemiBold.ttf', 'Inter_700Bold.ttf', 'Inter_800ExtraBold.ttf', 'Inter_400Regular_Italic.ttf', 'Inter-OFL.txt']) {
      expect(statSync(join(root, 'assets/fonts', file)).size).toBeGreaterThan(1000);
    }
  });

  it('is loaded by useAppFonts for every family in APP_FONT', () => {
    const hook = readFileSync(join(root, 'src/components/useAppFonts.ts'), 'utf8');
    for (const family of ['regular', 'medium', 'semibold', 'bold', 'extrabold', 'italic']) expect(hook).toContain(`[APP_FONT.${family}]`);
  });

  it('gates the first render of the app on the fonts being settled', () => {
    const app = readFileSync(join(root, 'App.tsx'), 'utf8');
    expect(app).toContain('const fontsSettled = useAppFonts();');
    expect(app).toContain('if (!themeReady || !fontsSettled) {');
  });
});

describe('the 44 dp floor', () => {
  it('is 44 in the Pressable and in the matrix criteria', () => {
    const pressable = readFileSync(join(root, 'src/components/AppPressable.tsx'), 'utf8');
    expect(pressable).toContain('export const MIN_TOUCH_TARGET = 44;');
    const def = readFileSync(join(root, 'scripts/browser/android-matrix-def.mjs'), 'utf8');
    expect(def).toContain('minTouchTarget: 44,');
  });
});
