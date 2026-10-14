/**
 * Aevum design tokens — light, calm, premium.
 *
 * One palette, two names for each value while the app migrates:
 * - Semantic names (background, surface, text, textMuted, accent, graphic, signal)
 *   are what new and rebuilt code uses.
 * - Legacy names (ground, ivory, champagne, hairline, ...) are aliases onto the same
 *   light values, so screens that part 2 has not rebuilt yet still render light and
 *   readable instead of dark leftovers. They are removed once every screen is migrated.
 *
 * This module must stay import-free: app.config.ts reads it from the Expo CLI, where
 * react-native is not available.
 *
 * Contrast (WCAG 2.1, computed in scripts/contrast-sanity.cjs):
 *   text on background 13.98 · text on surface 15.10 · textMuted on background 5.62
 *   textMuted on surface 6.07 · accent on background 5.02 · accent on surface 5.42
 *   surface on text (primary button) 15.10 · signalText on surface 5.99
 *   lineStrong on background 3.18 (controls) · accent on background 5.02 (focus ring)
 *   graphic (Mint) 1.46 and signal (Coral) 2.14 against the background fail 3:1 by
 *   design: they are fills only, never the sole carrier of meaning.
 */

export const colors = {
  // ---- Semantic ----
  background: '#F3F7F6', // Mist
  surface: '#FFFFFF', // Paper
  surfaceTint: '#E8F1EF', // grouped area, tone only — never a second radius
  text: '#0F2A2E', // Ink
  textMuted: '#51666A', // Ink soft
  accent: '#12776A', // Lagoon: links, focus, active text
  graphic: '#7DE0C3', // Mint: fills and graphics only
  signal: '#FF8A6B', // Coral: cutoff-day graphic only, always with a text label
  signalText: '#A8432C', // Coral made readable: error text and error borders
  line: '#E4ECEB', // decorative divider
  lineStrong: '#788F8C', // controls only (input borders): 3.18:1 on the background
  focus: '#12776A',
  overlay: 'rgba(15, 42, 46, 0.45)',

  // ---- Legacy aliases (removed in part 2) ----
  ground: '#F3F7F6',
  surfaceHigh: '#E8F1EF',
  surfaceHighlight: '#DCEAE7',
  surfaceGlass: 'rgba(255, 255, 255, 0.88)',
  hairline: '#E4ECEB',
  hairlineBright: '#788F8C',
  hairlineHighlight: 'rgba(18, 119, 106, 0.30)',
  hairlineGold: 'rgba(18, 119, 106, 0.45)',
  ivory: '#0F2A2E',
  ivorySecondary: '#3E5457',
  ivoryMuted: '#51666A',
  ivorySubtle: '#566B6E',
  champagne: '#12776A',
  champagneLight: '#0F6A5E',
  champagneMuted: '#4A5F63',
  champagneSoft: 'rgba(18, 119, 106, 0.10)',
  garnet: '#A8432C',
  garnetSoft: 'rgba(168, 67, 44, 0.10)',
} as const;

/**
 * System fonts only. Weights come from fontWeight, not from extra font files, so
 * nothing has to be loaded before the first paint and the largest text sizes reflow.
 */
const systemStack =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export const typography = {
  fonts: {
    body: systemStack,
    display: systemStack,
    displayItalic: systemStack,
    bodyMedium: systemStack,
    bodySemiBold: systemStack,
  },
  sizes: {
    // ---- Semantic scale ----
    display: 40,
    title: 28,
    heading: 20,
    body: 17,
    caption: 13,
    // ---- Legacy scale (mapped onto the semantic steps) ----
    overline: 13,
    sub: 15,
    lead: 20,
    titleSmall: 20,
    titleMedium: 24,
    titleLarge: 32,
    displaySmall: 40,
    displayLarge: 56,
  },
  lineHeights: {
    display: 44,
    title: 34,
    heading: 26,
    body: 24,
    caption: 18,
    overline: 18,
    sub: 21,
    lead: 27,
    titleSmall: 26,
    titleMedium: 30,
    titleLarge: 38,
    displaySmall: 44,
    displayLarge: 62,
  },
  weights: {
    regular: '400',
    medium: '500',
    semiBold: '600',
  },
  letterSpacings: {
    tighter: -0.6,
    tight: -0.2,
    normal: 0,
    wide: 0.2,
    widest: 0,
  },
} as const;

export const radii = {
  control: 14, // inputs, buttons, chips
  surface: 20, // surfaces
  pill: 9999,
  // Legacy aliases
  none: 0,
  card: 20,
  sheet: 20,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  inline: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  /** Horizontal page gutter (brief: 20–24). */
  screen: 24,
  /** Vertical gap between top-level blocks on a screen. */
  section: 32,
  /** Inner padding for a surface. */
  card: 24,
} as const;

export const tokens = {
  colors,
  typography,
  radii,
  spacing,
  layout: { fill: 1 },
} as const;
