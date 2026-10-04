import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import VariantSelector, { type GameVariant } from '../components/VariantSelector';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { getTimeControlsByCategory } from '../logic/timeControls';
import type { TimeControl, TimeControlCategory } from '../types/timeControl';

interface OnlineTimeControlSelectScreenProps {
  onSelect: (timeControl: TimeControl, variant: GameVariant) => void;
  onBack: () => void;
}

// "No time limit" is live-only play with no clock — both players stay connected, and the server still
// forfeits a player who disconnects for 45 s. Daily is NOT offered: it needs correspondence-style play
// (persisted games, no abandonment, notifications) which the live matchmaking queue cannot provide.
const ONLINE_CATEGORIES: { category: TimeControlCategory; label: string }[] = [
  { category: 'bullet', label: 'Bullet' },
  { category: 'blitz', label: 'Blitz' },
  { category: 'rapid', label: 'Rapid' },
  { category: 'unlimited', label: 'No time limit' },
];

export default function OnlineTimeControlSelectScreen({ onSelect, onBack }: OnlineTimeControlSelectScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [variant, setVariant] = useState<GameVariant>('classic');

  return (
    <View style={styles.container}>
      <ScreenHeader title="Play Online" onBack={onBack} />

      <View style={styles.variantRow}>
        <VariantSelector value={variant} onChange={setVariant} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {ONLINE_CATEGORIES.map(({ category, label }) => (
          <View key={category} style={styles.section}>
            <Text style={styles.sectionTitle}>{label}</Text>
            <View style={styles.presetGrid}>
              {getTimeControlsByCategory(category).map((tc) => (
                <Pressable
                  key={tc.id}
                  style={styles.presetButton}
                  onPress={() => onSelect(tc, variant)}
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

function createStyles(colors: AppColors) {
  const isDark = colors.mode === 'dark';
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    variantRow: {
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 4,
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
