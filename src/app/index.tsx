import { useEffect, useState } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Text, Button } from '@/components/ui';
import { colors, radii, spacing } from '@/design/tokens';
import { useAuthStore } from '@/store/auth';
import { authErrorMessage } from '@/lib/auth';
import {
  getConsent,
  getSetup,
  listEntries,
  getActivePlan,
} from '@/data/experiment-store';
import { getToday } from '@/experiment/clock';
import { getHomeState, HomeState } from '@/experiment/home-state';
import { syncReminders } from '@/notifications/reminders';

export default function HomeScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const signOut = useAuthStore((state) => state.signOut);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [homeState, setHomeState] = useState<HomeState | null>(null);
  const [reminderNotice, setReminderNotice] = useState<string | null>(null);

  const today = getToday();

  useEffect(() => {
    if (!user) return;
    let current = true;
    void (async () => {
      try {
        const [consent, setup, entries, plan] = await Promise.all([
          getConsent(user.id),
          getSetup(user.id),
          listEntries(user.id),
          getActivePlan(user.id),
        ]);
        if (!current) return;
        const state = getHomeState({
          consent,
          setup,
          entries,
          plan,
          today,
        });
        setHomeState(state);

        // Keep the scheduled reminder in step with the state. This resolves to an outcome
        // rather than throwing, so a notification problem can never break the home screen.
        const reminder = await syncReminders({
          state,
          today,
          plan: plan
            ? {
              startDate: plan.plan.startDate,
              chosenDuration: plan.plan.chosenDuration,
              schedule: plan.plan.schedule,
              conditionRule: plan.plan.definition.conditionRule,
            }
            : null,
        });
        if (!current) return;
        setReminderNotice(
          reminder.status === 'skipped' && reminder.permission === 'denied'
            ? 'Daily reminders are off. Turn notifications on for Aevum in Settings to get a check-in nudge.'
            : null,
        );
      } catch (e) {
        if (current) setError(e instanceof Error ? e.message : 'Could not determine status.');
      }
    })();
    return () => { current = false; };
  }, [user, today]);

  const handleSignOut = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      await signOut();
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  const navigateToStateScreen = () => {
    switch (homeState) {
      case 'needs_consent':
      case 'needs_setup':
        router.push('/setup-consent');
        break;
      case 'feasibility_ready':
        router.push('/feasibility');
        break;
      case 'plan_scheduled':
      case 'plan_active':
        router.push('/daily-instruction');
        break;
      case 'plan_awaiting_final':
      case 'plan_result_ready':
        router.push('/result');
        break;
      case 'run_in':
      default:
        router.push('/run-in');
        break;
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text variant="titleSmall">Home</Text>
          <Button label="Sign out" variant="quiet" loading={loading} onPress={() => void handleSignOut()} />
        </View>
        {error ? <Text color="garnet" accessibilityRole="alert">{error}</Text> : null}
        {reminderNotice ? (
          <Text variant="caption" color="ivoryMuted">{reminderNotice}</Text>
        ) : null}

        <View style={styles.actionCard}>
          <Text variant="titleSmall" style={styles.cardTitle}>Self-Experiment</Text>
          <Text variant="body" color="ivorySecondary" style={styles.cardBody}>
            Track your sleep and evaluate whether caffeine cutoff improves sleep duration.
          </Text>

          {homeState === 'plan_ended_early' ? (
            <View style={styles.endedBox}>
              <Text variant="sub" color="champagneLight" weight="medium">
                Your experiment was ended early without a result. Your logged entries have been preserved.
              </Text>
            </View>
          ) : (
            <Button
              label={
                homeState === 'needs_consent' || homeState === 'needs_setup'
                  ? 'Setup & Consent'
                  : homeState === 'feasibility_ready'
                  ? 'Check Feasibility'
                  : homeState === 'plan_scheduled' || homeState === 'plan_active'
                  ? 'Daily Instruction'
                  : homeState === 'plan_awaiting_final'
                  ? 'Final Check-in'
                  : homeState === 'plan_result_ready'
                  ? 'See Result'
                  : 'Run-in Check-in'
              }
              variant="primary"
              onPress={navigateToStateScreen}
            />
          )}
        </View>

        {typeof __DEV__ !== 'undefined' && __DEV__ ? (
          <View style={styles.devCard}>
            <Text variant="overline" color="champagneMuted">DEVELOPMENT TOOLS</Text>
            <Button
              label="Open Dev Tools"
              variant="quiet"
              onPress={() => router.push('/dev-tools')}
            />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actionCard: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radii.card,
    gap: spacing.sm,
  },
  cardTitle: { marginBottom: spacing.xs },
  cardBody: { marginBottom: spacing.sm },
  endedBox: {
    padding: spacing.sm,
    backgroundColor: colors.surfaceHigh,
    borderRadius: radii.control,
  },
  resultBox: {
    padding: spacing.sm,
    backgroundColor: colors.surfaceHigh,
    borderRadius: radii.control,
  },
  devCard: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.hairlineHighlight,
    borderWidth: 1,
    borderRadius: radii.card,
    gap: spacing.xs,
  },
});
