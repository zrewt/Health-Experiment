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
  userInterfaceStyle: 'dark',
  backgroundColor: tokens.colors.ground,
  ios: { supportsTablet: false },
  web: { bundler: 'metro', output: 'single', name: brand.name },
  plugins: [
    'expo-router',
    'expo-font',
    ['expo-splash-screen', { backgroundColor: tokens.colors.ground }],
    // Local daily check-in reminders. No `icon` option: the plugin's icon is Android-only
    // and needs a 96x96 all-white asset, which this project does not ship, so the tray
    // icon falls back to the default rather than pointing at a file that does not exist.
    ['expo-notifications', { color: tokens.colors.champagne }],
  ],
  experiments: { typedRoutes: true },
};

export default config;
