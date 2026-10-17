import React, { useEffect, useState } from 'react';
import { StyleSheet, View, ScrollView, Pressable } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import {
  Screen,
  Card,
  Details,
  Text,
  Button,
  Banner,
  Field,
  SplitDisc,
  type DiscTone,
} from '@/components/ui';
import { colors, radii, spacing } from '@/design/tokens';
import { useAuthStore } from '@/store/auth';
import {
  DEFAULT_EXPERIMENT_ID,
  getConsent,
  getSetup,
  saveConsent,
  saveSetup,
  type ScreeningAnswer,
} from '@/data/experiment-store';
import { getToday } from '@/experiment/clock';
import { getMotivation, saveMotivation, MAX_MOTIVATION_LENGTH } from '@/data/motivation';
import { cutoffRuleText, experimentById } from '@/experiment/experiments';
import { consentCoversCurrentVersion } from '@/experiment/consent';
import { remindersSupported } from '@/notifications/reminders';

// DRAFT NOTICE:
// The consent copy, data description, and privacy policy placeholder are DRAFTS
// needing human legal review before publishing.

type OnboardingStep = 0 | 1 | 2 | 3;

const TOTAL_STEPS = 4;

const STEP_META: Record<
  OnboardingStep,
  { overline: string; discTone: DiscTone; discCaption: string }
> = {
  0: {
    overline: 'Step 1 of 4 · How this works',
    discTone: 'normal',
    discCaption: 'One day at a time',
  },
  1: {
    overline: 'Step 2 of 4 · One question',
    discTone: 'cutoff',
    discCaption: 'Afternoon habits',
  },
  2: {
    overline: 'Step 3 of 4 · Cutoff time',
    discTone: 'cutoff',
    discCaption: 'Cutoff day',
  },
  3: {
    overline: 'Step 4 of 4 · Before you start',
    discTone: 'none',
    discCaption: 'Private log',
  },
};

/** The caffeine test cuts caffeine in the middle of the day. */
const CUTOFF_CHOICES = ['11:00', '12:00', '13:00', '14:00'] as const;

/** The screens test cuts screens in the evening, so its choices are evening times. */
const SCREEN_CUTOFF_CHOICES = ['20:00', '21:00', '21:30', '22:00'] as const;

const SCREENING_CHOICES: {
  value: ScreeningAnswer;
  label: string;
  detail: string;
}[] = [
  {
    value: 'usually',
    label: 'Usually',
    detail: 'Most days I have coffee, tea, or energy drinks in the afternoon.',
  },
  {
    value: 'sometimes',
    label: 'Sometimes',
    detail: 'A few afternoons a week.',
  },
  {
    value: 'rarely_or_never',
    label: 'Rarely or never',
    detail: 'I almost always stop before noon.',
  },
];

/** The same three answers, worded for the screens test. */
const SCREEN_SCREENING_CHOICES: {
  value: ScreeningAnswer;
  label: string;
  detail: string;
}[] = [
  {
    value: 'usually',
    label: 'Most evenings',
    detail: 'Most evenings I use a screen until close to bed.',
  },
  {
    value: 'sometimes',
    label: 'Some evenings',
    detail: 'A few evenings a week.',
  },
  {
    value: 'rarely_or_never',
    label: 'Rarely or never',
    detail: 'I usually stop well before bed.',
  },
];

