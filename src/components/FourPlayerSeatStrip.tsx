import { StyleSheet, Text, View } from 'react-native';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { SEAT_COLORS, SEAT_NAMES, formatSeatClock, type FourPlayerClock, type FourPlayerState, type Seat, type SeatConfig } from '../logic/fourPlayer';
import { controllerName } from '../logic/fourPlayerBots';

/** Below this many seconds an active seat's clock turns red. */
const LOW_TIME_SECONDS = 10;

interface FourPlayerSeatStripProps {
  state: FourPlayerState;
  seats: SeatConfig;
  clock: FourPlayerClock;
}

/**
 * One card per seat, side by side, readable at a glance on a phone: colour + name with the score on the right, the remaining time in
 * large type underneath (omitted for "No time limit"), and who is playing the seat (Human or the roster bot's name) — or "out" once the
 * seat is eliminated, when its clock is frozen and greyed. The seat to move gets a border in its colour.
 */
export default function FourPlayerSeatStrip({ state, seats, clock }: FourPlayerSeatStripProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  return (
    <View style={styles.strip}>
      {([0, 1, 2, 3] as Seat[]).map((seat) => {
        const out = state.status[seat] !== 'active';
        const current = !state.result && state.turn === seat;
        const seconds = clock.seconds[seat];
        const low = clock.enabled && !out && seconds <= LOW_TIME_SECONDS;
        return (
          <View
            key={seat}
            accessibilityLabel={`${SEAT_NAMES[seat]}, ${controllerName(seats[seat])}, score ${state.score[seat]}${clock.enabled ? `, ${formatSeatClock(seconds)} left` : ''}${out ? ', out of the game' : ''}`}
            style={[styles.card, current && { borderColor: SEAT_COLORS[seat], borderWidth: 2, backgroundColor: colors.background }, out && styles.out]}
          >
            <View style={styles.topRow}>
              <View style={[styles.dot, { backgroundColor: SEAT_COLORS[seat] }]} />
              <Text style={styles.name} numberOfLines={1}>
                {SEAT_NAMES[seat]}
              </Text>
              <Text style={styles.score}>{state.score[seat]}</Text>
            </View>
            {clock.enabled && <Text style={[styles.time, low && current && styles.timeLow, out && styles.timeOut]}>{formatSeatClock(seconds)}</Text>}
            <Text style={styles.player} numberOfLines={1}>
              {out ? 'out' : controllerName(seats[seat])}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    strip: { flexDirection: 'row', gap: 4, paddingHorizontal: 6, alignSelf: 'stretch' },
    card: {
      flex: 1,
      gap: 1,
      paddingVertical: 4,
      paddingHorizontal: 5,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    out: { opacity: 0.5 },
    topRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    dot: { width: 9, height: 9, borderRadius: 5 },
    name: { flex: 1, fontSize: 12, fontWeight: '700', color: colors.text },
    score: { fontSize: 13, fontWeight: '800', color: colors.text },
    time: { fontSize: 17, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
    timeLow: { color: colors.danger },
    timeOut: { color: colors.textSecondary },
    player: { fontSize: 10, color: colors.textSecondary },
  });
}
