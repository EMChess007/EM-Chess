import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { chaturajiRulesSheet } from '../logic/chaturajiUi';

interface ChaturajiRulesSheetProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * The Chaturaji rules, as a sheet that opens over whatever screen asked for it - the Play menu's Chaturaji card, the setup screen and the game's control bar (CHATURAJI_SPEC.md
 * section 9). The text is `chaturajiRulesSheet()`: every number in it comes from the engine's own constants, so it cannot say something the game does not do.
 */
export default function ChaturajiRulesSheet({ visible, onClose }: ChaturajiRulesSheetProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* The sheet itself is only rendered while it is open, so closing it takes the text off the page at once (the modal's own fade only dims the backdrop). */}
        {visible && (
          <View style={styles.sheet} accessibilityViewIsModal accessibilityLabel="Chaturaji rules">
            <Text style={styles.title}>How to play Chaturaji</Text>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
              {chaturajiRulesSheet().map((section) => (
                <View key={section.title} style={styles.section}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  {section.lines.map((line) => (
                    <Text key={line} style={styles.line}>
                      {line}
                    </Text>
                  ))}
                </View>
              ))}
            </ScrollView>
            <Pressable accessibilityRole="button" accessibilityLabel="Close the rules" testID="rules-close" style={styles.close} onPress={onClose}>
              <Text style={styles.closeText}>Got it</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 16 },
    sheet: { maxHeight: '90%', borderRadius: 14, padding: 16, gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    title: { fontSize: 19, fontWeight: '800', color: colors.text },
    scroll: { flexGrow: 0 },
    scrollContent: { gap: 12, paddingBottom: 4 },
    section: { gap: 4 },
    sectionTitle: { fontSize: 14, fontWeight: '800', color: colors.gold },
    line: { fontSize: 14, lineHeight: 20, color: colors.text },
    close: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: colors.buttonBackground },
    closeText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  });
}
