/**
 * The phone side of the Android end-to-end driver (command #29): adb, uiautomator and screencap behind a few verbs. Why adb + uiautomator and not Maestro or Detox:
 *   - it needs nothing installed beyond the SDK's own adb (Maestro is a JVM tool downloaded from a third party at run time; Detox needs a native test module in the app);
 *   - the app has no react-native-gesture-handler (and must not get one), so a driver that injects REAL touches at screen pixels - `adb shell input tap` - is exactly what a finger does,
 *     and the tests of the touch frames (command #26) need a touch at a computed pixel, not "click the element";
 *   - one process holds both the accessibility tree AND the screenshot, which the pixel checks (a black king drawn white) need and a flow language cannot express;
 *   - it is the same language as the rest of the test stack, so the judges of scripts/browser/android-matrix-pieces.mjs are reused as they are.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from './png.mjs';
import { extractXml, findNodes, findOne, fingerprint, parseHierarchy, visibleWords } from './hierarchy.mjs';
import { PACKAGE } from './checks.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The two phones of the checks: a small one at a large font, and a big one at the normal font. wm size is in pixels; the density gives the dp. */
export const PROFILES = {
  small: { id: 'small', title: '360x640 dp at font scale 1.3', size: '720x1280', density: 320, fontScale: 1.3 },
  large: { id: 'large', title: 'large phone at font scale 1.0', size: null, density: null, fontScale: 1.0 },
};

export class Device {
  constructor({ outDir, serial = process.env.ANDROID_SERIAL, log = console.log }) {
    this.outDir = outDir;
    this.serial = serial;
    this.log = log;
    this.counter = 0;
    this.last = { nodes: [], xml: '' };
    mkdirSync(outDir, { recursive: true });
  }

  adb(args, { timeout = 60_000, binary = false } = {}) {
    const full = this.serial ? ['-s', this.serial, ...args] : args;
    return execFileSync('adb', full, { timeout, encoding: binary ? 'buffer' : 'utf8', maxBuffer: 1 << 27, stdio: ['ignore', 'pipe', 'pipe'] });
  }

  sh(command, options) {
    return this.adb(['shell', command], options);
  }

  // --- the phone's own settings -------------------------------------------------------------------------------------------------------------------------------------------------

  /** Window size and density, font scale. A profile with `size: null` is the emulator's own screen. */
  applyProfile(profile) {
    if (profile.size) {
      this.sh(`wm size ${profile.size}`);
      this.sh(`wm density ${profile.density}`);
    } else {
      this.sh('wm size reset');
      this.sh('wm density reset');
    }
    this.sh(`settings put system font_scale ${profile.fontScale}`);
    this.sh('settings put global window_animation_scale 0');
    this.sh('settings put global transition_animation_scale 0');
    this.sh('settings put global animator_duration_scale 0');
    this.stop();
    this.display = this.readDisplay();
    this.log(`profile ${profile.id}: ${profile.title} -> ${this.display.w}x${this.display.h} px, density ${this.display.density}, ${this.display.dpW}x${this.display.dpH} dp, font scale ${profile.fontScale}`);
    return this.display;
  }

  readDisplay() {
    // `wm size` prints "Physical size: 1080x2400" and, when overridden, "Override size: 720x1280" after it: the override is the one in force.
    const sizes = [...this.sh('wm size').matchAll(/size: (\d+)x(\d+)/g)];
    const densities = [...this.sh('wm density').matchAll(/density: (\d+)/g)];
    if (sizes.length === 0 || densities.length === 0) throw new Error('cannot read the display size or density from wm');
    const w = Number(sizes[sizes.length - 1][1]);
    const h = Number(sizes[sizes.length - 1][2]);
    const d = Number(densities[densities.length - 1][1]);
    return { w, h, density: d, scale: d / 160, dpW: Math.round((w / d) * 160), dpH: Math.round((h / d) * 160) };
  }

