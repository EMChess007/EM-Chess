import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type StoredGame } from '../api/client';
import { appAlert } from '../components/AppAlert';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { getDailyPuzzle } from '../logic/puzzles';
import { isTodayPuzzleSolved } from '../logic/puzzleStorage';
import { replayPgn } from '../logic/pgnReplay';
import { useStreak } from '../logic/streakStorage';
import type { AnalyzeParams } from '../types/history';

interface HomeScreenProps {
  onPlay: () => void;
  onOpenPuzzles: () => void;
  onOpenAnalysis: () => void;
  onOpenStreak: () => void;
  onAnalyzeGame: (params: AnalyzeParams) => void;
  authToken: string | null;
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

// See GameHistoryScreen's identical helper for why online games need this instead of the
// absolute "White won"/"Black won" wording — local/bot games have no fixed "you".
function formatResult(game: StoredGame): string {
  if (game.opponentType === 'online' && game.color) {
    if (game.result === '1/2-1/2') return 'Draw';
    const won = (game.color === 'w' && game.result === '1-0') || (game.color === 'b' && game.result === '0-1');
    return won ? 'You won' : 'You lost';
  }
  return RESULT_LABELS[game.result] ?? game.result;
}

export default function HomeScreen({ onPlay, onOpenPuzzles, onOpenAnalysis, onOpenStreak, onAnalyzeGame, authToken }: HomeScreenProps) {
  // react-native's own <SafeAreaView> only actually applies an inset on iOS — on Android it's a
  // no-op, which is how the title ended up underneath the status bar there. Reading the inset
  // directly and adding it on top of the screen's own top padding works on both platforms.
  const insets = useSafeAreaInsets();
  const colors = useAppColors();
  const streak = useStreak();
  const styles = createStyles(colors);
  const puzzle = getDailyPuzzle();
  const [puzzleSolved, setPuzzleSolved] = useState(false);
  const [games, setGames] = useState<StoredGame[] | null>(null);
  const [loadingGames, setLoadingGames] = useState(false);

  useEffect(() => {
    let cancelled = false;
    isTodayPuzzleSolved().then((solved) => {
      if (!cancelled) setPuzzleSolved(solved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authToken) {
      setGames(null);
      return;
    }
    let cancelled = false;
    setLoadingGames(true);
    api
      .listGames(authToken)
      .then((data) => {
        if (!cancelled) setGames(data);
      })
      .catch(() => {
        // Silent, non-blocking — the Home screen still works fine without stats/history.
      })
      .finally(() => {
        if (!cancelled) setLoadingGames(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authToken]);

  const recentGames = games?.slice(0, 3) ?? [];

  const handleSelectGame = (game: StoredGame) => {
    const replayed = replayPgn(game.pgn, game.isChess960);
    if (!replayed || replayed.history.length === 0) {
      appAlert('Analysis unavailable', 'This game could not be replayed for analysis.');
      return;
    }
    onAnalyzeGame({ initialFen: replayed.initialFen, chess960: game.isChess960, history: replayed.history });
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 20 }]}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>EM-Chess</Text>
          <Pressable style={styles.streakBadge} onPress={onOpenStreak}>
            <Text style={styles.streakFlame}>🔥</Text>
            <Text style={styles.streakCount}>{streak}</Text>
          </Pressable>
        </View>

        <Pressable style={styles.playButton} onPress={onPlay}>
          <Text style={styles.playButtonText}>Play</Text>
        </Pressable>

        <Pressable style={styles.puzzleTile} onPress={onOpenPuzzles}>
          <View style={styles.puzzleTileInfo}>
            <Text style={styles.puzzleTileTitle}>Daily Puzzle</Text>
            <Text style={styles.puzzleTileSubtitle}>Rating {puzzle.rating}</Text>
          </View>
          {puzzleSolved && (
            <View style={styles.puzzleSolvedBadge}>
              <Text style={styles.puzzleSolvedBadgeText}>Solved</Text>
            </View>
          )}
        </Pressable>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Stats</Text>
          {!authToken ? (
            <Text style={styles.sectionPlaceholder}>Log in to track your stats.</Text>
          ) : loadingGames ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{games?.length ?? 0}</Text>
                <Text style={styles.statLabel}>Games Played</Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Recent Games</Text>
            {authToken && recentGames.length > 0 && (
              <Pressable onPress={onOpenAnalysis}>
                <Text style={styles.sectionLink}>See all</Text>
              </Pressable>
            )}
          </View>
          {!authToken ? (
            <Text style={styles.sectionPlaceholder}>Log in to see your recent games.</Text>
          ) : loadingGames ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : recentGames.length === 0 ? (
            <Text style={styles.sectionPlaceholder}>No games played yet.</Text>
          ) : (
            <View style={styles.recentGameList}>
              {recentGames.map((game) => (
                <Pressable key={game.id} style={styles.recentGameRow} onPress={() => handleSelectGame(game)}>
                  <Text style={styles.recentGameOpponent}>
                    {formatOpponent(game)}
                    {game.isChess960 ? ' · Chess960' : ''}
                  </Text>
                  <Text style={styles.recentGameResult}>{formatResult(game)}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      padding: 20,
      paddingBottom: 32,
      gap: 18,
      alignItems: 'center',
    },
    titleRow: {
      width: '100%',
      maxWidth: 400,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    title: {
      fontSize: 32,
      fontWeight: 'bold',
      color: colors.text,
      marginBottom: 4,
    },
    streakBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 6,
      paddingHorizontal: 10,
      backgroundColor: colors.surface,
      borderRadius: 20,
    },
    streakFlame: {
      fontSize: 18,
    },
    streakCount: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    playButton: {
      paddingVertical: 26,
      paddingHorizontal: 64,
      backgroundColor: colors.accent,
      borderRadius: 16,
      minWidth: 260,
      alignItems: 'center',
    },
    playButtonText: {
      color: '#fff',
      fontSize: 28,
      fontWeight: '700',
    },
    puzzleTile: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      maxWidth: 400,
      paddingVertical: 14,
      paddingHorizontal: 20,
      backgroundColor: colors.gold,
      borderRadius: 12,
    },
    puzzleTileInfo: {
      gap: 2,
    },
    puzzleTileTitle: {
      color: '#fff',
      fontSize: 17,
      fontWeight: '700',
    },
    puzzleTileSubtitle: {
      color: '#fff',
      opacity: 0.85,
      fontSize: 12,
    },
    puzzleSolvedBadge: {
      backgroundColor: 'rgba(255,255,255,0.25)',
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 8,
    },
    puzzleSolvedBadgeText: {
      color: '#fff',
      fontSize: 11,
      fontWeight: '700',
    },
    section: {
      width: '100%',
      maxWidth: 400,
      gap: 8,
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    sectionLink: {
      fontSize: 13,
      color: colors.gold,
      fontWeight: '600',
    },
    sectionPlaceholder: {
      fontSize: 13,
      color: colors.textMuted,
    },
    statsRow: {
      flexDirection: 'row',
      gap: 12,
    },
    statBox: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 18,
      alignItems: 'center',
    },
    statValue: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.text,
    },
    statLabel: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 2,
    },
    recentGameList: {
      gap: 6,
    },
    recentGameRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 14,
      backgroundColor: colors.surface,
      borderRadius: 8,
    },
    recentGameOpponent: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
    recentGameResult: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.accent,
    },
  });
}
