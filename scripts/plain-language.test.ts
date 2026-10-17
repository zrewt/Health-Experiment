import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CAFFEINE_PRESETS,
  SLEEP_PRESETS,
  formatSleepFriendly,
  progressDots,
  progressSentence,
  sleepMinutesFromInputs,
  weeklyRecap,
} from '../src/experiment/plain-language';
import type { DailyEntry } from '../src/experiment/types';

function entry(date: string, sleepMinutes: number | null): DailyEntry {
  return { date, sleepMinutes, lastCaffeineTime: null };
}

test('sleep presets are whole-hour amounts in minutes and fill cleanly', () => {
  assert.deepEqual(SLEEP_PRESETS.map(p => p.minutes), [360, 420, 480, 540]);
  for (const preset of SLEEP_PRESETS) {
    assert.equal(sleepMinutesFromInputs(String(preset.minutes / 60), '0'), preset.minutes);
  }
});

test('caffeine presets are valid HH:MM times in order of the day', () => {
  const times = CAFFEINE_PRESETS.map(p => p.time);
  assert.deepEqual(times, [...times].sort());
  for (const time of times) {
    assert.match(time, /^([01]\d|2[0-3]):[0-5]\d$/);
  }
});

test('sleepMinutesFromInputs returns null only when both fields are empty', () => {
  assert.equal(sleepMinutesFromInputs('', ''), null);
  assert.equal(sleepMinutesFromInputs('  ', ' '), null);
  assert.equal(sleepMinutesFromInputs('7', ''), 420);
  assert.equal(sleepMinutesFromInputs('', '45'), 45);
  assert.equal(sleepMinutesFromInputs('7', '30'), 450);
  assert.equal(sleepMinutesFromInputs('abc', '15'), 15);
});

test('formatSleepFriendly reads sleep in everyday words', () => {
  assert.equal(formatSleepFriendly(null), 'Not logged');
  assert.equal(formatSleepFriendly(60), '1 hour');
  assert.equal(formatSleepFriendly(420), '7 hours');
  assert.equal(formatSleepFriendly(450), '7½ hours');
  assert.equal(formatSleepFriendly(440), '7 h 20 min');
});

test('progressDots fills one dot per logged night and never exceeds the target', () => {
  assert.deepEqual(progressDots(0, 3), [false, false, false]);
  assert.deepEqual(progressDots(2, 4), [true, true, false, false]);
  assert.deepEqual(progressDots(9, 4), [true, true, true, true]);
  assert.deepEqual(progressDots(-1, 2), [false, false]);
  assert.deepEqual(progressDots(1, 0), []);
});

test('progressSentence says where the user is without comparing anything', () => {
  assert.equal(progressSentence(0, 14), 'Log last night to start your first night.');
  assert.equal(progressSentence(3, 14), 'Good start. 11 more nights to go.');
  assert.equal(progressSentence(7, 14), 'Halfway there. 7 more nights to go.');
  assert.equal(progressSentence(13, 14), 'Halfway there. 1 more night to go.');
  assert.equal(progressSentence(14, 14), 'Your nights are in. Nice work.');
  assert.equal(progressSentence(20, 14), 'Your nights are in. Nice work.');
});

test('weeklyRecap reads back only the seven nights before today that have sleep logged', () => {
  const today = '2026-02-10';
  const entries = [
    entry('2026-02-02', 999), // eight days back: outside the window
    entry('2026-02-03', 360),
    entry('2026-02-04', null), // no sleep logged: not counted
    entry('2026-02-09', 480),
    entry('2026-02-10', 1000), // today: describes a future night, not counted
  ];
  const recap = weeklyRecap(entries, today);
  assert.equal(recap.daysLogged, 2);
  assert.equal(recap.averageSleepMinutes, 420);
  assert.equal(
    recap.sentence,
    'You logged 2 nights this week, and slept about 7 hours on average.',
  );
});

test('weeklyRecap handles a single night and an empty week', () => {
  const single = weeklyRecap([entry('2026-02-09', 450)], '2026-02-10');
  assert.equal(single.daysLogged, 1);
  assert.equal(single.sentence, 'You logged 1 night this week, and slept about 7½ hours on average.');

  const empty = weeklyRecap([], '2026-02-10');
  assert.equal(empty.daysLogged, 0);
  assert.equal(empty.averageSleepMinutes, null);
  assert.equal(empty.sentence, 'No nights logged this week yet.');
});
