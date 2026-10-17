import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, Text, Button } from '@/components/ui';
import { spacing } from '@/design/tokens';
import type { ExposureKind } from '@/experiment/experiments';

/** The evening heads-up only appears in the four hours before the cutoff. */
const WINDOW_MINUTES = 4 * 60;

function nowMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function cutoffMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * A live countdown for a cutoff afternoon/evening, with the one action that matters then:
 * "I'm off now". The tap records the time for tomorrow's check-in; it never logs the night
 * on the user's behalf.
 *
 * Renders nothing away from the window, so it can be placed on the daily screen all day.
 */
export function CutoffCountdown({
  cutoffTime,
  exposure,
  loggedOffAt,
  onLogOff,
}: {
  cutoffTime: string;
  exposure: ExposureKind;
  /** The time already tapped for this evening, HH:mm, or null. */
  loggedOffAt: string | null;
  onLogOff: (time: string) => void;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const remaining = cutoffMinutes(cutoffTime) - nowMinutes(now);
  const screens = exposure === 'screens';

  if (loggedOffAt) {
    return (
      <Card tone="tint" overline="Tonight">
        <Text variant="heading">Saved: off at {loggedOffAt}.</Text>
        <Text variant="sub" color="textMuted">
          We will fill this time into tomorrow&apos;s check-in. You can change it then.
        </Text>
      </Card>
    );
  }

  if (remaining <= 0 || remaining > WINDOW_MINUTES) return null;

  const remainingText = remaining <= 1 ? 'under a minute' : `${remaining} min`;

  return (
    <Card tone="tint" overline="Tonight">
      <Text variant="heading">
        {screens ? `Screens off in ${remainingText}.` : `Caffeine cutoff in ${remainingText}.`}
      </Text>
      <Text variant="caption" color="textMuted">
        Your cutoff is {cutoffTime}.
      </Text>
      <View style={styles.action}>
        <Button
          label={screens ? "I'm off now" : 'No more caffeine'}
          variant="primary"
          onPress={() => onLogOff(hhmm(new Date()))}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  action: { marginTop: spacing.sm },
});
