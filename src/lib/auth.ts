import type { SupabaseClient } from '@supabase/supabase-js';

type AuthClient = Pick<SupabaseClient['auth'], 'signInWithPassword' | 'signUp'>;
type PasswordResetClient = Pick<SupabaseClient['auth'], 'resetPasswordForEmail'>;
type PasswordUpdateClient = Pick<SupabaseClient['auth'], 'updateUser'>;
type AccountDeleteClient = Pick<SupabaseClient, 'rpc'>;

export function validateEmail(email: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.';
  return null;
}

export function validateCredentials(email: string, password: string, signup = false): string | null {
  const emailError = validateEmail(email);
  if (emailError) return emailError;
  if (!password) return 'Enter your password.';
  if (signup && password.length < 8) return 'Use a password with at least 8 characters.';
  return null;
}

export async function signIn(auth: AuthClient, email: string, password: string) {
  const validation = validateCredentials(email, password);
  if (validation) throw new Error(validation);
  const { data, error } = await auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  if (!data.session) throw new Error('Sign in did not return a session. Please try again.');
  return data.session;
}

export async function signUp(auth: AuthClient, email: string, password: string) {
  const validation = validateCredentials(email, password, true);
  if (validation) throw new Error(validation);
  const { data, error } = await auth.signUp({ email: email.trim(), password });
  if (error) throw error;
  return data.session;
}

export async function requestPasswordReset(auth: PasswordResetClient, email: string): Promise<void> {
  const validation = validateEmail(email);
  if (validation) throw new Error(validation);
  const { error } = await auth.resetPasswordForEmail(email.trim());
  if (error) throw error;
}

export async function updateUserPassword(auth: PasswordUpdateClient, newPassword: string): Promise<void> {
  if (!newPassword || newPassword.length < 8) {
    throw new Error('Use a password with at least 8 characters.');
  }
  const { error } = await auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function deleteUserAccount(client: AccountDeleteClient): Promise<void> {
  const { error } = await client.rpc('delete_own_account');
  if (error) {
    throw new Error(`Could not delete server account: ${error.message}`);
  }
}

export function authErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to reach the account service. Please try again.';
}
