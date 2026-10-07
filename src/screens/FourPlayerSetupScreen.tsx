import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import {
  BOT_LEVELS,
  SEAT_COLORS,
  SEAT_NAMES,
  allHumansConfig,
  isStartable,
  oneHumanConfig,
  withController,
  type BotLevel,
  type Seat,
  type SeatConfig,
} from '../logic/fourPlayer';

interface FourPlayerSetupScreenProps {
  onStart: (seats: SeatConfig) => void;
  onBack: () => void;
}

const LEVEL_LABELS: Record<BotLevel, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/**
 * Chooses who controls each of the four seats — a human at the device or a bot of a level — then starts a Free-for-All game.
 * Two presets cover the common cases (1 human + 3 bots, 4 humans sharing the device); anything in between is just toggling seats.
 */
export default function FourPlayerSetupScreen({ onStart, onBack }: FourPlayerSetupScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [config, setConfig] = useState<SeatConfig>(() => oneHumanConfig('medium'));
  const startable = isStartable(config);

  return (
    <View style={styles.container}>
      <ScreenHeader title="4 Player Chess" subtitle="Free-for-All" onBack={onBack} backLabel="‹ Back" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>Four players, one board. Checkmate players to eliminate them and score points — the highest score wins once three are out.</Text>

        <View style={styles.presetRow}>
          <Pressable style={styles.presetButton} onPress={() => setConfig(oneHumanConfig('medium'))}>
            <Text style={styles.presetText}>1 human + 3 bots</Text>
          </Pressable>
          <Pressable style={styles.presetButton} onPress={() => setConfig(allHumansConfig())}>
            <Text style={styles.presetText}>4 humans (pass the device)</Text>
          </Pressable>
        </View>

        {([0, 1, 2, 3] as Seat[]).map((seat) => {
          const controller = config[seat];
          return (
            <View key={seat} style={styles.seatCard}>
              <View style={styles.seatHeader}>
                <View style={[styles.dot, { backgroundColor: SEAT_COLORS[seat] }]} />
                <Text style={styles.seatName}>{SEAT_NAMES[seat]}</Text>
                <View style={styles.toggle}>
                  <Pressable
                    accessibilityLabel={`${SEAT_NAMES[seat]}: human`}
                    style={[styles.toggleOption, controller.kind === 'human' && styles.toggleActive]}
                    onPress={() => setConfig(withController(config, seat, { kind: 'human' }))}
                  >
                    <Text style={[styles.toggleText, controller.kind === 'human' && styles.toggleTextActive]}>Human</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`${SEAT_NAMES[seat]}: bot`}
                    style={[styles.toggleOption, controller.kind === 'bot' && styles.toggleActive]}
                    onPress={() => setConfig(withController(config, seat, controller.kind === 'bot' ? controller : { kind: 'bot', level: 'medium' }))}
                  >
                    <Text style={[styles.toggleText, controller.kind === 'bot' && styles.toggleTextActive]}>Bot</Text>
                  </Pressable>
                </View>
              </View>
              {controller.kind === 'bot' && (
                <View style={styles.levelRow}>
                  {BOT_LEVELS.map((level) => (
                    <Pressable
                      key={level}
                      accessibilityLabel={`${SEAT_NAMES[seat]} bot level ${level}`}
                      style={[styles.levelChip, controller.level === level && styles.levelChipActive]}
                      onPress={() => setConfig(withController(config, seat, { kind: 'bot', level }))}
                    >
                      <Text style={[styles.levelText, controller.level === level && styles.levelTextActive]}>{LEVEL_LABELS[level]}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          );
        })}

        {!startable && <Text style={styles.warning}>At least one seat must be a human.</Text>}
        <Pressable style={[styles.startButton, !startable && styles.startDisabled]} disabled={!startable} onPress={() => onStart(config)}>
          <Text style={styles.startText}>Start game</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 12 },
    intro: { fontSize: 13, color: colors.textSecondary },
    presetRow: { flexDirection: 'row', gap: 10 },
    presetButton: { flex: 1, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10, backgroundColor: colors.accent, alignItems: 'center' },
    presetText: { color: '#fff', fontSize: 13, fontWeight: '700', textAlign: 'center' },
    seatCard: { padding: 12, gap: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    seatHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    dot: { width: 16, height: 16, borderRadius: 8 },
    seatName: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.text },
    toggle: { flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
    toggleOption: { paddingVertical: 8, paddingHorizontal: 16, backgroundColor: colors.background },
    toggleActive: { backgroundColor: colors.buttonBackground },
    toggleText: { fontSize: 14, fontWeight: '600', color: colors.text },
    toggleTextActive: { color: '#fff' },
    levelRow: { flexDirection: 'row', gap: 8 },
    levelChip: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: colors.background },
    levelChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    levelText: { fontSize: 13, fontWeight: '600', color: colors.text },
    levelTextActive: { color: '#fff' },
    warning: { color: colors.danger, fontSize: 13, textAlign: 'center' },
    startButton: { paddingVertical: 15, borderRadius: 12, backgroundColor: colors.buttonBackground, alignItems: 'center', marginTop: 4 },
    startDisabled: { opacity: 0.4 },
    startText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  });
}
