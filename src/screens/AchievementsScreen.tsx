import { FlatList, StyleSheet, Text, View } from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { ACHIEVEMENTS } from '../logic/achievements';
import { useUnlockedAchievements } from '../logic/achievementStorage';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';

interface AchievementsScreenProps {
  onBack: () => void;
}

export default function AchievementsScreen({ onBack }: AchievementsScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const unlocked = useUnlockedAchievements();

  return (
    <View style={styles.container}>
      <ScreenHeader title="Achievements" onBack={onBack} backLabel="‹ Back" />
      <Text style={styles.subtitle}>
        {unlocked.size} / {ACHIEVEMENTS.length} unlocked
      </Text>
      <FlatList
        style={styles.list}
        data={ACHIEVEMENTS}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const isUnlocked = unlocked.has(item.id);
          return (
            <View style={[styles.card, !isUnlocked && styles.cardLocked]}>
              <Text style={[styles.icon, !isUnlocked && styles.iconLocked]}>{isUnlocked ? item.icon : '🔒'}</Text>
              <View style={styles.textColumn}>
                <Text style={[styles.title, !isUnlocked && styles.titleLocked]}>{item.title}</Text>
                <Text style={styles.description}>{item.description}</Text>
              </View>
            </View>
          );
        }}
      />
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
      color: colors.textMuted,
      paddingHorizontal: 16,
      marginTop: 2,
      marginBottom: 8,
    },
    list: {
      flex: 1,
      paddingHorizontal: 16,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      marginBottom: 10,
    },
    cardLocked: {
      opacity: 0.55,
    },
    icon: {
      fontSize: 30,
    },
    iconLocked: {
      opacity: 0.6,
    },
    textColumn: {
      flex: 1,
      gap: 2,
    },
    title: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    titleLocked: {
      color: colors.textSecondary,
    },
    description: {
      fontSize: 13,
      color: colors.textSecondary,
    },
  });
}
