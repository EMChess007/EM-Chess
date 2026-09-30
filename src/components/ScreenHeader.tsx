import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';

interface ScreenHeaderProps {
  title: string;
  /** A short line shown below the title, on its own row, in a smaller/muted style — for anything
   * that shouldn't have to share width with the title and back button (most commonly the active
   * game variant, e.g. "King of the Hill"). Keeping this separate means `title` itself can stay a
   * short, fixed, single line regardless of how long a variant name gets. */
  subtitle?: string;
  /** Omit for a tab-root screen with no "back" affordance (Home/Puzzles/Analysis/More). */
  onBack?: () => void;
  /** Text for the back link — screens use either "‹ Menu" (returns to the tab hub) or "‹ Back"
   * (returns to the immediate parent screen), so this is passed explicitly rather than guessed. */
  backLabel?: string;
}

/**
 * The standard top-of-screen bar (optional back link + title) used by every non-tab-root
 * screen in the app. Centralizes the top safe-area handling that used to be attempted via
 * react-native's own <SafeAreaView> — which only actually applies an inset on iOS and is a
 * no-op on Android, which is why titles kept ending up underneath the status bar there.
 * Reading the inset directly here means every screen that renders a <ScreenHeader> gets this
 * fixed automatically, without needing to remember to handle it itself.
 *
 * Caller contract: the screen's own root must be a plain <View> (not <SafeAreaView>), with
 * this component as its first child — nothing above it should also be adding top padding.
 */
export default function ScreenHeader({ title, subtitle, onBack, backLabel = '‹ Back' }: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const colors = useAppColors();
  const styles = createStyles(colors);

  return (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      {onBack && (
        <Pressable style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>{backLabel}</Text>
        </Pressable>
      )}
      <View style={styles.titleBlock}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle && (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingBottom: 4,
      gap: 12,
    },
    backButton: {
      paddingVertical: 6,
      paddingHorizontal: 4,
    },
    backButtonText: {
      fontSize: 16,
      color: colors.text,
    },
    titleBlock: {
      flex: 1,
    },
    title: {
      fontSize: 22,
      fontWeight: 'bold',
      color: colors.text,
    },
    subtitle: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
      marginTop: 2,
    },
  });
}
