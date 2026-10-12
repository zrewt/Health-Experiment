# Manual Testing & Implementation Notes: Screens 1–4

## 1. Overview & Architecture
This milestone introduces:
- **Persistence layer:** [experiment-store.ts](src/data/experiment-store.ts) with AsyncStorage local cache and Supabase client integration.
- **Local calendar date utilities:** [dates.ts](src/experiment/dates.ts) with engine-aligned exposure day convention.
- **View-model helper:** [view-model.ts](src/experiment/view-model.ts) wrapping `checkCaffeineEligibility` for descriptive baseline metrics without new statistical models.
- **Screen 1 (Setup & Consent):** [setup-consent.tsx](src/app/setup-consent.tsx) implementing 3-point plain explanation, experiment description, screening question with honest advice, engine-default cutoff picker, draft informed consent, and draft privacy policy placeholder.
- **Screen 2 (Run-in):** [run-in.tsx](src/app/run-in.tsx) implementing valid-day progress tracking (14 valid days), morning check-in under 30 seconds, 3-day history with edit guards, and descriptive metrics after 3 valid days.

## 2. Alignment Convention
- **Engine rule:** In `src/engine/types.ts` (line 31) and `src/engine/analysis.ts` (line 251), `DayRecord.date` is the exposure day, which pairs with the **following night's sleep**.
- **Morning check-in:** When checking in on `today`, the user reports the sleep they just woke up from (night of `today - 1` to `today`) and yesterday's caffeine intake (exposure day `today - 1`).
- Therefore, `getMorningEntryDate(today)` maps to calendar date `today - 1`.

## 3. Adapter Seed Determinism Report
- Superseded by Part C: [adapter.ts](../src/experiment/adapter.ts) stores `analysisSeed = ((seed * 1664525 + 1013904223) >>> 0)` and every `evaluate()` passes that seed, not the schedule seed.
- The frozen schedule uses `seededRandom(plan.seed)`; Monte Carlo permutation draws use `seededRandom((analysisSeed ^ 0x9e3779b9) >>> 0)`. A first permutation can coincide with the schedule by chance; it is not forced to be different. Separate deterministic streams preserve reproducibility.
- Seeds 0, 9988 and 0xffffffff are covered; analysis seeds differ and stay uint32. Repeated real-engine evaluations return identical non-null intervals. All existing verdict fixtures still pass; their independent analysis references now use `plan.analysisSeed` without loosening assertions.

## 4. Legal / Clinical Notices
- **Draft Notice:** The consent copy and privacy policy placeholder are explicit **drafts** requiring human legal review before publishing.
- **Medical Disclaimer:** App contains: *"This app is not medical advice."*
- **No causal claims, power, MDE, SD, effect, or verdicts** are shown on Screens 1 or 2.

## 5. How to Run the App
- Dev server: `npx expo start`
- Typecheck: `npm run typecheck`
- Engine typecheck: `./node_modules/.bin/tsc --noEmit -p tsconfig.engine.json`
- Lint: `CI=1 npm run lint`
- Freeze check: `npm run verify:freeze`
- Tests: `npx tsx --test scripts/domain-screens.test.ts`

## 6. Manual Testing Checklist
1. **Setup & Consent Screen:**
   - [ ] Navigate to `/setup-consent`.
   - [ ] Verify the 3-point plain explanation and *"This app is not medical advice."* are visible.
   - [ ] Select "Rarely or never": verify honest notice appears with "Continue anyway" and "Not now".
   - [ ] Check cutoff time options; verify default is `12:00`.
   - [ ] Tap "View Draft Privacy Policy": toggle placeholder visibility.
   - [ ] Tap "I don't agree": verify decline screen appears with explanation that data cannot be collected without consent.
   - [ ] Check affirmative checkbox and tap "I agree & start run-in": verify navigation to `/run-in`.
2. **Run-in Screen:**
   - [ ] Verify header shows `0 of 14 valid days`.
   - [ ] Log 7 hours 30 mins sleep and 14:00 caffeine: tap "Save check-in".
   - [ ] Verify sleep outside 2 to 14 hours prompts confirmation before saving.
   - [ ] Tap "No caffeine": verify caffeine time field clears and disables.
   - [ ] Skip sleep (leave blank): verify progress count does not increment (missing is not zero).
   - [ ] Verify past 3 days list: yesterday and previous 3 days allow edit; older days display read-only.
   - [ ] Log 3 valid days: verify descriptive panel appears showing days logged, average sleep, afternoon caffeine days, and unknown days.

