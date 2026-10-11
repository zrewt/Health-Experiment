export type AppEnvironment = 'development' | 'preview' | 'production';
export type PublicVariable =
  | 'EXPO_PUBLIC_SUPABASE_URL'
  | 'EXPO_PUBLIC_SUPABASE_ANON_KEY'
  | 'EXPO_PUBLIC_APP_ENV';

export type EnvironmentIssue = {
  variable: PublicVariable;
  reason: string;
};

export type AppEnv = {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  appEnv: AppEnvironment;
};

function isPlaceholder(value: string): boolean {
  return !value || /YOUR[-_]|PLACEHOLDER/i.test(value);
}

function isPublicKey(value: string): boolean {
  if (isPlaceholder(value) || value.startsWith('sb_secret_')) return false;
  if (value.startsWith('sb_publishable_')) return value.length > 20;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const claims: unknown = JSON.parse(globalThis.atob(padded));
    return typeof claims === 'object' && claims !== null &&
      'role' in claims && claims.role === 'anon';
  } catch {
    return false;
  }
}

export function validateEnv(input: {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  appEnv?: string;
}): { env: AppEnv; issues: EnvironmentIssue[]; isSupabaseConfigured: boolean } {
  const issues: EnvironmentIssue[] = [];
  const url = input.supabaseUrl?.trim() ?? '';
  const key = input.supabaseAnonKey?.trim() ?? '';
  let validUrl: string | null = null;
  if (!isPlaceholder(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password &&
          parsed.pathname === '/' && !parsed.search && !parsed.hash) {
        validUrl = parsed.origin;
      }
    } catch {
      // Invalid configuration disables account actions without crashing the app.
    }
  }
  if (!validUrl) issues.push({
    variable: 'EXPO_PUBLIC_SUPABASE_URL',
    reason: 'Set your project HTTPS URL in .env.local.',
  });
  const validKey = isPublicKey(key) ? key : null;
  if (!validKey) issues.push({
    variable: 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    reason: 'Set the public anon key in .env.local. Never use a server secret.',
  });
  const mode = input.appEnv?.trim();
  const appEnv: AppEnvironment = mode === 'production' || mode === 'preview' ||
    mode === 'development' ? mode : 'development';
  if (mode !== appEnv) issues.push({
    variable: 'EXPO_PUBLIC_APP_ENV',
    reason: 'Set development, preview, or production in .env.local.',
  });
  return {
    env: { supabaseUrl: validUrl, supabaseAnonKey: validKey, appEnv },
    issues,
    isSupabaseConfigured: validUrl !== null && validKey !== null,
  };
}

// Static dot notation is required for Expo CLI to inline public values.
const rawSupabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const rawSupabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const configuration = validateEnv({
  supabaseUrl: rawSupabaseUrl,
  supabaseAnonKey: rawSupabaseAnonKey,
  appEnv: process.env.EXPO_PUBLIC_APP_ENV,
});

export const env = configuration.env;
export const environmentIssues = configuration.issues;
export const isSupabaseConfigured = configuration.isSupabaseConfigured;

// Expo inlines EXPO_PUBLIC_* into the bundle when the bundler starts. When no
// value arrives at all the cause is almost always a stale dev server rather
// than a bad .env.local, so keep that distinction visible in the UI.
const nothingReachedBundle = !rawSupabaseUrl && !rawSupabaseAnonKey;

export const environmentHint = nothingReachedBundle
  ? 'No EXPO_PUBLIC_* values reached the app bundle. Expo inlines them when the bundler starts, so editing .env.local is not enough on its own.'
  : 'Values reached the app bundle but were rejected. Remove placeholder text, use a bare https origin, and use the publishable or anon key (never a server secret).';

export const environmentFixSteps = [
  'Create .env.local beside package.json with EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
  'Restart the dev server with a cleared cache: npx expo start -c',
  'Reload the app (browser refresh, or press r in the Expo terminal).',
];
