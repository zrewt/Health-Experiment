import {
  buildReminderSchedule,
  type ReminderPlanContext,
  type ReminderSpec,
  DEFAULT_REMINDER_TIME,
  EVENING_PREVIEW_TIME,
  CUTOFF_LEAD_MINUTES,
  REMINDER_WINDOW_DAYS,
} from '../src/notifications/reminder-plan';
import type { ConditionRuleConfig } from '../src/engine';

const TODAY = '2026-11-01';
const CAFFEINE_12 = { type: 'caffeine-cutoff', cutoffTime: '12:00' } as ConditionRuleConfig;
const CAFFEINE_2130 = { type: 'caffeine-cutoff', cutoffTime: '21:30' } as ConditionRuleConfig;

function plan(schedule: { date: string; condition: string }[], rule = CAFFEINE_12, startDate?: string): ReminderPlanContext {
  return {
    startDate: startDate ?? schedule[0]?.date ?? TODAY,
    chosenDuration: schedule.length,
    schedule,
    conditionRule: rule,
  };
}

function slotLabel(spec: ReminderSpec): string {
  if (spec.trigger.kind === 'daily') return `daily @ ${spec.trigger.hour}:${String(spec.trigger.minute).padStart(2, '0')}`;
  return `dated ${spec.trigger.date} @ ${spec.trigger.hour}:${String(spec.trigger.minute).padStart(2, '0')}`;
}

function print(label: string, specs: readonly ReminderSpec[]) {
  console.log(`\n=== ${label} ===`);
  console.log(`Queue length: ${specs.length}`);
  for (const spec of specs) {
    console.log(`  - slot=${spec.slot}  trigger=${slotLabel(spec)}`);
    console.log(`    title: ${spec.title}`);
    console.log(`    body:  ${spec.body}`);
  }
}

// (a) run-in state
print(
  '(a) run-in state — today 2026-11-01, no plan',
  buildReminderSchedule({ state: 'run_in', today: TODAY, plan: null, nowMinutes: 0 })
);

// (b) plan scheduled but not yet started
print(
  '(b) plan scheduled but not yet started — starts 2026-11-08',
  buildReminderSchedule({ state: 'plan_scheduled', today: TODAY, plan: plan([], CAFFEINE_12, '2026-11-08'), nowMinutes: 0 })
);

// (b-alt) plan scheduled with no startDate at all
print(
  '(b-alt) plan scheduled with empty startDate',
  buildReminderSchedule({ state: 'plan_scheduled', today: TODAY, plan: plan([], CAFFEINE_12, ''), nowMinutes: 0 })
);

// (c) 8-day plan, 4 assigned days
const eightDaySchedule = [
  { date: '2026-10-30', condition: 'control' },
  { date: '2026-10-31', condition: 'intervention' },
  { date: '2026-11-01', condition: 'intervention' },
  { date: '2026-11-02', condition: 'control' },
  { date: '2026-11-03', condition: 'intervention' },
  { date: '2026-11-04', condition: 'control' },
  { date: '2026-11-05', condition: 'intervention' },
  { date: '2026-11-06', condition: 'control' },
];
print(
  '(c) 8-day plan, 4 assigned days — plan_active, today 2026-11-01',
  buildReminderSchedule({ state: 'plan_active', today: TODAY, plan: plan(eightDaySchedule, CAFFEINE_12, '2026-10-30'), nowMinutes: 0 })
);

// (c-morning) same plan, early morning so everything still applies
print(
  '(c-morning) 8-day plan, early morning (nowMinutes=60)',
  buildReminderSchedule({ state: 'plan_active', today: TODAY, plan: plan(eightDaySchedule, CAFFEINE_12, '2026-10-30'), nowMinutes: 60 })
);

// (d) 14-day plan, all assigned
const fourteenDaySchedule = Array.from({ length: 14 }, (_, i) => ({
  date: `2026-11-${String(i + 1).padStart(2, '0')}`,
  condition: 'intervention' as const,
}));
print(
  '(d) 14-day plan, all days assigned — plan_active, today 2026-11-01',
  buildReminderSchedule({ state: 'plan_active', today: TODAY, plan: plan(fourteenDaySchedule, CAFFEINE_12, '2026-11-01'), nowMinutes: 0 })
);

// (d-late) same plan, but later in the day so some moments have passed
print(
  '(d-late) 14-day plan, afternoon (nowMinutes=800 = 13:20)',
  buildReminderSchedule({ state: 'plan_active', today: TODAY, plan: plan(fourteenDaySchedule, CAFFEINE_12, '2026-11-01'), nowMinutes: 800 })
);

// Per-day cap demonstration on a worst case: plan with 3 reminders already targeted at the same day
import { applyDailyCap, MAX_REMINDERS_PER_DAY } from '../src/notifications/reminder-plan';
const cappedDemo = applyDailyCap([
  { slot: 'morning-check-in', trigger: { kind: 'daily', hour: 8, minute: 0 }, title: 't', body: 'b' },
  { slot: 'before-cutoff', trigger: { kind: 'date', date: '2026-11-02', hour: 11, minute: 45 }, title: 't', body: 'b' },
  { slot: 'next-day-preview', trigger: { kind: 'date', date: '2026-11-02', hour: 20, minute: 0 }, title: 't', body: 'b' },
  { slot: 'next-day-preview', trigger: { kind: 'date', date: '2026-11-02', hour: 21, minute: 0 }, title: 't', body: 'b' },
  { slot: 'next-day-preview', trigger: { kind: 'date', date: '2026-11-02', hour: 22, minute: 0 }, title: 't', body: 'b' },
]);
console.log(`\n=== per-day cap demo (MAX_REMINDERS_PER_DAY = ${MAX_REMINDERS_PER_DAY}) ===`);
console.log(`input: 5 reminders targeted at 2026-11-02 (plus 1 daily)`);
console.log(`output: ${cappedDemo.length} reminders`);
for (const spec of cappedDemo) {
  console.log(`  - ${slotLabel(spec)} slot=${spec.slot}`);
}

console.log('\n=== config constants referenced above ===');
console.log(`DEFAULT_REMINDER_TIME = ${DEFAULT_REMINDER_TIME}`);
console.log(`EVENING_PREVIEW_TIME = ${EVENING_PREVIEW_TIME}`);
console.log(`CUTOFF_LEAD_MINUTES = ${CUTOFF_LEAD_MINUTES}`);
console.log(`REMINDER_WINDOW_DAYS = ${REMINDER_WINDOW_DAYS}`);
