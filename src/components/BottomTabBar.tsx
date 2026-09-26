import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';

export type MainTab = 'home' | 'puzzles' | 'analysis' | 'more';

interface BottomTabBarProps {
  activeTab: MainTab;
  onTabPress: (tab: MainTab) => void;
}

const TABS: { id: MainTab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '♟' },
  { id: 'puzzles', label: 'Puzzles', icon: '🧩' },
  { id: 'analysis', label: 'Analysis', icon: '📊' },
  { id: 'more', label: 'More', icon: '⋯' },
];

export default function BottomTabBar({ activeTab, onTabPress }: BottomTabBarProps) {
  // The bottom safe-area inset is 0 on some devices (older Android with on-screen nav buttons,
  // most non-notched setups) and non-zero on others (iOS home indicator, Android gesture nav) —
  // taking the max with a fixed baseline keeps consistent breathing room either way, while still
  // clearing the system gesture area on devices that need it. RN's own <SafeAreaView> doesn't
  // reliably do this on Android, which is why this reads the inset directly instead.
  const insets = useSafeAreaInsets();
  const colors = useAppColors();
  const styles = createStyles(colors);

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <Pressable key={tab.id} style={styles.tab} onPress={() => onTabPress(tab.id)}>
            <Text style={[styles.icon, isActive && styles.iconActive]}>{tab.icon}</Text>
            <Text style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
      gap: 2,
    },
    icon: {
      fontSize: 20,
      opacity: 0.5,
    },
    iconActive: {
      opacity: 1,
    },
    label: {
      fontSize: 11,
      color: colors.textMuted,
      fontWeight: '500',
    },
    labelActive: {
      color: colors.text,
      fontWeight: '700',
    },
  });
}
