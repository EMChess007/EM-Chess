import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export interface AppAlertButton {
  text: string;
  onPress?: () => void;
  /** 'cancel' is also what a tap on the backdrop triggers (if present) — matches how a native
   * Alert's "tap outside to dismiss" on Android behaves. 'destructive' renders in red, matching
   * this app's existing red for Resign/Remove/etc. elsewhere (GameOptionsMenu, Square's check
   * highlight, error banners). */
  style?: 'default' | 'cancel' | 'destructive';
}

interface AlertState {
  title: string;
  message?: string;
  buttons: AppAlertButton[];
}

let currentState: AlertState | null = null;
const listeners = new Set<(state: AlertState | null) => void>();

function setState(state: AlertState | null): void {
  currentState = state;
  listeners.forEach((listener) => listener(state));
}

/**
 * Cross-platform replacement for React Native's own `Alert.alert` — same (title, message,
 * buttons) call shape, so replacing a call site is a straight swap, but backed by a real
 * rendered overlay (see AppAlertHost below) instead of the native Alert, which is a documented
 * no-op on react-native-web (this app has been bitten by that twice: resign confirmations, the
 * remove-custom-engine confirmation). Works identically on web and native since it's plain
 * View/Pressable/Text, not a platform API.
 */
export function appAlert(title: string, message?: string, buttons?: AppAlertButton[]): void {
  setState({ title, message, buttons: buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }] });
}

/** Mounted once, at the app root (see App.tsx) — renders whichever alert is currently active, if
 * any, as a full-screen overlay on top of everything else. Every other screen just calls
 * `appAlert(...)`; nothing else needs to render or manage this itself. */
export default function AppAlertHost() {
  const [state, setLocalState] = useState<AlertState | null>(null);

  useEffect(() => {
    listeners.add(setLocalState);
    return () => {
      listeners.delete(setLocalState);
    };
  }, []);

  if (!state) return null;

  const handlePress = (button: AppAlertButton) => {
    setState(null);
    button.onPress?.();
  };

  const handleBackdropPress = () => {
    // Only auto-trigger an explicit "cancel" button (if any) — never a default/destructive one,
    // so tapping outside a dialog can never accidentally fire something like Resign/Remove.
    const cancelButton = state.buttons.find((b) => b.style === 'cancel');
    setState(null);
    cancelButton?.onPress?.();
  };

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={handleBackdropPress} />
      <View style={styles.card}>
        <Text style={styles.title}>{state.title}</Text>
        {state.message ? <Text style={styles.message}>{state.message}</Text> : null}
        <View style={styles.buttonRow}>
          {state.buttons.map((button, i) => (
            <Pressable
              key={i}
              style={[
                styles.button,
                button.style === 'cancel' && styles.buttonCancel,
                button.style === 'destructive' && styles.buttonDestructive,
              ]}
              onPress={() => handlePress(button)}
            >
              <Text
                style={[
                  styles.buttonText,
                  button.style === 'cancel' && styles.buttonTextCancel,
                  button.style === 'destructive' && styles.buttonTextDestructive,
                ]}
              >
                {button.text}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
    elevation: 999,
    padding: 24,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    gap: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#3a2618',
  },
  message: {
    fontSize: 14,
    color: '#555',
    lineHeight: 19,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#3a2618',
  },
  buttonCancel: {
    backgroundColor: '#ddd',
  },
  buttonDestructive: {
    backgroundColor: '#b00020',
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  buttonTextDestructive: {
    color: '#fff',
  },
  buttonTextCancel: {
    color: '#333',
  },
});
