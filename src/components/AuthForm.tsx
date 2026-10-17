import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Screen,
  Card,
  Text,
  Field,
  Button,
  AccountSetupNotice,
  Banner,
  SplitDisc,
} from '@/components/ui';
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
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
          <View style={styles.form}>
            <View style={styles.brandRow}>
              <SplitDisc size={64} tone={signup ? 'normal' : 'cutoff'} />
              <View style={styles.brandText}>
                <Text variant="caption" color="textMuted">
                  Aevum · Sleep & caffeine test
                </Text>
                <Text variant="title" accessibilityRole="header">
                  {resetMode
                    ? 'Reset your password'
                    : signup
                    ? 'Create your account'
                    : 'Welcome back'}
                </Text>
              </View>
            </View>

            <Text color="textMuted">
              {resetMode
                ? 'We will email you a link to set a new password.'
                : signup
                ? 'Your email and a password is all we need.'
                : 'Log in to pick up where you left off.'}
            </Text>

            {!supabase && <AccountSetupNotice />}

            {confirmation ? (
              <Card tone="hero" overline="Almost there">
                <Text variant="heading">Confirm your email</Text>
                <Text variant="body" color="textMuted" accessibilityLiveRegion="polite">
                  Check {email || 'your email'} for a confirmation link. Once you tap it, come back here and log in.
                </Text>
                <Button
                  label="Go to log in"
                  variant="primary"
                  onPress={() => {
                    setConfirmation(false);
                    if (signup) {
                      router.replace('/auth/sign-in');
                    }
                  }}
                />
              </Card>
            ) : resetMode ? (
              <Card tone="hero">
                <Field
                  label="Email"
                  accessibilityLabel="Email"
                  placeholder="name@example.com"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  editable={!loading}
                  onSubmitEditing={() => void submitReset()}
                  returnKeyType="go"
                />
                {error ? <Banner tone="error">{error}</Banner> : null}
                {resetSent ? (
                  <Banner tone="success">
                    If that email has an account, a reset link is on its way.
                  </Banner>
                ) : null}
                <Button
                  label="Send reset link"
                  loading={loading}
                  disabled={!supabase}
                  onPress={() => void submitReset()}
                />
                <Button
                  label="Back to log in"
                  variant="quiet"
                  disabled={loading}
                  onPress={() => {
                    setResetMode(false);
                    setError('');
                    setResetSent(false);
                  }}
                />
              </Card>
            ) : (
              <Card tone="hero">
                <Field
                  label="Email"
                  accessibilityLabel="Email"
                  placeholder="name@example.com"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  editable={!loading}
                />
                <Field
                  label={signup ? 'Password (at least 8 characters)' : 'Password'}
                  accessibilityLabel="Password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete={signup ? 'new-password' : 'current-password'}
                  editable={!loading}
                  onSubmitEditing={() => void submit()}
                  returnKeyType="go"
                />
                {error ? (
                  <Banner
                    tone="error"
                    action={
                      !signup ? (
                        <Button
                          label="Reset password"
                          variant="quiet"
                          onPress={() => {
                            setResetMode(true);
                            setError('');
                            setResetSent(false);
                          }}
                        />
                      ) : undefined
                    }
                  >
                    {error}
                  </Banner>
                ) : null}
                <Button
                  label={signup ? 'Sign up' : 'Log in'}
                  loading={loading}
                  disabled={!supabase}
                  onPress={() => void submit()}
                />
                {!signup ? (
                  <Button
                    label="Forgot password?"
                    variant="quiet"
                    disabled={loading}
                    onPress={() => {
                      setResetMode(true);
                      setError('');
                      setResetSent(false);
                    }}
                  />
                ) : null}
              </Card>
            )}
            <Button
              label={signup ? 'Log in instead' : 'Create an account'}
              variant="quiet"
              disabled={loading}
              onPress={() => router.replace(signup ? '/auth/sign-in' : '/auth/sign-up')}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: spacing.xl },
  form: { width: '100%', maxWidth: 420, alignSelf: 'center', gap: spacing.lg },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  brandText: {
    flex: 1,
    gap: spacing.xs,
  },
});
