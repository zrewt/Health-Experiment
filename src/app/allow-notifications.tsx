import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { Screen, Card, Text, Button, SplitDisc } from '@/components/ui';
import { spacing } from '@/design/tokens';
import {
  REMINDER_ASKED_KEY,
  openNotificationSettings,
  requestReminderPermission,
  type ReminderPermission,
} from '@/notifications/reminders';

/**
 * The reminders step of onboarding, shown once right after consent. It asks the system for
 * permission from a screen that explains why, so the prompt never appears unexplained on a
 * later home-screen visit.
 */
export default function AllowNotificationsScreen() {
  const router = useRouter();
  const [requesting, setRequesting] = useState(false);
  const [permission, setPermission] = useState<ReminderPermission | null>(null);

  const finish = () => router.replace('/run-in');

  // Whatever the answer, the system prompt has been dealt with, so the home screen must not
  // ask again. A storage error here is harmless: the system never re-prompts a decided app.
  const markAsked = async () => {
    try {
      await AsyncStorage.setItem(REMINDER_ASKED_KEY, 'true');
    } catch {
      // Ignored on purpose; see above.
    }
  };

  const turnOn = async () => {
    setRequesting(true);
    try {
      const next = await requestReminderPermission();
      await markAsked();
      if (next === 'granted') {
        finish();
        return;
      }
      setPermission(next);
    } catch {
      await markAsked();
      setPermission('denied');
    } finally {
      setRequesting(false);
    }
  };

  const notNow = async () => {
    await markAsked();
    finish();
  };

  return (
    <Screen>
      <Card tone="hero" style={styles.card}>
        <SplitDisc size={76} tone="none" />
        <Text variant="caption" color="textMuted">One more thing · Reminders</Text>
        <Text variant="title" accessibilityRole="header">Want a daily nudge?</Text>
        <Text variant="body" color="textMuted">
          A reminder each morning helps you log last night, and one before your cutoff time on test days.
        </Text>
        <Text variant="caption" color="textMuted">
          Reminders come from this phone. You can change or turn them off any time in Settings.
        </Text>

        {permission === 'denied' ? (
          <>
            <Text variant="sub" color="textMuted" accessibilityLiveRegion="polite">
              Notifications are off for Aevum. You can turn them on later in your phone&apos;s settings.
            </Text>
            <Button
              label="Open phone settings"
              variant="secondary"
              onPress={() => void openNotificationSettings()}
            />
            <Button label="Continue" variant="primary" onPress={finish} />
          </>
        ) : (
          <>
            <Button
              label="Turn on reminders"
              variant="primary"
              loading={requesting}
              disabled={requesting}
              onPress={() => void turnOn()}
            />
            <Button
              label="Not now"
              variant="quiet"
              disabled={requesting}
              onPress={() => void notNow()}
            />
          </>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
});
