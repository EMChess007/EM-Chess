import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { connectSocket, disconnectSocket } from '../api/socket';
import { appAlert } from '../components/AppAlert';
import ScreenHeader from '../components/ScreenHeader';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import type { SetupChessPiece } from '../logic/setupChess';
import type { PieceColor } from '../types/chess';
import type { Ack, MatchFoundPayload } from '../types/multiplayer';
import SetupChessBuilderScreen from './SetupChessBuilderScreen';

interface SetupChessOnlineScreenProps {
  authToken: string;
  pairingId: string;
  color: PieceColor;
  onMatchFound: (match: MatchFoundPayload) => void;
  onCancel: () => void;
}

type Phase = 'building' | 'waiting';

/**
 * Online-mode Setup Chess: both players build blind (neither ever sees the other's army — this
 * screen only ever renders the local player's own SetupChessBuilderScreen). Submits via
 * `submit_setup_chess` once finalized, then waits for either `match_found` (both armies merged
 * into a legal position — the normal online handoff into OnlineGameScreen from here on) or
 * `setup_chess_invalid` (the merge put a king in check — both players are asked to rebuild).
 */
export default function SetupChessOnlineScreen({ authToken, pairingId, color, onMatchFound, onCancel }: SetupChessOnlineScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [phase, setPhase] = useState<Phase>('building');

  useEffect(() => {
    const socket = connectSocket(authToken);

    const handleMatchFound = (payload: MatchFoundPayload) => onMatchFound(payload);
    const handleInvalid = () => {
      appAlert('Invalid starting position', "Combined, your armies would leave a king in check. Please rebuild — you'll both need to resubmit.");
      setPhase('building');
    };
    const handleOpponentLeft = () => {
      appAlert('Opponent left', 'Your opponent left before the game could start.');
      handleLeave();
    };

    socket.on('match_found', handleMatchFound);
    socket.on('setup_chess_invalid', handleInvalid);
    socket.on('setup_chess_opponent_left', handleOpponentLeft);
    return () => {
      socket.off('match_found', handleMatchFound);
      socket.off('setup_chess_invalid', handleInvalid);
      socket.off('setup_chess_opponent_left', handleOpponentLeft);
    };
    // authToken/pairingId are fixed for this screen's lifetime; onMatchFound/onCancel are stable
    // callbacks from App.tsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLeave = () => {
    disconnectSocket();
    onCancel();
  };

  const handleFinalize = (pieces: SetupChessPiece[]) => {
    const socket = connectSocket(authToken);
    socket.emit('submit_setup_chess', { pairingId, pieces }, (ack: Ack) => {
      if (!ack.ok) {
        appAlert('Could not submit', ack.error);
        return;
      }
      setPhase('waiting');
    });
  };

  if (phase === 'waiting') {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Setup Chess" subtitle="Waiting for opponent" onBack={handleLeave} backLabel="‹ Cancel" />
        <View style={styles.centerColumn}>
          <ActivityIndicator size="large" color={colors.text} />
          <Text style={styles.message}>Your army is locked in.</Text>
          <Text style={styles.message}>Waiting for your opponent to finish theirs...</Text>
        </View>
      </View>
    );
  }

  return (
    <SetupChessBuilderScreen
      color={color}
      title="Setup Chess"
      subtitle={`You are ${color === 'w' ? 'White' : 'Black'} — build your army`}
      finalizeLabel="Ready"
      onBack={handleLeave}
      backLabel="‹ Cancel"
      onFinalize={handleFinalize}
    />
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    centerColumn: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      gap: 14,
    },
    message: {
      fontSize: 16,
      color: colors.text,
      textAlign: 'center',
    },
  });
}
