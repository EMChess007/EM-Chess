import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Pressable } from '../components/AppPressable';
import { Text, TextInput } from '../components/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError, isCancelled } from '../api/client';
import SignInWaiting from '../components/SignInWaiting';
import { useSignInRequest } from '../logic/useSignInRequest';
import { saveAuthSession, type AuthSession } from '../api/authStorage';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';

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
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signIn = useSignInRequest();

  const handleSubmit = async () => {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const response = await signIn.start((call) => api.login(email.trim(), password, call));
      await saveAuthSession(response);
      onSuccess({ token: response.token, user: response.user });
    } catch (e) {
      // Cancel is the person's own choice: no error to show for it.
      if (!isCancelled(e)) setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
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
        <Text style={styles.title}>Log In</Text>

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
            placeholder="Password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable style={[styles.button, loading && styles.buttonDisabled]} onPress={handleSubmit} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Log In</Text>}
          </Pressable>
          {loading && <SignInWaiting waking={signIn.waking} onCancel={signIn.cancel} />}

          <Pressable style={styles.switchLink} onPress={onSwitchToRegister}>
            <Text style={styles.switchLinkText}>Don't have an account? Sign up</Text>
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
