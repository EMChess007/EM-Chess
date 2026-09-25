import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { TIME_CONTROL_CATEGORIES, getTimeControlsByCategory } from '../logic/timeControls';
import type { ColorChoice } from '../types/chess';
import type { TimeControl } from '../types/timeControl';

const COLOR_OPTIONS: { value: ColorChoice; label: string }[] = [
  { value: 'b', label: 'Black' },
  { value: 'w', label: 'White' },
  { value: 'random', label: 'Random' },
];

interface TimeControlSelectScreenProps {
  onSelect: (timeControl: TimeControl, colorChoice?: ColorChoice) => void;
  onBack: () => void;
  subtitle?: string;
  // Only bot games let the player pick a color — local games share one device (picking a side
  // makes no sense) and online games must stay always-random with zero player input.
  showColorPicker?: boolean;
}

export default function TimeControlSelectScreen({
  onSelect,
  onBack,
  subtitle,
  showColorPicker = false,
}: TimeControlSelectScreenProps) {
  const [colorChoice, setColorChoice] = useState<ColorChoice>('random');

  return (
    <View style={styles.container}>
      <ScreenHeader title={`Select Time Control${subtitle ? ` — ${subtitle}` : ''}`} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {showColorPicker && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Play as</Text>
            <View style={styles.presetGrid}>
              {COLOR_OPTIONS.map((option) => (
                <Pressable
                  key={option.value}
                  style={[styles.presetButton, colorChoice === option.value && styles.presetButtonActive]}
                  onPress={() => setColorChoice(option.value)}
                >
                  <Text style={[styles.presetButtonText, colorChoice === option.value && styles.presetButtonTextActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
        {TIME_CONTROL_CATEGORIES.map(({ category, label }) => (
          <View key={category} style={styles.section}>
            <Text style={styles.sectionTitle}>{label}</Text>
            <View style={styles.presetGrid}>
              {getTimeControlsByCategory(category).map((tc) => (
                <Pressable
                  key={tc.id}
                  style={styles.presetButton}
                  onPress={() => onSelect(tc, showColorPicker ? colorChoice : undefined)}
                >
                  <Text style={styles.presetButtonText}>{tc.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
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
    gap: 20,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#3a2618',
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  presetButton: {
    minWidth: 88,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#f0d9b5',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#b58863',
    alignItems: 'center',
  },
  presetButtonActive: {
    backgroundColor: '#3a2618',
    borderColor: '#3a2618',
  },
  presetButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#3a2618',
  },
  presetButtonTextActive: {
    color: '#fff',
  },
});
