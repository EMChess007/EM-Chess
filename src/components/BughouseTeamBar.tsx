import { useEffect, useRef, useState } from 'react';
import { ScrollView, type ScrollViewInstance, StyleSheet, View } from 'react-native';
import { Pressable } from './AppPressable';
import { Text, TextInput } from './AppText';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { QUICK_MESSAGES, QUICK_TOAST_MS, TEAM_CHAT_EMPTY, TEAM_CHAT_HEADER, type QuickNotice, type TeamChatEntry } from '../logic/bughouseOnlineUi';
import type { SendOutcome } from '../logic/bughouseOnlineSession';

interface BughouseTeamBarProps {
  /** The partner's name, for the toast ("Sam: Need a knight"). */
  partnerName: string;
  chat: readonly TeamChatEntry[];
  /** The newest quick message from the partner; the toast shows it for QUICK_TOAST_MS each time its id changes. */
  quick: QuickNotice | null;
  onQuick: (code: number, done: (outcome: SendOutcome) => void) => void;
  onChat: (text: string, done: (outcome: SendOutcome) => void) => void;
}

type Open = 'quick' | 'chat' | null;

/**
 * The team strip of an online Bughouse game (W4b; BUGHOUSE_SPEC.md 5.4 / HP10): the Quick grid of ten one-tap messages and the team-chat panel, both for my PARTNER only (the server computes
 * the recipients; this bar says so in words), and the non-blocking toast a quick message from the partner shows at the top edge. It sits BELOW the game screen, never over a board, and the
 * toast has `pointerEvents` off so a finger on a square is never eaten by it.
 */
export default function BughouseTeamBar({ partnerName, chat, quick, onQuick, onChat }: BughouseTeamBarProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [open, setOpen] = useState<Open>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [toast, setToast] = useState<QuickNotice | null>(null);
  const [unread, setUnread] = useState(0);
  const scroller = useRef<ScrollViewInstance | null>(null);
  const seenChat = useRef(chat.length);

  useEffect(() => {
    if (quick === null) return;
    setToast(quick);
    const timer = setTimeout(() => setToast((current) => (current?.id === quick.id ? null : current)), QUICK_TOAST_MS);
    return () => clearTimeout(timer);
  }, [quick]);

  useEffect(() => {
    if (open === 'chat') {
      seenChat.current = chat.length;
      setUnread(0);
      scroller.current?.scrollToEnd({ animated: false });
    } else {
      setUnread(chat.slice(seenChat.current).filter((line) => !line.mine).length);
    }
  }, [chat, open]);

  const toggle = (which: Exclude<Open, null>) => {
    setProblem(null);
    setOpen((current) => (current === which ? null : which));
  };
  const sendQuick = (code: number) => {
    setProblem(null);
    setOpen(null);
    onQuick(code, setProblem);
  };
  const sendChat = () => {
    const text = draft.trim();
    if (text === '') return;
    setDraft('');
    setProblem(null);
    onChat(text, setProblem);
  };

  return (
    <View style={styles.wrap} testID="bughouse-team-bar">
      {toast !== null && (
        <View pointerEvents="none" style={styles.toast} testID="bughouse-quick-toast" accessibilityLiveRegion="polite" accessibilityLabel={`${partnerName}: ${toast.text}`}>
          <Text style={styles.toastText}>{`${partnerName}: ${toast.text}`}</Text>
        </View>
      )}
      {open === 'quick' && (
        <View style={styles.panel} testID="bughouse-quick-grid">
          <Text style={styles.header}>Quick message to your partner</Text>
          <View style={styles.grid}>
            {QUICK_MESSAGES.map((text, code) => (
              <Pressable key={code} accessibilityRole="button" accessibilityLabel={`Quick message: ${text}`} testID={`bughouse-quick-${code}`} style={styles.quickButton} onPress={() => sendQuick(code)}>
                <Text style={styles.quickText}>{text}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
      {open === 'chat' && (
        <View style={styles.panel} testID="bughouse-team-chat">
          <Text style={styles.header} testID="bughouse-team-chat-header">
            {TEAM_CHAT_HEADER}
          </Text>
          <ScrollView ref={scroller} style={styles.messages} contentContainerStyle={styles.messagesContent}>
            {chat.length === 0 && <Text style={styles.empty}>{TEAM_CHAT_EMPTY}</Text>}
            {chat.map((line) => (
              <Text key={line.id} style={[styles.message, line.mine && styles.mine]}>
                <Text style={styles.sender}>{line.mine ? 'You' : line.name}</Text>: {line.text}
              </Text>
            ))}
          </ScrollView>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Message your partner..."
              placeholderTextColor={colors.textMuted}
              onSubmitEditing={sendChat}
              returnKeyType="send"
              maxLength={500}
              testID="bughouse-team-chat-input"
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Send to your partner" testID="bughouse-team-chat-send" style={styles.send} onPress={sendChat}>
              <Text style={styles.sendText}>Send</Text>
            </Pressable>
          </View>
        </View>
      )}
      {problem !== null && (
        <Text style={styles.problem} testID="bughouse-team-problem">
          {problem}
        </Text>
      )}
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel="Quick messages" testID="bughouse-quick" style={[styles.button, open === 'quick' && styles.buttonActive]} onPress={() => toggle('quick')}>
          <Text style={styles.buttonText}>Quick</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Team chat" testID="bughouse-chat" style={[styles.button, open === 'chat' && styles.buttonActive]} onPress={() => toggle('chat')}>
          <Text style={styles.buttonText}>{unread > 0 ? `Team chat (${unread})` : 'Team chat'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    wrap: { paddingHorizontal: 8, paddingBottom: 6, gap: 6, backgroundColor: colors.background },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
    button: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 8, backgroundColor: colors.buttonBackground },
    buttonActive: { opacity: 0.75 },
    buttonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
    toast: { position: 'absolute', top: -44, left: 12, right: 12, alignItems: 'center', zIndex: 5 },
    toastText: { backgroundColor: 'rgba(30,30,30,0.92)', color: '#fff', fontSize: 14, fontWeight: '700', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, overflow: 'hidden' },
    panel: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8, gap: 8, backgroundColor: colors.surface },
    header: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    quickButton: { flexBasis: '48%', flexGrow: 1, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8, backgroundColor: colors.buttonBackground, alignItems: 'center' },
    quickText: { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' },
    messages: { maxHeight: 96 },
    messagesContent: { gap: 4 },
    empty: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic' },
    message: { fontSize: 13, color: colors.text },
    mine: { fontWeight: '600' },
    sender: { fontWeight: '700' },
    inputRow: { flexDirection: 'row', gap: 8 },
    input: { flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10, fontSize: 13, color: colors.text },
    send: { paddingVertical: 6, paddingHorizontal: 14, backgroundColor: colors.buttonBackground, borderRadius: 6, justifyContent: 'center' },
    sendText: { color: '#fff', fontSize: 13, fontWeight: '600' },
    problem: { fontSize: 13, color: colors.danger, textAlign: 'center' },
  });
}
