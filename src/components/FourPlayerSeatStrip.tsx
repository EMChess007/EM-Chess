import { StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { SEAT_COLORS, SEAT_NAMES, formatSeatClock, variantOfRules, type FourPlayerClock, type FourPlayerState, type Seat, type SeatConfig } from '../logic/fourPlayer';
import { controllerName } from '../logic/fourPlayerBots';
import { describeGain, formatGain, seatStatusOf, type ScoreGain } from '../logic/chaturajiUi';
import { seatMetric, seatMetricText } from '../logic/fourPlayerVariant';
import type { FourSeatLabel } from '../logic/fourPlayerOnlineUi';

/** Below this many seconds an active seat's clock turns red. */
const LOW_TIME_SECONDS = 10;

interface FourPlayerSeatStripProps {
  state: FourPlayerState;
  /** Local games: who controls each seat (Human / the roster bot's name). Omit when `labels` is given. */
  seats?: SeatConfig;
  clock: FourPlayerClock;
  /** Online games: the name under each clock ("Ana (you)", "Bot (Amateur)") and an optional badge ("bot playing", "offline · 32s"). Wins over `seats`. */
  labels?: readonly FourSeatLabel[];
  /** Chaturaji: the points each seat just scored, shown as a "+N" on its card for a moment (from the engine's / server's score, see `useScoreGains`). */
  gains?: readonly ScoreGain[];
}

/**
 * One card per seat, side by side, readable at a glance on a phone: colour + name with the score on the right (PIECES LEFT in 4 Player Giveaway, which has no points), the remaining time in
 * large type underneath (omitted for "No time limit"), and who is playing the seat (Human or the roster bot's name; online, the player's
 * name) — or "out" once the seat is eliminated, when its clock is frozen and greyed. The seat to move gets a border in its colour. An
 * online seat can also carry a small badge line (a bot that took over, a player inside the disconnect grace period).
 */
export default function FourPlayerSeatStrip({ state, seats, clock, labels, gains }: FourPlayerSeatStripProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const chaturaji = variantOfRules(state.rules) === 'chaturaji';
  return (
    <View style={styles.strip}>
      {([0, 1, 2, 3] as Seat[]).map((seat) => {
        const out = state.status[seat] !== 'active';
        const current = !state.result && state.turn === seat;
        const seconds = clock.seconds[seat];
        const low = clock.enabled && !out && seconds <= LOW_TIME_SECONDS;
        const label = labels?.[seat];
        const playerName = label ? label.name : seats ? controllerName(seats[seat]) : '';
        const badge = !out && label?.badge ? label.badge : null;
        // Chaturaji tells the three kinds of "not playing" apart and flags an attacked king; the other games keep their single word.
        const status = chaturaji ? seatStatusOf(state, seat) : null;
        const outWord = status ? (status.kind === 'walking' ? status.text : 'out') : 'out';
        const attacked = status?.kind === 'attacked';
        const gain = gains?.find((g) => g.seat === seat);
        return (
          <View
            key={seat}
            testID={`seat-${seat}`}
            accessibilityLabel={`${SEAT_NAMES[seat]}, ${playerName}${badge ? `, ${badge}` : ''}, ${seatMetricText(state, seat)}${clock.enabled ? `, ${formatSeatClock(seconds)} left` : ''}${out ? (status?.kind === 'walking' ? ', out of the game, its king keeps walking' : ', out of the game') : ''}${attacked ? ', king attacked' : ''}${gain ? `, ${describeGain(gain)}` : ''}`}
            style={[styles.card, current && { borderColor: SEAT_COLORS[seat], borderWidth: 2, backgroundColor: colors.background }, out && styles.out]}
          >
            <View style={styles.topRow}>
              <View style={[styles.dot, { backgroundColor: SEAT_COLORS[seat] }]} />
              <Text style={styles.name} numberOfLines={1}>
                {SEAT_NAMES[seat]}
              </Text>
              <Text style={styles.score}>{seatMetric(state, seat)}</Text>
            </View>
            {clock.enabled && <Text style={[styles.time, low && current && styles.timeLow, out && styles.timeOut]}>{formatSeatClock(seconds)}</Text>}
            <Text style={styles.player} numberOfLines={1}>
              {out ? outWord : playerName}
            </Text>
            {attacked && (
              <Text testID={`seat-${seat}-attacked`} style={styles.attacked} numberOfLines={1}>
                king attacked
              </Text>
            )}
            {badge && (
              <Text style={styles.badge} numberOfLines={1}>
                {badge}
              </Text>
            )}
            {gain && (
              <Text testID={`gain-${seat}`} style={styles.gain} pointerEvents="none">
                {formatGain(gain.points)}
              </Text>
            )}
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
    badge: { fontSize: 9, fontWeight: '700', color: colors.gold },
    attacked: { fontSize: 9, fontWeight: '700', color: colors.mode === 'dark' ? '#ffb74d' : '#b26a00' },
    gain: {
      position: 'absolute',
      top: -9,
      right: 2,
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 8,
      overflow: 'hidden',
      fontSize: 12,
      fontWeight: '800',
      color: '#1b1b1b',
      backgroundColor: '#ffd54f',
    },
  });
}
