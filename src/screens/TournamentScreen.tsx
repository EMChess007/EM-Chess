import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import VariantSelector, { type GameVariant } from '../components/VariantSelector';
import { connectSocket, disconnectSocket, getSocket } from '../api/socket';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { getTimeControlsByCategory } from '../logic/timeControls';
import type { AuthUser } from '../types/auth';
import type { Ack, TournamentLobbyState } from '../types/multiplayer';
import type { TimeControl, TimeControlCategory } from '../types/timeControl';

interface TournamentScreenProps {
  authToken: string;
  authUser: AuthUser;
  onEnterStandings: (tournamentId: string) => void;
  onBack: () => void;
}

type Phase = 'menu' | 'create' | 'join' | 'lobby';

const MIN_PARTICIPANTS_TO_START = 3;

const CATEGORIES: { category: TimeControlCategory; label: string }[] = [
  { category: 'bullet', label: 'Bullet' },
  { category: 'blitz', label: 'Blitz' },
  { category: 'rapid', label: 'Rapid' },
];

/**
 * Create/join/lobby flow for a small friend-group round-robin tournament — same overall shape
 * as ChallengeScreen (create gets you a shareable code; join takes one), plus a lobby phase
 * showing who's in and a Start button for the creator. Once the tournament goes active,
 * onEnterStandings hands off to TournamentStandingsScreen, which owns the rest of the live flow
 * (waiting for/entering matches, standings).
 */
