import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { clearAuthSession, loadAuthSession, type AuthSession } from './src/api/authStorage';
import AppAlertHost from './src/components/AppAlert';
import BottomTabBar, { type MainTab } from './src/components/BottomTabBar';
import AnalysisScreen from './src/screens/AnalysisScreen';
import BotGameScreen from './src/screens/BotGameScreen';
import BotSelectScreen from './src/screens/BotSelectScreen';
import DailyPuzzleScreen from './src/screens/DailyPuzzleScreen';
import EngineSelectScreen from './src/screens/EngineSelectScreen';
import GameHistoryScreen from './src/screens/GameHistoryScreen';
import HomeScreen from './src/screens/HomeScreen';
import LocalGameScreen from './src/screens/LocalGameScreen';
import LoginScreen from './src/screens/LoginScreen';
import MatchmakingScreen from './src/screens/MatchmakingScreen';
import MoreScreen from './src/screens/MoreScreen';
import OnlineGameScreen from './src/screens/OnlineGameScreen';
import OnlineTimeControlSelectScreen from './src/screens/OnlineTimeControlSelectScreen';
import PlayModeSelectScreen from './src/screens/PlayModeSelectScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import TimeControlSelectScreen from './src/screens/TimeControlSelectScreen';
import { restoreCustomEngines } from './src/logic/customEngines';
import type { BotPersonality } from './src/types/bot';
import type { AnalyzeParams } from './src/types/history';
import type { MatchFoundPayload } from './src/types/multiplayer';
import type { TimeControl } from './src/types/timeControl';

type TimeControlFlowMode =
  | { kind: 'local'; chess960: boolean }
  | { kind: 'bot'; bot: BotPersonality; chess960: boolean };

type Screen =
  | { name: 'main' }
  | { name: 'playModeSelect' }
  | { name: 'botSelect'; chess960: boolean }
  | { name: 'timeControlSelect'; mode: TimeControlFlowMode }
  | { name: 'game'; timeControl: TimeControl; chess960: boolean }
  | { name: 'botGame'; timeControl: TimeControl; bot: BotPersonality; chess960: boolean }
  | { name: 'analysis'; params: AnalyzeParams }
  | { name: 'login' }
  | { name: 'register' }
  | { name: 'onlineTimeControlSelect'; token: string }
  | { name: 'matchmaking'; token: string; timeControl: TimeControl; chess960: boolean }
  | { name: 'onlineGame'; token: string; match: MatchFoundPayload }
  | { name: 'engineSelect' };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'main' });
  const [activeTab, setActiveTab] = useState<MainTab>('home');
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);

  useEffect(() => {
    loadAuthSession().then(setAuthSession);
    restoreCustomEngines();
  }, []);

  const handleLogout = () => {
    clearAuthSession();
    setAuthSession(null);
  };

  let content;
  if (screen.name === 'main') {
    let tabContent;
    if (activeTab === 'home') {
      tabContent = (
        <HomeScreen
          onPlay={() => setScreen({ name: 'playModeSelect' })}
          onOpenPuzzles={() => setActiveTab('puzzles')}
          onOpenAnalysis={() => setActiveTab('analysis')}
          onAnalyzeGame={(params) => setScreen({ name: 'analysis', params })}
          authToken={authSession?.token ?? null}
        />
      );
    } else if (activeTab === 'puzzles') {
      tabContent = <DailyPuzzleScreen authToken={authSession?.token ?? null} />;
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
        onBotClassic={() => setScreen({ name: 'botSelect', chess960: false })}
        onBotChess960={() => setScreen({ name: 'botSelect', chess960: true })}
        onLocalClassic={() => setScreen({ name: 'timeControlSelect', mode: { kind: 'local', chess960: false } })}
        onLocalChess960={() => setScreen({ name: 'timeControlSelect', mode: { kind: 'local', chess960: true } })}
        authUser={authSession?.user ?? null}
        onAuthPress={() => setScreen({ name: 'login' })}
      />
    );
  } else if (screen.name === 'onlineTimeControlSelect') {
    const { token } = screen;
    content = (
      <OnlineTimeControlSelectScreen
        onSelect={(timeControl, chess960) => setScreen({ name: 'matchmaking', token, timeControl, chess960 })}
        onBack={() => setScreen({ name: 'playModeSelect' })}
      />
    );
  } else if (screen.name === 'matchmaking') {
    content = (
      <MatchmakingScreen
        authToken={screen.token}
        timeControl={screen.timeControl}
        chess960={screen.chess960}
        onMatchFound={(match) => setScreen({ name: 'onlineGame', token: screen.token, match })}
        onCancel={() => setScreen({ name: 'main' })}
      />
    );
  } else if (screen.name === 'onlineGame') {
    content = (
      <OnlineGameScreen authToken={screen.token} match={screen.match} onExit={() => setScreen({ name: 'main' })} />
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
    const { chess960 } = screen;
    content = (
      <BotSelectScreen
        chess960={chess960}
        onSelect={(bot) => setScreen({ name: 'timeControlSelect', mode: { kind: 'bot', bot, chess960 } })}
        onBack={() => setScreen({ name: 'playModeSelect' })}
      />
    );
  } else if (screen.name === 'timeControlSelect') {
    const { mode } = screen;
    const subtitle =
      mode.kind === 'local'
        ? mode.chess960
          ? 'Chess960'
          : undefined
        : mode.chess960
          ? `${mode.bot.name} · Chess960`
          : mode.bot.name;
    content = (
      <TimeControlSelectScreen
        subtitle={subtitle}
        onSelect={(timeControl) =>
          setScreen(
            mode.kind === 'local'
              ? { name: 'game', timeControl, chess960: mode.chess960 }
              : { name: 'botGame', timeControl, bot: mode.bot, chess960: mode.chess960 }
          )
        }
        onBack={() =>
          setScreen(mode.kind === 'bot' ? { name: 'botSelect', chess960: mode.chess960 } : { name: 'playModeSelect' })
        }
      />
    );
  } else if (screen.name === 'analysis') {
    content = <AnalysisScreen {...screen.params} onExit={() => setScreen({ name: 'main' })} />;
  } else if (screen.name === 'engineSelect') {
    content = <EngineSelectScreen onBack={() => setScreen({ name: 'main' })} />;
  } else if (screen.name === 'botGame') {
    content = (
      <BotGameScreen
        bot={screen.bot}
        timeControl={screen.timeControl}
        chess960={screen.chess960}
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
        authToken={authSession?.token ?? null}
        onExit={() => setScreen({ name: 'main' })}
        onAnalyze={(params) => setScreen({ name: 'analysis', params })}
      />
    );
  }

  return (
    <SafeAreaProvider>
      {content}
      <AppAlertHost />
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
