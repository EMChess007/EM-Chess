import { useEffect, useState } from 'react';
import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import { AppState, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setSessionExpiredHandler } from './src/api/client';
import { clearAuthSession, loadAuthSession, type AuthSession } from './src/api/authStorage';
import AppAlertHost, { appAlert } from './src/components/AppAlert';
import BottomTabBar, { type MainTab } from './src/components/BottomTabBar';
import AchievementsScreen from './src/screens/AchievementsScreen';
import AnalysisScreen from './src/screens/AnalysisScreen';
import BoardSetupScreen from './src/screens/BoardSetupScreen';
import BotGameScreen from './src/screens/BotGameScreen';
import BotSelectScreen from './src/screens/BotSelectScreen';
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
import TournamentScreen from './src/screens/TournamentScreen';
import TournamentStandingsScreen from './src/screens/TournamentStandingsScreen';
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
import type { ColorChoice } from './src/types/chess';
import type { AnalyzeParams } from './src/types/history';
import type { ActiveGameSummary, MatchFoundPayload } from './src/types/multiplayer';
import type { TimeControl } from './src/types/timeControl';

type TimeControlFlowMode =
  | { kind: 'local'; chess960: boolean; kingOfTheHill: boolean; threeCheck: boolean }
  | { kind: 'bot'; bot: BotPersonality; chess960: boolean; kingOfTheHill: boolean; threeCheck: boolean }
  | { kind: 'engineVsEngine'; chess960: boolean; kingOfTheHill: boolean; threeCheck: boolean };

