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
    <View style={styles.container} accessibilityRole="alert">
      <View style={styles.headerRow}>
        <View style={styles.pip} />
        <Text variant="caption" color="signalText" weight="semiBold">
          Accounts unavailable
        </Text>
      </View>

      <Text variant="body" color="text">
        {compact
          ? 'Accounts are not configured in this build.'
          : 'Aevum could not reach its account service in this build.'}
      </Text>

      {environmentIssues.length > 0 && (
        <View style={styles.issueList}>
          {environmentIssues.map((issue) => (
            <View key={issue.variable} style={styles.issueRow}>
              <Text variant="caption" color="signalText" weight="semiBold">
                {issue.variable}
              </Text>
              <Text variant="caption" color="textMuted">
                {issue.reason}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Text variant="caption" color="textMuted">
        {environmentHint}
      </Text>

      <View style={styles.steps}>
        <Text variant="caption" color="text" weight="semiBold">
          To fix
        </Text>
        {environmentFixSteps.map((step) => (
          <Text key={step} variant="caption" color="textMuted">
            — {step}
          </Text>
        ))}
      </View>

      {onBack && <Button label="Back" variant="secondary" onPress={onBack} />}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radii.surface,
    borderWidth: 1,
    borderColor: colors.signalText,
    padding: spacing.md,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pip: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: colors.signalText,
  },
  issueList: {
    gap: spacing.xs,
  },
  issueRow: {
    gap: 2,
  },
  steps: {
    gap: 2,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
});
