import { StyleSheet, Text, View } from 'react-native';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { SEAT_COLORS, SEAT_NAMES } from '../logic/fourPlayer';
import { describeFourResultNote, resultRows } from '../logic/fourPlayerOnlineUi';
import type { FourGameOverPayload, FourSeatInfo, FourVariant } from '../logic/fourPlayerWire';

interface FourPlayerResultCardProps {
  gameOver: FourGameOverPayload;
  seats: readonly FourSeatInfo[];
  /** Which game it was; omitted = 4 Player Chess (points). Giveaway ranks the winner first and shows the pieces each seat had left. */
  variant?: FourVariant;
}

/** The final ranking of an online 4 Player game (highest score first, winners in bold) and why it ended. An abandoned game (every human
 * left) has no result, so it shows only the note, never scores. */
export default function FourPlayerResultCard({ gameOver, seats, variant = 'ffa' }: FourPlayerResultCardProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const rows = resultRows(gameOver, seats, variant);
  return (
    <View style={styles.card}>
      {rows.map((row) => (
        <View key={row.seat} style={styles.row}>
          <Text style={styles.place}>{row.place}.</Text>
          <View style={[styles.dot, { backgroundColor: SEAT_COLORS[row.seat] }]} />
          <Text style={[styles.name, row.winner && styles.winner]} numberOfLines={1}>
            {row.name} <Text style={styles.meta}>({SEAT_NAMES[row.seat]})</Text>
          </Text>
          <Text style={styles.score}>{variant === 'giveaway' ? `${row.score} left` : row.score}</Text>
        </View>
      ))}
      <Text style={styles.note}>{describeFourResultNote(gameOver.reason, variant, gameOver.winners)}</Text>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    card: { alignSelf: 'stretch', marginHorizontal: 16, padding: 10, gap: 4, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    place: { width: 18, fontSize: 14, color: colors.textSecondary },
    dot: { width: 10, height: 10, borderRadius: 5 },
    name: { flex: 1, fontSize: 14, color: colors.text },
    winner: { fontWeight: '800' },
    meta: { fontSize: 11, color: colors.textSecondary, fontWeight: '400' },
    score: { fontSize: 15, fontWeight: '700', color: colors.text },
    note: { fontSize: 11, color: colors.textSecondary, textAlign: 'center', marginTop: 2 },
  });
}
