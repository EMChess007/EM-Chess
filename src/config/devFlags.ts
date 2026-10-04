import type { GameVariant } from '../components/VariantSelector';

/**
 * Dev-only switch that lets Duck Chess show up in the Online (quick match) and Challenge pickers
 * before it is released, so the online/spectator path can be tested with two devices or accounts.
 * Same convention as EXPO_PUBLIC_USE_ONLINE_BACKEND (src/api/client.ts): put it in .env.local at the
 * project root (gitignored, per developer) and restart `npx expo start` — EXPO_PUBLIC_* values are
 * read at bundle time only:
 *
 *   EXPO_PUBLIC_ENABLE_ONLINE_DUCK=true
 *
 * Ignored in a release build (__DEV__ is false there), so production picker behaviour never changes.
 * Tournaments are NOT affected — the server never creates Duck Chess tournament rooms.
 * Remove this file and its two call sites when Duck Chess is released online (the real step 6).
 */
// The literal `process.env.EXPO_PUBLIC_…` access is required: Metro/Babel inlines it textually.
const ENABLE_ONLINE_DUCK_FLAG = process.env.EXPO_PUBLIC_ENABLE_ONLINE_DUCK === 'true';

export function onlineExcludedVariantsFor(isDev: boolean, enableOnlineDuck: boolean): GameVariant[] {
  return isDev && enableOnlineDuck ? [] : ['duckChess'];
}

export const ONLINE_EXCLUDED_VARIANTS: GameVariant[] = onlineExcludedVariantsFor(__DEV__, ENABLE_ONLINE_DUCK_FLAG);

if (__DEV__ && ENABLE_ONLINE_DUCK_FLAG) {
  console.log('[devFlags] EXPO_PUBLIC_ENABLE_ONLINE_DUCK is on — Duck Chess is selectable in the Online and Challenge pickers (dev build only)');
}
