export const colors = {
  // Midnight Obsidian base with deepest slate-emerald undertone
  ground: '#080F0B',
  surface: '#0F1A14',
  surfaceHigh: '#15241C',
  surfaceHighlight: '#1C3026',
  surfaceGlass: 'rgba(15, 26, 20, 0.85)',
  hairline: '#1B2C22',
  hairlineBright: '#263E30',
  hairlineHighlight: 'rgba(217, 193, 135, 0.22)',
  hairlineGold: 'rgba(216, 187, 120, 0.28)',

  // Warm luxury typography tones
  ivory: '#F7F4EB',
  ivorySecondary: '#D0DACF',
  ivoryMuted: '#849688',
  ivorySubtle: '#526356',

  // Refined Horology Champagne Gold
  champagne: '#D9C187',
  champagneLight: '#EDE1BF',
  champagneMuted: '#968352',
  champagneSoft: 'rgba(217, 193, 135, 0.12)',

  // Deep Rose Garnet
  garnet: '#C4574C',
  garnetSoft: 'rgba(196, 87, 76, 0.14)',
} as const;

export const typography = {
  fonts: {
    display: 'BodoniModa_600SemiBold',
    displayItalic: 'BodoniModa_600SemiBold_Italic',
    body: 'HankenGrotesk_400Regular',
    bodyMedium: 'HankenGrotesk_500Medium',
    bodySemiBold: 'HankenGrotesk_600SemiBold',
  },
  sizes: {
    overline: 11,
    caption: 12,
    sub: 14,
    body: 16,
    lead: 18,
    titleSmall: 22,
    titleMedium: 26,
    titleLarge: 38,
    displaySmall: 64,
    displayLarge: 110,
  },
  lineHeights: {
    overline: 14,
    caption: 16,
    sub: 20,
    body: 24,
    lead: 26,
    titleSmall: 28,
    titleMedium: 32,
    titleLarge: 44,
    displaySmall: 70,
    displayLarge: 116,
  },
  letterSpacings: {
    tighter: -0.8,
    tight: -0.3,
    normal: 0,
    wide: 0.5,
    widest: 1.5,
  },
} as const;

export const radii = {
  none: 0,
  control: 16,
  card: 20,
  sheet: 28,
  pill: 9999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  screen: 24,
} as const;

export const tokens = {
  colors,
  typography,
  radii,
  spacing,
  layout: { fill: 1 },
} as const;