export default function TournamentScreen({ authToken, authUser, onEnterStandings, onBack }: TournamentScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [phase, setPhase] = useState<Phase>('menu');
  const [name, setName] = useState('');
  const [variant, setVariant] = useState<GameVariant>('classic');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lobby, setLobby] = useState<TournamentLobbyState | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (phase !== 'lobby') return;
    const socket = connectSocket(authToken);
    const handleLobbyUpdate = (payload: TournamentLobbyState) => {
      setLobby(payload);
      if (payload.status === 'active') onEnterStandings(payload.id);
    };
    socket.on('tournament_lobby_update', handleLobbyUpdate);
    return () => {
      socket.off('tournament_lobby_update', handleLobbyUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const handleCreate = (timeControl: TimeControl) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Please enter a tournament name.');
      return;
    }
    setError(null);
    const isChess960 = variant === 'chess960';
    const isKingOfTheHill = variant === 'kingOfTheHill';
    const socket = connectSocket(authToken);
    socket.emit(
      'create_tournament',
      {
        name: trimmedName,
        timeControl: { initialSeconds: timeControl.initialSeconds, incrementSeconds: timeControl.incrementSeconds },
        timeControlLabel: timeControl.label,
        isChess960,
        isKingOfTheHill,
      },
      (ack: Ack<{ code: string; tournamentId: string }>) => {
        if (!ack.ok) {
          setError(ack.error);
          return;
        }
        setLobby({
          id: ack.tournamentId,
          code: ack.code,
          name: trimmedName,
          timeControl: { initialSeconds: timeControl.initialSeconds, incrementSeconds: timeControl.incrementSeconds },
          isChess960,
          isKingOfTheHill,
          status: 'lobby',
          creatorUserId: authUser.id,
          participants: [{ userId: authUser.id, username: authUser.username }],
        });
        setPhase('lobby');
      }
    );
  };

  const handleJoin = () => {
    const trimmed = joinCodeInput.trim();
    if (!trimmed) return;
    setError(null);
    const socket = connectSocket(authToken);
    socket.emit('join_tournament', { code: trimmed }, (ack: Ack<{ tournament: TournamentLobbyState }>) => {
      if (!ack.ok) {
        setError(ack.error);
        return;
      }
      setLobby(ack.tournament);
      setPhase('lobby');
    });
  };

  const handleShareCode = () => {
    if (!lobby) return;
    Share.share({ message: `Join my "${lobby.name}" chess tournament in EM-Chess! Code: ${lobby.code}` }).catch(() => {});
  };

  const handleStart = () => {
    if (!lobby) return;
    setError(null);
    setStarting(true);
    getSocket().emit('start_tournament', { tournamentId: lobby.id }, (ack: Ack) => {
      setStarting(false);
      if (!ack.ok) {
        setError(ack.error);
        return;
      }
      onEnterStandings(lobby.id);
    });
  };

  const handleLeaveLobby = () => {
    if (lobby) getSocket().emit('leave_tournament', { tournamentId: lobby.id }, () => {});
    disconnectSocket();
    setLobby(null);
    setPhase('menu');
  };

  const handleBack = () => {
    if (phase === 'lobby') disconnectSocket();
    onBack();
  };

  const isCreator = lobby?.creatorUserId === authUser.id;

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Tournaments"
        onBack={phase === 'menu' ? handleBack : phase === 'lobby' ? handleLeaveLobby : () => setPhase('menu')}
        backLabel="‹ Back"
      />

      {phase === 'menu' && (
        <View style={styles.centerColumn}>
          <Pressable style={styles.bigButton} onPress={() => setPhase('create')}>
            <Text style={styles.bigButtonText}>Create Tournament</Text>
            <Text style={styles.bigButtonSubtext}>Get a code to invite friends (up to 8 players)</Text>
          </Pressable>
          <Pressable style={[styles.bigButton, styles.joinButton]} onPress={() => setPhase('join')}>
            <Text style={styles.bigButtonText}>Join by Code</Text>
            <Text style={styles.bigButtonSubtext}>Enter a code a friend sent you</Text>
          </Pressable>
        </View>
      )}

      {phase === 'create' && (
        <View style={styles.setupContainer}>
          <Text style={styles.sectionTitle}>Tournament name</Text>
          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={setName}
            placeholder="Friday Night Blitz"
            placeholderTextColor={colors.textMuted}
            maxLength={60}
          />
          <Text style={styles.sectionTitle}>Variant</Text>
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

      {phase === 'lobby' && lobby && (
        <View style={styles.lobbyContainer}>
          <Text style={styles.lobbyName}>{lobby.name}</Text>
          <Text style={styles.lobbySubtitle}>
            {lobby.isKingOfTheHill ? 'King of the Hill' : lobby.isChess960 ? 'Chess960' : 'Classic'}
          </Text>
          <Pressable style={styles.codeBox} onPress={handleShareCode}>
            <Text style={styles.codeText}>{lobby.code}</Text>
            <Text style={styles.codeHint}>Tap to share</Text>
          </Pressable>

          <Text style={styles.sectionTitle}>
            Players ({lobby.participants.length}/8)
          </Text>
          <ScrollView style={styles.participantList} contentContainerStyle={styles.participantListContent}>
            {lobby.participants.map((p) => (
              <View key={p.userId} style={styles.participantRow}>
                <Text style={styles.participantName}>{p.username}</Text>
                {p.userId === lobby.creatorUserId && <Text style={styles.creatorBadge}>Creator</Text>}
              </View>
            ))}
          </ScrollView>

          {error && <Text style={styles.errorText}>{error}</Text>}

          {isCreator ? (
            <>
              {lobby.participants.length < MIN_PARTICIPANTS_TO_START && (
                <Text style={styles.hintText}>
                  Need at least {MIN_PARTICIPANTS_TO_START} players to start ({lobby.participants.length} so far).
                </Text>
              )}
              <Pressable
                style={[styles.bigButton, (lobby.participants.length < MIN_PARTICIPANTS_TO_START || starting) && styles.bigButtonDisabled]}
                disabled={lobby.participants.length < MIN_PARTICIPANTS_TO_START || starting}
                onPress={handleStart}
              >
                {starting ? <ActivityIndicator color="#fff" /> : <Text style={styles.bigButtonText}>Start Tournament</Text>}
              </Pressable>
            </>
          ) : (
            <Text style={styles.hintText}>Waiting for the creator to start the tournament...</Text>
          )}
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
    lobbyContainer: {
      flex: 1,
      paddingHorizontal: 24,
      paddingTop: 12,
      gap: 12,
    },
    lobbyName: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
    },
    lobbySubtitle: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
      textAlign: 'center',
    },
    codeBox: {
      alignItems: 'center',
      paddingVertical: 12,
      backgroundColor: colors.surface,
      borderRadius: 12,
      gap: 2,
    },
    codeText: {
      fontSize: 32,
      fontWeight: '800',
      letterSpacing: 6,
      color: colors.accent,
    },
    codeHint: {
      fontSize: 11,
      color: colors.textMuted,
    },
    participantList: {
      maxHeight: 220,
    },
    participantListContent: {
      gap: 6,
    },
    participantRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 14,
      backgroundColor: colors.surface,
      borderRadius: 8,
    },
    participantName: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    creatorBadge: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.accent,
      textTransform: 'uppercase',
    },
    hintText: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
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
    bigButtonDisabled: {
      opacity: 0.4,
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
    nameInput: {
      width: '100%',
      fontSize: 16,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.text,
      backgroundColor: colors.surface,
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
  });
}
