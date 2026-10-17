import 'tsx/cjs';
import type { ExpoConfig } from 'expo/config';

import { brand } from './src/config/brand';
import { tokens } from './src/design/tokens';

const config: ExpoConfig = {
  name: brand.name,
  slug: brand.slug,
  scheme: brand.scheme,
  version: '0.1.0',
  orientation: 'portrait',
  // Light UI in the OS: keyboard appearance, alerts and the status bar follow this.
  userInterfaceStyle: 'light',
  backgroundColor: tokens.colors.background,
  // The SplitDisc mark on the Mist background (generated from the design tokens).
  icon: './assets/icon.png',
  androidStatusBar: {
    barStyle: 'dark-content',
    backgroundColor: tokens.colors.background,
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: tokens.colors.background,
    },
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: brand.iosBundleIdentifier,
  },
  web: { bundler: 'metro', output: 'single', name: brand.name },
  plugins: [
    'expo-router',
    'expo-font',
    [
      'expo-splash-screen',
      {
        backgroundColor: tokens.colors.background,
        image: './assets/splash-icon.png',
        imageWidth: 200,
      },
    ],
    // Local daily check-in reminders. No `icon` option: the plugin's icon is Android-only
    // and needs a 96x96 all-white asset, which this project does not ship, so the tray
    // icon falls back to the default rather than pointing at a file that does not exist.
    ['expo-notifications', { color: tokens.colors.accent }],
  ],
  experiments: { typedRoutes: true },
};

export default config;
