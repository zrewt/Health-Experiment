import React, { useState } from 'react';
import { View, StyleSheet, Pressable, Modal, Platform, Alert } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Text, Button, Field, Card } from '@/components/ui';
import { colors, radii, spacing } from '@/design/tokens';
import type { DailyEntry } from '@/experiment/types';
import {
  CAFFEINE_PRESETS,
  SCREEN_PRESETS,
  SLEEP_PRESETS,
  formatSleepFriendly,
  sleepMinutesFromInputs,
} from '@/experiment/plain-language';
import {
  CAFFEINE_TIME_FORMAT_MESSAGE,
  CAFFEINE_TIME_UNREADABLE_MESSAGE,
  isValidCaffeineTime,
  readCaffeineTime,
} from '@/experiment/caffeine-time';

/** "HH:MM" for a Date, the format the rest of the app stores. */
function formatHHMM(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** A Date on today's date at the given "HH:MM", used by the one-tap presets. */
function dateFromHHMM(time: string): Date {
  const [hour, minute] = time.split(':').map(Number);
  const d = new Date();
  d.setHours(hour ?? 0, minute ?? 0, 0, 0);
  return d;
}

/** The words and presets for each exposure. Only the words change; the controls are the same. */
const WORDS = {
  caffeine: {
    question: 'Last caffeine yesterday',
    noAnswer: 'No caffeine',
    presets: CAFFEINE_PRESETS,
    setLabel: 'Set the last caffeine time',
    clearLabel: 'Clear caffeine answer',
    quickLabel: 'Quick caffeine times',
    modalTitle: 'Last caffeine time',
    presetLabel: (label: string, time: string) => `Last caffeine ${label.toLowerCase()}, about ${time}`,
    preview: (time: string) => `Last caffeine ${time}`,
    blank: 'Caffeine left blank',
  },
  screens: {
    question: 'Last screen use yesterday',
    noAnswer: 'No screens',
    presets: SCREEN_PRESETS,
    setLabel: 'Set the last screen time',
    clearLabel: 'Clear screen answer',
    quickLabel: 'Quick screen times',
    modalTitle: 'Last screen time',
    presetLabel: (label: string, time: string) => `Last screen use ${label.toLowerCase()}, about ${time}`,
    preview: (time: string) => `Last screen use ${time}`,
    blank: 'Screen use left blank',
  },
} as const;

export type ExposureKind = keyof typeof WORDS;

interface CheckInCardProps {
  date: string;
  label?: string;
  initialSleepMinutes: number | null;
  /** The stored exposure time for the active test: caffeine time, or screen time when `exposure` is 'screens'. */
  initialCaffeineTime: string | 'none' | null;
  /** Which test the check-in records. Defaults to the caffeine test. */
  exposure?: ExposureKind;
  onSave: (entry: DailyEntry) => Promise<void>;
  saving: boolean;
}

export function CheckInCard({
  date,
  label,
  initialSleepMinutes,
  initialCaffeineTime,
  exposure = 'caffeine',
  onSave,
  saving,
}: CheckInCardProps) {
  const words = WORDS[exposure];
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
      return dateFromHHMM(stored.time);
    }
    return null;
  });
  const [webTimeText, setWebTimeText] = useState(() => {
    const stored = readCaffeineTime(initialCaffeineTime);
    return stored.kind === 'valid' && stored.time ? stored.time : '';
  });
  const [error, setError] = useState<string | null>(null);
  const [lastCaffeineValidationMessage, setLastCaffeineValidationMessage] = useState<string | null>(null);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  // Where the wheel starts when nothing is stored yet. It seeds the picker only; it is
  // never saved, so an untouched answer stays unknown instead of becoming "now".
  const [pickerSeed, setPickerSeed] = useState(() => new Date());
  // What the answer was when the picker opened. iOS applies the wheel live, so Cancel has
  // to put these back instead of merely closing the sheet.
  const [pickerStart, setPickerStart] = useState<{ time: Date | null; noCaffeine: boolean } | null>(null);
  const isIos = Platform.OS === 'ios';

  // Callers pass `key={date}`, so changing the day mounts a fresh card with the day's
  // stored values instead of syncing them through an effect.

  const handleCaffeinePick = (event: unknown, selectedDate?: Date) => {
    const type = event && typeof event === 'object' && 'type' in event
      ? (event as { type: string }).type
      : 'set';
    if (type === 'set' && selectedDate) {
      setSelectedTime(selectedDate);
      setWebTimeText(formatHHMM(selectedDate));
      // Picking an explicit time overrides a previous "No" answer.
      setNoCaffeine(false);
      setLastCaffeineValidationMessage(null);
    }
    // iOS keeps the spinner open while it is scrolled, so the wheel never vanishes
    // mid-pick; Done closes it. Android shows its own dialog, whose result closes this
    // modal either way, and only 'set' records a time.
    if (!isIos) setTimePickerOpen(false);
  };

  const cancelTimePicker = () => {
    if (pickerStart) {
      setSelectedTime(pickerStart.time);
      setNoCaffeine(pickerStart.noCaffeine);
      setWebTimeText(pickerStart.time ? formatHHMM(pickerStart.time) : '');
      setLastCaffeineValidationMessage(null);
    }
    setTimePickerOpen(false);
  };

  const handleApplyTimeModal = () => {
    if (Platform.OS === 'web') {
      const trimmed = webTimeText.trim();
      if (trimmed === '') {
        setSelectedTime(null);
        setTimePickerOpen(false);
        return;
      }
      const padded = /^\d:\d{2}$/.test(trimmed) ? `0${trimmed}` : trimmed;
      if (!isValidCaffeineTime(padded)) {
        setLastCaffeineValidationMessage(CAFFEINE_TIME_FORMAT_MESSAGE);
        return;
      }
      setSelectedTime(dateFromHHMM(padded));
      setWebTimeText(padded);
      setNoCaffeine(false);
      setLastCaffeineValidationMessage(null);
    }
    setTimePickerOpen(false);
  };

  const handleClearCaffeine = () => {
    setSelectedTime(null);
    setWebTimeText('');
    setNoCaffeine(false);
    setLastCaffeineValidationMessage(null);
  };

  const handleClearSleep = () => {
    setSleepHours('');
    setSleepMins('');
    setError(null);
  };

  const handleSave = async () => {
    setError(null);
    let finalSleepMinutes: number | null = null;
    if (sleepHours.trim() !== '' || sleepMins.trim() !== '') {
      const h = Number(sleepHours.trim()) || 0;
      const m = Number(sleepMins.trim()) || 0;
      if (h < 0 || m < 0 || m >= 60 || Number.isNaN(h) || Number.isNaN(m)) {
        setError('Check your sleep hours and minutes (minutes must be 0 to 59).');
        return;
      }
      finalSleepMinutes = h * 60 + m;
    }

    // Gentle bounds confirmation for sleep outside 2h to 14h so a typo can be taken back.
    if (finalSleepMinutes !== null) {
      const hours = finalSleepMinutes / 60;
      if (hours < 2 || hours > 14) {
        const proceed = await new Promise<boolean>((resolve) => {
          if (Platform.OS === 'web') {
            resolve(
              window.confirm(
                `You logged ${hours.toFixed(1)} hours of sleep. Save it anyway?`,
              ),
            );
          } else {
            Alert.alert(
              'That seems unusual',
              `You logged ${hours.toFixed(1)} hours of sleep. Save it anyway?`,
              [
                { text: 'Go back', onPress: () => resolve(false), style: 'cancel' },
                { text: 'Save', onPress: () => resolve(true) },
              ],
            );
          }
        });
        if (!proceed) return;
      }
    }

    let finalExposure: string | 'none' | null = null;
    if (noCaffeine) {
      finalExposure = 'none';
    } else if (selectedTime) {
      const trimmed = formatHHMM(selectedTime);
      if (!isValidCaffeineTime(trimmed)) {
        setLastCaffeineValidationMessage(CAFFEINE_TIME_FORMAT_MESSAGE);
        return;
      }
      finalExposure = trimmed;
    }

    // The screens test records its own field; the caffeine field stays empty for it.
    await onSave(
      exposure === 'screens'
        ? { date, sleepMinutes: finalSleepMinutes, lastCaffeineTime: null, lastScreenTime: finalExposure }
        : { date, sleepMinutes: finalSleepMinutes, lastCaffeineTime: finalExposure },
    );
    setLastCaffeineValidationMessage(null);
  };

  const typedSleepMinutes = sleepMinutesFromInputs(sleepHours, sleepMins);
  // The time option is highlighted only when a real time is set; "not answered" stays neutral.
  const timeIsSelected = !noCaffeine && selectedTime !== null;
  // Read-side policy: a stored value that is neither a valid time, 'none' nor blank is unreadable.
  const storedUnreadable = readCaffeineTime(initialCaffeineTime).kind === 'unreadable';
  const timeLabel = selectedTime ? formatHHMM(selectedTime) : 'Set time';

  // Live preview of what will be recorded, so the user always knows what tapping Save does.
  const sleepPreview =
    typedSleepMinutes !== null ? formatSleepFriendly(typedSleepMinutes) : 'Sleep left blank';
  const exposurePreview = noCaffeine
    ? words.noAnswer
    : selectedTime
    ? words.preview(formatHHMM(selectedTime))
    : words.blank;

  return (
    <Card tone="tint" overline={`Check-in for ${label ?? date}`}>
      <Text variant="heading">Morning check-in</Text>

      <View style={styles.sectionHeader}>
        <Text variant="sub" color="textMuted">Sleep last night</Text>
        {typedSleepMinutes !== null ? (
          <Pressable
            onPress={handleClearSleep}
            accessibilityRole="button"
            accessibilityLabel="Clear sleep amount"
          >
            <Text variant="caption" color="accent" weight="semiBold">Clear</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="Quick sleep amounts">
        {SLEEP_PRESETS.map((preset) => {
          const active = typedSleepMinutes === preset.minutes;
          return (
            <Pressable
              key={preset.minutes}
              onPress={() => {
                if (active) {
                  handleClearSleep();
                } else {
                  setSleepHours(String(preset.minutes / 60));
                  setSleepMins('0');
                  setError(null);
                }
              }}
              style={[styles.chip, active && styles.chipActive]}
              accessibilityRole="radio"
              accessibilityLabel={`Slept ${preset.label}`}
              accessibilityState={{ selected: active }}
            >
              <Text variant="caption" color={active ? 'surface' : 'text'} weight="semiBold">{preset.label}</Text>
            </Pressable>
          );
        })}
      </View>
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
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <Text variant="sub" color="textMuted">{words.question}</Text>
        {noCaffeine || selectedTime !== null ? (
          <Pressable
            onPress={handleClearCaffeine}
            accessibilityRole="button"
            accessibilityLabel={words.clearLabel}
          >
            <Text variant="caption" color="accent" weight="semiBold">Clear</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel={words.quickLabel}>
        {words.presets.map((preset) => {
          const active = !noCaffeine && selectedTime !== null && formatHHMM(selectedTime) === preset.time;
          return (
            <Pressable
              key={preset.time}
              onPress={() => {
                if (active) {
                  handleClearCaffeine();
                } else {
                  setSelectedTime(dateFromHHMM(preset.time));
                  setWebTimeText(preset.time);
                  setNoCaffeine(false);
                  setLastCaffeineValidationMessage(null);
                }
              }}
              style={[styles.chip, active && styles.chipActive]}
              accessibilityRole="radio"
              accessibilityLabel={words.presetLabel(preset.label, preset.time)}
              accessibilityState={{ selected: active }}
            >
              <Text variant="caption" color={active ? 'surface' : 'text'} weight="semiBold">{preset.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.row}>
        <Pressable
          onPress={() => {
            setWebTimeText(selectedTime ? formatHHMM(selectedTime) : '');
            setPickerSeed(new Date());
            setPickerStart({ time: selectedTime, noCaffeine });
            setTimePickerOpen(true);
          }}
          style={[styles.segment, timeIsSelected && styles.segmentActive]}
          accessibilityRole="button"
          accessibilityLabel={words.setLabel}
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
          onPress={() => {
            const next = !noCaffeine;
            setNoCaffeine(next);
            if (next) {
              setSelectedTime(null);
              setWebTimeText('');
              setLastCaffeineValidationMessage(null);
            }
          }}
          style={[styles.segment, noCaffeine && styles.segmentActive]}
          accessibilityRole="button"
          accessibilityLabel={words.noAnswer}
          accessibilityState={{ selected: noCaffeine }}
        >
          <Text
            variant="sub"
            color={noCaffeine ? 'surface' : 'text'}
            weight="semiBold"
          >
            {words.noAnswer}
          </Text>
        </Pressable>
      </View>

      <Modal visible={timePickerOpen} transparent animationType="fade" onRequestClose={cancelTimePicker}>
        <View style={styles.modalOverlay}>
          <View style={styles.timePickerCard}>
            <Text variant="caption" color="textMuted">Pick a time</Text>
            <Text variant="heading" style={styles.timePickerTitle}>
              {words.modalTitle}
            </Text>
            {Platform.OS === 'web' ? (
              <Field
                label="24-hour time (HH:MM)"
                placeholder="14:30"
                value={webTimeText}
                onChangeText={setWebTimeText}
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={handleApplyTimeModal}
              />
            ) : (
              <View style={isIos ? styles.pickerWrapIos : undefined}>
                <DateTimePicker
                  value={selectedTime ?? pickerSeed}
                  mode="time"
                  display={isIos ? 'spinner' : 'default'}
                  is24Hour
                  onValueChange={handleCaffeinePick}
                  onDismiss={() => setTimePickerOpen(false)}
                  // The card is light, so the wheel is pinned to the light appearance: left to
                  // the system, a dark-mode device draws white digits on the white card and
                  // the picker looks empty.
                  {...(isIos
                    ? { themeVariant: 'light' as const, textColor: colors.text, accentColor: colors.accent }
                    : {})}
                />
              </View>
            )}
            {lastCaffeineValidationMessage ? (
              <Text variant="caption" color="signalText">{lastCaffeineValidationMessage}</Text>
            ) : null}
            <View style={styles.row}>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={cancelTimePicker}
                style={styles.flexInput}
              />
              <Button
                label="Done"
                variant="primary"
                onPress={handleApplyTimeModal}
                style={styles.flexInput}
              />
            </View>
          </View>
        </View>
      </Modal>

      {storedUnreadable ? (
        <Text variant="caption" color="signalText" accessibilityRole="alert">
          {CAFFEINE_TIME_UNREADABLE_MESSAGE}
        </Text>
      ) : null}
      {error ? (
        <Text variant="caption" color="signalText" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {lastCaffeineValidationMessage && !timePickerOpen ? (
        <Text variant="caption" color="signalText" accessibilityRole="alert">
          {lastCaffeineValidationMessage}
        </Text>
      ) : null}

      <Text variant="caption" color="textMuted" tabular>
        Ready to save: {sleepPreview} · {exposurePreview}
      </Text>

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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  // One-tap presets: a wrapping row of 44 pt targets, same border and fill as the controls below.
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
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
    maxWidth: 420,
  },
  timePickerTitle: {
    textAlign: 'center',
  },
  // The iOS spinner has its own fixed height; naming it keeps a flex parent from
  // collapsing the wheel to nothing.
  pickerWrapIos: {
    height: 216,
    justifyContent: 'center',
  },
});
