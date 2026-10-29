import { useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Pressable } from '../components/AppPressable';
import { Text } from '../components/AppText';
import BughouseRulesSheet from '../components/BughouseRulesSheet';
import ScreenHeader from '../components/ScreenHeader';
import { BUGHOUSE_SETUP_PRESETS, bughouseSetupGate, keepTogether, presetOfConfig, presetSeatConfig, seatRowLabel } from '../logic/bughouseLayout';
import type { BughouseSeat } from '../logic/bughouse/types';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { DEFAULT_BOT_ELO, withController, type SeatConfig } from '../logic/fourPlayer/setup';
import { botDisplayName } from '../logic/fourPlayerBots';

interface BughouseSetupScreenProps {
  seats: SeatConfig;
  onChange: (seats: SeatConfig) => void;
  /** Opens the app's regular "Select a Bot" roster for this seat; App stores the pick and returns here. */
  onPickBot: (seat: BughouseSeat) => void;
  onContinue: () => void;
  onBack: () => void;
}

/**
 * Local setup (B23): the 4-seat pattern - each of the four seats is Human or a bot from the named roster - with the seat map spelled out ("Board A · White · Team 1") and four one-tap
 * presets. Any combination is allowed; what the screen can play follows from where the humans sit (bughouseLayout.ts). Start is disabled, with the reason, when the setup cannot be
 * played in the CURRENT window (rotating the phone updates it at once).
 */
export default function BughouseSetupScreen({ seats, onChange, onPickBot, onContinue, onBack }: BughouseSetupScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const { width, height } = useWindowDimensions();
  const gate = bughouseSetupGate(seats, width, height);
  const activePreset = presetOfConfig(seats);
  const [rulesOpen, setRulesOpen] = useState(false);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Bughouse" subtitle="Local" onBack={onBack} backLabel="‹ Back" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>Two teams of two, two boards. A piece you capture goes to your partner&apos;s pocket - they can drop it instead of moving. No draws.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="How to play Bughouse" testID="how-to-play" style={styles.rulesButton} onPress={() => setRulesOpen(true)}>
          <Text style={styles.rulesButtonText}>How to play ›</Text>
        </Pressable>

        <View style={styles.presets} testID="presets">
          {BUGHOUSE_SETUP_PRESETS.map((preset) => (
            <Pressable
              key={preset.id}
              accessibilityRole="button"
              accessibilityLabel={`Preset: ${preset.label}`}
              testID={`preset-${preset.id}`}
              style={[styles.preset, activePreset === preset.id && styles.presetActive]}
              onPress={() => onChange(presetSeatConfig(preset.id, DEFAULT_BOT_ELO))}
            >
              <Text style={[styles.presetText, activePreset === preset.id && styles.presetTextActive]}>{preset.label}</Text>
            </Pressable>
          ))}
        </View>

        {([0, 1, 2, 3] as BughouseSeat[]).map((seat) => {
          const controller = seats[seat];
          const row = seatRowLabel(seat);
          return (
            <View key={seat} style={styles.seatCard} testID={`seat-row-${seat}`}>
              <View style={styles.seatHeader}>
                <Text style={[styles.shape, { color: row.team === 1 ? '#1e88e5' : '#f9a825' }]}>{row.shape}</Text>
                <Text style={styles.seatName}>{keepTogether(row.text)}</Text>
                <View style={styles.toggle}>
                  <Pressable
                    accessibilityLabel={`${row.text}: human`}
                    style={[styles.toggleOption, controller.kind === 'human' && styles.toggleActive]}
                    onPress={() => onChange(withController(seats, seat, { kind: 'human' }))}
                  >
                    <Text style={[styles.toggleText, controller.kind === 'human' && styles.toggleTextActive]}>Human</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`${row.text}: bot`}
                    style={[styles.toggleOption, controller.kind === 'bot' && styles.toggleActive]}
                    onPress={() => onChange(withController(seats, seat, controller.kind === 'bot' ? controller : { kind: 'bot', elo: DEFAULT_BOT_ELO }))}
                  >
                    <Text style={[styles.toggleText, controller.kind === 'bot' && styles.toggleTextActive]}>Bot</Text>
                  </Pressable>
                </View>
              </View>
              {controller.kind === 'bot' && (
                <Pressable accessibilityLabel={`${row.text} bot: ${botDisplayName(controller.elo)}, change`} style={styles.botRow} onPress={() => onPickBot(seat)}>
                  <Text style={styles.botName}>{botDisplayName(controller.elo)}</Text>
                  <Text style={styles.botElo}>ELO {controller.elo}</Text>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              )}
            </View>
          );
        })}

        {!gate.startable && (
          <Text style={styles.warning} testID="setup-gate-message">
            {gate.message}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !gate.startable }}
          testID="bughouse-start"
          style={[styles.startButton, !gate.startable && styles.startDisabled]}
          disabled={!gate.startable}
          onPress={onContinue}
        >
          <Text style={styles.startText}>Choose time control</Text>
        </Pressable>
      </ScrollView>
      <BughouseRulesSheet visible={rulesOpen} onClose={() => setRulesOpen(false)} />
    </View>
  );
}

function createStyles(colors: AppColors) {
  const isDark = colors.mode === 'dark';
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 12 },
    intro: { fontSize: 13, color: colors.textSecondary },
    rulesButton: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    rulesButtonText: { fontSize: 14, fontWeight: '700', color: colors.text },
    presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    preset: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    presetActive: { backgroundColor: colors.buttonBackground },
    presetText: { fontSize: 14, fontWeight: '600', color: colors.text },
    presetTextActive: { color: '#fff' },
    seatCard: { padding: 12, gap: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    seatHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    shape: { fontSize: 18, fontWeight: '800' },
    seatName: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
    toggle: { flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
    toggleOption: { paddingVertical: 8, paddingHorizontal: 12, backgroundColor: colors.background },
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
