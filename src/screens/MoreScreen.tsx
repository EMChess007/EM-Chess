import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { getColorSchemeMode, setColorSchemeMode, subscribeColorSchemeMode } from '../logic/colorSchemeSettings';
import { isSoundEnabled, setSoundEnabled, subscribeSoundEnabled } from '../logic/soundSettings';
import type { AuthUser } from '../types/auth';

interface MoreScreenProps {
  authUser: AuthUser | null;
  onAuthPress: () => void;
  onLogout: () => void;
  onOpenEngines: () => void;
  onOpenThemes: () => void;
}

export default function MoreScreen({ authUser, onAuthPress, onLogout, onOpenEngines, onOpenThemes }: MoreScreenProps) {
  // react-native's own <SafeAreaView> only actually applies an inset on iOS — see ScreenHeader
  // for the shared version of this fix used by every sub-screen; this tab-root screen has a
  // different (bigger, no-back-button) title style so it applies the same insets.top read directly
  // instead of going through that component.
  const insets = useSafeAreaInsets();
  const colors = useAppColors();
  const styles = createStyles(colors);

  // Mirrors the module-level soundSettings cache (see soundSettings.ts) so this toggle reflects
  // the current value even if it was restored from storage after this screen already mounted.
  const [soundOn, setSoundOn] = useState(isSoundEnabled);
  useEffect(() => subscribeSoundEnabled(setSoundOn), []);

  // Same reactive-cache pattern as sound, for the app-wide Dark/Light mode (colorSchemeSettings.ts).
  const [darkMode, setDarkMode] = useState(() => getColorSchemeMode() === 'dark');
  useEffect(() => subscribeColorSchemeMode((mode) => setDarkMode(mode === 'dark')), []);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 20 }]}>
      <Text style={styles.title}>More</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        {authUser ? (
          <View style={styles.accountBox}>
            <Text style={styles.accountText}>Signed in as {authUser.username}</Text>
            <Pressable style={styles.rowButton} onPress={onLogout}>
              <Text style={styles.rowButtonText}>Log out</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.rowButton} onPress={onAuthPress}>
            <Text style={styles.rowButtonText}>Log in / Sign up</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Dark mode</Text>
          <Switch value={darkMode} onValueChange={(value) => setColorSchemeMode(value ? 'dark' : 'light')} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Engines</Text>
        <Pressable style={styles.rowButton} onPress={onOpenEngines}>
          <Text style={styles.rowButtonText}>Manage Custom Engines</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Board & Piece Themes</Text>
        <Pressable style={styles.rowButton} onPress={onOpenThemes}>
          <Text style={styles.rowButtonText}>Manage Board & Piece Themes</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Sound</Text>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Move sounds</Text>
          <Switch value={soundOn} onValueChange={(value) => setSoundEnabled(value)} />
        </View>
      </View>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      paddingHorizontal: 20,
      paddingTop: 20,
      gap: 20,
    },
    title: {
      fontSize: 28,
      fontWeight: 'bold',
      color: colors.text,
    },
    section: {
      gap: 10,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
    },
    accountBox: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      padding: 16,
      gap: 10,
    },
    accountText: {
      fontSize: 15,
      color: colors.text,
      fontWeight: '600',
    },
    rowButton: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      backgroundColor: colors.buttonBackground,
      borderRadius: 8,
      alignItems: 'center',
    },
    rowButtonText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '600',
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 16,
    },
    switchLabel: {
      fontSize: 15,
      color: colors.text,
      fontWeight: '600',
    },
  });
}
