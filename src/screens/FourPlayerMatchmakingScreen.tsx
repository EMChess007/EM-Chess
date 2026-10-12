import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text } from 'react-native';
import { connectSocket, disconnectSocket } from '../api/socket';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { describeQueue, fillSecondsLeft } from '../logic/fourPlayerOnlineUi';
import { validateFourJoinQueue, type FourAck, type FourMatchFoundPayload, type FourQueueUpdatePayload } from '../logic/fourPlayerWire';
import type { TimeControl } from '../types/timeControl';

interface FourPlayerMatchmakingScreenProps {
  authToken: string;
  timeControl: TimeControl;
  onMatchFound: (match: FourMatchFoundPayload) => void;
  onCancel: () => void;
}

/** A server that has never heard of `four_join_queue` (an older backend) never answers; after this the screen says so instead of spinning. */
const JOIN_ACK_TIMEOUT_MS = 10_000;

/**
 * The queue for an online 4 Player game (FOUR_PLAYER_ONLINE_SPEC.md §7, §8): joins the queue for this time control, shows how many
 * players are waiting and — once two are — a countdown to the moment bots fill the empty seats, and hands over to the game when
 * `four_match_found` arrives. A lone player waits as long as they like (Cancel leaves the queue). Same shape as the 2-player
 * MatchmakingScreen: a dropped connection drops the player out of the server's queue, so a reconnect joins again by itself.
 */
export default function FourPlayerMatchmakingScreen({ authToken, timeControl, onMatchFound, onCancel }: FourPlayerMatchmakingScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [error, setError] = useState<string | null>(null);
  const [update, setUpdate] = useState<{ payload: FourQueueUpdatePayload; receivedAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // False once a match is found (the server has already taken us out of the queue) or the player cancelled.
  const stillQueuedRef = useRef(true);

  useEffect(() => {
    const socket = connectSocket(authToken);
    stillQueuedRef.current = true;

    const join = () => {
      const payload = validateFourJoinQueue({
        timeControl: { initialSeconds: timeControl.initialSeconds, incrementSeconds: timeControl.incrementSeconds },
        timeControlLabel: timeControl.label,
      });
      if (!payload.ok) {
        stillQueuedRef.current = false;
        setError(payload.error);
        return;
      }
      socket.timeout(JOIN_ACK_TIMEOUT_MS).emit('four_join_queue', payload.value, (err: unknown, ack?: FourAck) => {
        if (!stillQueuedRef.current) return; // matched or cancelled in the meantime
        if (err || !ack) {
          setError('The server did not answer. Online 4 Player may not be available on this server yet.');
        } else if (!ack.ok) {
          stillQueuedRef.current = false;
          setError(ack.error);
        }
      });
    };

    const handleUpdate = (payload: FourQueueUpdatePayload) => setUpdate({ payload, receivedAt: Date.now() });
    const handleMatchFound = (payload: FourMatchFoundPayload) => {
      stillQueuedRef.current = false;
      onMatchFound(payload);
    };
    const rejoinQueueOnReconnect = () => {
      if (stillQueuedRef.current) join();
    };

    socket.on('four_queue_update', handleUpdate);
    socket.on('four_match_found', handleMatchFound);
    socket.io.on('reconnect', rejoinQueueOnReconnect);
    join();

    return () => {
      socket.off('four_queue_update', handleUpdate);
      socket.off('four_match_found', handleMatchFound);
      socket.io.off('reconnect', rejoinQueueOnReconnect);
      if (stillQueuedRef.current) socket.emit('four_leave_queue', {});
    };
    // The time control and token are fixed for this screen's lifetime; onMatchFound is a stable callback from App.tsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraws the fill countdown once a second.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const handleCancel = () => {
    stillQueuedRef.current = false;
    connectSocket(authToken).emit('four_leave_queue', {});
    disconnectSocket();
    onCancel();
  };

  const secondsLeft = fillSecondsLeft(update?.payload ?? null, update?.receivedAt ?? 0, now);
  const queue = describeQueue(update?.payload ?? null, secondsLeft);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>4 Player Chess · {timeControl.label}</Text>
      {error ? (
        <>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.button} onPress={handleCancel}>
            <Text style={styles.buttonText}>Back to menu</Text>
          </Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator size="large" color={colors.text} />
          <Text style={styles.queueTitle}>{queue.title}</Text>
          <Text style={styles.queueDetail}>{queue.detail}</Text>
          <Pressable style={styles.button} onPress={handleCancel}>
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
