import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Pressable } from '../components/AppPressable';
import { Text } from '../components/AppText';
import * as Clipboard from 'expo-clipboard';
import { appAlert } from '../components/AppAlert';
import ScreenHeader from '../components/ScreenHeader';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import TextFitProbe from '../components/TextFitProbe';
import { getBuildInfo } from '../logic/buildInfo';
import { clearDiagnosticLog, getDiagnosticLog, logDiagnostic } from '../logic/diagnosticLog';

interface DiagnosticLogsScreenProps {
  onBack: () => void;
  /** Opens the Piece gallery (command #27d). */
  onOpenPieceGallery: () => void;
}

/**
 * A plain-text dump of this device's own recent diagnostic log lines (see diagnosticLog.ts) —
 * the only way to see what happened in a signed preview/production build without a cable and
 * `adb logcat`. Reachable from More > Diagnostics; not something an ordinary user would need, but
 * deliberately not hidden behind a secret gesture either — a small, plainly-labelled link is
 * enough, and one less thing to explain over chat when asking for a screenshot of this screen.
 */
export default function DiagnosticLogsScreen({ onBack, onOpenPieceGallery }: DiagnosticLogsScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [logs, setLogs] = useState(getDiagnosticLog);

  // The text-fit check (logic/textFitProbe.ts): renders probe strings, then writes what it measured into this log and goes away.
  const [probing, setProbing] = useState(false);
  const handleProbeDone = useCallback((lines: string[]) => {
    lines.forEach(logDiagnostic);
    setLogs(getDiagnosticLog());
    setProbing(false);
  }, []);

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(logs.join('\n'));
      appAlert('Copied', 'Diagnostic log copied to clipboard.');
    } catch {
      appAlert('Could not copy', 'Please try again, or send a screenshot instead.');
    }
  };

  const handleClear = () => {
    appAlert('Clear diagnostic log?', 'This removes every entry on this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await clearDiagnosticLog();
          setLogs(getDiagnosticLog());
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Diagnostic Log" onBack={onBack} backLabel="‹ Back" />
      <Text style={styles.subtitle}>
        Recent events from this device, most recent last — screenshot or copy this to share it.
      </Text>

      <View style={styles.buttonRow}>
        <Pressable style={styles.button} onPress={handleCopy}>
          <Text style={styles.buttonText}>Copy All</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.clearButton]} onPress={handleClear}>
          <Text style={styles.buttonText}>Clear</Text>
        </Pressable>
      </View>

      <Text style={styles.subtitle} testID="build-id" selectable>
        {getBuildInfo().label}
      </Text>
      <View style={styles.buttonRow}>
        <Pressable style={styles.button} onPress={() => setProbing(true)} testID="run-text-fit-check">
          <Text style={styles.buttonText}>Run text-fit check</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={onOpenPieceGallery} testID="open-piece-gallery">
          <Text style={styles.buttonText}>Piece gallery</Text>
        </Pressable>
      </View>
      {probing && <TextFitProbe onDone={handleProbeDone} />}

      <ScrollView style={styles.logScroll} contentContainerStyle={styles.logScrollContent}>
        {logs.length === 0 ? (
          <Text style={styles.empty}>No diagnostic entries yet.</Text>
        ) : (
          logs.map((line, index) => (
            <Text key={index} selectable style={styles.logLine}>
              {line}
            </Text>
          ))
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
    subtitle: {
      fontSize: 12,
      color: colors.textMuted,
      paddingHorizontal: 16,
      marginTop: 2,
      marginBottom: 8,
    },
    buttonRow: {
      flexDirection: 'row',
      // a row of buttons wraps (CHECKLIST 6b): "Run text-fit check" and "Piece gallery" do not fit side by side at the narrowest window with large text
      flexWrap: 'wrap',
      gap: 10,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    button: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 8,
      backgroundColor: colors.buttonBackground,
    },
    clearButton: {
      backgroundColor: colors.danger,
    },
    buttonText: {
      color: '#fff',
      fontSize: 13,
      fontWeight: '600',
    },
    logScroll: {
      flex: 1,
    },
    logScrollContent: {
      paddingHorizontal: 16,
      paddingBottom: 32,
      gap: 6,
    },
    empty: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: 24,
    },
    logLine: {
      fontSize: 11,
      fontFamily: 'monospace',
      color: colors.text,
      backgroundColor: colors.surface,
      borderRadius: 6,
      paddingVertical: 6,
      paddingHorizontal: 8,
    },
  });
}
