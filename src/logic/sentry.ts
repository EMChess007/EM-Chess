import * as Sentry from '@sentry/react-native';

/**
 * Crash/error reporting for real-world usage — initialized once, at app startup (see index.ts).
 * DSN comes from EXPO_PUBLIC_SENTRY_DSN (same EXPO_PUBLIC_* convention as the rest of this app's
 * env vars, e.g. EXPO_PUBLIC_USE_ONLINE_BACKEND — see .env.local), never hardcoded here, so this
 * file is safe to commit regardless of whether a real Sentry project exists yet.
 *
 * With no DSN set, Sentry.init() below is a deliberate no-op (the SDK's own documented behavior
 * for an empty dsn): nothing is captured, nothing is sent, and the app behaves exactly as it did
 * before this file existed. See TESTING.md for exactly what a maintainer needs to do (create a
 * Sentry project, get its DSN, set the env var) to turn this on for real.
 */
export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  Sentry.init({
    dsn,
    enabled: !!dsn,
    // Sends a small, bounded sample of performance traces alongside error reports — cheap enough
    // at this rate to leave on by default; drop to 0 if this ever shows up in a performance
    // budget test as a real cost.
    tracesSampleRate: 0.2,
    // debug: true would print the SDK's own setup/sending diagnostics to the console — leave off
    // outside of actively debugging the Sentry integration itself, per Sentry's own guidance.
    debug: false,
  });
}

/** Wraps the root component so Sentry can also catch render-time errors a plain try/catch or
 * promise handler never would (React's own error boundary mechanism) — see index.ts. */
export const wrapRootComponent = Sentry.wrap;
