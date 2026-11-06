import { registerTouchDebugOverlay } from '../components/devOverlayRegistry';
import TouchDebugOverlay from '../components/TouchDebugOverlay';

// DEV ONLY: App.tsx loads this file under `if (__DEV__)`, which is the only reason the touch-debug overlay exists in a build.
registerTouchDebugOverlay(TouchDebugOverlay);
