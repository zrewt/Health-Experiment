import React, { useEffect, useState } from 'react';
import { StyleSheet, View, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Text, Button, Field } from '@/components/ui';
import { colors, radii, spacing } from '@/design/tokens';
import { useAuthStore } from '@/store/auth';
import {
  getReminderPermission,
  openNotificationSettings,
  requestReminderPermission,
  remindersSupported,
  syncReminders,
  loadReminderSyncInput,
  type ReminderPermission,
} from '@/notifications/reminders';
import {
  DEFAULT_REMINDER_PREFERENCES,
  conditionAction,
  parseReminderTime,
  type ReminderPreferences,
} from '@/notifications/reminder-plan';
import { loadReminderPreferences, saveReminderPreferences } from '@/notifications/reminder-preferences';
import { getActivePlan } from '@/data/experiment-store';

export default function ReminderSettingsScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  const [preferences, setPreferences] = useState<ReminderPreferences>(DEFAULT_REMINDER_PREFERENCES);
  const [permission, setPermission] = useState<ReminderPermission>('undetermined');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Only an experiment with a recognised condition rule has a moment worth warning about.
  const [hasActionableRule, setHasActionableRule] = useState(false);

  useEffect(() => {
    if (!user) return;
    let current = true;
    void (async () => {
      try {
        const [stored, currentPermission, plan] = await Promise.all([
          loadReminderPreferences(),
          getReminderPermission(),
          getActivePlan(user.id).catch(() => null),
        ]);
        if (!current) return;
        setPreferences(stored);
        setPermission(currentPermission);
        setHasActionableRule(conditionAction(plan?.plan.definition.conditionRule ?? null) !== null);
      } catch (e) {
        if (current) setError(e instanceof Error ? e.message : 'Could not load your reminder settings.');
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; };
  }, [user]);

  const update = (patch: Partial<ReminderPreferences>) => {
    setPreferences((prev) => ({ ...prev, ...patch }));
    setStatus(null);
  };

  const handleEnable = async () => {
    if (requesting) return;
    setRequesting(true);
    setError(null);
    try {
      if (permission === 'denied') {
        // The OS will not show the prompt again, so the only way back is the settings app.
        await openNotificationSettings();
      } else {
        const next = await requestReminderPermission();
        setPermission(next);
        setStatus(next === 'granted' ? 'Notifications are on.' : 'Notifications were not enabled.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the notification permission.');
    } finally {
      setRequesting(false);
    }
  };

  const handleSave = async () => {
    if (!user || saving) return;
    setError(null);
    setStatus(null);

    // A stored time is only ever a strict HH:mm; anything else would silently fall back to
    // the default, so reject it here rather than pretend the value was kept.
    if (!parseReminderTime(preferences.morningTime)) {
      setError('The morning reminder must be a 24-hour time like 08:00.');
      return;
    }
    if (!parseReminderTime(preferences.previewTime)) {
      setError('The evening reminder must be a 24-hour time like 21:00.');
      return;
    }

    setSaving(true);
    try {
      const saved = await saveReminderPreferences(preferences);
      setPreferences(saved);

      // Reschedule immediately so turning something off takes effect now, not the next time
      // the home screen happens to be opened.
      const outcome = await syncReminders(await loadReminderSyncInput(user.id));
      if (outcome.status === 'failed') {
        setError(`Saved, but the reminders could not be rescheduled: ${outcome.message}`);
      } else if (outcome.status === 'skipped') {
        setError('Saved. Notifications are still not permitted, so nothing will be delivered yet.');
      } else if (outcome.status === 'unavailable') {
        setStatus('Saved. Reminders are not available on this platform.');
      } else if (outcome.status === 'scheduled') {
        setStatus(`Saved. ${outcome.count} reminder${outcome.count === 1 ? '' : 's'} scheduled.`);
      } else {
        setStatus('Saved. No reminders are scheduled.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your reminder settings.');
    } finally {
      setSaving(false);
    }
  };

  const permissionLine = !remindersSupported()
    ? 'Reminders are not available on this platform.'
    : permission === 'granted'
      ? 'Notifications are on.'
      : permission === 'denied'
        ? 'Notifications are off. Turn them on for Aevum in Settings.'
        : 'Notifications are not enabled yet.';

  if (loading) {
    return (
      <Screen>
        <Text color="ivorySecondary">Loading reminder settings...</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="titleLarge">Reminders</Text>
        <Text color="ivorySecondary">
          Gentle nudges to log your sleep. Nothing here is medical advice.
        </Text>

        {error ? <Text color="garnet" accessibilityRole="alert">{error}</Text> : null}
        {status ? <Text color="champagneLight">{status}</Text> : null}

        <View style={styles.card}>
          <Text variant="overline" color="champagneMuted">NOTIFICATIONS</Text>
          <Text variant="sub" color="ivorySecondary">{permissionLine}</Text>
          {remindersSupported() && permission !== 'granted' ? (
            <Button
              testID="enable-notifications"
              label={permission === 'denied' ? 'Open notification settings' : 'Turn on notifications'}
              variant="primary"
              loading={requesting}
              onPress={() => void handleEnable()}
            />
          ) : null}
        </View>

        <View style={styles.card}>
          <Text variant="overline" color="champagneMuted">DAILY CHECK-IN</Text>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: preferences.enabled }}
            accessibilityLabel="Daily reminders"
            onPress={() => update({ enabled: !preferences.enabled })}
            style={[styles.toggle, preferences.enabled && styles.toggleOn]}
          >
            <Text variant="sub" color={preferences.enabled ? 'ground' : 'ivory'} weight="semiBold">
              {preferences.enabled ? 'On' : 'Off'}
            </Text>
          </Pressable>
          <Text variant="caption" color="ivoryMuted">
            Turning this off clears every scheduled reminder.
          </Text>

          <Field
            label="Morning check-in time (24-hour, HH:mm)"
            value={preferences.morningTime}
            onChangeText={(value) => update({ morningTime: value })}
            placeholder="08:00"
            editable={preferences.enabled}
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
          />
        </View>

        <View style={styles.card}>
          <Text variant="overline" color="champagneMuted">EXPERIMENT REMINDERS</Text>
          {hasActionableRule ? (
            <>
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: preferences.actionEnabled }}
                accessibilityLabel="Reminder before the cutoff"
                onPress={() => update({ actionEnabled: !preferences.actionEnabled })}
                style={[styles.toggle, preferences.actionEnabled && preferences.enabled && styles.toggleOn]}
              >
                <Text variant="sub" color={preferences.actionEnabled && preferences.enabled ? 'ground' : 'ivory'} weight="semiBold">
                  {preferences.actionEnabled ? 'On' : 'Off'}
                </Text>
              </Pressable>
              <Text variant="caption" color="ivoryMuted">
                A nudge shortly before the cutoff, only on the days the rule is assigned to you.
              </Text>

              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: preferences.previewEnabled }}
                accessibilityLabel="Heads-up the evening before"
                onPress={() => update({ previewEnabled: !preferences.previewEnabled })}
                style={[styles.toggle, preferences.previewEnabled && preferences.enabled && styles.toggleOn]}
              >
                <Text variant="sub" color={preferences.previewEnabled && preferences.enabled ? 'ground' : 'ivory'} weight="semiBold">
                  {preferences.previewEnabled ? 'On' : 'Off'}
                </Text>
              </Pressable>
              <Text variant="caption" color="ivoryMuted">
                The evening before an assigned day, so you can plan ahead.
              </Text>

              <Field
                label="Evening heads-up time (24-hour, HH:mm)"
                value={preferences.previewTime}
                onChangeText={(value) => update({ previewTime: value })}
                placeholder="21:00"
                editable={preferences.enabled}
                autoCapitalize="none"
                keyboardType="numbers-and-punctuation"
              />
            </>
          ) : (
            <Text variant="sub" color="ivorySecondary">
              These appear once you have a running experiment with a rule worth warning you about.
            </Text>
          )}
        </View>

        <Button
          testID="save-reminders"
          label="Save reminder settings"
          variant="primary"
          loading={saving}
          onPress={() => void handleSave()}
        />
        <Button label="Back to Home" variant="secondary" onPress={() => router.replace('/')} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.hairlineBright,
  },
  toggle: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairlineBright,
    backgroundColor: colors.surfaceHigh,
  },
  toggleOn: {
    backgroundColor: colors.champagne,
    borderColor: colors.champagne,
  },
});