  stop() {
    this.sh(`am force-stop ${PACKAGE}`);
  }

  clearData() {
    this.sh(`pm clear ${PACKAGE}`);
  }

  launch() {
    this.sh(`am start -W -n ${PACKAGE}/.MainActivity`, { timeout: 90_000 });
  }

  async relaunch() {
    this.stop();
    await sleep(500);
    this.launch();
  }

  // --- reading the screen -------------------------------------------------------------------------------------------------------------------------------------------------------

  /** The accessibility tree. uiautomator sometimes cannot reach an idle state on a screen that animates: it is retried, then asked again without waiting. */
  async dump({ save } = {}) {
    let lastError = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        // (`uiautomator dump /dev/tty` prints only its trailer through `adb shell`, which has no terminal: the tree goes to a file on the phone and is read back.)
        const out = this.sh('uiautomator dump /sdcard/e2e-ui.xml > /dev/null && cat /sdcard/e2e-ui.xml', { timeout: 40_000 });
        const xml = extractXml(out);
        if (xml) {
          this.last = { xml, nodes: parseHierarchy(xml) };
          if (save) writeFileSync(join(this.outDir, `${save}.xml`), xml);
          // Android's one-time "Viewing full screen - swipe down to exit" notice (the app hides the navigation bar) sits over the app: "Got it" dismisses it, once.
          const gotIt = this.last.nodes.find((n) => n.text === 'Got it' && n.bounds && n.pkg !== PACKAGE);
          if (gotIt && !this.dismissing) {
            this.dismissing = true;
            this.tap(gotIt.bounds.cx, gotIt.bounds.cy);
            await sleep(800);
            this.dismissing = false;
            attempt = -1; // read the tree again, now without the notice
            continue;
          }
          return this.last.nodes;
        }
        lastError = out.slice(0, 200);
      } catch (e) {
        lastError = String(e.stderr || e.message).slice(0, 200);
      }
      await sleep(700);
    }
    throw new Error(`uiautomator dump failed: ${lastError}`);
  }

  screenshot() {
    return decodePng(this.adb(['exec-out', 'screencap', '-p'], { binary: true, timeout: 30_000 }));
  }

  /** Saves the screen as <name>.png and its tree as <name>.xml in the output folder (the artifacts). */
  async snapshot(name) {
    const buf = this.adb(['exec-out', 'screencap', '-p'], { binary: true, timeout: 30_000 });
    writeFileSync(join(this.outDir, `${name}.png`), buf);
    try {
      writeFileSync(join(this.outDir, `${name}.xml`), this.last.xml);
    } catch {
      /* nothing dumped yet */
    }
  }

  /** The tree and a screenshot taken straight after it, decoded. */
  async look() {
    const nodes = await this.dump();
    return { nodes, png: this.screenshot() };
  }

  // --- touching -------------------------------------------------------------------------------------------------------------------------------------------------------------------

  tap(x, y) {
    this.sh(`input tap ${Math.round(x)} ${Math.round(y)}`);
  }

  swipe(x1, y1, x2, y2, ms = 300) {
    this.sh(`input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${ms}`);
  }

  key(code) {
    this.sh(`input keyevent ${code}`);
  }

  /** Types text into the focused field. Letters, digits and @ . _ - only: nothing the shell or `input` would reinterpret. */
  type(text) {
    if (!/^[A-Za-z0-9@._-]+$/.test(text)) throw new Error('type() takes letters, digits and @ . _ - only');
    this.sh(`input text ${text}`);
  }

  // slow swipes (700 ms): a quick one leaves the list flinging, and a tap on a moving list lands on whatever passes under the finger
  scrollDown() {
    const { w, h } = this.display;
    this.swipe(w / 2, h * 0.72, w / 2, h * 0.34, 700);
  }

  scrollUp() {
    const { w, h } = this.display;
    this.swipe(w / 2, h * 0.34, w / 2, h * 0.72, 700);
  }

  // --- waiting and finding --------------------------------------------------------------------------------------------------------------------------------------------------

  /** Calls `test(nodes)` on a fresh tree until it answers truthy; returns that answer. The bound only turns a hang into a failure. */
  async waitFor(what, test, timeoutMs = 20_000, stepMs = 600) {
    const t0 = Date.now();
    let nodes = [];
    for (;;) {
      try {
        nodes = await this.dump();
        const answer = test(nodes);
        if (answer) return answer === true ? nodes : answer; // `true` = "the screen is as wanted": hand back the tree it was judged on
      } catch (e) {
        if (Date.now() - t0 > timeoutMs) throw e;
      }
      if (Date.now() - t0 > timeoutMs) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}; on screen: ${visibleWords(nodes, 40).join(' | ')}`);
      await sleep(stepMs);
    }
  }

  /** The tree once it stands still: two trees in a row that are the same (a scroll's fling, an animation, a list that is still laying out). */
  async stable() {
    let nodes = await this.dump();
    for (let i = 0; i < 4; i++) {
      const again = await this.dump();
      if (fingerprint(again) === fingerprint(nodes)) return again;
      nodes = again;
    }
    return nodes;
  }

  /**
   * The node a step names, scrolling down when it is not on screen (the Play menu is longer than a phone). `{ text, below: "Local" }` is the first `text` under the heading `below`: on
   * the phone only what is on screen exists, so "the second Classic" of the web matrix (document order) is "the Classic under Local" here.
   */
  async find(step, { scrolls = 6 } = {}) {
    if (step.below !== undefined) {
      await this.find({ text: step.below }, { scrolls });
      for (let i = 0; i <= scrolls; i++) {
        const nodes = await this.stable();
        const heading = findOne(nodes, { text: step.below });
        const hit = heading ? findNodes(nodes, { text: step.text }).find((n) => n.bounds.y1 >= heading.bounds.y2 - 2) : null;
        if (hit) return hit;
        if (i === scrolls) throw new Error(`cannot find ${JSON.stringify(step)}; on screen: ${visibleWords(nodes, 40).join(' | ')}`);
        this.scrollDown();
        await sleep(700);
      }
    }
    let nodes = await this.dump();
    let node = findOne(nodes, step);
    for (let i = 0; node === null && i < scrolls; i++) {
      const before = fingerprint(nodes);
      this.scrollDown();
      await sleep(700);
      nodes = await this.stable();
      node = findOne(nodes, step);
      if (node === null && fingerprint(nodes) === before) break; // nothing moved: the end of the list
    }
    if (node === null) throw new Error(`cannot find ${JSON.stringify(step)}; on screen: ${visibleWords(nodes, 40).join(' | ')}`);
    return node;
  }

  async tapStep(step, settleMs = 700) {
    if (step.wait) return sleep(step.wait);
    if (step.fill) throw new Error('fill steps are not used on the phone');
    const node = await this.find(step);
    this.tap(node.bounds.cx, node.bounds.cy);
    await sleep(settleMs);
  }

  async runSteps(steps) {
    for (const step of steps) await this.tapStep(step);
  }

  /** Is the app's first screen up (the tab bar's Play)? */
  async waitHome(timeoutMs = 240_000) {
    return this.waitFor('the Home screen', (nodes) => (findNodes(nodes, { text: 'Play' }).length > 0 && findNodes(nodes, { text: 'More' }).length > 0 ? nodes : false), timeoutMs, 1500);
  }

  logcat(lines = 400) {
    try {
      return this.adb(['logcat', '-d', '-t', String(lines), '-s', 'ReactNative:V', 'ReactNativeJS:V', 'AndroidRuntime:E', 'DEBUG:E', 'ActivityManager:W'], { timeout: 30_000 });
    } catch (e) {
      return `logcat failed: ${e.message}`;
    }
  }
}
