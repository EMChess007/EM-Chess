import { StyleSheet, View } from 'react-native';
import { Pressable } from './AppPressable';
import { Text } from './AppText';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';

/** The words under the button of a sign-in that is waiting for a server that may be asleep (Render's free tier). */
export const WAKING_MESSAGE = 'Waking up the server… this can take up to a minute';

interface SignInWaitingProps {
  /** The request has been waiting long enough that the server is probably starting up: say so. */
  waking: boolean;
  onCancel: () => void;
}

/** Shown while a log in / sign up request is in flight: Cancel always, and the waking-up message once the wait is long. In place: the form does not move to make room for it. */
export default function SignInWaiting({ waking, onCancel }: SignInWaitingProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  return (
    <View style={styles.container}>
      {waking && (
        <Text style={styles.message} testID="signin-waking" accessibilityLiveRegion="polite">
          {WAKING_MESSAGE}
        </Text>
      )}
      <Pressable style={styles.cancel} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancel" testID="signin-cancel">
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { alignItems: 'center', gap: 8 },
    message: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
    cancel: { minHeight: 44, minWidth: 88, paddingHorizontal: 20, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    cancelText: { fontSize: 15, fontWeight: '600', color: colors.text },
  });
}
