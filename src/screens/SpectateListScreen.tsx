import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { connectSocket, disconnectSocket } from '../api/socket';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import type { ActiveGameSummary, Ack } from '../types/multiplayer';

interface SpectateListScreenProps {
  authToken: string | null;
  onWatch: (game: ActiveGameSummary) => void;
  onBack: () => void;
}

export default function SpectateListScreen({ authToken, onWatch, onBack }: SpectateListScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [games, setGames] = useState<ActiveGameSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadGames = useCallback(() => {
    setLoading(true);
    setError(null);
    const socket = connectSocket(authToken);
    socket.emit('list_active_games', {}, (ack: Ack<{ games: ActiveGameSummary[] }>) => {
      if (!ack.ok) {
        setError(ack.error);
      } else {
        setGames(ack.games);
      }
      setLoading(false);
    });
  }, [authToken]);

  useEffect(() => {
    loadGames();
    // This screen only ever connects to browse — it doesn't need to stay connected once the
    // player leaves it (either back to menu, or into SpectatorGameScreen, which reuses the same
    // singleton connection while it's active and disconnects on its own exit).
    return () => {
      disconnectSocket();
    };
  }, [loadGames]);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Spectate" onBack={onBack} backLabel="‹ Menu" />
      <Text style={styles.subtitle}>Watch a live game between two other players.</Text>

      {loading && (
        <View style={styles.centerRow}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      )}

      {!loading && error && (
        <View style={styles.centerRow}>
          <Text style={styles.error}>{error}</Text>
        </View>
      )}

      {!loading && !error && games && games.length === 0 && (
        <View style={styles.centerRow}>
          <Text style={styles.empty}>No games are being played right now.</Text>
          <Pressable style={styles.refreshButton} onPress={loadGames}>
            <Text style={styles.refreshButtonText}>Refresh</Text>
          </Pressable>
        </View>
      )}

      {!loading && !error && games && games.length > 0 && (
        <FlatList
          style={styles.list}
          data={games}
          keyExtractor={(item) => item.roomId}
          ListHeaderComponent={
            <Pressable style={styles.refreshButton} onPress={loadGames}>
              <Text style={styles.refreshButtonText}>Refresh</Text>
            </Pressable>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => onWatch(item)}>
              <Text style={styles.rowTitle}>
                {item.whiteUsername} vs {item.blackUsername}
              </Text>
              <Text style={styles.rowMeta}>
                {item.timeControlLabel}
                {item.isChess960 ? ' · Chess960' : ''}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    subtitle: {
      fontSize: 12,
      color: colors.textMuted,
      paddingHorizontal: 16,
      marginTop: 2,
      marginBottom: 8,
    },
    centerRow: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      gap: 12,
    },
    error: {
      color: colors.danger,
      fontSize: 14,
      textAlign: 'center',
    },
    empty: {
      color: colors.textSecondary,
      fontSize: 14,
      textAlign: 'center',
    },
    refreshButton: {
      alignSelf: 'center',
      paddingVertical: 8,
      paddingHorizontal: 20,
      borderRadius: 8,
      backgroundColor: colors.buttonBackground,
      marginBottom: 8,
    },
    refreshButtonText: {
      color: '#fff',
      fontSize: 13,
      fontWeight: '600',
    },
    list: {
      flex: 1,
      paddingHorizontal: 16,
    },
    row: {
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 4,
    },
    rowTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    rowMeta: {
      fontSize: 12,
      color: colors.textMuted,
    },
  });
}
