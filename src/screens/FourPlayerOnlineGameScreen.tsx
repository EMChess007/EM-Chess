import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pressable } from '../components/AppPressable';
import { Text } from '../components/AppText';
import { appAlert } from '../components/AppAlert';
import FourPlayerBoard from '../components/FourPlayerBoard';
import ChaturajiRulesSheet from '../components/ChaturajiRulesSheet';
import FourPlayerChatPanel from '../components/FourPlayerChatPanel';
import FourPlayerResultCard from '../components/FourPlayerResultCard';
import FourPlayerSeatStrip from '../components/FourPlayerSeatStrip';
import GameControlBar from '../components/GameControlBar';
import GameScreenBody from '../components/GameScreenBody';
import KingAttackedPill from '../components/KingAttackedPill';
import MandatoryCaptureBanner from '../components/MandatoryCaptureBanner';
import ScreenHeader from '../components/ScreenHeader';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import {
  SEAT_COLORS,
  describePremove,
  geometryOf,
  nextSeat,
  resolvePremove,
  type FourPlayerPremove,
  type Move,
  type Seat,
} from '../logic/fourPlayer';
import { KING_ATTACKED_PILL, showKingAttackedPill } from '../logic/chaturajiUi';
import { canMove, displayClock, displayState } from '../logic/fourPlayerOnline';
import { describeResignWarning, variantTitle } from '../logic/fourPlayerVariant';
import { LEAVE_GAME_MESSAGE, LEAVE_GAME_TITLE, describeStatus, isLiveSeat, seatLabels } from '../logic/fourPlayerOnlineUi';
import { fourVariantOf, type FourMatchFoundPayload } from '../logic/fourPlayerWire';
import { fourPlayerCapturingSquares } from '../logic/giveawayHints';
import { describePremoveCancel } from '../logic/premove';
import { useCaptureNudge } from '../logic/useCaptureNudge';
import { useFourPlayerOnlineGame } from '../logic/useFourPlayerOnlineGame';
import { usePremove } from '../logic/usePremove';
import { useScoreGains } from '../logic/useScoreGains';

interface FourPlayerOnlineGameScreenProps {
  authToken: string;
  match: FourMatchFoundPayload;
  /** The screen was reopened for a game already in progress ("Return to your game"): rejoin straight away. */
  resume: boolean;
  /** Back to the menu. `resumable` = the player still holds a live seat, so the menu may offer "Return to your game". */
  onExit: (resumable: boolean) => void;
  onPlayAgain: () => void;
  /** The game is over for this player (or the server no longer has it): the app forgets the remembered rejoin token. */
  onGameEnded?: () => void;
}

/**
 * A seated player's online 4 Player game (FOUR_PLAYER_ONLINE_SPEC.md §8). The server is the authority for everything: the position,
 * the clocks and who holds each seat arrive as snapshots (see `useFourPlayerOnlineGame` / `fourPlayerOnline.ts`); the screen shows
 * the player's own move at once, sends it, and the next snapshot (or a refusal, which rolls it back) settles it. The board is the local
 * game's `FourPlayerBoard` seen from the player's own seat, with premoves always on (`premoveSeat` = the player's seat: there is no
 * hot-seat ambiguity online). Chat, Resign and Rotate sit in the control bar; leaving mid-game asks first, because a bot takes the seat.
 */
