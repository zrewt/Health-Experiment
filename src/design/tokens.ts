/**
 * Aevum design tokens — light, calm, premium.
 *
 * Semantic names only:
 * - background (Mist #F3F7F6), surface (Paper #FFFFFF), surfaceTint (#E8F1EF)
 * - text (Ink #0F2A2E), textMuted (Ink soft #51666A)
 * - accent (Lagoon #12776A), graphic (Mint #7DE0C3), signal (Coral #FF8A6B), signalText (#A8432C)
 * - line (#E4ECEB), lineStrong (#788F8C), focus (#12776A), overlay
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
    display: 40,
    title: 28,
    heading: 20,
    lead: 20,
    body: 17,
    sub: 15,
    caption: 13,
  },
  lineHeights: {
    display: 44,
    title: 34,
    heading: 26,
    lead: 27,
    body: 24,
    sub: 21,
    caption: 18,
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
