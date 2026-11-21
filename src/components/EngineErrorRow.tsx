import { StyleSheet, View } from 'react-native';
import { Pressable } from './AppPressable';
import { Text } from './AppText';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';

interface EngineErrorRowProps {
  message: string;
  onRetry: () => void;
  /** Prefix for the two test ids: `${testIDPrefix}-error` and `${testIDPrefix}-retry`. */
  testIDPrefix: string;
}

/** The engine error + "Retry" every engine screen shows (bot game, engine vs engine, analysis, hints). */
export default function EngineErrorRow({ message, onRetry, testIDPrefix }: EngineErrorRowProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  return (
    <View style={styles.row}>
      <Text style={styles.errorText} testID={`${testIDPrefix}-error`}>Engine error: {message}</Text>
      <Pressable style={styles.button} onPress={onRetry} testID={`${testIDPrefix}-retry`} accessibilityRole="button">
        <Text style={styles.buttonText}>Retry</Text>
      </Pressable>
    </View>
  );
}

const createStyles = (colors: AppColors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    errorText: { fontSize: 13, color: colors.danger, flexShrink: 1 },
    button: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6, backgroundColor: colors.buttonBackground },
    buttonText: { fontSize: 12, fontWeight: '600', color: colors.text },
  });
