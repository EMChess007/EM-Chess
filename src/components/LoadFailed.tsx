import { StyleSheet, View } from 'react-native';
import { Pressable } from './AppPressable';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { Text } from './AppText';

interface LoadFailedProps {
  /** What went wrong, in words ("Can't reach the server" - see logic/loadError.ts). */
  message: string;
  onRetry: () => void;
  /** Overrides the default accessibility label of the whole block. */
  testID?: string;
}

/**
 * The state a screen shows when its load FAILED, instead of a spinner that never ends or a silent empty list: the reason and a Retry button (a 44 dp touch target).
 * Used by every screen that fetches from the backend after the client's own retries have run out (src/api/client.ts).
 */
export default function LoadFailed({ message, onRetry, testID = 'load-failed' }: LoadFailedProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  return (
    <View style={styles.container} testID={testID} accessibilityRole="alert">
      <Text style={styles.message}>{message}</Text>
      <Pressable style={styles.button} onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry" testID={`${testID}-retry`}>
        <Text style={styles.buttonText}>Retry</Text>
      </Pressable>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { alignItems: 'center', gap: 10, paddingVertical: 8 },
    message: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
    button: {
      minHeight: 44,
      minWidth: 88,
      paddingHorizontal: 20,
      borderRadius: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonText: { fontSize: 15, fontWeight: '600', color: colors.text },
  });
}
