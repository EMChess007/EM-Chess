import { Pressable, StyleSheet, Text, View } from 'react-native';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';

export type GameVariant = 'classic' | 'chess960' | 'kingOfTheHill' | 'threeCheck' | 'setupChess' | 'fogOfWar';

interface VariantSelectorProps {
  value: GameVariant;
  onChange: (variant: GameVariant) => void;
  /** Hides specific variants from the row — e.g. Tournaments excludes 'setupChess' for now (see
   * its own screen for why), since blind-setup-per-match doesn't have a settled design yet. */
  excludeVariants?: GameVariant[];
}

// A label may embed a literal "\n" at its preferred break point (Text renders it as a forced
// line break) — these chips auto-width to their content rather than sharing equal width, so
// automatic word-wrap can't be trusted to land in a good spot once a label gets long. Without a
// "\n", a label just wraps naturally (fine for anything short enough to not need one). Add a
// break point the same way for any future variant with a long name.
const OPTIONS: { value: GameVariant; label: string }[] = [
  { value: 'classic', label: 'Classic' },
  { value: 'chess960', label: 'Chess960' },
  { value: 'kingOfTheHill', label: 'King of the\nHill' },
  { value: 'threeCheck', label: 'Three-\nCheck' },
  { value: 'setupChess', label: 'Setup\nChess' },
  { value: 'fogOfWar', label: 'Fog of\nWar' },
];

/** Mutually-exclusive Classic / Chess960 / King of the Hill / Three-Check / Setup Chess picker —
 * shared by every online setup screen that used to be a plain Chess960 checkbox
 * (OnlineTimeControlSelectScreen, ChallengeScreen, TournamentScreen), since a game is exactly one
 * of these, never a combination. */
export default function VariantSelector({ value, onChange, excludeVariants }: VariantSelectorProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const options = excludeVariants ? OPTIONS.filter((o) => !excludeVariants.includes(o.value)) : OPTIONS;
  return (
    <View style={styles.row}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <Pressable key={option.value} style={[styles.chip, selected && styles.chipSelected]} onPress={() => onChange(option.value)}>
            <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={2}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(colors: AppColors) {
  const isDark = colors.mode === 'dark';
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    chip: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 20,
      backgroundColor: isDark ? '#3a3120' : '#f0d9b5',
      borderWidth: 1,
      borderColor: isDark ? '#6b5a3a' : '#b58863',
      // Chips on the same wrapped line stretch to match the tallest one (default alignItems:
      // 'stretch' on `row`) — without these, a shorter single-line chip's text sits at the top of
      // that taller shared height instead of centering in it, same bug as PlayModeSelectScreen's
      // subButton.
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipSelected: {
      backgroundColor: colors.buttonBackground,
      borderColor: colors.buttonBackground,
    },
    chipText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
      textAlign: 'center',
    },
    chipTextSelected: {
      color: '#fff',
    },
  });
}
