import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { appAlert } from '../components/AppAlert';
import ModeButtonLabel from '../components/ModeButtonLabel';
import ScreenHeader from '../components/ScreenHeader';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import type { AuthUser } from '../types/auth';

interface PlayModeSelectScreenProps {
  onBack: () => void;
  onOnline: () => void;
  onChallengeFriend: () => void;
  onTournaments: () => void;
  onSpectate: () => void;
  onBotClassic: () => void;
  onBotChess960: () => void;
  onBotKingOfTheHill: () => void;
  onBotThreeCheck: () => void;
  onBotSetupChess: () => void;
  onBotFogOfWar: () => void;
  onBotGiveaway: () => void;
  onBotAtomic: () => void;
  onBotDuckChess: () => void;
  onLocalClassic: () => void;
  onLocalChess960: () => void;
  onLocalKingOfTheHill: () => void;
  onLocalThreeCheck: () => void;
  onLocalSetupChess: () => void;
  onLocalFogOfWar: () => void;
  onLocalGiveaway: () => void;
  onLocalAtomic: () => void;
  onLocalDuckChess: () => void;
  onFourPlayer: () => void;
  onEngineVsEngineClassic: () => void;
  onEngineVsEngineChess960: () => void;
  onEngineVsEngineKingOfTheHill: () => void;
  onEngineVsEngineThreeCheck: () => void;
  onBoardEditor: () => void;
  onImportPgn: () => void;
  authUser: AuthUser | null;
  onAuthPress: () => void;
}

