import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from './AppPressable';
import { Text } from './AppText';
import Piece from './Piece';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { useActivePieceTheme } from '../logic/themeHooks';
import {
  KNIGHTMATE_LEGEND_TITLE,
  KNIGHTMATE_RULES_CLOSE,
  KNIGHTMATE_RULES_TITLE,
  type KnightmateRulesLang,
  knightmateLegend,
  knightmateRulesSheet,
} from '../logic/knightmateRules';

interface KnightmateRulesSheetProps {
  visible: boolean;
  onClose: () => void;
}

const LEGEND_PIECE_SIZE = 44;

/**
 * The Knightmate "how to play" sheet, English and Greek (a small EN / EL switch at the top). Text: `knightmateRulesSheet()` and `knightmateLegend()`. The legend draws the real pieces
 * of the ACTIVE piece theme (the royal knight with its crown badge, the Commoner with its "M" badge), so what the sheet shows is what the board shows.
 */
export default function KnightmateRulesSheet({ visible, onClose }: KnightmateRulesSheetProps) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const pieceTheme = useActivePieceTheme();
  const styles = createStyles(colors);
  const [lang, setLang] = useState<KnightmateRulesLang>('en');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { paddingTop: 16 + insets.top, paddingBottom: 16 + insets.bottom, paddingLeft: 16 + insets.left, paddingRight: 16 + insets.right }]}>
        {visible && (
          <View style={styles.sheet} accessibilityViewIsModal accessibilityLabel="Knightmate rules">
            <View style={styles.titleRow}>
              <Text style={styles.title}>{KNIGHTMATE_RULES_TITLE[lang]}</Text>
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
              {knightmateRulesSheet(lang).map((section) => (
                <View key={section.title} style={styles.section}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  {section.lines.map((line) => (
                    <Text key={line} style={styles.line}>
                      {line}
                    </Text>
                  ))}
                </View>
              ))}
              <View style={styles.section} testID="knightmate-legend">
                <Text style={styles.sectionTitle}>{KNIGHTMATE_LEGEND_TITLE[lang]}</Text>
                {knightmateLegend(lang).map((entry) => (
                  <View key={entry.kind} style={styles.legendRow}>
                    {entry.kind !== 'notation' && (
                      <View style={styles.legendPiece}>
                        <Piece piece={{ type: entry.kind === 'royal' ? 'k' : 'm', color: 'w' }} images={pieceTheme.images} size={LEGEND_PIECE_SIZE} knightmate />
                      </View>
                    )}
                    <View style={styles.legendText}>
                      <Text style={styles.legendTitle}>{entry.title}</Text>
                      <Text style={styles.line}>{entry.text}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>
            <Pressable accessibilityRole="button" accessibilityLabel="Close the rules" testID="rules-close" style={styles.close} onPress={onClose}>
              <Text style={styles.closeText}>{KNIGHTMATE_RULES_CLOSE[lang]}</Text>
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
    legendRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
    // The piece sits on a plain dark square so a white piece reads on it in both app themes (the chip's own rim is drawn by the badge).
    legendPiece: { width: LEGEND_PIECE_SIZE + 8, height: LEGEND_PIECE_SIZE + 8, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#769656' },
    legendText: { flex: 1, gap: 2 },
    legendTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
    close: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: colors.buttonBackground },
    closeText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  });
}
