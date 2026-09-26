import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { appAlert } from '../components/AppAlert';
import ScreenHeader from '../components/ScreenHeader';
import { api, ApiError, type StoredGame } from '../api/client';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { listLocalGames } from '../logic/localGameHistory';
import { replayPgn } from '../logic/pgnReplay';
import { sharePgn } from '../logic/pgnShare';
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
  if (game.opponentType === 'online') {
    return `vs ${game.opponentUsername ?? 'Opponent'}`;
  }
  return 'Local game';
}

/** Local/Bot games have no fixed "you" (local is symmetric White/Black, and RESULT_LABELS'
 * absolute wording already reads fine there), but online games do — so for those specifically,
 * show the result from this row's own player's perspective instead of an ambiguous "White won".
 */
function formatResult(game: StoredGame): string {
  if (game.opponentType === 'online' && game.color) {
    if (game.result === '1/2-1/2') return 'Draw';
    const won = (game.color === 'w' && game.result === '1-0') || (game.color === 'b' && game.result === '0-1');
    return won ? 'You won' : 'You lost';
  }
  return RESULT_LABELS[game.result] ?? game.result;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function GameHistoryScreen({ authToken, onAnalyze, onAuthPress }: GameHistoryScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [games, setGames] = useState<StoredGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    if (!authToken) {
      // Guest/offline play: history lives on-device only (see useSaveGameOnEnd/localGameHistory),
      // never synced to an account — same games a login would instead show from the backend.
      listLocalGames()
        .then((data) => {
          if (!cancelled) setGames(data);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }

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

  const handleSharePgn = async (game: StoredGame) => {
    const outcome = await sharePgn(game.pgn);
    if (outcome === 'copied') appAlert('Copied', 'PGN copied to clipboard.');
    if (outcome === 'failed') appAlert('Could not share PGN', 'Please try again.');
  };

  const handleSelectGame = (game: StoredGame) => {
    const replayed = replayPgn(game.pgn, game.isChess960);
    if (!replayed || replayed.history.length === 0) {
      appAlert('Analysis unavailable', 'This game could not be replayed for analysis.');
      return;
    }
    onAnalyze({ initialFen: replayed.initialFen, chess960: game.isChess960, history: replayed.history });
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Analysis" />
      <Text style={styles.subtitle}>Tap a game to review it move by move.</Text>

      {!authToken && (
        <View style={styles.guestNotice}>
          <Text style={styles.guestNoticeText}>Showing games saved on this device. Log in to sync across devices.</Text>
          <Pressable onPress={onAuthPress}>
            <Text style={styles.guestNoticeLink}>Log in / Sign up</Text>
          </Pressable>
        </View>
      )}

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
          <Text style={styles.empty}>
            {authToken ? "You don't have any saved games yet." : 'No games saved on this device yet.'}
          </Text>
        </View>
      )}

      {!loading && !error && games && games.length > 0 && (
        <FlatList
          style={styles.list}
          data={games}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Pressable onPress={() => handleSelectGame(item)}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowOpponent}>
                    {formatOpponent(item)}
                    {item.isChess960 ? ' · Chess960' : ''}
                  </Text>
                  <Text style={styles.rowResult}>{formatResult(item)}</Text>
                </View>
                <View style={styles.rowBottom}>
                  <Text style={styles.rowMeta}>{formatDate(item.playedAt)}</Text>
                  <Text style={styles.rowMeta}>{item.timeControl}</Text>
                </View>
              </Pressable>
              <Pressable style={styles.shareButton} onPress={() => handleSharePgn(item)}>
                <Text style={styles.shareButtonText}>Share PGN</Text>
              </Pressable>
            </View>
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
    guestNotice: {
      paddingHorizontal: 16,
      paddingBottom: 10,
      gap: 2,
    },
    guestNoticeText: {
      fontSize: 12,
      color: colors.textMuted,
    },
    guestNoticeLink: {
      fontSize: 12,
      color: colors.accent,
      fontWeight: '600',
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
    rowTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    rowOpponent: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    rowResult: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.accent,
    },
    rowBottom: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    rowMeta: {
      fontSize: 12,
      color: colors.textMuted,
    },
    shareButton: {
      alignSelf: 'flex-start',
      marginTop: 8,
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 6,
      backgroundColor: colors.surface,
    },
    shareButtonText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.accent,
    },
  });
}
