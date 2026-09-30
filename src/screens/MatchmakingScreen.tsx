import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text } from 'react-native';
import { connectSocket, disconnectSocket } from '../api/socket';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import type { Ack, MatchFoundPayload } from '../types/multiplayer';
import type { TimeControl } from '../types/timeControl';

interface MatchmakingScreenProps {
  authToken: string;
  timeControl: TimeControl;
  chess960: boolean;
  kingOfTheHill: boolean;
  threeCheck: boolean;
  onMatchFound: (match: MatchFoundPayload) => void;
  onCancel: () => void;
}

export default function MatchmakingScreen({
  authToken,
  timeControl,
  chess960,
  kingOfTheHill,
  threeCheck,
  onMatchFound,
  onCancel,
}: MatchmakingScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [error, setError] = useState<string | null>(null);
  // Tracks whether we should still leave_queue on unmount — false once a match is found (the
  // server has already removed both players from the queue itself at that point) or once the
  // player explicitly cancelled (already handled there).
  const stillQueuedRef = useRef(true);

  useEffect(() => {
    const socket = connectSocket(authToken);
    stillQueuedRef.current = true;

    const rejoinQueueOnReconnect = () => {
      if (!stillQueuedRef.current) return;
      socket.emit(
        'join_queue',
        {
          timeControl: { initialSeconds: timeControl.initialSeconds, incrementSeconds: timeControl.incrementSeconds },
          timeControlLabel: timeControl.label,
          isChess960: chess960,
          isKingOfTheHill: kingOfTheHill,
          isThreeCheck: threeCheck,
        },
        (ack: Ack) => {
          if (!ack.ok) setError(ack.error);
        }
      );
    };

    const handleMatchFound = (payload: MatchFoundPayload) => {
      stillQueuedRef.current = false;
      onMatchFound(payload);
    };

    socket.on('match_found', handleMatchFound);
    // A network hiccup while waiting drops us out of the server's queue (see backend
    // disconnect handling) — re-join automatically once the connection comes back, so a brief
    // wobble doesn't silently strand the player in "searching..." forever.
    socket.io.on('reconnect', rejoinQueueOnReconnect);

    socket.emit(
      'join_queue',
      {
        timeControl: { initialSeconds: timeControl.initialSeconds, incrementSeconds: timeControl.incrementSeconds },
        timeControlLabel: timeControl.label,
        isChess960: chess960,
        isKingOfTheHill: kingOfTheHill,
        isThreeCheck: threeCheck,
      },
      (ack: Ack) => {
        if (!ack.ok) setError(ack.error);
      }
    );

    return () => {
      socket.off('match_found', handleMatchFound);
      socket.io.off('reconnect', rejoinQueueOnReconnect);
      if (stillQueuedRef.current) {
        socket.emit('leave_queue', {});
      }
    };
    // timeControl/chess960/kingOfTheHill/threeCheck/authToken are fixed for this screen's lifetime
    // (set once by the caller); onMatchFound is a stable callback from App.tsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = () => {
    const socket = connectSocket(authToken);
    stillQueuedRef.current = false;
    socket.emit('leave_queue', {});
    disconnectSocket();
    onCancel();
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>
        {chess960 ? 'Chess960 · ' : kingOfTheHill ? 'King of the Hill · ' : threeCheck ? 'Three-Check · ' : ''}
        {timeControl.label}
      </Text>

      {error ? (
        <>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.cancelButton} onPress={handleCancel}>
            <Text style={styles.cancelButtonText}>Back to menu</Text>
          </Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator size="large" color={colors.text} />
          <Text style={styles.searchingText}>Searching for an opponent...</Text>
          <Pressable style={styles.cancelButton} onPress={handleCancel}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
        </>
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
      gap: 20,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    searchingText: {
      fontSize: 16,
      color: colors.textSecondary,
    },
    errorText: {
      fontSize: 15,
      color: colors.danger,
      textAlign: 'center',
      paddingHorizontal: 24,
    },
    cancelButton: {
      paddingVertical: 12,
      paddingHorizontal: 28,
      backgroundColor: colors.buttonBackground,
      borderRadius: 8,
    },
    cancelButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
  });
}
