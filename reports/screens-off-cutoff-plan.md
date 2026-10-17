# Screens-off cutoff — build plan

Status: **built and verified in the domain layer and on every screen; phone pass still outstanding.**

| Phase | State | What exists |
|---|---|---|
| P1 engine | Done, re-frozen | `src/engine/screen-cutoff.ts` (new): `ScreenCutoffRule`, `checkScreenEligibility`. `adherence.ts` dispatch branch, `index.ts` export. Caffeine logic unchanged. Manifest updated (11 files) with a `reenfrozen` note. |
| P2 data | Done | `supabase/migrations/0002_screens_off_cutoff.sql`, `last_screen_time` in `schema-all.sql`, store reads/writes the field. One active test: the setup row carries the active test's type and cutoff. |
| P3 registry | Done | `src/experiment/experiments.ts`: names, rule types, default cutoffs, exposure wording for both tests. |
| P4a adapter | Done | `toScreenEngineRecord`, `recordFor`, `exposureRecorded`, `computeScreenBaseline`; `startExperiment` takes the rule type; plan evaluation and progress pick the record shape from the plan's rule. |
| P4b screens | Done | `choose-test` screen (one test at a time, blocks a second while one runs, resets the replaced test's cutoff/deferral), run-in, feasibility, daily note, Today, journal, result and settings read the active test; check-in records the test's own exposure; undo keeps both fields. |
| P5 consent and copy | Done | `src/experiment/consent.ts` holds the current version (`2026-10-screens-draft-v2`); an older version now routes the user back through consent. Consent names sleep, caffeine and screen times. Reminder text comes from the registry for both tests. |
| P6 tests and device | Partly | 223/223 domain tests pass, including the new `scripts/screens-off.test.ts` (9 tests). No phone pass. |

Frozen-engine change: the screens rule is additive. The caffeine rule, eligibility and verdict code were not edited.

## 1. What the experiment is

Same shape as the caffeine test, different exposure:

- On **cutoff days** the user stops using screens at a set time before bed (default 21:30).
- On **normal days** they keep their usual screen use.
- The outcome is the same: sleep minutes logged each morning.
- The result uses the same analysis, verdict and plain-language summary, with the wording
  changed from "caffeine" to "screens".

The daily log gains one field: **last screen use** (HH:mm, or "none" for a screen-free evening),
with the same strict time rules the caffeine field already uses.

## 2. Why it is not a one-line change

The statistics live in `src/engine/`, which is frozen and hash-verified. Checked facts:

- The engine contains no caffeine wording of its own. The caffeine naming is in the adapter
  (`src/experiment/adapter.ts`: `toEngineRecord`, `computeBaseline`, `checkCaffeineEligibility`
  is called from there) and in the exposure field names the engine reads (`lastCaffeineTime`,
  `servings`).
- The "caffeine after noon" eligibility check and the caffeine servings field do not apply to
  screens. Feeding screen time into the caffeine slot would make the engine's own rules and
  labels wrong, so the name has to be generalized.

So the work is a **generic exposure**: one time-of-day exposure field plus an experiment label,
with the caffeine test mapped onto it unchanged. That is an engine change, so it is a documented
re-freeze, not a silent edit.

## 3. App flow with two experiments

Today the app assumes one experiment. The new flow:

1. **Choose a test** (new screen, reached from Home and from `/experiment`):
   two cards, each with one sentence on what you do and how long it takes.
   A card shows "Running" or "Finished" if the user has tested it before.
2. **Setup per test:** cutoff time per test. Consent is shared, but see §5.
3. **Run-in per test:** each test needs its own baseline nights. The screens-off test asks for
   last screen use every morning during its run-in, so nights logged for the caffeine test
   count toward it only if the screens field was also logged for those nights.
4. **Feasibility per test**, with the same "Is this test worth doing?" screen.
5. **One active test at a time (recommended, see §8).** Home shows the active test and its
   next step. A finished test can be archived and the user can start the other one.
6. **Daily check-in:** the caffeine field stays. The screen-use field appears when a screens
   test is in its run-in or running; it is hidden otherwise to keep the daily screen short.
7. **Result, journal, reminders:** read the test's type and use its wording. The journal shows
   both fields, with a "not logged" state for the one that does not apply.

## 4. Data model

Use a versioned migration, not another paste-the-file step (the roadmap's Stage 3 item 18):

- `experiment_plans`: add `experiment_type text not null default 'caffeine_cutoff'`.
  Existing rows keep working unchanged.
- `experiment_entries`: add `last_screen_time text null`, validated as HH:mm or 'none'.
  The existing locked-day trigger already protects every column of a completed test's rows.
- `experiment_setup`: key the cutoff by test type (one row per user per type), or add the type
  column and keep the current row as the caffeine test.
- RLS: unchanged. Every new column stays under `auth.uid() = user_id`.
- Account deletion (`delete_own_account`): unchanged; it already removes all rows for the user.

Device cache keys follow the existing `@experiment_<thing>:<userId>` rule, so the local wipe
keeps working without changes.

## 5. Consent and copy

- The consent text must name the screen-use data. Consent is append-only and versioned, so the
  new text needs a new consent version and an agree step for existing users.
- The consent copy is still a draft awaiting legal review (see the roadmap). Adding a second
  test makes that review more important, not less.
- `AGENT_RULES.md` still applies: one idea per screen, plain words, engine sentences verbatim,
  nothing that sounds medical. The screens test is not a sleep treatment and says so.

## 6. Phases

| Phase | Work | Done when |
|---|---|---|
| P0 | Decisions in §8, consent text draft for screens | Decisions recorded here |
| P1 | Generic exposure in the engine; caffeine test mapped onto it; re-freeze with a written note | `verify:freeze` passes with the new manifest; engine tests and the caffeine results are unchanged |
| P2 | Migration for `experiment_type` and `last_screen_time`; per-type setup | Migration applies cleanly on a fresh database; existing caffeine rows read back the same |
| P3 | Experiment registry in `src/experiment/` (one definition per type: name, exposure label, default cutoff, copy) | The caffeine test reads the same as before in every screen |
| P4 | Choose-a-test screen; per-test setup, run-in, feasibility, daily, result, journal | Both tests run end to end on the simulator |
| P5 | Consent version, copy, reminder text per test | Copy reviewed against `AGENT_RULES.md` |
| P6 | Tests (below) and a phone pass on both flows | Phone pass recorded in the report |

## 7. Verification

- **Engine:** the existing engine tests must pass unchanged, which proves the caffeine path
  did not move. New tests cover the generic exposure with screen times.
- **Adapter:** per-type tests for the record mapping, baseline, adherence and the cutoff rule.
- **Lifecycle:** one active test at a time; a finished test archives; the second test starts
  its own run-in and does not inherit the first test's nights.
- **Locked days:** editing a night inside a completed screens test is refused, the same as for
  caffeine.
- **Result wording:** the summary never says "caffeine" for a screens test, and never claims
  screens caused a change (same caveat rule as the caffeine result).
- **Migration:** applied to an empty and to a populated database; the account-deletion path is
  rerun afterwards.
- **Static:** lint, typecheck, both typechecks, full test suite, `verify:freeze`, contrast check.
- **Device:** a development build, both tests walked through on the phone, reminders checked. **Not done yet.**

Recorded after the build (2026-10-17): `npx tsc --noEmit`, `npx expo lint`, 223/223 domain tests and `verify:freeze` (11 files) all pass. The screens-specific suite proves the renamed fields, the screen-logged run-in rule, the consent-version gate, the lifecycle/result wording and the screens reminder. Two behaviours are deliberate and worth knowing: a screens night only counts toward the run-in once its screen time is logged, and switching tests clears the other test's saved re-check date.

## 8. Decisions needed

1. **Engine approach.** Generalize the exposure and re-freeze the engine (recommended), or keep
   the engine frozen and store screen times in the caffeine field with a documented alias
   (faster, but the field name would be wrong and the caffeine-only rules would apply to screens).
2. **Concurrency.** One active test at a time (recommended: simpler run-in and simpler reminders),
   or both running at once (needs per-test reminders and a clearer home screen).
3. **Timing.** Build now, or after the MVP blockers (icon and splash, development build, legal
   review, phone pass). The plan above assumes it is built after those, so the launch is not
   delayed by the second test.

## 9. Risks

- The engine re-freeze is the riskiest step; the caffeine results must not move. The tests in §7
  exist to prove that.
- Two tests means two consent-sensitive data types under the same draft legal text.
- Run-in logic shared across tests can silently mix nights; the per-test baseline rule must be
  tested, not assumed.
- The screens-off cutoff is a behavior change, not a medical treatment. Copy must keep that line.
