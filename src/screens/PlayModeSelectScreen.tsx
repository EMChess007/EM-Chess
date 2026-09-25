import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { appAlert } from '../components/AppAlert';
import ScreenHeader from '../components/ScreenHeader';
import type { AuthUser } from '../types/auth';

interface PlayModeSelectScreenProps {
  onBack: () => void;
  onOnline: () => void;
  onBotClassic: () => void;
  onBotChess960: () => void;
  onLocalClassic: () => void;
  onLocalChess960: () => void;
  onEngineVsEngineClassic: () => void;
  onEngineVsEngineChess960: () => void;
  authUser: AuthUser | null;
  onAuthPress: () => void;
}

export default function PlayModeSelectScreen({
  onBack,
  onOnline,
  onBotClassic,
  onBotChess960,
  onLocalClassic,
  onLocalChess960,
  onEngineVsEngineClassic,
  onEngineVsEngineChess960,
  authUser,
  onAuthPress,
}: PlayModeSelectScreenProps) {
  // Same login gate that used to live on the old menu's "Play Online" button — online
  // multiplayer needs a real account (matchmaking/rooms key off the session), unlike every
  // other mode on this screen.
  const handleOnline = () => {
    if (!authUser) {
      appAlert('Login required', 'You need to log in to play online.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log in / Sign up', onPress: onAuthPress },
      ]);
      return;
    }
    onOnline();
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Play" onBack={onBack} backLabel="‹ Menu" />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Pressable style={[styles.categoryCard, styles.onlineCard]} onPress={handleOnline}>
          <Text style={styles.categoryTitle}>Online</Text>
          <Text style={styles.categorySubtitle}>Play live against another player</Text>
        </Pressable>

        <View style={styles.categoryCard}>
          <Text style={styles.categoryTitle}>Bots</Text>
          <Text style={styles.categorySubtitle}>Play against the computer</Text>
          <View style={styles.subButtonRow}>
            <Pressable style={[styles.subButton, styles.botSubButton]} onPress={onBotClassic}>
              <Text style={styles.subButtonText}>Classic</Text>
            </Pressable>
            <Pressable style={[styles.subButton, styles.botSubButton]} onPress={onBotChess960}>
              <Text style={styles.subButtonText}>Chess960</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.categoryCard}>
          <Text style={styles.categoryTitle}>Local</Text>
          <Text style={styles.categorySubtitle}>Two players on the same device</Text>
          <View style={styles.subButtonRow}>
            <Pressable style={[styles.subButton, styles.localSubButton]} onPress={onLocalClassic}>
              <Text style={styles.subButtonText}>Classic</Text>
            </Pressable>
            <Pressable style={[styles.subButton, styles.localSubButton]} onPress={onLocalChess960}>
              <Text style={styles.subButtonText}>Chess960</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.categoryCard}>
          <Text style={styles.categoryTitle}>Engine vs Engine</Text>
          <Text style={styles.categorySubtitle}>Watch two engines play each other automatically</Text>
          <View style={styles.subButtonRow}>
            <Pressable style={[styles.subButton, styles.engineSubButton]} onPress={onEngineVsEngineClassic}>
              <Text style={styles.subButtonText}>Classic</Text>
            </Pressable>
            <Pressable style={[styles.subButton, styles.engineSubButton]} onPress={onEngineVsEngineChess960}>
              <Text style={styles.subButtonText}>Chess960</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 16,
  },
  categoryCard: {
    padding: 20,
    backgroundColor: '#f0d9b5',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#b58863',
    gap: 4,
  },
  onlineCard: {
    backgroundColor: '#dce8f8',
    borderColor: '#1a5fb4',
  },
  categoryTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#3a2618',
  },
  categorySubtitle: {
    fontSize: 13,
    color: '#5c4a35',
    marginBottom: 8,
  },
  subButtonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  subButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  botSubButton: {
    backgroundColor: '#2e6f4f',
  },
  localSubButton: {
    backgroundColor: '#3a2618',
  },
  engineSubButton: {
    backgroundColor: '#8d6e00',
  },
  subButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
