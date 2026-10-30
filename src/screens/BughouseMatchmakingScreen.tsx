import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet } from 'react-native';
import { emitWithin } from '../api/socketAck';
import { connectSocket, disconnectSocket } from '../api/socket';
import { Pressable } from '../components/AppPressable';
import { Text } from '../components/AppText';
import LoadFailed from '../components/LoadFailed';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { logDiagnostic } from '../logic/diagnosticLog';
import { SERVER_UNREACHABLE_MESSAGE } from '../logic/loadError';
import type { BughouseTimeControl } from '../logic/bughouse/rules';
import { validateBugJoinQueue, type BugAck, type BugMatchFoundPayload, type BugQueueUpdatePayload } from '../logic/bughouse/wire';
import { viewFromMatchFound } from '../logic/bughouseOnline';
import { describeQueue, fillSecondsLeft } from '../logic/bughouseOnlineUi';

interface BughouseMatchmakingScreenProps {
  authToken: string;
  timeControl: BughouseTimeControl;
  /** "3 | 2": what the time control is called on screen. */
  timeControlLabel: string;
  onMatchFound: (match: BugMatchFoundPayload) => void;
  onCancel: () => void;
}

/**
 * The queue for an online Bughouse game (BUGHOUSE_SPEC.md 5.8): joins this time control's queue, shows how many players are waiting and - once two are - the countdown to the moment bots
 * fill the empty seats, and hands over to the game when `bug_match_found` arrives. A lone player waits as long as they like; Cancel leaves the queue. Same shape as the 4-seat queue.
 *
 * THE WAIT HAS A LIMIT (CHECKLIST 6b): `bug_join_queue` goes through `emitWithin` (6 s). A server that does not answer is "Can't reach the server" + Retry, with one line in the Diagnostic Log -
 * never a spinner that outlives the request. A refusal from the server (already in a game, already queued) is shown as it is, with a way back. A dropped connection drops the player out of
 * the server's queue, so a reconnect joins again by itself.
 */
export default function BughouseMatchmakingScreen({ authToken, timeControl, timeControlLabel, onMatchFound, onCancel }: BughouseMatchmakingScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [failure, setFailure] = useState<{ kind: 'unreachable' } | { kind: 'refused'; text: string } | null>(null);
  const [update, setUpdate] = useState<{ payload: BugQueueUpdatePayload; receivedAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // False once a match is found (the server has already taken us out of the queue) or the player cancelled.
  const stillQueuedRef = useRef(true);
  const joinRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const socket = connectSocket(authToken);
    stillQueuedRef.current = true;

    const join = () => {
      const payload = validateBugJoinQueue({ timeControl });
      if (!payload.ok) {
        stillQueuedRef.current = false;
        setFailure({ kind: 'refused', text: payload.error });
        return;
      }
      setFailure(null);
      emitWithin<BugAck>(socket, 'bug_join_queue', payload.value, (result) => {
        if (!stillQueuedRef.current) return; // matched or cancelled in the meantime
        if (result.unreachable) {
          logDiagnostic('[BughouseOnline] bug_join_queue was not answered; the queue screen shows "Can\'t reach the server".');
          setFailure({ kind: 'unreachable' });
        } else if (!result.ack.ok) {
          stillQueuedRef.current = false;
          logDiagnostic(`[BughouseOnline] bug_join_queue refused: ${result.ack.reason}`);
          setFailure({ kind: 'refused', text: result.ack.error });
        }
      });
    };
    joinRef.current = join;

    const handleUpdate = (payload: BugQueueUpdatePayload) => setUpdate({ payload, receivedAt: Date.now() });
    const handleMatchFound = (payload: BugMatchFoundPayload) => {
      stillQueuedRef.current = false;
      // A payload the screen cannot build a game from is not a match: say so (and leave the room, so the table is not left waiting on someone who will not play).
      if (viewFromMatchFound(payload, Date.now()) === null) {
        logDiagnostic('[BughouseOnline] bug_match_found could not be read.');
        socket.emit('bug_resign', { roomId: (payload as { roomId?: unknown } | null)?.roomId });
        setFailure({ kind: 'refused', text: 'The game could not be read from the server.' });
        return;
      }
      onMatchFound(payload);
    };
    const rejoinQueueOnReconnect = () => {
      if (stillQueuedRef.current) join();
    };

    socket.on('bug_queue_update', handleUpdate);
    socket.on('bug_match_found', handleMatchFound);
    socket.io.on('reconnect', rejoinQueueOnReconnect);
    join();

    return () => {
      socket.off('bug_queue_update', handleUpdate);
      socket.off('bug_match_found', handleMatchFound);
      socket.io.off('reconnect', rejoinQueueOnReconnect);
      if (stillQueuedRef.current) socket.emit('bug_leave_queue', {});
    };
    // The time control and token are fixed for this screen's lifetime; onMatchFound is a stable callback from App.tsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraws the fill countdown twice a second.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const handleCancel = useCallback(() => {
    stillQueuedRef.current = false;
    connectSocket(authToken).emit('bug_leave_queue', {});
    disconnectSocket();
    onCancel();
  }, [authToken, onCancel]);

  const secondsLeft = fillSecondsLeft(update?.payload ?? null, update?.receivedAt ?? 0, now);
  const queue = describeQueue(update?.payload ?? null, secondsLeft);

  return (
    <SafeAreaView style={styles.container} testID="bughouse-queue">
      <Text style={styles.title}>Bughouse · {timeControlLabel}</Text>
      {failure?.kind === 'unreachable' ? (
        <>
          <LoadFailed message={SERVER_UNREACHABLE_MESSAGE} onRetry={() => joinRef.current()} testID="bughouse-queue-failed" />
          <Pressable style={styles.button} onPress={handleCancel} testID="bughouse-queue-back">
            <Text style={styles.buttonText}>Back to menu</Text>
          </Pressable>
        </>
      ) : failure?.kind === 'refused' ? (
        <>
          <Text style={styles.errorText} testID="bughouse-queue-error">
            {failure.text}
          </Text>
          <Pressable style={styles.button} onPress={handleCancel} testID="bughouse-queue-back">
            <Text style={styles.buttonText}>Back to menu</Text>
          </Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator size="large" color={colors.text} />
          <Text style={styles.queueTitle} testID="bughouse-queue-title">
            {queue.title}
          </Text>
          <Text style={styles.queueDetail} testID="bughouse-queue-detail">
            {queue.detail}
          </Text>
          <Pressable style={styles.button} onPress={handleCancel} testID="bughouse-queue-cancel">
            <Text style={styles.buttonText}>Cancel</Text>
          </Pressable>
        </>
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, gap: 20 },
    title: { fontSize: 18, fontWeight: '700', color: colors.text },
    queueTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
    queueDetail: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 32 },
    errorText: { fontSize: 15, color: colors.danger, textAlign: 'center', paddingHorizontal: 24 },
    button: { paddingVertical: 12, paddingHorizontal: 28, backgroundColor: colors.buttonBackground, borderRadius: 8 },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  });
}
