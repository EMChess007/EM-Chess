import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from './AppPressable';
import { Text } from './AppText';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { RACING_KINGS_RULES_CLOSE, RACING_KINGS_RULES_TITLE, type RacingKingsRulesLang, racingKingsRulesSheet } from '../logic/racingKingsRules';

interface RacingKingsRulesSheetProps {
  visible: boolean;
  onClose: () => void;
}

/** The Racing Kings "how to play" sheet, English and Greek (a small EN / EL switch at the top). Text: `racingKingsRulesSheet()`. */
export default function RacingKingsRulesSheet({ visible, onClose }: RacingKingsRulesSheetProps) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const styles = createStyles(colors);
  const [lang, setLang] = useState<RacingKingsRulesLang>('en');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { paddingTop: 16 + insets.top, paddingBottom: 16 + insets.bottom, paddingLeft: 16 + insets.left, paddingRight: 16 + insets.right }]}>
        {visible && (
          <View style={styles.sheet} accessibilityViewIsModal accessibilityLabel="Racing Kings rules">
            <View style={styles.titleRow}>
              <Text style={styles.title}>{RACING_KINGS_RULES_TITLE[lang]}</Text>
              <View style={styles.langRow}>
                {(['en', 'el'] as const).map((code) => (
                  <Pressable
                    key={code}
                    accessibilityRole="button"
                    accessibilityLabel={code === 'en' ? 'English' : 'Ελληνικά'}
                    testID={`rules-lang-${code}`}
                    style={[styles.langChip, lang === code && styles.langChipSelected]}
                    onPress={() => setLang(code)}
                  >
                    <Text style={[styles.langText, lang === code && styles.langTextSelected]}>{code.toUpperCase()}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
              {racingKingsRulesSheet(lang).map((section) => (
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
              <Text style={styles.closeText}>{RACING_KINGS_RULES_CLOSE[lang]}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center' },
    sheet: { maxHeight: '90%', borderRadius: 14, padding: 16, gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    title: { flex: 1, fontSize: 19, fontWeight: '800', color: colors.text },
    langRow: { flexDirection: 'row', gap: 6 },
    langChip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
    langChipSelected: { backgroundColor: colors.buttonBackground, borderColor: colors.buttonBackground },
    langText: { fontSize: 13, fontWeight: '700', color: colors.text },
    langTextSelected: { color: '#fff' },
    scroll: { flexGrow: 0 },
    scrollContent: { gap: 12, paddingBottom: 4 },
    section: { gap: 4 },
    sectionTitle: { fontSize: 14, fontWeight: '800', color: colors.gold },
    line: { fontSize: 14, lineHeight: 20, color: colors.text },
    close: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: colors.buttonBackground },
    closeText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  });
}
