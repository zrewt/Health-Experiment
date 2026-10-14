import React, { useState } from 'react';
import { StyleSheet, View, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, ScreenHeader, Card, Disclosure, Text, Button } from '@/components/ui';
import { colors, radii, spacing } from '@/design/tokens';
import { useAuthStore } from '@/store/auth';
import { saveConsent, saveSetup, type ScreeningAnswer } from '@/data/experiment-store';
import { getToday } from '@/experiment/clock';
import { conditionRule } from '@/experiment/config';

// DRAFT NOTICE:
// The consent copy, data description, and privacy policy placeholder are DRAFTS
// needing human legal review before publishing.

export default function SetupConsentScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  // Form states
  const [screening, setScreening] = useState<ScreeningAnswer | null>(null);
  const [screeningAcknowledged, setScreeningAcknowledged] = useState(false);
  const [cutoffTime, setCutoffTime] = useState<string>(conditionRule.cutoffTime);
  const [agreed, setAgreed] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  const canSubmit = screening !== null &&
    (screening !== 'rarely_or_never' || screeningAcknowledged) &&
    agreed &&
    !saving;

  const handleAgreeAndContinue = async () => {
    if (!user) {
      setError('You must be signed in to set up an experiment.');
      return;
    }
    if (!screening) return;
    setSaving(true);
    setError(null);

    try {
      // 1. Record affirmative consent
      await saveConsent(user.id, true);

      // 2. Record setup configuration
      await saveSetup(user.id, {
        experimentId: 'caffeine-cutoff',
        cutoffTime,
        screeningAnswer: screening,
        runInStartDate: getToday(),
      });

      router.replace('/run-in');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save setup. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDecline = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await saveConsent(user.id, false);
      setDeclined(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record decline.');
    } finally {
      setSaving(false);
    }
  };

  if (declined) {
    return (
      <Screen>
        <View style={styles.centerContainer}>
          <Text variant="titleMedium" style={styles.title}>Consent Declined</Text>
          <Text variant="body" color="ivorySecondary" style={styles.paragraph}>
            The experiment requires permission to log your sleep and caffeine data. Without this consent, the app cannot be used for this study.
          </Text>
          <Text variant="caption" color="ivoryMuted" style={styles.legalDisclaimer}>
            This app is not medical advice.
          </Text>
          <View style={styles.buttonSpacing}>
            <Button
              label="Review consent again"
              variant="secondary"
              onPress={() => setDeclined(false)}
            />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          overline="SETUP"
          title="Caffeine & Sleep Experiment"
          notice="This app is not medical advice."
          action={<Button label="Today" variant="quiet" onPress={() => router.replace('/')} />}
        />

        <Card title="How this experiment works">
          <View style={styles.pointRow}>
            <Text variant="body" color="champagne" weight="semiBold">1. </Text>
            <Text variant="body" color="ivorySecondary" style={styles.pointText}>
              14 valid days of normal life first to understand your baseline sleep and caffeine routine.
            </Text>
          </View>
          <View style={styles.pointRow}>
            <Text variant="body" color="champagne" weight="semiBold">2. </Text>
            <Text variant="body" color="ivorySecondary" style={styles.pointText}>
              Then we check whether an experiment could give you a clear answer before you commit.
            </Text>
          </View>
          <View style={styles.pointRow}>
            <Text variant="body" color="champagne" weight="semiBold">3. </Text>
            <Text variant="body" color="ivorySecondary" style={styles.pointText}>
              Some people will be told it is not informative yet, and that is an honest result.
            </Text>
          </View>
        </Card>

        <Card overline="EXPERIMENT" title="Caffeine cutoff and next-night sleep">
          <Text variant="body" color="ivorySecondary">
            Measures whether ending caffeine consumption by an early cutoff time changes your recorded sleep duration that night.
          </Text>
        </Card>

        <Card title="Screening Question">
          <Text variant="body" color="ivorySecondary" style={styles.questionText}>
            Do you usually have caffeine after noon?
          </Text>

          <View style={styles.optionsGroup}>
            {(['usually', 'sometimes', 'rarely_or_never'] as ScreeningAnswer[]).map((opt) => (
              <Pressable
                key={opt}
                onPress={() => {
                  setScreening(opt);
                  setScreeningAcknowledged(false);
                }}
                style={[
                  styles.optionButton,
                  screening === opt && styles.optionButtonActive,
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected: screening === opt }}
              >
                <Text
                  variant="body"
                  color={screening === opt ? 'ivory' : 'ivorySecondary'}
                  weight={screening === opt ? 'semiBold' : 'regular'}
                >
                  {opt === 'usually' ? 'Usually' : opt === 'sometimes' ? 'Sometimes' : 'Rarely or never'}
                </Text>
              </Pressable>
            ))}
          </View>

          {screening === 'rarely_or_never' ? (
            <View style={styles.honestNotice}>
              <Text variant="sub" color="champagneLight" weight="medium">
                Because you rarely or never consume caffeine in the afternoon, this cutoff experiment is unlikely to tell you anything.
              </Text>
              <View style={styles.inlineButtons}>
                <Button
                  label={screeningAcknowledged ? 'Continuing anyway' : 'Continue anyway'}
                  variant={screeningAcknowledged ? 'primary' : 'secondary'}
                  onPress={() => setScreeningAcknowledged(true)}
                  style={styles.flexBtn}
                />
                <Button
                  label="Not now"
                  variant="quiet"
                  onPress={() => router.back()}
                  style={styles.flexBtn}
                />
              </View>
            </View>
          ) : null}
        </Card>

        <Card title="Cutoff Time">
          <Text variant="body" color="ivorySecondary">
            The scheduled time after which intervention days avoid caffeine:
          </Text>
          <View style={styles.cutoffRow}>
            {['11:00', '12:00', '13:00', '14:00'].map((time) => (
              <Pressable
                key={time}
                onPress={() => setCutoffTime(time)}
                style={[
                  styles.cutoffPill,
                  cutoffTime === time && styles.cutoffPillActive,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Cutoff time ${time}`}
              >
                <Text
                  variant="sub"
                  color={cutoffTime === time ? 'ground' : 'ivorySecondary'}
                  weight="semiBold"
                >
                  {time}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>

        <Card
          overline="CONSENT & DATA USE (DRAFT)"
          title="Informed Consent"
          style={styles.consentCard}
        >
          <Text variant="body" color="ivorySecondary">
            To run this experiment, the app collects and securely stores:
          </Text>
          <View style={styles.bulletList}>
            <Text variant="sub" color="ivorySecondary">• Sleep duration (hours and minutes logged each morning)</Text>
            <Text variant="sub" color="ivorySecondary">• Time of last caffeine intake (or whether none was consumed)</Text>
            <Text variant="sub" color="ivorySecondary">• Your experiment schedule and resulting statistical summaries</Text>
          </View>

          <Disclosure label="View Draft Privacy Policy">
            <Text variant="caption" color="ivoryMuted">
              [DRAFT PLACEHOLDER - FOR LEGAL REVIEW]: Data collected in this application is used solely for the calculation of personal n-of-1 self-experiments. Your data will not be sold to third parties. A final production privacy policy must be approved by legal counsel prior to app release.
            </Text>
          </Disclosure>

          {/* Affirmative agreement */}
          <Pressable
            onPress={() => setAgreed(!agreed)}
            style={styles.checkboxRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            accessibilityLabel="I agree to share sleep duration, caffeine intake, and experiment records"
          >
            <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
              {agreed ? <Text variant="body" color="ground" weight="semiBold">✓</Text> : null}
            </View>
            <Text variant="body" color="ivory" style={styles.checkboxLabel}>
              I agree to the collection and processing of my health and caffeine log data as described.
            </Text>
          </Pressable>

          <View style={styles.consentActions}>
            <Button
              label="I agree & start run-in"
              variant="primary"
              disabled={!canSubmit}
              loading={saving}
              onPress={() => void handleAgreeAndContinue()}
            />
            <Button
              label="I don't agree"
              variant="quiet"
              disabled={saving}
              onPress={() => void handleDecline()}
            />
          </View>
        </Card>

        {error ? (
          <Text variant="sub" color="garnet" style={styles.errorText} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  title: {
    marginBottom: spacing.xs,
  },
  paragraph: {
    marginTop: spacing.xs,
  },
  legalDisclaimer: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
  pointRow: {
    flexDirection: 'row',
    marginTop: spacing.xs,
    alignItems: 'flex-start',
  },
  pointText: {
    flex: 1,
  },
  questionText: {
    marginVertical: spacing.sm,
  },
  optionsGroup: {
    marginVertical: spacing.xs,
  },
  optionButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radii.control,
    marginVertical: spacing.xs,
  },
  optionButtonActive: {
    borderColor: colors.champagne,
    backgroundColor: colors.surfaceHighlight,
  },
  honestNotice: {
    marginTop: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radii.control,
  },
  inlineButtons: {
    flexDirection: 'row',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  flexBtn: {
    flex: 1,
  },
  cutoffRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  cutoffPill: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.hairline,
    borderWidth: 1,
  },
  cutoffPillActive: {
    backgroundColor: colors.champagne,
    borderColor: colors.champagneLight,
  },
  consentCard: {
    borderColor: colors.hairlineGold,
  },
  bulletList: {
    marginVertical: spacing.sm,
    gap: spacing.xs,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.champagne,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  checkboxChecked: {
    backgroundColor: colors.champagne,
  },
  checkboxLabel: {
    flex: 1,
  },
  consentActions: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  buttonSpacing: {
    marginTop: spacing.lg,
    width: '100%',
  },
  errorText: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
