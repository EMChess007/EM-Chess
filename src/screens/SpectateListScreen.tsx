import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { Pressable } from '../components/AppPressable';
import { Text } from '../components/AppText';
import LoadFailed from '../components/LoadFailed';
import ScreenHeader from '../components/ScreenHeader';
import { SERVER_UNREACHABLE_MESSAGE } from '../logic/loadError';
import { connectSocket, disconnectSocket } from '../api/socket';
import { emitWithin } from '../api/socketAck';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { buildSpectateRows, describeBughouseGame, describeFourGame, type SpectateRow } from '../logic/fourPlayerOnlineUi';
import type { BugActiveGameSummary, BugAck } from '../logic/bughouse/wire';
import type { FourActiveGameSummary, FourAck } from '../logic/fourPlayerWire';
import type { ActiveGameSummary, Ack } from '../types/multiplayer';

interface SpectateListScreenProps {
  authToken: string | null;
  onWatch: (game: ActiveGameSummary) => void;
  onWatchFour: (game: FourActiveGameSummary) => void;
  /** Bughouse (W4b): optional so a caller that predates it still renders the list without that section. */
  onWatchBughouse?: (game: BugActiveGameSummary) => void;
  onBack: () => void;
}

/** A server without 4 Player support never answers `four_list_active_games`; the 4 Player section then simply stays out of the list. */
const FOUR_LIST_TIMEOUT_MS = 5000;

export default function SpectateListScreen({ authToken, onWatch, onWatchFour, onWatchBughouse, onBack }: SpectateListScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [rows, setRows] = useState<SpectateRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A slow answer to an earlier Refresh must not overwrite a newer list.
  const requestRef = useRef(0);

  const loadGames = useCallback(() => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    const socket = connectSocket(authToken);
    let pending = 3;
    let twoGames: ActiveGameSummary[] | null = null;
    let twoError: string | null = null;
    let fourGames: FourActiveGameSummary[] | null = null;
    let bughouseGames: BugActiveGameSummary[] | null = null;
    const finish = () => {
      pending -= 1;
      if (pending > 0 || request !== requestRef.current) return;
      if (twoGames === null && (fourGames === null || fourGames.length === 0) && (bughouseGames === null || bughouseGames.length === 0)) setError(twoError ?? 'Could not load games.');
      else setRows(buildSpectateRows(twoGames ?? [], fourGames, bughouseGames));
      setLoading(false);
    };
    // With a deadline (emitWithin): an emit on a socket that never connects waits for ever, and the spinner with it. The 2-player list has no "older server" excuse: if it does not
    // answer in time the server cannot be reached, and the screen says so with a Retry.
    emitWithin<Ack<{ games: ActiveGameSummary[] }>>(socket, 'list_active_games', {}, (result) => {
      if (result.unreachable) twoError = SERVER_UNREACHABLE_MESSAGE;
      else if (result.ack.ok) twoGames = result.ack.games;
      else twoError = result.ack.error;
      finish();
    });
    socket.timeout(FOUR_LIST_TIMEOUT_MS).emit('four_list_active_games', {}, (err: unknown, ack?: FourAck<{ games: FourActiveGameSummary[] }>) => {
      if (!err && ack && ack.ok) fourGames = ack.games;
      finish();
    });
    // The Bughouse section, with the same soft failure: a server without it simply leaves the section out.
    socket.timeout(FOUR_LIST_TIMEOUT_MS).emit('bug_list_active_games', {}, (err: unknown, ack?: BugAck<{ games: BugActiveGameSummary[] }>) => {
      if (!err && ack && ack.ok && Array.isArray(ack.games)) bughouseGames = ack.games;
      finish();
    });
  }, [authToken]);

  useEffect(() => {
    loadGames();
    // This screen only ever connects to browse — it doesn't need to stay connected once the
    // player leaves it (either back to menu, or into a spectator screen, which reuses the same
    // singleton connection while it's active and disconnects on its own exit).
    return () => {
      disconnectSocket();
    };
  }, [loadGames]);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Spectate" onBack={onBack} backLabel="‹ Menu" />
      <Text style={styles.subtitle}>Watch a live game between other players.</Text>

      {loading && (
        <View style={styles.centerRow}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      )}

      {!loading && error && (
        <View style={styles.centerRow}>
          <LoadFailed message={error} onRetry={loadGames} />
        </View>
      )}

      {!loading && !error && rows && rows.length === 0 && (
        <View style={styles.centerRow}>
          <Text style={styles.empty}>No games are being played right now.</Text>
          <Pressable style={styles.refreshButton} onPress={loadGames}>
            <Text style={styles.refreshButtonText}>Refresh</Text>
          </Pressable>
        </View>
      )}

      {!loading && !error && rows && rows.length > 0 && (
        <FlatList
          style={styles.list}
          data={rows}
          keyExtractor={(item) => item.key}
          ListHeaderComponent={
            <Pressable style={styles.refreshButton} onPress={loadGames}>
              <Text style={styles.refreshButtonText}>Refresh</Text>
            </Pressable>
          }
          renderItem={({ item }) => {
            if (item.kind === 'header') return <Text style={styles.sectionTitle}>{item.title}</Text>;
            if (item.kind === 'four') {
              return (
                <Pressable style={styles.row} onPress={() => onWatchFour(item.game)}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {describeFourGame(item.game)}
                  </Text>
                  <Text style={styles.rowMeta}>{item.game.timeControlLabel}</Text>
                </Pressable>
              );
            }
            if (item.kind === 'bughouse') {
              return (
                <Pressable style={styles.row} onPress={() => onWatchBughouse?.(item.game)} testID={`spectate-bughouse-${item.game.roomId}`}>
                  <Text style={styles.rowTitle}>{describeBughouseGame(item.game)}</Text>
                  <Text style={styles.rowMeta}>{item.game.timeControlLabel}</Text>
                </Pressable>
              );
            }
            return (
              <Pressable style={styles.row} onPress={() => onWatch(item.game)}>
                <Text style={styles.rowTitle}>
                  {item.game.whiteUsername} vs {item.game.blackUsername}
                </Text>
                <Text style={styles.rowMeta}>
                  {item.game.timeControlLabel}
                  {item.game.isChess960 ? ' · Chess960' : ''}
                </Text>
              </Pressable>
            );
          }}
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
    sectionTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSecondary,
      marginTop: 10,
      textTransform: 'uppercase',
    },
  });
}
