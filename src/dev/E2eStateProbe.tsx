import { useEffect, useRef } from 'react';
import { PixelRatio, View } from 'react-native';
import type { E2eStateProbeProps } from '../components/devOverlayRegistry';
import { e2eReport } from './e2eBeacon';

/**
 * DEV ONLY (command #30): the invisible state element of a board in the Android end-to-end build. Two channels, because the driver's two ways of reading the app failed in different ways:
 *   - an accessibility element (`testID` e2e-state-<channel>, its label is the JSON of the state): it costs nothing and shows in the tree whenever the tree is fresh;
 *   - the beacon (e2eBeacon.ts): the same JSON, POSTed to the driver on every change, together with the board's rectangle in SCREEN PIXELS (`measureInWindow` x the display density), which is what
 *     a touch needs. This path does not depend on `uiautomator dump` reaching an idle UI.
 * It is 2 x 2 dp, almost transparent, takes no touch and sits at the board's corner: it changes no layout and no pixel judged by the checks.
 */
let mounts = 0;

export default function E2eStateProbe({ channel, state, rectOf }: E2eStateProbeProps) {
  const json = JSON.stringify(state);
  // every mounted board has its own number, so a new game with the same position and rectangle as the last is still reported (the beacon sends only CHANGED states)
  const mount = useRef(++mounts).current;
  useEffect(() => {
    const report = (rect: Record<string, number> | null) => e2eReport(`state-${channel}`, { ...JSON.parse(json), mount, ...(rect ? { rect } : {}) });
    const measure = () => {
      const node = rectOf?.current;
      if (node?.measureInWindow) {
        const ratio = PixelRatio.get();
        node.measureInWindow((x, y, w, h) => {
          if (!(w > 0 && h > 0)) return;
          const rect = { x: Math.round(x * ratio), y: Math.round(y * ratio), w: Math.round(w * ratio), h: Math.round(h * ratio) };
          // Where the app's ROOT view sits in the window = the board in the window frame minus the board in the root frame (`measure`: what pageX / pageY are relative to). Zero when the app
          // is edge-to-edge; the height of the status bar on the phone of command #26, where the two frames differ. The run checks it, so "the emulator reproduces the phone's frame" is a fact.
          const measure = (node as { measure?: (cb: (x: number, y: number, w: number, h: number, pageX: number, pageY: number) => void) => void }).measure;
          // (the raw numbers are reported too: the first run with this probe printed "null" for the offset, i.e. a NaN, and a reader needs to see why)
          if (typeof measure !== 'function') return report({ ...rect, measureIsFunction: 0 });
          measure.call(node, (mx, my, mw, mh, pageX, pageY) => {
            const offsetX = rect.x - Math.round(pageX * ratio);
            const offsetY = rect.y - Math.round(pageY * ratio);
            report({ ...rect, ...(Number.isFinite(offsetX) && Number.isFinite(offsetY) ? { rootOffsetX: offsetX, rootOffsetY: offsetY } : { measureNaN: 1 }), pageX: Number(pageX) || 0, pageY: Number(pageY) || 0, measureY: Number(my) || 0, measureH: Number(mh) || 0, ratio });
          });
        });
      } else report(null);
    };
    // the state at once, then the rectangle once the layout has settled (a rectangle measured in the first frame can be 0 x 0 or one the screen is about to move)
    report(null);
    const timers = [setTimeout(measure, 0), setTimeout(measure, 600)];
    return () => timers.forEach(clearTimeout);
  }, [channel, json, rectOf, mount]);
  return <View pointerEvents="none" testID={`e2e-state-${channel}`} accessible accessibilityLabel={json} style={{ position: 'absolute', left: 0, top: 0, width: 2, height: 2, opacity: 0.02 }} />;
}
