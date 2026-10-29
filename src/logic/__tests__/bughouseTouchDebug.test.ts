import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The dev-only touch-debug overlay (command #26) must not exist in a release build. It reaches a screen only through devOverlayRegistry.ts, which is filled by src/dev/registerTouchDebug.ts,
 * which App.tsx `require`s inside `if (__DEV__)` - a literal false in a release bundle, so the require and everything behind it are dead code. These scans keep it that way: no other file
 * may import the overlay or its registration (an import would pull it into every bundle), and the require must stay behind the guard.
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
const rel = (f: string) => relative(root, f).split('\\').join('/');
const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the touch-debug overlay is development-only', () => {
  it('nothing imports the overlay except its own registration and the registry\'s type', () => {
    const importers = files.filter((f) => /from\s+'[^']*TouchDebugOverlay'/.test(code(f)));
    expect(importers.map(rel).sort()).toEqual(['src/components/devOverlayRegistry.ts', 'src/dev/registerTouchDebug.ts']);
    // the registry imports only the TYPE of the props
    expect(code(join(root, 'src/components/devOverlayRegistry.ts'))).toContain("import type { TouchDebugOverlayProps } from './TouchDebugOverlay';");
  });

  it('nothing imports the registration: App.tsx requires it, inside `if (__DEV__)`', () => {
    const importers = files.filter((f) => /from\s+'[^']*registerTouchDebug'/.test(code(f)));
    expect(importers).toEqual([]);
    const app = code(join(root, 'App.tsx'));
    expect(app).toMatch(/if \(__DEV__\) \{\s*require\('\.\/src\/dev\/registerTouchDebug'\);\s*\}/);
    expect(app.match(/registerTouchDebug/g)).toHaveLength(1);
  });

  it('the screen shows the switch only in a development build with the overlay registered', () => {
    const screen = code(join(root, 'src/screens/BughouseGameScreen.tsx'));
    expect(screen).toContain("const devTouchDebug = typeof __DEV__ !== 'undefined' && __DEV__ && getTouchDebugOverlay() !== null;");
    expect(screen).toContain('touchDebug={devTouchDebug && touchDebug}');
    expect(screen).toMatch(/\{devTouchDebug && dual && \(/);
  });

  it('the hook reports fingers only when asked (onDebug), and the board draws only a registered overlay', () => {
    const hook = code(join(root, 'src/components/useBoardTouches.ts'));
    expect(hook).toContain('const report = optionsRef.current.onDebug;');
    expect(hook).toContain('if (!report) return;');
    const board = code(join(root, 'src/components/BughouseBoard.tsx'));
    expect(board).toContain('const DebugOverlay = getTouchDebugOverlay();');
    expect(board).toContain('touches && debugFingers && DebugOverlay');
  });

  it('is never switched on by default', () => {
    expect(code(join(root, 'src/screens/BughouseGameScreen.tsx'))).toContain('const [touchDebug, setTouchDebug] = useState(false);');
  });
});

describe('the single-human layouts keep the PanResponder path (the one that measures in the touch\'s own frame)', () => {
  it('BughouseBoard listens through useBoardGestures unless the dual layout gives it raw touches', () => {
    const board = code(join(root, 'src/components/BughouseBoard.tsx'));
    expect(board).toContain('touches ? (surface ? {} : touches.gridProps) : interactive ? gestures.panHandlers : {}');
    // useBoardGestures reads the origin with measure() (pageX / pageY of the root frame) and never with getBoundingClientRect
    const gestures = code(join(root, 'src/components/useBoardGestures.ts'));
    expect(gestures).toContain('node.measure(');
    expect(gestures).not.toContain('getBoundingClientRect');
  });

  it('only the dual layout passes raw touches to its blocks', () => {
    const screen = code(join(root, 'src/screens/BughouseGameScreen.tsx'));
    expect(screen).toContain('rawTouch={dual}');
    const block = code(join(root, 'src/components/BughouseBoardBlock.tsx'));
    expect(block).toContain('touches={props.rawTouch ? touches : undefined}');
  });
});
