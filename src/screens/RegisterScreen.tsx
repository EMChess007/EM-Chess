import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError } from '../api/client';
import { saveAuthSession, type AuthSession } from '../api/authStorage';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';

interface RegisterScreenProps {
  onSuccess: (session: AuthSession) => void;
  onSwitchToLogin: () => void;
  onBack: () => void;
}

export default function RegisterScreen({ onSuccess, onSwitchToLogin, onBack }: RegisterScreenProps) {
  // Same floating-back-link inset fix as LoginScreen (see its comment) — react-native's
  // <SafeAreaView> doesn't apply a top inset on Android.
  const insets = useSafeAreaInsets();
  const colors = useAppColors();
  const styles = createStyles(colors);
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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Pressable style={[styles.backButton, { top: insets.top + 16 }]} onPress={onBack}>
        <Text style={styles.backButtonText}>‹ Menu</Text>
      </Pressable>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Sign Up</Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Username"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            value={username}
            onChangeText={setUsername}
          />
          <TextInput
            style={styles.input}
            placeholder="Password (at least 8 characters)"
            placeholderTextColor={colors.textMuted}
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      paddingVertical: 40,
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
      color: colors.text,
    },
    title: {
      fontSize: 26,
      fontWeight: 'bold',
      color: colors.text,
    },
    form: {
      width: '100%',
      maxWidth: 320,
      gap: 12,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: 14,
      fontSize: 16,
      color: colors.text,
    },
    error: {
      color: colors.danger,
      fontSize: 13,
      textAlign: 'center',
    },
    button: {
      paddingVertical: 14,
      backgroundColor: colors.buttonBackground,
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
      color: colors.textSecondary,
      fontSize: 14,
    },
  });
}
