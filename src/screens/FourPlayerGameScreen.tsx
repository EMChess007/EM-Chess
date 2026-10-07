import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { appAlert } from '../components/AppAlert';
import FourPlayerBoard from '../components/FourPlayerBoard';
import GameControlBar from '../components/GameControlBar';
import GameScreenBody from '../components/GameScreenBody';
import ScreenHeader from '../components/ScreenHeader';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import {
  SEAT_COLORS,
  SEAT_NAMES,
  chooseBotMove,
  defaultViewSeat,
  describeController,
  describeEvents,
  initialState,
  isInCheck,
  moveLabel,
  nextSeat,
  playMove,
  resign,
  shortController,
  type FourPlayerState,
  type Move,
  type Seat,
  type SeatConfig,
} from '../logic/fourPlayer';
import { triggerGameEndHaptics, triggerMoveHaptics } from '../logic/haptics';
import { playMoveSound } from '../logic/moveSounds';

interface FourPlayerGameScreenProps {
  seats: SeatConfig;
  onExit: () => void;
}

/** How long a bot "thinks" before its move lands, so a round of three bot moves is followable rather than instantaneous. */
const BOT_DELAY_MS = 450;

interface LogEntry {
  seat: Seat;
  text: string;
}

interface Snapshot {
  state: FourPlayerState;
  lastMove: { from: number; to: number } | null;
  log: LogEntry[];
}

/**
 * Local 4 Player Chess (Free-for-All): hotseat humans and/or bots, per the SeatConfig. The whole game is one immutable FourPlayerState
 * advanced with playMove (which also resolves eliminations and walks dead kings), so Undo is a stack of earlier states. Not saved to
 * history, not rated, no clocks in this first pass.
 */
