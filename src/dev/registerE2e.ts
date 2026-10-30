import { LogBox } from 'react-native';

/**
 * DEV ONLY, and only for the Android end-to-end run (command #29, .github/workflows/android-e2e.yml). index.ts loads this file under `if (__DEV__)`, a literal false in a release bundle, so
 * a release build contains none of it. The run uses a development build (it must reach the run's own backend: apiBaseUrl.ts sends a release build to the deployed one), and a development
 * build draws a yellow LogBox toast over the bottom of the screen for every warning, which would cover the tab bar and hide text from the checks. EXPO_PUBLIC_E2E=1 (set by the run's own Metro
 * process, never in a workflow `env` or a checked-in .env) silences those toasts; an error that crashes the app still shows its red screen, which the run reports as a failure.
 */
if (process.env.EXPO_PUBLIC_E2E === '1') {
  LogBox.ignoreAllLogs();
}
