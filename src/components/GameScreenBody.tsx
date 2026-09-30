import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface GameScreenBodyProps {
  /** Everything whose height varies with game state — status text, "bot is thinking", captured
   * pieces, the board itself, hint text, chat, banners, etc. Static — screens are responsible for
   * keeping this content's combined height, plus `bottomBar`, within the available space (the
   * board itself stays a fixed size; trim spacing/optional banners instead). */
  children: ReactNode;
  /** The action controls (Options/Resign/Hint/Undo or Online's More/Chat/Back/Forward, plus the
   * New Game/Analyze Game/Back-to-menu footer) — always anchored near the bottom of the screen,
   * regardless of how much is above it. */
  bottomBar: ReactNode;
}

/**
 * Shared layout for every game screen (Local/Bot/Online), used for everything between the
 * MoveListStrip and the screen's outer edge. `children` takes the remaining space above
 * `bottomBar`, which stays a fixed-size sibling anchored near the bottom — the same "read the
 * safe-area inset directly, once, centrally" fix pattern already used by ScreenHeader for the
 * top edge, applied here to the bottom.
 */
export default function GameScreenBody({ children, bottomBar }: GameScreenBodyProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <View style={styles.content}>{children}</View>
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>{bottomBar}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    // Anchored from the top, not centered: with no ScrollView, this View no longer clips its own
    // overflow by default, so if a caller's content ever exceeds the available height, centering
    // it would bleed evenly into BOTH the header above and bottomBar below. Anchoring from the
    // top plus `overflow: hidden` means the worst case is losing the least-important trailing
    // content (the bottom-most banner) to a clean bottom clip — never a visual overlap with
    // anything else on screen.
    justifyContent: 'flex-start',
    overflow: 'hidden',
    gap: 8,
    paddingVertical: 8,
  },
  bottomBar: {
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
  },
});
