import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import type { BotPersonality } from '../types/bot';
import type { ColorChoice } from '../types/chess';

interface EngineVsEngineSetupScreenProps {
  engine1: BotPersonality | null;
  engine2: BotPersonality | null;
  color1: ColorChoice;
  color2: ColorChoice;
  onPickEngine1: () => void;
  onPickEngine2: () => void;
  onChangeColor1: (color: ColorChoice) => void;
  onChangeColor2: (color: ColorChoice) => void;
  onStart: () => void;
  onBack: () => void;
}

const COLOR_OPTIONS: { value: ColorChoice; label: string }[] = [
  { value: 'b', label: 'Black' },
  { value: 'w', label: 'White' },
  { value: 'random', label: 'Random' },
];

// Only one explicit color can be "taken" at a time between the two engines — the other engine's
// picker hides whichever explicit color is currently chosen elsewhere, since there are only two
// colors for two engines. 'random' never excludes anything, on either side.
function availableColors(otherChoice: ColorChoice): ColorChoice[] {
  if (otherChoice === 'random') return ['b', 'w', 'random'];
  return (['b', 'w', 'random'] as ColorChoice[]).filter((c) => c !== otherChoice);
}

interface EngineSlotProps {
  title: string;
  engine: BotPersonality | null;
  onPickEngine: () => void;
  color: ColorChoice;
  onChangeColor: (color: ColorChoice) => void;
  otherColor: ColorChoice;
  styles: ReturnType<typeof createStyles>;
}

function EngineSlot({ title, engine, onPickEngine, color, onChangeColor, otherColor, styles }: EngineSlotProps) {
  const options = availableColors(otherColor);
  return (
    <View style={styles.slot}>
      <Text style={styles.slotTitle}>{title}</Text>
      <Pressable style={styles.engineButton} onPress={onPickEngine}>
        <Text style={styles.engineButtonText}>{engine ? engine.name : 'Choose engine'}</Text>
        {engine && <Text style={styles.engineButtonSubtext}>ELO {engine.elo}</Text>}
      </Pressable>
      <Text style={styles.colorLabel}>Plays as</Text>
      <View style={styles.colorRow}>
        {COLOR_OPTIONS.map((option) => {
          const disabled = !options.includes(option.value);
          const selected = color === option.value;
          return (
            <Pressable
              key={option.value}
              style={[styles.colorButton, selected && styles.colorButtonSelected, disabled && styles.colorButtonDisabled]}
              onPress={() => !disabled && onChangeColor(option.value)}
              disabled={disabled}
            >
              <Text style={[styles.colorButtonText, selected && styles.colorButtonTextSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function EngineVsEngineSetupScreen({
  engine1,
  engine2,
  color1,
  color2,
  onPickEngine1,
  onPickEngine2,
  onChangeColor1,
  onChangeColor2,
  onStart,
  onBack,
}: EngineVsEngineSetupScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const canStart = !!engine1 && !!engine2;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Engine vs Engine" onBack={onBack} backLabel="‹ Menu" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <EngineSlot
          title="Engine 1"
          engine={engine1}
          onPickEngine={onPickEngine1}
          color={color1}
          onChangeColor={onChangeColor1}
          otherColor={color2}
          styles={styles}
        />
        <EngineSlot
          title="Engine 2"
          engine={engine2}
          onPickEngine={onPickEngine2}
          color={color2}
          onChangeColor={onChangeColor2}
          otherColor={color1}
          styles={styles}
        />

        <Pressable style={[styles.startButton, !canStart && styles.startButtonDisabled]} onPress={onStart} disabled={!canStart}>
          <Text style={styles.startButtonText}>Start Game</Text>
        </Pressable>
        {!canStart && <Text style={styles.hint}>Choose an engine for both sides to start.</Text>}
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
      padding: 16,
      paddingBottom: 32,
      gap: 16,
    },
    slot: {
      padding: 16,
      backgroundColor: colors.surface,
      borderRadius: 12,
      gap: 10,
    },
    slotTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    engineButton: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      backgroundColor: colors.buttonBackground,
      borderRadius: 8,
      alignItems: 'center',
    },
    engineButtonText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '600',
    },
    engineButtonSubtext: {
      color: '#e0d5c5',
      fontSize: 12,
      marginTop: 2,
    },
    colorLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    colorRow: {
      flexDirection: 'row',
      gap: 8,
    },
    colorButton: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      alignItems: 'center',
      backgroundColor: colors.mode === 'dark' ? '#3a3120' : '#f0d9b5',
      borderWidth: 1,
      borderColor: colors.mode === 'dark' ? '#6b5a3a' : '#b58863',
    },
    colorButtonSelected: {
      backgroundColor: colors.buttonBackground,
      borderColor: colors.buttonBackground,
    },
    colorButtonDisabled: {
      opacity: 0.35,
    },
    colorButtonText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
    },
    colorButtonTextSelected: {
      color: '#fff',
    },
    startButton: {
      paddingVertical: 16,
      backgroundColor: colors.accent,
      borderRadius: 10,
      alignItems: 'center',
    },
    startButtonDisabled: {
      opacity: 0.5,
    },
    startButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
    },
    hint: {
      fontSize: 12,
      color: colors.textMuted,
      textAlign: 'center',
    },
  });
}
