import { useFonts } from 'expo-font';
import {
  BodoniModa_600SemiBold,
  BodoniModa_600SemiBold_Italic,
} from '@expo-google-fonts/bodoni-moda';
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
} from '@expo-google-fonts/hanken-grotesk';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { tokens } from '../design/tokens';
import { useAuthHydration, useAuthStore } from '../store/auth';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    BodoniModa_600SemiBold,
    BodoniModa_600SemiBold_Italic,
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
  });

  // Restore any persisted session before the first screen renders.
  useAuthHydration();
  const authLoading = useAuthStore((state) => state.loading);
  const session = useAuthStore((state) => state.session);
  const signedIn = !!session && !session.user.is_anonymous;

  useEffect(() => {
    if ((loaded || error) && !authLoading) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error, authLoading]);

  if ((!loaded && !error) || authLoading) {
    return null;
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: tokens.colors.ground },
          animation: 'fade',
        }}
      >
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="index" />
          <Stack.Screen name="setup-consent" />
          <Stack.Screen name="run-in" options={{ animation: 'none' }} />
          <Stack.Screen name="feasibility" options={{ animation: 'none' }} />
          <Stack.Screen name="daily-instruction" options={{ animation: 'none' }} />
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
