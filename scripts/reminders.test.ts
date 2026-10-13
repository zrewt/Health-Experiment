import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DAILY_REMINDER_DATA_KEY,
  DEFAULT_REMINDER_PREFERENCES,
  DEFAULT_REMINDER_TIME,
  EVENING_PREVIEW_TIME,
  MAX_REMINDERS_PER_DAY,
  MAX_SCHEDULED_REMINDERS,
  applyDailyCap,
  buildReminderSchedule,
  conditionAction,
  needsDailyCheckIn,
  normalizeReminderPreferences,
  parseReminderTime,
  pickReminderIds,
  type ReminderPlanContext,
  type ReminderSpec,
} from '../src/notifications/reminder-plan';
import {
  REMINDER_SLOTS,
  ROUTE_FOR_HOME_STATE,
  reminderSlotFrom,
  resolveReminderTap,
  routeForHomeState,
} from '../src/notifications/tap-target';
import type { ConditionRuleConfig } from '../src/engine';
import type { HomeState } from '../src/experiment/home-state';

const TODAY = '2026-11-01';

function mkPlan(
  schedule: { date: string; condition: string }[],
  conditionRule: ConditionRuleConfig | null,
  overrides: Partial<ReminderPlanContext> = {},
): ReminderPlanContext {
  return {
    startDate: schedule[0]?.date ?? TODAY,
    chosenDuration: schedule.length,
    schedule,
    conditionRule,
    ...overrides,
  };
}

const CAFFEINE_12 = { type: 'caffeine-cutoff', cutoffTime: '12:00' } as ConditionRuleConfig;

function dated(specs: readonly ReminderSpec[], date: string): ReminderSpec[] {
  return specs.filter((spec) => spec.trigger.kind === 'date' && spec.trigger.date === date);
}

function slots(specs: readonly ReminderSpec[]): string[] {
  return specs.map((spec) => spec.slot);
}

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

test('an unusable stored preference falls back to the default instead of disabling the reminder', () => {
  assert.deepEqual(normalizeReminderPreferences(null), DEFAULT_REMINDER_PREFERENCES);
  assert.deepEqual(normalizeReminderPreferences('not an object'), DEFAULT_REMINDER_PREFERENCES);
  assert.deepEqual(normalizeReminderPreferences({}), DEFAULT_REMINDER_PREFERENCES);

  const salvaged = normalizeReminderPreferences({
    enabled: 'yes', morningTime: 'nonsense', actionEnabled: 0, previewEnabled: null, previewTime: '25:00',
  });
  assert.equal(salvaged.enabled, true, 'only an explicit false disables reminders');
  assert.equal(salvaged.morningTime, DEFAULT_REMINDER_TIME);
  assert.equal(salvaged.previewTime, EVENING_PREVIEW_TIME);
  assert.equal(salvaged.actionEnabled, true);
  assert.equal(salvaged.previewEnabled, true);

  assert.deepEqual(
    normalizeReminderPreferences({ morningTime: '06:30', previewTime: '20:15' }),
    { ...DEFAULT_REMINDER_PREFERENCES, morningTime: '06:30', previewTime: '20:15' },
  );
});

test('only states with a daily logging habit carry a reminder', () => {
  for (const state of ['run_in', 'plan_scheduled', 'plan_active', 'plan_awaiting_final'] as HomeState[]) {
    assert.equal(needsDailyCheckIn(state), true, `${state} needs a daily reminder`);
    assert.ok(buildReminderSchedule({ state, today: TODAY }).length > 0, `${state} yields reminders`);
  }
  for (const state of ['needs_consent', 'needs_setup', 'feasibility_ready', 'plan_result_ready', 'plan_ended_early'] as HomeState[]) {
    assert.equal(needsDailyCheckIn(state), false, `${state} must not carry a daily reminder`);
    assert.deepEqual(buildReminderSchedule({ state, today: TODAY }), [], `${state} yields nothing`);
  }
});

