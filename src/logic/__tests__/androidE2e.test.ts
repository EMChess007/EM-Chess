import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  boardFromScreenshot,
  startPositionMarkers,
  crashIssues,
  cornerColour,
  judgePieceCell,
  judgeSelection,
  markerFromWords,
  MIN_WIDTH_PER_LETTER,
  orientationFromA1,
  parseGalleryLabel,
  parseTextFit,
  SELECTED_RGB,
  selectedSquares,
  squareRect,
  textIssues,
} from '../../../scripts/android/lib/checks.mjs';
import { byClass, extractXml, findNodes, findOne, parseBounds, parseHierarchy } from '../../../scripts/android/lib/hierarchy.mjs';
import { crop, decodePng, encodePng, solid } from '../../../scripts/android/lib/png.mjs';
import { PROFILES } from '../../../scripts/android/lib/device.mjs';

/**
 * THE JUDGEMENTS OF THE ANDROID END-TO-END RUN (command #29), on synthetic input: each one must report the old Android-only bug it exists for, and none of them a correct screen. The run
 * itself (scripts/android/e2e.mjs) needs an emulator and only runs in CI (.github/workflows/android-e2e.yml); these are the parts that can be proved without one.
 */
const root = join(__dirname, '../../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const node = (extra: Record<string, unknown>) => ({ index: 0, parent: -1, depth: 0, text: '', desc: '', id: '', cls: 'android.widget.TextView', pkg: 'com.emchess.app', bounds: null, clickable: false, enabled: true, scrollable: false, password: false, ...extra });
const box = (x1: number, y1: number, x2: number, y2: number) => parseBounds(`[${x1},${y1}][${x2},${y2}]`);

describe('png', () => {
  it('encodes and decodes what it was given, and crops', () => {
    const image = solid(5, 4, [10, 20, 30]);
    image.data.set([200, 100, 50, 255], (1 * 5 + 2) * 4);
    const back = decodePng(encodePng(image));
    expect([back.width, back.height]).toEqual([5, 4]);
    expect(Array.from(back.data)).toEqual(Array.from(image.data));
    const piece = crop(back, { x: 2, y: 1, w: 2, h: 2 });
    expect([piece.width, piece.height]).toEqual([2, 2]);
    expect(Array.from(piece.data.subarray(0, 4))).toEqual([200, 100, 50, 255]);
  });

  it('reads the bundled piece assets (palette and RGBA PNGs)', () => {
    for (const theme of ['cburnett', 'merida', 'checkers']) {
      const image = decodePng(readFileSync(join(root, 'assets', 'pieces', theme, 'bk.png')));
      expect(image.width).toBeGreaterThan(8);
      expect(image.data.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
    }
  });
});

describe('the accessibility tree', () => {
  const xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.emchess.app" content-desc="" clickable="false" scrollable="false" bounds="[0,0][720,1280]">
    <node index="0" text="" resource-id="bughouse-start" class="android.view.ViewGroup" package="com.emchess.app" content-desc="Start" clickable="true" bounds="[40,900][680,1000]">
      <node index="0" text="Start &amp; play" resource-id="" class="android.widget.TextView" package="com.emchess.app" content-desc="" clickable="false" bounds="[200,920][520,980]" />
    </node>
    <node index="1" text="Hom" resource-id="com.emchess.app:id/tab" class="android.widget.TextView" package="com.emchess.app" content-desc="" bounds="[10,1200][50,1260]" />
  </node>
</hierarchy>
UI hierchary dumped to: /dev/tty`;

  it('parses nodes, nesting, entities, ids without the package prefix, and finds the XML in shell output', () => {
    const nodes = parseHierarchy(extractXml(xml) as string);
    expect(nodes).toHaveLength(4);
    expect(nodes[2].text).toBe('Start & play');
    expect(nodes[2].parent).toBe(1);
    expect(nodes[1].clickable).toBe(true);
    expect(nodes[3].id).toBe('tab');
    expect(nodes[2].bounds).toMatchObject({ x1: 200, y2: 980, cx: 360, cy: 950 });
    expect(extractXml('ERROR: could not get idle state')).toBeNull();
  });

  it('finds a control by text, label or id; a button and the text inside it are ONE control', () => {
    const nodes = parseHierarchy(extractXml(xml) as string);
    expect(findNodes(nodes, { id: 'bughouse-start' })).toHaveLength(1);
    expect(findNodes(nodes, { label: 'Start' })).toHaveLength(1);
    expect(findOne(nodes, { text: 'Start & play' })?.bounds?.cx).toBe(360);
    const both = parseHierarchy(
      `<hierarchy><node text="Classic" content-desc="Classic" class="x" bounds="[0,0][100,100]"><node text="Classic" class="y" bounds="[10,10][90,60]" /></node></hierarchy>`,
    );
    expect(findNodes(both, { text: 'Classic' })).toHaveLength(1);
    expect(findNodes(both, { text: 'CLASSIC' })).toHaveLength(0);
    expect(findNodes(both, { text: 'CLASSIC', ci: true })).toHaveLength(1);
    expect(byClass(both, 'x')).toHaveLength(1);
  });
});

describe('text on the screen', () => {
  const screen = { w: 720, h: 1280, scale: 2 };
  it('reports a label clipped to under half its width (the net; the on-device probe is the sharp instrument) and a text that leaves the window', () => {
    const clipped = [node({ text: 'Home', bounds: box(10, 1200, 45, 1260) })]; // 35 px for 4 letters at 60 px high
    expect(textIssues(clipped, screen).map((i) => i.kind)).toEqual(['narrow']);
    const outside = [node({ text: 'A long line', bounds: box(600, 100, 800, 150) })];
    expect(textIssues(outside, screen).map((i) => i.kind)).toEqual(['outside']);
    // a text the scroll view moved out of sight has no positive box (even a negative height): nothing is on the screen to judge
    expect(textIssues([node({ text: 'Zero', bounds: box(10, 10, 10, 40) }), node({ text: 'Negative', bounds: box(10, 100, 250, -35) })], screen)).toEqual([]);
    // a box taller than one line is a container around the label, not its box (86 x 82 px for "Yellow" at density 2 = 41 dp), unless the scale says it is small
    expect(textIssues([node({ text: 'Yellow', bounds: box(10, 100, 96, 182) })], { ...screen, scale: 2 })).toEqual([]);
    expect(textIssues([node({ text: 'Yellow', bounds: box(10, 100, 50, 150) })], { ...screen, scale: 2 }).map((i) => i.kind)).toEqual(['narrow']);
  });

  it('accepts text that fits, a narrow word that is not clipped, wrapped text and an input', () => {
    expect(textIssues([node({ text: 'Home', bounds: box(10, 1200, 130, 1260) })], screen)).toEqual([]);
    expect(textIssues([node({ text: 'Filter', bounds: box(10, 100, 118, 160) })], screen)).toEqual([]); // 0.30 per letter
    expect(textIssues([node({ text: 'Play against bots', bounds: box(10, 100, 100, 400) })], screen)).toEqual([]); // spaces: it may wrap
    expect(textIssues([node({ text: 'Email', cls: 'android.widget.EditText', bounds: box(10, 100, 20, 160) })], screen)).toEqual([]);
    // command #30: a clock reading is narrow by its colon, not clipped (the online game's "0:00" in a 38 x 48 px box was reported at 0.198) - and a word of the same box is still reported
    expect(textIssues([node({ text: '0:00', bounds: box(10, 100, 48, 148) })], screen)).toEqual([]);
    expect(textIssues([node({ text: '12:34', bounds: box(10, 100, 48, 148) })], screen)).toEqual([]);
    expect(textIssues([node({ text: 'Home', bounds: box(10, 100, 48, 148) })], screen).map((i) => i.kind)).toEqual(['narrow']);
    expect(MIN_WIDTH_PER_LETTER).toBe(0.2);
  });

  it('reads the on-device text-fit probe and fails on a mismatch', () => {
    const ok = ['[TextFit] android 34, pixel ratio 2, font scale 1.3', '[TextFit] app font: 6 of 6 strings fit their box', '[TextFit] system font: 6 of 6 strings fit their box'];
    expect(parseTextFit(ok)).toMatchObject({ mismatches: [], bundledFontMissing: false });
    const bad = [ok[0], '[TextFit] app font: 5 of 6 strings fit their box - MISMATCH: "Home" box 40x20, text 50x20 in 1 line(s)', ok[2]];
    expect(parseTextFit(bad)?.mismatches).toHaveLength(1);
    expect(parseTextFit([ok[0]])).toBeNull();
    expect(parseTextFit([ok[0].replace('2,', '2, bundled font NOT loaded,'), ok[1], ok[2]])?.bundledFontMissing).toBe(true);
  });

  it('reports a crash dialog, a red screen and another app on top', () => {
    expect(crashIssues([node({ text: 'EM-Chess keeps stopping' })])).toHaveLength(1);
    expect(crashIssues([node({ text: 'Unable to load script' })])).toHaveLength(1);
    expect(crashIssues([node({ text: 'System UI', pkg: 'com.android.systemui' })])).toEqual(['another app is on top: com.android.systemui']);
    expect(crashIssues([node({ text: 'Play' })])).toEqual([]);
  });
});

/** A board photograph: 8 x 8 cells of `cell` px in two tones, the cell `selected` ("e2") painted the selected green, seen from `orientation`. */
function boardImage(cell: number, orientation: 'w' | 'b', selected: string | null) {
  const board = { x1: 20, y1: 40, w: cell * 8, h: cell * 8 };
  const image = solid(cell * 8 + 40, cell * 8 + 80, [255, 255, 255]);
  for (const file of 'abcdefgh') {
    for (let rank = 1; rank <= 8; rank++) {
      const square = file + rank;
      const r = squareRect(board, orientation, square);
      const tone = (file.charCodeAt(0) - 97 + rank) % 2 === 0 ? [240, 217, 181] : [181, 136, 99];
      const colour = square === selected ? SELECTED_RGB : tone;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) image.data.set([...colour, 255], (Math.round(y) * image.width + Math.round(x)) * 4);
    }
  }
  return { board, image };
}

describe('boards and touches', () => {
  it('maps squares to pixels for both orientations', () => {
    const board = { x1: 100, y1: 200, w: 400, h: 400 };
    expect(squareRect(board, 'w', 'a1')).toMatchObject({ x: 100, y: 550, cx: 125, cy: 575 });
    expect(squareRect(board, 'w', 'h8')).toMatchObject({ x: 450, y: 200 });
    expect(squareRect(board, 'b', 'a1')).toMatchObject({ x: 450, y: 200 });
    expect(squareRect(board, 'b', 'e2')).toMatchObject({ x: 250, y: 250 });
    expect(orientationFromA1(board, { cx: 125, cy: 575 })).toBe('w');
    expect(orientationFromA1(board, { cx: 475, cy: 225 })).toBe('b');
  });

  it('accepts the right selected square and reports a tap one rank low (the bug of command #26)', () => {
    for (const orientation of ['w', 'b'] as const) {
      const right = boardImage(40, orientation, 'e2');
      expect(selectedSquares(right.image, right.board, orientation)).toEqual(['e2']);
      expect(judgeSelection(right.image, right.board, orientation, 'e2')).toBeNull();
      const low = boardImage(40, orientation, orientation === 'w' ? 'e1' : 'e3'); // what a tap one rank low selected
      expect(judgeSelection(low.image, low.board, orientation, 'e2')).toMatch(/tapped e2, the board shows (e1|e3) selected/);
      const none = boardImage(40, orientation, null);
      expect(judgeSelection(none.image, none.board, orientation, 'e2')).toMatch(/nothing selected/);
    }
  });

  it('finds the board in a PHOTOGRAPH (the screens whose tree lags the screen) and refuses an image without one', () => {
    const { board, image } = boardImage(40, 'w', null);
    expect(boardFromScreenshot(image)).toMatchObject({ x1: board.x1, y1: board.y1, w: board.w, h: board.h });
    expect(boardFromScreenshot(solid(200, 200, [255, 255, 255]))).toBeNull();
    // a tan button of the same family as the light squares does not move the board
    const withButton = boardImage(40, 'w', null).image;
    for (let y = 365; y < 395; y++) for (let x = 20; x < 200; x++) withButton.data.set([240, 217, 181, 255], (y * withButton.width + x) * 4);
    expect(boardFromScreenshot(withButton)).toMatchObject({ y1: 40, h: 320 });
    const markers = startPositionMarkers() as Record<string, string>;
    expect(Object.keys(markers)).toHaveLength(32);
    expect([markers.e1, markers.d8, markers.a2, markers.h7]).toEqual(['wk', 'bq', 'wp', 'bp']);
  });

  it('reads a corner colour inside the image only', () => {
    const image = solid(10, 10, [1, 2, 3]);
    expect(cornerColour(image, { x: 0, y: 0 })).toEqual([1, 2, 3]);
    expect(cornerColour(image, { x: 50, y: 50 })).toBeNull();
  });
});

/** A 40 x 40 cell of the square colour with a disc of the piece's fill (the same synthetic cell the matrix tests use). */
function pieceCell(square: number[], fill: number[], radius = 14) {
  const image = solid(40, 40, [...square, 255] as [number, number, number, number]);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) if ((x - 20) ** 2 + (y - 20) ** 2 <= radius ** 2) image.data.set([...fill, 255], (y * 40 + x) * 4);
  return image;
}

describe('pieces', () => {
  const light = [240, 217, 181];
  const dark = [181, 136, 99];
  const cell = { x: 0, y: 0, w: 40, h: 40 };
  it('accepts a dark black piece and a white one on both squares', () => {
    for (const square of [light, dark]) {
      expect(judgePieceCell(pieceCell(square, [0x1d, 0x1d, 0x1d]), cell, 'bk')).toBeNull();
      expect(judgePieceCell(pieceCell(square, [0xfa, 0xfa, 0xfa]), cell, 'wk')).toBeNull();
    }
  });

  it('reports a black king drawn white (command #27b) and a missing piece, whatever the square', () => {
    for (const square of [light, dark]) {
      expect(judgePieceCell(pieceCell(square, [0xfa, 0xfa, 0xfa]), cell, 'bk')).toMatch(/bk: drawn rgb\(250,250,250\)/);
      expect(judgePieceCell(pieceCell(square, square), cell, 'bq')).toMatch(/no piece found/);
    }
    expect(judgePieceCell(pieceCell(light, [0, 0, 0]), { x: 0, y: 0, w: 4, h: 4 }, 'bk')).toMatch(/too small/);
  });

  it('reads the markers and the gallery labels the app prints', () => {
    expect(markerFromWords('e8, board A, Black King')).toBe('bk');
    expect(markerFromWords('white knight')).toBe('wn');
    expect(markerFromWords('e4, board B')).toBeNull();
    expect(parseGalleryLabel('Merida on the Ocean board: black king on a dark square')).toEqual({ theme: 'Merida', board: 'Ocean', marker: 'bk', square: 'dark' });
    expect(parseGalleryLabel('Merida: black king on a dark square')).toBeNull();
  });
});

describe('a king\'s team badge (command #30)', () => {
  // a 60 x 60 "screenshot" of one Bughouse cell: a light square, a black king (dark disc, grey ring) and the yellow Team 2 badge in the top-right corner
  const withBadge = () => {
    const size = 60;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x - 29.5, y - 31.5);
        const c = d <= 12 ? [0x1d, 0x1d, 0x1d] : d <= 14 ? [0x66, 0x66, 0x66] : [0xf0, 0xd9, 0xb5];
        data.set([c[0], c[1], c[2], 255], (y * size + x) * 4);
      }
    }
    for (let y = 3; y < 14; y++) for (let x = 46; x < 57; x++) data.set([0xf9, 0xa8, 0x25, 255], (y * size + x) * 4);
    return { width: size, height: size, data };
  };

  it('the badge is not part of the piece: with it a black king judged "light", masked it is clean', () => {
    const shot = withBadge();
    const cell = { x: 0, y: 0, w: 60, h: 60 };
    expect(judgePieceCell(shot, cell, 'bk')).toContain('of the piece is light');
    expect(judgePieceCell(shot, cell, 'bk', null, undefined, true)).toBeNull();
    // the mask does not hide a king that really is wrong: a WHITE disc in the same cell is still reported
    const white = withBadge();
    for (let i = 0; i < white.data.length; i += 4) if (white.data[i] === 0x1d) white.data.set([0xfa, 0xfa, 0xfa], i);
    expect(judgePieceCell(white, cell, 'bk', null, undefined, true)).toContain('bk: drawn rgb');
  });
});

describe('profiles, workflow and the test-only switch', () => {
  it('the two phones are the ones the command names', () => {
    expect(PROFILES.small).toMatchObject({ size: '720x1280', density: 320, fontScale: 1.3 }); // 360 x 640 dp
    expect(PROFILES.large).toMatchObject({ size: null, fontScale: 1.0 });
  });

  it('the log-toast switch is loaded only from index.ts inside `if (__DEV__)`, imported by nothing else, and read from one variable', () => {
    const index = code(read('index.ts'));
    expect(index).toMatch(/if \(__DEV__\) \{\s*require\('\.\/src\/dev\/registerE2e'\);\s*\}/);
    expect(read('App.tsx')).not.toContain('registerE2e');
    const registration = code(read('src/dev/registerE2e.ts'));
    expect(registration).toContain("process.env.EXPO_PUBLIC_E2E === '1'");
    expect(registration).toContain('LogBox.ignoreAllLogs()');
  });

  it('the workflow uses no secret, keeps the test switches out of `env:` and runs on the paired branch and master', () => {
    const workflow = read('.github/workflows/android-e2e.yml');
    expect(workflow).not.toMatch(/\$\{\{\s*secrets\./);
    expect(workflow).toMatch(/name: android-e2e/);
    expect(workflow).toMatch(/paired\/bughouse/);
    for (const name of ['AUTH_RATE_LIMIT_TEST_OVERRIDE', 'FOUR_TEST_SETUP_ENDPOINT', 'FOUR_TEST_SEED']) expect(workflow).not.toContain(name);
  });
});
