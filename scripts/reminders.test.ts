import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DAILY_REMINDER_DATA_KEY,
  DEFAULT_REMINDER_TIME,
  needsDailyCheckIn,
  parseReminderTime,
  pickReminderIds,
  reminderForState,
  resolveReminderTime,
} from '../src/notifications/reminder-plan';
import type { HomeState } from '../src/experiment/home-state';

test('reminder time parser accepts only strict 24-hour HH:mm', () => {
  for (const value of ['00:00', '08:00', '09:05', '14:30', '23:59']) {
    assert.notEqual(parseReminderTime(value), null, `accepts ${value}`);
  }
  for (const value of ['8:00', '8:0', '24:00', '12:60', '08:60', '0800', '08:00:00', ' 08:00', '08:00 ', '', 'none', 'noon']) {
    assert.equal(parseReminderTime(value), null, `rejects ${JSON.stringify(value)}`);
  }
  assert.deepEqual(parseReminderTime('08:00'), { hour: 8, minute: 0 });
  assert.deepEqual(parseReminderTime('23:59'), { hour: 23, minute: 59 });
});

test('an unusable stored reminder time falls back to the default instead of disabling the reminder', () => {
  assert.deepEqual(resolveReminderTime(undefined), parseReminderTime(DEFAULT_REMINDER_TIME));
  assert.deepEqual(resolveReminderTime(null), parseReminderTime(DEFAULT_REMINDER_TIME));
  assert.deepEqual(resolveReminderTime('nonsense'), parseReminderTime(DEFAULT_REMINDER_TIME));
  assert.deepEqual(resolveReminderTime('06:30'), { hour: 6, minute: 30 });
});

test('only states with a daily logging habit carry a reminder', () => {
  for (const state of ['run_in', 'plan_scheduled', 'plan_active', 'plan_awaiting_final'] as HomeState[]) {
    assert.equal(needsDailyCheckIn(state), true, `${state} needs a daily reminder`);
  }
  for (const state of ['needs_consent', 'needs_setup', 'feasibility_ready', 'plan_result_ready', 'plan_ended_early'] as HomeState[]) {
    assert.equal(needsDailyCheckIn(state), false, `${state} must not carry a daily reminder`);
    assert.equal(reminderForState({ state }), null, `${state} yields no reminder`);
  }
});

test('run-in reminder uses the default time and asks for the sleep log', () => {
  const reminder = reminderForState({ state: 'run_in' });
  assert.notEqual(reminder, null);
  assert.equal(reminder!.hour, 8);
  assert.equal(reminder!.minute, 0);
  assert.match(reminder!.body, /slept/i);
});

test('a scheduled experiment reminder names the start date, and still fires without one', () => {
  const withDate = reminderForState({ state: 'plan_scheduled', startDate: '2026-11-01' });
  assert.match(withDate!.body, /2026-11-01/);

  const withoutDate = reminderForState({ state: 'plan_scheduled' });
  assert.notEqual(withoutDate, null);
  assert.doesNotMatch(withoutDate!.body, /\d{4}-\d{2}-\d{2}/);
});

test('a stored reminder time is honoured for every state that carries one', () => {
  for (const state of ['run_in', 'plan_scheduled', 'plan_active', 'plan_awaiting_final'] as HomeState[]) {
    const reminder = reminderForState({ state, reminderTime: '06:30' });
    assert.equal(reminder!.hour, 6);
    assert.equal(reminder!.minute, 30);
  }
});

test('the active-experiment reminder never states a specific rule or day condition', () => {
  // One repeating daily trigger is scheduled once and cannot know whether today is an
  // intervention or a control day, so the body must not name a cutoff or a condition.
  const reminder = reminderForState({ state: 'plan_active', reminderTime: '06:30' });
  assert.notEqual(reminder, null);
  assert.doesNotMatch(reminder!.body, /\d{1,2}:\d{2}/, 'no clock time in the body');
  assert.doesNotMatch(reminder!.body, /intervention|control|cutoff/i);
  assert.match(reminder!.title, /instruction/i);
});

test('the final check-in reminder points at the result', () => {
  const reminder = reminderForState({ state: 'plan_awaiting_final' });
  assert.match(reminder!.body, /result/i);
  assert.match(reminder!.title, /final/i);
});

test('only reminders carrying our marker are adopted, so foreign notifications survive', () => {
  const requests = [
    { identifier: 'ours-1', content: { data: { [DAILY_REMINDER_DATA_KEY]: true } } },
    { identifier: 'ours-2', content: { data: { [DAILY_REMINDER_DATA_KEY]: true, note: 'extra' } } },
    { identifier: 'foreign-marker-false', content: { data: { [DAILY_REMINDER_DATA_KEY]: false } } },
    { identifier: 'foreign-other-app', content: { data: { someOtherApp: true } } },
    { identifier: 'foreign-no-data', content: {} },
    { identifier: 'foreign-null-content', content: null },
    { identifier: 'foreign-no-content' },
    { identifier: 42 as unknown as string, content: { data: { [DAILY_REMINDER_DATA_KEY]: true } } },
  ];

  assert.deepEqual(pickReminderIds(requests), ['ours-1', 'ours-2']);
  assert.deepEqual(pickReminderIds([]), []);
});
