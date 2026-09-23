import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { TIME_CONTROL_CATEGORIES, getTimeControlsByCategory } from '../logic/timeControls';
import type { TimeControl } from '../types/timeControl';

interface TimeControlSelectScreenProps {
  onSelect: (timeControl: TimeControl) => void;
  onBack: () => void;
  subtitle?: string;
}

export default function TimeControlSelectScreen({ onSelect, onBack, subtitle }: TimeControlSelectScreenProps) {
  return (
    <View style={styles.container}>
      <ScreenHeader title={`Select Time Control${subtitle ? ` — ${subtitle}` : ''}`} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {TIME_CONTROL_CATEGORIES.map(({ category, label }) => (
          <View key={category} style={styles.section}>
            <Text style={styles.sectionTitle}>{label}</Text>
            <View style={styles.presetGrid}>
              {getTimeControlsByCategory(category).map((tc) => (
                <Pressable key={tc.id} style={styles.presetButton} onPress={() => onSelect(tc)}>
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
  presetButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#3a2618',
  },
});
