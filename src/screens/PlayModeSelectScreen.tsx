import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { appAlert } from '../components/AppAlert';
import BughouseRulesSheet from '../components/BughouseRulesSheet';
import ChaturajiRulesSheet from '../components/ChaturajiRulesSheet';
import ModeButtonLabel from '../components/ModeButtonLabel';
import ScreenHeader from '../components/ScreenHeader';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import type { FourVariant } from '../logic/fourPlayer';
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
  onBotSpellChess: () => void;
  onBotHorde: () => void;
  onBotCrazyhouse: () => void;
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
  /** Online 4 Player (behind the same login gate as every Online entry). */
  onFourPlayerOnline: () => void;
  /** 4 Player Giveaway (4-seat Antichess): Local (seat setup, bots allowed) and Online (behind the login gate). */
  onFourPlayerGiveaway: () => void;
  onFourPlayerGiveawayOnline: () => void;
  /** Chaturaji (4 players on an 8 x 8 board): Local (seat setup, bots allowed) and Online (behind the login gate). */
  onChaturaji: () => void;
  onChaturajiOnline: () => void;
  /** Bughouse (two teams of two, two boards): Local only so far (seat setup, bots allowed). */
  onBughouse: () => void;
  /** Set while the player has left an online 4 Player game that is still going: offers "Return to your game". */
  onFourPlayerResume?: () => void;
  /** Which game that left online game is, so the link sits under its card (4 Player Chess when omitted, as before Chaturaji). */
  fourPlayerResumeVariant?: FourVariant;
  onLocalSpellChess: () => void;
  onLocalHorde: () => void;
  onLocalCrazyhouse: () => void;
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
  onBotSpellChess,
  onBotHorde,
  onBotCrazyhouse,
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
  onFourPlayerOnline,
  onFourPlayerGiveaway,
  onFourPlayerGiveawayOnline,
  onChaturaji,
  onChaturajiOnline,
  onBughouse,
  onFourPlayerResume,
  fourPlayerResumeVariant = 'ffa',
  onLocalSpellChess,
  onLocalHorde,
  onLocalCrazyhouse,
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
  const handleFourPlayerOnline = requireLogin(onFourPlayerOnline);
  const handleFourPlayerGiveawayOnline = requireLogin(onFourPlayerGiveawayOnline);
  const handleChaturajiOnline = requireLogin(onChaturajiOnline);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [bughouseRulesOpen, setBughouseRulesOpen] = useState(false);
  const resumeLink = (variant: FourVariant) =>
    onFourPlayerResume && fourPlayerResumeVariant === variant ? (
      <Pressable style={styles.spectateLink} onPress={onFourPlayerResume}>
        <Text style={styles.spectateLinkText}>Return to your game ›</Text>
      </Pressable>
    ) : null;

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
            <Pressable style={[styles.subButton, styles.botSubButton]} onPress={onBotSpellChess}>
              <ModeButtonLabel label="Spell Chess" style={styles.subButtonText} />
            </Pressable>
            <Pressable style={[styles.subButton, styles.botSubButton]} onPress={onBotHorde}>
              <ModeButtonLabel label="Horde" style={styles.subButtonText} />
            </Pressable>
          </View>
          <View style={styles.subButtonRow}>
            <Pressable style={[styles.subButton, styles.botSubButton]} onPress={onBotCrazyhouse}>
              <ModeButtonLabel label="Crazyhouse" style={styles.subButtonText} />
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
            <Pressable style={[styles.subButton, styles.localSubButton]} onPress={onLocalSpellChess}>
              <ModeButtonLabel label="Spell Chess" style={styles.subButtonText} />
            </Pressable>
            <Pressable style={[styles.subButton, styles.localSubButton]} onPress={onLocalHorde}>
              <ModeButtonLabel label="Horde" style={styles.subButtonText} />
            </Pressable>
          </View>
          <View style={styles.subButtonRow}>
            <Pressable style={[styles.subButton, styles.localSubButton]} onPress={onLocalCrazyhouse}>
              <ModeButtonLabel label="Crazyhouse" style={styles.subButtonText} />
            </Pressable>
          </View>
        </View>

        <View style={styles.categoryCard}>
          <Text style={styles.categoryTitle}>4 Player Chess</Text>
          <Text style={styles.categorySubtitle}>Four players on a cross-shaped board — pass the device, play bots, or play online</Text>
          <View style={styles.subButtonRow}>
            <Pressable style={[styles.subButton, styles.fourPlayerSubButton]} onPress={onFourPlayer}>
              <ModeButtonLabel label="Free-for-All" style={styles.subButtonText} />
            </Pressable>
            <Pressable style={[styles.subButton, styles.fourPlayerSubButton]} onPress={handleFourPlayerOnline}>
              <ModeButtonLabel label="Online" style={styles.subButtonText} />
            </Pressable>
          </View>
          {resumeLink('ffa')}
        </View>

        <View style={styles.categoryCard}>
          <Text style={styles.categoryTitle}>4 Player Giveaway</Text>
          <Text style={styles.categorySubtitle}>Four players, captures are mandatory — lose all your pieces to win. Pass the device, play bots, or play online</Text>
          <View style={styles.subButtonRow}>
            <Pressable style={[styles.subButton, styles.fourPlayerSubButton]} onPress={onFourPlayerGiveaway}>
              <ModeButtonLabel label="Local" style={styles.subButtonText} />
            </Pressable>
            <Pressable style={[styles.subButton, styles.fourPlayerSubButton]} onPress={handleFourPlayerGiveawayOnline}>
              <ModeButtonLabel label="Online" style={styles.subButtonText} />
            </Pressable>
          </View>
          {resumeLink('giveaway')}
        </View>

        <View style={styles.categoryCard} testID="chaturaji-card">
          <Text style={styles.categoryTitle}>Chaturaji</Text>
          <Text style={styles.categorySubtitle}>Four armies on an 8 × 8 board — capture the kings, most points wins. Pass the device, play bots, or play online</Text>
          <View style={styles.subButtonRow}>
            <Pressable accessibilityLabel="Chaturaji local" style={[styles.subButton, styles.fourPlayerSubButton]} onPress={onChaturaji}>
              <ModeButtonLabel label="Local" style={styles.subButtonText} />
            </Pressable>
            <Pressable accessibilityLabel="Chaturaji online" style={[styles.subButton, styles.fourPlayerSubButton]} onPress={handleChaturajiOnline}>
              <ModeButtonLabel label="Online" style={styles.subButtonText} />
            </Pressable>
          </View>
          <Pressable accessibilityLabel="Chaturaji rules" testID="chaturaji-rules-link" style={styles.spectateLink} onPress={() => setRulesOpen(true)}>
            <Text style={styles.spectateLinkText}>How to play ›</Text>
          </Pressable>
          {resumeLink('chaturaji')}
        </View>
        <ChaturajiRulesSheet visible={rulesOpen} onClose={() => setRulesOpen(false)} />

        <View style={styles.categoryCard} testID="bughouse-card">
          <Text style={styles.categoryTitle}>Bughouse</Text>
          <Text style={styles.categorySubtitle}>Two teams of two on two boards — a piece you capture goes to your partner&apos;s pocket. Play against bots or pass the device</Text>
          <View style={styles.subButtonRow}>
            <Pressable accessibilityLabel="Bughouse local" style={[styles.subButton, styles.fourPlayerSubButton]} onPress={onBughouse}>
              <ModeButtonLabel label="Local" style={styles.subButtonText} />
            </Pressable>
          </View>
          <Pressable accessibilityLabel="Bughouse rules" testID="bughouse-rules-link" style={styles.spectateLink} onPress={() => setBughouseRulesOpen(true)}>
            <Text style={styles.spectateLinkText}>How to play ›</Text>
          </Pressable>
        </View>
        <BughouseRulesSheet visible={bughouseRulesOpen} onClose={() => setBughouseRulesOpen(false)} />

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