export default function PlayModeSelectScreen({
  onBack,
  onOnline,
  onChallengeFriend,
  onTournaments,
  onSpectate,
  onBotClassic,
  onBotChess960,
  onBotKingOfTheHill,
  onBotThreeCheck,
  onBotSetupChess,
  onBotFogOfWar,
  onBotGiveaway,
  onBotAtomic,
  onBotDuckChess,
  onLocalClassic,
  onLocalChess960,
  onLocalKingOfTheHill,
  onLocalThreeCheck,
  onLocalSetupChess,
  onLocalFogOfWar,
  onLocalGiveaway,
  onLocalAtomic,
  onLocalDuckChess,
  onFourPlayer,
  onEngineVsEngineClassic,
  onEngineVsEngineChess960,
  onEngineVsEngineKingOfTheHill,
  onEngineVsEngineThreeCheck,
  onBoardEditor,
  onImportPgn,
  authUser,
  onAuthPress,
}: PlayModeSelectScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  // Same login gate that used to live on the old menu's "Play Online" button — online
  // multiplayer needs a real account (matchmaking/rooms key off the session), unlike every
  // other mode on this screen. Spectating deliberately isn't gated the same way — it's read-only
  // and needs no account of its own.
  const requireLogin = (action: () => void) => () => {
    if (!authUser) {
      appAlert('Login required', 'You need to log in to play online.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log in / Sign up', onPress: onAuthPress },
      ]);
      return;
    }
    action();
  };
  const handleOnline = requireLogin(onOnline);
  const handleChallengeFriend = requireLogin(onChallengeFriend);
  const handleTournaments = requireLogin(onTournaments);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Play" onBack={onBack} backLabel="‹ Menu" />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={[styles.categoryCard, styles.onlineCard]}>
          <Text style={styles.categoryTitle}>Online</Text>
          <Text style={styles.categorySubtitle}>Play live against another player</Text>
          <View style={styles.subButtonRow}>
            <Pressable style={[styles.subButton, styles.onlineSubButton]} onPress={handleOnline}>
              <ModeButtonLabel label="Quick Match" style={styles.subButtonText} />
            </Pressable>
            <Pressable style={[styles.subButton, styles.onlineSubButton]} onPress={handleChallengeFriend}>
              <ModeButtonLabel label="Challenge Friend" style={styles.subButtonText} />
            </Pressable>
            <Pressable style={[styles.subButton, styles.onlineSubButton]} onPress={handleTournaments}>
              <ModeButtonLabel label="Tournaments" style={styles.subButtonText} />
            </Pressable>
          </View>
          <Pressable style={styles.spectateLink} onPress={onSpectate}>
            <Text style={styles.spectateLinkText}>Spectate a live game ›</Text>
          </Pressable>
        </View>

        <View style={styles.categoryCard}>
          <Text style={styles.categoryTitle}>Bots</Text>
          <Text style={styles.categorySubtitle}>Play against the computer</Text>
          <View style={styles.subButtonRow}>
            <Pressable style={[styles.subButton, styles.botSubButton]} onPress={onBotClassic}>
              <ModeButtonLabel label="Classic" style={styles.subButtonText} />
            </Pressable>
            <Pressable style={[styles.subButton, styles.botSubButton]} onPress={onBotChess960}>
              <ModeButtonLabel label="Chess960" style={styles.subButtonText} />
            </Pressable>
            <Pressable style={[styles.subButton, styles.botSubButton]} onPress={onBotKingOfTheHill}>
              <ModeButtonLabel label="King of the Hill" style={styles.subButtonText} />
            </Pressable>
          </View>
          <View style={styles.subButtonRow}>
            <Pressable style={[styles.subButton, styles.botSubButton]} onPress={onBotThreeCheck}>
              <ModeButtonLabel label="Three-Check" style={styles.subButtonText} />
            </Pressable>
            <Pressable style={[styles.subButton, styles.botSubButton]} onPress={onBotSetupChess}>
              <ModeButtonLabel label="Setup Chess" style={styles.subButtonText} />
            </Pressable>
            <Pressable style={[styles.subButton, styles.botSubButton]} onPress={onBotFogOfWar}>
              <ModeButtonLabel label="Fog of War" style={styles.subButtonText} />
            </Pressable>
          </View>
          <View style={styles.subButtonRow}>
            <Pressable style={[styles.subButton, styles.botSubButton]} onPress={onBotGiveaway}>
              <ModeButtonLabel label="Giveaway" style={styles.subButtonText} />
            </Pressable>
            <Pressable style={[styles.subButton, styles.botSubButton]} onPress={onBotAtomic}>
              <ModeButtonLabel label="Atomic" style={styles.subButtonText} />
            </Pressable>
          </View>
          <View style={styles.subButtonRow}>
            <Pressable style={[styles.subButton, styles.botSubButton]} onPress={onBotDuckChess}>
              <ModeButtonLabel label="Duck Chess" style={styles.subButtonText} />
            </Pressable>
          </View>
        </View>

        <View style={styles.categoryCard}>
          <Text style={styles.categoryTitle}>Local</Text>
          <Text style={styles.categorySubtitle}>Two players on the same device</Text>
          <View style={styles.subButtonRow}>
            <Pressable style={[styles.subButton, styles.localSubButton]} onPress={onLocalClassic}>
              <ModeButtonLabel label="Classic" style={styles.subButtonText} />
            </Pressable>
            <Pressable style={[styles.subButton, styles.localSubButton]} onPress={onLocalChess960}>
              <ModeButtonLabel label="Chess960" style={styles.subButtonText} />
            </Pressable>
            <Pressable style={[styles.subButton, styles.localSubButton]} onPress={onLocalKingOfTheHill}>
              <ModeButtonLabel label="King of the Hill" style={styles.subButtonText} />
            </Pressable>
          </View>
          <View style={styles.subButtonRow}>
            <Pressable style={[styles.subButton, styles.localSubButton]} onPress={onLocalThreeCheck}>
              <ModeButtonLabel label="Three-Check" style={styles.subButtonText} />
            </Pressable>
            <Pressable style={[styles.subButton, styles.localSubButton]} onPress={onLocalSetupChess}>
              <ModeButtonLabel label="Setup Chess" style={styles.subButtonText} />
            </Pressable>
            <Pressable style={[styles.subButton, styles.localSubButton]} onPress={onLocalFogOfWar}>
              <ModeButtonLabel label="Fog of War" style={styles.subButtonText} />
            </Pressable>
          </View>
          <View style={styles.subButtonRow}>
            <Pressable style={[styles.subButton, styles.localSubButton]} onPress={onLocalGiveaway}>
              <ModeButtonLabel label="Giveaway" style={styles.subButtonText} />
            </Pressable>
            <Pressable style={[styles.subButton, styles.localSubButton]} onPress={onLocalAtomic}>
              <ModeButtonLabel label="Atomic" style={styles.subButtonText} />
            </Pressable>
          </View>
          <View style={styles.subButtonRow}>
            <Pressable style={[styles.subButton, styles.localSubButton]} onPress={onLocalDuckChess}>
              <ModeButtonLabel label="Duck Chess" style={styles.subButtonText} />
            </Pressable>
          </View>
        </View>

        <View style={styles.categoryCard}>
          <Text style={styles.categoryTitle}>4 Player Chess</Text>
          <Text style={styles.categorySubtitle}>Four players on a cross-shaped board — pass the device or play against bots</Text>
          <View style={styles.subButtonRow}>
            <Pressable style={[styles.subButton, styles.fourPlayerSubButton]} onPress={onFourPlayer}>
              <ModeButtonLabel label="Free-for-All" style={styles.subButtonText} />
            </Pressable>
          </View>
        </View>

        <View style={styles.categoryCard}>
          <Text style={styles.categoryTitle}>Engine vs Engine</Text>
          <Text style={styles.categorySubtitle}>Watch two engines play each other automatically</Text>
          <View style={styles.subButtonRow}>
            <Pressable style={[styles.subButton, styles.engineSubButton]} onPress={onEngineVsEngineClassic}>
              <ModeButtonLabel label="Classic" style={styles.subButtonText} />
            </Pressable>
            <Pressable style={[styles.subButton, styles.engineSubButton]} onPress={onEngineVsEngineChess960}>
              <ModeButtonLabel label="Chess960" style={styles.subButtonText} />
            </Pressable>
            <Pressable style={[styles.subButton, styles.engineSubButton]} onPress={onEngineVsEngineKingOfTheHill}>
              <ModeButtonLabel label="King of the Hill" style={styles.subButtonText} />
            </Pressable>
            <Pressable style={[styles.subButton, styles.engineSubButton]} onPress={onEngineVsEngineThreeCheck}>
              <ModeButtonLabel label="Three-Check" style={styles.subButtonText} />
            </Pressable>
          </View>
        </View>

        <View style={styles.categoryCard}>
          <Text style={styles.categoryTitle}>Board Editor</Text>
          <Text style={styles.categorySubtitle}>Set up a custom position and analyze it</Text>
          <View style={styles.subButtonRow}>
            <Pressable style={[styles.subButton, styles.editorSubButton]} onPress={onBoardEditor}>
              <ModeButtonLabel label="Open Editor" style={styles.subButtonText} />
            </Pressable>
            <Pressable style={[styles.subButton, styles.editorSubButton]} onPress={onImportPgn}>
              <ModeButtonLabel label="Import PGN" style={styles.subButtonText} />
            </Pressable>
          </View>
        </View>
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
      gap: 16,
    },
    categoryCard: {
      padding: 20,
      backgroundColor: isDark ? '#3a3120' : '#f0d9b5',
      borderRadius: 14,
      borderWidth: 1,
      borderColor: isDark ? '#6b5a3a' : '#b58863',
      gap: 4,
    },
    onlineCard: {
      backgroundColor: isDark ? '#1c2b3d' : '#dce8f8',
      borderColor: isDark ? '#3a6ea5' : '#1a5fb4',
    },
    categoryTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.text,
    },
    categorySubtitle: {
      fontSize: 13,
      color: colors.textSecondary,
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
      justifyContent: 'center',
    },
    onlineSubButton: {
      backgroundColor: isDark ? '#3a6ea5' : '#1a5fb4',
    },
    spectateLink: {
      marginTop: 10,
      alignSelf: 'center',
    },
    spectateLinkText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
      textDecorationLine: 'underline',
    },
    botSubButton: {
      backgroundColor: colors.accent,
    },
    localSubButton: {
      backgroundColor: colors.buttonBackground,
    },
    fourPlayerSubButton: {
      backgroundColor: '#8e24aa',
    },
    engineSubButton: {
      backgroundColor: '#8d6e00',
    },
    editorSubButton: {
      backgroundColor: colors.accent,
    },
    subButtonText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '600',
      textAlign: 'center',
    },
  });
}
