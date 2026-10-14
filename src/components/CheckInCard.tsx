import React, { useState } from 'react';
import { View, StyleSheet, Pressable, Modal, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Text, Button, Field, Card } from '@/components/ui';
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

  // Callers pass `key={date}`, so changing the day mounts a fresh card with the day's
  // stored values instead of syncing them through an effect.

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
        setError('Check your sleep hours and minutes.');
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

  // The time option is highlighted only when a real time is set; "not answered" stays neutral.
  const timeIsSelected = !noCaffeine && selectedTime !== null;
  // Read-side policy: a stored value that is neither a valid time, 'none' nor blank is unreadable.
  const storedUnreadable = readCaffeineTime(initialCaffeineTime).kind === 'unreadable';
  const timeLabel = selectedTime
    ? `${String(selectedTime.getHours()).padStart(2, '0')}:${String(selectedTime.getMinutes()).padStart(2, '0')}`
    : 'Set time';

  return (
    <Card tone="tint" overline={`Check-in for ${label ?? date}`}>
      <Text variant="heading">Morning check-in</Text>

      <Text variant="sub" color="textMuted">Sleep last night</Text>
      <View style={styles.row}>
        <View style={styles.flexInput}>
          <Field
            label="Hours"
            placeholder="7"
            keyboardType="numeric"
            value={sleepHours}
            onChangeText={setSleepHours}
            containerStyle={styles.inputContainer}
          />
        </View>
        <View style={styles.flexInput}>
          <Field
            label="Minutes"
            placeholder="30"
            keyboardType="numeric"
            value={sleepMins}
            onChangeText={setSleepMins}
            containerStyle={styles.inputContainer}
          />
        </View>        </View>
      <Text variant="sub" color="textMuted">Last caffeine yesterday</Text>
      <View style={styles.row}>
        <Pressable
          onPress={() => setTimePickerOpen(true)}
          style={[styles.segment, timeIsSelected && styles.segmentActive]}
          accessibilityRole="button"
          accessibilityLabel="Set the last caffeine time"
          accessibilityState={{ selected: timeIsSelected }}
        >
          <Text
            variant="sub"
            color={timeIsSelected ? 'surface' : 'text'}
            weight="semiBold"
            tabular
          >
            {timeLabel}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setNoCaffeine((prev) => !prev)}
          style={[styles.segment, noCaffeine && styles.segmentActive]}
          accessibilityRole="button"
          accessibilityLabel="No caffeine"
          accessibilityState={{ selected: noCaffeine }}
        >
          <Text
            variant="sub"
            color={noCaffeine ? 'surface' : 'text'}
            weight="semiBold"
          >
            No caffeine
          </Text>
        </Pressable>
      </View>

      <Modal visible={timePickerOpen} transparent animationType="fade" onRequestClose={() => setTimePickerOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.timePickerCard}>
            <Text variant="caption" color="textMuted">Pick a time</Text>
            <Text variant="heading" style={styles.timePickerTitle}>
              Last caffeine time
            </Text>
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
        <Text variant="caption" color="signalText" accessibilityRole="alert">
          {CAFFEINE_TIME_UNREADABLE_MESSAGE}
        </Text>
      ) : null}
      {error ? <Text variant="caption" color="signalText">{error}</Text> : null}
      {lastCaffeineValidationMessage ? <Text variant="caption" color="signalText">{lastCaffeineValidationMessage}</Text> : null}

      <Button
        label={saving ? 'Saving...' : 'Save check-in'}
        variant="primary"
        disabled={saving}
        loading={saving}
        onPress={() => void handleSave()}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  flexInput: { flex: 1 },
  inputContainer: { marginVertical: 0 },
  // The two answer controls are inputs, so they carry the one border the design allows,
  // in lineStrong so their boundary is perceivable (3.18:1 on the background).
  segment: {
    flex: 1,
    minHeight: 52,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timePickerCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.surface,
    padding: spacing.lg,
    gap: spacing.md,
    width: '90%',
  },
  timePickerTitle: {
    textAlign: 'center',
  },
  timePickerButton: {
    width: '100%',
    paddingVertical: spacing.sm,
  },
});
