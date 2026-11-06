import { memo, useEffect, useMemo, useRef } from 'react';
import { ScrollView, type ScrollViewInstance, StyleSheet, View } from 'react-native';
import { Pressable } from './AppPressable';
import { Text } from './AppText';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';

export interface MoveListStripMove {
  san: string;
}

interface MoveListStripProps {
  moves: MoveListStripMove[];
  /** Index into `moves` to highlight; -1 highlights nothing (reviewing the start position). */
  selectedIndex: number;
  /** True while live (not reviewing) — keeps the strip auto-scrolled to the latest move. */
  autoScroll: boolean;
  onSelectMove: (index: number) => void;
}

/**
 * Whether two renders of the strip draw the same list (command #33, the lag): the screens rebuild `moves` (`history.map(...)`) on EVERY render - once a second for a clock - so the default
 * shallow comparison never held. Equal when the list has the same moves in the same order, the same highlight and scroll mode, and the same (stable) callback.
 */
export function moveListPropsEqual(a: MoveListStripProps, b: MoveListStripProps): boolean {
  if (a.selectedIndex !== b.selectedIndex || a.autoScroll !== b.autoScroll || a.onSelectMove !== b.onSelectMove) return false;
  if (a.moves === b.moves) return true;
  return a.moves.length === b.moves.length && a.moves.every((m, i) => m.san === b.moves[i].san);
}

/** Horizontal, tappable SAN move list shown at the top of every game screen. Tapping a move
 * doesn't own any state itself — it just reports the tapped index back to the screen, which
 * drives its own (already-existing) position-review state. Memoized with `moveListPropsEqual`;
 * the screen passes a STABLE `onSelectMove` (useStableCallback), so a stale one can never be called. */
function MoveListStrip({ moves, selectedIndex, autoScroll, onSelectMove }: MoveListStripProps) {
  const scrollRef = useRef<ScrollViewInstance>(null);
  const colors = useAppColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  useEffect(() => {
    if (autoScroll) scrollRef.current?.scrollToEnd({ animated: true });
  }, [moves.length, autoScroll]);

  if (moves.length === 0) return null;

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      style={styles.container}
      contentContainerStyle={styles.content}
      showsHorizontalScrollIndicator={false}
    >
      {moves.map((m, i) => (
        <MoveCell key={i} index={i} san={m.san} selected={i === selectedIndex} onSelectMove={onSelectMove} styles={styles} />
      ))}
    </ScrollView>
  );
}

export default memo(MoveListStrip, moveListPropsEqual);

type StripStyles = ReturnType<typeof createStyles>;

/** One move of the list (number + button). Memoized on primitives: a new move re-renders ITS cell, a new highlight two, never all forty. */
const MoveCell = memo(function MoveCell({ index, san, selected, onSelectMove, styles }: { index: number; san: string; selected: boolean; onSelectMove: (index: number) => void; styles: StripStyles }) {
  return (
    <View style={styles.moveWrap}>
      {index % 2 === 0 && (
        <Text testID={`movelist-number-${index}`} style={styles.moveNumber}>
          {index / 2 + 1}.
        </Text>
      )}
      {/* compact: the strip is a thin scroll row, so the move is NOT given the 44 dp floor (that floor made every button 44 tall inside a 36 strip, with the move text at its TOP and the
          number, centred in the row, below it - the misalignment of command #32); the tap area is the full height of the strip plus hitSlop. */}
      <Pressable compact testID={`movelist-san-${index}`} hitSlop={MOVE_HIT_SLOP} onPress={() => onSelectMove(index)} style={[styles.moveButton, selected && styles.moveButtonSelected]}>
        <Text style={[styles.moveText, selected && styles.moveTextSelected]}>{san}</Text>
      </Pressable>
    </View>
  );
});

/** The strip's height at font scale 1; it grows with the text (a `minHeight`, never a fixed height: CHECKLIST 6b). */
export const MOVE_STRIP_MIN_HEIGHT = 36;
/** One line height for the number AND the move: two texts of one size with one line height, centred on one line, share a vertical centre. */
export const MOVE_LINE_HEIGHT = 18;
const MOVE_HIT_SLOP = { top: 8, bottom: 8, left: 2, right: 2 };

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      // (flexGrow 0: a horizontal ScrollView grows to fill its column by default; it is as tall as its content, at least the strip height)
      flexGrow: 0,
      flexShrink: 0,
      backgroundColor: colors.mode === 'dark' ? '#1a1712' : '#faf6ee',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    content: {
      alignItems: 'center',
      minHeight: MOVE_STRIP_MIN_HEIGHT,
      paddingHorizontal: 10,
      paddingVertical: 4,
      gap: 2,
    },
    moveWrap: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    moveNumber: {
      fontSize: 13,
      lineHeight: MOVE_LINE_HEIGHT,
      color: colors.textSecondary,
      marginLeft: 6,
      marginRight: 2,
    },
    moveButton: {
      justifyContent: 'center',
      paddingVertical: 2,
      paddingHorizontal: 5,
      borderRadius: 4,
    },
    moveButtonSelected: {
      backgroundColor: colors.buttonBackground,
    },
    moveText: {
      fontSize: 13,
      lineHeight: MOVE_LINE_HEIGHT,
      color: colors.text,
    },
    moveTextSelected: {
      color: '#fff',
      fontWeight: '600',
    },
  });
}
