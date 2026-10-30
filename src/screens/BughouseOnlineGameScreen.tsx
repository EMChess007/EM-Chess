import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { appAlert } from '../components/AppAlert';
import { Text } from '../components/AppText';
import ScreenHeader from '../components/ScreenHeader';
import { Pressable } from '../components/AppPressable';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import type { BugMatchFoundPayload } from '../logic/bughouse/wire';
import { isOver } from '../logic/bughouseOnline';
import { onlineSeatConfig } from '../logic/bughouseOnlineUi';
import { useBughouseOnlineGame } from '../logic/useBughouseOnlineGame';
import BughouseGameScreen from './BughouseGameScreen';

interface BughouseOnlineGameScreenProps {
  authToken: string;
  match: BugMatchFoundPayload;
  /** The screen was reopened for a game already in progress: rejoin straight away. */
  resume: boolean;
  /** Back to the menu. `resumable` = the player still holds a live seat (they left a running game). */
  onExit: (resumable: boolean) => void;
  onPlayAgain: () => void;
}

export const LEAVE_BUGHOUSE_TITLE = 'Leave the game?';
export const LEAVE_BUGHOUSE_MESSAGE = 'The clocks keep running. If you do not come back within 45 seconds a bot plays your seat.';

/**
 * A seated player's online Bughouse game (W4). The server is the authority: the position, the clocks and who holds each seat arrive as snapshots (`useBughouseOnlineGame` /
 * `bughouseOnline.ts`); the game screen is the LOCAL one (`BughouseGameScreen`: the same boards, touch input, pockets, layouts and result card - not a copy) given the server's match instead of its
 * own, with every input SENT and never played here. This wrapper owns what only the online game has: the session, leaving and resigning with a question first, and the way out of a game the
 * server no longer has.
 */
export default function BughouseOnlineGameScreen({ authToken, match, resume, onExit, onPlayAgain }: BughouseOnlineGameScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const game = useBughouseOnlineGame(authToken, { match, resume });
  const { view, connection, problem, now, sendAction, resign, retry, leave } = game;
  const [resignError, setResignError] = useState<string | null>(null);
  const seats = useMemo(() => (view ? onlineSeatConfig(view.mySeat) : null), [view?.mySeat]);

  const leaveNow = (resumable: boolean) => {
    leave();
    onExit(resumable);
  };

  if (!view || !seats) {
    return (
      <View style={styles.container} testID="bughouse-online-loading">
        <ScreenHeader title="Bughouse" subtitle="Online" onBack={() => leaveNow(false)} backLabel="‹ Menu" />
        <Text style={styles.problem}>{problem ?? 'Loading…'}</Text>
      </View>
    );
  }

  const live = !isOver(view) && connection !== 'unavailable';
  const handleBack = () => {
    if (!live) {
      leaveNow(false);
      return;
    }
    appAlert(LEAVE_BUGHOUSE_TITLE, LEAVE_BUGHOUSE_MESSAGE, [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => leaveNow(true) },
    ]);
  };
  const handleResign = () => {
    if (!live) return;
    appAlert('Resign?', 'Your team loses the game.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Resign',
        style: 'destructive',
        onPress: () => {
          setResignError(null);
          resign((message) => setResignError(message));
        },
      },
    ]);
  };

  return (
    <View style={styles.container} testID="bughouse-online">
      <BughouseGameScreen
        seats={seats}
        timeControl={view.match.timeControl}
        onExit={handleBack}
        online={{
          view,
          now,
          connection,
          problem,
          onAction: sendAction,
          onResign: handleResign,
          onRetry: retry,
          onPlayAgain,
          resignError,
        }}
      />
      {connection === 'unavailable' && (
        <Pressable accessibilityRole="button" testID="bughouse-online-leave" style={styles.leave} onPress={() => leaveNow(false)}>
          <Text style={styles.leaveText}>Back to menu</Text>
        </Pressable>
      )}
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    problem: { fontSize: 14, color: colors.danger, textAlign: 'center', paddingHorizontal: 24, marginTop: 12 },
    leave: { alignSelf: 'center', margin: 12, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10, backgroundColor: colors.buttonBackground },
    leaveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  });
}
