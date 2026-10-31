import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { needsRotateOverlay } from '../logic/bughouseLayout';
import ScreenHeader from '../components/ScreenHeader';
import { Text } from '../components/AppText';
import { Pressable } from '../components/AppPressable';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { spectatorSeatConfig, spectatorStandardSeatConfig } from '../logic/bughouseOnlineUi';
import { useBughouseOnlineGame } from '../logic/useBughouseOnlineGame';
import BughouseGameScreen from './BughouseGameScreen';

interface BughouseSpectatorScreenProps {
  /** Spectating needs no account: null for a guest. */
  authToken: string | null;
  roomId: string;
  onExit: () => void;
}

const NOTHING = () => {};

/**
 * Watching a live online Bughouse game (W4b; BUGHOUSE_SPEC.md HP6). Both boards, all four clocks and pockets, the seat names and their connection state come from the SAME session and the SAME
 * game screen as a seated player's - with no seat: the binding says `spectator`, so no tap, drop or promotion is taken, there is no Resign, and the strip above the boards says whose game it
 * is. The server never sends a spectator a chat line or a quick message (HP10); nothing here could show one.
 */
export default function BughouseSpectatorScreen({ authToken, roomId, onExit }: BughouseSpectatorScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const game = useBughouseOnlineGame(authToken, { spectate: { roomId } });
  const { view, connection, problem, now, retry, leave } = game;
  // Two equal boards when the window has the room for them; on a small phone (360 x 640 dp) Board A large and Board B as a thumbnail - the "rotate the device" layer would otherwise cover the
  // game (the Android run found it, and its accessibility tree hides everything under such a layer).
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const dualSeats = spectatorSeatConfig();
  const seats = needsRotateOverlay(dualSeats, win.width - insets.left - insets.right, win.height - insets.top - insets.bottom) ? spectatorStandardSeatConfig() : dualSeats;
  const leaveNow = () => {
    leave();
    onExit();
  };

  if (!view) {
    return (
      <View style={styles.container} testID="bughouse-spectator-loading">
        <ScreenHeader title="Spectating" subtitle="Bughouse" onBack={leaveNow} backLabel="‹ Back" />
        <Text style={styles.problem}>{problem ?? (connection === 'unavailable' ? 'This game is no longer available.' : 'Loading…')}</Text>
        {problem !== null && connection !== 'unavailable' && (
          <Pressable accessibilityRole="button" accessibilityLabel="Retry" testID="bughouse-spectator-retry" style={styles.button} onPress={retry}>
            <Text style={styles.buttonText}>Retry</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container} testID="bughouse-spectator">
      <BughouseGameScreen
        seats={seats}
        timeControl={view.match.timeControl}
        onExit={leaveNow}
        online={{ view, now, connection, problem, onAction: NOTHING, onResign: NOTHING, onRetry: retry, onPlayAgain: leaveNow, resignError: null }}
      />
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    problem: { fontSize: 14, color: colors.danger, textAlign: 'center', paddingHorizontal: 24, marginTop: 12 },
    button: { alignSelf: 'center', margin: 12, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10, backgroundColor: colors.buttonBackground },
    buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  });
}