test('the morning reminder is a single repeating one, so its copy can never go stale', () => {
  // Anything that varies per day must be a dated reminder; a repeating one is scheduled
  // once and would otherwise keep announcing a day number or a rule that has moved on.
  const schedule = [
    { date: '2026-11-01', condition: 'intervention' },
    { date: '2026-11-02', condition: 'control' },
    { date: '2026-11-03', condition: 'intervention' },
  ];
  const specs = buildReminderSchedule({
    state: 'plan_active',
    today: TODAY,
    plan: mkPlan(schedule, CAFFEINE_12),
    nowMinutes: 0,
  });

  const repeating = specs.filter((spec) => spec.trigger.kind === 'daily');
  assert.equal(repeating.length, 1, 'exactly one repeating reminder');
  assert.equal(repeating[0].slot, 'morning-check-in');
  assert.deepEqual(repeating[0].trigger, { kind: 'daily', hour: 8, minute: 0 });
  assert.doesNotMatch(repeating[0].body, /\d{1,2}:\d{2}/, 'no clock time in a repeating body');
  assert.doesNotMatch(repeating[0].body, /intervention|control|cutoff|Day \d/i);
});

test('run-in reminder uses the default time and asks for the sleep log', () => {
  const specs = buildReminderSchedule({ state: 'run_in', today: TODAY });
  assert.equal(specs.length, 1);
  assert.equal(specs[0].slot, 'morning-check-in');
  assert.deepEqual(specs[0].trigger, { kind: 'daily', hour: 8, minute: 0 });
  assert.match(specs[0].body, /slept/i);
});

test('a scheduled experiment reminder names the start date, and still works without one', () => {
  const withDate = buildReminderSchedule({
    state: 'plan_scheduled', today: TODAY,
    plan: mkPlan([], CAFFEINE_12, { startDate: '2026-11-08' }),
  });
  assert.match(withDate[0].body, /2026-11-08/);
  assert.equal(withDate.length, 1, 'nothing day-specific before the experiment starts');

  const withoutDate = buildReminderSchedule({
    state: 'plan_scheduled', today: TODAY,
    plan: mkPlan([], CAFFEINE_12, { startDate: '' }),
  });
  assert.doesNotMatch(withoutDate[0].body, /\d{4}-\d{2}-\d{2}/);
});

test('the saved morning time is honoured for every state that carries a reminder', () => {
  const preferences = normalizeReminderPreferences({ morningTime: '06:30' });
  for (const state of ['run_in', 'plan_scheduled', 'plan_active', 'plan_awaiting_final'] as HomeState[]) {
    const specs = buildReminderSchedule({ state, today: TODAY, preferences });
    assert.deepEqual(specs[0].trigger, { kind: 'daily', hour: 6, minute: 30 });
  }
});

test('preferences turn reminders off, per type, and nothing is scheduled at all when disabled', () => {
  const schedule = [
    { date: '2026-11-01', condition: 'intervention' },
    { date: '2026-11-02', condition: 'intervention' },
  ];
  const base = { state: 'plan_active' as HomeState, today: TODAY, plan: mkPlan(schedule, CAFFEINE_12), nowMinutes: 0 };

  assert.deepEqual(
    buildReminderSchedule({ ...base, preferences: normalizeReminderPreferences({ enabled: false }) }),
    [],
    'the master switch clears everything, including the repeating reminder',
  );

  const noAction = buildReminderSchedule({
    ...base, preferences: normalizeReminderPreferences({ actionEnabled: false }),
  });
  assert.equal(noAction.some((spec) => spec.slot === 'before-cutoff'), false);
  assert.equal(noAction.some((spec) => spec.slot === 'next-day-preview'), true, 'the other type survives');

  const noPreview = buildReminderSchedule({
    ...base, preferences: normalizeReminderPreferences({ previewEnabled: false }),
  });
  assert.equal(noPreview.some((spec) => spec.slot === 'next-day-preview'), false);
  assert.equal(noPreview.some((spec) => spec.slot === 'before-cutoff'), true);
  assert.equal(noPreview.filter((spec) => spec.trigger.kind === 'daily').length, 1, 'the check-in remains');

  const moved = buildReminderSchedule({
    ...base,
    preferences: normalizeReminderPreferences({ previewTime: '20:15' }),
  });
  const preview = moved.find((spec) => spec.slot === 'next-day-preview')!;
  assert.equal(preview.trigger.kind === 'date' && preview.trigger.hour, 20);
  assert.equal(preview.trigger.kind === 'date' && preview.trigger.minute, 15);
});

