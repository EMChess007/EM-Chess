import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError } from '../api/client';
import { saveAuthSession, type AuthSession } from '../api/authStorage';

interface RegisterScreenProps {
  onSuccess: (session: AuthSession) => void;
  onSwitchToLogin: () => void;
  onBack: () => void;
}

export default function RegisterScreen({ onSuccess, onSwitchToLogin, onBack }: RegisterScreenProps) {
  // Same floating-back-link inset fix as LoginScreen (see its comment) — react-native's
  // <SafeAreaView> doesn't apply a top inset on Android.
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const response = await api.register(email.trim(), username.trim(), password);
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

      <Text style={styles.title}>Sign Up</Text>

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
          placeholder="Username"
          autoCapitalize="none"
          value={username}
          onChangeText={setUsername}
        />
        <TextInput
          style={styles.input}
          placeholder="Password (at least 8 characters)"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={[styles.button, loading && styles.buttonDisabled]} onPress={handleSubmit} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign Up</Text>}
        </Pressable>

        <Pressable style={styles.switchLink} onPress={onSwitchToLogin}>
          <Text style={styles.switchLinkText}>Already have an account? Log in</Text>
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
