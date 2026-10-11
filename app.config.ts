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
  ],
  experiments: { typedRoutes: true },
};

export default config;