test('an active experiment adds a warning before each assigned day and a heads-up the evening before', () => {
  const schedule = [
    { date: '2026-11-01', condition: 'intervention' },
    { date: '2026-11-02', condition: 'control' },
    { date: '2026-11-03', condition: 'intervention' },
    { date: '2026-11-04', condition: 'intervention' },
  ];
  const specs = buildReminderSchedule({
    state: 'plan_active', today: TODAY, plan: mkPlan(schedule, CAFFEINE_12), nowMinutes: 0,
  });

  // 11:45, fifteen minutes before a 12:00 cutoff.
  assert.deepEqual(
    dated(specs, '2026-11-01').map((s) => [s.slot, s.trigger.kind === 'date' ? `${s.trigger.hour}:${s.trigger.minute}` : '']),
    [['before-cutoff', '11:45']],
  );
  // The evening before the 2nd is a control day, and that is exactly when the 3rd matters.
  assert.deepEqual(dated(specs, '2026-11-02').map((s) => s.slot), ['next-day-preview']);
  assert.deepEqual(dated(specs, '2026-11-03').map((s) => s.slot), ['before-cutoff', 'next-day-preview']);
  assert.deepEqual(dated(specs, '2026-11-04').map((s) => s.slot), ['before-cutoff']);
  assert.equal(specs.length, 6, 'one repeating plus five dated');
});

test('a usual-routine day is never told to cut caffeine', () => {
  // Announcing an assigned rule on a control day would push the user to abstain on a day
  // that is supposed to be their normal routine, which contaminates the comparison.
  const schedule = [
    { date: '2026-11-01', condition: 'control' },
    { date: '2026-11-02', condition: 'control' },
    { date: '2026-11-03', condition: 'intervention' },
  ];
  const specs = buildReminderSchedule({
    state: 'plan_active', today: TODAY, plan: mkPlan(schedule, CAFFEINE_12), nowMinutes: 0,
  });

  for (const controlDate of ['2026-11-01', '2026-11-02']) {
    for (const spec of dated(specs, controlDate)) {
      assert.equal(spec.slot, 'next-day-preview', `${controlDate} may only carry a preview`);
      assert.doesNotMatch(spec.body, /today/i, 'a preview must not speak about today');
    }
  }
  assert.deepEqual(dated(specs, '2026-11-03').map((s) => s.slot), ['before-cutoff']);
});

test('day-specific copy is personalised from the plan rule, not fixed at noon', () => {
  const schedule = [{ date: '2026-11-02', condition: 'intervention' }];
  const specs = buildReminderSchedule({
    state: 'plan_active', today: TODAY,
    plan: mkPlan(schedule, { type: 'caffeine-cutoff', cutoffTime: '09:15' } as ConditionRuleConfig),
    nowMinutes: 0,
  });

  const cutoff = specs.find((spec) => spec.slot === 'before-cutoff')!;
  assert.equal(cutoff.trigger.kind === 'date' && cutoff.trigger.hour, 9);
  assert.equal(cutoff.trigger.kind === 'date' && cutoff.trigger.minute, 0);
  assert.match(cutoff.body, /09:15/);

  const preview = specs.find((spec) => spec.slot === 'next-day-preview')!;
  assert.match(preview.body, /09:15/);
  assert.doesNotMatch(specs.map((s) => s.body).join(' '), /12:00/);
});

test('an unrecognised or unusable condition rule degrades to the generic reminder', () => {
  const schedule = [
    { date: '2026-11-01', condition: 'intervention' },
    { date: '2026-11-02', condition: 'intervention' },
  ];
  const unknown = mkPlan(schedule, { type: 'cold-plunge', minutes: 5 } as ConditionRuleConfig);
  const missingCutoff = mkPlan(schedule, { type: 'caffeine-cutoff' } as unknown as ConditionRuleConfig);
  const noRule = mkPlan(schedule, null);

  for (const plan of [unknown, missingCutoff, noRule]) {
    const specs = buildReminderSchedule({ state: 'plan_active', today: TODAY, plan, nowMinutes: 0 });
    assert.deepEqual(slots(specs), ['morning-check-in'], 'no rule-specific reminders without a known rule');
  }

  assert.equal(conditionAction(null), null);
  assert.equal(conditionAction({ type: 'cold-plunge' } as ConditionRuleConfig), null);
  assert.notEqual(conditionAction(CAFFEINE_12), null);
});

