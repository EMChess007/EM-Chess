import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
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
}

function EngineSlot({ title, engine, onPickEngine, color, onChangeColor, otherColor }: EngineSlotProps) {
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
        />
        <EngineSlot
          title="Engine 2"
          engine={engine2}
          onPickEngine={onPickEngine2}
          color={color2}
          onChangeColor={onChangeColor2}
          otherColor={color1}
        />

        <Pressable style={[styles.startButton, !canStart && styles.startButtonDisabled]} onPress={onStart} disabled={!canStart}>
          <Text style={styles.startButtonText}>Start Game</Text>
        </Pressable>
        {!canStart && <Text style={styles.hint}>Choose an engine for both sides to start.</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 16,
  },
  slot: {
    padding: 16,
    backgroundColor: '#f7f2ea',
    borderRadius: 12,
    gap: 10,
  },
  slotTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#3a2618',
  },
  engineButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#3a2618',
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
    color: '#5c4a35',
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
    backgroundColor: '#f0d9b5',
    borderWidth: 1,
    borderColor: '#b58863',
  },
  colorButtonSelected: {
    backgroundColor: '#3a2618',
    borderColor: '#3a2618',
  },
  colorButtonDisabled: {
    opacity: 0.35,
  },
  colorButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3a2618',
  },
  colorButtonTextSelected: {
    color: '#fff',
  },
  startButton: {
    paddingVertical: 16,
    backgroundColor: '#2e6f4f',
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
    color: '#999',
    textAlign: 'center',
  },
});
