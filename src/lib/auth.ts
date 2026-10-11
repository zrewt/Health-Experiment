import type { SupabaseClient } from '@supabase/supabase-js';

type AuthClient = Pick<SupabaseClient['auth'], 'signInWithPassword' | 'signUp'>;

export function validateCredentials(email: string, password: string, signup = false): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.';
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

export function authErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to reach the account service. Please try again.';
}
