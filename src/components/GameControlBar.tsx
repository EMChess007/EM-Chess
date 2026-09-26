import { Pressable, StyleSheet, Text, View } from 'react-native';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';

export interface GameControlBarItem {
  key: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
}

interface GameControlBarProps {
  items: GameControlBarItem[];
}

/** The row of small in-game action buttons (Options/Resign/Hint/Undo for bot & local games;
 * Options/Chat/Back/Forward for online) — shared purely for consistent styling, since which
 * buttons appear and what they do differs per screen. */
export default function GameControlBar({ items }: GameControlBarProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  return (
    <View style={styles.row}>
      {items.map((item) => (
        <Pressable
          key={item.key}
          style={[styles.button, item.active && styles.buttonActive, item.disabled && styles.buttonDisabled]}
          onPress={item.onPress}
          disabled={item.disabled}
        >
          <Text style={[styles.buttonText, item.active && styles.buttonTextActive]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: 8,
    },
    button: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      backgroundColor: colors.mode === 'dark' ? '#3a3120' : '#f0d9b5',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.mode === 'dark' ? '#6b5a3a' : '#b58863',
    },
    buttonActive: {
      backgroundColor: colors.buttonBackground,
      borderColor: colors.buttonBackground,
    },
    buttonDisabled: {
      opacity: 0.4,
    },
    buttonText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
    },
    buttonTextActive: {
      color: '#fff',
    },
  });
}