## 7. Files Changed and Decisions
- `src/app/_layout.tsx`: register setup and run-in routes.
- `src/app/index.tsx`: route signed-in users into setup/run-in flow.
- `src/app/setup-consent.tsx`: consent and setup form; agreement starts unchecked and “I don't agree” appends a decline record.
- `src/app/run-in.tsx`: run-in check-in, visible local unsynced status and retry action.
- `src/data/experiment-store.ts`: setup, consent, entry persistence and sync helpers.
- `src/experiment/dates.ts`, `src/experiment/view-model.ts`: local calendar arithmetic and descriptive baseline summary.
- `scripts/domain-screens.test.ts`: calendar and screen view-model tests.
- `supabase/schema.sql`: initial schema for setup, entries and consent (provided as SQL text; not run).
- `src/components/ui/Text.tsx`, `package.json`: platform/style and test-script adjustments.
- Decision: null remains missing, eligibility is withheld on Screen 2, and pending local entries must stay visible until server sync succeeds.
- Open questions: legal/privacy copy requires review; apply the provided Supabase schema in the project's deployment process before relying on cloud persistence.

## 8. Persistence Failure Behavior
- A daily entry is first written to AsyncStorage. A failed or unavailable Supabase upsert leaves it marked `synced: false`; the UI identifies it as “not synced yet” and attempts a retry, with a manual Retry Sync action if it remains pending. A successful server fetch preserves pending local entries instead of overwriting them.
- Setup values are cached locally and a failed Supabase setup upsert throws, so the setup screen does not navigate as though the cloud write succeeded. Consent decisions are recorded locally and appended to Supabase; a failed server write throws and the UI does not report the action as complete.
- The consent checkbox defaults to unchecked; “I don't agree” stores `granted: false` and displays the decline state after save succeeds.

## 9. Follow-up Manual Checks
- [ ] With Supabase writes unavailable, save a check-in: verify “not synced yet” remains visible and the cached entry survives reload.
- [ ] Restore connectivity or tap Retry Sync: verify pending entries become synced only after successful upsert and null fields remain null.
- [ ] Cause setup/consent writes to fail: verify no success navigation or decline confirmation is shown until the write succeeds.
- [ ] Inspect the run-in summary object: exact keys are `daysLogged`, `averageSleepMinutes`, `afternoonCaffeineDays`, `unknownCaffeineDays`, and `validDays`; it exposes no eligibility, reason, or threshold fields.

## 10. Screen 3 contracts and decisions
- Baseline uses **all** entries, not the latest 14. The engine's late-caffeine share denominator is all run-in records, including unknown exposure and missing sleep. Mean/sample SD use observed sleep only. Adapter eligibility additionally requires 14 non-null sleep days. These behaviors and the fixed noon eligibility cutoff are unchanged.
- Exact `BaselineSummary` fields: `validDays`, `targetDays`, `sd`, `eligible`, `reasons`, `engineReasons`, `lateCaffeineDays`, `knownExposureDays`, `unknownExposureDays`. Added fields copy frozen engine output, not new estimates. `engineReasons` excludes the adapter's extra valid-day message.
- The raw engine eligibility result also has `estimand`, `runInDaysCount`, `lateCaffeineShare`, `baselineOutcomeMean`, `baselineOutcomeSd`, plus `eligible`, `reasons`, and the three `*DaysCount` fields. Details shows only engine reasons verbatim and baseline count facts.
- Screen 3 is offered at 14 valid days; a persisted `nextCheckDate` defers the check until that local date. `Not now` returns without storing a deferral.
- Four durations are 42, 56, 70, 84 days. No unsupported numbers for SD above 75; SD below 25 uses the existing adapter conservative floor. Larger-than-60 statements pass through verbatim. No daily-instruction, result, or patterns screen was built.
- Selected setup cutoff is stored in the plan's condition rule; baseline eligibility remains the existing after-noon computation. The plan seed is drawn only on Start and the whole attempt is retained synchronously and cached before the network save. Duration is locked during retries.
- Persistence adds `getActivePlan`, `savePlan`, `saveNextCheckDate`, and pending-plan recovery. A plan success requires an authoritative server row, never an offline cache. A retry matches canonical JSON to tolerate jsonb object key order and lost insert responses. Failed writes retain explicit nulls and the original schedule, seeds and start date.
- SQL files to review/apply: [initial schema](../supabase/schema.sql), then [Screen 3 additive SQL](../schema-screen3.sql). Neither was run by the agent. No new dependencies were installed.

