import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, radii, spacing } from '@/design/tokens';
import {
  environmentIssues,
  environmentHint,
  environmentFixSteps,
} from '@/lib/env';
import { Text } from './Text';
import { Button } from './Button';

interface AccountSetupNoticeProps {
  /** Optional back affordance, rendered when supplied. */
  onBack?: () => void;
  /** Shorter copy for tight layouts. */
  compact?: boolean;
}

/**
 * Shown wherever accounts are unavailable. Renders the specific reason each
 * public variable was rejected so a misconfigured or stale dev server is
 * self-diagnosing instead of a dead end.
 */
export const AccountSetupNotice: React.FC<AccountSetupNoticeProps> = ({
  onBack,
  compact = false,
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.pip} />
        <Text variant="overline" color="champagne">
          Accounts unavailable
        </Text>
      </View>

      <Text variant="body" color="ivory" style={styles.lead}>
        {compact
          ? 'Accounts are not configured in this build.'
          : 'Aevum could not reach its account service in this build.'}
      </Text>

      {environmentIssues.length > 0 && (
        <View style={styles.issueList}>
          {environmentIssues.map((issue) => (
            <View key={issue.variable} style={styles.issueRow}>
              <Text variant="overline" color="garnet" style={styles.issueVar}>
                {issue.variable}
              </Text>
              <Text variant="caption" color="ivoryMuted" style={styles.issueReason}>
                {issue.reason}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Text variant="caption" color="ivoryMuted" style={styles.hint}>
        {environmentHint}
      </Text>

      <View style={styles.steps}>
        <Text variant="overline" color="ivorySecondary">
          To fix
        </Text>
        {environmentFixSteps.map((step) => (
          <Text key={step} variant="caption" color="ivoryMuted" style={styles.step}>
            — {step}
          </Text>
        ))}
      </View>

      {onBack && (
        <Button label="Back" variant="secondary" onPress={onBack} />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: radii.card,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.garnet,
    padding: spacing.md,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pip: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.garnet,
  },
  lead: {
    lineHeight: 22,
  },
  issueList: {
    gap: spacing.xs,
  },
  issueRow: {
    gap: 2,
  },
  issueVar: {
    letterSpacing: 1,
  },
  issueReason: {
    lineHeight: 18,
  },
  hint: {
    lineHeight: 18,
  },
  steps: {
    gap: 2,
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth || 1,
    borderTopColor: colors.hairline,
  },
  step: {
    lineHeight: 18,
  },
});
