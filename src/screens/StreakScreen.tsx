import { StyleSheet, Text, View } from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { useAppColors } from '../logic/colorSchemeHooks';
import { getActiveDates, useStreak } from '../logic/streakStorage';

interface StreakScreenProps {
  onBack: () => void;
}

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Monday-through-Sunday of the week containing `today`, as plain date keys. */
function getCurrentWeekKeys(today: Date): string[] {
  const day = today.getDay(); // 0 = Sunday .. 6 = Saturday
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return dateKey(d);
  });
}

export default function StreakScreen({ onBack }: StreakScreenProps) {
  const colors = useAppColors();
  const streak = useStreak();
  const activeDates = new Set(getActiveDates());

  const today = new Date();
  const todayKey = dateKey(today);
  const weekKeys = getCurrentWeekKeys(today);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Streak" onBack={onBack} />

      <View style={styles.body}>
        <Text style={styles.flame}>🔥</Text>
        <Text style={[styles.streakCount, { color: colors.text }]}>{streak}</Text>
        <Text style={[styles.streakLabel, { color: colors.textSecondary }]}>
          {streak === 1 ? 'Day Streak' : 'Day Streak'}
        </Text>

        <View style={styles.weekRow}>
          {weekKeys.map((key, i) => {
            const isActive = activeDates.has(key);
            const isFuture = key > todayKey;
            const isToday = key === todayKey;
            return (
              <View key={key} style={styles.dayColumn}>
                <Text style={[styles.dayLetter, { color: colors.textMuted }, isToday && { color: colors.text }]}>
                  {DAY_LETTERS[i]}
                </Text>
                <View
                  style={[
                    styles.dayCircle,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                    isActive && { backgroundColor: colors.gold, borderColor: colors.gold },
                    isToday && !isActive && { borderColor: colors.accent, borderWidth: 2 },
                  ]}
                >
                  <Text style={styles.dayIcon}>{isActive ? '✓' : isFuture ? '' : '⏸'}</Text>
                </View>
              </View>
            );
          })}
        </View>

        <Text style={[styles.hint, { color: colors.textMuted }]}>
          Open the app every day to keep your streak going.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 32,
    paddingHorizontal: 24,
    gap: 8,
  },
  flame: {
    fontSize: 72,
  },
  streakCount: {
    fontSize: 40,
    fontWeight: '800',
    marginTop: 4,
  },
  streakLabel: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 24,
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: 380,
  },
  dayColumn: {
    alignItems: 'center',
    gap: 6,
  },
  dayLetter: {
    fontSize: 12,
    fontWeight: '700',
  },
  dayCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayIcon: {
    fontSize: 15,
    color: '#fff',
  },
  hint: {
    fontSize: 13,
    marginTop: 28,
    textAlign: 'center',
  },
});
