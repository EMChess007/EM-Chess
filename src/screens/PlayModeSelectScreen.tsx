import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Pressable } from '../components/AppPressable';
import { Text } from '../components/AppText';
import { appAlert } from '../components/AppAlert';
import ModeButtonLabel from '../components/ModeButtonLabel';
import ScreenHeader from '../components/ScreenHeader';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import type { FourVariant } from '../logic/fourPlayer';
import { variantTitle } from '../logic/fourPlayerVariant';
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
  onBotRacingKings: () => void;
  onLocalClassic: () => void;
  onLocalChess960: () => void;
  onLocalKingOfTheHill: () => void;
  onLocalThreeCheck: () => void;
  onLocalSetupChess: () => void;
  onLocalFogOfWar: () => void;
  onLocalGiveaway: () => void;
  onLocalAtomic: () => void;
  onLocalDuckChess: () => void;
  /**
   * THE "4 PLAYER VARIATIONS" CARD (command #35): four buttons, each opens that game's LOCAL setup (a human or a bot per seat) - there is no separate "Local" button. Everything ONLINE for these
   * games (Quick Match, Challenge a Friend with a room of up to four friends, Join by Code, Spectate) lives in the Online card.
   */
  onFourPlayer: () => void;
  onFourPlayerGiveaway: () => void;
  onChaturaji: () => void;
  /** Crazy Bughouse (two teams of two on two boards; a captured piece goes to your partner's pocket). */
  onBughouse: () => void;
  /** Set while the player has left an online 4 Player game that is still going: offers "Return to your game". */
  onFourPlayerResume?: () => void;
  /** Which game that left online game is (the link names it). */
  fourPlayerResumeVariant?: FourVariant;
  /** Set while the player has left an online Crazy Bughouse game that is still going (or the app was restarted in one): offers "Return to your Crazy Bughouse game". */
  onBughouseResume?: () => void;
  onLocalSpellChess: () => void;
  onLocalHorde: () => void;
  onLocalCrazyhouse: () => void;
  onLocalRacingKings: () => void;
  onEngineVsEngineClassic: () => void;
  onEngineVsEngineChess960: () => void;
  onEngineVsEngineKingOfTheHill: () => void;
  onEngineVsEngineThreeCheck: () => void;
  onBoardEditor: () => void;
  onImportPgn: () => void;
  authUser: AuthUser | null;
  onAuthPress: () => void;
}

/** The narrowest a mode button gets (dp): wide enough for "Tournaments" at the normal text size; a narrower row wraps. */
const MIN_MODE_BUTTON_WIDTH = 96;

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
  onBotRacingKings,
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
  onFourPlayerGiveaway,
  onChaturaji,
  onBughouse,
  onFourPlayerResume,
  fourPlayerResumeVariant = 'ffa',
  onBughouseResume,
  onLocalSpellChess,
  onLocalHorde,
  onLocalCrazyhouse,
  onLocalRacingKings,
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
          <Text style={styles.categorySubtitle}>Play live against another player - or in a room with up to four friends (4 Player Chess, 4 Player Giveaway, Chaturaji, Crazy Bughouse)</Text>
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
            <Pressable style={[styles.subButton, styles.botSubButton]} onPress={onBotRacingKings}>
              <ModeButtonLabel label="Racing Kings" style={styles.subButtonText} />
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
            <Pressable style={[styles.subButton, styles.localSubButton]} onPress={onLocalRacingKings}>
              <ModeButtonLabel label="Racing Kings" style={styles.subButtonText} />
            </Pressable>
          </View>
        </View>

        <View style={styles.categoryCard} testID="four-player-variations-card">
          <Text style={styles.categoryTitle}>4 Player Variations</Text>
          <Text style={styles.categorySubtitle}>Four seats - each a person or a bot. Online play (quick match, a room for up to four friends) is in the Online card above</Text>
          <View style={styles.subButtonRow}>
            <Pressable accessibilityLabel="4 Player Chess" testID="four-player-chess-button" style={[styles.subButton, styles.fourPlayerSubButton]} onPress={onFourPlayer}>
              <ModeButtonLabel label="4 Player Chess" style={styles.subButtonText} />
            </Pressable>
            <Pressable accessibilityLabel="4 Player Giveaway" testID="four-player-giveaway-button" style={[styles.subButton, styles.fourPlayerSubButton]} onPress={onFourPlayerGiveaway}>
              <ModeButtonLabel label="4 Player Giveaway" style={styles.subButtonText} />
            </Pressable>
          </View>
          <View style={styles.subButtonRow}>
            <Pressable accessibilityLabel="Chaturaji" testID="chaturaji-button" style={[styles.subButton, styles.fourPlayerSubButton]} onPress={onChaturaji}>
              <ModeButtonLabel label="Chaturaji" style={styles.subButtonText} />
            </Pressable>
            <Pressable accessibilityLabel="Crazy Bughouse" testID="bughouse-button" style={[styles.subButton, styles.fourPlayerSubButton]} onPress={onBughouse}>
              <ModeButtonLabel label="Crazy Bughouse" style={styles.subButtonText} />
            </Pressable>
          </View>
          {onFourPlayerResume && fourPlayerResumeVariant !== undefined && (
            <Pressable accessibilityLabel={`Return to your ${variantTitle(fourPlayerResumeVariant)} game`} testID="four-player-resume" style={styles.spectateLink} onPress={onFourPlayerResume}>
              <Text style={styles.spectateLinkText}>Return to your {variantTitle(fourPlayerResumeVariant)} game ›</Text>
            </Pressable>
          )}
          {onBughouseResume && (
            <Pressable accessibilityLabel="Return to your Crazy Bughouse game" testID="bughouse-resume" style={styles.spectateLink} onPress={onBughouseResume}>
              <Text style={styles.spectateLinkText}>Return to your Crazy Bughouse game ›</Text>
            </Pressable>
          )}
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
    // Rows wrap (Android text-fit work): a button is never narrower than MIN_MODE_BUTTON_WIDTH, so on a narrow window or with large text the row breaks into two lines of
    // buttons instead of squeezing three labels into a width that holds none of them.
    subButtonRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginTop: 4,
    },
    subButton: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: MIN_MODE_BUTTON_WIDTH,
      minWidth: MIN_MODE_BUTTON_WIDTH,
      paddingVertical: 14,
      paddingHorizontal: 6,
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
