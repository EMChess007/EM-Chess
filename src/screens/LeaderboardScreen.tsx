import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { api, ApiError, type LeaderboardResponse } from '../api/client';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { RATING_CATEGORIES, type RatingCategory } from '../logic/rating';

interface LeaderboardScreenProps {
  authToken: string;
  onBack: () => void;
}

const CATEGORY_LABELS: Record<RatingCategory, string> = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid' };

export default function LeaderboardScreen({ authToken, onBack }: LeaderboardScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [category, setCategory] = useState<RatingCategory>('blitz');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getLeaderboard(authToken, category)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load leaderboard.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authToken, category]);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Leaderboard" onBack={onBack} backLabel="‹ Back" />

      <View style={styles.tabRow}>
        {RATING_CATEGORIES.map((c) => (
          <Pressable key={c} style={[styles.tab, category === c && styles.tabActive]} onPress={() => setCategory(c)}>
            <Text style={[styles.tabText, category === c && styles.tabTextActive]}>{CATEGORY_LABELS[c]}</Text>
          </Pressable>
        ))}
      </View>

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

      {!loading && !error && data && (
        <>
          {data.me && (
            <View style={styles.meRow}>
              <Text style={styles.meText}>
                Your rank: #{data.me.rank} · {data.me.rating}
              </Text>
            </View>
          )}
          <FlatList
            style={styles.list}
            data={data.entries}
            keyExtractor={(item) => item.userId}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Text style={styles.rank}>#{item.rank}</Text>
                <Text style={styles.username}>{item.username}</Text>
                <Text style={styles.rating}>{item.rating}</Text>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.centerRow}>
                <Text style={styles.empty}>No ratings yet for this category.</Text>
              </View>
            }
          />
        </>
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
    tabRow: {
      flexDirection: 'row',
      paddingHorizontal: 16,
      gap: 8,
      marginBottom: 8,
    },
    tab: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: 8,
      alignItems: 'center',
      backgroundColor: colors.surface,
    },
    tabActive: {
      backgroundColor: colors.accent,
    },
    tabText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    tabTextActive: {
      color: '#fff',
    },
    centerRow: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
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
    meRow: {
      marginHorizontal: 16,
      marginBottom: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: colors.surface,
    },
    meText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
    },
    list: {
      flex: 1,
      paddingHorizontal: 16,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 10,
    },
    rank: {
      width: 36,
      fontSize: 13,
      color: colors.textMuted,
      fontWeight: '700',
    },
    username: {
      flex: 1,
      fontSize: 15,
      color: colors.text,
      fontWeight: '600',
    },
    rating: {
      fontSize: 15,
      color: colors.accent,
      fontWeight: '700',
    },
  });
}
