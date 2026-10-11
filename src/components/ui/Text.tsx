import React from 'react';
import { Text as RNText, TextStyle, TextProps as RNTextProps } from 'react-native';
import { colors, typography } from '@/design/tokens';

export type TextVariant =
  | 'overline'
  | 'caption'
  | 'sub'
  | 'body'
  | 'lead'
  | 'titleSmall'
  | 'titleMedium'
  | 'titleLarge'
  | 'displaySmall'
  | 'displayLarge';

export type TextColor =
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
  serif?: boolean;
  letterSpacing?: number;
  style?: TextStyle | TextStyle[];
  children?: React.ReactNode;
}

export const Text: React.FC<TextProps> = ({
  variant = 'body',
  color = 'ivory',
  weight = 'regular',
  tabular = false,
  serif,
  letterSpacing,
  style,
  children,
  ...props
}) => {
  // Use display serif specifically for hero numerals & primary editorial display statements
  const shouldUseSerif =
    serif !== undefined
      ? serif
      : variant === 'displayLarge' || variant === 'displaySmall' || variant === 'titleLarge';

  let fontFamily: string = typography.fonts.body;
  if (shouldUseSerif) {
    fontFamily = typography.fonts.display;
  } else if (weight === 'medium') {
    fontFamily = typography.fonts.bodyMedium;
  } else if (weight === 'semiBold') {
    fontFamily = typography.fonts.bodySemiBold;
  }

  const textColor = colors[color] || colors.ivory;
  const fontSize = typography.sizes[variant] || typography.sizes.body;
  const lineHeight = typography.lineHeights[variant] || typography.lineHeights.body;

  let calculatedSpacing = letterSpacing;
  if (calculatedSpacing === undefined) {
    if (variant === 'overline') calculatedSpacing = typography.letterSpacings.widest;
    else if (variant === 'displayLarge' || variant === 'displaySmall') calculatedSpacing = -1;
    else if (variant === 'titleLarge') calculatedSpacing = -0.6;
    else if (variant === 'titleMedium' || variant === 'titleSmall') calculatedSpacing = -0.2;
    else if (variant === 'caption' || variant === 'sub') calculatedSpacing = 0.1;
  }

  return (
    <RNText
      maxFontSizeMultiplier={shouldUseSerif ? 1.2 : 1.5}
      style={[
        {
          fontFamily,
          fontSize,
          lineHeight,
          color: textColor,
          letterSpacing: calculatedSpacing,
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
