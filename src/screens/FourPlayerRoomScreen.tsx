import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, SafeAreaView, ScrollView, Share, StyleSheet, View } from 'react-native';
import { emitWithin } from '../api/socketAck';
import { connectSocket } from '../api/socket';
import { Pressable } from '../components/AppPressable';
import { Text } from '../components/AppText';
import LoadFailed from '../components/LoadFailed';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { logDiagnostic } from '../logic/diagnosticLog';
import { formatRoomCountdown, roomSecondsLeft } from '../logic/bughouseFriendRoomUi';
import { SERVER_UNREACHABLE_MESSAGE } from '../logic/loadError';
import type { FourFriendRoomView, FourRoomAck, FourRoomClosedPayload, FourRoomStartAck } from '../logic/fourPlayerRoomWire';
import { canStartRoom, closedText, inviteText, roomHeadline, roomLines, startText } from '../logic/fourPlayerRoomUi';
import { variantTitle } from '../logic/fourPlayerVariant';
import { checkMatchVariant } from '../logic/fourPlayerOnlineUi';
import type { FourMatchFoundPayload, FourTimeControl, FourVariant } from '../logic/fourPlayerWire';

/** `joined`: the player is ALREADY in the room (Challenge a Friend's "Join by Code" found it); the screen starts from the view the join answered with. */
export type FourPlayerRoomMode = { kind: 'create'; variant: FourVariant; timeControl: FourTimeControl } | { kind: 'joined'; room: FourFriendRoomView };

interface FourPlayerRoomScreenProps {
  authToken: string;
  mode: FourPlayerRoomMode;
  /** The game began (the host started it): the same hand-off as the queue's. */
  onMatchFound: (match: FourMatchFoundPayload) => void;
  /** Back to the Play menu (after leaving or closing the room). */
  onExit: () => void;
}

type Failure = { kind: 'unreachable'; retry: () => void } | { kind: 'refused'; text: string };

/**
 * 4-SEAT FRIEND ROOMS (command #35): one screen for the room of 4 Player Chess, 4 Player Giveaway and Chaturaji, seen by the host ("Challenge a Friend" > Create Challenge) and by a friend (who entered the
 * code in "Join by Code" - that screen joined already and hands the room over). The host sees the 6-character code with Copy and Share, the four seats (the friends, then "Bot fills this seat" for
 * every empty one), the countdown of the code's life, Start (needs one friend; the bots take the empty seats and the game begins at once) and Close room. A friend sees the same seats, the
 * countdown, "Waiting for the host to start" and Leave. The server owns every rule (backend friendRooms.ts); this screen sends create / start / leave and shows the room the server last described.
 *
 * EVERY NETWORK WAIT HAS A HARD LIMIT (CHECKLIST 6b): create and start go through `emitWithin` (6 s); an answer that does not come is "Can't reach the server" + Retry (create) or a line under the
 * buttons (start), with ONE `[FourRoom]` line in the Diagnostic Log. A lost connection ends the room (the server drops a disconnected member), and the screen says so.
 */
