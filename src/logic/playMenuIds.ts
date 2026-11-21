import type { GameVariant } from '../components/VariantSelector';

/**
 * THE STABLE ADDRESS OF A PLAY-MENU ROW (command #66, item 0). The Android end-to-end run found the Local card's rows as "the first `Knightmate` under the heading `Local`", and the heading is
 * on screen only while the card's top is: PR #49 run 44883195830 (attempt 2, large-touch) failed with `cannot find {"text":"Knightmate","below":"Local"}` while the screen showed
 * "‹ Menu | Play | Knightmate | 4 Player Variations" - the find's OWN scrolling had pushed "Local" off the window. A row is now addressed by a testID that does not depend on what else is on
 * screen: `play-<card>-<variant>` (`play-local-knightmate`, `play-bots-racingKings`, `play-engine-classic`), made here and only here, read by `PlayModeSelectScreen` (every 2-player variant
 * row of the Bots, Local and Engine vs Engine cards goes through `PlayVariantButton`, which takes its testID from this function) and mirrored by `scripts/android/lib/playMenu.mjs` (the
 * harness cannot import TypeScript; `playMenuIds.dom.test.tsx` pins both to the same strings for every variant).
 */
export type PlayMenuCard = 'bots' | 'local' | 'engine';

export function playRowTestId(card: PlayMenuCard, variant: GameVariant): string {
  return `play-${card}-${variant}`;
}

/** The Board Editor card's "From Position" entry (not a variant: one fixed id). */
export const FROM_POSITION_TEST_ID = 'play-editor-from-position';
