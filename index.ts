import { registerRootComponent } from 'expo';

import App from './App';
import { initSentry, wrapRootComponent } from './src/logic/sentry';

// See src/logic/sentry.ts — a no-op without EXPO_PUBLIC_SENTRY_DSN set, so this is safe to run
// unconditionally regardless of whether a Sentry project has been created yet.
initSentry();

// E2E ONLY (command #29, #46): registers the Android end-to-end run's helpers (src/dev/registerE2e.ts). The gate is (`__DEV__` || the build-time switch EXPO_PUBLIC_E2E_BUILD === '1'): `__DEV__` is the
// literal false in a release bundle, and the switch is inlined at bundle time, so a production bundle (switch absent) folds the whole condition to false and bundles none of it
// (src/logic/__tests__/e2eBuildSwitch.test.ts exports a bundle with the switch off and proves it). The comparison is written out here, not imported: a constant imported from another module
// is not folded, and the require would stay in the bundle.
if (__DEV__ || process.env.EXPO_PUBLIC_E2E_BUILD === '1') {
  require('./src/dev/registerE2e');
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(wrapRootComponent(App));
