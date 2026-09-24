import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface GameScreenBodyProps {
  /** Everything whose height varies with game state — status text, "bot is thinking", captured
   * pieces, the board itself, hint text, chat, banners, etc. Scrolls if it doesn't fit; never
   * pushes `bottomBar` off screen. */
  children: ReactNode;
  /** The action controls (Options/Resign/Hint/Undo or Online's More/Chat/Back/Forward, plus the
   * New Game/Analyze Game/Back-to-menu footer) — always anchored near the bottom of the screen,
   * regardless of how much is above it. */
  bottomBar: ReactNode;
}

/**
 * Shared layout for every game screen (Local/Bot/Online), used for everything between the
 * MoveListStrip and the screen's outer edge. Fixes a class of bug where dynamic content above
 * the button row (opening name appearing, "bot is thinking", captured pieces, end-of-game
 * status) pushed the whole centered block down until the bottom buttons ended up hidden under
 * the gesture nav bar: `bottomBar` is now a fixed-size sibling AFTER a `flex: 1` ScrollView,
 * so it always sits at a stable position near the bottom, and the scrollable area absorbs
 * overflow instead of shoving it off screen — the same "read the safe-area inset directly, once,
 * centrally" fix pattern already used by ScreenHeader for the top edge, applied to the bottom.
 */
export default function GameScreenBody({ children, bottomBar }: GameScreenBodyProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>{bottomBar}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  bottomBar: {
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
  },
});
