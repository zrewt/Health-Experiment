import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { tokens } from '../design/tokens';
import { useAuthHydration, useAuthStore } from '../store/auth';
import { NotificationTapHandler } from '../notifications/notification-tap-handler';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // Restore any persisted session before the first screen renders.
  useAuthHydration();
  const authLoading = useAuthStore((state) => state.loading);
  const session = useAuthStore((state) => state.session);
  const signedIn = !!session && !session.user.is_anonymous;

  // The redesign is system-font only, so there is nothing to load before first paint.
  useEffect(() => {
    if (!authLoading) {
      SplashScreen.hideAsync();
    }
  }, [authLoading]);

  if (authLoading) {
    return null;
  }

  return (
    <>
      <StatusBar style="dark" />
      {/* Mounted inside the render that also mounts the navigator, and only when signed in,
          so it can never navigate before the routes it targets exist. */}
      {signedIn ? <NotificationTapHandler /> : null}
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: tokens.colors.background },
          animation: 'fade',
        }}
      >
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="index" />
          <Stack.Screen name="setup-consent" />
          <Stack.Screen name="run-in" options={{ animation: 'none' }} />
          <Stack.Screen name="feasibility" options={{ animation: 'none' }} />
          <Stack.Screen name="daily-instruction" options={{ animation: 'none' }} />
          <Stack.Screen name="result" options={{ animation: 'none' }} />
          <Stack.Screen name="journal" options={{ animation: 'none' }} />
          <Stack.Screen name="experiment" options={{ animation: 'none' }} />
          <Stack.Screen name="settings" options={{ animation: 'none' }} />
          <Stack.Screen name="reminder-settings" options={{ animation: 'none' }} />
          {typeof __DEV__ !== 'undefined' && __DEV__ ? (
            <Stack.Screen name="dev-tools" options={{ animation: 'none' }} />
          ) : null}
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="auth/sign-in" />
          <Stack.Screen name="auth/sign-up" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
