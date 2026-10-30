import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { isOnlineBackend } from '../api/onlineBackend';
import { Pressable } from './AppPressable';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { SERVER_UNREACHABLE_MESSAGE } from '../logic/loadError';
import { endEpisode, nextAutoRetryDelay, noteAutoRetry, noteFailure, STARTING_UP_MESSAGE } from '../logic/serverStartup';
import { Text } from './AppText';

interface LoadFailedProps {
  /** What went wrong, in words ("Can't reach the server" - see logic/loadError.ts). */
  message: string;
  onRetry: () => void;
  /** Overrides the default accessibility label of the whole block. */
  testID?: string;
  /** Tests only: whether the app points at the online backend (default: the client's own answer). */
  online?: boolean;
}

/**
 * The state a screen shows when its load FAILED, instead of a spinner that never ends or a silent empty list: the reason and a Retry button (a 44 dp touch target).
 * Used by every screen that fetches from the backend after the client's own retries have run out (src/api/client.ts).
 *
 * On the ONLINE backend a "Can't reach the server" most likely means the free-tier server is still asleep: the block then says "Server is starting up…" and retries by itself a few
 * times within about a minute (logic/serverStartup.ts), with Retry still there. The local / LAN backend keeps the plain message: a laptop that is off is not "starting up".
 */
export default function LoadFailed({ message, onRetry, testID = 'load-failed', online }: LoadFailedProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const waitsForServer = message === SERVER_UNREACHABLE_MESSAGE && (online ?? isOnlineBackend());
  // Whether an automatic try is still to come. Decided once per mount (a failed load mounts a new block): the episode lives in serverStartup.ts under this block's id.
  const [autoDelay] = useState<number | null>(() => {
    if (!waitsForServer) return null;
    const now = Date.now();
    return nextAutoRetryDelay(noteFailure(testID, now), now);
  });
  // The screens pass a new arrow function on every render: the timer must not restart with each of them.
  const retryRef = useRef(onRetry);
  retryRef.current = onRetry;
  useEffect(() => {
    if (autoDelay === null) return undefined;
    const id = setTimeout(() => {
      noteAutoRetry(testID);
      retryRef.current();
    }, autoDelay);
    return () => clearTimeout(id);
  }, [autoDelay, testID]);
  const shown = autoDelay !== null ? STARTING_UP_MESSAGE : message;
  const retry = () => {
    endEpisode(testID);
    onRetry();
  };
  return (
    <View style={styles.container} testID={testID} accessibilityRole="alert">
      <Text style={styles.message}>{shown}</Text>
      <Pressable style={styles.button} onPress={retry} accessibilityRole="button" accessibilityLabel="Retry" testID={`${testID}-retry`}>
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