test('reminders are not scheduled outside the window', () => {
  const schedule = [
    { date: '2026-11-02', condition: 'intervention' },
    { date: '2026-11-10', condition: 'intervention' },
  ];
  const specs = buildReminderSchedule({
    state: 'plan_active', today: TODAY, plan: mkPlan(schedule, CAFFEINE_12),
    nowMinutes: 0, windowDays: 3,
  });

  assert.equal(dated(specs, '2026-11-02').length, 1, 'inside the window');
  assert.equal(dated(specs, '2026-11-09').length, 0, 'evening before a day past the window');
  assert.equal(dated(specs, '2026-11-10').length, 0, 'past the window');
});

test('moments that have already passed today are dropped rather than delivered late', () => {
  const schedule = [
    { date: '2026-11-01', condition: 'intervention' },
    { date: '2026-11-02', condition: 'intervention' },
  ];
  const plan = mkPlan(schedule, CAFFEINE_12);

  // 13:20: today's 11:45 warning is gone, but the 21:00 heads-up is still ahead.
  const afternoon = buildReminderSchedule({ state: 'plan_active', today: TODAY, plan, nowMinutes: 800 });
  assert.deepEqual(dated(afternoon, '2026-11-01').map((s) => s.slot), ['next-day-preview']);
  assert.deepEqual(dated(afternoon, '2026-11-02').map((s) => s.slot), ['before-cutoff']);

  // 22:00: both of today's moments are gone.
  const night = buildReminderSchedule({ state: 'plan_active', today: TODAY, plan, nowMinutes: 1320 });
  assert.deepEqual(dated(night, '2026-11-01'), []);
  assert.deepEqual(dated(night, '2026-11-02').map((s) => s.slot), ['before-cutoff']);

  // Early morning: everything still applies.
  const dawn = buildReminderSchedule({ state: 'plan_active', today: TODAY, plan, nowMinutes: 100 });
  assert.deepEqual(dated(dawn, '2026-11-01').map((s) => s.slot), ['before-cutoff', 'next-day-preview']);
});

test('a cutoff within the lead time of midnight produces no nonsense warning', () => {
  const schedule = [{ date: '2026-11-01', condition: 'intervention' }];
  const specs = buildReminderSchedule({
    state: 'plan_active', today: TODAY, plan: mkPlan(schedule, CAFFEINE_12),
    nowMinutes: 0,
  });
  assert.equal(dated(specs, '2026-11-01').length, 1, 'a normal cutoff still warns');

  const tooEarly = buildReminderSchedule({
    state: 'plan_active', today: TODAY,
    plan: mkPlan(schedule, { type: 'caffeine-cutoff', cutoffTime: '00:10' } as ConditionRuleConfig),
    nowMinutes: 0,
  });
  assert.deepEqual(dated(tooEarly, '2026-11-01'), [], 'no warning when it would land before midnight');
  assert.deepEqual(slots(tooEarly), ['morning-check-in'], 'the daily reminder still stands');
});

test('no day can ever exceed the reminder cap, and the repeating one is never dropped', () => {
  const specs: ReminderSpec[] = [
    { slot: 'morning-check-in', trigger: { kind: 'daily', hour: 8, minute: 0 }, title: 't', body: 'b' },
    { slot: 'morning-check-in', trigger: { kind: 'date', date: '2026-11-01', hour: 8, minute: 0 }, title: 't', body: 'b' },
    { slot: 'before-cutoff', trigger: { kind: 'date', date: '2026-11-01', hour: 11, minute: 45 }, title: 't', body: 'b' },
    { slot: 'next-day-preview', trigger: { kind: 'date', date: '2026-11-01', hour: 21, minute: 0 }, title: 't', body: 'b' },
    { slot: 'next-day-preview', trigger: { kind: 'date', date: '2026-11-01', hour: 22, minute: 0 }, title: 't', body: 'b' },
  ];
  const capped = applyDailyCap(specs);
  const byDate = capped.filter((s) => s.trigger.kind === 'date');
  assert.equal(byDate.length, MAX_REMINDERS_PER_DAY, 'kept exactly the cap');
  assert.deepEqual(byDate.map((s) => s.trigger.kind === 'date' && s.trigger.hour), [8, 11, 21], 'earliest kept');
  assert.equal(capped.filter((s) => s.trigger.kind === 'daily').length, 1, 'repeating reminder survives');

  // A worst case 14 day experiment, every day assigned, still stays inside the cap.
  const schedule = Array.from({ length: 14 }, (_, i) => ({
    date: `2026-11-${String(i + 1).padStart(2, '0')}`,
    condition: 'intervention',
  }));
  const built = buildReminderSchedule({
    state: 'plan_active', today: TODAY, plan: mkPlan(schedule, CAFFEINE_12), nowMinutes: 0,
  });
  assert.ok(built.length <= MAX_SCHEDULED_REMINDERS);
  const perDate = new Map<string, number>();
  for (const spec of built) {
    if (spec.trigger.kind !== 'date') continue;
    perDate.set(spec.trigger.date, (perDate.get(spec.trigger.date) ?? 0) + 1);
  }
  for (const [date, count] of perDate) {
    assert.ok(count <= MAX_REMINDERS_PER_DAY, `${date} carried ${count} reminders`);
  }
});

