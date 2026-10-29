import { useEffect, useState } from 'react';
import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import { AppState, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setSessionExpiredHandler } from './src/api/client';
import type { GameVariant } from './src/components/VariantSelector';
import { notifyScreenTouch } from './src/logic/screenTouches';
import { clearActiveGame, loadResumableGame, saveActiveGame, touchActiveGame } from './src/api/activeGameStorage';
import { clearAuthSession, loadAuthSession, type AuthSession } from './src/api/authStorage';
import AppAlertHost, { appAlert } from './src/components/AppAlert';
import BottomTabBar, { type MainTab } from './src/components/BottomTabBar';
import SideInsetsFrame from './src/components/SideInsetsFrame';
import { useAppFonts } from './src/components/useAppFonts';
import AchievementsScreen from './src/screens/AchievementsScreen';
import AnalysisScreen from './src/screens/AnalysisScreen';
import BoardSetupScreen from './src/screens/BoardSetupScreen';
import BotGameScreen from './src/screens/BotGameScreen';
import BotSelectScreen from './src/screens/BotSelectScreen';
import BotSetupChessFlowScreen from './src/screens/BotSetupChessFlowScreen';
import ChallengeScreen from './src/screens/ChallengeScreen';
import DailyPuzzleScreen from './src/screens/DailyPuzzleScreen';
import DiagnosticLogsScreen from './src/screens/DiagnosticLogsScreen';
import EngineSelectScreen from './src/screens/EngineSelectScreen';
import EngineVsEngineGameScreen from './src/screens/EngineVsEngineGameScreen';
import EngineVsEngineSetupScreen from './src/screens/EngineVsEngineSetupScreen';
import GameHistoryScreen from './src/screens/GameHistoryScreen';
import HomeScreen from './src/screens/HomeScreen';
import LeaderboardScreen from './src/screens/LeaderboardScreen';
import LocalGameScreen from './src/screens/LocalGameScreen';
import LocalSetupChessFlowScreen from './src/screens/LocalSetupChessFlowScreen';
import LoginScreen from './src/screens/LoginScreen';
import MatchmakingScreen from './src/screens/MatchmakingScreen';
import MoreScreen from './src/screens/MoreScreen';
import OnlineGameScreen from './src/screens/OnlineGameScreen';
import OnlineTimeControlSelectScreen from './src/screens/OnlineTimeControlSelectScreen';
import PgnImportScreen from './src/screens/PgnImportScreen';
import PlayModeSelectScreen from './src/screens/PlayModeSelectScreen';
import PuzzleRushScreen from './src/screens/PuzzleRushScreen';
import PuzzleTrainingScreen from './src/screens/PuzzleTrainingScreen';
import RatingHistoryScreen from './src/screens/RatingHistoryScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import SetupChessOnlineScreen from './src/screens/SetupChessOnlineScreen';
import TournamentScreen from './src/screens/TournamentScreen';
import TournamentStandingsScreen from './src/screens/TournamentStandingsScreen';
import FourPlayerGameScreen from './src/screens/FourPlayerGameScreen';
import FourPlayerMatchmakingScreen from './src/screens/FourPlayerMatchmakingScreen';
import FourPlayerOnlineGameScreen from './src/screens/FourPlayerOnlineGameScreen';
import FourPlayerSpectatorScreen from './src/screens/FourPlayerSpectatorScreen';
import FourPlayerSetupScreen from './src/screens/FourPlayerSetupScreen';
import SpectateListScreen from './src/screens/SpectateListScreen';
import SpectatorGameScreen from './src/screens/SpectatorGameScreen';
import StreakScreen from './src/screens/StreakScreen';
import ThemeSelectScreen from './src/screens/ThemeSelectScreen';
import TimeControlSelectScreen from './src/screens/TimeControlSelectScreen';
import { restoreColorSchemeMode } from './src/logic/colorSchemeSettings';
import { useAppColors } from './src/logic/colorSchemeHooks';
import { restoreCustomEngines } from './src/logic/customEngines';
import { restoreCustomThemes } from './src/logic/customThemes';
import { restoreAchievements } from './src/logic/achievementStorage';
import { logDiagnostic, restoreDiagnosticLog } from './src/logic/diagnosticLog';
import { restoreRatings } from './src/logic/ratingStorage';
import { restoreRatingHistory } from './src/logic/ratingHistoryStorage';
import { restoreSoundSetting } from './src/logic/soundSettings';
import { recordAppOpen } from './src/logic/streakStorage';
import { restoreActiveThemes } from './src/logic/themeSettings';
import type { BotPersonality } from './src/types/bot';
import type { ColorChoice, PieceColor } from './src/types/chess';
import { SEAT_NAMES, defaultSeatConfig, withController, type Seat, type SeatConfig } from './src/logic/fourPlayer';
import { controllerForBot } from './src/logic/fourPlayerBots';
import type { AnalyzeParams } from './src/types/history';
import { variantModeLabel, variantTitle } from './src/logic/fourPlayerVariant';
import { fourVariantOf, type FourMatchFoundPayload, type FourVariant } from './src/logic/fourPlayerWire';
import type { ActiveGameSummary, MatchFoundPayload, SetupChessPairedPayload } from './src/types/multiplayer';
import type { TimeControl } from './src/types/timeControl';

type TimeControlFlowMode =
  | { kind: 'local'; chess960: boolean; kingOfTheHill: boolean; threeCheck: boolean; setupChess: boolean; fogOfWar: boolean; giveaway: boolean; atomic: boolean; duckChess: boolean; spellChess: boolean; horde: boolean; crazyhouse: boolean }
  | { kind: 'bot'; bot: BotPersonality; chess960: boolean; kingOfTheHill: boolean; threeCheck: boolean; setupChess: boolean; fogOfWar: boolean; giveaway: boolean; atomic: boolean; duckChess: boolean; spellChess: boolean; horde: boolean; crazyhouse: boolean }
  | { kind: 'engineVsEngine'; chess960: boolean; kingOfTheHill: boolean; threeCheck: boolean; setupChess: boolean };

