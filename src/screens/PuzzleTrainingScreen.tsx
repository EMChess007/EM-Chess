import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { loadSelectedPuzzleThemes, saveSelectedPuzzleThemes, PUZZLE_THEME_OPTIONS } from '../logic/puzzleThemes';

interface PuzzleTrainingScreenProps {
  onBack: () => void;
  onStart: (themes: string[]) => void;
}

/**
 * Theme picker for Puzzle Training — a filtered variant of Puzzle Rush (see PuzzleRushScreen's
 * `themeFilter` prop) that only serves puzzles tagged with at least one of the selected themes.
 * The Daily Puzzle stays fixed/unfiltered, per its own design; this is a separate entry point.
 */
export default function PuzzleTrainingScreen({ onBack, onStart }: PuzzleTrainingScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    loadSelectedPuzzleThemes().then(setSelected);
  }, []);

  const toggleTheme = (id: string) => {
    setSelected((prev) => {
      const next = prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id];
      saveSelectedPuzzleThemes(next);
      return next;
    });
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Puzzle Training" onBack={onBack} backLabel="‹ Back" />
      <Text style={styles.subtitle}>Pick one or more themes to practice — puzzles will only be drawn from those.</Text>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.themeGrid}>
          {PUZZLE_THEME_OPTIONS.map((option) => {
            const isSelected = selected.includes(option.id);
            return (
              <Pressable
                key={option.id}
                style={[styles.themeChip, isSelected && styles.themeChipActive]}
                onPress={() => toggleTheme(option.id)}
              >
                <Text style={[styles.themeChipText, isSelected && styles.themeChipTextActive]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {selected.length === 0 && <Text style={styles.hint}>Select at least one theme to start.</Text>}
        <Pressable
          style={[styles.startButton, selected.length === 0 && styles.startButtonDisabled]}
          disabled={selected.length === 0}
          onPress={() => onStart(selected)}
        >
          <Text style={styles.startButtonText}>Start Training</Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      paddingHorizontal: 16,
      marginTop: 2,
      marginBottom: 4,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingBottom: 16,
    },
    themeGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    themeChip: {
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 20,
      backgroundColor: colors.surface,
    },
    themeChipActive: {
      backgroundColor: colors.accent,
    },
    themeChipText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
    },
    themeChipTextActive: {
      color: '#fff',
    },
    footer: {
      paddingHorizontal: 16,
      paddingBottom: 24,
      paddingTop: 8,
      gap: 8,
      alignItems: 'center',
    },
    hint: {
      fontSize: 12,
      color: colors.textMuted,
    },
    startButton: {
      width: '100%',
      paddingVertical: 14,
      borderRadius: 10,
      alignItems: 'center',
      backgroundColor: colors.accent,
    },
    startButtonDisabled: {
      opacity: 0.4,
    },
    startButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
    },
  });
}