test('only reminders carrying our marker are adopted, so foreign notifications survive', () => {
  const requests = [
    { identifier: 'ours-1', content: { data: { [DAILY_REMINDER_DATA_KEY]: true } } },
    { identifier: 'ours-2', content: { data: { [DAILY_REMINDER_DATA_KEY]: true, slot: 'before-cutoff' } } },
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

test('every home state has a real destination', () => {
  const states: HomeState[] = [
    'needs_consent', 'needs_setup', 'run_in', 'feasibility_ready', 'plan_scheduled',
    'plan_active', 'plan_awaiting_final', 'plan_ended_early', 'plan_result_ready',
  ];
  for (const state of states) {
    const route = routeForHomeState(state);
    assert.ok(route.startsWith('/'), `${state} must map to a route, got ${JSON.stringify(route)}`);
    assert.equal(ROUTE_FOR_HOME_STATE[state], route);
  }
  // The four states that actually carry reminders must land somewhere that can act on them.
  assert.equal(routeForHomeState('run_in'), '/run-in');
  assert.equal(routeForHomeState('plan_active'), '/daily-instruction');
  assert.equal(routeForHomeState('plan_awaiting_final'), '/result');
});

test('only expected reminder slots are read back out of a payload', () => {
  for (const slot of REMINDER_SLOTS) {
    assert.equal(reminderSlotFrom({ slot }), slot);
  }
  assert.equal(reminderSlotFrom({ slot: 'not-a-slot' }), null);
  assert.equal(reminderSlotFrom({ slot: 7 }), null);
  assert.equal(reminderSlotFrom({}), null);
  assert.equal(reminderSlotFrom(null), null);
  assert.equal(reminderSlotFrom('morning-check-in'), null, 'a bare string is not a payload');

  // Anything the scheduler writes must be readable again, or a tap would silently do nothing.
  const schedule = [{ date: '2026-11-02', condition: 'intervention' }];
  const specs = buildReminderSchedule({
    state: 'plan_active', today: TODAY, plan: mkPlan(schedule, CAFFEINE_12), nowMinutes: 0,
  });
  assert.ok(specs.length > 0);
  for (const spec of specs) {
    assert.equal(reminderSlotFrom({ slot: spec.slot }), spec.slot, `${spec.slot} must round-trip`);
  }
});

test('a tapped reminder lands on the screen it is about', () => {
  // The two experiment reminders are about one specific thing, so they do not depend on state.
  for (const state of [null, 'run_in', 'plan_active'] as (HomeState | null)[]) {
    assert.equal(resolveReminderTap('before-cutoff', state), '/daily-instruction');
    assert.equal(resolveReminderTap('next-day-preview', state), '/daily-instruction');
  }

  // The morning check-in is about logging, and logging lives in different places over time.
  assert.equal(resolveReminderTap('morning-check-in', 'run_in'), '/run-in');
  assert.equal(resolveReminderTap('morning-check-in', 'plan_active'), '/daily-instruction');
  assert.equal(resolveReminderTap('morning-check-in', 'plan_awaiting_final'), '/result');

  // An unreadable state must not be guessed at: the caller falls back to home instead.
  assert.equal(resolveReminderTap('morning-check-in', null), null);
  assert.equal(resolveReminderTap(null, 'plan_active'), null);
});