## 11. Screen 3 files changed
- [feasibility.tsx](../src/app/feasibility.tsx): tier-specific UI, duration choice, acknowledgement, server-confirmed scheduled page.
- [_layout.tsx](../src/app/_layout.tsx), [run-in.tsx](../src/app/run-in.tsx): route registration and re-check entry.
- [Button.tsx](../src/components/ui/Button.tsx): minimum rather than fixed height, disabled/busy accessibility state.
- [adapter.ts](../src/experiment/adapter.ts), [types.ts](../src/experiment/types.ts), [view-model.ts](../src/experiment/view-model.ts): baseline engine facts, pure screen state, analysis seed.
- [start-attempt.ts](../src/experiment/start-attempt.ts): pure retained start attempt and local-date entry gate.
- [experiment-store.ts](../src/data/experiment-store.ts), [plan-persistence.ts](../src/data/plan-persistence.ts): Supabase wiring and testable cache/server persistence.
- [experiment.test.ts](../scripts/experiment.test.ts), [screen3.test.ts](../scripts/screen3.test.ts): regression and Screen 3 coverage.
- [schema-screen3.sql](../schema-screen3.sql), this notes file: schema and manual handoff.

## 12. Screen 3 manual checklist
- [ ] With fewer than 14 valid days and no due re-check, Screen 3 is not offered; direct navigation returns to run-in.
- [ ] At 14 valid days, Check feasibility opens Screen 3. After scheduling a re-check, it is hidden until today + 7, including after reload.
- [ ] Ineligible/cannot-assess: Details shows engine reasons exactly, X of Y count includes unknown days, no Start button.
- [ ] Not-informative: no Start button; MDE above 60 uses the exact engine sentence; SD 76 shows no unsupported estimate.
- [ ] Informative/long-shot: all four durations, adapter default, verbatim engine sentences, full-rule/assigned-day labels, adherence/autocorrelation notes and approximate notice remain available.
- [ ] SD 24: conservative notice and `at least` qualifiers are visible.
- [ ] Long-shot checkbox starts unchecked. Start is disabled and the handler refuses until acknowledged.
- [ ] Fail plan write: error is visible, no success, duration locked. Retry uses identical plan/seed/analysisSeed/schedule/start date, including after reload.
- [ ] Lose an insert response: retry confirms the matching server row without creating a duplicate. Different active plan is not overwritten.
- [ ] Successful save: scheduled date is local tomorrow, chosen duration is correct, daily-instructions update notice and Back to check-in appear.
- [ ] Two accounts cannot read/insert/update another user's plan; concurrent inserts cannot leave two non-cancelled plans. No delete policy.
- [ ] Large system text, 320px viewport, screen-reader checked/disabled state, keyboard navigation, contrast and reduced-motion preference work on iOS/Android/web.
- Open checks: live Supabase schema/RLS and actual account/device accessibility validation require the user's database migration and test accounts. Browser tests use ephemeral local stubs only, never real server writes.

## 13. Verification performed
- Required final lint, app typecheck, engine typecheck, all eight test files and freeze verifier passed. Additional strict typechecking of adapter/domain/Screen 3 tests passed using a private temporary config with the existing aliases and installed Node types.
- Tests per file: engine 15; engine-v2 8; engine-v3 6; engine-v3-1 4; engine-v3-2 4; adapter 36; domain 10; Screen 3 21. Total 104, no skipped or failed tests. Calendar tests also ran with `TZ=America/New_York`.
- Frozen engine: all 10 manifest hashes match and diff against `engine-v3.2-freeze` is empty.
- Browser-only stubs confirmed run-in entry, duration defaults and exact engine sentences, failed plan save with no success, identical retry plan with one insert, scheduled page, long-shot unchecked/disabled then checked/enabled, ineligible baseline facts and seven-day re-check gate.
- At 320px, document width stayed 320px; the Approximate label stayed above the scrolling content. Browser accessibility snapshots expose radio/checkbox checked state and disabled Start. Console had no app errors.
- Screenshot capture was unavailable (preview webview produced no frames), so no screenshot-based visual review is claimed. Native Dynamic Type, VoiceOver/TalkBack and actual Supabase isolation/unique-index enforcement remain manual checks.
- Step A was already completed and pushed as `38d9337` before Part B/C. Saved clean-clone result used default `core.autocrlf=true`; LF attributes resolved the line-ending verification issue. The clone was already removed; audit scratch files are intentionally not included in the Part B/C commit.

