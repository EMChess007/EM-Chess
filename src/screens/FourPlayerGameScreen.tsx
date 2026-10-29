import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/AppText';
import { appAlert } from '../components/AppAlert';
import ChaturajiRulesSheet from '../components/ChaturajiRulesSheet';
import FourPlayerBoard from '../components/FourPlayerBoard';
import FourPlayerSeatStrip from '../components/FourPlayerSeatStrip';
import GameControlBar from '../components/GameControlBar';
import GameScreenBody from '../components/GameScreenBody';
import KingAttackedPill from '../components/KingAttackedPill';
import MandatoryCaptureBanner from '../components/MandatoryCaptureBanner';
import ScreenHeader from '../components/ScreenHeader';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import {
  SEAT_COLORS,
  SEAT_NAMES,
  addIncrement,
  chooseBotMoveFor,
  defaultViewSeat,
  describeEvents,
  initialState,
  describePremove,
  moveLabelOn,
  geometryOf,
  FLAG_PROMOTION,
  nextSeat,
  playMove,
  premoveSeat,
  resolvePremove,
  resign,
  rulesFor,
  type FourPlayerClock,
  type FourPlayerPremove,
  type FourPlayerState,
  type FourVariant,
  type GameEvent,
  type Move,
  type Seat,
  type SeatConfig,
} from '../logic/fourPlayer';
import { chaturajiResultRows, seatStatusOf } from '../logic/chaturajiUi';
import { controllerName } from '../logic/fourPlayerBots';
import { triggerGameEndHaptics, triggerMoveHaptics } from '../logic/haptics';
import { fourPlayerCapturingSquares } from '../logic/giveawayHints';
import { playMoveSound } from '../logic/moveSounds';
import { useCaptureNudge } from '../logic/useCaptureNudge';
import { describeResignWarning, describeResultNote, rankSeats, seatMetric, statusSuffix, variantModeLabel, variantTitle } from '../logic/fourPlayerVariant';
import { useFourPlayerClock } from '../logic/useFourPlayerClock';
import { useScoreGains } from '../logic/useScoreGains';
import { describePremoveCancel } from '../logic/premove';
import { usePremove } from '../logic/usePremove';
import type { TimeControl } from '../types/timeControl';

interface FourPlayerGameScreenProps {
  /** 4 Player Chess ('ffa', the default) or 4 Player Giveaway: picks the start rules, the bot and the wording (no "in check", pieces left instead of points). */
  variant?: FourVariant;
  seats: SeatConfig;
  timeControl: TimeControl;
  /** A TEST SEAM: begin from this position instead of the start (a hand-built end-game, a pawn one step from promotion). The app never passes it; New Game always starts from the real start. */
  startFrom?: FourPlayerState;
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
  lastMove: { from: number; to: number; promoted?: boolean } | null;
  log: LogEntry[];
}

/**
 * Local 4 Player Chess (Free-for-All) or 4 Player Giveaway (`variant`): hotseat humans and/or bots, per the SeatConfig, on four independent clocks. The whole game is one
 * immutable FourPlayerState advanced with playMove (which also resolves eliminations and walks dead kings), so Undo is a stack of earlier
 * states (with their clocks). A seat that runs out of time is eliminated by the engine ('timeout'). Not saved to history, not rated.
 */
