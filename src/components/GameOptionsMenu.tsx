import { Pressable, StyleSheet, Text, View } from 'react-native';

export interface GameOptionsMenuItem {
  label: string;
  onPress: () => void;
  /** Renders the item in the app's "destructive action" red (resign, etc). */
  destructive?: boolean;
  disabled?: boolean;
}

interface GameOptionsMenuProps {
  visible: boolean;
  items: GameOptionsMenuItem[];
}

/** A simple inline dropdown-style panel (not a native Modal — this app doesn't use those
 * anywhere else) that appears directly below whatever "Options"/"•••" button toggles `visible`.
 * Shared between bot/local games (Flip Board) and online games (Resign, Request Draw). */
export default function GameOptionsMenu({ visible, items }: GameOptionsMenuProps) {
  if (!visible) return null;

  return (
    <View style={styles.menu}>
      {items.map((item, i) => (
        <Pressable
          key={i}
          style={[styles.item, i > 0 && styles.itemBorder, item.disabled && styles.itemDisabled]}
          onPress={item.onPress}
          disabled={item.disabled}
        >
          <Text style={[styles.itemText, item.destructive && styles.itemTextDestructive]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    overflow: 'hidden',
    minWidth: 200,
  },
  item: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  itemBorder: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  itemDisabled: {
    opacity: 0.4,
  },
  itemText: {
    fontSize: 15,
    color: '#3a2618',
    fontWeight: '600',
  },
  itemTextDestructive: {
    color: '#b00020',
  },
});
