import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { connectSocket, disconnectSocket } from '../api/socket';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import type { AuthUser } from '../types/auth';
import type { Ack, MatchFoundPayload, TournamentMatchReadyPayload, TournamentStandingsPayload } from '../types/multiplayer';

interface TournamentStandingsScreenProps {
  authToken: string;
  authUser: AuthUser;
  tournamentId: string;
  onEnterGame: (match: MatchFoundPayload) => void;
  onExit: () => void;
}

/**
 * Live standings for an active/finished tournament, plus "your next match" — either a wait state
 * (your scheduled opponent isn't free yet) or a "Play Now" button once a room exists for it.
 * Reuses the exact same socket connection TournamentScreen already opened (see api/socket.ts) and
 * hands off to the ordinary OnlineGameScreen for the actual game, exactly like a normal online
 * match — a tournament match IS an ordinary game room in every other respect.
 */
export default function TournamentStandingsScreen({ authToken, authUser, tournamentId, onEnterGame, onExit }: TournamentStandingsScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [standings, setStandings] = useState<TournamentStandingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const socket = connectSocket(authToken);

    const handleStandingsUpdate = (payload: TournamentStandingsPayload) => setStandings(payload);
    const handleMatchReady = (payload: TournamentMatchReadyPayload) => {
      onEnterGame({
        roomId: payload.roomId,
        color: payload.color,
        playerToken: payload.playerToken,
        opponent: { userId: payload.opponent.userId },
        timeControl: payload.timeControl,
        isChess960: payload.isChess960,
        isKingOfTheHill: payload.isKingOfTheHill,
        isThreeCheck: payload.isThreeCheck,
        isSetupChess: false, // Tournaments don't support Setup Chess yet
        isFogOfWar: false, // Tournaments don't support Fog of War either
        isGiveaway: false, // ...nor Giveaway
        isAtomic: false, // ...nor Atomic
        isDuckChess: false, // ...nor Duck Chess
        fen: payload.fen,
        whiteMs: payload.whiteMs,
        blackMs: payload.blackMs,
      });
    };

    socket.on('tournament_standings_update', handleStandingsUpdate);
    socket.on('tournament_match_ready', handleMatchReady);
    socket.emit('get_tournament_standings', { tournamentId }, (ack: Ack<{ standings: TournamentStandingsPayload }>) => {
      setLoading(false);
      if (!ack.ok) {
        setError(ack.error);
        return;
      }
      setStandings(ack.standings);
    });

    return () => {
      socket.off('tournament_standings_update', handleStandingsUpdate);
      socket.off('tournament_match_ready', handleMatchReady);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  const handlePlayNow = () => {
    const match = standings?.yourNextMatch;
    if (!match || match.status !== 'active' || !match.roomId || !match.playerToken || !match.color || !match.fen) return;
    onEnterGame({
      roomId: match.roomId,
      color: match.color,
      playerToken: match.playerToken,
      opponent: { userId: null },
      timeControl: match.timeControl,
      isChess960: match.isChess960,
      isKingOfTheHill: match.isKingOfTheHill,
      isThreeCheck: match.isThreeCheck,
      isSetupChess: false, // Tournaments don't support Setup Chess yet
      isFogOfWar: false, // Tournaments don't support Fog of War either
        isGiveaway: false, // ...nor Giveaway
        isAtomic: false, // ...nor Atomic
        isDuckChess: false, // ...nor Duck Chess
      fen: match.fen,
      whiteMs: match.whiteMs ?? 0,
      blackMs: match.blackMs ?? 0,
    });
  };

  const handleExit = () => {
    disconnectSocket();
    onExit();
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Tournament Standings" onBack={handleExit} backLabel="‹ Menu" />

      {loading && (
        <View style={styles.centerColumn}>
          <ActivityIndicator size="large" color={colors.text} />
        </View>
      )}

      {!loading && error && (
        <View style={styles.centerColumn}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!loading && standings && (
        <View style={styles.body}>
          {standings.status === 'finished' && <Text style={styles.finishedBanner}>Tournament finished!</Text>}

          {standings.yourNextMatch && standings.status !== 'finished' && (
            <View style={styles.nextMatchBox}>
              {standings.yourNextMatch.status === 'active' ? (
                <>
                  <Text style={styles.nextMatchTitle}>Your match vs {standings.yourNextMatch.opponentUsername} is ready!</Text>
                  <Pressable style={styles.playButton} onPress={handlePlayNow}>
                    <Text style={styles.playButtonText}>Play Now ›</Text>
                  </Pressable>
                </>
              ) : (
                <Text style={styles.nextMatchTitle}>
                  Waiting to be paired with {standings.yourNextMatch.opponentUsername}...
                </Text>
              )}
            </View>
          )}

          <Text style={styles.sectionTitle}>Standings</Text>
          <ScrollView contentContainerStyle={styles.standingsContent}>
            {standings.standings.map((row, index) => (
              <View
                key={row.userId}
                style={[styles.standingRow, row.userId === authUser.id && styles.standingRowMe]}
              >
                <Text style={styles.rank}>{index + 1}</Text>
                <Text style={styles.standingName}>{row.username}</Text>
                <Text style={styles.standingPlayed}>{row.played} played</Text>
                <Text style={styles.standingPoints}>{row.points}</Text>
              </View>
            ))}
          </ScrollView>

          {standings.status === 'finished' && (
            <Pressable style={styles.playButton} onPress={handleExit}>
              <Text style={styles.playButtonText}>Back to Menu</Text>
            </Pressable>
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
    },
    body: {
      flex: 1,
      paddingHorizontal: 20,
      gap: 12,
    },
    finishedBanner: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.accent,
      textAlign: 'center',
    },
    nextMatchBox: {
      backgroundColor: isDark ? '#1c2b3d' : '#dce8f8',
      borderRadius: 12,
      padding: 16,
      alignItems: 'center',
      gap: 10,
    },
    nextMatchTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
      textAlign: 'center',
    },
    playButton: {
      paddingVertical: 12,
      paddingHorizontal: 28,
      backgroundColor: colors.accent,
      borderRadius: 10,
    },
    playButtonText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '700',
    },
    sectionTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    standingsContent: {
      gap: 6,
      paddingBottom: 24,
    },
    standingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 14,
      backgroundColor: colors.surface,
      borderRadius: 8,
      gap: 10,
    },
    standingRowMe: {
      borderWidth: 2,
      borderColor: colors.accent,
    },
    rank: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textMuted,
      width: 20,
    },
    standingName: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    standingPlayed: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    standingPoints: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.accent,
      minWidth: 30,
      textAlign: 'right',
    },
    errorText: {
      fontSize: 14,
      color: colors.danger,
      textAlign: 'center',
    },
  });
}
