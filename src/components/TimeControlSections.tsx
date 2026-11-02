import { StyleSheet, View } from 'react-native';
import { Pressable } from './AppPressable';
import { Text } from './AppText';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { TIME_CONTROL_CATEGORIES, getTimeControlsByCategory } from '../logic/timeControls';
import type { TimeControl } from '../types/timeControl';

/**
 * THE ONE TIME-CONTROL PICKER BODY (command #35). Every screen that asks for a time control - the Bots / Local / 4-seat setups (TimeControlSelectScreen), Online Quick Match
 * (OnlineTimeControlSelectScreen), Challenge a Friend, Tournaments - renders THIS component, which renders the ONE list in logic/timeControls.ts (`TIME_CONTROLS`: Bullet 1, 1 | 1, 2 | 1; Blitz
 * 3, 3 | 2, 5, 5 | 5, 5 | 2; Rapid 10, 15 | 10, 30, 10 | 5, 20, 60; Daily 1, 2, 3, 5, 7, 14 days; No time limit). There is no per-mode list, filter or exclusion: a mode that cannot play a control
 * says so in its engine, not by hiding the button (`timeControlsEverywhere.test.ts` scans every screen). `dailyNote` is shown under the Daily heading by the online screens.
 */
interface TimeControlSectionsProps {
  onSelect: (timeControl: TimeControl) => void;
  /** A line under the Daily heading (the online pickers say how a Daily game is kept). */
  dailyNote?: string;
}

export default function TimeControlSections({ onSelect, dailyNote }: TimeControlSectionsProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  return (
    <>
      {TIME_CONTROL_CATEGORIES.map(({ category, label }) => (
        <View key={category} style={styles.section}>
          <Text style={styles.sectionTitle}>{label}</Text>
          {category === 'daily' && dailyNote ? <Text style={styles.note}>{dailyNote}</Text> : null}
          <View style={styles.presetGrid}>
            {getTimeControlsByCategory(category).map((tc) => (
              <Pressable key={tc.id} style={styles.presetButton} onPress={() => onSelect(tc)} accessibilityLabel={`${label} ${tc.label}`}>
                <Text style={styles.presetButtonText}>{tc.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </>
  );
}

function createStyles(colors: AppColors) {
  const isDark = colors.mode === 'dark';
  return StyleSheet.create({
    section: {
      gap: 10,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    note: {
      fontSize: 13,
      color: colors.textMuted,
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
