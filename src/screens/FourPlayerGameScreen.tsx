import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { appAlert } from '../components/AppAlert';
import FourPlayerBoard from '../components/FourPlayerBoard';
import FourPlayerSeatStrip from '../components/FourPlayerSeatStrip';
import GameControlBar from '../components/GameControlBar';
import GameScreenBody from '../components/GameScreenBody';
import ScreenHeader from '../components/ScreenHeader';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import {
  SEAT_COLORS,
  SEAT_NAMES,
  addIncrement,
  chooseBotMove,
  defaultViewSeat,
  describeEvents,
  initialState,
  isInCheck,
  describeResultReason,
  moveLabel,
  nextSeat,
  playMove,
  resign,
  type FourPlayerClock,
  type FourPlayerState,
  type GameEvent,
  type Move,
  type Seat,
  type SeatConfig,
} from '../logic/fourPlayer';
import { controllerName } from '../logic/fourPlayerBots';
import { triggerGameEndHaptics, triggerMoveHaptics } from '../logic/haptics';
import { playMoveSound } from '../logic/moveSounds';
import { useFourPlayerClock } from '../logic/useFourPlayerClock';
import type { TimeControl } from '../types/timeControl';

interface FourPlayerGameScreenProps {
  seats: SeatConfig;
  timeControl: TimeControl;
  onExit: () => void;
}

/** How long a bot "thinks" before its move lands, so a round of three bot moves is followable rather than instantaneous (shorter in bullet). */
const botDelayMs = (timeControl: TimeControl) => (timeControl.category === 'bullet' ? 200 : 450);

interface LogEntry {
  seat: Seat;
  text: string;
}

interface Snapshot {
  state: FourPlayerState;
  clock: FourPlayerClock;
  lastMove: { from: number; to: number } | null;
  log: LogEntry[];
}

/**
 * Local 4 Player Chess (Free-for-All): hotseat humans and/or bots, per the SeatConfig, on four independent clocks. The whole game is one
 * immutable FourPlayerState advanced with playMove (which also resolves eliminations and walks dead kings), so Undo is a stack of earlier
 * states (with their clocks). A seat that runs out of time is eliminated by the engine ('timeout'). Not saved to history, not rated.
 */
export default function FourPlayerGameScreen({ seats, timeControl, onExit }: FourPlayerGameScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [game, setGame] = useState<FourPlayerState>(() => initialState());
  const [past, setPast] = useState<Snapshot[]>([]);
  const [lastMove, setLastMove] = useState<{ from: number; to: number } | null>(null);
  const [notice, setNotice] = useState<string[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [viewSeat, setViewSeat] = useState<Seat>(() => defaultViewSeat(seats));
  const [round, setRound] = useState(0);

  // A flag fall: the engine has already eliminated the seat (and passed the turn on); adopt the result.
  const handleTimeout = (next: FourPlayerState, events: GameEvent[]) => {
    setPast((p) => [...p, { state: game, clock, lastMove, log }]);
    setGame(next);
    setNotice(describeEvents(events));
    if (next.result) triggerGameEndHaptics();
  };
  const { clock, setClock, reset: resetClock } = useFourPlayerClock(timeControl, game, handleTimeout);

  const controller = seats[game.turn];
  const humanToMove = !game.result && controller.kind === 'human';
  const botToMove = !game.result && controller.kind === 'bot';

  const apply = useCallback(
    (move: Move) => {
      const mover = game.turn;
      const { state: next, events } = playMove(game, move);
      const sounds = { san: moveLabel(move), captured: move.captured ? ('p' as const) : undefined };
      playMoveSound(sounds);
      triggerMoveHaptics(sounds);
      setPast((p) => [...p, { state: game, clock, lastMove, log }]);
      setGame(next);
      setClock((c) => addIncrement(c, mover, game)); // the mover's increment; nobody else's, and never a dead king's walk
      setLog((l) => [...l, { seat: mover, text: moveLabel(move) }]);
      setLastMove({ from: move.from, to: move.to });
      setNotice(describeEvents(events));
      if (next.result) triggerGameEndHaptics();
    },
    [game, clock, lastMove, log, setClock]
  );

  // Bots: when it is a bot's turn, think for a moment and then play. Re-created on every position change, so it can never act on a stale one.
  // It must NOT depend on `apply` itself: that changes every time a clock ticks (it captures the clock for Undo snapshots), which would
  // restart this timer every 200 ms and the bot would never get to move. The latest `apply` is reached through a ref instead.
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    if (!botToMove || controller.kind !== 'bot') return;
    const timer = setTimeout(() => {
      const move = chooseBotMove(game, controller.elo);
      if (move) applyRef.current(move);
    }, botDelayMs(timeControl));
    return () => clearTimeout(timer);
  }, [game, botToMove, controller, timeControl]);

  const canUndo = past.some((p) => seats[p.state.turn].kind === 'human');
  const handleUndo = () => {
    // Back to the most recent earlier position in which a human was to move (undoing the bots' replies along with it).
    for (let i = past.length - 1; i >= 0; i--) {
      if (seats[past[i].state.turn].kind === 'human') {
        setGame(past[i].state);
        setClock(past[i].clock);
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
          setPast((p) => [...p, { state: game, clock, lastMove, log }]);
          setGame(next);
          setNotice(describeEvents(events));
          if (next.result) triggerGameEndHaptics();
        },
      },
    ]);
  };

  const handleNewGame = () => {
    setGame(initialState());
    resetClock();
    setPast([]);
    setLastMove(null);
    setNotice([]);
    setLog([]);
    setViewSeat(defaultViewSeat(seats));
    setRound((r) => r + 1);
  };

  const ranking = useMemo(() => ([0, 1, 2, 3] as Seat[]).slice().sort((a, b) => game.score[b] - game.score[a] || a - b), [game.score]);

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
      <ScreenHeader title="4 Player Chess" subtitle={`Free-for-All · ${timeControl.label}`} onBack={onExit} backLabel="‹ Menu" />
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
        <FourPlayerSeatStrip state={game} seats={seats} clock={clock} />

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
                  {SEAT_NAMES[seat]} <Text style={styles.resultMeta}>({controllerName(seats[seat])})</Text>
                </Text>
                <Text style={styles.resultScore}>{game.score[seat]}</Text>
              </View>
            ))}
            <Text style={styles.resultNote}>{describeResultReason(game.result.reason)}</Text>
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
    seatDot: { width: 10, height: 10, borderRadius: 5 },
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
