import React, { useState } from 'react';
import { View, StyleSheet, Pressable, Modal, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Text, Button, Field } from '@/components/ui';
import { colors, radii, spacing } from '@/design/tokens';
import type { DailyEntry } from '@/experiment/types';
import {
  CAFFEINE_TIME_FORMAT_MESSAGE,
  CAFFEINE_TIME_UNREADABLE_MESSAGE,
  isValidCaffeineTime,
  readCaffeineTime,
} from '@/experiment/caffeine-time';

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
  const [noCaffeine, setNoCaffeine] = useState(initialCaffeineTime === 'none');
  // Null means "not answered yet": an untouched field stays unknown and is never
  // fabricated as the current time (MISSING IS NOT ZERO).
  const [selectedTime, setSelectedTime] = useState<Date | null>(() => {
    const stored = readCaffeineTime(initialCaffeineTime);
    if (stored.kind === 'valid' && stored.time) {
      const [hour, minute] = stored.time.split(':').map(Number);
      const d = new Date();
      d.setHours(hour ?? 0, minute ?? 0, 0, 0);
      return d;
    }
    return null;
  });
  const [error, setError] = useState<string | null>(null);
  const [lastCaffeineValidationMessage, setLastCaffeineValidationMessage] = useState<string | null>(null);
  const [timePickerOpen, setTimePickerOpen] = useState(false);

  const handleCaffeinePick = (event: unknown, selectedDate?: Date) => {
    const type = event && typeof event === 'object' && 'type' in event
      ? (event as { type: string }).type
      : 'set';
    if (type === 'set' && selectedDate) {
      setSelectedTime(selectedDate);
      // Picking an explicit time overrides a previous "No caffeine" answer.
      setNoCaffeine(false);
    }
    // Both 'set' and Android's 'dismissed' close the modal; only 'set' records a time.
    setTimePickerOpen(false);
  };

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
    } else if (selectedTime && selectedTime.getHours() !== undefined && selectedTime.getMinutes() !== undefined) {
      const hour = String(selectedTime.getHours()).padStart(2, '0');
      const minute = String(selectedTime.getMinutes()).padStart(2, '0');
      const trimmed = `${hour}:${minute}`;
      if (!isValidCaffeineTime(trimmed)) {
        setLastCaffeineValidationMessage(CAFFEINE_TIME_FORMAT_MESSAGE);
        return;
      }
      finalCaffeine = trimmed;
    }

    await onSave({
      date,
      sleepMinutes: finalSleepMinutes,
      lastCaffeineTime: finalCaffeine,
    });
    setLastCaffeineValidationMessage(null);
  };

  // The button is highlighted only when a real time is set; "not answered" stays neutral.
  const timeIsSelected = !noCaffeine && selectedTime !== null;
  // Read-side policy: a stored value that is neither a valid time, 'none' nor blank is unreadable.
  const storedUnreadable = readCaffeineTime(initialCaffeineTime).kind === 'unreadable';

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
          <Pressable
            onPress={() => setTimePickerOpen(true)}
            style={[
              styles.timeButton,
              noCaffeine && styles.timeButtonNoCaffeine,
              timeIsSelected && styles.timeButtonSelected,
            ]}
          >
            <Text
              variant="sub"
              color={timeIsSelected ? 'ground' : 'ivory'}
              weight="semiBold"
            >
              {noCaffeine
                ? 'No caffeine'
                : selectedTime
                ? `${String(selectedTime.getHours()).padStart(2, '0')}:${String(selectedTime.getMinutes()).padStart(2, '0')}`
                : 'Select caffeine time'}
            </Text>
          </Pressable>
        </View>
        <Pressable
          onPress={() => setNoCaffeine(!noCaffeine)}
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

      <Modal visible={timePickerOpen} transparent animationType="fade" onRequestClose={() => setTimePickerOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.timePickerCard}>
            <Text variant="overline" color="champagneMuted">Select caffeine time</Text>
            <Text variant="titleSmall" style={styles.timePickerTitle}>Last caffeine time</Text>
            <DateTimePicker
              value={selectedTime ?? new Date()}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={handleCaffeinePick}
            />
            <Button
              label="Done"
              variant="primary"
              onPress={() => setTimePickerOpen(false)}
              style={styles.timePickerButton}
            />
          </View>
        </View>
      </Modal>

      {storedUnreadable ? (
        <Text variant="caption" color="garnet" accessibilityRole="alert">
          {CAFFEINE_TIME_UNREADABLE_MESSAGE}
        </Text>
      ) : null}
      {error ? <Text variant="caption" color="garnet">{error}</Text> : null}
      {lastCaffeineValidationMessage ? <Text variant="caption" color="garnet">{lastCaffeineValidationMessage}</Text> : null}

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
  timeButton: {
    flex: 1,
    height: 48,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.hairlineBright,
    backgroundColor: colors.surfaceHigh,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timeButtonSelected: {
    borderColor: colors.champagne,
    backgroundColor: colors.champagne,
    borderWidth: 1,
  },
  timeButtonNoCaffeine: {
    backgroundColor: colors.surfaceHigh,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 18, 24, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  timePickerCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.hairlineBright,
    width: '90%',
  },
  timePickerTitle: {
    textAlign: 'center',
  },
  timePickerButton: {
    width: '100%',
    paddingVertical: spacing.sm,
  },
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
