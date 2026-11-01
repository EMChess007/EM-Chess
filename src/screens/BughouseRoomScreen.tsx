import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, SafeAreaView, ScrollView, Share, StyleSheet, View } from 'react-native';
import { emitWithin } from '../api/socketAck';
import { connectSocket, disconnectSocket } from '../api/socket';
import { Pressable } from '../components/AppPressable';
import { Text, TextInput } from '../components/AppText';
import LoadFailed from '../components/LoadFailed';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { logDiagnostic } from '../logic/diagnosticLog';
import { SERVER_UNREACHABLE_MESSAGE } from '../logic/loadError';
import type { BughouseTimeControl } from '../logic/bughouse/rules';
import {
  codeFromInviteText,
  filterBugRoomCodeInput,
  normalizeBugRoomCode,
  type BugFriendRoomView,
  type BugRoomAck,
  type BugRoomClosedPayload,
  type BugRoomStartAck,
  type BugRoomStartMode,
} from '../logic/bughouse/roomWire';
import type { BugMatchFoundPayload, BugQueueUpdatePayload } from '../logic/bughouse/wire';
import { viewFromMatchFound } from '../logic/bughouseOnline';
import { describeQueue, fillSecondsLeft } from '../logic/bughouseOnlineUi';
import { canFindOpponents, canStartWithBots, closedText, formatRoomCountdown, inviteMessage, ROOM_BUTTONS, roomHeadline, roomSecondsLeft, roomSlots } from '../logic/bughouseFriendRoomUi';

export type BughouseRoomMode = { kind: 'create'; timeControl: BughouseTimeControl } | { kind: 'join'; code?: string };

interface BughouseRoomScreenProps {
  authToken: string;
  mode: BughouseRoomMode;
  onMatchFound: (match: BugMatchFoundPayload, timeControlLabel: string) => void;
  /** Back to the Play menu (after leaving or closing the room). */
  onExit: () => void;
}

type Failure = { kind: 'unreachable'; retry: () => void } | { kind: 'refused'; text: string };

/**
 * BUGHOUSE FRIEND ROOMS (W6; BUGHOUSE_SPEC.md 5.7): one screen for the room, seen by the host ("Play with a friend") and by the friend ("Join with a code": the code field first, then the room).
 *   host   : the 6-character code with Copy and Share, the two slots (You / Friend: waiting), the countdown of the code's life, Find opponents (the pair enters the matchmaking as ONE group;
 *            with no friend yet it is a plain solo queue entry), Start with bots (needs the friend), Close room.
 *   friend : the host's name and "you are teammates", the same countdown, Leave. When the host starts, the friend's screen follows: the same queue, then the game.
 * The server owns every rule (backend bughouseFriendRooms.ts); this screen sends four requests and shows the room the server last described.
 *
 * EVERY NETWORK WAIT HAS A HARD LIMIT (CHECKLIST 6b): create, join and start go through `emitWithin` (6 s); an answer that does not come is "Can't reach the server" + Retry (create, join) or a
 * line under the buttons (start), with ONE `[BughouseRoom]` line in the Diagnostic Log. A refusal is shown as the server worded it - for a wrong code that is one sentence for every reason.
 * A lost connection ends the room (the server drops a disconnected member), and the screen says so.
 */
