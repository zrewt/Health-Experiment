import React from 'react';
import { Text as RNText, TextStyle, TextProps as RNTextProps } from 'react-native';
import { colors, typography } from '@/design/tokens';

export type TextVariant =
  // Semantic scale
  | 'display'
  | 'title'
  | 'heading'
  | 'body'
  | 'caption'
  // Legacy names, mapped onto the semantic steps until part 2 migrates the rest
  | 'overline'
  | 'sub'
  | 'lead'
  | 'titleSmall'
  | 'titleMedium'
  | 'titleLarge'
  | 'displaySmall'
  | 'displayLarge';

export type TextColor =
  // Semantic
  | 'text'
  | 'textMuted'
  | 'accent'
  | 'signalText'
  | 'surface'
  // Legacy aliases
  | 'ground'
  | 'ivory'
  | 'ivorySecondary'
  | 'ivoryMuted'
  | 'ivorySubtle'
  | 'champagne'
  | 'champagneLight'
  | 'champagneMuted'
  | 'garnet';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: TextColor;
  weight?: 'regular' | 'medium' | 'semiBold';
  tabular?: boolean;
  /** Accepted and ignored: the redesign is system-sans only, so nothing reverts to a serif. */
  serif?: boolean;
  letterSpacing?: number;
  style?: TextStyle | TextStyle[];
  children?: React.ReactNode;
}

/** Per-variant defaults, so a screen only has to say what differs. */
const DEFAULTS: Record<TextVariant, { weight: TextProps['weight']; letterSpacing?: number }> = {
  display: { weight: 'semiBold', letterSpacing: -0.6 },
  displaySmall: { weight: 'semiBold', letterSpacing: -0.6 },
  displayLarge: { weight: 'semiBold', letterSpacing: -0.6 },
  title: { weight: 'semiBold', letterSpacing: -0.2 },
  titleLarge: { weight: 'semiBold', letterSpacing: -0.2 },
  titleMedium: { weight: 'semiBold', letterSpacing: -0.2 },
  heading: { weight: 'semiBold' },
  titleSmall: { weight: 'semiBold' },
  lead: { weight: 'regular' },
  body: { weight: 'regular' },
  sub: { weight: 'regular' },
  caption: { weight: 'medium' },
  overline: { weight: 'medium' },
};

export const Text: React.FC<TextProps> = ({
  variant = 'body',
  color = 'text',
  weight,
  tabular = false,
  style,
  children,
  ...props
}) => {
  const defaults = DEFAULTS[variant] ?? DEFAULTS.body;
  const resolvedWeight = weight ?? defaults.weight ?? 'regular';
  const textColor = (colors as Record<string, string>)[color] ?? colors.text;
  const fontSize = typography.sizes[variant] ?? typography.sizes.body;
  const lineHeight = typography.lineHeights[variant] ?? typography.lineHeights.body;

  return (
    <RNText
      style={[
        {
          fontFamily: typography.fonts.body,
          fontWeight: typography.weights[resolvedWeight],
          fontSize,
          lineHeight,
          color: textColor,
          letterSpacing: defaults.letterSpacing ?? typography.letterSpacings.normal,
          fontVariant: tabular ? ['tabular-nums'] : undefined,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </RNText>
  );
};