export default function SetupConsentScreen() {
  const router = useRouter();
  // The choose-a-test screen can send a first-time user here with the test they picked.
  const params = useLocalSearchParams<{ id?: string }>();
  const requestedId = typeof params.id === 'string' ? params.id : undefined;
  const user = useAuthStore((state) => state.user);
  const reduceMotion = useReducedMotion();

  const [step, setStep] = useState<OnboardingStep>(0);
  const [screening, setScreening] = useState<ScreeningAnswer | null>(null);
  const [screeningAcknowledged, setScreeningAcknowledged] = useState(false);
  const [experimentId, setExperimentId] = useState<string>(requestedId ?? DEFAULT_EXPERIMENT_ID);
  const [cutoffTime, setCutoffTime] = useState<string>(
    experimentById(requestedId ?? DEFAULT_EXPERIMENT_ID).defaultCutoff,
  );
  const [existingRunInStartDate, setExistingRunInStartDate] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const [agreed, setAgreed] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  // Everything this screen says about the test comes from the registry, so a screens test
  // never reads the caffeine wording.
  const experiment = experimentById(experimentId);
  const isScreens = experiment.id === 'screens-off-cutoff';

  // Smooth step transitions + progress fill, skipped when reduced motion is enabled.
  const stepOpacity = useSharedValue(1);
  const stepTranslateY = useSharedValue(0);
  const progressFraction = useSharedValue(1 / TOTAL_STEPS);

  // Preload saved setup if the user opened this flow from Settings, while keeping
  // affirmative consent unchecked until explicitly confirmed.
  useEffect(() => {
    if (!user?.id) return;
    let current = true;
    void (async () => {
      try {
        const [loadedSetup, loadedConsent, loadedWhy] = await Promise.all([
          getSetup(user.id),
          getConsent(user.id),
          getMotivation(user.id),
        ]);
        if (!current) return;
        if (loadedWhy) setWhy(loadedWhy);
        if (loadedSetup) {
          // A test chosen on the choose screen wins over the one stored earlier; its cutoff
          // is not carried across, because the two tests cut at very different times.
          const effectiveId = requestedId ?? loadedSetup.experimentId;
          setExperimentId(effectiveId);
          setScreening(loadedSetup.screeningAnswer);
          setCutoffTime(
            effectiveId === loadedSetup.experimentId
              ? loadedSetup.cutoffTime
              : experimentById(effectiveId).defaultCutoff,
          );
          setExistingRunInStartDate(loadedSetup.runInStartDate);
          if (loadedSetup.screeningAnswer === 'rarely_or_never') {
            setScreeningAcknowledged(true);
          }
        }
        // Only the wording this build requires counts: an older agreement must be re-asked.
        if (consentCoversCurrentVersion(loadedConsent)) {
          setAgreed(true);
        }
      } catch {
        // Non-blocking: defaults remain usable if offline cache is empty.
      }
    })();
    return () => {
      current = false;
    };
  }, [user?.id, requestedId]);

  const animateToStep = (next: OnboardingStep) => {
    setError(null);
    try {
      Haptics.selectionAsync();
    } catch {
      // Optional haptic feedback
    }

    const nextProgress = (next + 1) / TOTAL_STEPS;
    if (reduceMotion) {
      setStep(next);
      progressFraction.value = nextProgress;
      stepOpacity.value = 1;
      stepTranslateY.value = 0;
      return;
    }

    const direction = next > step ? 1 : -1;
    stepOpacity.value = 0;
    stepTranslateY.value = direction * 14;
    setStep(next);
    progressFraction.value = withTiming(nextProgress, {
      duration: 260,
      easing: Easing.out(Easing.cubic),
    });
    stepOpacity.value = withTiming(1, {
      duration: 240,
      easing: Easing.out(Easing.cubic),
    });
    stepTranslateY.value = withTiming(0, {
      duration: 240,
      easing: Easing.out(Easing.cubic),
    });
  };

  const stageAnimatedStyle = useAnimatedStyle(() => ({
    opacity: stepOpacity.value,
    transform: [{ translateY: stepTranslateY.value }],
  }));

  const progressFillStyle = useAnimatedStyle(() => ({
    width: `${Math.round(progressFraction.value * 100)}%`,
  }));

  const canAdvanceFromStep1 =
    screening !== null && (screening !== 'rarely_or_never' || screeningAcknowledged);

  const canSubmit = canAdvanceFromStep1 && agreed && !saving;

  const handleAgreeAndContinue = async () => {
    if (!user) {
      setError('You must be signed in to set this up.');
      return;
    }
    if (!screening) return;
    setSaving(true);
    setError(null);

    try {
      // 1. Record affirmative consent
      await saveConsent(user.id, true);

      // The optional reason is a local note, never a gate: a failure here cannot block setup.
      try {
        await saveMotivation(user.id, why);
      } catch {
        // The note is only used for the why-echo; setup continues without it.
      }

      // 2. Record setup configuration (preserve existing runInStartDate if editing from Settings)
      await saveSetup(user.id, {
        experimentId: experiment.id,
        cutoffTime,
        screeningAnswer: screening,
        runInStartDate: existingRunInStartDate ?? getToday(),
      });

      // On phones the reminders step comes next; web has no notifications, so it goes on.
      router.replace((remindersSupported() ? '/allow-notifications' : '/run-in') as Href);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save setup. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDecline = async () => {
    if (!user) return;
    setSaving(true);
    setError(null);
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
        <View style={styles.declinedContainer}>
          <Card tone="hero">
            <SplitDisc size={72} tone="none" />
            <Text variant="title" accessibilityRole="header">
              No problem
            </Text>
            <Text variant="body" color="textMuted">
              Without your permission the app cannot log your sleep, caffeine and screen times,
              so the test cannot run.
            </Text>
            <Text variant="caption" color="textMuted">
              This app is not medical advice.
            </Text>
            <Button
              label="Review it again"
              variant="secondary"
              onPress={() => {
                setDeclined(false);
                animateToStep(3);
              }}
            />
          </Card>
        </View>
      </Screen>
    );
  }

  const meta = STEP_META[step];
  const screeningChoices = isScreens ? SCREEN_SCREENING_CHOICES : SCREENING_CHOICES;
  const screeningTitle = isScreens
    ? 'Do screens play a part in your evenings?'
    : 'Do you usually have caffeine after noon?';
  const screeningBody = isScreens
    ? 'The test compares evenings when screens go off early with evenings when they don’t. This is a behaviour change, not a treatment.'
    : 'A cutoff test only has something to compare if you sometimes have caffeine in the afternoon.';
  const screeningGroupLabel = isScreens ? 'Evening screen habit' : 'Afternoon caffeine habit';
  const rarelyText = isScreens
    ? 'You rarely use screens in the evening, so this test is unlikely to tell you much.'
    : 'You rarely have caffeine in the afternoon, so this test is unlikely to tell you much.';
  const purposeLine = isScreens
    ? 'Three calm steps to see whether evening screens change your sleep.'
    : 'Three calm steps to see whether afternoon caffeine changes your sleep.';
  // A time saved under another build (or carried over from the other test) stays selectable
  // instead of leaving the picker with nothing chosen.
  const baseChoices: readonly string[] = isScreens ? SCREEN_CUTOFF_CHOICES : CUTOFF_CHOICES;
  const cutoffChoices: readonly string[] = baseChoices.includes(cutoffTime)
    ? baseChoices
    : [...baseChoices, cutoffTime].sort();

  return (
    <Screen>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Top bar: progress indicator and contextual navigation */}
        <View style={styles.topHeader}>
          <View style={styles.topRow}>
            <Text variant="caption" color="textMuted" tabular>
              {meta.overline}
            </Text>
            {step > 0 ? (
              <Pressable
                onPress={() => animateToStep((step - 1) as OnboardingStep)}
                disabled={saving}
                style={styles.navTouch}
                accessibilityRole="button"
                accessibilityLabel="Previous step"
              >
                <Text variant="sub" color="accent" weight="semiBold">
                  Back
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => router.replace('/')}
                disabled={saving}
                style={styles.navTouch}
                accessibilityRole="button"
                accessibilityLabel="Back to Today"
              >
                <Text variant="sub" color="accent" weight="semiBold">
                  Today
                </Text>
              </Pressable>
            )}
          </View>

          {/* Animated progress bar */}
          <View
            style={styles.progressTrack}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 1, max: TOTAL_STEPS, now: step + 1 }}
          >
            <Animated.View style={[styles.progressFill, progressFillStyle]} />
          </View>

          <Text variant="caption" color="textMuted">
            This app is not medical advice.
          </Text>
        </View>

        {error ? <Banner tone="error">{error}</Banner> : null}

        {/* Animated step container */}
        <Animated.View style={[styles.stage, stageAnimatedStyle]}>
          {/* Signature mark header that adapts to the step */}
          <View style={styles.discHeader}>
            <SplitDisc key={meta.discTone} size={76} tone={meta.discTone} />
            <View style={styles.discMeta}>
              <Text variant="caption" color="textMuted">
                {experiment.name}
              </Text>
              <Text variant="heading" color="text">
                {meta.discCaption}
              </Text>
            </View>
          </View>

          {/* STEP 0: How this works */}
          {step === 0 ? (
            <Card tone="hero">
              <Text variant="title" accessibilityRole="header">
                How this works
              </Text>
              <Text variant="body" color="textMuted">
                {purposeLine}
              </Text>

              <View style={styles.stepList}>
                <View style={styles.stepItem}>
                  <View style={styles.stepBadge}>
                    <Text variant="caption" color="surface" weight="semiBold" tabular>
                      1
                    </Text>
                  </View>
                  <View style={styles.stepBody}>
                    <Text variant="body" weight="semiBold">
                      Getting to know your sleep
                    </Text>
                    <Text variant="sub" color="textMuted">
                      Log your sleep each morning for about two weeks. Keep your usual habits.
                    </Text>
                  </View>
                </View>

                <View style={styles.stepItem}>
                  <View style={styles.stepBadge}>
                    <Text variant="caption" color="surface" weight="semiBold" tabular>
                      2
                    </Text>
                  </View>
                  <View style={styles.stepBody}>
                    <Text variant="body" weight="semiBold">
                      Is this test worth doing?
                    </Text>
                    <Text variant="sub" color="textMuted">
                      Then we check whether a test can tell you anything.
                    </Text>
                  </View>
                </View>

                <View style={styles.stepItem}>
                  <View style={styles.stepBadge}>
                    <Text variant="caption" color="surface" weight="semiBold" tabular>
                      3
                    </Text>
                  </View>
                  <View style={styles.stepBody}>
                    <Text variant="body" weight="semiBold">
                      What we found
                    </Text>
                    <Text variant="sub" color="textMuted">
                      If it can, you run the test, one day at a time: a cutoff day or a normal day. At the end, what we found.
                    </Text>
                  </View>
                </View>
              </View>

              <Button
                label="Continue"
                variant="primary"
                onPress={() => animateToStep(1)}
              />
            </Card>
          ) : null}

          {/* STEP 1: One question about the habit this test looks at */}
          {step === 1 ? (
            <Card tone="hero">
              <Text variant="title" accessibilityRole="header">
                {screeningTitle}
              </Text>
              <Text variant="body" color="textMuted">
                {screeningBody}
              </Text>

              <View
                style={styles.optionsGroup}
                accessibilityRole="radiogroup"
                accessibilityLabel={screeningGroupLabel}
              >
                {screeningChoices.map((choice) => {
                  const selected = screening === choice.value;
                  return (
                    <Pressable
                      key={choice.value}
                      onPress={() => {
                        setScreening(choice.value);
                        setScreeningAcknowledged(false);
                      }}
                      style={[
                        styles.optionCard,
                        selected && styles.optionCardSelected,
                      ]}
                      accessibilityRole="radio"
                      accessibilityLabel={choice.label}
                      accessibilityState={{ selected }}
                    >
                      <View style={styles.optionHeader}>
                        <Text
                          variant="body"
                          color={selected ? 'surface' : 'text'}
                          weight="semiBold"
                        >
                          {choice.label}
                        </Text>
                        <View
                          style={[
                            styles.radioDot,
                            selected && styles.radioDotSelected,
                          ]}
                        />
                      </View>
                      <Text
                        variant="caption"
                        color={selected ? 'surface' : 'textMuted'}
                      >
                        {choice.detail}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {screening === 'rarely_or_never' ? (
                <Card tone="tint">
                  <Text variant="sub" color="text" weight="medium">
                    {rarelyText}
                  </Text>
                  <View style={styles.inlineButtons}>
                    <Button
                      label={screeningAcknowledged ? 'Continuing anyway' : 'Continue anyway'}
                      variant={screeningAcknowledged ? 'primary' : 'secondary'}
                      onPress={() => {
                        setScreeningAcknowledged(true);
                        animateToStep(2);
                      }}
                      style={styles.flexBtn}
                    />
                    <Button
                      label="Not now"
                      variant="quiet"
                      onPress={() => router.replace('/')}
                      style={styles.flexBtn}
                    />
                  </View>
                </Card>
              ) : (
                <Button
                  label="Continue"
                  variant="primary"
                  disabled={!canAdvanceFromStep1}
                  onPress={() => animateToStep(2)}
                />
              )}
            </Card>
          ) : null}

          {/* STEP 2: Cutoff time */}
          {step === 2 ? (
            <Card tone="hero">
              <Text variant="title" accessibilityRole="header">
                Your cutoff time
              </Text>
              <Text variant="body" color="textMuted">
                On cutoff days, {experiment.cutoffRule} after this time:
              </Text>

              <View
                style={styles.cutoffGrid}
                accessibilityRole="radiogroup"
                accessibilityLabel={`Daily ${experiment.exposureWord} cutoff time`}
              >
                {cutoffChoices.map((time) => {
                  const active = cutoffTime === time;
                  return (
                    <Pressable
                      key={time}
                      onPress={() => setCutoffTime(time)}
                      style={[
                        styles.cutoffCard,
                        active && styles.cutoffCardActive,
                      ]}
                      accessibilityRole="radio"
                      accessibilityLabel={`Cutoff time ${time}`}
                      accessibilityState={{ selected: active }}
                    >
                      <Text
                        variant="heading"
                        color={active ? 'surface' : 'text'}
                        weight="semiBold"
                        tabular
                      >
                        {time}
                      </Text>
                      <Text
                        variant="caption"
                        color={active ? 'surface' : 'textMuted'}
                      >
                        {time === '12:00' ? 'Noon' : '24-hour'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Card tone="tint">
                <Text variant="caption" color="textMuted">
                  On a cutoff day, your note will say:
                </Text>
                <Text variant="body" weight="semiBold" tabular>
                  Today: cutoff day, {cutoffRuleText(experiment, cutoffTime)}
                </Text>
              </Card>

              {/* Optional, local only, and never a gate. It comes back on harder days. */}
              <Field
                label="Why are you doing this? (optional)"
                placeholder="Mornings with my daughter"
                value={why}
                onChangeText={setWhy}
                maxLength={MAX_MOTIVATION_LENGTH}
                autoCapitalize="sentences"
              />
              <Text variant="caption" color="textMuted">
                Only you see this. It can help on harder days.
              </Text>

              <Button
                label="Continue"
                variant="primary"
                onPress={() => animateToStep(3)}
              />
            </Card>
          ) : null}

          {/* STEP 3: Consent & Start */}
          {step === 3 ? (
            <Card tone="hero">
              <Text variant="title" accessibilityRole="header">
                Your consent
              </Text>

              <Card tone="tint">
                <Text variant="sub" color="text">
                  • You log your sleep, caffeine times and screen times each morning.
                </Text>
                <Text variant="sub" color="text">
                  • We keep your logs in your own account.
                </Text>
                <Text variant="sub" color="text">
                  • You can stop and delete it all any time.
                </Text>
                <Text variant="sub" color="text">
                  • This app is not medical advice.
                </Text>
              </Card>

              <Details summary="The full consent and privacy text, as drafted">
                <Text variant="caption" color="textMuted">
                  [DRAFT PLACEHOLDER - FOR LEGAL REVIEW]: Data collected in this application is used solely for the calculation of personal n-of-1 self-experiments. Your data will not be sold to third parties. A final production privacy policy must be approved by legal counsel prior to app release.
                </Text>
              </Details>

              {/* Affirmative agreement */}
              <Pressable
                onPress={() => setAgreed((prev) => !prev)}
                style={styles.checkboxRow}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: agreed }}
                accessibilityLabel="I agree to store my sleep, caffeine and screen time logs for this test"
              >
                <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
                  {agreed ? (
                    <Text variant="body" color="surface" weight="semiBold">
                      ✓
                    </Text>
                  ) : null}
                </View>
                <Text variant="body" color="text" style={styles.checkboxLabel}>
                  I agree to my sleep, caffeine and screen time logs being stored for this test.
                </Text>
              </Pressable>

              <View style={styles.consentActions}>
                <Button
                  label="I agree, let's start"
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
          ) : null}
        </Animated.View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  declinedContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  topHeader: {
    gap: spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  navTouch: {
    minHeight: 44,
    minWidth: 48,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  progressTrack: {
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceTint,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  stage: {
    gap: spacing.lg,
  },
  discHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  discMeta: {
    flex: 1,
    gap: 2,
  },
  stepList: {
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  stepBody: {
    flex: 1,
    gap: 2,
  },
  optionsGroup: {
    gap: spacing.sm,
  },
  optionCard: {
    padding: spacing.md,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    gap: 4,
  },
  optionCardSelected: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  radioDot: {
    width: 18,
    height: 18,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.lineStrong,
  },
  radioDotSelected: {
    borderColor: colors.surface,
    backgroundColor: colors.graphic,
  },
  inlineButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  flexBtn: {
    flex: 1,
  },
  cutoffGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cutoffCard: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: 72,
    padding: spacing.md,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
  },
  cutoffCardActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 52,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  checkboxLabel: {
    flex: 1,
  },
  consentActions: {
    gap: spacing.sm,
  },
});
