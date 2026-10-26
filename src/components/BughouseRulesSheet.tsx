import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { bughouseRulesSheet } from '../logic/bughouseRulesSheet';

interface BughouseRulesSheetProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * The Bughouse rules, as a sheet over whatever screen asked for it - the Play menu's Bughouse card, the setup screen and the game's control row. The text is `bughouseRulesSheet()`:
 * the numbers that exist as constants in the engine are read from it, so it cannot name a time control the game does not offer.
 */
export default function BughouseRulesSheet({ visible, onClose }: BughouseRulesSheetProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Rendered only while open, so closing takes the text off the page at once. */}
        {visible && (
          <View style={styles.sheet} accessibilityViewIsModal accessibilityLabel="Bughouse rules" testID="bughouse-rules-sheet">
            <Text style={styles.title}>How to play Bughouse</Text>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
              {bughouseRulesSheet().map((section) => (
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
            <Pressable accessibilityRole="button" accessibilityLabel="Close the rules" testID="bughouse-rules-close" style={styles.close} onPress={onClose}>
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