## 14. Screen 4 & Dev Tools Contracts
- **Home state router:** [home-state.ts](../src/experiment/home-state.ts) pure function `getHomeState` computes:
  - `needs_consent` / `needs_setup`: missing records or ungranted consent
  - `run_in`: ongoing baseline logging
  - `feasibility_ready`: 14 valid days logged or `nextCheckDate` reached
  - `plan_scheduled`: active plan, today < startDate
  - `plan_active`: startDate <= today <= lastExposureDate
  - `plan_awaiting_final`: today is the day after last exposure date, waiting on final sleep night log
  - `plan_result_ready`: today after last exposure date and final night logged (or subsequent days)
  - `plan_ended_early`: plan status is cancelled
- **Dev-only test tools:** [clock.ts](../src/experiment/clock.ts), [sample-loader.ts](../src/dev/sample-loader.ts), [dev-tools.tsx](../src/app/dev-tools.tsx):
  - Shared clock `getToday()` uses real local calendar date in production, shiftable in dev by +1 / +7 / reset.
  - Dev-only loader writes 14 valid entries ending yesterday with ~31m SD.
  - Dev-only cleaner deletes sample entries.
  - Guarded strictly by `__DEV__` and excluded from production routing.
- **Screen 4 (Daily Instruction):** [daily-instruction.tsx](../src/app/daily-instruction.tsx):
  - Shows today's rule: "Today: no caffeine after [cutoff time]." (intervention) or "Today: your usual routine." (control).
  - Derived from plan condition rule cutoff time, never hardcoded.
  - Exposes no other day assignments.
  - Reusable [CheckInCard.tsx](../src/components/CheckInCard.tsx) for yesterday's check-in.
  - "End experiment early" confirms with the user, sets plan status to cancelled with server confirmation, and transitions to `plan_ended_early`.
- **Additive SQL:** [schema-screen4.sql](../schema-screen4.sql) provides additive column `is_sample boolean default false` on `experiment_entries`. Not executed.

## 15. Dev Tools & Screen 4 Manual Checklist
- [ ] Open Dev Tools from Home Screen (in development build).
- [ ] Tap "+1 Day" / "+7 Days" / "Reset": verify `getToday()` shifts and home screen state updates accordingly.
- [ ] Tap "Load sample run-in (14 days)": verify confirmation dialog appears naming account; check-in progress updates to 14 valid days.
- [ ] Tap "Delete sample entries": verify sample entries removed.
- [ ] Navigate to Daily Instruction during active experiment:
  - [ ] Intervention day displays exact "Today: no caffeine after [cutoff time]."
  - [ ] Control day displays exact "Today: your usual routine."
  - [ ] No future day assignments visible.
  - [ ] Displays "Day n of N", days logged, days remaining, adherence counts. No p-values or effect estimates.
- [ ] Test "End experiment early":
  - [ ] Confirmation prompt appears stating entries stay and cannot be resumed.
  - [ ] On confirm, plan status updates to cancelled.
  - [ ] Route displays ended early state with no option to start new experiment yet.

## 16. Screen 5 & Dev Tools Extension Contracts
- **Timing & Alignment (Critical):**
  - Last exposure date is E. Final night's sleep outcome is logged on the morning of E+1 (pairs with exposure on E).
  - The result can NEVER be computed before E+1 (`plan_awaiting_final`).
  - Calls to `evaluate()` receive ONLY `entriesForPlan(plan, entries)` filtered strictly to dates within the plan's schedule.
- **Router States:**
  - `plan_active`: startDate through E.
  - `plan_awaiting_final`: `today >= E+1` and plan status is neither `completed` nor `cancelled`.
  - `plan_result_ready`: plan status is `completed` with a stored result snapshot.
  - `plan_ended_early`: plan status is `cancelled`.
