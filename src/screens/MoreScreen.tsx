import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AuthUser } from '../types/auth';

interface MoreScreenProps {
  authUser: AuthUser | null;
  onAuthPress: () => void;
  onLogout: () => void;
}

export default function MoreScreen({ authUser, onAuthPress, onLogout }: MoreScreenProps) {
  // react-native's own <SafeAreaView> only actually applies an inset on iOS — see ScreenHeader
  // for the shared version of this fix used by every sub-screen; this tab-root screen has a
  // different (bigger, no-back-button) title style so it applies the same insets.top read directly
  // instead of going through that component.
  const insets = useSafeAreaInsets();

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#3a2618',
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#8a7a63',
    textTransform: 'uppercase',
  },
  accountBox: {
    backgroundColor: '#f7f2ea',
    borderRadius: 10,
    padding: 16,
    gap: 10,
  },
  accountText: {
    fontSize: 15,
    color: '#3a2618',
    fontWeight: '600',
  },
  rowButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#3a2618',
    borderRadius: 8,
    alignItems: 'center',
  },
  rowButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
