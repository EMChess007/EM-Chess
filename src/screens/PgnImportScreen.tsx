import { useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { appAlert } from '../components/AppAlert';
import ScreenHeader from '../components/ScreenHeader';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { parsePgn, type ParsedPgn } from '../logic/pgnImport';
import type { AnalyzeParams } from '../types/history';

interface PgnImportScreenProps {
  onBack: () => void;
  onAnalyze: (params: AnalyzeParams) => void;
}

export default function PgnImportScreen({ onBack, onAnalyze }: PgnImportScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [pgnText, setPgnText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedPgn | null>(null);

  const updatePgnText = (text: string) => {
    setPgnText(text);
    setParsed(null);
    setError(null);
  };

  const handleParse = () => {
    const result = parsePgn(pgnText);
    if (!result.ok) {
      setParsed(null);
      setError(result.error);
      return;
    }
    setError(null);
    setParsed(result.parsed);
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (!text) {
        appAlert('Clipboard empty', 'Copy a PGN first, then try again.');
        return;
      }
      updatePgnText(text);
    } catch {
      appAlert('Could not read clipboard', 'Please try again.');
    }
  };

  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
      updatePgnText(content);
    } catch {
      appAlert('Could not read file', 'Please try a different .pgn file.');
    }
  };

  const handleContinue = () => {
    if (!parsed) return;
    onAnalyze({ initialFen: parsed.initialFen, chess960: parsed.chess960, fogOfWar: false, history: parsed.history });
  };

  const summaryLine =
    [
      parsed?.metadata.white && `White: ${parsed.metadata.white}`,
      parsed?.metadata.black && `Black: ${parsed.metadata.black}`,
      parsed?.metadata.result && `Result: ${parsed.metadata.result}`,
    ]
      .filter(Boolean)
      .join(' — ') || (parsed ? `${parsed.history.length}-move game` : '');

  return (
    <View style={styles.container}>
      <ScreenHeader title="Import PGN" onBack={onBack} backLabel="‹ Menu" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <TextInput
          style={styles.textInput}
          value={pgnText}
          onChangeText={updatePgnText}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={'Paste PGN text here, e.g.\n1. e4 e5 2. Nf3 Nc6 ...'}
          placeholderTextColor={colors.textMuted}
        />

        <View style={styles.buttonRow}>
          <Pressable style={styles.actionButton} onPress={handlePasteFromClipboard}>
            <Text style={styles.actionButtonText}>Paste from Clipboard</Text>
          </Pressable>
          <Pressable style={styles.actionButton} onPress={handlePickFile}>
            <Text style={styles.actionButtonText}>Choose .pgn File</Text>
          </Pressable>
        </View>

        <Pressable
          style={[styles.parseButton, !pgnText.trim() && styles.parseButtonDisabled]}
          disabled={!pgnText.trim()}
          onPress={handleParse}
        >
          <Text style={styles.parseButtonText}>Parse PGN</Text>
        </Pressable>

        {error && <Text style={styles.errorText}>{error}</Text>}

        {parsed && (
          <View style={styles.summaryBox}>
            <Text style={styles.summaryTitle}>{summaryLine}</Text>
            {parsed.metadata.event && <Text style={styles.summarySubtext}>{parsed.metadata.event}</Text>}
            {parsed.metadata.date && <Text style={styles.summarySubtext}>{parsed.metadata.date}</Text>}
            {parsed.chess960 && <Text style={styles.summarySubtext}>Chess960</Text>}

            <Pressable style={styles.continueButton} onPress={handleContinue}>
              <Text style={styles.continueButtonText}>Analyze this game</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingBottom: 40,
      gap: 14,
    },
    textInput: {
      minHeight: 140,
      borderRadius: 8,
      backgroundColor: colors.surface,
      color: colors.text,
      padding: 12,
      fontSize: 13,
      fontFamily: 'monospace',
      textAlignVertical: 'top',
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 10,
    },
    actionButton: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: 'center',
      backgroundColor: colors.buttonBackground,
    },
    actionButtonText: {
      color: '#fff',
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
    },
    parseButton: {
      paddingVertical: 14,
      borderRadius: 10,
      alignItems: 'center',
      backgroundColor: colors.accent,
    },
    parseButtonDisabled: {
      opacity: 0.4,
    },
    parseButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
    },
    errorText: {
      fontSize: 13,
      color: colors.danger,
    },
    summaryBox: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      padding: 16,
      gap: 4,
    },
    summaryTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    summarySubtext: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    continueButton: {
      marginTop: 10,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: 'center',
      backgroundColor: colors.accent,
    },
    continueButtonText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '700',
    },
  });
}