type Screen =
  | { name: 'main' }
  | { name: 'playModeSelect' }
  | { name: 'botSelect'; chess960: boolean; kingOfTheHill: boolean; threeCheck: boolean; setupChess: boolean; fogOfWar: boolean; giveaway: boolean; atomic: boolean; duckChess: boolean; spellChess: boolean; horde: boolean; crazyhouse: boolean }
  | { name: 'timeControlSelect'; mode: TimeControlFlowMode }
  | {
      name: 'game';
      timeControl: TimeControl;
      chess960: boolean;
      kingOfTheHill: boolean;
      threeCheck: boolean;
      setupChess: boolean;
      fogOfWar: boolean;
      giveaway: boolean;
      atomic: boolean;
      duckChess: boolean;
      spellChess: boolean;
      horde: boolean;
      crazyhouse: boolean;
      initialFen?: string;
    }
  | {
      name: 'botGame';
      timeControl: TimeControl;
      bot: BotPersonality;
      chess960: boolean;
      kingOfTheHill: boolean;
      threeCheck: boolean;
      setupChess: boolean;
      fogOfWar: boolean;
      giveaway: boolean;
      atomic: boolean;
      duckChess: boolean;
      spellChess: boolean;
      horde: boolean;
      crazyhouse: boolean;
      initialFen?: string;
      colorChoice: ColorChoice;
    }
  | { name: 'localSetupChessFlow'; timeControl: TimeControl }
  | { name: 'botSetupChessFlow'; timeControl: TimeControl; bot: BotPersonality; colorChoice: ColorChoice }
  | { name: 'analysis'; params: AnalyzeParams }
  | { name: 'boardSetup' }
  | { name: 'pgnImport' }
  | { name: 'login' }
  | { name: 'register' }
  | { name: 'onlineTimeControlSelect'; token: string }
  | {
      name: 'matchmaking';
      token: string;
      timeControl: TimeControl;
      variant: GameVariant;
    }
  | { name: 'setupChessOnline'; token: string; pairingId: string; color: PieceColor }
  | { name: 'challenge'; token: string }
  | { name: 'spectateList'; token: string | null }
  | { name: 'spectatorGame'; token: string | null; roomId: string; whiteUsername: string; blackUsername: string }
  | { name: 'onlineGame'; token: string; match: MatchFoundPayload; returnToTournamentId?: string; resume?: boolean }
  | { name: 'tournament'; token: string }
  | { name: 'tournamentStandings'; token: string; tournamentId: string }
  | { name: 'engineSelect' }
  // 4 Player Chess is its own mode, not a variant of the 2-player game (see src/logic/fourPlayer): setup picks who controls each seat.
  // The seat choices travel in the screen state so they survive the trip to the bot picker and on to the time control.
  // 4 Player Giveaway (FOUR_PLAYER_GIVEAWAY_SPEC.md §8) is the same flow with `variant: 'giveaway'`; the Chess entries pass 'ffa'. The variant rides in the
  // screen state exactly like the seat choices, so it survives the trip to the bot picker and on to the time control and the game.
  | { name: 'fourPlayerSetup'; variant: FourVariant; seats: SeatConfig }
  | { name: 'fourPlayerBotSelect'; variant: FourVariant; seats: SeatConfig; seat: Seat }
  | { name: 'fourPlayerTimeControl'; variant: FourVariant; seats: SeatConfig }
  | { name: 'fourPlayerGame'; variant: FourVariant; seats: SeatConfig; timeControl: TimeControl }
  // Online 4 Player (FOUR_PLAYER_ONLINE_SPEC.md §8): pick a live time control -> queue -> the game; spectating is a separate screen.
  | { name: 'fourPlayerOnlineTimeControl'; variant: FourVariant; token: string }
  | { name: 'fourPlayerMatchmaking'; variant: FourVariant; token: string; timeControl: TimeControl }
  | { name: 'fourPlayerOnlineGame'; token: string; match: FourMatchFoundPayload; timeControl: TimeControl; resume: boolean }
  | { name: 'fourPlayerSpectate'; token: string | null; roomId: string }
  | { name: 'themeSelect' }
  | { name: 'streak' }
  | { name: 'puzzleRush'; themeFilter?: string[] }
  | { name: 'puzzleTraining' }
  | { name: 'achievements' }
  | { name: 'diagnosticLogs' }
  | { name: 'leaderboard'; token: string }
  | { name: 'ratingHistory' }
  | {
      name: 'engineVsEngineSetup';
      timeControl: TimeControl;
      chess960: boolean;
      kingOfTheHill: boolean;
      threeCheck: boolean;
      engine1: BotPersonality | null;
      engine2: BotPersonality | null;
      color1: ColorChoice;
      color2: ColorChoice;
    }
  | {
      name: 'engineVsEngineBotSelect';
      slot: 1 | 2;
      timeControl: TimeControl;
      chess960: boolean;
      kingOfTheHill: boolean;
      threeCheck: boolean;
      engine1: BotPersonality | null;
      engine2: BotPersonality | null;
      color1: ColorChoice;
      color2: ColorChoice;
    }
  | {
      name: 'engineVsEngineGame';
      timeControl: TimeControl;
      chess960: boolean;
      kingOfTheHill: boolean;
      threeCheck: boolean;
      engine1: BotPersonality;
      engine2: BotPersonality;
      color1: ColorChoice;
      color2: ColorChoice;
    };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'main' });
  const [activeTab, setActiveTab] = useState<MainTab>('home');
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  // An online 4 Player game the player left while their seat was still live (a bot plays it after 45 s; they may return until it ends). Kept in
  // memory for the "Return to your game" card; the same game is ALSO persisted (activeGameStorage.ts) so an app restart or a web refresh rejoins it.
  const [fourResume, setFourResume] = useState<{ token: string; match: FourMatchFoundPayload; timeControl: TimeControl } | null>(null);
  // Gates the very first render on the persisted Dark/Light preference having actually loaded —
  // without this, every screen mounts once with useAppColors()'s synchronous default ('light',
  // see colorSchemeSettings.ts) and only corrects itself once restoreColorSchemeMode's AsyncStorage
  // read resolves and notifies subscribers. That's normally a same-frame correction, but showing
  // the wrong theme for even one frame is exactly the reported bug (dark-mode users seeing a
  // flash of light background at cold start) — so nothing renders until it's known for certain.
  const [themeReady, setThemeReady] = useState(false);

  const colors = useAppColors();
  // Nothing renders until the bundled font is settled (loaded, failed or too slow): see logic/typography.ts.
  const fontsSettled = useAppFonts();

  useEffect(() => {
    // Started first (though not awaited before the others below — logDiagnostic is safe to call
    // before this resolves, see its own comment) so this session's own startup log line is never
    // lost regardless of exactly when it fires relative to this.
    restoreDiagnosticLog();
    loadAuthSession().then((session) => {
      // Persisted (see diagnosticLog.ts) so this line survives being read on a LATER launch too —
      // the whole point, since a signed preview/production build has no attached console. The one
      // thing this can't distinguish is "never had a session" from "had one, but the OS-level
      // Keystore key backing it was invalidated", since Android's SecureStore implementation
      // treats both identically (returns null, no exception) by design once a key is gone. If this
      // logs "no session found" right after a real login+close+reopen cycle, that's the
      // Keystore-invalidation case, not an app-level bug.
      logDiagnostic(`[App] Startup session check: ${session ? `restored (user ${session.user.username})` : 'no session found'}`);
      setAuthSession(session);
      // A page reload / app kill in the middle of an online game: walk straight back into the seat (the server holds it for 45 s, and keeps a
      // result that arrived meanwhile for 5 minutes). Only if nothing else has been opened yet, and only for the SAME account that was playing.
      if (session) {
        loadResumableGame(session.user.id).then((game) => {
          if (!game) return;
          logDiagnostic(`[App] Resuming a ${game.kind} online game after a restart (room ${game.match.roomId}).`);
          setScreen((current) => {
            if (current.name !== 'main') return current;
            return game.kind === 'twoPlayer'
              ? { name: 'onlineGame', token: session.token, match: game.match, returnToTournamentId: game.returnToTournamentId, resume: true }
              : { name: 'fourPlayerOnlineGame', token: session.token, match: game.match, timeControl: game.timeControl, resume: true };
          });
        });
      }
    });
    restoreCustomEngines();
    restoreSoundSetting();
    restoreCustomThemes();
    restoreActiveThemes();
    restoreColorSchemeMode().finally(() => setThemeReady(true));
    restoreRatings();
    restoreRatingHistory();
    restoreAchievements();
    recordAppOpen();
  }, []);

  // Immersive edge-to-edge on Android: the system nav bar starts hidden and only reappears as a
  // temporary overlay when the user swipes up from the bottom edge (BEHAVIOR_SHOW_TRANSIENT_BARS_
  // BY_SWIPE, hardcoded into expo-navigation-bar's native setHidden — see its NavigationBarModule.kt),
  // then auto-hides again — the same "gesture-nav" feel as most modern Android apps. iOS has no
  // equivalent concept (its home indicator isn't hideable the same way) and web has no navigation
  // bar at all, so this is Android-only. Re-asserted on every foreground transition because some
  // Android versions/launchers can reset a hidden nav bar back to visible while the app was
  // backgrounded (e.g. after the recents/app-switcher UI was shown over it).
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    NavigationBar.setHidden(true);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') NavigationBar.setHidden(true);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      // Distinct from the startup log above: this fires only when a request was actually made
      // WITH a token and the server rejected it (401) — a real backend-side rejection (token
      // genuinely expired, or the server's JWT_SECRET no longer matches what signed it), not a
      // client-side storage issue. Always paired with the visible alert below, unlike a plain
      // "no session found" at startup.
      logDiagnostic('[App] Session expired: server rejected an authenticated request (401).');
      clearAuthSession();
      setAuthSession(null);
      setScreen({ name: 'login' });
      appAlert('Session Expired', 'Your session has expired. Please log in again.');
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  // The online game on screen is remembered (id + rejoin token + variant, in SecureStore / AsyncStorage - see activeGameStorage.ts) so a reload or
  // app kill can rejoin it. Saved when a game screen opens; refreshed every 20 s while one is open; cleared by the screens when the game ends, on
  // resign / leave and on logout.
  useEffect(() => {
    if (!authSession) return;
    if (screen.name === 'onlineGame') {
      void saveActiveGame({ kind: 'twoPlayer', userId: authSession.user.id, match: screen.match, returnToTournamentId: screen.returnToTournamentId });
    } else if (screen.name === 'fourPlayerOnlineGame') {
      void saveActiveGame({ kind: 'fourPlayer', userId: authSession.user.id, match: screen.match, timeControl: screen.timeControl });
    }
  }, [screen, authSession]);
  const liveGameRoomId =
    screen.name === 'onlineGame' || screen.name === 'fourPlayerOnlineGame' ? screen.match.roomId : (fourResume?.match.roomId ?? null);
  useEffect(() => {
    if (!liveGameRoomId) return;
    const id = setInterval(() => void touchActiveGame(liveGameRoomId), 20_000);
    return () => clearInterval(id);
  }, [liveGameRoomId]);

  const handleLogout = () => {
    void clearActiveGame();
    clearAuthSession();
    setAuthSession(null);
  };

  if (!themeReady || !fontsSettled) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: colors.background }} />
      </SafeAreaProvider>
    );
  }

  let content;
  if (screen.name === 'main') {
    let tabContent;
    if (activeTab === 'home') {
      tabContent = (
        <HomeScreen
          onPlay={() => setScreen({ name: 'playModeSelect' })}
          onOpenPuzzles={() => setActiveTab('puzzles')}
          onOpenAnalysis={() => setActiveTab('analysis')}
          onOpenStreak={() => setScreen({ name: 'streak' })}
          onAnalyzeGame={(params) => setScreen({ name: 'analysis', params })}
          authToken={authSession?.token ?? null}
        />
      );
    } else if (activeTab === 'puzzles') {
      tabContent = (
        <DailyPuzzleScreen
          authToken={authSession?.token ?? null}
          onOpenPuzzleRush={() => setScreen({ name: 'puzzleRush' })}
          onOpenPuzzleTraining={() => setScreen({ name: 'puzzleTraining' })}
        />
      );
    } else if (activeTab === 'analysis') {
      tabContent = (
        <GameHistoryScreen
          authToken={authSession?.token ?? null}
          onAnalyze={(params) => setScreen({ name: 'analysis', params })}
          onAuthPress={() => setScreen({ name: 'login' })}
        />
      );
    } else {
      tabContent = (
        <MoreScreen
          authUser={authSession?.user ?? null}
          onAuthPress={() => setScreen({ name: 'login' })}
          onLogout={handleLogout}
          onOpenEngines={() => setScreen({ name: 'engineSelect' })}
          onOpenThemes={() => setScreen({ name: 'themeSelect' })}
          onOpenAchievements={() => setScreen({ name: 'achievements' })}
          onOpenLeaderboard={() => authSession && setScreen({ name: 'leaderboard', token: authSession.token })}
          onOpenRatingHistory={() => setScreen({ name: 'ratingHistory' })}
          onOpenDiagnosticLogs={() => setScreen({ name: 'diagnosticLogs' })}
        />
      );
    }
    content = (
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>{tabContent}</View>
        <BottomTabBar activeTab={activeTab} onTabPress={setActiveTab} />
      </View>
    );
  } else if (screen.name === 'playModeSelect') {
    content = (
      <PlayModeSelectScreen
        onBack={() => setScreen({ name: 'main' })}
        onOnline={() => authSession && setScreen({ name: 'onlineTimeControlSelect', token: authSession.token })}
        onChallengeFriend={() => authSession && setScreen({ name: 'challenge', token: authSession.token })}
        onTournaments={() => authSession && setScreen({ name: 'tournament', token: authSession.token })}
        onSpectate={() => setScreen({ name: 'spectateList', token: authSession?.token ?? null })}
        onFourPlayerOnline={() => authSession && setScreen({ name: 'fourPlayerOnlineTimeControl', variant: 'ffa', token: authSession.token })}
        onFourPlayerGiveaway={() => setScreen({ name: 'fourPlayerSetup', variant: 'giveaway', seats: defaultSeatConfig() })}
        onFourPlayerGiveawayOnline={() => authSession && setScreen({ name: 'fourPlayerOnlineTimeControl', variant: 'giveaway', token: authSession.token })}
        onChaturaji={() => setScreen({ name: 'fourPlayerSetup', variant: 'chaturaji', seats: defaultSeatConfig() })}
        onChaturajiOnline={() => authSession && setScreen({ name: 'fourPlayerOnlineTimeControl', variant: 'chaturaji', token: authSession.token })}
        fourPlayerResumeVariant={fourResume ? fourVariantOf(fourResume.match) : undefined}
        onFourPlayerResume={
          fourResume && authSession?.token === fourResume.token
            ? () => setScreen({ name: 'fourPlayerOnlineGame', token: fourResume.token, match: fourResume.match, timeControl: fourResume.timeControl, resume: true })
            : undefined
        }
        onBotClassic={() =>
          setScreen({ name: 'botSelect', chess960: false, kingOfTheHill: false, threeCheck: false, setupChess: false, fogOfWar: false, giveaway: false, atomic: false, duckChess: false, spellChess: false, horde: false, crazyhouse: false })
        }
        onBotChess960={() =>
          setScreen({ name: 'botSelect', chess960: true, kingOfTheHill: false, threeCheck: false, setupChess: false, fogOfWar: false, giveaway: false, atomic: false, duckChess: false, spellChess: false, horde: false, crazyhouse: false })
        }
        onBotKingOfTheHill={() =>
          setScreen({ name: 'botSelect', chess960: false, kingOfTheHill: true, threeCheck: false, setupChess: false, fogOfWar: false, giveaway: false, atomic: false, duckChess: false, spellChess: false, horde: false, crazyhouse: false })
        }
        onBotThreeCheck={() =>
          setScreen({ name: 'botSelect', chess960: false, kingOfTheHill: false, threeCheck: true, setupChess: false, fogOfWar: false, giveaway: false, atomic: false, duckChess: false, spellChess: false, horde: false, crazyhouse: false })
        }
        onBotSetupChess={() =>
          setScreen({ name: 'botSelect', chess960: false, kingOfTheHill: false, threeCheck: false, setupChess: true, fogOfWar: false, giveaway: false, atomic: false, duckChess: false, spellChess: false, horde: false, crazyhouse: false })
        }
        onBotFogOfWar={() =>
          setScreen({ name: 'botSelect', chess960: false, kingOfTheHill: false, threeCheck: false, setupChess: false, fogOfWar: true, giveaway: false, atomic: false, duckChess: false, spellChess: false, horde: false, crazyhouse: false })
        }
        onBotGiveaway={() =>
          setScreen({ name: 'botSelect', chess960: false, kingOfTheHill: false, threeCheck: false, setupChess: false, fogOfWar: false, giveaway: true, atomic: false, duckChess: false, spellChess: false, horde: false, crazyhouse: false })
        }
        onBotAtomic={() =>
          setScreen({ name: 'botSelect', chess960: false, kingOfTheHill: false, threeCheck: false, setupChess: false, fogOfWar: false, giveaway: false, atomic: true, duckChess: false, spellChess: false, horde: false, crazyhouse: false })
        }
        onBotDuckChess={() =>
          setScreen({ name: 'botSelect', chess960: false, kingOfTheHill: false, threeCheck: false, setupChess: false, fogOfWar: false, giveaway: false, atomic: false, duckChess: true, spellChess: false, horde: false, crazyhouse: false })
        }
        onBotSpellChess={() =>
          setScreen({ name: 'botSelect', chess960: false, kingOfTheHill: false, threeCheck: false, setupChess: false, fogOfWar: false, giveaway: false, atomic: false, duckChess: false, spellChess: true, horde: false, crazyhouse: false })
        }
        onBotHorde={() =>
          setScreen({ name: 'botSelect', chess960: false, kingOfTheHill: false, threeCheck: false, setupChess: false, fogOfWar: false, giveaway: false, atomic: false, duckChess: false, spellChess: false, horde: true, crazyhouse: false })
        }
        onBotCrazyhouse={() =>
          setScreen({ name: 'botSelect', chess960: false, kingOfTheHill: false, threeCheck: false, setupChess: false, fogOfWar: false, giveaway: false, atomic: false, duckChess: false, spellChess: false, horde: false, crazyhouse: true })
        }
        onLocalClassic={() =>
          setScreen({
            name: 'timeControlSelect',
            mode: { kind: 'local', chess960: false, kingOfTheHill: false, threeCheck: false, setupChess: false, fogOfWar: false, giveaway: false, atomic: false, duckChess: false, spellChess: false, horde: false, crazyhouse: false },
          })
        }
        onLocalChess960={() =>
          setScreen({
            name: 'timeControlSelect',
            mode: { kind: 'local', chess960: true, kingOfTheHill: false, threeCheck: false, setupChess: false, fogOfWar: false, giveaway: false, atomic: false, duckChess: false, spellChess: false, horde: false, crazyhouse: false },
          })
        }
        onLocalKingOfTheHill={() =>
          setScreen({
            name: 'timeControlSelect',
            mode: { kind: 'local', chess960: false, kingOfTheHill: true, threeCheck: false, setupChess: false, fogOfWar: false, giveaway: false, atomic: false, duckChess: false, spellChess: false, horde: false, crazyhouse: false },
          })
        }
        onLocalThreeCheck={() =>
          setScreen({
            name: 'timeControlSelect',
            mode: { kind: 'local', chess960: false, kingOfTheHill: false, threeCheck: true, setupChess: false, fogOfWar: false, giveaway: false, atomic: false, duckChess: false, spellChess: false, horde: false, crazyhouse: false },
          })
        }
        onLocalSetupChess={() =>
          setScreen({
            name: 'timeControlSelect',
            mode: { kind: 'local', chess960: false, kingOfTheHill: false, threeCheck: false, setupChess: true, fogOfWar: false, giveaway: false, atomic: false, duckChess: false, spellChess: false, horde: false, crazyhouse: false },
          })
        }
        onLocalFogOfWar={() =>
          setScreen({
            name: 'timeControlSelect',
            mode: { kind: 'local', chess960: false, kingOfTheHill: false, threeCheck: false, setupChess: false, fogOfWar: true, giveaway: false, atomic: false, duckChess: false, spellChess: false, horde: false, crazyhouse: false },
          })
        }
        onLocalGiveaway={() =>
          setScreen({
            name: 'timeControlSelect',
            mode: { kind: 'local', chess960: false, kingOfTheHill: false, threeCheck: false, setupChess: false, fogOfWar: false, giveaway: true, atomic: false, duckChess: false, spellChess: false, horde: false, crazyhouse: false },
          })
        }
        onLocalAtomic={() =>
          setScreen({
            name: 'timeControlSelect',
            mode: { kind: 'local', chess960: false, kingOfTheHill: false, threeCheck: false, setupChess: false, fogOfWar: false, giveaway: false, atomic: true, duckChess: false, spellChess: false, horde: false, crazyhouse: false },
          })
        }
        onLocalDuckChess={() =>
          setScreen({
            name: 'timeControlSelect',
            mode: { kind: 'local', chess960: false, kingOfTheHill: false, threeCheck: false, setupChess: false, fogOfWar: false, giveaway: false, atomic: false, duckChess: true, spellChess: false, horde: false, crazyhouse: false },
          })
        }
        onLocalSpellChess={() =>
          setScreen({
            name: 'timeControlSelect',
            mode: { kind: 'local', chess960: false, kingOfTheHill: false, threeCheck: false, setupChess: false, fogOfWar: false, giveaway: false, atomic: false, duckChess: false, spellChess: true, horde: false, crazyhouse: false },
          })
        }
        onLocalHorde={() =>
          setScreen({
            name: 'timeControlSelect',
            mode: { kind: 'local', chess960: false, kingOfTheHill: false, threeCheck: false, setupChess: false, fogOfWar: false, giveaway: false, atomic: false, duckChess: false, spellChess: false, horde: true, crazyhouse: false },
          })
        }
        onLocalCrazyhouse={() =>
          setScreen({
            name: 'timeControlSelect',
            mode: { kind: 'local', chess960: false, kingOfTheHill: false, threeCheck: false, setupChess: false, fogOfWar: false, giveaway: false, atomic: false, duckChess: false, spellChess: false, horde: false, crazyhouse: true },
          })
        }
        onFourPlayer={() => setScreen({ name: 'fourPlayerSetup', variant: 'ffa', seats: defaultSeatConfig() })}
        onEngineVsEngineClassic={() =>
          setScreen({
            name: 'timeControlSelect',
            mode: { kind: 'engineVsEngine', chess960: false, kingOfTheHill: false, threeCheck: false, setupChess: false },
          })
        }
        onEngineVsEngineChess960={() =>
          setScreen({
            name: 'timeControlSelect',
            mode: { kind: 'engineVsEngine', chess960: true, kingOfTheHill: false, threeCheck: false, setupChess: false },
          })
        }
        onEngineVsEngineKingOfTheHill={() =>
          setScreen({
            name: 'timeControlSelect',
            mode: { kind: 'engineVsEngine', chess960: false, kingOfTheHill: true, threeCheck: false, setupChess: false },
          })
        }
        onEngineVsEngineThreeCheck={() =>
          setScreen({
            name: 'timeControlSelect',
            mode: { kind: 'engineVsEngine', chess960: false, kingOfTheHill: false, threeCheck: true, setupChess: false },
          })
        }
        onBoardEditor={() => setScreen({ name: 'boardSetup' })}
        onImportPgn={() => setScreen({ name: 'pgnImport' })}
        authUser={authSession?.user ?? null}
        onAuthPress={() => setScreen({ name: 'login' })}
      />
    );
  } else if (screen.name === 'onlineTimeControlSelect') {
    const { token } = screen;
    content = (
      <OnlineTimeControlSelectScreen
        onSelect={(timeControl, variant) => setScreen({ name: 'matchmaking', token, timeControl, variant })}
        onBack={() => setScreen({ name: 'playModeSelect' })}
      />
    );
  } else if (screen.name === 'matchmaking') {
    const { token } = screen;
    content = (
      <MatchmakingScreen
        authToken={token}
        timeControl={screen.timeControl}
        variant={screen.variant}
        onMatchFound={(match) => setScreen({ name: 'onlineGame', token, match })}
        onSetupChessPaired={(paired) => setScreen({ name: 'setupChessOnline', token, pairingId: paired.pairingId, color: paired.color })}
        onCancel={() => setScreen({ name: 'main' })}
      />
    );
  } else if (screen.name === 'setupChessOnline') {
    const { token, pairingId, color } = screen;
    content = (
      <SetupChessOnlineScreen
        authToken={token}
        pairingId={pairingId}
        color={color}
        onMatchFound={(match) => setScreen({ name: 'onlineGame', token, match })}
        onCancel={() => setScreen({ name: 'main' })}
      />
    );
  } else if (screen.name === 'onlineGame') {
    const { token, returnToTournamentId } = screen;
    content = (
      <OnlineGameScreen
        authToken={token}
        match={screen.match}
        keepSocketAlive={!!returnToTournamentId}
        resume={screen.resume}
        onGameEnded={() => void clearActiveGame()}
        onExit={() => {
          void clearActiveGame(); // leaving is a decision: the seat is not kept
          setScreen(returnToTournamentId ? { name: 'tournamentStandings', token, tournamentId: returnToTournamentId } : { name: 'main' });
        }}
        onAnalyze={(params) => setScreen({ name: 'analysis', params })}
      />
    );
  } else if (screen.name === 'tournament') {
    content = (
      <TournamentScreen
        authToken={screen.token}
        authUser={authSession!.user}
        onEnterStandings={(tournamentId) => setScreen({ name: 'tournamentStandings', token: screen.token, tournamentId })}
        onBack={() => setScreen({ name: 'playModeSelect' })}
      />
    );
  } else if (screen.name === 'tournamentStandings') {
    const { token, tournamentId } = screen;
    content = (
      <TournamentStandingsScreen
        authToken={token}
        authUser={authSession!.user}
        tournamentId={tournamentId}
        onEnterGame={(match) => setScreen({ name: 'onlineGame', token, match, returnToTournamentId: tournamentId })}
        onExit={() => setScreen({ name: 'main' })}
      />
    );
  } else if (screen.name === 'challenge') {
    const { token } = screen;
    content = (
      <ChallengeScreen
        authToken={token}
        onMatchFound={(match) => setScreen({ name: 'onlineGame', token, match })}
        onSetupChessPaired={(paired) => setScreen({ name: 'setupChessOnline', token, pairingId: paired.pairingId, color: paired.color })}
        onBack={() => setScreen({ name: 'playModeSelect' })}
      />
    );
  } else if (screen.name === 'spectateList') {
    const { token } = screen;
    content = (
      <SpectateListScreen
        authToken={token}
        onWatch={(game: ActiveGameSummary) =>
          setScreen({
            name: 'spectatorGame',
            token,
            roomId: game.roomId,
            whiteUsername: game.whiteUsername,
            blackUsername: game.blackUsername,
          })
        }
        onWatchFour={(game) => setScreen({ name: 'fourPlayerSpectate', token, roomId: game.roomId })}
        onBack={() => setScreen({ name: 'playModeSelect' })}
      />
    );
  } else if (screen.name === 'fourPlayerSpectate') {
    content = <FourPlayerSpectatorScreen authToken={screen.token} roomId={screen.roomId} onExit={() => setScreen({ name: 'spectateList', token: screen.token })} />;
  } else if (screen.name === 'spectatorGame') {
    content = (
      <SpectatorGameScreen
        authToken={screen.token}
        roomId={screen.roomId}
        whiteUsername={screen.whiteUsername}
        blackUsername={screen.blackUsername}
        onExit={() => setScreen({ name: 'spectateList', token: screen.token })}
      />
    );
  } else if (screen.name === 'login') {
    content = (
      <LoginScreen
        onSuccess={(session) => {
          setAuthSession(session);
          setScreen({ name: 'main' });
        }}
        onSwitchToRegister={() => setScreen({ name: 'register' })}
        onBack={() => setScreen({ name: 'main' })}
      />
    );
  } else if (screen.name === 'register') {
    content = (
      <RegisterScreen
        onSuccess={(session) => {
          setAuthSession(session);
          setScreen({ name: 'main' });
        }}
        onSwitchToLogin={() => setScreen({ name: 'login' })}
        onBack={() => setScreen({ name: 'main' })}
      />
    );
  } else if (screen.name === 'botSelect') {
    const { chess960, kingOfTheHill, threeCheck, setupChess, fogOfWar, giveaway, atomic, duckChess, spellChess, horde, crazyhouse } = screen;
    content = (
      <BotSelectScreen
        chess960={chess960}
        kingOfTheHill={kingOfTheHill}
        threeCheck={threeCheck}
        setupChess={setupChess}
        fogOfWar={fogOfWar}
        giveaway={giveaway}
        atomic={atomic}
        duckChess={duckChess}
        spellChess={spellChess}
        horde={horde}
        crazyhouse={crazyhouse}
        onSelect={(bot) =>
          setScreen({
            name: 'timeControlSelect',
            mode: { kind: 'bot', bot, chess960, kingOfTheHill, threeCheck, setupChess, fogOfWar, giveaway, atomic, duckChess, spellChess, horde, crazyhouse },
          })
        }
        onBack={() => setScreen({ name: 'playModeSelect' })}
      />
    );
  } else if (screen.name === 'timeControlSelect') {
    const { mode } = screen;
    const variantLabel = mode.chess960
      ? 'Chess960'
      : mode.kingOfTheHill
        ? 'King of the Hill'
        : mode.threeCheck
          ? 'Three-Check'
          : mode.setupChess
            ? 'Setup Chess'
            : mode.kind !== 'engineVsEngine' && mode.fogOfWar
              ? 'Fog of War'
              : mode.kind !== 'engineVsEngine' && mode.giveaway
                ? 'Giveaway'
                : mode.kind !== 'engineVsEngine' && mode.atomic
                  ? 'Atomic'
                  : mode.kind !== 'engineVsEngine' && mode.duckChess
                    ? 'Duck Chess'
                    : mode.kind !== 'engineVsEngine' && mode.spellChess
                      ? 'Spell Chess'
                      : mode.kind !== 'engineVsEngine' && mode.horde
                        ? 'Horde'
                        : mode.kind !== 'engineVsEngine' && mode.crazyhouse
                          ? 'Crazyhouse'
                          : undefined;
    const subtitle =
      mode.kind === 'bot'
        ? variantLabel
          ? `${mode.bot.name} · ${variantLabel}`
          : mode.bot.name
        : mode.kind === 'engineVsEngine'
          ? variantLabel
            ? `Engine vs Engine · ${variantLabel}`
            : 'Engine vs Engine'
          : variantLabel;
    content = (
      <TimeControlSelectScreen
        subtitle={subtitle}
        showColorPicker={mode.kind === 'bot'}
        onSelect={(timeControl, colorChoice) => {
          // Setup Chess needs the army-builder flow before a game screen can start at all — see
          // LocalSetupChessFlowScreen/BotSetupChessFlowScreen, both of which end by producing an
          // initialFen and handing off to the same 'game'/'botGame' screens every other variant
          // already uses.
          if (mode.setupChess && mode.kind === 'local') {
            setScreen({ name: 'localSetupChessFlow', timeControl });
            return;
          }
          if (mode.setupChess && mode.kind === 'bot') {
            setScreen({ name: 'botSetupChessFlow', timeControl, bot: mode.bot, colorChoice: colorChoice ?? 'random' });
            return;
          }
          setScreen(
            mode.kind === 'local'
              ? {
                  name: 'game',
                  timeControl,
                  chess960: mode.chess960,
                  kingOfTheHill: mode.kingOfTheHill,
                  threeCheck: mode.threeCheck,
                  setupChess: false,
                  fogOfWar: mode.fogOfWar,
                  giveaway: mode.giveaway,
                  atomic: mode.atomic,
                  duckChess: mode.duckChess,
                  spellChess: mode.spellChess,
                  horde: mode.horde,
                  crazyhouse: mode.crazyhouse,
                }
              : mode.kind === 'bot'
                ? {
                    name: 'botGame',
                    timeControl,
                    bot: mode.bot,
                    chess960: mode.chess960,
                    kingOfTheHill: mode.kingOfTheHill,
                    threeCheck: mode.threeCheck,
                    setupChess: false,
                    fogOfWar: mode.fogOfWar,
                    giveaway: mode.giveaway,
                  atomic: mode.atomic,
                  duckChess: mode.duckChess,
                  spellChess: mode.spellChess,
                  horde: mode.horde,
                  crazyhouse: mode.crazyhouse,
                    colorChoice: colorChoice ?? 'random',
                  }
                : {
                    name: 'engineVsEngineSetup',
                    timeControl,
                    chess960: mode.chess960,
                    kingOfTheHill: mode.kingOfTheHill,
                    threeCheck: mode.threeCheck,
                    engine1: null,
                    engine2: null,
                    color1: 'random',
                    color2: 'random',
                  }
          );
        }}
        onBack={() =>
          setScreen(
            mode.kind === 'bot'
              ? {
                  name: 'botSelect',
                  chess960: mode.chess960,
                  kingOfTheHill: mode.kingOfTheHill,
                  threeCheck: mode.threeCheck,
                  setupChess: mode.setupChess,
                  fogOfWar: mode.fogOfWar,
                  giveaway: mode.giveaway,
                  atomic: mode.atomic,
                  duckChess: mode.duckChess,
                  spellChess: mode.spellChess,
                  horde: mode.horde,
                  crazyhouse: mode.crazyhouse,
                }
              : { name: 'playModeSelect' }
          )
        }
      />
    );
  } else if (screen.name === 'analysis') {
    content = <AnalysisScreen {...screen.params} onExit={() => setScreen({ name: 'main' })} />;
  } else if (screen.name === 'boardSetup') {
    content = (
      <BoardSetupScreen
        onBack={() => setScreen({ name: 'playModeSelect' })}
        onAnalyze={(params) => setScreen({ name: 'analysis', params })}
      />
    );
  } else if (screen.name === 'pgnImport') {
    content = (
      <PgnImportScreen
        onBack={() => setScreen({ name: 'playModeSelect' })}
        onAnalyze={(params) => setScreen({ name: 'analysis', params })}
      />
    );
  } else if (screen.name === 'fourPlayerSetup') {
    const { variant, seats } = screen;
    content = (
      <FourPlayerSetupScreen
        variant={variant}
        seats={seats}
        onChange={(next) => setScreen({ name: 'fourPlayerSetup', variant, seats: next })}
        onPickBot={(seat) => setScreen({ name: 'fourPlayerBotSelect', variant, seats, seat })}
        onContinue={() => setScreen({ name: 'fourPlayerTimeControl', variant, seats })}
        onBack={() => setScreen({ name: 'playModeSelect' })}
      />
    );
  } else if (screen.name === 'fourPlayerBotSelect') {
    const { variant, seats, seat } = screen;
    content = (
      <BotSelectScreen
        subtitle={`${variantTitle(variant)} · ${SEAT_NAMES[seat]}`}
        engineLabel={`${variantTitle(variant)} bot`}
        onSelect={(bot) => setScreen({ name: 'fourPlayerSetup', variant, seats: withController(seats, seat, controllerForBot(bot)) })}
        onBack={() => setScreen({ name: 'fourPlayerSetup', variant, seats })}
      />
    );
  } else if (screen.name === 'fourPlayerTimeControl') {
    const { variant, seats } = screen;
    content = (
      <TimeControlSelectScreen
        subtitle={`${variantTitle(variant)} · ${variantModeLabel(variant)}`}
        excludeCategories={['daily']}
        onSelect={(timeControl) => setScreen({ name: 'fourPlayerGame', variant, seats, timeControl })}
        onBack={() => setScreen({ name: 'fourPlayerSetup', variant, seats })}
      />
    );
  } else if (screen.name === 'fourPlayerGame') {
    content = <FourPlayerGameScreen variant={screen.variant} seats={screen.seats} timeControl={screen.timeControl} onExit={() => setScreen({ name: 'playModeSelect' })} />;
  } else if (screen.name === 'fourPlayerOnlineTimeControl') {
    const { variant, token } = screen;
    content = (
      <TimeControlSelectScreen
        subtitle={`${variantTitle(variant)} · Online`}
        excludeCategories={['daily', 'unlimited']}
        onSelect={(timeControl) => setScreen({ name: 'fourPlayerMatchmaking', variant, token, timeControl })}
        onBack={() => setScreen({ name: 'playModeSelect' })}
      />
    );
  } else if (screen.name === 'fourPlayerMatchmaking') {
    const { variant, token, timeControl } = screen;
    content = (
      <FourPlayerMatchmakingScreen
        variant={variant}
        authToken={token}
        timeControl={timeControl}
        onMatchFound={(match) => {
          setFourResume(null);
          setScreen({ name: 'fourPlayerOnlineGame', token, match, timeControl, resume: false });
        }}
        onCancel={() => setScreen({ name: 'playModeSelect' })}
      />
    );
  } else if (screen.name === 'fourPlayerOnlineGame') {
    const { token, match, timeControl, resume } = screen;
    content = (
      <FourPlayerOnlineGameScreen
        key={match.roomId}
        authToken={token}
        match={match}
        resume={resume}
        onGameEnded={() => void clearActiveGame()}
        onExit={(resumable) => {
          if (!resumable) void clearActiveGame();
          setFourResume(resumable ? { token, match, timeControl } : null);
          setScreen({ name: 'playModeSelect' });
        }}
        onPlayAgain={() => {
          void clearActiveGame();
          setFourResume(null);
          setScreen({ name: 'fourPlayerMatchmaking', variant: fourVariantOf(match), token, timeControl }); // the same game again
        }}
      />
    );
  } else if (screen.name === 'engineSelect') {
    content = <EngineSelectScreen onBack={() => setScreen({ name: 'main' })} />;
  } else if (screen.name === 'themeSelect') {
    content = <ThemeSelectScreen onBack={() => setScreen({ name: 'main' })} />;
  } else if (screen.name === 'streak') {
    content = <StreakScreen onBack={() => setScreen({ name: 'main' })} />;
  } else if (screen.name === 'puzzleRush') {
    content = <PuzzleRushScreen onExit={() => setScreen({ name: 'main' })} themeFilter={screen.themeFilter} />;
  } else if (screen.name === 'puzzleTraining') {
    content = (
      <PuzzleTrainingScreen
        onBack={() => setScreen({ name: 'main' })}
        onStart={(themes) => setScreen({ name: 'puzzleRush', themeFilter: themes })}
      />
    );
  } else if (screen.name === 'achievements') {
    content = <AchievementsScreen onBack={() => setScreen({ name: 'main' })} />;
  } else if (screen.name === 'leaderboard') {
    content = <LeaderboardScreen authToken={screen.token} onBack={() => setScreen({ name: 'main' })} />;
  } else if (screen.name === 'ratingHistory') {
    content = <RatingHistoryScreen onBack={() => setScreen({ name: 'main' })} />;
  } else if (screen.name === 'diagnosticLogs') {
    content = <DiagnosticLogsScreen onBack={() => setScreen({ name: 'main' })} />;
  } else if (screen.name === 'engineVsEngineSetup') {
    content = (
      <EngineVsEngineSetupScreen
        engine1={screen.engine1}
        engine2={screen.engine2}
        color1={screen.color1}
        color2={screen.color2}
        onPickEngine1={() => setScreen({ ...screen, name: 'engineVsEngineBotSelect', slot: 1 })}
        onPickEngine2={() => setScreen({ ...screen, name: 'engineVsEngineBotSelect', slot: 2 })}
        onChangeColor1={(color1) => setScreen({ ...screen, color1 })}
        onChangeColor2={(color2) => setScreen({ ...screen, color2 })}
        onStart={() => {
          if (!screen.engine1 || !screen.engine2) return;
          setScreen({
            name: 'engineVsEngineGame',
            timeControl: screen.timeControl,
            chess960: screen.chess960,
            kingOfTheHill: screen.kingOfTheHill,
            threeCheck: screen.threeCheck,
            engine1: screen.engine1,
            engine2: screen.engine2,
            color1: screen.color1,
            color2: screen.color2,
          });
        }}
        onBack={() => setScreen({ name: 'playModeSelect' })}
      />
    );
  } else if (screen.name === 'engineVsEngineBotSelect') {
    content = (
      <BotSelectScreen
        chess960={screen.chess960}
        kingOfTheHill={screen.kingOfTheHill}
        threeCheck={screen.threeCheck}
        onBack={() => setScreen({ ...screen, name: 'engineVsEngineSetup' })}
        onSelect={(bot) =>
          setScreen({
            ...screen,
            name: 'engineVsEngineSetup',
            engine1: screen.slot === 1 ? bot : screen.engine1,
            engine2: screen.slot === 2 ? bot : screen.engine2,
          })
        }
      />
    );
  } else if (screen.name === 'engineVsEngineGame') {
    content = (
      <EngineVsEngineGameScreen
        timeControl={screen.timeControl}
        chess960={screen.chess960}
        kingOfTheHill={screen.kingOfTheHill}
        threeCheck={screen.threeCheck}
        engine1={screen.engine1}
        engine2={screen.engine2}
        colorChoice1={screen.color1}
        colorChoice2={screen.color2}
        onExit={() => setScreen({ name: 'main' })}
        onAnalyze={(params) => setScreen({ name: 'analysis', params })}
      />
    );
  } else if (screen.name === 'botGame') {
    content = (
      <BotGameScreen
        bot={screen.bot}
        timeControl={screen.timeControl}
        chess960={screen.chess960}
        kingOfTheHill={screen.kingOfTheHill}
        threeCheck={screen.threeCheck}
        setupChess={screen.setupChess}
        fogOfWar={screen.fogOfWar}
        giveaway={screen.giveaway}
        atomic={screen.atomic}
        duckChess={screen.duckChess}
        spellChess={screen.spellChess}
        horde={screen.horde}
        crazyhouse={screen.crazyhouse}
        initialFen={screen.initialFen}
        colorChoice={screen.colorChoice}
        authToken={authSession?.token ?? null}
        onExit={() => setScreen({ name: 'main' })}
        onAnalyze={(params) => setScreen({ name: 'analysis', params })}
      />
    );
  } else if (screen.name === 'localSetupChessFlow') {
    const { timeControl } = screen;
    content = (
      <LocalSetupChessFlowScreen
        onDone={(initialFen) =>
          setScreen({
            name: 'game',
            timeControl,
            chess960: false,
            kingOfTheHill: false,
            threeCheck: false,
            setupChess: true,
            fogOfWar: false,
            giveaway: false, atomic: false, duckChess: false, spellChess: false, horde: false, crazyhouse: false,
            initialFen,
          })
        }
        onBack={() => setScreen({ name: 'playModeSelect' })}
      />
    );
  } else if (screen.name === 'botSetupChessFlow') {
    const { timeControl, bot, colorChoice } = screen;
    content = (
      <BotSetupChessFlowScreen
        botName={bot.name}
        colorChoice={colorChoice}
        onDone={(initialFen, color) =>
          setScreen({
            name: 'botGame',
            timeControl,
            bot,
            chess960: false,
            kingOfTheHill: false,
            threeCheck: false,
            setupChess: true,
            fogOfWar: false,
            giveaway: false, atomic: false, duckChess: false, spellChess: false, horde: false, crazyhouse: false,
            initialFen,
            colorChoice: color,
          })
        }
        onBack={() => setScreen({ name: 'playModeSelect' })}
      />
    );
  } else {
    content = (
      <LocalGameScreen
        timeControl={screen.timeControl}
        chess960={screen.chess960}
        kingOfTheHill={screen.kingOfTheHill}
        threeCheck={screen.threeCheck}
        setupChess={screen.setupChess}
        fogOfWar={screen.fogOfWar}
        giveaway={screen.giveaway}
        atomic={screen.atomic}
        duckChess={screen.duckChess}
        spellChess={screen.spellChess}
        horde={screen.horde}
        crazyhouse={screen.crazyhouse}
        initialFen={screen.initialFen}
        authToken={authSession?.token ?? null}
        onExit={() => setScreen({ name: 'main' })}
        onAnalyze={(params) => setScreen({ name: 'analysis', params })}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <SideInsetsFrame
        bottom={screen.name !== 'main'}
        style={{ flex: 1, backgroundColor: colors.background }}
        // Observes every touch start without claiming it (returns false), so Resign/Hint/Undo, scroll
        // views etc. behave exactly as before — see src/logic/screenTouches.ts.
        onStartShouldSetResponderCapture={(e) => {
          notifyScreenTouch(e.nativeEvent.pageX, e.nativeEvent.pageY);
          return false;
        }}
      >
        {content}
      </SideInsetsFrame>
      <AppAlertHost />
      <StatusBar style={colors.mode === 'dark' ? 'light' : 'dark'} />
    </SafeAreaProvider>
  );
}