export default function FourPlayerGameScreen({ variant = 'ffa', seats, timeControl, startFrom, onExit }: FourPlayerGameScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [game, setGame] = useState<FourPlayerState>(() => startFrom ?? initialState(rulesFor(variant)));
  const [past, setPast] = useState<Snapshot[]>([]);
  const [lastMove, setLastMove] = useState<{ from: number; to: number; promoted?: boolean } | null>(null);
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
      const sounds = { san: moveLabelOn(move, geometryOf(game.rules)), captured: move.captured ? ('p' as const) : undefined };
      playMoveSound(sounds);
      triggerMoveHaptics(sounds);
      setPast((p) => [...p, { state: game, clock, lastMove, log }]);
      setGame(next);
      setClock((c) => addIncrement(c, mover, game)); // the mover's increment; nobody else's, and never a dead king's walk
      setLog((l) => [...l, { seat: mover, text: moveLabelOn(move, geometryOf(game.rules)) }]);
      setLastMove({ from: move.from, to: move.to, ...(move.flags & FLAG_PROMOTION ? { promoted: true } : {}) });
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
      const move = chooseBotMoveFor(game, controller.elo); // the Giveaway bot for a Giveaway position, the Chess bot otherwise
      if (move) applyRef.current(move);
    }, botDelayMs(timeControl));
    return () => clearTimeout(timer);
  }, [game, botToMove, controller, timeControl]);

  // Premove: the one human (vs bots) may queue a move while the three other seats play; it is validated against the REAL position the moment
  // the turn comes back and played through the same apply() as a hand-made move, or cancelled with a notice (see logic/premove.ts). It is
  // dropped silently when the game ends and with a notice if the seat is eliminated while waiting. Several humans on one device: none.
  const myPremoveSeat = premoveSeat(seats);
  const {
    premove,
    queue: queuePremove,
    cancel: cancelPremove,
    cancelReason: premoveCancelReason,
  } = usePremove<FourPlayerPremove, Move>({
    isMyTurn: myPremoveSeat !== undefined && game.turn === myPremoveSeat,
    canStillPlay: myPremoveSeat !== undefined && game.status[myPremoveSeat] === 'active',
    gameOver: !!game.result,
    resolve: (intent) => (myPremoveSeat === undefined ? null : resolvePremove(game, myPremoveSeat, intent)),
    play: apply,
  });

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
        cancelPremove();
        return;
      }
    }
  };

  const handleResign = () => {
    if (!humanToMove) return;
    const seat = game.turn;
    appAlert(
      `${SEAT_NAMES[seat]} resigns?`,
      describeResignWarning(variant, false),
      [
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
      ]
    );
  };

  const handleNewGame = () => {
    setGame(initialState(rulesFor(variant)));
    resetClock();
    setPast([]);
    setLastMove(null);
    setNotice([]);
    setLog([]);
    setViewSeat(defaultViewSeat(seats));
    setRound((r) => r + 1);
    cancelPremove();
  };

  // Chess: by score. Giveaway: the winner first, then the fewest pieces left.
  const ranking = useMemo(() => rankSeats(variant, ([0, 1, 2, 3] as Seat[]).map((seat) => seatMetric(game, seat)), game.result?.winners ?? []), [variant, game]);

  const chaturaji = variant === 'chaturaji';
  const [rulesOpen, setRulesOpen] = useState(false);
  // Chaturaji: the points each seat just scored ("+3" at its card), straight from the engine's score; and the final table with its breakdown (the +3 per surviving king).
  const gains = useScoreGains(game, chaturaji);
  const chaturajiRows = useMemo(
    () => (chaturaji && game.result ? chaturajiResultRows(game, game.score, game.result.winners, game.result.reason) : []),
    [chaturaji, game]
  );
  const geo = geometryOf(game.rules);

  const mover = SEAT_NAMES[game.turn];
  // 4 Player Giveaway: a capture is mandatory for the human to move - a bold status instead of the plain one, and a message when they tap a piece that cannot capture.
  const { nudged: captureNudged, nudge: nudgeCapture } = useCaptureNudge();
  const mustCapture = !game.result && humanToMove && fourPlayerCapturingSquares(game, game.turn).length > 0;
  // Chaturaji: the human to move has a king under attack. A notice only - nothing is blocked and nothing has to be answered.
  const kingAttacked = chaturaji && !game.result && humanToMove && seatStatusOf(game, game.turn).kind === 'attacked';
  let statusText: string;
  if (game.result) {
    const names = game.result.winners.map((seat) => SEAT_NAMES[seat]).join(' & ');
    statusText = game.result.winners.length > 1 ? `Game over — ${names} tie` : `Game over — ${names} wins`;
  } else if (botToMove) {
    statusText = `${mover} (bot) is thinking…`;
  } else {
    statusText = `${mover} to move${statusSuffix(game, game.turn)}`; // " — in check!" (Chess) / " — must capture" (Giveaway)
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title={variantTitle(variant)} subtitle={`${variantModeLabel(variant)} · ${timeControl.label}`} onBack={onExit} backLabel="‹ Menu" />
      <GameScreenBody
        bottomBar={
          <>
            <View style={styles.controlsWrap}>
              <GameControlBar
                items={[
                  { key: 'rotate', label: 'Rotate', onPress: () => setViewSeat((v) => nextSeat(v)) },
                  { key: 'resign', label: 'Resign', onPress: handleResign, disabled: !humanToMove },
                  { key: 'undo', label: 'Undo', onPress: handleUndo, disabled: !canUndo || !!game.result },
                  ...(chaturaji ? [{ key: 'rules', label: 'Rules', onPress: () => setRulesOpen(true) }] : []),
                ]}
              />
            </View>
            <View style={styles.footer}>
              <Pressable testID="new-game" style={styles.resetButton} onPress={handleNewGame}>
                <Text style={styles.resetButtonText}>{chaturaji && game.result ? 'Rematch' : 'New Game'}</Text>
              </Pressable>
              {chaturaji && game.result && (
                <Pressable testID="back-to-menu" style={styles.menuButton} onPress={onExit}>
                  <Text style={styles.resetButtonText}>Back to menu</Text>
                </Pressable>
              )}
            </View>
          </>
        }
      >
        <FourPlayerSeatStrip state={game} seats={seats} clock={clock} gains={gains} />

        {mustCapture ? (
          <MandatoryCaptureBanner lead={`${mover} to move`} nudged={captureNudged} />
        ) : kingAttacked ? (
          <KingAttackedPill text={`${mover}: your king is attacked — it can be captured`} />
        ) : (
          <Text style={[styles.status, { color: game.result ? colors.gold : colors.text }]}>{statusText}</Text>
        )}

        <FourPlayerBoard
          key={round}
          state={game}
          viewSeat={viewSeat}
          interactive={humanToMove}
          lastMove={lastMove}
          onMove={apply}
          premoveSeat={myPremoveSeat}
          premove={premove}
          onPremove={queuePremove}
          enableAnnotations
          onMandatoryCaptureBlocked={nudgeCapture}
        />

        {premoveCancelReason && <Text style={styles.errorText}>{describePremoveCancel(premoveCancelReason)}</Text>}
        {premove && !humanToMove && (
          <View style={styles.premoveRow}>
            <Text style={styles.premoveText}>Premove queued: {describePremove(premove, geo)}</Text>
            <Pressable style={styles.premoveCancelButton} onPress={cancelPremove}>
              <Text style={styles.premoveCancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
        )}

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

        {game.result && chaturaji && (
          <View testID="result-card" style={styles.resultCard}>
            {chaturajiRows.map((row) => (
              <View key={row.seat} style={styles.resultBlock}>
                <View style={styles.resultRow}>
                  <Text style={styles.resultPlace}>{row.place}.</Text>
                  <View style={[styles.seatDot, { backgroundColor: SEAT_COLORS[row.seat] }]} />
                  <Text style={[styles.resultName, row.winner && { fontWeight: '800' }]}>
                    {SEAT_NAMES[row.seat]} <Text style={styles.resultMeta}>({controllerName(seats[row.seat])})</Text>
                  </Text>
                  <Text testID={`result-score-${row.seat}`} style={styles.resultScore}>
                    {row.total}
                  </Text>
                </View>
                {row.bonus > 0 && (
                  <Text testID={`result-detail-${row.seat}`} style={styles.resultDetail}>
                    {row.detail}
                  </Text>
                )}
              </View>
            ))}
            <Text style={styles.resultNote}>{describeResultNote(game.result, variant)}</Text>
          </View>
        )}

        {game.result && !chaturaji && (
          <View style={styles.resultCard}>
            {ranking.map((seat, position) => (
              <View key={seat} style={styles.resultRow}>
                <Text style={styles.resultPlace}>{position + 1}.</Text>
                <View style={[styles.seatDot, { backgroundColor: SEAT_COLORS[seat] }]} />
                <Text style={[styles.resultName, game.result!.winners.includes(seat) && { fontWeight: '800' }]}>
                  {SEAT_NAMES[seat]} <Text style={styles.resultMeta}>({controllerName(seats[seat])})</Text>
                </Text>
                <Text style={styles.resultScore}>{variant === 'giveaway' ? `${seatMetric(game, seat)} left` : seatMetric(game, seat)}</Text>
              </View>
            ))}
            <Text style={styles.resultNote}>{describeResultNote(game.result, variant)}</Text>
          </View>
        )}
      </GameScreenBody>
      {chaturaji && <ChaturajiRulesSheet visible={rulesOpen} onClose={() => setRulesOpen(false)} />}
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    controlsWrap: { position: 'relative' },
    footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
    resetButton: { paddingVertical: 10, paddingHorizontal: 22, backgroundColor: colors.buttonBackground, borderRadius: 10 },
    resetButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    seatDot: { width: 10, height: 10, borderRadius: 5 },
    status: { fontSize: 15, fontWeight: '600' },
    recent: { fontSize: 12, textAlign: 'center', paddingHorizontal: 8 },
    notice: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 12 },
    errorText: { fontSize: 13, color: colors.danger, textAlign: 'center' },
    premoveRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    premoveText: { fontSize: 13, fontStyle: 'italic', color: colors.gold },
    premoveCancelButton: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6, backgroundColor: colors.buttonBackground },
    premoveCancelButtonText: { fontSize: 12, fontWeight: '600', color: '#fff' },
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
    menuButton: { paddingVertical: 10, paddingHorizontal: 22, backgroundColor: colors.textSecondary, borderRadius: 10 },
    resultBlock: { gap: 1 },
    resultDetail: { marginLeft: 36, fontSize: 11, color: colors.gold },
    resultRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    resultPlace: { width: 18, fontSize: 14, color: colors.textSecondary },
    resultName: { flex: 1, fontSize: 14, color: colors.text },
    resultMeta: { fontSize: 11, color: colors.textSecondary, fontWeight: '400' },
    resultScore: { fontSize: 15, fontWeight: '700', color: colors.text },
    resultNote: { fontSize: 11, color: colors.textSecondary, textAlign: 'center', marginTop: 2 },
  });
}