export default function FourPlayerGameScreen({ seats, onExit }: FourPlayerGameScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [game, setGame] = useState<FourPlayerState>(() => initialState());
  const [past, setPast] = useState<Snapshot[]>([]);
  const [lastMove, setLastMove] = useState<{ from: number; to: number } | null>(null);
  const [notice, setNotice] = useState<string[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [viewSeat, setViewSeat] = useState<Seat>(() => defaultViewSeat(seats));
  const [round, setRound] = useState(0);

  const controller = seats[game.turn];
  const humanToMove = !game.result && controller.kind === 'human';
  const botToMove = !game.result && controller.kind === 'bot';

  const apply = useCallback(
    (move: Move) => {
      const { state: next, events } = playMove(game, move);
      const sounds = { san: moveLabel(move), captured: move.captured ? ('p' as const) : undefined };
      playMoveSound(sounds);
      triggerMoveHaptics(sounds);
      setPast((p) => [...p, { state: game, lastMove, log }]);
      setGame(next);
      setLog((l) => [...l, { seat: game.turn, text: moveLabel(move) }]);
      setLastMove({ from: move.from, to: move.to });
      setNotice(describeEvents(events));
      if (next.result) triggerGameEndHaptics();
    },
    [game, lastMove, log]
  );

  // Bots: when it is a bot's turn, think for a moment and then play. Re-created on every position change, so it can never act on a stale one.
  useEffect(() => {
    if (!botToMove || controller.kind !== 'bot') return;
    const timer = setTimeout(() => {
      const move = chooseBotMove(game, controller.level);
      if (move) apply(move);
    }, BOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [game, botToMove, controller, apply]);

  const canUndo = past.some((p) => seats[p.state.turn].kind === 'human');
  const handleUndo = () => {
    // Back to the most recent earlier position in which a human was to move (undoing the bots' replies along with it).
    for (let i = past.length - 1; i >= 0; i--) {
      if (seats[past[i].state.turn].kind === 'human') {
        setGame(past[i].state);
        setLastMove(past[i].lastMove);
        setLog(past[i].log);
        setPast(past.slice(0, i));
        setNotice([]);
        return;
      }
    }
  };

  const handleResign = () => {
    if (!humanToMove) return;
    const seat = game.turn;
    appAlert(`${SEAT_NAMES[seat]} resigns?`, 'This seat is eliminated; its pieces stay on the board as dead blockers.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Resign',
        style: 'destructive',
        onPress: () => {
          const { state: next, events } = resign(game, seat);
          setPast((p) => [...p, { state: game, lastMove, log }]);
          setGame(next);
          setNotice(describeEvents(events));
          if (next.result) triggerGameEndHaptics();
        },
      },
    ]);
  };

  const handleNewGame = () => {
    setGame(initialState());
    setPast([]);
    setLastMove(null);
    setNotice([]);
    setLog([]);
    setViewSeat(defaultViewSeat(seats));
    setRound((r) => r + 1);
  };

  const ranking = useMemo(
    () => ([0, 1, 2, 3] as Seat[]).slice().sort((a, b) => game.score[b] - game.score[a] || a - b),
    [game.score]
  );

  const mover = SEAT_NAMES[game.turn];
  let statusText: string;
  if (game.result) {
    const names = game.result.winners.map((seat) => SEAT_NAMES[seat]).join(' & ');
    statusText = game.result.winners.length > 1 ? `Game over — ${names} tie` : `Game over — ${names} wins`;
  } else if (botToMove) {
    statusText = `${mover} (bot) is thinking…`;
  } else {
    statusText = `${mover} to move${isInCheck(game, game.turn) ? ' — in check!' : ''}`;
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="4 Player Chess" subtitle="Free-for-All" onBack={onExit} backLabel="‹ Menu" />
      <GameScreenBody
        bottomBar={
          <>
            <View style={styles.controlsWrap}>
              <GameControlBar
                items={[
                  { key: 'rotate', label: 'Rotate', onPress: () => setViewSeat((v) => nextSeat(v)) },
                  { key: 'resign', label: 'Resign', onPress: handleResign, disabled: !humanToMove },
                  { key: 'undo', label: 'Undo', onPress: handleUndo, disabled: !canUndo || !!game.result },
                ]}
              />
            </View>
            <View style={styles.footer}>
              <Pressable style={styles.resetButton} onPress={handleNewGame}>
                <Text style={styles.resetButtonText}>New Game</Text>
              </Pressable>
            </View>
          </>
        }
      >
        <View style={styles.seatStrip}>
          {([0, 1, 2, 3] as Seat[]).map((seat) => {
            const out = game.status[seat] !== 'active';
            const current = !game.result && game.turn === seat;
            return (
              <View key={seat} style={[styles.seatChip, current && { borderColor: SEAT_COLORS[seat], borderWidth: 2 }, out && styles.seatChipOut]}>
                <View style={[styles.seatDot, { backgroundColor: SEAT_COLORS[seat] }]} />
                <View style={styles.seatText}>
                  <View style={styles.seatNameRow}>
                    <Text style={styles.seatName} numberOfLines={1}>
                      {SEAT_NAMES[seat]}
                    </Text>
                    <Text style={styles.seatScore}>{game.score[seat]}</Text>
                  </View>
                  <Text style={styles.seatMeta} numberOfLines={1}>
                    {out ? 'out' : shortController(seats[seat])}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        <Text style={[styles.status, { color: game.result ? colors.gold : colors.text }]}>{statusText}</Text>

        <FourPlayerBoard key={round} state={game} viewSeat={viewSeat} interactive={humanToMove} lastMove={lastMove} onMove={apply} />

        {log.length > 0 && (
          <Text style={styles.recent} numberOfLines={1}>
            {log.slice(-4).map((entry, i) => (
              <Text key={log.length - 4 + i} style={{ color: SEAT_COLORS[entry.seat], fontWeight: '700' }}>
                {i > 0 ? '   ' : ''}
                {entry.text}
              </Text>
            ))}
          </Text>
        )}

        {notice.length > 0 && !game.result && (
          <Text style={styles.notice} numberOfLines={2}>
            {notice.join(' · ')}
          </Text>
        )}

        {game.result && (
          <View style={styles.resultCard}>
            {ranking.map((seat, position) => (
              <View key={seat} style={styles.resultRow}>
                <Text style={styles.resultPlace}>{position + 1}.</Text>
                <View style={[styles.seatDot, { backgroundColor: SEAT_COLORS[seat] }]} />
                <Text style={[styles.resultName, game.result!.winners.includes(seat) && { fontWeight: '800' }]}>
                  {SEAT_NAMES[seat]} <Text style={styles.resultMeta}>({describeController(seats[seat])})</Text>
                </Text>
                <Text style={styles.resultScore}>{game.score[seat]}</Text>
              </View>
            ))}
            <Text style={styles.resultNote}>{game.result.reason === 'cap' ? 'Move limit reached — scored by points.' : 'Three players eliminated — highest score wins.'}</Text>
          </View>
        )}
      </GameScreenBody>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    controlsWrap: { position: 'relative' },
    footer: { alignItems: 'center', gap: 6 },
    resetButton: { paddingVertical: 10, paddingHorizontal: 22, backgroundColor: colors.buttonBackground, borderRadius: 10 },
    resetButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    seatStrip: { flexDirection: 'row', gap: 4, paddingHorizontal: 8, alignSelf: 'stretch' },
    seatChip: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingVertical: 4,
      paddingHorizontal: 5,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    seatChipOut: { opacity: 0.5 },
    seatDot: { width: 10, height: 10, borderRadius: 5 },
    seatText: { flex: 1 },
    seatNameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 2 },
    seatName: { flexShrink: 1, fontSize: 12, fontWeight: '700', color: colors.text },
    seatScore: { fontSize: 12, fontWeight: '800', color: colors.text },
    seatMeta: { fontSize: 10, color: colors.textSecondary },
    status: { fontSize: 15, fontWeight: '600' },
    recent: { fontSize: 12, textAlign: 'center', paddingHorizontal: 8 },
    notice: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 12 },
    resultCard: {
      alignSelf: 'stretch',
      marginHorizontal: 16,
      padding: 10,
      gap: 4,
      borderRadius: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    resultRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    resultPlace: { width: 18, fontSize: 14, color: colors.textSecondary },
    resultName: { flex: 1, fontSize: 14, color: colors.text },
    resultMeta: { fontSize: 11, color: colors.textSecondary, fontWeight: '400' },
    resultScore: { fontSize: 15, fontWeight: '700', color: colors.text },
    resultNote: { fontSize: 11, color: colors.textSecondary, textAlign: 'center', marginTop: 2 },
  });
}
