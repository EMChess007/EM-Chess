import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import FourPlayerBoard from '../components/FourPlayerBoard';
import FourPlayerChatPanel from '../components/FourPlayerChatPanel';
import FourPlayerResultCard from '../components/FourPlayerResultCard';
import FourPlayerSeatStrip from '../components/FourPlayerSeatStrip';
import GameControlBar from '../components/GameControlBar';
import GameScreenBody from '../components/GameScreenBody';
import ScreenHeader from '../components/ScreenHeader';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { SEAT_COLORS, nextSeat, type Move, type Seat } from '../logic/fourPlayer';
import { displayClock } from '../logic/fourPlayerOnline';
import { describeStatus, seatLabels } from '../logic/fourPlayerOnlineUi';
import { useFourPlayerOnlineGame } from '../logic/useFourPlayerOnlineGame';

// A stable, module-level reference: the board is read-only here (a spectator owns no seat), so a move handler would never be called.
const noopMove = (_move: Move) => {};

interface FourPlayerSpectatorScreenProps {
  /** Spectating needs no account: null for a guest. */
  authToken: string | null;
  roomId: string;
  onExit: () => void;
}

/**
 * Watching a live online 4 Player game (FOUR_PLAYER_ONLINE_SPEC.md §4.5, §8). There is no hidden information, so a spectator sees the
 * whole position, every clock and every seat's connection state, can turn the board (Rotate), and can read the table's chat but not
 * write in it. All of it comes from the same hook and reducer as a seated player's screen, with no seat (`mySeat` null): nothing here
 * can send a move.
 */
export default function FourPlayerSpectatorScreen({ authToken, roomId, onExit }: FourPlayerSpectatorScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const { view, connection, problem, chat, chatUnread, now, markChatRead } = useFourPlayerOnlineGame(authToken, { kind: 'spectator', roomId });
  const [viewSeat, setViewSeat] = useState<Seat>(0);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    if (chatOpen) markChatRead();
  }, [chatOpen, chat.length, markChatRead]);

  if (!view) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Spectating" onBack={onExit} backLabel="‹ Back" />
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
      </View>
    );
  }

  const recent = view.log.slice(-4);
  return (
    <View style={styles.container}>
      <ScreenHeader title="Spectating" subtitle={`4 Player Chess · ${view.timeControlLabel}`} onBack={onExit} backLabel="‹ Back" />
      <GameScreenBody
        bottomBar={
          <View style={styles.controlsWrap}>
            <GameControlBar
              items={[
                { key: 'rotate', label: 'Rotate', onPress: () => setViewSeat((v) => nextSeat(v)) },
                { key: 'chat', label: chatUnread > 0 ? `Chat (${chatUnread})` : 'Chat', onPress: () => setChatOpen((open) => !open), active: chatOpen },
              ]}
            />
          </View>
        }
      >
        <FourPlayerSeatStrip state={view.state} clock={displayClock(view, now)} labels={seatLabels(view, now)} />
        <Text style={[styles.status, { color: view.gameOver ? colors.gold : colors.text }]}>{describeStatus(view)}</Text>
        {connection === 'reconnecting' && <Text style={styles.warning}>Connection lost — trying to reconnect...</Text>}
        {connection === 'unavailable' && <Text style={styles.problem}>{problem ?? 'This game is no longer available.'}</Text>}

        <FourPlayerBoard state={view.state} viewSeat={viewSeat} interactive={false} lastMove={view.lastMove} onMove={noopMove} enableAnnotations />

        {recent.length > 0 && (
          <Text style={styles.recent} numberOfLines={1}>
            {recent.map((entry, i) => (
              <Text key={view.log.length - recent.length + i} style={{ color: SEAT_COLORS[entry.seat], fontWeight: '700' }}>
                {i > 0 ? '   ' : ''}
                {entry.text}
              </Text>
            ))}
          </Text>
        )}

        {chatOpen && <FourPlayerChatPanel messages={chat} />}
        {view.gameOver && <FourPlayerResultCard gameOver={view.gameOver} seats={view.seats} />}
      </GameScreenBody>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    controlsWrap: { position: 'relative' },
    status: { fontSize: 15, fontWeight: '600' },
    warning: { fontSize: 13, color: colors.mode === 'dark' ? '#e0c34a' : '#8d6e00', textAlign: 'center' },
    problem: { fontSize: 14, color: colors.danger, textAlign: 'center', paddingHorizontal: 24, marginTop: 12 },
    recent: { fontSize: 12, textAlign: 'center', paddingHorizontal: 8 },
  });
}
