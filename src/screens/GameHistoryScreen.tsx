import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { api, ApiError, type StoredGame } from '../api/client';
import { replayPgn } from '../logic/pgnReplay';
import type { AnalyzeParams } from '../types/history';

interface GameHistoryScreenProps {
  authToken: string | null;
  onAnalyze: (params: AnalyzeParams) => void;
  onAuthPress: () => void;
}

const RESULT_LABELS: Record<string, string> = {
  '1-0': 'White won',
  '0-1': 'Black won',
  '1/2-1/2': 'Draw',
};

function formatOpponent(game: StoredGame): string {
  if (game.opponentType === 'bot') {
    return game.opponentElo != null ? `Bot (ELO ${game.opponentElo})` : 'Bot';
  }
  return 'Local game';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function GameHistoryScreen({ authToken, onAnalyze, onAuthPress }: GameHistoryScreenProps) {
  const [games, setGames] = useState<StoredGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!authToken);

  useEffect(() => {
    if (!authToken) {
      setGames(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listGames(authToken)
      .then((data) => {
        if (!cancelled) setGames(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load history.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authToken]);

  const handleSelectGame = (game: StoredGame) => {
    const replayed = replayPgn(game.pgn, game.isChess960);
    if (!replayed || replayed.history.length === 0) {
      Alert.alert('Analysis unavailable', 'This game could not be replayed for analysis.');
      return;
    }
    onAnalyze({ initialFen: replayed.initialFen, chess960: game.isChess960, history: replayed.history });
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Analysis" />
      <Text style={styles.subtitle}>Tap a game to review it move by move.</Text>

      {!authToken && (
        <View style={styles.centerRow}>
          <Text style={styles.empty}>Log in to see your game history and analysis.</Text>
          <Pressable style={styles.loginButton} onPress={onAuthPress}>
            <Text style={styles.loginButtonText}>Log in / Sign up</Text>
          </Pressable>
        </View>
      )}

      {authToken && loading && (
        <View style={styles.centerRow}>
          <ActivityIndicator size="small" color="#3a2618" />
        </View>
      )}

      {authToken && !loading && error && (
        <View style={styles.centerRow}>
          <Text style={styles.error}>{error}</Text>
        </View>
      )}

      {!loading && !error && games && games.length === 0 && (
        <View style={styles.centerRow}>
          <Text style={styles.empty}>You don't have any saved games yet.</Text>
        </View>
      )}

      {!loading && !error && games && games.length > 0 && (
        <FlatList
          style={styles.list}
          data={games}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => handleSelectGame(item)}>
              <View style={styles.rowTop}>
                <Text style={styles.rowOpponent}>
                  {formatOpponent(item)}
                  {item.isChess960 ? ' · Chess960' : ''}
                </Text>
                <Text style={styles.rowResult}>{RESULT_LABELS[item.result] ?? item.result}</Text>
              </View>
              <View style={styles.rowBottom}>
                <Text style={styles.rowMeta}>{formatDate(item.playedAt)}</Text>
                <Text style={styles.rowMeta}>{item.timeControl}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  subtitle: {
    fontSize: 12,
    color: '#999',
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
  loginButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#3a2618',
    borderRadius: 8,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  error: {
    color: '#b00020',
    fontSize: 14,
    textAlign: 'center',
  },
  empty: {
    color: '#777',
    fontSize: 14,
    textAlign: 'center',
  },
  list: {
    flex: 1,
    paddingHorizontal: 16,
  },
  row: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    gap: 4,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowOpponent: {
    fontSize: 15,
    fontWeight: '600',
    color: '#3a2618',
  },
  rowResult: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2e6f4f',
  },
  rowBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rowMeta: {
    fontSize: 12,
    color: '#888',
  },
});
