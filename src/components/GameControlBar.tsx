import { Pressable, StyleSheet, Text, View } from 'react-native';

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

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#f0d9b5',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#b58863',
  },
  buttonActive: {
    backgroundColor: '#3a2618',
    borderColor: '#3a2618',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3a2618',
  },
  buttonTextActive: {
    color: '#fff',
  },
});