- **Screen 5A (plan_awaiting_final):**
  - Title: "Final Check-in". Notice: "Your experiment is complete."
  - If entry for date E is missing or incomplete, renders the shared [CheckInCard](../src/components/CheckInCard.tsx) for date E (3-day backfill window).
  - Displays counts only: days logged, adherence counts via `progressSummary()`. Absolutely NO effect estimates before clicking "See my result".
  - Locking warning: "Once you view your result, the days in this experiment are locked, so log or fix any days first."
  - Actions: "See my result" and "Go back".
- **Result Computation & Snapshot Persistence:**
  - On clicking "See my result": computes once via `evaluate(plan, entriesForPlan(plan, entries), today)`, creates a `ResultSnapshot`, and executes ONE server-confirmed update setting `status = 'completed'`, `result = snapshot`, and `completed_at`.
  - Conditional update (`where id = ... and status <> 'completed'`): if plan is already completed, reads stored snapshot and NEVER recomputes.
  - Never displays a result that was not stored: displays a clear retry state on network failure; retry reuses the same snapshot.
- **Screen 5B (plan_result_ready):**
  - Always renders strictly from stored `result` snapshot.
  - Verdict heading from fixed mapping: `SUPPORTED` -> "Supported", `NO_DETECTABLE_EFFECT` -> "No detectable effect", `INCONCLUSIVE` -> "Inconclusive".
  - Engine statement displayed VERBATIM.
  - Conservative estimate: "Conservative estimate (lower end of the plausible range): X minutes".
  - Plain-language adherence summary from snapshot counts (cutoff followed on X of Y assigned days; caffeine after cutoff on W of Z routine days).
  - Days analyzed, days excluded, days with no sleep logged from snapshot.
  - Engine limitations displayed VERBATIM if present.
  - Collapsible "How to read this": "This compares days assigned to the caffeine cutoff with days assigned to your usual routine. It describes the difference between those assigned days; it cannot tell you why it happened." plus "This app is not medical advice."
  - Next experiment note: "New experiments will arrive in a future update."
- **Edit Lock:**
  - `canEditDate(today, date, plan)` returns `false` for any schedule date if the plan is completed.
- **Dev Tools Extensions:**
  - "Load sample experiment entries": writes deterministic entries up to date E marked `is_sample: true` for the active plan.
  - "Jump to last exposure date + 1": sets simulated clock offset to reach E+1.
  - "Reset completed plan (dev)": resets plan status to scheduled, clearing result and completed_at.
  - "Delete sample entries": removes entries with `is_sample: true`.
- **Additive SQL:** [schema-screen5.sql](../schema-screen5.sql) provides additive columns `result jsonb` and `completed_at timestamptz` on `experiment_plans` and a status check constraint. Not executed.

## 17. Screen 5 Manual Checklist
- **Path to Reach Each State via Dev Tools:**
  - *To reach Screen 5A (`plan_awaiting_final`):*
    1. Ensure a plan is active (via Run-in -> Feasibility -> Start).
    2. Open Dev Tools -> "Load sample experiment entries" (fills all days up to E).
    3. Tap "Jump to last exposure date + 1".
    4. Return Home -> Screen 5A loads with "Your experiment is complete."
  - *To reach Screen 5B (`plan_result_ready`):*
    1. From Screen 5A, tap "See my result".
    2. Result computes, persists to database, and transitions to Screen 5B.
    3. Refreshing or re-entering always loads the stored snapshot.
  - *To reset and test again:*
    1. Open Dev Tools -> "Reset completed plan (dev)" & "Delete sample entries".
    2. Clock reset to normal or re-run.
- **Verification points:**
  - [ ] Prior to clicking "See my result", Screen 5A displays counts only and zero statistical estimates.
  - [ ] If final night (day E) is missing, check-in card for day E appears.
  - [ ] "See my result" persists `status = 'completed'` and `result` snapshot. Double tap returns stored snapshot without recomputing.
  - [ ] Screen 5B heading matches fixed mapping: Supported / No detectable effect / Inconclusive.
  - [ ] Statement and limitations pass through VERBATIM from engine.
  - [ ] Conservative estimate formatted: "Conservative estimate (lower end of the plausible range): X minutes".
  - [ ] Collapsible "How to read this" includes "This app is not medical advice."
  - [ ] Edit lock: attempting to edit days within the completed plan's schedule returns read-only / uneditable.

