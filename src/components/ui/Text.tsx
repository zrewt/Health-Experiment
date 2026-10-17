import React from 'react';
import { Text as RNText, TextStyle, TextProps as RNTextProps } from 'react-native';
import { colors, typography } from '@/design/tokens';

export type TextVariant =
  | 'display'
  | 'title'
  | 'heading'
  | 'lead'
  | 'body'
  | 'sub'
  | 'caption';

export type TextColor =
  | 'text'
  | 'textMuted'
  | 'accent'
  | 'signalText'
  | 'surface';

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
  title: { weight: 'semiBold', letterSpacing: -0.2 },
  heading: { weight: 'semiBold' },
  lead: { weight: 'regular' },
  body: { weight: 'regular' },
  sub: { weight: 'regular' },
  caption: { weight: 'medium' },
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
  const textColor = colors[color] ?? colors.text;
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
