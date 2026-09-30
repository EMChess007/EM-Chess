import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import VariantSelector, { type GameVariant } from '../components/VariantSelector';
import { connectSocket, disconnectSocket } from '../api/socket';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { getTimeControlsByCategory } from '../logic/timeControls';
import type { Ack, MatchFoundPayload } from '../types/multiplayer';
import type { TimeControl, TimeControlCategory } from '../types/timeControl';

interface ChallengeScreenProps {
  authToken: string;
  onMatchFound: (match: MatchFoundPayload) => void;
  onBack: () => void;
}

type Phase = 'menu' | 'setup' | 'waiting' | 'join';

const CATEGORIES: { category: TimeControlCategory; label: string }[] = [
  { category: 'bullet', label: 'Bullet' },
  { category: 'blitz', label: 'Blitz' },
  { category: 'rapid', label: 'Rapid' },
];

export default function ChallengeScreen({ authToken, onMatchFound, onBack }: ChallengeScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [phase, setPhase] = useState<Phase>('menu');
  const [variant, setVariant] = useState<GameVariant>('classic');
  const [code, setCode] = useState<string | null>(null);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(true);

  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'join') return;
    const socket = connectSocket(authToken);
    activeRef.current = true;
    const handleMatchFound = (payload: MatchFoundPayload) => {
      activeRef.current = false;
      onMatchFound(payload);
    };
    socket.on('match_found', handleMatchFound);
    return () => {
      socket.off('match_found', handleMatchFound);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const handleCreate = (timeControl: TimeControl) => {
    setError(null);
    const socket = connectSocket(authToken);
    socket.emit(
      'create_challenge',
      {
        timeControl: { initialSeconds: timeControl.initialSeconds, incrementSeconds: timeControl.incrementSeconds },
        timeControlLabel: timeControl.label,
        isChess960: variant === 'chess960',
        isKingOfTheHill: variant === 'kingOfTheHill',
        isThreeCheck: variant === 'threeCheck',
      },
      (ack: Ack<{ code: string }>) => {
        if (!ack.ok) {
          setError(ack.error);
          return;
        }
        setCode(ack.code);
        setPhase('waiting');
      }
    );
  };

  const handleShareCode = () => {
    if (!code) return;
    Share.share({ message: `Play chess with me! Join with code ${code} in EM-Chess.` }).catch(() => {});
  };

  const handleCancelWaiting = () => {
    if (code) {
      const socket = connectSocket(authToken);
      socket.emit('cancel_challenge', { code }, () => {});
    }
    activeRef.current = false;
    disconnectSocket();
    setCode(null);
    setPhase('menu');
  };

  const handleJoin = () => {
    const trimmed = joinCodeInput.trim();
    if (!trimmed) return;
    setError(null);
    const socket = connectSocket(authToken);
    socket.emit('join_challenge', { code: trimmed }, (ack: Ack) => {
      if (!ack.ok) setError(ack.error);
    });
  };

  const handleBack = () => {
    activeRef.current = false;
    if (phase === 'waiting' || phase === 'join') disconnectSocket();
    onBack();
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Challenge a Friend" onBack={phase === 'menu' ? handleBack : () => setPhase('menu')} backLabel="‹ Back" />

      {phase === 'menu' && (
        <View style={styles.centerColumn}>
          <Pressable style={styles.bigButton} onPress={() => setPhase('setup')}>
            <Text style={styles.bigButtonText}>Create Challenge</Text>
            <Text style={styles.bigButtonSubtext}>Get a code to send a friend</Text>
          </Pressable>
          <Pressable style={[styles.bigButton, styles.joinButton]} onPress={() => setPhase('join')}>
            <Text style={styles.bigButtonText}>Join by Code</Text>
            <Text style={styles.bigButtonSubtext}>Enter a code a friend sent you</Text>
          </Pressable>
        </View>
      )}

      {phase === 'setup' && (
        <View style={styles.setupContainer}>
          <VariantSelector value={variant} onChange={setVariant} />
          {error && <Text style={styles.errorText}>{error}</Text>}
          <ScrollView contentContainerStyle={styles.setupScrollContent}>
            {CATEGORIES.map(({ category, label }) => (
              <View key={category} style={styles.section}>
                <Text style={styles.sectionTitle}>{label}</Text>
                <View style={styles.presetGrid}>
                  {getTimeControlsByCategory(category).map((tc) => (
                    <Pressable key={tc.id} style={styles.presetButton} onPress={() => handleCreate(tc)}>
                      <Text style={styles.presetButtonText}>{tc.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {phase === 'waiting' && (
        <View style={styles.centerColumn}>
          <ActivityIndicator size="large" color={colors.text} />
          <Text style={styles.searchingText}>Waiting for your friend to join...</Text>
          <Text style={styles.codeText}>{code}</Text>
          <Pressable style={styles.bigButton} onPress={handleShareCode}>
            <Text style={styles.bigButtonText}>Share Code</Text>
          </Pressable>
          <Pressable style={styles.cancelButton} onPress={handleCancelWaiting}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
        </View>
      )}

      {phase === 'join' && (
        <View style={styles.centerColumn}>
          <Text style={styles.sectionTitle}>Enter the code your friend sent you</Text>
          <TextInput
            style={styles.codeInput}
            value={joinCodeInput}
            onChangeText={(t) => setJoinCodeInput(t.toUpperCase())}
            placeholder="ABC123"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
          />
          {error && <Text style={styles.errorText}>{error}</Text>}
          <Pressable style={styles.bigButton} onPress={handleJoin}>
            <Text style={styles.bigButtonText}>Join</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function createStyles(colors: AppColors) {
  const isDark = colors.mode === 'dark';
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
    setupContainer: {
      flex: 1,
      paddingHorizontal: 24,
      paddingTop: 20,
      gap: 14,
    },
    setupScrollContent: {
      gap: 18,
      paddingBottom: 24,
    },
    bigButton: {
      width: '100%',
      paddingVertical: 18,
      paddingHorizontal: 20,
      backgroundColor: colors.buttonBackground,
      borderRadius: 12,
      alignItems: 'center',
      gap: 4,
    },
    joinButton: {
      backgroundColor: colors.accent,
    },
    bigButtonText: {
      color: '#fff',
      fontSize: 17,
      fontWeight: '700',
    },
    bigButtonSubtext: {
      color: '#fff',
      fontSize: 12,
      opacity: 0.85,
    },
    section: {
      width: '100%',
      gap: 8,
    },
    sectionTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    presetGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    presetButton: {
      minWidth: 80,
      paddingVertical: 10,
      paddingHorizontal: 14,
      backgroundColor: isDark ? '#3a3120' : '#f0d9b5',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: isDark ? '#6b5a3a' : '#b58863',
      alignItems: 'center',
    },
    presetButtonText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
    searchingText: {
      fontSize: 16,
      color: colors.textSecondary,
    },
    codeText: {
      fontSize: 40,
      fontWeight: '800',
      letterSpacing: 6,
      color: colors.accent,
    },
    codeInput: {
      width: '100%',
      fontSize: 24,
      fontWeight: '700',
      letterSpacing: 4,
      textAlign: 'center',
      paddingVertical: 14,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.text,
      backgroundColor: colors.surface,
    },
    errorText: {
      fontSize: 14,
      color: colors.danger,
      textAlign: 'center',
    },
    cancelButton: {
      paddingVertical: 10,
      paddingHorizontal: 24,
    },
    cancelButtonText: {
      fontSize: 15,
      color: colors.textSecondary,
      fontWeight: '600',
    },
  });
}
