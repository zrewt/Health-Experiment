import React, { useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, Button, Field } from '@/components/ui';
import { colors, radii, spacing } from '@/design/tokens';
import type { DailyEntry } from '@/experiment/types';

interface CheckInCardProps {
  date: string;
  label?: string;
  initialSleepMinutes: number | null;
  initialCaffeineTime: string | 'none' | null;
  onSave: (entry: DailyEntry) => Promise<void>;
  saving: boolean;
}

export function CheckInCard({
  date,
  label,
  initialSleepMinutes,
  initialCaffeineTime,
  onSave,
  saving,
}: CheckInCardProps) {
  const [sleepHours, setSleepHours] = useState(
    initialSleepMinutes !== null ? String(Math.floor(initialSleepMinutes / 60)) : ''
  );
  const [sleepMins, setSleepMins] = useState(
    initialSleepMinutes !== null ? String(initialSleepMinutes % 60) : ''
  );
  const [caffeineTime, setCaffeineTime] = useState(
    initialCaffeineTime && initialCaffeineTime !== 'none' ? initialCaffeineTime : ''
  );
  const [noCaffeine, setNoCaffeine] = useState(initialCaffeineTime === 'none');
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    let finalSleepMinutes: number | null = null;
    if (sleepHours.trim() !== '' || sleepMins.trim() !== '') {
      const h = Number(sleepHours.trim()) || 0;
      const m = Number(sleepMins.trim()) || 0;
      if (h < 0 || m < 0 || m >= 60) {
        setError('Please enter valid sleep hours and minutes.');
        return;
      }
      finalSleepMinutes = h * 60 + m;
    }

    let finalCaffeine: string | 'none' | null = null;
    if (noCaffeine) {
      finalCaffeine = 'none';
    } else if (caffeineTime.trim() !== '') {
      finalCaffeine = caffeineTime.trim();
    }

    await onSave({
      date,
      sleepMinutes: finalSleepMinutes,
      lastCaffeineTime: finalCaffeine,
    });
  };

  return (
    <View style={styles.card}>
      <Text variant="overline" color="champagneMuted">
        CHECK-IN FOR {label ?? date}
      </Text>
      <Text variant="titleSmall" style={styles.cardTitle}>Morning Check-in</Text>

      <Text variant="sub" color="ivory" weight="medium">
        Sleep duration (hours & minutes)
      </Text>
      <View style={styles.row}>
        <View style={styles.flexInput}>
          <Field
            placeholder="Hours (e.g. 7)"
            keyboardType="numeric"
            value={sleepHours}
            onChangeText={setSleepHours}
          />
        </View>
        <View style={styles.flexInput}>
          <Field
            placeholder="Minutes (e.g. 30)"
            keyboardType="numeric"
            value={sleepMins}
            onChangeText={setSleepMins}
          />
        </View>
      </View>

      <Text variant="sub" color="ivory" weight="medium">
        Last caffeine time (yesterday)
      </Text>
      <View style={styles.row}>
        <View style={styles.flexInput}>
          <Field
            placeholder="HH:MM (e.g. 14:30)"
            editable={!noCaffeine}
            value={noCaffeine ? '' : caffeineTime}
            onChangeText={setCaffeineTime}
          />
        </View>
        <Pressable
          onPress={() => {
            setNoCaffeine(!noCaffeine);
            if (!noCaffeine) setCaffeineTime('');
          }}
          style={[styles.noCaffeineBtn, noCaffeine && styles.noCaffeineBtnActive]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: noCaffeine }}
        >
          <Text
            variant="sub"
            color={noCaffeine ? 'ground' : 'ivorySecondary'}
            weight="semiBold"
          >
            No caffeine
          </Text>
        </Pressable>
      </View>

      {error ? <Text variant="caption" color="garnet">{error}</Text> : null}

      <Button
        label={saving ? 'Saving...' : 'Save check-in'}
        variant="primary"
        disabled={saving}
        loading={saving}
        onPress={() => void handleSave()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.hairlineBright,
  },
  cardTitle: { marginBottom: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  flexInput: { flex: 1 },
  noCaffeineBtn: {
    height: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.hairlineBright,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surfaceHigh,
  },
  noCaffeineBtnActive: {
    backgroundColor: colors.champagne,
    borderColor: colors.champagne,
  },
});
