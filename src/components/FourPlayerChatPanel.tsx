import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './AppText';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { SEAT_COLORS } from '../logic/fourPlayer';
import type { FourChatEntry } from '../logic/fourPlayerOnlineUi';

interface FourPlayerChatPanelProps {
  messages: readonly FourChatEntry[];
  /** Omit for a read-only panel (a spectator sees the table's chat but cannot write in it). */
  onSend?: (text: string) => void;
}

/**
 * The chat of an online 4 Player table: everything the other humans (and the viewer) said, newest at the bottom, and — for a seated
 * player — a box to write in. One line per message, the sender's name in their seat colour. The server relays a message to every other
 * seat and spectator and drops over-long or too-fast ones (it cuts at 500 characters; the box stops you well before that).
 */
export default function FourPlayerChatPanel({ messages, onSend }: FourPlayerChatPanelProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [draft, setDraft] = useState('');
  const scroller = useRef<ScrollView | null>(null);

  useEffect(() => {
    scroller.current?.scrollToEnd({ animated: false });
  }, [messages.length]);

  const send = () => {
    const text = draft.trim();
    if (!text || !onSend) return;
    setDraft('');
    onSend(text);
  };

  return (
    <View style={styles.panel}>
      <ScrollView ref={scroller} style={styles.messages} contentContainerStyle={styles.messagesContent}>
        {messages.length === 0 && <Text style={styles.empty}>{onSend ? 'No messages yet.' : 'No messages yet. Spectators can read the chat but not write in it.'}</Text>}
        {messages.map((message) => (
          <Text key={message.id} style={[styles.message, message.mine && styles.mine]}>
            <Text style={{ color: message.fromSeat === null ? colors.text : SEAT_COLORS[message.fromSeat], fontWeight: '700' }}>{message.name}</Text>: {message.text}
          </Text>
        ))}
      </ScrollView>
      {onSend && (
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message the table..."
            placeholderTextColor={colors.textMuted}
            onSubmitEditing={send}
            returnKeyType="send"
            maxLength={500}
          />
          <Pressable style={styles.sendButton} onPress={send}>
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    panel: { width: '90%', maxWidth: 340, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8, gap: 8 },
    messages: { maxHeight: 90 },
    messagesContent: { gap: 4 },
    empty: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic' },
    message: { fontSize: 13, color: colors.text },
    mine: { fontWeight: '600' },
    inputRow: { flexDirection: 'row', gap: 8 },
    input: { flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10, fontSize: 13, color: colors.text },
    sendButton: { paddingVertical: 6, paddingHorizontal: 14, backgroundColor: colors.buttonBackground, borderRadius: 6, justifyContent: 'center' },
    sendText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  });
}
