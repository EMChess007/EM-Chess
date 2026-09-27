import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { appAlert } from '../components/AppAlert';
import ScreenHeader from '../components/ScreenHeader';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { clearDiagnosticLog, getDiagnosticLog } from '../logic/diagnosticLog';

interface DiagnosticLogsScreenProps {
  onBack: () => void;
}

/**
 * A plain-text dump of this device's own recent diagnostic log lines (see diagnosticLog.ts) —
 * the only way to see what happened in a signed preview/production build without a cable and
 * `adb logcat`. Reachable from More > Diagnostics; not something an ordinary user would need, but
 * deliberately not hidden behind a secret gesture either — a small, plainly-labelled link is
 * enough, and one less thing to explain over chat when asking for a screenshot of this screen.
 */
export default function DiagnosticLogsScreen({ onBack }: DiagnosticLogsScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [logs, setLogs] = useState(getDiagnosticLog);

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
