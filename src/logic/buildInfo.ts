import Constants from 'expo-constants';

/**
 * The build identifier shown in More > Diagnostics and on the Piece gallery (command #27d): which commit the phone runs and when its bundle was configured. app.config.js injects it at bundle
 * time (scripts/build-info.cjs); a value that is not what it expects shows as "unknown" and never throws.
 */
export interface BuildInfo {
  commit: string;
  builtAt: string;
  /** One line for a screenshot: "build 803288a · 2026-10-30 14:45 UTC". */
  label: string;
}

const COMMIT = /^[0-9a-f]{7,40}(-dirty)?$/;
const BUILT_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export function readBuildInfo(extra: unknown): BuildInfo {
  const raw = (extra as { buildInfo?: { commit?: unknown; builtAt?: unknown } } | null | undefined)?.buildInfo;
  const commit = typeof raw?.commit === 'string' && COMMIT.test(raw.commit) ? raw.commit : 'unknown';
  const builtAt = typeof raw?.builtAt === 'string' && BUILT_AT.test(raw.builtAt) ? raw.builtAt : 'unknown';
  const time = builtAt === 'unknown' ? 'time unknown' : `${builtAt.slice(0, 10)} ${builtAt.slice(11, 16)} UTC`;
  return { commit, builtAt, label: `build ${commit} · ${time}` };
}

export function getBuildInfo(): BuildInfo {
  return readBuildInfo(Constants.expoConfig?.extra);
}
