import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

/** Horizontal, tappable SAN move list shown at the top of every game screen. Tapping a move
 * doesn't own any state itself — it just reports the tapped index back to the screen, which
 * drives its own (already-existing) position-review state. */
export default function MoveListStrip({ moves, selectedIndex, autoScroll, onSelectMove }: MoveListStripProps) {
  const scrollRef = useRef<ScrollView>(null);
  const colors = useAppColors();
  const styles = createStyles(colors);

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
        <View key={i} style={styles.moveWrap}>
          {i % 2 === 0 && <Text style={styles.moveNumber}>{i / 2 + 1}.</Text>}
          <Pressable onPress={() => onSelectMove(i)} style={[styles.moveButton, i === selectedIndex && styles.moveButtonSelected]}>
            <Text style={[styles.moveText, i === selectedIndex && styles.moveTextSelected]}>{m.san}</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      maxHeight: 36,
      backgroundColor: colors.mode === 'dark' ? '#1a1712' : '#faf6ee',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    content: {
      alignItems: 'center',
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
      color: colors.textSecondary,
      marginLeft: 6,
      marginRight: 2,
    },
    moveButton: {
      paddingVertical: 2,
      paddingHorizontal: 5,
      borderRadius: 4,
    },
    moveButtonSelected: {
      backgroundColor: colors.buttonBackground,
    },
    moveText: {
      fontSize: 13,
      color: colors.text,
    },
    moveTextSelected: {
      color: '#fff',
      fontWeight: '600',
    },
  });
}