export default function FourPlayerOnlineGameScreen({ authToken, match, resume, onExit, onPlayAgain, onGameEnded }: FourPlayerOnlineGameScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const game = useFourPlayerOnlineGame(authToken, { kind: 'player', match, resume });
  const { view, connection, problem, chat, chatUnread, boardKey, now, sendMove, resign, sendChat, markChatRead, leave } = game;

  const ended = !!view && (!!view.gameOver || !!view.state.result);
  useEffect(() => {
    if (ended || connection === 'unavailable') onGameEnded?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended, connection]);

  // 4 Player Giveaway: the "A capture is mandatory" message after a tap on a piece that cannot capture (see MandatoryCaptureBanner).
  const { nudged: captureNudged, nudge: nudgeCapture } = useCaptureNudge();
  const [viewSeat, setViewSeat] = useState<Seat>(match.seat);
  const [chatOpen, setChatOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (chatOpen) markChatRead();
  }, [chatOpen, chat.length, markChatRead]);

  const connected = connection === 'connected';
  const mySeat = view?.mySeat ?? null;
  const myTurnReady = !!view && mySeat !== null && view.state.turn === mySeat && connected && !view.resyncing && !view.pending;
  const {
    premove,
    queue: queuePremove,
    cancel: cancelPremove,
    cancelReason,
  } = usePremove<FourPlayerPremove, Move>({
    // A premove waits until a move could really be sent (not while reconnecting / resyncing / a move is pending), instead of being spent on a refusal.
    isMyTurn: myTurnReady,
    canStillPlay: !!view && mySeat !== null && view.state.status[mySeat] === 'active',
    gameOver: !view || !!view.gameOver || !!view.state.result,
    resolve: (intent) => (view && mySeat !== null ? resolvePremove(view.state, mySeat, intent) : null),
    play: sendMove,
  });

  const leaveNow = (resumable: boolean) => {
    leave();
    onExit(resumable);
  };
  const handleBack = () => {
    // Nothing to protect when there is no live seat: no view, the game is over, or the server says the game no longer exists.
    if (!view || !isLiveSeat(view) || connection === 'unavailable') {
      leaveNow(false);
      return;
    }
    appAlert(LEAVE_GAME_TITLE, LEAVE_GAME_MESSAGE, [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => leaveNow(true) },
    ]);
  };

  const handleResign = () => {
    if (!view || !isLiveSeat(view)) return;
    appAlert('Resign?', describeResignWarning(view.variant, true), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Resign',
        style: 'destructive',
        onPress: () => {
          setActionError(null);
          resign((message) => setActionError(message));
        },
      },
    ]);
  };

  // Chaturaji: the "+N" at the seat that scored, from consecutive authoritative snapshots; and the rules sheet.
  const chaturaji = !!view && view.variant === 'chaturaji';
  const gains = useScoreGains(view?.state ?? null, chaturaji);
  const [rulesOpen, setRulesOpen] = useState(false);

  if (!view) {
    return (
      <View style={styles.container}>
        <ScreenHeader title={variantTitle(fourVariantOf(match))} subtitle="Online" onBack={() => leaveNow(false)} backLabel="‹ Menu" />
        <Text style={styles.problem}>{problem ?? 'Loading…'}</Text>
      </View>
    );
  }

  const shown = displayState(view);
  const over = !!view.gameOver || !!view.state.result;
  const iAmActive = mySeat !== null && view.state.status[mySeat] === 'active';
  const recent = view.log.slice(-4);

  return (
    <View style={styles.container}>
      <ScreenHeader title={variantTitle(view.variant)} subtitle={`Online · ${view.timeControlLabel}`} onBack={handleBack} backLabel="‹ Menu" />
      <GameScreenBody
        bottomBar={
          <>
            <View style={styles.controlsWrap}>
              <GameControlBar
                items={[
                  { key: 'rotate', label: 'Rotate', onPress: () => setViewSeat((v) => nextSeat(v)) },
                  { key: 'resign', label: 'Resign', onPress: handleResign, disabled: over || !iAmActive },
                  { key: 'chat', label: chatUnread > 0 ? `Chat (${chatUnread})` : 'Chat', onPress: () => setChatOpen((open) => !open), active: chatOpen },
                  ...(chaturaji ? [{ key: 'rules', label: 'Rules', onPress: () => setRulesOpen(true) }] : []),
                ]}
              />
            </View>
            {view.gameOver && (
              <View style={styles.footer}>
                <Pressable style={styles.primaryButton} onPress={onPlayAgain}>
                  <Text style={styles.buttonText}>Play again</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={() => leaveNow(false)}>
                  <Text style={styles.buttonText}>Back to menu</Text>
                </Pressable>
              </View>
            )}
          </>
        }
      >
        <FourPlayerSeatStrip state={shown} clock={displayClock(view, now)} labels={seatLabels(view, now)} gains={gains} />

        {canMove(view, connected) && !view.gameOver && fourPlayerCapturingSquares(shown, shown.turn).length > 0 ? (
          <MandatoryCaptureBanner lead="Your move" nudged={captureNudged} />
        ) : chaturaji && !over && showKingAttackedPill(view.state, mySeat) ? (
          <KingAttackedPill text={KING_ATTACKED_PILL} />
        ) : (
          <Text style={[styles.status, { color: view.gameOver ? colors.gold : colors.text }]}>{describeStatus(view)}</Text>
        )}

        {connection === 'reconnecting' && <Text style={styles.warning}>Connection lost — trying to reconnect...</Text>}
        {connection === 'unavailable' && <Text style={styles.problem}>{problem ?? 'This game is no longer available.'}</Text>}
        {connected && view.resyncing && <Text style={styles.warning}>Catching up with the game...</Text>}

        <FourPlayerBoard
          key={boardKey}
          state={shown}
          viewSeat={viewSeat}
          interactive={canMove(view, connected)}
          lastMove={view.lastMove}
          onMove={sendMove}
          premoveSeat={mySeat ?? undefined}
          premove={premove}
          onPremove={queuePremove}
          enableAnnotations
          onMandatoryCaptureBlocked={nudgeCapture}
        />

        {view.moveError && <Text style={styles.errorText}>{view.moveError}</Text>}
        {actionError && <Text style={styles.errorText}>{actionError}</Text>}
        {cancelReason && <Text style={styles.errorText}>{describePremoveCancel(cancelReason)}</Text>}
        {premove && !myTurnReady && !over && (
          <View style={styles.premoveRow}>
            <Text style={styles.premoveText}>Premove queued: {describePremove(premove, geometryOf(view.state.rules))}</Text>
            <Pressable style={styles.premoveCancelButton} onPress={cancelPremove}>
              <Text style={styles.premoveCancelText}>Cancel</Text>
            </Pressable>
          </View>
        )}

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

        {view.notices.length > 0 && !over && (
          <Text style={styles.notice} numberOfLines={2}>
            {view.notices.join(' · ')}
          </Text>
        )}

        {chatOpen && <FourPlayerChatPanel messages={chat} onSend={sendChat} />}

        {view.gameOver && <FourPlayerResultCard gameOver={view.gameOver} seats={view.seats} variant={view.variant} />}
      </GameScreenBody>
      {chaturaji && <ChaturajiRulesSheet visible={rulesOpen} onClose={() => setRulesOpen(false)} />}
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    controlsWrap: { position: 'relative' },
    footer: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 6 },
    primaryButton: { paddingVertical: 10, paddingHorizontal: 22, backgroundColor: colors.buttonBackground, borderRadius: 10 },
    secondaryButton: { paddingVertical: 10, paddingHorizontal: 22, backgroundColor: colors.textSecondary, borderRadius: 10 },
    buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    status: { fontSize: 15, fontWeight: '600' },
    warning: { fontSize: 13, color: colors.mode === 'dark' ? '#e0c34a' : '#8d6e00', textAlign: 'center' },
    problem: { fontSize: 14, color: colors.danger, textAlign: 'center', paddingHorizontal: 24, marginTop: 12 },
    errorText: { fontSize: 13, color: colors.danger, textAlign: 'center' },
    recent: { fontSize: 12, textAlign: 'center', paddingHorizontal: 8 },
    notice: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 12 },
    premoveRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    premoveText: { fontSize: 13, fontStyle: 'italic', color: colors.gold },
    premoveCancelButton: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6, backgroundColor: colors.buttonBackground },
    premoveCancelText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  });
}
