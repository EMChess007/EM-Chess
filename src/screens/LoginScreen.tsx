import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError } from '../api/client';
import { saveAuthSession, type AuthSession } from '../api/authStorage';

interface LoginScreenProps {
  onSuccess: (session: AuthSession) => void;
  onSwitchToRegister: () => void;
  onBack: () => void;
}

export default function LoginScreen({ onSuccess, onSwitchToRegister, onBack }: LoginScreenProps) {
  // The back link floats over the centered form rather than sitting in a document-flow header
  // row, so it needs its own absolute `top` nudged past the status bar directly (react-native's
  // <SafeAreaView> is a no-op on Android, which is why this was overlapping there).
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const response = await api.login(email.trim(), password);
      await saveAuthSession(response);
      onSuccess({ token: response.token, user: response.user });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Pressable style={[styles.backButton, { top: insets.top + 16 }]} onPress={onBack}>
        <Text style={styles.backButtonText}>‹ Menu</Text>
      </Pressable>

      <Text style={styles.title}>Log In</Text>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={[styles.button, loading && styles.buttonDisabled]} onPress={handleSubmit} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Log In</Text>}
        </Pressable>

        <Pressable style={styles.switchLink} onPress={onSwitchToRegister}>
          <Text style={styles.switchLinkText}>Don't have an account? Sign up</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 24,
    gap: 16,
  },
  backButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  backButtonText: {
    fontSize: 16,
    color: '#3a2618',
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#3a2618',
  },
  form: {
    width: '100%',
    maxWidth: 320,
    gap: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  error: {
    color: '#b00020',
    fontSize: 13,
    textAlign: 'center',
  },
  button: {
    paddingVertical: 14,
    backgroundColor: '#3a2618',
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  switchLink: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  switchLinkText: {
    color: '#8d6e63',
    fontSize: 14,
  },
});
