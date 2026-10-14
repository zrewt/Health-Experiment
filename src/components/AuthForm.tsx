import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Text, Field, Button, AccountSetupNotice } from '@/components/ui';
import { spacing } from '@/design/tokens';
import { supabase } from '@/lib/supabase';
import { authErrorMessage, requestPasswordReset, signIn, signUp } from '@/lib/auth';
import { useAuthStore } from '@/store/auth';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const setSession = useAuthStore((state) => state.setSession);
  const signup = mode === 'signup';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const submitting = useRef(false);

  const submitReset = async () => {
    if (!supabase || submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setError('');
    setResetSent(false);
    try {
      await requestPasswordReset(supabase.auth, email);
      setResetSent(true);
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  const submit = async () => {
    if (!supabase || submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setError('');
    try {
      const session = await (signup ? signUp : signIn)(supabase.auth, email, password);
      if (session) {
        setSession(session);
      } else {
        setPassword('');
        setConfirmation(true);
      }
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
          <View style={styles.form}>
            <Text variant="titleLarge">
              {resetMode ? 'Reset password' : signup ? 'Create account' : 'Log in'}
            </Text>
            <Text color="ivoryMuted" style={styles.subtitle}>
              {resetMode
                ? 'Enter your account email and we will send a password reset link.'
                : signup
                ? 'Sign up with your email and password.'
                : 'Welcome back.'}
            </Text>
            {!supabase && <AccountSetupNotice />}
            {confirmation ? (
              <Text accessibilityLiveRegion="polite" style={styles.message}>
                Check your email for a confirmation link. After confirming, return here to log in.
              </Text>
            ) : resetMode ? (
              <>
                <Field label="Email" accessibilityLabel="Email" placeholder="name@example.com"
                  value={email} onChangeText={setEmail} keyboardType="email-address"
                  autoCapitalize="none" autoCorrect={false} autoComplete="email" editable={!loading}
                  onSubmitEditing={() => void submitReset()} returnKeyType="go" />
                {error ? <Text color="garnet" accessibilityRole="alert" style={styles.message}>{error}</Text> : null}
                {resetSent ? (
                  <Text color="champagneLight" accessibilityLiveRegion="polite" style={styles.message}>
                    If an account exists for that email, a password reset link has been sent.
                  </Text>
                ) : null}
                <Button label="Send password reset link" loading={loading}
                  disabled={!supabase} onPress={() => void submitReset()} style={styles.submit} />
                <Button label="Back to log in" variant="quiet" disabled={loading}
                  onPress={() => { setResetMode(false); setError(''); setResetSent(false); }} />
              </>
            ) : (
              <>
                <Field label="Email" accessibilityLabel="Email" placeholder="name@example.com"
                  value={email} onChangeText={setEmail} keyboardType="email-address"
                  autoCapitalize="none" autoCorrect={false} autoComplete="email" editable={!loading} />
                <Field label={signup ? 'Password (at least 8 characters)' : 'Password'}
                  accessibilityLabel="Password" value={password} onChangeText={setPassword}
                  secureTextEntry autoCapitalize="none" autoCorrect={false}
                  autoComplete={signup ? 'new-password' : 'current-password'} editable={!loading}
                  onSubmitEditing={() => void submit()} returnKeyType="go" />
                {error ? <Text color="garnet" accessibilityRole="alert" style={styles.message}>{error}</Text> : null}
                <Button label={signup ? 'Sign up' : 'Log in'} loading={loading}
                  disabled={!supabase} onPress={() => void submit()} style={styles.submit} />
                {!signup ? (
                  <Button label="Forgot password?" variant="quiet" disabled={loading}
                    onPress={() => { setResetMode(true); setError(''); setResetSent(false); }} />
                ) : null}
              </>
            )}
            <Button label={signup ? 'Already have an account? Log in' : 'Create an account'}
              variant="quiet" disabled={loading}
              onPress={() => router.replace(signup ? '/auth/sign-in' : '/auth/sign-up')} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: spacing.lg },
  form: { width: '100%', maxWidth: 420, alignSelf: 'center', gap: spacing.sm },
  subtitle: { marginBottom: spacing.lg },
  message: { marginVertical: spacing.sm },
  submit: { marginTop: spacing.md },
});