export default function BughouseRoomScreen({ authToken, mode, onMatchFound, onExit }: BughouseRoomScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [view, setView] = useState<{ room: BugFriendRoomView; receivedAt: number } | null>(null);
  const [queue, setQueue] = useState<{ payload: BugQueueUpdatePayload; receivedAt: number } | null>(null);
  const [soloQueued, setSoloQueued] = useState(false);
  const [closed, setClosed] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [codeText, setCodeText] = useState(mode.kind === 'join' ? filterBugRoomCodeInput(mode.code ?? '') : '');
  const [busy, setBusy] = useState(mode.kind === 'create');
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Leaving the room is sent on unmount unless a match began or the player already left on purpose.
  const inRoomRef = useRef(false);
  const labelRef = useRef('');
  const matchRef = useRef(onMatchFound);
  matchRef.current = onMatchFound;

  const socketOf = useCallback(() => connectSocket(authToken), [authToken]);

  const create = useCallback(() => {
    if (mode.kind !== 'create') return;
    setBusy(true);
    setFailure(null);
    emitWithin<BugRoomAck>(socketOf(), 'bug_room_create', { timeControl: mode.timeControl }, (result) => {
      setBusy(false);
      if (result.unreachable) {
        logDiagnostic("[BughouseRoom] bug_room_create was not answered; the room screen shows \"Can't reach the server\".");
        setFailure({ kind: 'unreachable', retry: create });
      } else if (!result.ack.ok) {
        logDiagnostic(`[BughouseRoom] bug_room_create refused: ${result.ack.reason}`);
        setFailure({ kind: 'refused', text: result.ack.error });
      } else {
        inRoomRef.current = true;
        labelRef.current = result.ack.room.timeControlLabel;
        setView({ room: result.ack.room, receivedAt: Date.now() });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socketOf]);

  const join = useCallback(
    (raw: string) => {
      const code = normalizeBugRoomCode(raw);
      setNotice(null);
      if (code === null) {
        setNotice('That code was not found or has expired.');
        return;
      }
      setBusy(true);
      setFailure(null);
      emitWithin<BugRoomAck>(socketOf(), 'bug_room_join', { code }, (result) => {
        setBusy(false);
        if (result.unreachable) {
          logDiagnostic("[BughouseRoom] bug_room_join was not answered; the room screen shows \"Can't reach the server\".");
          setFailure({ kind: 'unreachable', retry: () => join(raw) });
        } else if (!result.ack.ok) {
          logDiagnostic(`[BughouseRoom] bug_room_join refused: ${result.ack.reason}`); // (the reason only: a code is never logged)
          setNotice(result.ack.error);
        } else {
          inRoomRef.current = true;
          labelRef.current = result.ack.room.timeControlLabel;
          setView({ room: result.ack.room, receivedAt: Date.now() });
        }
      });
    },
    [socketOf]
  );

  useEffect(() => {
    const socket = socketOf();
    const onUpdate = (room: BugFriendRoomView) => {
      labelRef.current = room.timeControlLabel;
      setView({ room, receivedAt: Date.now() });
      if (room.phase === 'open') setQueue(null);
    };
    const onClosed = (payload: BugRoomClosedPayload) => {
      inRoomRef.current = false;
      setClosed(closedText(payload.reason));
    };
    const onQueue = (payload: BugQueueUpdatePayload) => setQueue({ payload, receivedAt: Date.now() });
    const onFound = (payload: BugMatchFoundPayload) => {
      inRoomRef.current = false; // the room is consumed by the match
      if (viewFromMatchFound(payload, Date.now()) === null) {
        logDiagnostic('[BughouseRoom] bug_match_found could not be read.');
        socket.emit('bug_resign', { roomId: (payload as { roomId?: unknown } | null)?.roomId });
        setClosed('The game could not be read from the server.');
        return;
      }
      matchRef.current(payload, labelRef.current);
    };
    const onDisconnect = () => {
      if (!inRoomRef.current && !soloRef.current) return;
      inRoomRef.current = false;
      setClosed('The connection was lost, so the room is closed.');
    };
    socket.on('bug_room_update', onUpdate);
    socket.on('bug_room_closed', onClosed);
    socket.on('bug_queue_update', onQueue);
    socket.on('bug_match_found', onFound);
    socket.on('disconnect', onDisconnect);
    if (mode.kind === 'create') create();
    return () => {
      socket.off('bug_room_update', onUpdate);
      socket.off('bug_room_closed', onClosed);
      socket.off('bug_queue_update', onQueue);
      socket.off('bug_match_found', onFound);
      socket.off('disconnect', onDisconnect);
      if (inRoomRef.current) socket.emit('bug_room_leave');
      else if (soloRef.current) socket.emit('bug_leave_queue', {});
    };
    // fixed for the screen's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const soloRef = useRef(false);
  soloRef.current = soloQueued;

  // Redraws the countdowns twice a second.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const start = (startMode: BugRoomStartMode) => {
    setNotice(null);
    emitWithin<BugRoomStartAck>(socketOf(), 'bug_room_start', { mode: startMode }, (result) => {
      if (result.unreachable) {
        logDiagnostic("[BughouseRoom] bug_room_start was not answered; the room screen shows \"Can't reach the server\".");
        setNotice(SERVER_UNREACHABLE_MESSAGE);
      } else if (!result.ack.ok) {
        logDiagnostic(`[BughouseRoom] bug_room_start refused: ${result.ack.reason}`);
        setNotice(result.ack.error);
      } else if (result.ack.outcome === 'solo') {
        inRoomRef.current = false; // the room was closed: the host is a plain queue entry now
        setSoloQueued(true);
      }
    });
  };

  const leaveRoom = () => {
    const socket = socketOf();
    if (inRoomRef.current) socket.emit('bug_room_leave');
    inRoomRef.current = false;
    onExit();
  };

  const cancelQueue = () => {
    const socket = socketOf();
    if (soloQueued) {
      socket.emit('bug_leave_queue', {});
      setSoloQueued(false);
      soloRef.current = false;
      disconnectSocket();
      onExit();
      return;
    }
    // a pair: the server cancels the entry and puts BOTH back in the open room (bug_room_update)
    socket.emit('bug_leave_queue', {});
  };

  const copyCode = async (room: BugFriendRoomView) => {
    try {
      await Clipboard.setStringAsync(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice('Could not copy. Select the code and copy it by hand.');
    }
  };

  const share = async (room: BugFriendRoomView) => {
    const base = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : null;
    const message = inviteMessage(room.code, base);
    if (Platform.OS === 'web') {
      // the web has no share sheet everywhere: the invite goes to the clipboard
      try {
        await Clipboard.setStringAsync(message);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        setNotice('Invite link copied. Paste it to your friend.');
      } catch {
        setNotice('Could not copy the invite. Select the code and send it by hand.');
      }
      return;
    }
    Share.share({ message }).catch(() => {});
  };

  // --- what to draw ---
  const room = view?.room ?? null;
  const showJoinForm = mode.kind === 'join' && room === null && closed === null && failure === null;

  let body;
  if (closed !== null) {
    body = (
      <>
        <Text style={styles.errorText} testID="bughouse-room-closed">
          {closed}
        </Text>
        <Pressable style={styles.button} onPress={onExit} testID="bughouse-room-back">
          <Text style={styles.buttonText}>Back to menu</Text>
        </Pressable>
      </>
    );
  } else if (failure?.kind === 'unreachable') {
    body = (
      <>
        <LoadFailed message={SERVER_UNREACHABLE_MESSAGE} onRetry={failure.retry} testID="bughouse-room-failed" />
        <Pressable style={styles.button} onPress={onExit} testID="bughouse-room-back">
          <Text style={styles.buttonText}>Back to menu</Text>
        </Pressable>
      </>
    );
  } else if (failure?.kind === 'refused') {
    body = (
      <>
        <Text style={styles.errorText} testID="bughouse-room-error">
          {failure.text}
        </Text>
        <Pressable style={styles.button} onPress={onExit} testID="bughouse-room-back">
          <Text style={styles.buttonText}>Back to menu</Text>
        </Pressable>
      </>
    );
  } else if (soloQueued || (room !== null && room.phase === 'queued')) {
    const secondsLeft = fillSecondsLeft(queue?.payload ?? null, queue?.receivedAt ?? 0, now);
    const text = describeQueue(queue?.payload ?? null, secondsLeft);
    body = (
      <>
        <ActivityIndicator size="large" color={colors.text} />
        <Text style={styles.queueTitle} testID="bughouse-room-queue-title">
          {soloQueued ? text.title : `${text.title} (you and your friend are one team)`}
        </Text>
        <Text style={styles.queueDetail} testID="bughouse-room-queue-detail">
          {text.detail}
        </Text>
        <Pressable style={styles.button} onPress={cancelQueue} testID="bughouse-room-queue-cancel">
          <Text style={styles.buttonText}>Cancel</Text>
        </Pressable>
      </>
    );
  } else if (showJoinForm) {
    body = (
      <>
        <Text style={styles.title}>Join with a code</Text>
        <Text style={styles.hint}>Enter the 6-character code your friend sent you, or paste their invite link.</Text>
        <TextInput
          testID="join-code-input"
          accessibilityLabel="Room code"
          style={styles.codeInput}
          value={codeText}
          onChangeText={(text) => setCodeText(codeFromInviteText(text) ?? filterBugRoomCodeInput(text))}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="ABC234"
          placeholderTextColor={colors.textMuted}
          maxFontSizeMultiplier={1.3}
          onSubmitEditing={() => join(codeText)}
        />
        {notice !== null && (
          <Text style={styles.errorText} testID="join-code-error">
            {notice}
          </Text>
        )}
        <Pressable style={[styles.button, (busy || codeText.length < 6) && styles.buttonDisabled]} disabled={busy || codeText.length < 6} onPress={() => join(codeText)} testID="join-code-submit">
          <Text style={styles.buttonText}>{busy ? 'Joining…' : 'Join'}</Text>
        </Pressable>
        <Pressable style={styles.linkButton} onPress={onExit} testID="join-code-back">
          <Text style={styles.linkText}>‹ Back</Text>
        </Pressable>
      </>
    );
  } else if (room === null) {
    body = (
      <>
        <ActivityIndicator size="large" color={colors.text} />
        <Text style={styles.queueDetail}>Opening your room…</Text>
        <Pressable style={styles.linkButton} onPress={onExit} testID="bughouse-room-back">
          <Text style={styles.linkText}>‹ Back</Text>
        </Pressable>
      </>
    );
  } else {
    const slots = roomSlots(room);
    const left = roomSecondsLeft(room, view?.receivedAt ?? now, now);
    const host = room.youAre === 'host';
    body = (
      <>
        <Text style={styles.title}>{host ? 'Play with a friend' : 'Friend room'}</Text>
        <Text style={styles.hint} testID="bughouse-room-headline">
          {roomHeadline(room)}
        </Text>
        <Text style={styles.code} testID="bughouse-room-code" accessibilityLabel={`Room code ${room.code.split('').join(' ')}`} selectable maxFontSizeMultiplier={1.3}>
          {room.code}
        </Text>
        {host && (
          <View style={styles.row}>
            <Pressable style={styles.smallButton} onPress={() => copyCode(room)} testID="bughouse-room-copy">
              <Text style={styles.smallButtonText}>{copied ? 'Copied' : ROOM_BUTTONS.copy}</Text>
            </Pressable>
            <Pressable style={styles.smallButton} onPress={() => share(room)} testID="bughouse-room-share">
              <Text style={styles.smallButtonText}>{ROOM_BUTTONS.share}</Text>
            </Pressable>
          </View>
        )}
        <View style={styles.slots}>
          <Text style={styles.slot} testID="bughouse-room-slot-1">
            {slots.first}
          </Text>
          <Text style={[styles.slot, slots.friendWaiting && styles.slotWaiting]} testID="bughouse-room-slot-2">
            {slots.second}
          </Text>
        </View>
        <Text style={styles.hint} testID="bughouse-room-countdown" accessibilityLabel={`The code works for ${formatRoomCountdown(left)} more`}>
          {left > 0 ? `The code works for ${formatRoomCountdown(left)}` : 'The code has expired.'}
        </Text>
        {notice !== null && (
          <Text style={styles.errorText} testID="bughouse-room-notice">
            {notice}
          </Text>
        )}
        {host ? (
          <>
            <Pressable style={[styles.button, !canFindOpponents(room) && styles.buttonDisabled]} disabled={!canFindOpponents(room)} onPress={() => start('queue')} testID="bughouse-room-find">
              <Text style={styles.buttonText}>{ROOM_BUTTONS.findOpponents}</Text>
            </Pressable>
            <Pressable style={[styles.button, !canStartWithBots(room) && styles.buttonDisabled]} disabled={!canStartWithBots(room)} onPress={() => start('bots')} testID="bughouse-room-bots">
              <Text style={styles.buttonText}>{ROOM_BUTTONS.startWithBots}</Text>
            </Pressable>
            <Pressable style={styles.linkButton} onPress={leaveRoom} testID="bughouse-room-close">
              <Text style={styles.linkText}>{ROOM_BUTTONS.closeRoom}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.hint}>Waiting for the host to start.</Text>
            <Pressable style={styles.linkButton} onPress={leaveRoom} testID="bughouse-room-leave">
              <Text style={styles.linkText}>{ROOM_BUTTONS.leaveRoom}</Text>
            </Pressable>
          </>
        )}
      </>
    );
  }

  return (
    <SafeAreaView style={styles.container} testID="bughouse-room">
      <ScrollView contentContainerStyle={styles.content}>{body}</ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 24, paddingHorizontal: 20 },
    title: { fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center' },
    hint: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
    code: { fontSize: 40, fontWeight: '800', letterSpacing: 6, color: colors.text, textAlign: 'center' },
    row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 },
    slots: { alignSelf: 'stretch', gap: 8 },
    slot: { fontSize: 16, color: colors.text, textAlign: 'center', paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
    slotWaiting: { color: colors.textMuted, borderStyle: 'dashed' },
    queueTitle: { fontSize: 16, fontWeight: '600', color: colors.text, textAlign: 'center' },
    queueDetail: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
    errorText: { fontSize: 15, color: colors.danger, textAlign: 'center' },
    codeInput: { alignSelf: 'stretch', fontSize: 28, fontWeight: '700', letterSpacing: 4, textAlign: 'center', color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12 },
    button: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 28, backgroundColor: colors.buttonBackground, borderRadius: 8 },
    buttonDisabled: { opacity: 0.45 },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    smallButton: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 20, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
    smallButtonText: { color: colors.text, fontSize: 15, fontWeight: '600' },
    linkButton: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16 },
    linkText: { color: colors.textSecondary, fontSize: 15 },
  });
}
