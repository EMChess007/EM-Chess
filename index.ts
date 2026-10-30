import { registerRootComponent } from 'expo';

import App from './App';
import { initSentry, wrapRootComponent } from './src/logic/sentry';

// See src/logic/sentry.ts — a no-op without EXPO_PUBLIC_SENTRY_DSN set, so this is safe to run
// unconditionally regardless of whether a Sentry project has been created yet.
initSentry();

// DEV ONLY (command #29): hides the development build's warning toasts during the Android end-to-end run (src/dev/registerE2e.ts). `__DEV__` is the literal false in a release bundle.
if (__DEV__) {
  require('./src/dev/registerE2e');
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(wrapRootComponent(App));