export default function FourPlayerRoomScreen({ authToken, mode, onMatchFound, onExit }: FourPlayerRoomScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [view, setView] = useState<{ room: FourFriendRoomView; receivedAt: number } | null>(() => (mode.kind === 'joined' ? { room: mode.room, receivedAt: Date.now() } : null));
  const [closed, setClosed] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Leaving the room is sent on unmount unless the game began or the player already left on purpose.
  const inRoomRef = useRef(mode.kind === 'joined');
  const variantRef = useRef<FourVariant>(mode.kind === 'joined' ? mode.room.variant : mode.variant);
  const matchRef = useRef(onMatchFound);
  matchRef.current = onMatchFound;

  const socketOf = useCallback(() => connectSocket(authToken), [authToken]);

  const create = useCallback(() => {
    if (mode.kind !== 'create') return;
    setFailure(null);
    emitWithin<FourRoomAck>(socketOf(), 'four_room_create', { variant: mode.variant, timeControl: mode.timeControl }, (result) => {
      if (result.unreachable) {
        logDiagnostic("[FourRoom] four_room_create was not answered; the room screen shows \"Can't reach the server\".");
        setFailure({ kind: 'unreachable', retry: create });
      } else if (!result.ack.ok) {
        logDiagnostic('[FourRoom] four_room_create refused.');
        setFailure({ kind: 'refused', text: result.ack.error });
      } else {
        inRoomRef.current = true;
        setView({ room: result.ack.room, receivedAt: Date.now() });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socketOf]);

  useEffect(() => {
    const socket = socketOf();
    const onUpdate = (room: FourFriendRoomView) => setView({ room, receivedAt: Date.now() });
    const onClosed = (payload: FourRoomClosedPayload) => {
      inRoomRef.current = false;
      setClosed(closedText(payload.reason));
    };
    const onFound = (payload: FourMatchFoundPayload) => {
      inRoomRef.current = false; // the room is consumed by the game
      const check = checkMatchVariant(variantRef.current, payload);
      if (!check.ok) {
        logDiagnostic('[FourRoom] four_match_found was for another game.');
        socket.emit('four_resign', { roomId: payload.roomId });
        setClosed(check.error);
        return;
      }
      matchRef.current(payload);
    };
    const onDisconnect = () => {
      if (!inRoomRef.current) return;
      inRoomRef.current = false;
      setClosed('The connection was lost, so the room is closed.');
    };
    socket.on('four_room_update', onUpdate);
    socket.on('four_room_closed', onClosed);
    socket.on('four_match_found', onFound);
    socket.on('disconnect', onDisconnect);
    if (mode.kind === 'create') create();
    return () => {
      socket.off('four_room_update', onUpdate);
      socket.off('four_room_closed', onClosed);
      socket.off('four_match_found', onFound);
      socket.off('disconnect', onDisconnect);
      if (inRoomRef.current) socket.emit('four_room_leave', {});
    };
    // fixed for the screen's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraws the countdown twice a second.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const start = () => {
    setNotice(null);
    emitWithin<FourRoomStartAck>(socketOf(), 'four_room_start', {}, (result) => {
      if (result.unreachable) {
        logDiagnostic("[FourRoom] four_room_start was not answered; the room screen shows \"Can't reach the server\".");
        setNotice(SERVER_UNREACHABLE_MESSAGE);
      } else if (!result.ack.ok) {
        logDiagnostic('[FourRoom] four_room_start refused.');
        setNotice(result.ack.error);
      }
    });
  };

  const leaveRoom = () => {
    if (inRoomRef.current) socketOf().emit('four_room_leave', {});
    inRoomRef.current = false;
    onExit();
  };

  const copyCode = async (room: FourFriendRoomView) => {
    try {
      await Clipboard.setStringAsync(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice('Could not copy. Select the code and copy it by hand.');
    }
  };

  const share = async (room: FourFriendRoomView) => {
    const message = inviteText(room.code, variantTitle(room.variant));
    if (Platform.OS === 'web') {
      try {
        await Clipboard.setStringAsync(message);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        setNotice('Invite copied. Paste it to your friends.');
      } catch {
        setNotice('Could not copy the invite. Select the code and send it by hand.');
      }
      return;
    }
    Share.share({ message }).catch(() => {});
  };

  const room = view?.room ?? null;
  let body;
  if (closed !== null) {
    body = (
      <>
        <Text style={styles.errorText} testID="four-room-closed">
          {closed}
        </Text>
        <Pressable style={styles.button} onPress={onExit} testID="four-room-back">
          <Text style={styles.buttonText}>Back to menu</Text>
        </Pressable>
      </>
    );
  } else if (failure?.kind === 'unreachable') {
    body = (
      <>
        <LoadFailed message={SERVER_UNREACHABLE_MESSAGE} onRetry={failure.retry} testID="four-room-failed" />
        <Pressable style={styles.button} onPress={onExit} testID="four-room-back">
          <Text style={styles.buttonText}>Back to menu</Text>
        </Pressable>
      </>
    );
  } else if (failure?.kind === 'refused') {
    body = (
      <>
        <Text style={styles.errorText} testID="four-room-error">
          {failure.text}
        </Text>
        <Pressable style={styles.button} onPress={onExit} testID="four-room-back">
          <Text style={styles.buttonText}>Back to menu</Text>
        </Pressable>
      </>
    );
  } else if (room === null) {
    body = (
      <>
        <ActivityIndicator size="large" color={colors.text} />
        <Text style={styles.hint}>Opening your room…</Text>
        <Pressable style={styles.linkButton} onPress={onExit} testID="four-room-back">
          <Text style={styles.linkText}>‹ Back</Text>
        </Pressable>
      </>
    );
  } else {
    const left = roomSecondsLeft(room, view?.receivedAt ?? now, now);
    const host = room.youAre === 'host';
    const lines = roomLines(room);
    body = (
      <>
        <Text style={styles.title}>{host ? 'Challenge a Friend' : 'Friend room'}</Text>
        <Text style={styles.hint} testID="four-room-headline">
          {roomHeadline(room)}
        </Text>
        <Text style={styles.code} testID="four-room-code" accessibilityLabel={`Room code ${room.code.split('').join(' ')}`} selectable maxFontSizeMultiplier={1.3}>
          {room.code}
        </Text>
        {host && (
          <View style={styles.row}>
            <Pressable style={styles.smallButton} onPress={() => copyCode(room)} testID="four-room-copy">
              <Text style={styles.smallButtonText}>{copied ? 'Copied' : 'Copy'}</Text>
            </Pressable>
            <Pressable style={styles.smallButton} onPress={() => share(room)} testID="four-room-share">
              <Text style={styles.smallButtonText}>Share</Text>
            </Pressable>
          </View>
        )}
        <View style={styles.slots}>
          {lines.map((line, index) => (
            <Text key={index} style={[styles.slot, line.bot && styles.slotWaiting]} testID={`four-room-slot-${index + 1}`}>
              {line.text}
            </Text>
          ))}
        </View>
        <Text style={styles.hint} testID="four-room-countdown" accessibilityLabel={`The code works for ${formatRoomCountdown(left)} more`}>
          {left > 0 ? `The code works for ${formatRoomCountdown(left)}` : 'The code has expired.'}
        </Text>
        {notice !== null && (
          <Text style={styles.errorText} testID="four-room-notice">
            {notice}
          </Text>
        )}
        {host ? (
          <>
            <Pressable style={[styles.button, !canStartRoom(room) && styles.buttonDisabled]} disabled={!canStartRoom(room)} onPress={start} testID="four-room-start" accessibilityLabel={startText(room)}>
              <Text style={styles.buttonText}>{startText(room)}</Text>
            </Pressable>
            <Pressable style={styles.linkButton} onPress={leaveRoom} testID="four-room-close">
              <Text style={styles.linkText}>Close room</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.hint}>Waiting for the host to start.</Text>
            <Pressable style={styles.linkButton} onPress={leaveRoom} testID="four-room-leave">
              <Text style={styles.linkText}>Leave</Text>
            </Pressable>
          </>
        )}
      </>
    );
  }

  return (
    <SafeAreaView style={styles.container} testID="four-room">
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
    errorText: { fontSize: 15, color: colors.danger, textAlign: 'center' },
    button: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 28, backgroundColor: colors.buttonBackground, borderRadius: 8 },
    buttonDisabled: { opacity: 0.45 },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },
    smallButton: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 20, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
    smallButtonText: { color: colors.text, fontSize: 15, fontWeight: '600' },
    linkButton: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16 },
    linkText: { color: colors.textSecondary, fontSize: 15 },
  });
}
