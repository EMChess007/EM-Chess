import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';

const STORAGE_KEY = 'diagnosticLog:v1';
const MAX_ENTRIES = 100;

// In-memory cache, same pattern as the other *Storage.ts modules in this app — but there's no
// pub/sub here, since the one screen that reads this (DiagnosticLogsScreen) always mounts fresh
// (and thus re-reads via its own useState initializer) rather than staying mounted across a log
// event the way a live settings toggle would.
let entries: string[] = [];

/** Call once at app startup (see App.tsx). Merges with (rather than overwrites) anything already
 * logged in-memory this session, so a call to logDiagnostic() that happens to fire before this
 * has resolved — e.g. from the very same startup effect — isn't silently discarded once this
 * finishes and would otherwise stomp over it. */
export async function restoreDiagnosticLog(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const persisted = raw ? (JSON.parse(raw) as string[]) : [];
    entries = [...persisted, ...entries].slice(-MAX_ENTRIES);
  } catch {
    // Non-critical: keep whatever's already in memory this session.
  }
}

/**
 * Records one line to both the console (as every call site already did before this existed) and
 * a small persisted ring buffer — the only way to see a signed preview/production build's own
 * diagnostic output without a cable + adb logcat. See DiagnosticLogsScreen (reachable from More)
 * for where a user can actually read/copy these to send back. Safe to call before
 * restoreDiagnosticLog() resolves (see its own comment) — this session's entry is never lost,
 * whichever finishes first.
 */
export function logDiagnostic(message: string): void {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  entries = [...entries, line].slice(-MAX_ENTRIES);
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(() => {
    // Non-critical: worst case this one line isn't remembered next launch.
  });
  // Also a Sentry breadcrumb (see src/logic/sentry.ts) — a no-op with no DSN configured, same as
  // Sentry.init() itself. Means any crash report that DOES reach Sentry carries the same recent
  // app-state trail a user could otherwise only hand over via More > Diagnostics > Copy All.
  Sentry.addBreadcrumb({ message, level: 'info', category: 'diagnostic-log' });
}

export function getDiagnosticLog(): string[] {
  return entries;
}

export async function clearDiagnosticLog(): Promise<void> {
  entries = [];
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Non-critical.
  }
}
