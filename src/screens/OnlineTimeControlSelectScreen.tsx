import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import TimeControlSections from '../components/TimeControlSections';
import VariantSelector, { type GameVariant } from '../components/VariantSelector';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import type { FourSeatGame } from '../logic/onlineGames';
import { ONLINE_DAILY_NOTE } from '../logic/timeControls';
import type { TimeControl } from '../types/timeControl';

type OnlineGame = GameVariant | FourSeatGame;

interface OnlineTimeControlSelectScreenProps {
  /** `game` is a 2-player variant or one of the four 4 Player Variations (command #35): App routes the latter to its own queue. */
  onSelect: (timeControl: TimeControl, game: OnlineGame) => void;
  onBack: () => void;
}

// Every control of the shared list is offered (command #35). "No time limit" is live-only play with no clock - both players stay connected, and the server still forfeits a player who
// disconnects for 45 s. A Daily game has no abandonment forfeit (the clock of days decides) but lives in the server's memory: a server update ends it until games are persisted.

export default function OnlineTimeControlSelectScreen({ onSelect, onBack }: OnlineTimeControlSelectScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [variant, setVariant] = useState<OnlineGame>('classic');

  return (
    <View style={styles.container}>
      <ScreenHeader title="Play Online" onBack={onBack} />

      {/* The game chips are INSIDE the scroll view (command #35b): with 13 + 4 chips they took two thirds of a 360 x 640 phone at font scale 1.3 when they sat above it, left a sliver for the
          time controls and a swipe that began on them moved nothing - the page could not be scrolled to "Blitz 5 min". The whole page scrolls now. */}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <VariantSelector<OnlineGame> value={variant} onChange={setVariant} includeFourSeat />
        <TimeControlSections onSelect={(tc) => onSelect(tc, variant)} dailyNote={ONLINE_DAILY_NOTE} />
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