type Screen =
  | { name: 'main' }
  | { name: 'playModeSelect' }
  | { name: 'botSelect'; chess960: boolean; kingOfTheHill: boolean; threeCheck: boolean }
  | { name: 'timeControlSelect'; mode: TimeControlFlowMode }
  | { name: 'game'; timeControl: TimeControl; chess960: boolean; kingOfTheHill: boolean; threeCheck: boolean }
  | {
      name: 'botGame';
      timeControl: TimeControl;
      bot: BotPersonality;
      chess960: boolean;
      kingOfTheHill: boolean;
      threeCheck: boolean;
      colorChoice: ColorChoice;
    }
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
      chess960: boolean;
      kingOfTheHill: boolean;
      threeCheck: boolean;
    }
  | { name: 'challenge'; token: string }
  | { name: 'spectateList'; token: string | null }
  | { name: 'spectatorGame'; token: string | null; roomId: string; whiteUsername: string; blackUsername: string }
  | { name: 'onlineGame'; token: string; match: MatchFoundPayload; returnToTournamentId?: string }
  | { name: 'tournament'; token: string }
  | { name: 'tournamentStandings'; token: string; tournamentId: string }
  | { name: 'engineSelect' }
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
  // Gates the very first render on the persisted Dark/Light preference having actually loaded —
  // without this, every screen mounts once with useAppColors()'s synchronous default ('light',
  // see colorSchemeSettings.ts) and only corrects itself once restoreColorSchemeMode's AsyncStorage
  // read resolves and notifies subscribers. That's normally a same-frame correction, but showing
  // the wrong theme for even one frame is exactly the reported bug (dark-mode users seeing a
  // flash of light background at cold start) — so nothing renders until it's known for certain.
  const [themeReady, setThemeReady] = useState(false);

  const colors = useAppColors();

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

  const handleLogout = () => {
    clearAuthSession();
    setAuthSession(null);
  };

  if (!themeReady) {
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
        onBotClassic={() => setScreen({ name: 'botSelect', chess960: false, kingOfTheHill: false, threeCheck: false })}
        onBotChess960={() => setScreen({ name: 'botSelect', chess960: true, kingOfTheHill: false, threeCheck: false })}
        onBotKingOfTheHill={() => setScreen({ name: 'botSelect', chess960: false, kingOfTheHill: true, threeCheck: false })}
        onBotThreeCheck={() => setScreen({ name: 'botSelect', chess960: false, kingOfTheHill: false, threeCheck: true })}
        onLocalClassic={() =>
          setScreen({ name: 'timeControlSelect', mode: { kind: 'local', chess960: false, kingOfTheHill: false, threeCheck: false } })
        }
        onLocalChess960={() =>
          setScreen({ name: 'timeControlSelect', mode: { kind: 'local', chess960: true, kingOfTheHill: false, threeCheck: false } })
        }
        onLocalKingOfTheHill={() =>
          setScreen({ name: 'timeControlSelect', mode: { kind: 'local', chess960: false, kingOfTheHill: true, threeCheck: false } })
        }
        onLocalThreeCheck={() =>
          setScreen({ name: 'timeControlSelect', mode: { kind: 'local', chess960: false, kingOfTheHill: false, threeCheck: true } })
        }
        onEngineVsEngineClassic={() =>
          setScreen({
            name: 'timeControlSelect',
            mode: { kind: 'engineVsEngine', chess960: false, kingOfTheHill: false, threeCheck: false },
          })
        }
        onEngineVsEngineChess960={() =>
          setScreen({
            name: 'timeControlSelect',
            mode: { kind: 'engineVsEngine', chess960: true, kingOfTheHill: false, threeCheck: false },
          })
        }
        onEngineVsEngineKingOfTheHill={() =>
          setScreen({
            name: 'timeControlSelect',
            mode: { kind: 'engineVsEngine', chess960: false, kingOfTheHill: true, threeCheck: false },
          })
        }
        onEngineVsEngineThreeCheck={() =>
          setScreen({
            name: 'timeControlSelect',
            mode: { kind: 'engineVsEngine', chess960: false, kingOfTheHill: false, threeCheck: true },
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
        onSelect={(timeControl, chess960, kingOfTheHill, threeCheck) =>
          setScreen({ name: 'matchmaking', token, timeControl, chess960, kingOfTheHill, threeCheck })
        }
        onBack={() => setScreen({ name: 'playModeSelect' })}
      />
    );
  } else if (screen.name === 'matchmaking') {
    content = (
      <MatchmakingScreen
        authToken={screen.token}
        timeControl={screen.timeControl}
        chess960={screen.chess960}
        kingOfTheHill={screen.kingOfTheHill}
        threeCheck={screen.threeCheck}
        onMatchFound={(match) => setScreen({ name: 'onlineGame', token: screen.token, match })}
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
        onExit={() =>
          setScreen(returnToTournamentId ? { name: 'tournamentStandings', token, tournamentId: returnToTournamentId } : { name: 'main' })
        }
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
        onBack={() => setScreen({ name: 'playModeSelect' })}
      />
    );
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
    const { chess960, kingOfTheHill, threeCheck } = screen;
    content = (
      <BotSelectScreen
        chess960={chess960}
        kingOfTheHill={kingOfTheHill}
        threeCheck={threeCheck}
        onSelect={(bot) =>
          setScreen({ name: 'timeControlSelect', mode: { kind: 'bot', bot, chess960, kingOfTheHill, threeCheck } })
        }
        onBack={() => setScreen({ name: 'playModeSelect' })}
      />
    );
  } else if (screen.name === 'timeControlSelect') {
    const { mode } = screen;
    const variantLabel = mode.chess960 ? 'Chess960' : mode.kingOfTheHill ? 'King of the Hill' : mode.threeCheck ? 'Three-Check' : undefined;
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
        onSelect={(timeControl, colorChoice) =>
          setScreen(
            mode.kind === 'local'
              ? { name: 'game', timeControl, chess960: mode.chess960, kingOfTheHill: mode.kingOfTheHill, threeCheck: mode.threeCheck }
              : mode.kind === 'bot'
                ? {
                    name: 'botGame',
                    timeControl,
                    bot: mode.bot,
                    chess960: mode.chess960,
                    kingOfTheHill: mode.kingOfTheHill,
                    threeCheck: mode.threeCheck,
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
          )
        }
        onBack={() =>
          setScreen(
            mode.kind === 'bot'
              ? { name: 'botSelect', chess960: mode.chess960, kingOfTheHill: mode.kingOfTheHill, threeCheck: mode.threeCheck }
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
        colorChoice={screen.colorChoice}
        authToken={authSession?.token ?? null}
        onExit={() => setScreen({ name: 'main' })}
        onAnalyze={(params) => setScreen({ name: 'analysis', params })}
      />
    );
  } else {
    content = (
      <LocalGameScreen
        timeControl={screen.timeControl}
        chess960={screen.chess960}
        kingOfTheHill={screen.kingOfTheHill}
        threeCheck={screen.threeCheck}
        authToken={authSession?.token ?? null}
        onExit={() => setScreen({ name: 'main' })}
        onAnalyze={(params) => setScreen({ name: 'analysis', params })}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.background }}>{content}</View>
      <AppAlertHost />
      <StatusBar style={colors.mode === 'dark' ? 'light' : 'dark'} />
    </SafeAreaProvider>
  );
}
