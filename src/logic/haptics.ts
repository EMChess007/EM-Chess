import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import type { Move } from '../types/chess';

// expo-haptics has no web implementation (it throws "not available on web" under the hood on some
// SDK versions, silently no-ops on others) — skip it outright there rather than depend on that.
function safeHaptic(action: () => Promise<void>): void {
  if (Platform.OS === 'web') return;
  action().catch(() => {
    // Non-critical: a failed haptic should never interrupt gameplay.
  });
}

/**
 * Called right after a move is applied — own move, opponent's move over a socket, or a bot/engine
 * move — in every mode with a human actually playing/watching. A plain move gets a light tap, a
 * capture a medium one, and putting the opponent in check a heavy one. Chess.js's SAN already
 * marks check ('+') and checkmate ('#'), so this only needs the move's own `san`/`captured` to
 * tell all four cases apart. Checkmate itself is deliberately left to `triggerGameEndHaptics`
 * (fired once when the screen's own `gameOver` state flips) instead of a heavier tap here, so a
 * mating move is never buzzed twice.
 */
export function triggerMoveHaptics(move?: Pick<Move, 'san' | 'captured'> | null): void {
  if (!move) return;
  if (move.san.endsWith('#')) return;
  if (move.san.endsWith('+')) {
    safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
    return;
  }
  if (move.captured) {
    safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
    return;
  }
  safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/**
 * A short double-pulse, deliberately distinct from any single move tap above — for whenever a
 * game actually ends, by checkmate, stalemate/draw, resignation, timeout, or draw agreement alike.
 * Call this exactly once, right when a screen's own `gameOver` condition first becomes true.
 */
export function triggerGameEndHaptics(): void {
  if (Platform.OS === 'web') return;
  (async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch {
      // Non-critical.
    }
  })();
}
