import { registerRootComponent } from 'expo';

import App from './App';
import { initSentry, wrapRootComponent } from './src/logic/sentry';

// See src/logic/sentry.ts — a no-op without EXPO_PUBLIC_SENTRY_DSN set, so this is safe to run
// unconditionally regardless of whether a Sentry project has been created yet.
initSentry();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(wrapRootComponent(App));
