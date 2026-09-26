import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { getTimeControlsByCategory } from '../logic/timeControls';
import type { TimeControl, TimeControlCategory } from '../types/timeControl';

interface OnlineTimeControlSelectScreenProps {
  onSelect: (timeControl: TimeControl, chess960: boolean) => void;
  onBack: () => void;
}

// Daily/unlimited controls don't fit a live "find an opponent now" match — those exist for
// correspondence-style play, which is a different UX (no matchmaking queue) than this screen.
const ONLINE_CATEGORIES: { category: TimeControlCategory; label: string }[] = [
  { category: 'bullet', label: 'Bullet' },
  { category: 'blitz', label: 'Blitz' },
  { category: 'rapid', label: 'Rapid' },
];

export default function OnlineTimeControlSelectScreen({ onSelect, onBack }: OnlineTimeControlSelectScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [chess960, setChess960] = useState(false);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Play Online" onBack={onBack} />

      <Pressable style={styles.chess960Row} onPress={() => setChess960((v) => !v)}>
        <View style={[styles.checkbox, chess960 && styles.checkboxChecked]}>
          {chess960 && <Text style={styles.checkboxMark}>✓</Text>}
        </View>
        <Text style={styles.chess960Label}>Chess960 (Fischer Random)</Text>
      </Pressable>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {ONLINE_CATEGORIES.map(({ category, label }) => (
          <View key={category} style={styles.section}>
            <Text style={styles.sectionTitle}>{label}</Text>
            <View style={styles.presetGrid}>
              {getTimeControlsByCategory(category).map((tc) => (
                <Pressable key={tc.id} style={styles.presetButton} onPress={() => onSelect(tc, chess960)}>
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

function createStyles(colors: AppColors) {
  const isDark = colors.mode === 'dark';
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    chess960Row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 4,
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 5,
      borderWidth: 2,
      borderColor: isDark ? '#6b5a3a' : '#b58863',
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxChecked: {
      backgroundColor: colors.buttonBackground,
      borderColor: colors.buttonBackground,
    },
    checkboxMark: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '700',
    },
    chess960Label: {
      fontSize: 15,
      color: colors.text,
      fontWeight: '600',
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
      color: colors.text,
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
      backgroundColor: isDark ? '#3a3120' : '#f0d9b5',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: isDark ? '#6b5a3a' : '#b58863',
      alignItems: 'center',
    },
    presetButtonText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
  });
}
