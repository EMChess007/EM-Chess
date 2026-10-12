import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { DEFAULT_BOT_ELO, SEAT_COLORS, SEAT_NAMES, isStartable, withController, type Seat, type SeatConfig } from '../logic/fourPlayer';
import { botDisplayName } from '../logic/fourPlayerBots';

interface FourPlayerSetupScreenProps {
  /** The current choice for each seat. The setup state lives in App's navigation state (so it survives the trip to the bot picker). */
  seats: SeatConfig;
  onChange: (seats: SeatConfig) => void;
  /** Opens the app's regular "Select a Bot" roster for this seat; App stores the pick and returns here. */
  onPickBot: (seat: Seat) => void;
  onContinue: () => void;
  onBack: () => void;
}

/**
 * Chooses who controls each of the four seats: a human at the device, or a bot picked from the SAME named roster the other game modes use
 * (Kiddo 400 … The Unbeatable 3000). Then on to the time control.
 */
export default function FourPlayerSetupScreen({ seats, onChange, onPickBot, onContinue, onBack }: FourPlayerSetupScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const startable = isStartable(seats);

  return (
    <View style={styles.container}>
      <ScreenHeader title="4 Player Chess" subtitle="Free-for-All" onBack={onBack} backLabel="‹ Back" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>Four players, one board. Checkmate players to eliminate them and score points — the highest score wins once three are out.</Text>

        {([0, 1, 2, 3] as Seat[]).map((seat) => {
          const controller = seats[seat];
          return (
            <View key={seat} style={styles.seatCard}>
              <View style={styles.seatHeader}>
                <View style={[styles.dot, { backgroundColor: SEAT_COLORS[seat] }]} />
                <Text style={styles.seatName}>{SEAT_NAMES[seat]}</Text>
                <View style={styles.toggle}>
                  <Pressable
                    accessibilityLabel={`${SEAT_NAMES[seat]}: human`}
                    style={[styles.toggleOption, controller.kind === 'human' && styles.toggleActive]}
                    onPress={() => onChange(withController(seats, seat, { kind: 'human' }))}
                  >
                    <Text style={[styles.toggleText, controller.kind === 'human' && styles.toggleTextActive]}>Human</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`${SEAT_NAMES[seat]}: bot`}
                    style={[styles.toggleOption, controller.kind === 'bot' && styles.toggleActive]}
                    onPress={() => onChange(withController(seats, seat, controller.kind === 'bot' ? controller : { kind: 'bot', elo: DEFAULT_BOT_ELO }))}
                  >
                    <Text style={[styles.toggleText, controller.kind === 'bot' && styles.toggleTextActive]}>Bot</Text>
                  </Pressable>
                </View>
              </View>
              {controller.kind === 'bot' && (
                <Pressable accessibilityLabel={`${SEAT_NAMES[seat]} bot: ${botDisplayName(controller.elo)}, change`} style={styles.botRow} onPress={() => onPickBot(seat)}>
                  <Text style={styles.botName}>{botDisplayName(controller.elo)}</Text>
                  <Text style={styles.botElo}>ELO {controller.elo}</Text>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              )}
            </View>
          );
        })}

        {!startable && <Text style={styles.warning}>At least one seat must be a human.</Text>}
        <Pressable style={[styles.startButton, !startable && styles.startDisabled]} disabled={!startable} onPress={onContinue}>
          <Text style={styles.startText}>Choose time control</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function createStyles(colors: AppColors) {
  const isDark = colors.mode === 'dark';
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 12 },
    intro: { fontSize: 13, color: colors.textSecondary },
    seatCard: { padding: 12, gap: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    seatHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    dot: { width: 16, height: 16, borderRadius: 8 },
    seatName: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.text },
    toggle: { flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
    toggleOption: { paddingVertical: 8, paddingHorizontal: 16, backgroundColor: colors.background },
    toggleActive: { backgroundColor: colors.buttonBackground },
    toggleText: { fontSize: 14, fontWeight: '600', color: colors.text },
    toggleTextActive: { color: '#fff' },
    botRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 10,
      borderWidth: 1,
      backgroundColor: isDark ? '#3a3120' : '#f0d9b5',
      borderColor: isDark ? '#6b5a3a' : '#b58863',
    },
    botName: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.text },
    botElo: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
    chevron: { fontSize: 22, color: colors.textSecondary, marginTop: -2 },
    warning: { color: colors.danger, fontSize: 13, textAlign: 'center' },
    startButton: { paddingVertical: 15, borderRadius: 12, backgroundColor: colors.buttonBackground, alignItems: 'center', marginTop: 4 },
    startDisabled: { opacity: 0.4 },
    startText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  });
}
