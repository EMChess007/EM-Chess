import { useRef, useState, type ReactNode } from 'react';
import { ScrollView, type ScrollViewInstance, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface GameScreenBodyProps {
  /** Everything whose height varies with game state — status text, "bot is thinking", captured
   * pieces, the board itself, hint text, chat, banners, etc. The board keeps its size; screens trim spacing / optional banners
   * to keep this content plus `bottomBar` inside a typical window, and when a window is too small anyway (a landscape phone,
   * large text) the whole body scrolls instead of being cut off. */
  children: ReactNode;
  /** The action controls (Options/Resign/Hint/Undo or Online's More/Chat/Back/Forward, plus the
   * New Game/Analyze Game/Back-to-menu footer) — anchored near the bottom of the screen when everything fits,
   * and at the end of the scrolled content when it does not. */
  bottomBar: ReactNode;
  /** Tighter vertical spacing between (and around) the content rows. For a game whose board comes with extra chrome
   * of its own — Spell Chess's Freeze/Jump row lives inside ChessBoard — so everything still fits WITHOUT shrinking the board
   * (the board is the same size in every variant). */
  compact?: boolean;
  /**
   * True while a result card is part of `children` (the 4-seat games and Chaturaji draw theirs under the board). The card appears AFTER the board, so on a phone it arrived below the visible
   * screen and the player had to scroll to find who won (command #33). When the content is taller than the window, the body scrolls to its end - the card and the buttons under it - as soon as the
   * card is there. Nothing moves while everything fits.
   */
  resultShown?: boolean;
}

/**
 * Shared layout for every game screen (Local/Bot/Online), used for everything between the MoveListStrip and the screen's outer edge. `children` takes the space above
 * `bottomBar`, which is anchored near the bottom — the same "read the safe-area inset directly, once, centrally" fix pattern already used by ScreenHeader for the top edge.
 *
 * Overflow (Android device matrix): this area used to be a non-scrolling, overflow-hidden View on purpose - a ScrollView would fight the board's drag-to-move gesture - so on
 * a window shorter than its content (landscape, 2 x text, a 320 x 568 phone) the board and the buttons were simply cut off. It is now ALWAYS a ScrollView but only
 * SCROLLS (`scrollEnabled`) when the content is taller than the window: while everything fits nothing changes, in particular no native scroll view can take a touch from the board.
 * Once it does not fit, a swipe anywhere scrolls - the board hands a plain scroll swipe to its ancestor (useBoardGestures `onPanResponderTerminationRequest`, written
 * for exactly this) and keeps an armed arrow-drawing drag.
 */
export default function GameScreenBody({ children, bottomBar, compact = false, resultShown = false }: GameScreenBodyProps) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  // The first layout pass has no measurement yet: nothing scrolls until the content is known to be taller than the window.
  const overflowing = viewportHeight > 0 && contentHeight > viewportHeight + 1;

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      scrollEnabled={overflowing}
      showsVerticalScrollIndicator={overflowing}
      bounces={false}
      overScrollMode="never"
      onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)}
      onContentSizeChange={(_width, height) => {
        setContentHeight(height);
        // the card has just joined the content (or grown): show it. `scrollToEnd` is a no-op while everything fits.
        if (resultShown) scrollRef.current?.scrollToEnd({ animated: false });
      }}
    >
      <View style={[styles.content, compact && styles.contentCompact]}>{children}</View>
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>{bottomBar}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    // flexGrow: with room to spare the content area takes it and the bar stays at the bottom; without, the content keeps its own height and the whole thing scrolls.
    flexGrow: 1,
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
    paddingVertical: 8,
  },
  contentCompact: {
    gap: 3,
    paddingVertical: 3,
  },
  bottomBar: {
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
  },
});
