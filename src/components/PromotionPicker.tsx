import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

interface PromotionPickerProps<T extends string | number> {
  visible: boolean;
  /** The pieces on offer, in display order (queen first). */
  choices: readonly T[];
  /** Side length of each choice button. */
  buttonSize: number;
  /** The piece's name for the accessibility label ("Queen"). */
  labelFor: (choice: T) => string;
  /** Draws a choice's piece — the caller knows the colour/seat, the piece theme and how pieces are rendered on its board. */
  renderChoice: (choice: T) => ReactNode;
  onChoose: (choice: T) => void;
  onCancel: () => void;
}

/**
 * The "Promote to" chooser shared by the 2-player board and the 4 Player Chess board. It is a real Modal, not an overlay inside the
 * board: it covers the WHOLE screen, so a tap anywhere outside the buttons — on the board or off it — lands on the backdrop and
 * cancels. (An earlier absolutely-positioned overlay only covered the board's own bounds, so taps elsewhere on the screen never
 * reached it.) Android's back button cancels too.
 */
export default function PromotionPicker<T extends string | number>({ visible, choices, buttonSize, labelFor, renderChoice, onChoose, onCancel }: PromotionPickerProps<T>) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="Cancel promotion">
        <View style={styles.panel}>
          <Text style={styles.title}>Promote to</Text>
          <View style={styles.row}>
            {choices.map((choice) => (
              <Pressable
                key={choice}
                style={[styles.button, { width: buttonSize, height: buttonSize }]}
                onPress={() => onChoose(choice)}
                accessibilityRole="button"
                accessibilityLabel={`Promote to ${labelFor(choice)}`}
              >
                {renderChoice(choice)}
              </Pressable>
            ))}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    backgroundColor: '#f4ecd8',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3a2618',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    backgroundColor: '#d9c8a3',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
